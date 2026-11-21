// De functionele acceptatietest van een doel: lezen wat de eigenaar vraagt,
// het daadwerkelijk uitvoeren tegen productie, en het oordeel door een ander
// model laten vellen dan het model dat bouwde.
//
// WAAROM DIT BESTAAT
//
// Een doel ging naar klaar zodra de acceptatie-URL een bouwmerk droeg, en als
// er geen URL in het doel stond zelfs meteen ("het doel noemt geen
// acceptatie-URL om te meten"). Een opdracht die in woorden een acceptatietest
// voorschreef — "stel deze vraag aan de live AI Core en controleer het
// antwoord" — werd dus nooit uitgevoerd. Gemeten op 2026-11-06 aan
// D-20261021-161119608: drie expliciete tests, nul uitgevoerd.
//
// Dit bestand is de pure kant: de tests uit de opdracht halen, bepalen of ze
// toetsbaar zijn, de vraag aan de beoordelaar bouwen en zijn antwoord lezen.
// Het uitvoeren (HTTP, database, model) staat in doelen-cli.ts.
//
// EEN TEST DIE MORGEN IETS ANDERS MEET, MEET NIETS
//
// "Welke taak is het meest recent vastgelopen" hangt af van welke taak
// toevallig het laatst vastliep; dezelfde test geeft morgen een ander
// antwoord en is dan niet te herhalen. Zulke tests worden hier als
// onbepaalbaar gemeld (`volatiel`), met de reden en wat eraan moet veranderen:
// noem het onderwerp (een doel-id, een pull request, een URL). De eigenaar
// hoeft daar niets voor te doen; het is een opdracht die scherper moet.

/** Wat een acceptatietest meet. */
export type AcceptatieSoort =
  /** Een adres ophalen en op inhoud beoordelen. */
  | "http"
  /** Een vraag aan de AI Core van Jarvis, waarna het antwoord wordt beoordeeld. */
  | "aivraag"
  /** Een vraag aan de database (de administratie van Jarvis zelf). */
  | "sql"
  /** Geen eigen meting: het bewijs dat de keten zelf heeft vastgelegd wordt beoordeeld. */
  | "bewijs";

export type AcceptatieTest = {
  /** "A", "B", "1" — zoals de eigenaar hem noemde. */
  readonly id: string;
  readonly soort: AcceptatieSoort;
  /** De tekst van de test, letterlijk uit de opdracht. */
  readonly tekst: string;
  /** Bij soort "aivraag": de vraag zelf, tussen aanhalingstekens in de opdracht. */
  readonly vraag: string | null;
  /** Bij soort "http": het adres. */
  readonly url: string | null;
  /** Het onderwerp waar de test over gaat, als de opdracht dat vastlegt (doel-id, pull request). */
  readonly onderwerp: string | null;
  /** Hangt de uitkomst af van wat er toevallig het laatst gebeurde? Dan is de test niet te herhalen. */
  readonly volatiel: boolean;
};

// Een eigenaar schrijft "Acceptatietests:" maar ook "## 6. Acceptatiecriteria". Beide zijn een expliciete
// sectie; de tweede werd niet herkend, waardoor D-20261107-225515647 met zes criteria op klaar ging
// zonder dat er één was gemeten ("het doel noemt geen ... expliciete acceptatietest").
const KOP = /^\s*(?:#+\s*)?(?:\d{1,2}[.)]\s*)?(?:functionele\s+)?acceptatie(?:tests?|criteri(?:a|um))\b[^\n]*$/im;
// Een volgende markdownkop sluit de sectie ook af: anders lopen de genummerde punten van een latere sectie mee.
const EINDE = /^\s*(?:#{1,6}\s|markeer|reactie van de eigenaar|\(waar het eerder vastliep|voorkom |bouw hiervoor|gebruik de bestaande)/i;
const ITEM = /^\s*(?:\*\*)?([A-Z]|\d{1,2})(?:\*\*)?[.)]\s+(.*)$/;
const VOLATIEL = /\b(meest recent\w*|recentste|als laatste|het laatst|laatst\s+vastgelopen|zojuist|toevallig|op dit moment|vandaag|gisteren|nu loopt)\b/i;
// Zonder woordgrens aan het begin: `#` is geen woordteken, dus `#106` matcht nooit.
const ONDERWERP = /(D-\d{8}-\d{6,9}|#\d{1,5})\b/;
const URL = /\bhttps?:\/\/[^\s)"'<>]+/;
// Een vraag staat tussen aanhalingstekens: typografisch (“…”, „…”, «…») of recht ("…"). Twee
// alternatieven, zodat een rechte aanhaling niet door de typografische klasse wordt afgesloten.
const VRAAG = /[“„«]([^“”„»]{8,400})[”»]|"([^"]{8,400})"/;

/**
 * De acceptatietests uit de opdracht van een doel.
 *
 * Alleen een expliciete sectie telt ("Acceptatietests:", "Acceptatietest voor
 * deze opdracht"): een opdracht die ergens het woord "test" gebruikt, krijgt
 * er geen test bij die de eigenaar niet heeft gevraagd. Staat er geen sectie,
 * dan is de lijst leeg en meet de keten zoals ze altijd deed.
 */
export function leesAcceptatieTests(opdracht: string): readonly AcceptatieTest[] {
  const tekst = opdracht.replace(/\r\n/g, "\n");
  const kop = KOP.exec(tekst);
  if (kop === null) return [];
  const regels = tekst.slice(kop.index + kop[0].length).split("\n");
  const blokken: { id: string; regels: string[] }[] = [];
  for (const regel of regels) {
    const m = ITEM.exec(regel);
    if (m !== null) {
      blokken.push({ id: m[1]!, regels: [m[2]!] });
      continue;
    }
    if (blokken.length === 0) continue;
    if (EINDE.test(regel)) break;
    blokken[blokken.length - 1]!.regels.push(regel);
  }
  const tests: AcceptatieTest[] = [];
  for (const blok of blokken) {
    const body = blok.regels.join("\n").trim();
    if (body.length === 0) continue;
    const url = URL.exec(body)?.[0] ?? null;
    const vraagM = VRAAG.exec(body);
    const vraag = (vraagM?.[1] ?? vraagM?.[2] ?? null)?.trim() ?? null;
    const noemtAiCore = /\bai[- ]?core\b/i.test(body);
    const soort: AcceptatieSoort =
      noemtAiCore && vraag !== null ? "aivraag" : url !== null ? "http" : /\b(database|migratie|sql|tabel|ledger|kolom)\b/i.test(body) ? "sql" : "bewijs";
    tests.push({
      id: blok.id,
      soort,
      tekst: body,
      vraag: soort === "aivraag" ? vraag : null,
      url: soort === "http" ? url : null,
      onderwerp: ONDERWERP.exec(body)?.[1] ?? null,
      volatiel: VOLATIEL.test(body) && ONDERWERP.exec(body) === null,
    });
  }
  return tests;
}

/** Eén regel die zegt wat er aan een onbepaalbare test moet veranderen. */
export function volatielBezwaar(test: AcceptatieTest): string {
  return (
    `acceptatietest ${test.id} hangt af van wat er toevallig het laatst gebeurde en is daarom niet te herhalen. ` +
    `Noem het onderwerp waar de test over gaat (een doel-id als D-JJJJMMDD-nnnnnn, een pull request als #123, of een adres), ` +
    `dan meet dezelfde test morgen hetzelfde.`
  );
}

/**
 * Wat één test opleverde. Drie uitkomsten en niet twee, omdat "niet gemeten"
 * iets anders is dan "gemeten en niet gehaald":
 *
 *   geslaagd       het bewijs haalt wat de test eist;
 *   niet-geslaagd  het bewijs haalt het niet — werk voor de uitvoerder, de
 *                  bestaande herstelketen pakt het op;
 *   niet-meetbaar  de test kon niet worden uitgevoerd (een deur, een recht of
 *                  een leesrecht ontbreekt). Dat is geen mislukt werk maar een
 *                  ontbrekende bevoegdheid: het doel wordt er niet klaar van,
 *                  en de uitvoerder heeft er niets te herstellen.
 *
 * Alle drie houden een doel tegen; waar het doel daarna heen gaat, is het
 * verschil. Ze samennemen zette een doel vast op iets wat niemand hoefde te
 * beslissen — precies de verwarring die deze keten moest oplossen.
 */
export const ACCEPTATIE_UITKOMSTEN = ["geslaagd", "niet-geslaagd", "niet-meetbaar"] as const;
export type AcceptatieStaat = (typeof ACCEPTATIE_UITKOMSTEN)[number];

export type AcceptatieUitkomst = {
  readonly id: string;
  readonly staat: AcceptatieStaat;
  /** Het bewijs is wat er werkelijk is gemeten, niet een samenvatting ervan. */
  readonly bewijs: string;
  /** De reden van de beoordelaar, of van de meting zelf. */
  readonly reden: string;
};

export const BEOORDELAAR_SYSTEEM =
  "Je beoordeelt één functionele acceptatietest van een softwaretaak. Je krijgt de test zoals de eigenaar hem schreef en het " +
  "bewijs dat de uitvoering heeft opgeleverd. Werk in het Nederlands. Beoordeel uitsluitend op het bewijs: staat er niet in wat de " +
  "test eist, dan is de test niet geslaagd — ook niet 'waarschijnlijk wel'. Een antwoord dat de gevraagde feiten niet noemt, is niet " +
  "geslaagd. Verzin geen feiten en vul niets aan uit eigen kennis. Toets precies wat de test eist en niet meer: een eis die de " +
  "test niet stelt, voeg je er niet aan toe. Wat als gegeven in het bewijs staat, is daarmee aangetoond: een regel uit een tabel " +
  "telt als bewijs van die regel, ook als geen enkele zin haar nog eens samenvat of benoemt. Stelt de test meer dan één eis, " +
  "loop ze dan één voor één langs en wijs per eis de regel uit het bewijs aan die haar aantoont, of zeg welke regel ontbreekt. " +
  "Antwoord uitsluitend met één JSON-object, zonder tekst eromheen: " +
  '{"geslaagd": true|false, "reden": "<één of twee zinnen, concreet, met wat wel en niet in het bewijs staat>"}';

/**
 * Zoveel van het bewijs gaat mee. Ruimer dan de 24.000 waarmee dit begon: het bewijs draagt
 * sinds 2026-11-07 de feiten die een test noemt, en de afkapping viel toen midden in de historie
 * van het onderwerp — de beoordelaar meldde een "afgekapt overzicht" van de historie van #106 en
 * zakte daarop, terwijl die historie zeven regels is. Het onderwerp staat nu vooraan in het
 * bewijs én de grens ligt ruimer; wat als eerste wegvalt zijn de algemene lijsten achteraan.
 */
export const BEWIJS_TEKENS = 30_000;

/** Zoveel van de opdracht gaat als context mee; genoeg voor waar een test naar verwijst. */
export const OPDRACHT_CONTEXT_TEKENS = 8_000;

/**
 * De vraag aan de onafhankelijke beoordelaar: de test, en wat de uitvoering werkelijk opleverde.
 *
 * De opdracht gaat als context mee, en alleen als context. Een test verwijst
 * ernaar zonder het te herhalen — "controleer dat de eerder ontbrekende SQL is
 * toegepast" is zonder de opdracht niet te beantwoorden, want daar staat wélke
 * SQL dat is. Gemeten op 2026-11-07 aan D-20261021-161119608: dezelfde
 * beoordelaar zakte op hetzelfde bewijs zonder die context en slaagde ermee.
 * Het oordeel blijft over de test en blijft op het bewijs; de opdracht is er om
 * te kunnen lezen waar de test over gaat.
 */
export function bouwBeoordelingsVraag(test: AcceptatieTest, bewijs: string, opdracht: string | null = null): string {
  const context = (opdracht ?? "").trim();
  return [
    `# Acceptatietest ${test.id}`,
    "",
    test.tekst,
    "",
    ...(context === ""
      ? []
      : [
          "# De opdracht waar deze test bij hoort",
          "",
          "Alleen als context, om te kunnen zien waar de test naar verwijst. Je beoordeelt uitsluitend de test hierboven, en uitsluitend op het bewijs hieronder.",
          "",
          context.length > OPDRACHT_CONTEXT_TEKENS ? `${context.slice(0, OPDRACHT_CONTEXT_TEKENS)}\n… [afgekapt]` : context,
          "",
        ]),
    "# Wat de uitvoering heeft opgeleverd (het bewijs)",
    "",
    bewijs.length > BEWIJS_TEKENS ? `${bewijs.slice(0, BEWIJS_TEKENS)}\n… [afgekapt]` : bewijs,
    "",
    "# Je oordeel",
    "",
    "Haalt het bewijs alles wat de test eist? Antwoord met het JSON-object.",
  ].join("\n");
}

/** Het oordeel van de beoordelaar; onleesbaar is niet geslaagd. */
export function parseerBeoordeling(tekst: string): { readonly geslaagd: boolean; readonly reden: string } {
  let t = tekst.trim();
  const hek = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  if (hek !== null) t = hek[1]!;
  const haak = t.indexOf("{");
  const sluit = t.lastIndexOf("}");
  if (haak >= 0 && sluit > haak) t = t.slice(haak, sluit + 1);
  try {
    const r = JSON.parse(t) as { geslaagd?: unknown; reden?: unknown };
    const geslaagd = r.geslaagd === true;
    const reden = typeof r.reden === "string" && r.reden.trim() !== "" ? r.reden.trim() : geslaagd ? "geslaagd" : "geen reden gegeven";
    return { geslaagd, reden: reden.slice(0, 600) };
  } catch {
    return { geslaagd: false, reden: `het oordeel is niet te lezen: ${t.slice(0, 200)}` };
  }
}

/**
 * Het eindoordeel over een doel: alleen klaar als elke test is uitgevoerd en
 * geslaagd. Eén test die het niet haalt of niet te meten was, houdt het doel
 * tegen; dat is het hele punt. `onmeetbaar` zegt waar het daarna heen moet —
 * naar de bevoegdheid die ontbreekt, niet naar de uitvoerder.
 */
export function eindoordeel(uitkomsten: readonly AcceptatieUitkomst[]): {
  readonly klaar: boolean;
  readonly onmeetbaar: boolean;
  readonly samenvatting: string;
} {
  // Geen enkele meting is geen bewijs. Stond hier `klaar: true`, en dat was precies de weg waarlangs een
  // samengevoegd doel zonder acceptatietest klaar heette (D-20261115-095941788).
  if (uitkomsten.length === 0) return { klaar: false, onmeetbaar: true, samenvatting: "er is geen enkele acceptatietest uitgevoerd; zonder meting is er geen bewijs" };
  const regels = uitkomsten.map((u) => `${u.id}: ${u.staat} — ${u.reden}`);
  return {
    klaar: uitkomsten.every((u) => u.staat === "geslaagd"),
    onmeetbaar: uitkomsten.some((u) => u.staat === "niet-meetbaar"),
    samenvatting: regels.join(" | ").slice(0, 1800),
  };
}

/** De id van de test die de keten zelf afleidt als de opdracht er geen noemt. */
export const AFGELEIDE_TEST_ID = "eindresultaat";

/**
 * De acceptatietest die de keten zelf afleidt uit de opdracht, als de eigenaar er geen schreef.
 *
 * WAAROM DIT BESTAAT
 *
 * Een doel zonder expliciete acceptatietest ging naar klaar zodra de pull request was samengevoegd
 * (en de pagina, als er een acceptatie-URL was, een bouwmerk droeg). De uitkomst luidde letterlijk
 * "samengevoegd; het doel noemt geen acceptatie-URL en geen expliciete acceptatietest". Gemeten op
 * 2026-11-13/14 aan D-20261107-225515647: drie keer heropend door de eigenaar, drie keer binnen een
 * kwartier weer klaar op exact dezelfde grond — een technische tussenstap die als eindresultaat gold.
 *
 * Een ontbrekend criterium is geen reden om níet te meten maar om het af te leiden: het eindresultaat
 * dat de opdracht beschrijft ís het criterium. De beoordelaar (een ander model dan de bouwer) krijgt de
 * opdracht als context en toetst het bewijs eraan. Een samenvoeging, een uitrol of een HTTP 200 telt
 * daarbij uitdrukkelijk niet als bewijs.
 */
export function afgeleideAcceptatieTest(d: {
  readonly acceptatie_url: string | null;
  readonly pr: { readonly nummer?: number } | null;
}): AcceptatieTest {
  const url = (d.acceptatie_url ?? "").trim();
  const tekst = [
    "Het beoogde eindresultaat van de opdracht is aantoonbaar bereikt. De opdracht noemt zelf geen acceptatietest;",
    "leid de eisen af uit de opdracht (het gewenste eindresultaat en de acceptatie die zij beschrijft) en toets elke eis aan het bewijs.",
    "Een samengevoegde pull request, een geslaagde uitrol, een groene build of een HTTP 200 is op zichzelf GEEN bewijs:",
    "het bewijs moet laten zien dat wat de opdracht vraagt werkelijk bestaat of werkt (de inhoud van de pagina, de gewijzigde code",
    "en de tests die het gedrag aantonen). Ontbreekt dat voor een wezenlijke eis, dan is de test niet geslaagd.",
  ].join(" ");
  const nummer = d.pr?.nummer;
  return {
    id: AFGELEIDE_TEST_ID,
    soort: url !== "" ? "http" : "bewijs",
    tekst,
    vraag: null,
    url: url !== "" ? url : null,
    onderwerp: typeof nummer === "number" && Number.isInteger(nummer) && nummer > 0 ? `#${nummer}` : null,
    volatiel: false,
  };
}

/**
 * De tests waarop een doel wordt afgemaakt: die de eigenaar schreef, of anders de afgeleide.
 * Nooit leeg — daarmee is er geen weg meer naar klaar zonder meting.
 */
export function testsVoorDoel(d: {
  readonly opdracht: string;
  readonly acceptatie_url: string | null;
  readonly pr: { readonly nummer?: number } | null;
}): readonly AcceptatieTest[] {
  const expliciet = leesAcceptatieTests(d.opdracht);
  return expliciet.length > 0 ? expliciet : [afgeleideAcceptatieTest(d)];
}

/**
 * Zoveel tekens van de inhoud van de pull request gaan als bewijs mee; de rest van het bewijs blijft passen.
 * Het blok staat vooraan in het bewijs (dat als geheel op BEWIJS_TEKENS wordt afgekapt), dus dit is wat de
 * beoordelaar in elk geval ziet.
 */
export const PR_BEWIJS_TEKENS = 20_000;

/** Wat elk bestand minstens krijgt, ook als er veel bestanden zijn: genoeg om te zien wát er verandert. */
const MIN_DIFF_PER_BESTAND = 400;

/**
 * Verdeelt een budget eerlijk over de diffs: een kleine diff gaat er helemaal in, wat hij overlaat gaat naar
 * de grotere. Stond hier eerst een vaste 1500 tekens per bestand, en daarmee zag de beoordelaar van
 * D-20261117-194518764 (Ideeën) alleen de navigatieregel van een diff van 7000 tekens, en van de test alleen
 * de eerste helft — terwijl het hele bewijs ruim binnen het budget paste. Gezakt op "afgekapt", niet op het werk.
 */
export function verdeelDiffBudget(lengtes: readonly number[], budget: number): number[] {
  const toegewezen = lengtes.map(() => 0);
  let open = lengtes.map((_, i) => i).filter((i) => lengtes[i]! > 0);
  let over = Math.max(0, budget);
  while (open.length > 0 && over > 0) {
    const deel = Math.floor(over / open.length);
    if (deel === 0) break;
    const nogOpen: number[] = [];
    for (const i of open) {
      const nodig = lengtes[i]! - toegewezen[i]!;
      const krijgt = Math.min(nodig, deel);
      toegewezen[i]! += krijgt;
      over -= krijgt;
      if (toegewezen[i]! < lengtes[i]!) nogOpen.push(i);
    }
    open = nogOpen;
  }
  return toegewezen.map((t, i) => Math.min(lengtes[i]!, Math.max(t, Math.min(lengtes[i]!, MIN_DIFF_PER_BESTAND))));
}

/** Eén commit zoals de GitHub-API hem geeft, teruggebracht tot wat het bewijs nodig heeft. */
export interface DoelCommit {
  readonly sha: string;
  readonly bericht: string;
  readonly ouders: number;
  readonly bestanden: readonly { readonly naam: string; readonly status: string; readonly erbij: number; readonly eraf: number; readonly patch: string | null }[];
}

/** Draagt deze commit de trailer van dit doel? Een samenvoeging (twee ouders) telt niet: die herhaalt alleen. */
export function isCommitVanDoel(c: { readonly bericht: string; readonly ouders: number }, doelId: string): boolean {
  if (c.ouders > 1) return false;
  const esc = doelId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^Jarvis-Task:\\s*${esc}\\s*$`, "m").test(c.bericht);
}

/**
 * Het werk van een heel doel, over al zijn pull requests heen: de commits met zijn trailer, oudste eerst,
 * per bestand samengevoegd. Een doel dat na een gezakte acceptatietest met een tweede pull request wordt
 * hersteld, wijst daarna naar die tweede samenvoeging; zonder dit blok zag de beoordelaar alleen het herstel
 * en niet meer het werk waar de opdracht om vroeg.
 */
export function werkVanDoel(
  doelId: string,
  commits: readonly DoelCommit[],
): { readonly naam: string; readonly status: string; readonly erbij: number; readonly eraf: number; readonly patch: string | null }[] {
  const per = new Map<string, { naam: string; status: string; erbij: number; eraf: number; patches: string[] }>();
  for (const c of commits) {
    if (!isCommitVanDoel(c, doelId)) continue;
    for (const b of c.bestanden) {
      const al = per.get(b.naam);
      if (al === undefined) {
        per.set(b.naam, { naam: b.naam, status: b.status, erbij: b.erbij, eraf: b.eraf, patches: b.patch ? [b.patch] : [] });
      } else {
        al.erbij += b.erbij;
        al.eraf += b.eraf;
        if (b.patch) al.patches.push(b.patch);
      }
    }
  }
  return [...per.values()].map((b) => ({
    naam: b.naam,
    status: b.status,
    erbij: b.erbij,
    eraf: b.eraf,
    patch: b.patches.length === 0 ? null : b.patches.join("\n"),
  }));
}

/**
 * Het werk van een doel in een tweede repository: de engine. Een doel in een project dat de engine
 * gebruikt, wordt vaak in de engine gebouwd; de pull request in het project werkt dan alleen de
 * engine-pin bij. Wie alleen die pull request leest, ziet twee regels in package.json en niet wat er
 * gebouwd is — en kan het eindresultaat dus niet toetsen. Gelezen wordt tot en met de pin die het
 * project nu draagt, zodat alleen werk meetelt dat werkelijk in het project zit.
 */
export function leesEngineWerkMee(repo: string, engineRepo: string | null, pin: string | null): boolean {
  const r = repo.trim().toLowerCase();
  const e = (engineRepo ?? "").trim().toLowerCase();
  return r !== "" && e !== "" && r !== e && (pin ?? "").trim() !== "";
}

/** Bestanden uit een andere repository krijgen die repository voor hun naam, zodat het bewijs niet verwart. */
export function metHerkomst<T extends { readonly naam: string }>(repo: string, bestanden: readonly T[]): T[] {
  return bestanden.map((b) => ({ ...b, naam: `${repo}: ${b.naam}` }));
}

/**
 * Wat de pull request van een doel werkelijk verandert, als bewijsblok: titel, beschrijving en de
 * gewijzigde bestanden met het begin van hun diff. Zonder dit blok zag de beoordelaar bij een doel
 * zonder acceptatie-URL alleen de administratie (wie samenvoegde, wanneer) en nooit wát er gebouwd is
 * — en dan valt een functioneel eindresultaat niet te toetsen.
 */
export function bouwPrBewijs(
  pr: { readonly repo: string; readonly nummer: number; readonly titel: string; readonly tekst: string },
  bestanden: readonly { readonly naam: string; readonly status: string; readonly erbij: number; readonly eraf: number; readonly patch: string | null }[],
  /** Waar dit blok vandaan komt; standaard de pull request zelf. */
  herkomst: string | null = null,
): string {
  const kop = [
    herkomst ?? `inhoud van pull request ${pr.repo}#${pr.nummer} (zojuist gelezen via de GitHub-API):`,
    `titel: ${pr.titel}`,
    `beschrijving:\n${pr.tekst.trim().slice(0, 3000) || "(leeg)"}`,
    `gewijzigde bestanden (${bestanden.length}):`,
    ...bestanden.map((b) => `- ${b.naam} (${b.status}, +${b.erbij} -${b.eraf})`),
  ].join("\n");
  const metDiff = bestanden.filter((b) => b.patch !== null && b.patch !== "");
  // Het budget voor de diffs is wat er na de kop en de koppen per bestand over is; eerlijk verdeeld.
  const vast = kop.length + 40 + metDiff.reduce((n, b) => n + b.naam.length + 100, 0);
  const ruimte = verdeelDiffBudget(metDiff.map((b) => (b.patch ?? "").length), PR_BEWIJS_TEKENS - vast);
  const diffs = metDiff
    .map((b, i) => {
      const patch = b.patch ?? "";
      const n = ruimte[i]!;
      return `--- ${b.naam}\n${n >= patch.length ? patch : `${patch.slice(0, n)}\n… [diff van dit bestand afgekapt na ${n} van ${patch.length} tekens]`}`;
    })
    .join("\n");
  const geheel = diffs === "" ? kop : `${kop}\n\ndiff per bestand:\n${diffs}`;
  return geheel.length > PR_BEWIJS_TEKENS ? `${geheel.slice(0, PR_BEWIJS_TEKENS)}\n… [afgekapt]` : geheel;
}
