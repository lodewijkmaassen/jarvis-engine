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
  "email",
  "telefoon_e164",
  "telefoon_nl",
  "hoge_entropie",
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
 * Drie eisen tegelijk, bewust conservatief tegen vals-positieven:
 *   1. lengte >= ENTROPIE_MINIMUM_LENGTE uit het alfabet [A-Za-z0-9_-];
 *   2. minstens één cijfer én één letter — gegenereerde sleutels en hashes
 *      hebben die mix vrijwel altijd, lange Nederlandse identifiers niet;
 *   3. entropie >= ENTROPIE_DREMPEL_BITS.
 */
export function isVerdachteEntropie(token: string): boolean {
  if (token.length < ENTROPIE_MINIMUM_LENGTE) return false;
  if (!/[0-9]/.test(token)) return false;
  if (!/[A-Za-z]/.test(token)) return false;
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
    naam: "hoge_entropie",
    categorie: "secret",
    patroon: /[A-Za-z0-9_-]{32,}/,
    linkerGrens: TOKEN_GRENS,
    rechterGrens: TOKEN_GRENS,
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
    if (def.categorie !== "secret" || def.naam === "hoge_entropie") continue;
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
  readonly emails: ReadonlySet<string>;
  readonly telefoons: ReadonlySet<string>;
  readonly tokens: ReadonlySet<string>;
};

function indexeer(allowlist: Allowlist): AllowlistIndex {
  return {
    emails: new Set(allowlist.emails.map((e) => e.trim().toLowerCase())),
    telefoons: new Set(allowlist.telefoonnummers.map((t) => normaliseerTelefoon(t))),
    tokens: new Set(allowlist.tokens.map((t) => t.trim())),
  };
}

/**
 * UUID's en leverancierssecrets zijn NOOIT allowlistbaar. laadAllowlist weigert
 * ze al bij het inlezen; deze tweede controle staat er zodat een handmatig
 * samengesteld Allowlist-object (of een toekomstige tweede loader) de poort
 * evenmin kan omzeilen.
 */
function isToegestaan(naam: PatroonNaam, waarde: string, index: AllowlistIndex): boolean {
  switch (naam) {
    case "email":
      return index.emails.has(waarde.toLowerCase());
    case "telefoon_e164":
    case "telefoon_nl":
      return index.telefoons.has(normaliseerTelefoon(waarde));
    case "hoge_entropie":
      return index.tokens.has(waarde);
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
): readonly Treffer[] {
  const treffers: Treffer[] = [];

  for (let regelIndex = 0; regelIndex < regels.length; regelIndex += 1) {
    if (overslaan[regelIndex]) continue;
    const regel = regels[regelIndex];
    const bezet: [number, number][] = [];

    for (const def of PATROON_DEFS) {
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
        const entropieOk = def.naam !== "hoge_entropie" || isVerdachteEntropie(waarde);

        if (linksOk && rechtsOk && entropieOk && !overlapt(bezet, start, eind)) {
          // Ook een toegestane treffer bezet zijn bereik, zodat een generieker
          // patroon dezelfde tekst niet alsnog markeert.
          bezet.push([start, eind]);
          if (!isToegestaan(def.naam, waarde, index)) {
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
  const treffers = zoekTreffers(regels, bepaalOverslaan(regels), indexeer(allowlist));
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
  const treffers = zoekTreffers(regels, bepaalOverslaan(regels), indexeer(allowlist));

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
      gewijzigd.push(pad);
    }

    // Onafhankelijke rescan op de tekst zoals die er nu staat.
    bevindingen.push(...scanTekst(gesanitized.tekst, allowlist, pad));
  }

  return { ok: bevindingen.length === 0, bevindingen, gewijzigd };
}
