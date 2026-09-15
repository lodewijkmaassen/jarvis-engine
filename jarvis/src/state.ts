// CURRENT_STATE: een gegenereerd feitenblok plus een menselijk narratief.
//
// Het faalpad dat dit dichtzet: een statusdocument dat drie sessies achterloopt
// is erger dan geen statusdocument, want een agent vertrouwt het wél. Daarom
// staat alles wat de repository zelf kan weten in een blok dat door de engine
// wordt geschreven en in CI wordt gecontroleerd. Handmatig driften kan niet
// meer; wat overblijft voor mensen is precies het deel dat mensen weten —
// waar we op wachten, waarom, en wat de volgende stap is.
import type { RecordType } from "./records";

export const FEITEN_START = "<!-- jarvis:feiten:start -->";
export const FEITEN_EIND = "<!-- jarvis:feiten:eind -->";

export type OpenTaak = {
  readonly id: string;
  readonly titel: string;
  readonly status: string;
};

export type StateFeiten = {
  readonly gegenereerdOp: string;
  readonly hoofdbranch: string;
  /**
   * Bewust NIET in het feitenblok: de commit en datum van de hoofdbranch
   * veranderen bij elke merge. Met die waarde in het blok was elke open pull
   * request rood zodra een andere was samengevoegd, en botste elke merge van
   * main op precies die regel (gemeten 2026-09-14/15: een verversingscommit
   * plus een QA-ronde per PR per merge). De velden blijven voor rapportage.
   */
  readonly hoofdbranchCommit: string;
  readonly hoofdbranchDatum: string;
  readonly hoogsteMigratie: string | null;
  readonly aantalTestbestanden: number | null;
  readonly recordTellingen: Readonly<Partial<Record<RecordType, number>>>;
  readonly openConflicten: readonly string[];
  readonly openTaken: readonly OpenTaak[];
  /**
   * Bewust NIET in het feitenblok: een branchlijst verandert bij elke push en
   * zou de driftcontrole in CI permanent laten falen op iets dat niets zegt
   * over de stand van het project. Het veld blijft bestaan voor rapportage.
   */
  readonly actieveBranches: readonly string[];
};

/**
 * Genereert het feitenblok.
 *
 * Alles hierin is afleidbaar uit de repository. Er staat bewust GEEN
 * interpretatie in: "we wachten op de provider" is narratief, "migratie 0011
 * is de hoogste" is een feit.
 */
export function genereerFeitenblok(feiten: StateFeiten): string {
  const tellingen = (["DEC", "CON", "LRN", "RSK", "CFL"] as const)
    .map((t) => `${t} ${feiten.recordTellingen[t] ?? 0}`)
    .join(" · ");

  const regels: string[] = [
    FEITEN_START,
    "",
    "<!-- Dit blok wordt gegenereerd door `jarvis state`. Handmatige wijzigingen",
    "     worden door CI gedetecteerd en overschreven. Schrijf je toelichting",
    "     onder het blok, niet erin. -->",
    "",
    `_Gegenereerd op ${feiten.gegenereerdOp}._`,
    "",
    "| Feit | Waarde |",
    "|---|---|",
    `| Hoofdbranch | \`${feiten.hoofdbranch}\` |`,
    `| Hoogste migratie | ${feiten.hoogsteMigratie ?? "onbekend"} |`,
    `| Testbestanden | ${feiten.aantalTestbestanden ?? "onbekend"} |`,
    `| Kennisrecords | ${tellingen} |`,
    `| Open conflicten | ${feiten.openConflicten.length === 0 ? "geen" : feiten.openConflicten.join(", ")} |`,
    "",
  ];

  if (feiten.openTaken.length > 0) {
    regels.push("**Open taken**", "", "| Taak | Status | Titel |", "|---|---|---|");
    for (const taak of feiten.openTaken) {
      regels.push(`| ${taak.id} | ${taak.status} | ${taak.titel} |`);
    }
    regels.push("");
  } else {
    regels.push("**Open taken:** geen.", "");
  }

  regels.push(FEITEN_EIND);
  return regels.join("\n");
}

export type BlokResultaat =
  | { readonly ok: true; readonly tekst: string; readonly gewijzigd: boolean }
  | { readonly ok: false; readonly boodschap: string };

/**
 * Vervangt het feitenblok in een bestaand document.
 *
 * Ontbreken de markeringen, dan wordt het blok bovenaan ingevoegd na de
 * eerste kop — nooit stilzwijgend aan het eind, want dan leest niemand het.
 */
export function vervangFeitenblok(document: string, blok: string): BlokResultaat {
  const tekst = document.replace(/\r\n/g, "\n");
  const start = tekst.indexOf(FEITEN_START);
  const eind = tekst.indexOf(FEITEN_EIND);

  if (start === -1 && eind === -1) {
    const regels = tekst.split("\n");
    const kopIndex = regels.findIndex((r) => r.startsWith("# "));
    const invoegPunt = kopIndex === -1 ? 0 : kopIndex + 1;
    const nieuw = [
      ...regels.slice(0, invoegPunt),
      "",
      blok,
      "",
      ...regels.slice(invoegPunt),
    ].join("\n");
    return { ok: true, tekst: nieuw, gewijzigd: true };
  }
  if (start === -1 || eind === -1 || eind < start) {
    return {
      ok: false,
      boodschap: `feitenblok-markeringen ontbreken of staan in de verkeerde volgorde (${FEITEN_START} / ${FEITEN_EIND})`,
    };
  }

  const voor = tekst.slice(0, start);
  const na = tekst.slice(eind + FEITEN_EIND.length);
  const nieuw = `${voor}${blok}${na}`;
  return { ok: true, tekst: nieuw, gewijzigd: nieuw !== tekst };
}

/** Haalt het huidige feitenblok uit een document, voor de driftcontrole. */
export function leesFeitenblok(document: string): string | null {
  const tekst = document.replace(/\r\n/g, "\n");
  const start = tekst.indexOf(FEITEN_START);
  const eind = tekst.indexOf(FEITEN_EIND);
  if (start === -1 || eind === -1 || eind < start) return null;
  return tekst.slice(start, eind + FEITEN_EIND.length);
}

/**
 * Vergelijkt het opgeslagen blok met het herberekende blok.
 *
 * De generatiedatum wordt genegeerd: die verandert bij elke run en zou de
 * controle betekenisloos maken. Het gaat om de feiten, niet om wanneer we ze
 * hebben opgeschreven.
 */
export function blokIsActueel(opgeslagen: string, herberekend: string): boolean {
  // Een ouder blok dat de commit nog in de Hoofdbranch-regel draagt telt als
  // actueel zolang de rest klopt; de regel verdwijnt bij de volgende --schrijf.
  const strip = (s: string) => s
    .replace(/_Gegenereerd op [^_]*_/g, "")
    .replace(/\| Hoofdbranch \| (`[^`]+`) op `[0-9a-f]+` \([^)]*\) \|/g, "| Hoofdbranch | $1 |")
    .replace(/\s+/g, " ").trim();
  return strip(opgeslagen) === strip(herberekend);
}

/** Sjabloon voor een nieuw CURRENT_STATE-document. */
export function nieuwStateDocument(project: string, blok: string): string {
  return [
    `# CURRENT_STATE — ${project}`,
    "",
    blok,
    "",
    "## Waar staan we",
    "",
    "_Nog in te vullen._",
    "",
    "## Wat draait er in productie",
    "",
    "_Nog in te vullen._",
    "",
    "## Wat is in uitvoering",
    "",
    "_Nog in te vullen._",
    "",
    "## Wat is geblokkeerd, en waarop",
    "",
    "_Nog in te vullen._",
    "",
    "## Volgende stap",
    "",
    "_Nog in te vullen._",
    "",
  ].join("\n");
}
