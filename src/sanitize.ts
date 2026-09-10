// Sanitizer — de harde poort tussen werkgeheugen en persistente Jarvis-data.
//
// Kennisrecords, taakdossiers en CURRENT_STATE worden gecommit en overleven
// elke sessie. Wat daar per ongeluk in belandt (een klanttelefoonnummer, een
// tenant-UUID, een servicesleutel) staat daarna voorgoed in de git-historie.
// Daarom is dit géén waarschuwing maar een POORT, en is het model bewust
// drietraps:
//
//   1. sanitizeTekst()     — vervangt wat met zekerheid herkenbaar is door een
//      stabiele placeholder.
//   2. scanTekst()         — een ONAFHANKELIJKE rescan. Deze functie kent
//      sanitizeTekst niet, deelt er geen toestand mee en vertrouwt de uitvoer
//      ervan niet. Heeft stap 1 een bug, dan is stap 2 het vangnet.
//   3. sanitizeBestanden() — blijft er ná de rescan iets staan, dan is de
//      uitkomst ok:false. Nooit "vervangen en toch doorlopen".
//
// Waarom stap 2 zin heeft terwijl stap 1 dezelfde patronen kent: sanitizeTekst
// vervangt alleen wat het met zekerheid kan reconstrueren. Generieke hoge-
// entropiestrings worden bewust NIET automatisch vervangen (zie `vervangbaar`
// hieronder), dus een schone rescan is een echte extra uitspraak over de tekst
// en geen echo van stap 1.
//
// Alles is deterministisch: geen Date.now(), geen willekeur, geen netwerk. I/O
// loopt uitsluitend via geïnjecteerde functies (zelfde patroon als sources.ts)
// zodat de kern puur en testbaar blijft.
import { z } from "zod";
import { parseFrontMatter } from "./frontmatter";

export const ALLOWLIST_BESTANDSNAAM = "allowlist.yml";

// ---------------------------------------------------------------------------
// Bevindingen
// ---------------------------------------------------------------------------

// Volgorde is betekenisvol: patronen worden IN DEZE VOLGORDE op een regel
// losgelaten en een treffer die overlapt met een eerder geaccepteerde treffer
// wordt overgeslagen. Daarom staat uuid vooraan (het gevoeligste, en het zou
// anders door hoge_entropie worden opgeslokt), staat anthropic_api_key vóór
// openai_api_key (sk-ant- is een specialisatie van sk-) en sluit
// hoge_entropie de rij als vangnet.
export const PATROON_NAMEN = [
  "uuid",
  "supabase_secret_key",
  "supabase_publishable_key",
  "anthropic_api_key",
  "openai_api_key",
  "sendgrid_api_key",
  "resend_api_key",
  "twilio_account_sid",
  "twilio_api_key_sid",
  "verbindingsreeks",
  "email",
  "telefoon_e164",
  "telefoon_nl",
  "prive_sleutel",
  "hoge_entropie",
  "base64_geheim",
  // Geen tekstpatroon maar een leesfout. Een poort die stilzwijgend over een
  // onleesbaar bestand heen stapt, is geen poort.
  "bestand_onleesbaar",
] as const;
export type PatroonNaam = (typeof PATROON_NAMEN)[number];

/**
 * "kritiek" = secret (of een kandidaat daarvoor), "hoog" = PII.
 * Beide blokkeren; het onderscheid stuurt alleen de urgentie van opruimen.
 */
export type Severity = "kritiek" | "hoog";

export type Bevinding = {
  /** Repo-relatief pad, of "" wanneer er op losse tekst is gescand. */
  readonly bestand: string;
  /** 1-gebaseerd regelnummer; regels binnen overgeslagen blokken tellen mee. */
  readonly regel: number;
  readonly patroon: PatroonNaam;
  /** Gemaskeerd fragment — NOOIT de volledige gevoelige waarde. */
  readonly fragment: string;
  readonly severity: Severity;
};

/**
 * Maskeert een waarde voor gebruik in een bevinding.
 *
 * Kop van drie tekens (genoeg om `sb_`, `sk-` of `SG.` te herkennen), staart
 * van twee, en een AFGEKAPT aantal sterretjes ertussen: ook de lengte van een
 * secret is informatie die niet in een logregel of PR-comment hoort.
 */
export function maskeerFragment(waarde: string): string {
  if (waarde.length <= 6) return "*".repeat(waarde.length);
  const sterren = Math.min(waarde.length - 5, 12);
  return `${waarde.slice(0, 3)}${"*".repeat(sterren)}${waarde.slice(-2)}`;
}

// ---------------------------------------------------------------------------
// Entropie
// ---------------------------------------------------------------------------

/** Minimale lengte voordat een token überhaupt als secretkandidaat telt. */
export const ENTROPIE_MINIMUM_LENGTE = 32;

/**
 * Drempel in bits per teken (Shannon).
 *
 * Onderbouwing van 3.5: een willekeurige base62-sleutel van 32 tekens komt op
 * ~4.7-5.0 bits/teken, een hexadecimale hash van 32 tekens op ~3.9 (het maximum
 * voor hex is log2(16) = 4.0). Nederlandse prozawoorden en identifiers uit deze
 * codebase blijven daaronder, of vallen af op de twee extra eisen hieronder.
 * Lager dan 3.5 zou hashes ook vangen maar lange snake_case-identifiers
 * meesleuren; hoger dan 3.5 laat hexadecimale hashes ontsnappen.
 */
export const ENTROPIE_DREMPEL_BITS = 3.5;

/** Shannon-entropie in bits per teken. */
export function shannonEntropie(waarde: string): number {
  if (waarde.length === 0) return 0;
  const telling = new Map<string, number>();
  for (const teken of waarde) telling.set(teken, (telling.get(teken) ?? 0) + 1);
  let bits = 0;
  for (const aantal of telling.values()) {
    const kans = aantal / waarde.length;
    bits -= kans * Math.log2(kans);
  }
  return bits;
}

/**
 * Lengtes van de hashes die Jarvis zelf produceert en moet kunnen opslaan:
 * Git-blob-SHA-1 (40) en SHA-256 (64).
 *
 * 32 stond hier ook (MD5) en dat was een beveiligingsgat: het auth-token van
 * een van de telefonieleveranciers in deze keten is PRECIES 32 hexadecimale
 * tekens en werd daardoor stilzwijgend vrijgesteld. De engine produceert zelf
 * geen enkele hash van 32 tekens, dus die lengte hoort hier niet.
 */
const HASH_LENGTES = new Set([40, 64]);

/**
 * Is dit een cryptografische hash in plaats van een sleutel?
 *
 * Uitsluitend hexadecimaal én precies een van de bekende hashlengtes. Dat is
 * geen kosmetische uitzondering maar een noodzakelijke: een contextmanifest
 * BESTAAT uit Git-blob-hashes, en dat manifest is precies het bewijsstuk dat
 * duurzaam moet worden vastgelegd. Zonder deze uitzondering blokkeert de
 * privacypoort de audittrail van het systeem zelf.
 *
 * De prijs is bewust: een secret dat toevallig als 40 of 64 hex-tekens is
 * gecodeerd glipt langs dit ene patroon. Dat risico is klein — elk secret van
 * een leverancier in deze keten heeft een herkenbaar voorvoegsel en wordt door
 * een eigen patroon gevangen — en het alternatief (geen manifest kunnen
 * opslaan) weegt zwaarder.
 */
export function isHash(token: string): boolean {
  return HASH_LENGTES.has(token.length) && /^[0-9a-f]+$/i.test(token);
}

/**
 * BEWUST VERWIJDERD: een vormheuristiek die "leesbare identifiers" vrijstelde.
 *
 * Hij bestond om ruis te onderdrukken op lange namen uit documentatie, maar
 * een woordgebaseerd wachtwoord heeft exact dezelfde vorm — drie of meer door
 * scheidingstekens gekoppelde woorden — en glipte er dus ook langs. Een
 * privacypoort zwakker maken om ruis te dempen is de verkeerde ruil.
 *
 * Vals-positieven horen thuis in `allowlist.yml` onder `tokens`: dat is een
 * expliciete, gereviewde uitzondering per waarde in plaats van een categorie
 * die stilzwijgend meer doorlaat dan bedoeld.
 */

/**
 * Drempel voor base64-kandidaten die een schuine streep bevatten.
 *
 * Een pad als `Files/PostgreSQL/17/bin/pg` past exact in het base64-alfabet en
 * haalt de gewone drempel, terwijl een echte base64-sleutel duidelijk hoger
 * uitkomt. Meten aan entropie scheidt die twee zonder woordenlijst: paden
 * herhalen letters, sleutels niet.
 */
export const BASE64_PAD_DREMPEL_BITS = 4.2;

/**
 * Vanaf hoeveel tekens een base64-reeks als sleutelkandidaat telt.
 *
 * 22 en niet 24: een sleutel van 128 bits is precies 22 base64-tekens zonder
 * opvulling, en die viel onder beide eerdere drempels door.
 */
export const BASE64_MINIMUM_LENGTE = 22;

/**
 * Base64-kandidaat, met een strengere eis zodra er een schuine streep in zit.
 *
 * Zonder die extra eis vlagt het patroon elk padfragment van vierentwintig
 * tekens, en een poort die bij elk bestandspad afgaat wordt genegeerd.
 */
export // Het liggend streepje is hier een GRENS en geen woordteken. Met de gewone
// woordgrens van een regex mist `SESSION_SECRET=` het woord "secret", omdat de
// onderstreping ervoor als woordteken telt - en juist die schrijfwijze is de
// normaalvorm van een omgevingsvariabele. Dezelfde val zat eerder in de
// triggerdetectie van de poort, daar met het koppelteken.
const CREDENTIALWOORDEN =
  /(^|[^a-z0-9])(key|token|secret|password|passwd|pass|pwd|auth|credential|bearer|basic|sleutel|wachtwoord|geheim)([^a-z0-9]|$)/i;

/**
 * Ziet de regel eruit als een plek waar een credential wordt toegekend?
 *
 * Dit is het signaal dat vorm alleen niet geeft. Een base64-reeks met een
 * schuine streep is vormelijk niet te onderscheiden van een bestandspad -
 * `Files/PostgreSQL/17/bin/pg` past net zo goed als een AWS-sleutel. Wat ze wel
 * scheidt is de omgeving: een sleutel staat achter `SMTP_PASS=` of achter
 * `Authorization:`, een pad staat in een zin.
 */
export function lijktOpCredentialRegel(regel: string): boolean {
  return CREDENTIALWOORDEN.test(regel);
}

/**
 * Base64-kandidaat, met de drempel afhankelijk van de omgeving.
 *
 * Zonder schuine streep is vorm genoeg. Mét schuine streep zou een lage drempel
 * elk padfragment vlaggen, en een poort die bij elk bestandspad afgaat wordt
 * genegeerd. De uitweg is niet de drempel opschroeven - dan glipt bijna een
 * derde van de korte sleutels erdoor - maar kijken of de regel over een
 * credential gaat.
 */
/** Vormen waarin documentatie een wachtwoord aanduidt zonder er een te noemen. */
const PLAATSHOUDERS =
  /^(?:<[^>]*>|\$\{[^}]*\}|\$[A-Z_][A-Z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%|\*+|x+|\.\.\.|password|passwd|pass|pwd|wachtwoord|geheim|changeme|your[_-]?password|secret)$/i;

/**
 * Is het wachtwoorddeel van een verbindingsreeks een plaatshouder?
 *
 * `postgresql://postgres:<pw>@host` en `...:password@localhost` staan in vrijwel
 * elk runbook. Ze vlaggen levert alleen ruis op, en ruis is hoe een poort zijn
 * gezag verliest. De vorm is bovendien ondubbelzinnig genoeg om hier geen echt
 * wachtwoord mee te missen: wie `password` als wachtwoord gebruikt heeft een
 * ander probleem dan deze scanner.
 */
export function isPlaatshouderVerbinding(waarde: string): boolean {
  const match = /:\/\/[^\s:/@]+:([^\s@]+)@/.exec(waarde);
  if (!match) return false;
  return PLAATSHOUDERS.test(match[1]);
}

export function isVerdachtBase64(token: string, regel = ""): boolean {
  const credentialRegel = lijktOpCredentialRegel(regel);
  // Base64 gebruikt "+" en "/", base64url gebruikt "-" en "_". Geen enkele
  // codering gebruikt beide. Een reeks met een schuine streep EN een streepje of
  // liggend streepje is daarom geen sleutel maar vrijwel altijd een pad:
  // `db/migrations/0012_factuur_herinnering_3`. Dat is een scherper
  // onderscheid dan een entropiedrempel, die op lange paden gewoon te hoog komt.
  // Geldt ook op een credentialregel: geen codering mengt deze twee alfabetten,
  // dus een pad blijft een pad, ook wanneer het woord "secret" in de zin staat.
  const gemengdAlfabet = token.includes("/") && /[-_]/.test(token);
  if (gemengdAlfabet) return false;
  // Een slug: uitsluitend kleine letters en cijfers, met streepjes ertussen,
  // zoals `mijnapp-prod-2026-08-31`. Een base64url-sleutel van tweeentwintig
  // tekens of meer put uit tweeenzestig tekens; dat daar geen enkele hoofdletter
  // in zit, gebeurt praktisch nooit. Deze regel geldt ook op een regel die over
  // een credential gaat - juist secretsdocumentatie staat vol rotatienamen naast
  // het woord "key".
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(token)) return false;
  // Streepjes en liggende streepjes zijn wat door mensen gemaakte slugs
  // kenmerkt: `mijnapp-prod-2026-08`, `T-20260910-review-reminder`,
  // `docs/CLAUDE_ARCHIEF_2026-09-10.md`. Sleutels hebben ze zelden, en dan nog
  // alleen in base64url. Bevat de kandidaat er een, dan geldt de oude, hogere
  // lengte-eis - tenzij de regel zelf over een credential gaat.
  const heeftScheidingstekens = /[-_]/.test(token);
  const minimum = heeftScheidingstekens && !credentialRegel ? ENTROPIE_MINIMUM_LENGTE : BASE64_MINIMUM_LENGTE;
  if (!isVerdachteEntropie(token, minimum)) return false;
  if (!token.includes("/")) return true;
  if (credentialRegel) return true;
  return shannonEntropie(token) >= BASE64_PAD_DREMPEL_BITS;
}

/**
 * Vier eisen tegelijk, bewust conservatief tegen vals-positieven:
 *   1. lengte >= ENTROPIE_MINIMUM_LENGTE uit het alfabet [A-Za-z0-9_-];
 *   2. minstens één cijfer én één letter — gegenereerde sleutels en hashes
 *      hebben die mix vrijwel altijd, lange Nederlandse identifiers niet;
 *   3. geen herkenbare cryptografische hash (zie isHash);
 *   4. entropie >= ENTROPIE_DREMPEL_BITS.
 */
export function isVerdachteEntropie(token: string, minimumLengte = ENTROPIE_MINIMUM_LENGTE): boolean {
  if (token.length < minimumLengte) return false;
  // Een lange reeks cijfers is geen leesbare tekst en geen hash, maar zijn
  // entropie blijft per definitie onder de drempel (log2(10) is 3,32). Zonder
  // deze regel glipt een token van tweeendertig cijfers er altijd doorheen.
  if (/^[0-9]+$/.test(token)) return token.length >= ENTROPIE_MINIMUM_LENGTE;
  if (!/[0-9]/.test(token)) return false;
  if (!/[A-Za-z]/.test(token)) return false;
  if (isHash(token)) return false;
  return shannonEntropie(token) >= ENTROPIE_DREMPEL_BITS;
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

export type Allowlist = {
  readonly emails: readonly string[];
  readonly telefoonnummers: readonly string[];
  readonly tokens: readonly string[];
};

export const LEGE_ALLOWLIST: Allowlist = { emails: [], telefoonnummers: [], tokens: [] };

export type AllowlistResultaat =
  | { readonly ok: true; readonly allowlist: Allowlist }
  | { readonly ok: false; readonly fouten: readonly string[] };

const ALLOWLIST_SLEUTELS = ["emails", "telefoonnummers", "tokens"] as const;

const allowlistSchema = z.strictObject({
  emails: z.array(z.string().trim().min(1, "mag niet leeg zijn")),
  telefoonnummers: z.array(z.string().trim().min(1, "mag niet leeg zijn")),
  tokens: z.array(z.string().trim().min(1, "mag niet leeg zijn")),
});

/** Ontbrekende of lege sleutel telt als lege lijst; al het andere gaat naar zod. */
function normaliseerLijst(waarde: unknown): unknown {
  if (waarde === undefined || waarde === null) return [];
  return waarde;
}

/**
 * Normaliseert een telefoonnummer naar E.164-achtige vorm, zodat `06 12345678`,
 * `06-12345678` en `+31612345678` hetzelfde allowlist-item raken. Puur een
 * vergelijkingssleutel — er wordt nooit een genormaliseerde waarde geschreven.
 */
export function normaliseerTelefoon(ruw: string): string {
  const gestript = ruw.replace(/[^\d+]/g, "");
  if (gestript.startsWith("+")) return `+${gestript.replace(/\D/g, "")}`;
  if (gestript.startsWith("00")) return `+${gestript.slice(2)}`;
  if (gestript.startsWith("0")) return `+31${gestript.slice(1)}`;
  return `+${gestript}`;
}

// Losse UUID-controle voor de allowlist. Bewust een eigen constante en niet de
// patroondefinitie hieronder: deze regel moet blijven gelden ook als iemand
// ooit aan de scanvolgorde sleutelt.
const UUID_PATROON =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

function bevatUuid(waarde: string): boolean {
  return UUID_PATROON.test(waarde);
}

/**
 * Leest en valideert de allowlist.
 *
 * Hergebruikt de front-matterparser (dezelfde strikte YAML-subset als
 * jarvis.config.yml) — één parser, geen extra afhankelijkheid.
 *
 * HARDE REGEL: een UUID mag NOOIT via de allowlist worden toegestaan. Interne
 * tenant- en klant-UUID's zijn juist het gevoeligste dat in deze repo kan
 * lekken, en "even in de allowlist zetten" is precies de ontsnapping die dan
 * gebruikt zou worden. Hetzelfde geldt voor herkenbare leverancierssecrets:
 * die zijn per definitie fout, ook als iemand beweert dat ze publiek zijn.
 */
export function laadAllowlist(inhoud: string): AllowlistResultaat {
  const genormaliseerd = inhoud.replace(/\r\n/g, "\n").replace(/^\n+/, "");
  // De allowlist is een kaal YAML-document; de parser verwacht een
  // front-matterblok. Vandaar de omhulling — zelfde truc als in config.ts.
  const geparsed = parseFrontMatter(`---\n${genormaliseerd}\n---\n`);
  if (!geparsed.ok) {
    return {
      ok: false,
      // -1 omdat de omhulling met --- één regel toevoegt.
      fouten: geparsed.fouten.map(
        (f) => `${ALLOWLIST_BESTANDSNAAM}:${f.regel - 1}: ${f.boodschap}`,
      ),
    };
  }

  const onbekend = Object.keys(geparsed.data).filter(
    (sleutel) => !(ALLOWLIST_SLEUTELS as readonly string[]).includes(sleutel),
  );
  if (onbekend.length > 0) {
    return {
      ok: false,
      fouten: onbekend.map(
        (sleutel) =>
          `${ALLOWLIST_BESTANDSNAAM}: onbekende sleutel "${sleutel}" — toegestaan zijn ${ALLOWLIST_SLEUTELS.join(", ")}`,
      ),
    };
  }

  const uitkomst = allowlistSchema.safeParse({
    emails: normaliseerLijst(geparsed.data.emails),
    telefoonnummers: normaliseerLijst(geparsed.data.telefoonnummers),
    tokens: normaliseerLijst(geparsed.data.tokens),
  });
  if (!uitkomst.success) {
    return {
      ok: false,
      fouten: uitkomst.error.issues.map(
        (i) => `${ALLOWLIST_BESTANDSNAAM}: ${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    };
  }

  const fouten: string[] = [];
  for (const sleutel of ALLOWLIST_SLEUTELS) {
    uitkomst.data[sleutel].forEach((waarde, positie) => {
      const plek = `${ALLOWLIST_BESTANDSNAAM}: ${sleutel}[${positie}]`;
      // Een regel met " in " maar zonder pad erachter is bijna altijd een
      // vergeten pad, en het gevolg zou een repo-brede blinde vlek zijn. Dat is
      // te ernstig om stilzwijgend te laten passeren.
      const ontleed = ontleedTokenRegel(waarde);
      if (ontleed.pad !== null && ontleed.pad === "") {
        fouten.push(`${plek}: " in " zonder pad erachter. Schrijf het pad, of laat " in " helemaal weg.`);
        return;
      }
      if (bevatUuid(waarde)) {
        fouten.push(
          `${plek}: UUID's mogen NOOIT in de allowlist staan — interne tenant- en klant-id's horen niet in persistente Jarvis-data (gemaskeerd: ${maskeerFragment(waarde)})`,
        );
        return;
      }
      const secret = herkenLeveranciersSecret(waarde);
      if (secret !== null) {
        fouten.push(
          `${plek}: lijkt op een secret (${secret}) — secrets zijn nooit allowlistbaar (gemaskeerd: ${maskeerFragment(waarde)})`,
        );
      }
    });
  }
  if (fouten.length > 0) return { ok: false, fouten };

  // Sorteren maakt de allowlist ordeningsonafhankelijk: dezelfde items in een
  // andere volgorde leveren exact hetzelfde resultaat op.
  return {
    ok: true,
    allowlist: {
      emails: uitkomst.data.emails.map((e) => e.toLowerCase()).sort(),
      telefoonnummers: [...uitkomst.data.telefoonnummers].sort(),
      tokens: [...uitkomst.data.tokens].sort(),
    },
  };
}

// ---------------------------------------------------------------------------
// Patroondefinities
// ---------------------------------------------------------------------------

type Categorie = "secret" | "pii";

type PatroonDef = {
  readonly naam: PatroonNaam;
  readonly categorie: Categorie;
  /** Zonder vlaggen; er wordt per gebruik een verse globale kopie gemaakt. */
  readonly patroon: RegExp;
  /** Tekens die direct vóór een treffer NIET mogen staan. */
  readonly linkerGrens: RegExp;
  /** Tekens die direct ná een treffer NIET mogen staan. */
  readonly rechterGrens: RegExp;
  /**
   * Mag sanitizeTekst dit automatisch vervangen? Alleen waar de treffer met
   * zekerheid de volledige gevoelige waarde is. hoge_entropie staat bewust op
   * false: een generieke string van 32+ tekens kan net zo goed een legitieme
   * hash of build-id zijn, en automatisch overschrijven zou echte inhoud
   * beschadigen. De poort dwingt dan een MENSELIJKE keuze af — weghalen, of
   * bewust in de allowlist zetten.
   */
  readonly vervangbaar: boolean;
};

const TOKEN_GRENS = /[A-Za-z0-9_-]/;

const PATROON_DEFS: readonly PatroonDef[] = [
  {
    naam: "uuid",
    categorie: "pii",
    // Versie-onafhankelijk: 8-4-4-4-12 hex, geen aannames over versienibble of
    // variantbits. Grenzen zonder "-" zodat een UUID in een slug ook valt.
    patroon: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
    linkerGrens: /[A-Za-z0-9]/,
    rechterGrens: /[A-Za-z0-9]/,
    vervangbaar: true,
  },
  {
    naam: "supabase_secret_key",
    categorie: "secret",
    patroon: /sb_secret_[A-Za-z0-9_-]{8,}/,
    linkerGrens: TOKEN_GRENS,
    rechterGrens: TOKEN_GRENS,
    vervangbaar: true,
  },
  {
    naam: "supabase_publishable_key",
    categorie: "secret",
    patroon: /sb_publishable_[A-Za-z0-9_-]{8,}/,
    linkerGrens: TOKEN_GRENS,
    rechterGrens: TOKEN_GRENS,
    vervangbaar: true,
  },
  {
    naam: "anthropic_api_key",
    categorie: "secret",
    patroon: /sk-ant-[A-Za-z0-9_-]{16,}/,
    linkerGrens: TOKEN_GRENS,
    rechterGrens: TOKEN_GRENS,
    vervangbaar: true,
  },
  {
    naam: "openai_api_key",
    categorie: "secret",
    patroon: /sk-[A-Za-z0-9_-]{16,}/,
    linkerGrens: TOKEN_GRENS,
    rechterGrens: TOKEN_GRENS,
    vervangbaar: true,
  },
  {
    naam: "sendgrid_api_key",
    categorie: "secret",
    patroon: /SG\.[A-Za-z0-9_-]{16,}(?:\.[A-Za-z0-9_-]{16,})?/,
    linkerGrens: TOKEN_GRENS,
    rechterGrens: TOKEN_GRENS,
    vervangbaar: true,
  },
  {
    naam: "resend_api_key",
    categorie: "secret",
    // Resend-sleutels hebben twee segmenten (re_<id>_<secret>). Die vorm eisen
    // scheelt vals-positieven op identifiers als re_export_helper_functie.
    patroon: /re_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}/,
    linkerGrens: TOKEN_GRENS,
    rechterGrens: TOKEN_GRENS,
    vervangbaar: true,
  },
  {
    naam: "twilio_account_sid",
    categorie: "secret",
    patroon: /AC[0-9a-fA-F]{32}/,
    linkerGrens: TOKEN_GRENS,
    rechterGrens: TOKEN_GRENS,
    vervangbaar: true,
  },
  {
    naam: "twilio_api_key_sid",
    categorie: "secret",
    patroon: /SK[0-9a-fA-F]{32}/,
    linkerGrens: TOKEN_GRENS,
    rechterGrens: TOKEN_GRENS,
    vervangbaar: true,
  },
  {
    // Een wachtwoord in een verbindingsreeks. Dit patroon ontbrak, en het
    // wachtwoord lichtte alleen bij toeval op doordat het e-mailpatroon over
    // `gebruiker:wachtwoord@host` viel. Dat patroon wordt door de
    // voorbeeldmarkering uitgezet, dus een DATABASE_URL in een voorbeeldblok
    // gaf geen enkele bevinding. Staat bewust VOOR "email", zodat de treffer
    // hier terechtkomt en niet bij het patroon dat uitgezet kan worden.
    naam: "verbindingsreeks",
    categorie: "secret",
    patroon: /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:/@]+:[^\s@]+@[^\s/]+/,
    linkerGrens: /[A-Za-z0-9+.-]/,
    // Niet /\S/: het teken na een verbindingsreeks is doorgaans "/" (het
    // padgedeelte), en een grens die daarop aanslaat verwerpt elke treffer.
    rechterGrens: /[A-Za-z0-9.-]/,
    vervangbaar: true,
  },
  {
    naam: "email",
    categorie: "pii",
    patroon: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    linkerGrens: /[A-Za-z0-9._%+-]/,
    rechterGrens: /[A-Za-z0-9.-]/,
    vervangbaar: true,
  },
  {
    naam: "telefoon_e164",
    categorie: "pii",
    patroon: /\+\d{8,15}/,
    linkerGrens: /[\d+]/,
    rechterGrens: /\d/,
    vervangbaar: true,
  },
  {
    naam: "telefoon_nl",
    categorie: "pii",
    // 0612345678, 06 12345678 en 06-12345678.
    patroon: /06[\s-]?\d{8}/,
    linkerGrens: /[\d+]/,
    rechterGrens: /\d/,
    vervangbaar: true,
  },
  {
    // De header alleen is genoeg. Regelgebaseerd scannen ziet de body van een
    // PEM-blok als losse regels die elk onder de drempel kunnen blijven; bij
    // een 2048-bits sleutel bleven zo zeven van de achtentwintig regels
    // ongezien. De header staat er altijd, precies één keer.
    naam: "prive_sleutel",
    categorie: "secret",
    // "PGP PRIVATE KEY BLOCK" eindigt niet op "KEY", vandaar het optionele
    // staartstuk. Zonder dat viel precies dat formaat buiten de controle.
    patroon: /-----BEGIN(?:\s+[A-Z0-9]+)*\s+PRIVATE KEY(?:\s+BLOCK)?-----/,
    linkerGrens: /[A-Za-z0-9-]/,
    rechterGrens: /[A-Za-z0-9-]/,
    vervangbaar: false,
  },
  {
    naam: "hoge_entropie",
    categorie: "secret",
    patroon: /[A-Za-z0-9_-]{32,}/,
    linkerGrens: TOKEN_GRENS,
    rechterGrens: TOKEN_GRENS,
    vervangbaar: false,
  },
  {
    // Base64 met "+" en "/" viel buiten het alfabet van hoge_entropie. Een
    // AWS-secret werd daardoor in stukken onder de drempel geknipt en leverde
    // niets op. De grenzen bevatten bewust GEEN "=": anders leest
    // `SLEUTEL=<base64>` als midden-in-een-token en wordt de treffer verworpen.
    naam: "base64_geheim",
    categorie: "secret",
    patroon: /[A-Za-z0-9+/_-]{22,}={0,2}/,
    linkerGrens: /[A-Za-z0-9+/_-]/,
    rechterGrens: /[A-Za-z0-9+/_-]/,
    vervangbaar: false,
  },
];

/** bestand_onleesbaar heeft geen tekstpatroon en staat dus niet in PATROON_DEFS. */
const PATROON_VOLGORDE = new Map<PatroonNaam, number>(
  PATROON_NAMEN.map((naam, i) => [naam, i] as const),
);

function severityVan(categorie: Categorie): Severity {
  return categorie === "secret" ? "kritiek" : "hoog";
}

/**
 * Herkent een leverancierssecret in een losse waarde (zonder grens- of
 * allowlistcontrole). hoge_entropie telt hier NIET mee: dat patroon bestaat
 * juist om via `tokens` bewust te kunnen worden vrijgegeven.
 */
function herkenLeveranciersSecret(waarde: string): PatroonNaam | null {
  for (const def of PATROON_DEFS) {
    if (def.categorie !== "secret") continue;
    if (def.naam === "hoge_entropie" || def.naam === "base64_geheim") continue;
    if (new RegExp(def.patroon.source).test(waarde)) return def.naam;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Voorbeeldblokken
// ---------------------------------------------------------------------------

/**
 * Markering op de regel DIRECT vóór een fenced code block: dat blok is een
 * voorbeeld en wordt niet gescand. Bewust strikt "de regel ervoor" — een
 * markering die ergens los in een document zweeft mag nooit stilzwijgend een
 * verderop staand blok vrijstellen.
 */
export const VOORBEELD_MARKERING = "<!-- jarvis:example -->";

const FENCE = /^\s*(```|~~~)/;

/** Per regel: moet die worden overgeslagen bij scannen en vervangen? */
function bepaalOverslaan(regels: readonly string[]): readonly boolean[] {
  const overslaan = new Array<boolean>(regels.length).fill(false);
  // Gewone codeblokken worden WEL gescand, maar wel bijgehouden: anders zou een
  // markeringsregel binnen zo'n blok het volgende fence-teken kunnen kapen.
  let blok: { readonly teken: string; readonly voorbeeld: boolean } | null = null;
  let markering = false;

  for (let i = 0; i < regels.length; i += 1) {
    const regel = regels[i];
    const fence = FENCE.exec(regel);
    if (blok !== null) {
      overslaan[i] = blok.voorbeeld;
      if (fence !== null && fence[1] === blok.teken) blok = null;
      continue;
    }
    if (regel.trim() === VOORBEELD_MARKERING) {
      markering = true;
      overslaan[i] = true;
      continue;
    }
    if (fence !== null) {
      blok = { teken: fence[1], voorbeeld: markering };
      overslaan[i] = markering;
      markering = false;
      continue;
    }
    markering = false;
  }
  return overslaan;
}

// ---------------------------------------------------------------------------
// Kern: treffers zoeken
// ---------------------------------------------------------------------------

type Treffer = {
  readonly regelIndex: number;
  readonly start: number;
  readonly eind: number;
  readonly patroon: PatroonNaam;
  readonly waarde: string;
  readonly vervangbaar: boolean;
  readonly severity: Severity;
};

type AllowlistIndex = {
  readonly emails: ReadonlyMap<string, readonly (string | null)[]>;
  readonly telefoons: ReadonlyMap<string, readonly (string | null)[]>;
  /** Waarde -> padvoorvoegsels waarbinnen de uitzondering geldt ("" = overal). */
  readonly tokens: ReadonlyMap<string, readonly (string | null)[]>;
};

/**
 * Splitst een tokenregel in de waarde en het pad waarbinnen hij geldt.
 *
 * Vorm: `<waarde> in <padvoorvoegsel>`. Zonder " in " geldt de uitzondering
 * repo-breed, en dat is bijna nooit de bedoeling: een uitzondering die overal
 * geldt maakt de scanner overal blind voor die string. Een token bevat zelf
 * nooit spaties, dus de scheiding is ondubbelzinnig.
 */
export function ontleedTokenRegel(regel: string): { readonly waarde: string; readonly pad: string | null } {
  const opgeschoond = regel.trim();
  // Een regel die op " in" eindigt is een vergeten pad. YAML haalt de spatie
  // erachter weg, dus zonder deze regel valt zo'n regel terug op "geen pad" en
  // wordt de uitzondering stilzwijgend repo-breed - precies het omgekeerde van
  // wat er bedoeld werd.
  if (/\sin$/.test(opgeschoond)) {
    return { waarde: opgeschoond.replace(/\sin$/, "").trim(), pad: "" };
  }
  const knip = opgeschoond.lastIndexOf(" in ");
  if (knip < 0) return { waarde: opgeschoond, pad: null };
  return { waarde: opgeschoond.slice(0, knip).trim(), pad: opgeschoond.slice(knip + 4).trim() };
}

function bouwKaart(
  regels: readonly string[],
  normaliseer: (waarde: string) => string,
): Map<string, (string | null)[]> {
  const kaart = new Map<string, (string | null)[]>();
  for (const regel of regels) {
    const { waarde, pad } = ontleedTokenRegel(regel);
    const sleutel = normaliseer(waarde);
    const bestaand = kaart.get(sleutel) ?? [];
    bestaand.push(pad);
    kaart.set(sleutel, bestaand);
  }
  return kaart;
}

/** Padbinding geldt voor alle drie de categorieen, niet alleen voor tokens. */
function indexeer(allowlist: Allowlist): AllowlistIndex {
  return {
    emails: bouwKaart(allowlist.emails, (e) => e.trim().toLowerCase()),
    telefoons: bouwKaart(allowlist.telefoonnummers, normaliseerTelefoon),
    tokens: bouwKaart(allowlist.tokens, (t) => t.trim()),
  };
}

/**
 * UUID's en leverancierssecrets zijn NOOIT allowlistbaar. laadAllowlist weigert
 * ze al bij het inlezen; deze tweede controle staat er zodat een handmatig
 * samengesteld Allowlist-object (of een toekomstige tweede loader) de poort
 * evenmin kan omzeilen.
 */
/**
 * Past een uitzondering op DIT bestand?
 *
 * Een pad dat op "/" eindigt is een map en werkt als voorvoegsel; al het andere
 * is een bestandsnaam en moet exact kloppen. Zonder dat onderscheid dekt de
 * uitzondering `docs` ook `docs-oud/`, en dat is precies de stilzwijgende
 * verbreding waar een allowlist niet voor bedoeld is.
 *
 * Een leeg pad past nergens op. Een uitzondering zonder pad is een repo-brede
 * blinde vlek, en die mag niet ontstaan doordat iemand het padgedeelte vergat.
 */
function padPast(pad: string | null, bestand: string): boolean {
  // null = bewust geen padbeperking (een regel zonder " in "). Dat is de
  // uitzondering voor waarden die overal legitiem zijn, zoals het publieke
  // telefoonnummer van het bedrijf. Een LEEG pad bestaat niet: dat weigert de
  // loader, omdat het bijna altijd een vergeten pad is.
  if (pad === null) return true;
  // Hoofdletterongevoelig: de e-maillijst gaat bij het laden in zijn geheel
  // naar kleine letters, dus ook het padgedeelte. Het bestandssysteem hier is
  // bovendien zelf niet hoofdlettergevoelig.
  const doel = bestand.replace(/\\/g, "/").toLowerCase();
  const doelPad = pad.toLowerCase();
  return doelPad.endsWith("/") ? doel.startsWith(doelPad) : doel === doelPad;
}

function inAllowlist(kaart: ReadonlyMap<string, readonly (string | null)[]>, sleutel: string, bestand: string): boolean {
  const paden = kaart.get(sleutel);
  if (!paden) return false;
  return paden.some((pad) => padPast(pad, bestand));
}

function isToegestaan(
  naam: PatroonNaam,
  waarde: string,
  index: AllowlistIndex,
  bestand: string,
): boolean {
  switch (naam) {
    case "email":
      return inAllowlist(index.emails, waarde.toLowerCase(), bestand);
    case "telefoon_e164":
    case "telefoon_nl":
      return inAllowlist(index.telefoons, normaliseerTelefoon(waarde), bestand);
    case "verbindingsreeks":
    case "prive_sleutel":
    case "base64_geheim":
    case "hoge_entropie":
      return inAllowlist(index.tokens, waarde.trim(), bestand);
    default:
      return false;
  }
}

function overlapt(
  bereiken: readonly (readonly [number, number])[],
  start: number,
  eind: number,
): boolean {
  return bereiken.some(([a, b]) => start < b && eind > a);
}

function zoekTreffers(
  regels: readonly string[],
  overslaan: readonly boolean[],
  index: AllowlistIndex,
  bestand: string,
): readonly Treffer[] {
  const treffers: Treffer[] = [];

  for (let regelIndex = 0; regelIndex < regels.length; regelIndex += 1) {
    const regel = regels[regelIndex];
    // Een voorbeeldmarkering onderdrukt UITSLUITEND contactgegevens. Secrets en
    // identificatienummers blijven altijd scannen: een sleutel is nooit een
    // legitiem voorbeeld, en wie er een in een voorbeeldblok zet heeft juist
    // dan een poort nodig.
    const alleenContactgegevensOverslaan = overslaan[regelIndex];
    const bezet: [number, number][] = [];

    for (const def of PATROON_DEFS) {
      if (
        alleenContactgegevensOverslaan &&
        (def.naam === "email" || def.naam === "telefoon_e164" || def.naam === "telefoon_nl")
      ) {
        continue;
      }
      const zoeker = new RegExp(def.patroon.source, "g");
      let match = zoeker.exec(regel);
      while (match !== null) {
        const waarde = match[0];
        const start = match.index;
        const eind = start + waarde.length;
        if (waarde.length === 0) {
          zoeker.lastIndex = start + 1;
          match = zoeker.exec(regel);
          continue;
        }
        const linksOk = start === 0 || !def.linkerGrens.test(regel[start - 1]);
        const rechtsOk = eind >= regel.length || !def.rechterGrens.test(regel[eind]);
        // base64_geheim heeft een eigen, lagere drempel: vierentwintig tekens
        // base64 is zestien bytes, en zestien bytes is een sleutel.
        if (def.naam === "verbindingsreeks" && isPlaatshouderVerbinding(waarde)) {
          match = zoeker.exec(regel);
          continue;
        }
        const entropieOk =
          def.naam === "hoge_entropie"
            ? isVerdachteEntropie(waarde)
            : def.naam === "base64_geheim"
              ? isVerdachtBase64(waarde, regel)
              : true;

        if (linksOk && rechtsOk && entropieOk && !overlapt(bezet, start, eind)) {
          // Ook een toegestane treffer bezet zijn bereik, zodat een generieker
          // patroon dezelfde tekst niet alsnog markeert.
          bezet.push([start, eind]);
          if (!isToegestaan(def.naam, waarde, index, bestand)) {
            treffers.push({
              regelIndex,
              start,
              eind,
              patroon: def.naam,
              waarde,
              vervangbaar: def.vervangbaar,
              severity: severityVan(def.categorie),
            });
          }
        }
        match = zoeker.exec(regel);
      }
    }
  }

  // Vaste volgorde: regel, positie, patroonvolgorde. Twee identieke invoeren
  // geven zo gegarandeerd exact dezelfde uitvoer.
  return treffers.sort(
    (a, b) =>
      a.regelIndex - b.regelIndex ||
      a.start - b.start ||
      (PATROON_VOLGORDE.get(a.patroon) ?? 0) - (PATROON_VOLGORDE.get(b.patroon) ?? 0),
  );
}

function naarBevinding(treffer: Treffer, bestand: string): Bevinding {
  return {
    bestand,
    regel: treffer.regelIndex + 1,
    patroon: treffer.patroon,
    fragment: maskeerFragment(treffer.waarde),
    severity: treffer.severity,
  };
}

/** Splitst regels zonder CRLF te verliezen: \r blijft aan het regeleinde plakken. */
function splitsRegels(tekst: string): string[] {
  return tekst.split("\n");
}

// ---------------------------------------------------------------------------
// Publieke API
// ---------------------------------------------------------------------------

/**
 * Stap 2: de onafhankelijke rescan.
 *
 * Puur, zonder enige kennis van sanitizeTekst: geen gedeelde toestand, geen
 * lijst met "wat ik net vervangen heb", geen uitzondering voor placeholders.
 * Dat de placeholders hier niet oplichten is een eigenschap van hun VORM
 * (korte tokens, lage entropie), niet van een afspraak tussen beide functies.
 */
export function scanTekst(
  tekst: string,
  allowlist: Allowlist,
  bestand: string = "",
): readonly Bevinding[] {
  const regels = splitsRegels(tekst);
  const treffers = zoekTreffers(regels, bepaalOverslaan(regels), indexeer(allowlist), bestand);
  return treffers.map((t) => naarBevinding(t, bestand));
}

/**
 * Stap 1: vervangen door stabiele placeholders.
 *
 * "Stabiel" betekent: binnen één tekst krijgt dezelfde waarde altijd dezelfde
 * placeholder, en de nummering volgt de leesvolgorde. Twee keer sanitizen van
 * dezelfde invoer geeft dus letterlijk hetzelfde resultaat.
 *
 * De placeholdervorm gebruikt dubbele punten als scheiding en geen underscores:
 * daarmee blijft elk deel korter dan ENTROPIE_MINIMUM_LENGTE en kan de rescan
 * een placeholder nooit voor een hoge-entropiestring aanzien.
 */
export function sanitizeTekst(
  tekst: string,
  allowlist: Allowlist,
  bestand: string = "",
): { tekst: string; vervangingen: readonly Bevinding[] } {
  const regels = splitsRegels(tekst);
  const treffers = zoekTreffers(regels, bepaalOverslaan(regels), indexeer(allowlist), bestand);

  const nummers = new Map<string, number>();
  const tellerPerPatroon = new Map<PatroonNaam, number>();
  const vervangingen: Bevinding[] = [];
  const perRegel = new Map<number, Treffer[]>();

  for (const treffer of treffers) {
    if (!treffer.vervangbaar) continue;
    const sleutel = `${treffer.patroon}\u0000${treffer.waarde}`;
    if (!nummers.has(sleutel)) {
      const volgende = (tellerPerPatroon.get(treffer.patroon) ?? 0) + 1;
      tellerPerPatroon.set(treffer.patroon, volgende);
      nummers.set(sleutel, volgende);
    }
    const lijst = perRegel.get(treffer.regelIndex);
    if (lijst === undefined) perRegel.set(treffer.regelIndex, [treffer]);
    else lijst.push(treffer);
    vervangingen.push(naarBevinding(treffer, bestand));
  }

  const nieuweRegels = [...regels];
  for (const [regelIndex, lijst] of perRegel) {
    let regel = nieuweRegels[regelIndex];
    // Van rechts naar links, anders schuiven de posities op.
    for (const treffer of [...lijst].sort((a, b) => b.start - a.start)) {
      const nummer = nummers.get(`${treffer.patroon}\u0000${treffer.waarde}`) ?? 0;
      const placeholder = `[[GEREDIGEERD:${treffer.patroon}:${nummer}]]`;
      regel = `${regel.slice(0, treffer.start)}${placeholder}${regel.slice(treffer.eind)}`;
    }
    nieuweRegels[regelIndex] = regel;
  }

  return { tekst: nieuweRegels.join("\n"), vervangingen };
}

/** Leest een bestand; null betekent "niet leesbaar". Sync of async mag. */
export type LeesBestand = (pad: string) => Promise<string | null> | string | null;
/** Schrijft een bestand. Sync of async mag. */
export type SchrijfBestand = (pad: string, inhoud: string) => Promise<void> | void;

export type SanitizeResultaat = {
  /** true zodra de onafhankelijke rescan over ALLE paden niets meer vindt. */
  readonly ok: boolean;
  readonly bevindingen: readonly Bevinding[];
  /** Paden waarvan de inhoud daadwerkelijk is aangepast, in invoervolgorde. */
  readonly gewijzigd: string[];
};

/**
 * Stap 3: de poort over een lijst bestanden.
 *
 * `paden` zijn CONCRETE bestandspaden, geen mappen: deze functie doet zelf geen
 * I/O en kan dus niet wandelen. De aanroeper vertaalt `sanitize_paden` uit
 * jarvis.config.yml naar bestanden — de engine leest die configuratie hier
 * bewust niet zelf in.
 *
 * Per bestand: lezen, sanitizen, bij wijziging schrijven, en dan OPNIEUW
 * scannen met scanTekst op wat er nu staat. Alleen die tweede scan bepaalt
 * `ok`; de vervangingen uit stap 1 zijn geen bevindingen.
 */
export async function sanitizeBestanden(
  paden: readonly string[],
  leesBestand: LeesBestand,
  schrijfBestand: SchrijfBestand,
  allowlist: Allowlist,
): Promise<SanitizeResultaat> {
  const bevindingen: Bevinding[] = [];
  const gewijzigd: string[] = [];

  for (const pad of paden) {
    const origineel = await leesBestand(pad);
    if (origineel === null) {
      bevindingen.push({
        bestand: pad,
        regel: 0,
        patroon: "bestand_onleesbaar",
        fragment: "",
        severity: "hoog",
      });
      continue;
    }

    const gesanitized = sanitizeTekst(origineel, allowlist, pad);
    if (gesanitized.tekst !== origineel) {
      await schrijfBestand(pad, gesanitized.tekst);
    }

    // De rescan leest het bestand OPNIEUW en scant wat daar staat.
    //
    // Niet `gesanitized.tekst`: dat was de eigen uitvoer van stap 1, en die
    // rescannen is geen onafhankelijke uitspraak maar een echo. Erger nog, het
    // was een gat. De poort draait in CI bewust zonder `--schrijf`, waar de
    // schrijffunctie niets doet; de rescan keek dan naar een geredigeerde
    // tekst die nergens bestond, terwijl het bestand op schijf het secret nog
    // gewoon bevatte. Elk patroon dat automatisch vervangen kan worden - dertien
    // van de zestien, inclusief alle leverancierssleutels - was daardoor
    // onzichtbaar in precies de stand waarin de poort draait.
    //
    // Opnieuw lezen dekt beide standen zonder onderscheid: zonder `--schrijf`
    // komt het origineel terug, met `--schrijf` de geredigeerde tekst.
    const opSchijf = await leesBestand(pad);
    if (opSchijf === null) {
      bevindingen.push({
        bestand: pad,
        regel: 0,
        patroon: "bestand_onleesbaar",
        fragment: "",
        severity: "hoog",
      });
      continue;
    }
    // Pas hier melden dat er iets gewijzigd is. Of de schrijffunctie werkelijk
    // schrijft weet deze laag niet - zonder --schrijf doet hij niets - en een
    // lijst "geredigeerde bestanden" die bestanden noemt die ongemoeid bleven,
    // is een verkeerde geruststelling.
    if (opSchijf !== origineel) gewijzigd.push(pad);
    bevindingen.push(...scanTekst(opSchijf, allowlist, pad));
  }

  return { ok: bevindingen.length === 0, bevindingen, gewijzigd };
}
