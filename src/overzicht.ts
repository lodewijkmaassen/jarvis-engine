// Het overzicht: wat de eigenaar in één oogopslag moet zien.
//
// Dit is de gegevenslaag onder de Jarvis-interface. De interface zelf toont;
// deze module bepaalt WAT er te tonen valt, en haalt dat uit wat er al in de
// repository staat: het statusdocument, de kennisrecords, de taakdossiers en de
// git-historie. Er is geen tweede bron van waarheid. Wat hier niet uit git af
// te leiden is, staat niet in het overzicht.
//
// De module is puur. Alle lezen van schijf en git gebeurt bij de aanroeper;
// hier komen alleen strings en al geparste records binnen. Zo is elk stuk van
// het overzicht te toetsen met een verzonnen repository, en is de uitkomst bij
// gelijke invoer altijd gelijk.
//
// Volgorde en sortering zijn vast. Een overzicht dat bij elke run anders
// gesorteerd is, leest als beweging waar geen beweging is.
import type { KnowledgeRecord, RecordType } from "./records";

export const OVERZICHT_VERSIE = 1;

/** Hoeveel dagen "recent" is. Twee weken: een vakantie mag geen gat slaan. */
export const RECENT_DAGEN = 14;

export type Urgentie = "hoog" | "midden" | "laag";

export type AandachtSoort = "beslissing" | "actie" | "conflict" | "risico" | "blokkade";

/** Eén keuze die de eigenaar kan maken, met wat er dan gebeurt. */
export type Optie = {
  /** Sleutel waaronder het antwoord wordt opgeslagen: kleine letters, streepjes. */
  readonly keuze: string;
  readonly label: string;
  readonly gevolg: string;
};

/** Eén ding dat bij de eigenaar ligt. */
export type AandachtItem = {
  /** Stabiel over runs heen, zodat een antwoord in de interface eraan te koppelen is. */
  readonly id: string;
  readonly project: string;
  readonly soort: AandachtSoort;
  readonly titel: string;
  readonly toelichting: string;
  /** Waar het vandaan komt, als repo-relatief pad of record-id. */
  readonly bron: string;
  readonly urgentie: Urgentie;
  /** Waarom dit bij de eigenaar ligt en niet bij Jarvis. */
  readonly waarom: string;
  /** De keuzes, elk met gevolg. Nooit leeg: "later" is er altijd. */
  readonly opties: readonly Optie[];
  /** Het advies van Jarvis, als dat in de bron staat. */
  readonly advies: string | null;
};

export type RecentItem = {
  readonly datum: string;
  readonly hash: string;
  readonly onderwerp: string;
  readonly rol: string | null;
  readonly soort: "commit" | "merge";
};

export type TaakItem = {
  readonly id: string;
  readonly titel: string;
  readonly status: string;
  readonly klasse: string | null;
};

export type StandSectie = {
  readonly kop: string;
  readonly tekst: string;
};

export type ProjectOverzicht = {
  readonly id: string;
  readonly naam: string;
  /** Is dit een Jarvis-repository, met statusdocument en kennisrecords? */
  readonly aangesloten: boolean;
  readonly hoofdbranch: { readonly naam: string; readonly commit: string; readonly datum: string } | null;
  readonly stand: readonly StandSectie[];
  readonly feiten: readonly { readonly feit: string; readonly waarde: string }[];
  readonly recent: readonly RecentItem[];
  readonly taken: readonly TaakItem[];
  readonly kennis: Readonly<Partial<Record<RecordType, number>>>;
  readonly aandacht: readonly AandachtItem[];
};

export type Overzicht = {
  readonly versie: typeof OVERZICHT_VERSIE;
  readonly gegenereerd_op: string;
  readonly projecten: readonly ProjectOverzicht[];
  /** Alles wat bij de eigenaar ligt, over alle projecten heen, urgentste eerst. */
  readonly voor_jou: readonly AandachtItem[];
};

// ---------------------------------------------------------------------------
// Invoer
// ---------------------------------------------------------------------------

/** Eén regel uit `git log`, al uit elkaar gehaald door de aanroeper. */
export type GitRegel = {
  readonly hash: string;
  readonly datum: string;
  readonly onderwerp: string;
  readonly body: string;
};

export type TaakDossier = {
  readonly id: string;
  /** Front-matter van opdracht.md, als platte sleutel-waarde-paren. */
  readonly opdracht: Readonly<Record<string, string>>;
  /** Inhoud van resultaat.md, of null als dat er nog niet is. */
  readonly resultaat: string | null;
};

export type ProjectInvoer = {
  readonly id: string;
  readonly naam: string;
  readonly aangesloten: boolean;
  readonly hoofdbranch: ProjectOverzicht["hoofdbranch"];
  /** Volledige tekst van het statusdocument, of null bij een niet-aangesloten project. */
  readonly statusDocument: string | null;
  readonly records: readonly KnowledgeRecord[];
  readonly taken: readonly TaakDossier[];
  readonly gitLog: readonly GitRegel[];
};

// ---------------------------------------------------------------------------
// Het statusdocument
// ---------------------------------------------------------------------------

const FEITEN_START = "<!-- jarvis:feiten:start -->";
const FEITEN_EIND = "<!-- jarvis:feiten:eind -->";

/**
 * De `## `-secties van het statusdocument, in volgorde, zonder het
 * gegenereerde feitenblok. Dat blok is een tabel en krijgt een eigen plek.
 */
export function leesStandSecties(document: string): readonly StandSectie[] {
  const tekst = document.replace(/\r\n/g, "\n");
  const zonderBlok = verwijderFeitenblok(tekst);
  const secties: StandSectie[] = [];
  let huidige: { kop: string; regels: string[] } | null = null;
  for (const regel of zonderBlok.split("\n")) {
    const kop = /^## (.+)$/.exec(regel);
    if (kop) {
      if (huidige) secties.push({ kop: huidige.kop, tekst: huidige.regels.join("\n").trim() });
      huidige = { kop: kop[1].trim(), regels: [] };
      continue;
    }
    if (huidige) huidige.regels.push(regel);
  }
  if (huidige) secties.push({ kop: huidige.kop, tekst: huidige.regels.join("\n").trim() });
  return secties.filter((s) => s.tekst.length > 0);
}

function verwijderFeitenblok(tekst: string): string {
  const start = tekst.indexOf(FEITEN_START);
  const eind = tekst.indexOf(FEITEN_EIND);
  if (start === -1 || eind === -1 || eind < start) return tekst;
  return tekst.slice(0, start) + tekst.slice(eind + FEITEN_EIND.length);
}

/** De tabelrijen uit het feitenblok, als paren. */
export function leesFeiten(document: string): readonly { feit: string; waarde: string }[] {
  const tekst = document.replace(/\r\n/g, "\n");
  const start = tekst.indexOf(FEITEN_START);
  const eind = tekst.indexOf(FEITEN_EIND);
  if (start === -1 || eind === -1) return [];
  const blok = tekst.slice(start, eind);
  const rijen: { feit: string; waarde: string }[] = [];
  for (const regel of blok.split("\n")) {
    const m = /^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/.exec(regel.trim());
    if (!m) continue;
    if (m[1] === "Feit" || /^-+$/.test(m[1])) continue;
    rijen.push({ feit: m[1], waarde: m[2].replace(/`/g, "") });
  }
  return rijen;
}

// ---------------------------------------------------------------------------
// Recente beweging
// ---------------------------------------------------------------------------

/**
 * De git-historie van de laatste RECENT_DAGEN, nieuwste eerst.
 *
 * De rol komt uit de `Jarvis-Role:`-trailer. Ontbreekt die, dan staat er
 * null en niet "onbekend": de interface mag zelf kiezen hoe ze dat toont.
 */
export function leesRecent(gitLog: readonly GitRegel[], nu: Date): readonly RecentItem[] {
  const grens = new Date(nu.getTime() - RECENT_DAGEN * 24 * 60 * 60 * 1000);
  return gitLog
    .filter((r) => !Number.isNaN(Date.parse(r.datum)) && new Date(r.datum) >= grens)
    .map((r): RecentItem => ({
      datum: r.datum,
      hash: r.hash.slice(0, 7),
      onderwerp: r.onderwerp.trim(),
      rol: /^Jarvis-Role:\s*(\S+)/im.exec(r.body)?.[1]?.toLowerCase() ?? null,
      soort: /^Merge (pull request|branch)/i.test(r.onderwerp) ? "merge" : "commit",
    }))
    .sort((a, b) => b.datum.localeCompare(a.datum) || a.hash.localeCompare(b.hash));
}

// ---------------------------------------------------------------------------
// Wat bij de eigenaar ligt
// ---------------------------------------------------------------------------

const KOP_EIGENAAR = /^## Wat de eigenaar nog moet doen\s*$/m;
const KOP_GEBLOKKEERD = /^## Wat is geblokkeerd, en waarop\s*$/m;

/** Eerste zin, of de eerste N tekens; voor een titel die op een telefoon past. */
function kortTitel(tekst: string, max = 90): string {
  // Een vetgedrukte aanhef is de titel; zo schrijven de taakdossiers hun
  // eigenaarslijst. Anders de eerste zin.
  const vet = /^\*\*(.+?)\*\*/.exec(tekst.trim());
  const basis = vet ? vet[1] : tekst;
  const schoon = basis.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  const zin = vet ? schoon : (/^(.{4,}?[.!?])\s/.exec(schoon)?.[1] ?? schoon);
  return zin.length > max ? `${zin.slice(0, max - 1).trimEnd()}…` : zin;
}

/**
 * De genummerde en opgesomde items onder een kop, tot de volgende `## `-kop.
 * Een item mag doorlopen op ingesprongen vervolgregels. Tussenkopjes in vet
 * (`**Blokkerend voor merge**`) worden als context aan de items eronder
 * gehangen.
 */
export type GelezenItem = {
  readonly titel: string;
  readonly toelichting: string;
  readonly context: string;
  /** De ingesprongen "- Label: tekst"-regels onder het punt. */
  readonly regels: readonly { readonly label: string; readonly tekst: string }[];
};

export function leesItemsOnder(document: string, kop: RegExp): readonly GelezenItem[] {
  const tekst = document.replace(/\r\n/g, "\n");
  const m = kop.exec(tekst);
  if (!m) return [];
  const vanaf = tekst.slice(m.index + m[0].length);
  const volgende = /^## /m.exec(vanaf);
  const sectie = volgende ? vanaf.slice(0, volgende.index) : vanaf;

  const items: GelezenItem[] = [];
  let context = "";
  let huidig: string[] | null = null;
  let regels: { label: string; tekst: string }[] = [];
  const sluit = () => {
    if (!huidig) return;
    const geheel = huidig.join(" ").replace(/\s+/g, " ").trim();
    items.push({ titel: kortTitel(geheel), toelichting: geheel.replace(/\*\*/g, ""), context, regels });
    huidig = null;
    regels = [];
  };
  for (const regel of sectie.split("\n")) {
    const vet = /^\*\*(.+?)\*\*\s*$/.exec(regel.trim());
    if (vet) {
      sluit();
      context = vet[1];
      continue;
    }
    const start = /^(?:\d+\.|[-*])\s+(.*)$/.exec(regel);
    if (start) {
      sluit();
      huidig = [start[1]];
      continue;
    }
    // Een ingesprongen "- Label: tekst" onder het punt is een optie, advies of
    // toelichting; een ingesprongen regel zonder streepje loopt door in wat
    // ervoor stond (het punt zelf, of de laatste optie).
    const sub = huidig ? /^\s{2,}[-*]\s+\**([^:*]{1,40})\**:\s*(.*)$/.exec(regel) : null;
    if (sub) {
      regels.push({ label: sub[1].trim(), tekst: sub[2].trim() });
      continue;
    }
    if (huidig && /^\s{2,}\S/.test(regel)) {
      if (regels.length > 0) regels[regels.length - 1].tekst = `${regels[regels.length - 1].tekst} ${regel.trim()}`.trim();
      else huidig.push(regel.trim());
      continue;
    }
    if (regel.trim().length === 0) sluit();
  }
  sluit();
  return items;
}

/**
 * Korte, stabiele sleutel voor een tekst: FNV-1a, acht hextekens.
 *
 * Geen slug van de titel. Die was leesbaar, maar een slug van vijftig tekens
 * met cijfers erin haalt de entropiedrempel van de sanitizer - en die
 * controle staat bewust vóór het wegschrijven van dit overzicht. Acht
 * hextekens zijn stabiel over runs, kort genoeg om nooit voor een secret te
 * worden aangezien, en voldoende uniek binnen één taak.
 */
export function korteSleutel(tekst: string): string {
  let h = 0x811c9dc5;
  for (const teken of tekst.normalize("NFC")) {
    h ^= teken.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const URGENTIE_VOLGORDE: Record<Urgentie, number> = { hoog: 0, midden: 1, laag: 2 };
const SOORT_VOLGORDE: Record<AandachtSoort, number> = { blokkade: 0, beslissing: 1, actie: 2, conflict: 3, risico: 4 };

const RECORD_ID = /(?<![A-Za-z0-9])(CFL|RSK|DEC|CON|LRN)-\d{4}(?![A-Za-z0-9])/g;

/**
 * Eén onderwerp, één item.
 *
 * Hetzelfde conflict komt uit drie bronnen tegelijk: als record, als blokkade
 * in het statusdocument, en als actie in een taakdossier. Drie keer hetzelfde
 * tonen maakt de lijst langer zonder hem vollediger te maken. Het record wint
 * (dat is de bron van waarheid); een item dat naar een record verwijst dat al
 * als eigen item bestaat, valt weg en tilt hooguit de urgentie van dat record.
 */
function ontdubbel(items: readonly AandachtItem[]): readonly AandachtItem[] {
  const recordItems = new Map<string, AandachtItem>();
  for (const item of items) {
    if (/^(CFL|RSK|DEC|CON|LRN)-\d{4}$/.test(item.bron)) recordItems.set(item.bron, item);
  }
  const uit: AandachtItem[] = [];
  const opgetild = new Map<string, Urgentie>();
  for (const item of items) {
    if (recordItems.has(item.bron)) {
      uit.push(item);
      continue;
    }
    const verwezen = [...`${item.titel} ${item.toelichting}`.matchAll(RECORD_ID)].map((m) => m[0]);
    const doel = verwezen.find((id) => recordItems.has(id));
    if (doel === undefined) {
      uit.push(item);
      continue;
    }
    const huidig = opgetild.get(doel) ?? recordItems.get(doel)!.urgentie;
    if (URGENTIE_VOLGORDE[item.urgentie] < URGENTIE_VOLGORDE[huidig]) opgetild.set(doel, item.urgentie);
  }
  return uit.map((item) => {
    const nieuw = opgetild.get(item.bron);
    return nieuw ? { ...item, urgentie: nieuw } : item;
  });
}

function sorteerAandacht(items: readonly AandachtItem[]): readonly AandachtItem[] {
  return [...ontdubbel(items)].sort(
    (a, b) =>
      URGENTIE_VOLGORDE[a.urgentie] - URGENTIE_VOLGORDE[b.urgentie] ||
      SOORT_VOLGORDE[a.soort] - SOORT_VOLGORDE[b.soort] ||
      a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------
// Opties: wat de eigenaar kan kiezen, en wat er dan gebeurt
// ---------------------------------------------------------------------------

/** "Later" bestaat bij elk item: uitstellen is altijd een geldig antwoord. */
const OPTIE_LATER: Optie = {
  keuze: "later",
  label: "Later",
  gevolg: "Blijft staan. Jarvis brengt het de volgende keer opnieuw onder je aandacht, zonder verdere actie.",
};

/** Sleutel uit een label: kleine letters, geen accenten, streepjes. */
export function sleutelVan(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Regels "- Label: tekst" uit een tekstblok, zoals de sectie "## Opties" van een record. */
export function leesOptieRegels(tekst: string | undefined | null): readonly { label: string; tekst: string }[] {
  if (!tekst) return [];
  const uit: { label: string; tekst: string }[] = [];
  for (const regel of tekst.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^\s*[-*]\s+\**([^:*]{1,40})\**:\s*(.*)$/.exec(regel);
    if (m) uit.push({ label: m[1].trim(), tekst: m[2].trim() });
    else if (uit.length > 0 && /^\s+\S/.test(regel)) uit[uit.length - 1].tekst = `${uit[uit.length - 1].tekst} ${regel.trim()}`.trim();
  }
  return uit;
}

/**
 * Van regels naar opties. "Advies" en "Waarom" zijn geen keuzes maar krijgen
 * een eigen plek. Staan er geen keuzes in de bron, dan gelden de standaard-
 * opties van het soort item; "later" is er altijd bij.
 */
export function bouwOpties(
  regels: readonly { label: string; tekst: string }[],
  standaard: readonly Optie[],
): { opties: readonly Optie[]; advies: string | null; waarom: string | null } {
  const opties: Optie[] = [];
  let advies: string | null = null;
  let waarom: string | null = null;
  for (const r of regels) {
    const l = r.label.toLowerCase();
    if (l === "advies") advies = r.tekst;
    else if (l === "waarom") waarom = r.tekst;
    else if (r.tekst.length > 0) opties.push({ keuze: sleutelVan(r.label), label: r.label, gevolg: r.tekst });
  }
  const basis = opties.length > 0 ? opties : [...standaard];
  if (!basis.some((o) => o.keuze === "later")) basis.push(OPTIE_LATER);
  return { opties: basis, advies, waarom };
}

/** Vult "waarom" met de standaardtekst wanneer de bron er geen geeft. */
function metWaarom(
  gebouwd: ReturnType<typeof bouwOpties>,
  standaard: string,
): { opties: readonly Optie[]; advies: string | null; waarom: string } {
  return { opties: gebouwd.opties, advies: gebouwd.advies, waarom: gebouwd.waarom ?? standaard };
}

const eersteZin = (tekst: string) => {
  const plat = tekst.replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(plat);
  return m ? m[1] : plat;
};

const STANDAARD_ACTIE: readonly Optie[] = [
  { keuze: "gedaan", label: "Gedaan", gevolg: "Jarvis streept dit punt af in het taakdossier en legt vast dat jij het hebt gedaan." },
];
const STANDAARD_BESLISSING: readonly Optie[] = [
  { keuze: "beslist", label: "Beslissing vastleggen", gevolg: "Jarvis legt je beslissing vast als besluit en voert de gevolgen ervan uit in de repository." },
];
const STANDAARD_BLOKKADE: readonly Optie[] = [
  { keuze: "opgelost", label: "Opgelost", gevolg: "Jarvis haalt de blokkade uit het statusdocument en pakt het werk weer op." },
];
const STANDAARD_HUMAN: readonly Optie[] = [
  { keuze: "gedaan", label: "Gedaan", gevolg: "Jarvis controleert bij de volgende ronde of de handeling effect heeft gehad en sluit de markering." },
];

function risicoOpties(r: { kans?: string; impact?: string; mitigatie?: string }): readonly Optie[] {
  return [
    {
      keuze: "accepteren",
      label: "Accepteren",
      gevolg:
        `Het risico blijft bestaan (kans ${r.kans ?? "onbekend"}, impact ${r.impact ?? "onbekend"}) en gaat op "geaccepteerd": ` +
        `Jarvis meldt het niet meer als open punt en bouwt er geen mitigatie voor.` +
        (r.mitigatie ? ` Wat er nu al tegenover staat: ${eersteZin(r.mitigatie)}` : ""),
    },
    {
      keuze: "aanpakken",
      label: "Aanpakken",
      gevolg: "Jarvis maakt er een taak van en legt een plan voor voordat er iets verandert; het risico gaat pas dicht als de mitigatie er staat.",
    },
  ];
}

/**
 * Alles wat bij de eigenaar ligt, uit vier bronnen:
 *
 *   1. het statusdocument: staat er iets onder "geblokkeerd"?
 *   2. open conflictrecords: een CFL is per definitie een vraag aan een mens
 *   3. open risicorecords: ter kennisname, met de impact als urgentie
 *   4. taakdossiers: de lijst "Wat de eigenaar nog moet doen" in resultaat.md,
 *      plus elke HUMAN_ACTION_REQUIRED-markering
 *
 * Een niet-aangesloten project levert precies één item: de aansluiting zelf.
 */
export function leesAandacht(invoer: ProjectInvoer): readonly AandachtItem[] {
  const items: AandachtItem[] = [];
  const p = invoer.id;

  if (!invoer.aangesloten) {
    items.push({
      id: `${p}:aansluiten`,
      project: p,
      soort: "actie",
      titel: `${invoer.naam} is nog niet op Jarvis aangesloten`,
      toelichting:
        "Jarvis ziet van dit project alleen de git-historie. Aansluiten betekent: een GitHub-remote, " +
        "een jarvis.config.yml en een statusdocument. Daarna verschijnen stand, taken en beslissingen hier.",
      bron: "git",
      urgentie: "midden",
      waarom: "Een repository op GitHub zetten en Jarvis erin inrichten raakt jouw code en jouw account; dat doet Jarvis niet ongevraagd.",
      opties: [
        {
          keuze: "aansluiten",
          label: "Aansluiten",
          gevolg:
            "Jarvis scant eerst de volledige git-historie op secrets, zet de repository dan privé op GitHub en richt " +
            "Jarvis erin in: configuratie, statusdocument, kennismap en CI-poort. Daarna staan stand, taken en " +
            "beslissingen van dit project hier.",
        },
        {
          keuze: "niet",
          label: "Niet aansluiten",
          gevolg: "Het project blijft als gestippelde bol op de kaart, met alleen de git-beweging; Jarvis kan er niets voor doen.",
        },
        OPTIE_LATER,
      ],
      advies: null,
    });
    return items;
  }

  if (invoer.statusDocument) {
    const blok = leesItemsOnder(invoer.statusDocument, KOP_GEBLOKKEERD);
    const tekst = invoer.statusDocument.replace(/\r\n/g, "\n");
    const m = KOP_GEBLOKKEERD.exec(tekst);
    const sectie = m ? tekst.slice(m.index + m[0].length).split(/^## /m)[0].trim() : "";
    const nietsGeblokkeerd = /^(niets|geen|nvt|n\.v\.t\.)\b/i.test(sectie);
    if (sectie.length > 0 && !nietsGeblokkeerd) {
      const bron: readonly GelezenItem[] =
        blok.length > 0 ? blok : [{ titel: kortTitel(sectie), toelichting: sectie, context: "", regels: [] }];
      for (const [i, b] of bron.entries()) {
        items.push({
          id: `${p}:blokkade:${i + 1}`,
          project: p,
          soort: "blokkade",
          titel: b.titel,
          toelichting: b.toelichting,
          bron: "docs/CURRENT_STATE.md",
          urgentie: "hoog",
          ...metWaarom(
            bouwOpties(b.regels, STANDAARD_BLOKKADE),
            "Het werk staat stil tot dit is opgelost, en de oplossing ligt buiten wat Jarvis zelf kan doen.",
          ),
        });
      }
    }
  }

  for (const r of invoer.records) {
    if (r.type === "CFL" && r.status === "open") {
      items.push({
        id: `${p}:${r.id}`,
        project: p,
        soort: "conflict",
        titel: r.titel,
        toelichting: r.samenvatting,
        bron: r.id,
        urgentie: "hoog",
        ...metWaarom(
          bouwOpties(leesOptieRegels(r.opties), STANDAARD_BESLISSING),
          `Twee lezingen zijn allebei verdedigbaar en de repository beslist het niet (${(r.tussen ?? []).join(" tegenover ")}). ` +
            "Dit is een productkeuze die alleen jij kunt maken; tot die tijd bouwt Jarvis niets dat ervan afhangt.",
        ),
      });
    }
    if (r.type === "RSK" && r.status === "open") {
      items.push({
        id: `${p}:${r.id}`,
        project: p,
        soort: "risico",
        titel: r.titel,
        toelichting: r.samenvatting,
        bron: r.id,
        urgentie: r.impact === "hoog" ? "midden" : "laag",
        ...metWaarom(
          bouwOpties(leesOptieRegels(r.opties), risicoOpties(r)),
          `Jij bent eigenaar van dit risico (${r.eigenaar}); open sinds ${r.datum}. Accepteren of laten aanpakken is jouw afweging, niet die van Jarvis.`,
        ),
      });
    }
  }

  for (const taak of invoer.taken) {
    if (!taak.resultaat) continue;
    const status = taak.opdracht["status"] ?? "";
    if (status === "afgerond") continue;
    for (const item of leesItemsOnder(taak.resultaat, KOP_EIGENAAR)) {
      const blokkerend = /blokkerend/i.test(item.context);
      const naMerge = /na merge/i.test(item.context);
      // Een punt dat begint met "beslis" vraagt een keuze, geen handeling; dat
      // verschil bepaalt welke knoppen de interface toont.
      const beslissing = blokkerend || /^beslis/i.test(item.titel);
      items.push({
        id: `${p}:${taak.id}:${korteSleutel(item.titel)}`,
        project: p,
        soort: beslissing ? "beslissing" : "actie",
        titel: item.titel,
        toelichting: item.context ? `${item.context}. ${item.toelichting}` : item.toelichting,
        bron: `tasks/${taak.id}/resultaat.md`,
        urgentie: blokkerend ? "hoog" : naMerge ? "laag" : "midden",
        ...metWaarom(
          bouwOpties(item.regels, beslissing ? STANDAARD_BESLISSING : STANDAARD_ACTIE),
          `Staat in het resultaat van ${taak.id} als punt dat alleen de eigenaar kan doen.`,
        ),
      });
    }
    const markeringen = taak.resultaat.match(/HUMAN_ACTION_REQUIRED[^\n]*/g) ?? [];
    for (const [i, m] of markeringen.entries()) {
      items.push({
        id: `${p}:${taak.id}:human-action:${i + 1}`,
        project: p,
        soort: "actie",
        titel: kortTitel(m.replace(/^HUMAN_ACTION_REQUIRED\W*/, "")),
        toelichting: m,
        bron: `tasks/${taak.id}/resultaat.md`,
        urgentie: "hoog",
        waarom: "Een agent kan dit niet zonder jouw toegang of toestemming; daarom staat er een markering in het taakdossier.",
        opties: [...STANDAARD_HUMAN, OPTIE_LATER],
        advies: null,
      });
    }
  }

  return sorteerAandacht(items);
}

// ---------------------------------------------------------------------------
// Samenstellen
// ---------------------------------------------------------------------------

export function leesTaken(taken: readonly TaakDossier[]): readonly TaakItem[] {
  return taken
    .map((t) => ({
      id: t.id,
      titel: t.opdracht["titel"] ?? t.id,
      status: t.opdracht["status"] ?? "onbekend",
      klasse: t.opdracht["klasse"] ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function telKennis(records: readonly KnowledgeRecord[]): Readonly<Partial<Record<RecordType, number>>> {
  const telling: Partial<Record<RecordType, number>> = {};
  for (const r of records) telling[r.type] = (telling[r.type] ?? 0) + 1;
  return telling;
}

export function bouwProjectOverzicht(invoer: ProjectInvoer, nu: Date): ProjectOverzicht {
  return {
    id: invoer.id,
    naam: invoer.naam,
    aangesloten: invoer.aangesloten,
    hoofdbranch: invoer.hoofdbranch,
    stand: invoer.statusDocument ? leesStandSecties(invoer.statusDocument) : [],
    feiten: invoer.statusDocument ? leesFeiten(invoer.statusDocument) : [],
    recent: leesRecent(invoer.gitLog, nu),
    taken: leesTaken(invoer.taken),
    kennis: telKennis(invoer.records),
    aandacht: leesAandacht(invoer),
  };
}

export function bouwOverzicht(projecten: readonly ProjectInvoer[], nu: Date): Overzicht {
  const uitgewerkt = projecten.map((p) => bouwProjectOverzicht(p, nu));
  return {
    versie: OVERZICHT_VERSIE,
    gegenereerd_op: nu.toISOString(),
    projecten: uitgewerkt,
    voor_jou: sorteerAandacht(uitgewerkt.flatMap((p) => p.aandacht)),
  };
}
