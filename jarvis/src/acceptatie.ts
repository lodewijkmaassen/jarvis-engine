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

const KOP = /^\s*(?:##+\s*)?(?:functionele\s+)?acceptatietests?\b[^\n]*$/im;
const EINDE = /^\s*(?:markeer|reactie van de eigenaar|\(waar het eerder vastliep|voorkom |bouw hiervoor|gebruik de bestaande)/i;
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
  "geslaagd. Verzin geen feiten en vul niets aan uit eigen kennis. Antwoord uitsluitend met één JSON-object, zonder tekst eromheen: " +
  '{"geslaagd": true|false, "reden": "<één of twee zinnen, concreet, met wat wel en niet in het bewijs staat>"}';

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
    bewijs.length > 24_000 ? `${bewijs.slice(0, 24_000)}\n… [afgekapt]` : bewijs,
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
  if (uitkomsten.length === 0) return { klaar: true, onmeetbaar: false, samenvatting: "geen expliciete acceptatietest in het doel" };
  const regels = uitkomsten.map((u) => `${u.id}: ${u.staat} — ${u.reden}`);
  return {
    klaar: uitkomsten.every((u) => u.staat === "geslaagd"),
    onmeetbaar: uitkomsten.some((u) => u.staat === "niet-meetbaar"),
    samenvatting: regels.join(" | ").slice(0, 1800),
  };
}
