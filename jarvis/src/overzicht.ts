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
import { scopeHash } from "./attestatie";
import type { KnowledgeRecord, RecordType } from "./records";
import type { OpenTaak } from "./state";

export const OVERZICHT_VERSIE = 2;

/** Hoeveel dagen "recent" is. Twee weken: een vakantie mag geen gat slaan. */
export const RECENT_DAGEN = 14;

export type Urgentie = "hoog" | "midden" | "laag";

export type AandachtSoort = "beslissing" | "actie" | "conflict" | "risico" | "blokkade";

/**
 * Wat voor interactie een eigenaarspunt is — de betekenis, niet de bron.
 *
 * `AandachtSoort` zegt waar een punt vandaan komt en bepaalt de volgorde in de
 * lijst. Deze verzameling zegt wat de eigenaar moet dóen, en bepaalt daarmee
 * welke knoppen hij krijgt. Ze staan naast elkaar omdat ze verschillende vragen
 * beantwoorden.
 *
 * De aanleiding is gemeten: het soort van een dossierpunt hing aan één woord
 * — `blokkerend` in de context, of een titel die met "beslis" begint. Een
 * keuze die toevallig met "kies" begon werd daardoor als handeling aangeboden,
 * met één knop "Gedaan", terwijl de twee alternatieven die de eigenaar in de
 * tekst kreeg voorgelegd de knoppen nooit bereikten.
 */
export type EigenaarSoort = "akkoord" | "keuze" | "externe-handeling" | "bevestiging" | "uitstel";

/** De labels die in een eigenaarspunt een eigen betekenis hebben en dus geen alternatief zijn. */
export const GERESERVEERDE_LABELS = Object.freeze(["advies", "waarom", "controle", "keuze", "extern", "bevestig", "wacht"]);

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
  /**
   * Wat voor interactie dit is, voor een punt dat bij de eigenaar ligt; `null`
   * voor alles wat uit een record of het statusdocument komt. De knoppen volgen
   * hieruit, nooit uit het eerste woord van de titel.
   */
  readonly interactie: EigenaarSoort | null;
  /** De keuzes, elk met gevolg. Nooit leeg: "later" is er altijd. */
  readonly opties: readonly Optie[];
  /** Het advies van Jarvis, als dat in de bron staat. */
  readonly advies: string | null;
  /** Voor een handeling: de stappen in volgorde, elk met waar, wat je ziet en wat je doet. */
  readonly stappen: readonly string[];
  /** Hoe de eigenaar zelf ziet dat het gelukt is. */
  readonly controle: string | null;
};

export type RecentItem = {
  readonly datum: string;
  readonly hash: string;
  readonly onderwerp: string;
  readonly rol: string | null;
  /** Uit de `Jarvis-Task:`-trailer: aan welke taak de commit is toegeschreven. */
  readonly taak: string | null;
  readonly soort: "commit" | "merge";
};

/** Eén stap uit de voortgangslijst van een taak (`## Voortgang` in resultaat.md). */
export type TaakStap = {
  readonly tekst: string;
  readonly gedaan: boolean;
};

export type TaakItem = {
  readonly id: string;
  readonly titel: string;
  readonly status: string;
  readonly klasse: string | null;
  /** Het project waar de taak over gaat; standaard het project dat het dossier draagt. */
  readonly project: string;
  /** Het project dat het dossier draagt (waar de commits landen). */
  readonly gastheer: string;
  readonly stappen: readonly TaakStap[];
  /**
   * Wie moet nu iets doen: Jarvis, de eigenaar, niemand (taak niet actief), of
   * `wacht` — de taak leeft, maar er valt voor niemand iets te doen tot iets
   * buiten de wachtrij gebeurt. Die vierde waarde is er sinds 2026-09-24:
   * zonder haar viel wachtend werk terug op `jarvis` en meldde de interface
   * "JARVIS AAN ZET" over taken die bewust geparkeerd waren.
   */
  readonly aan_zet: "jarvis" | "eigenaar" | "wacht" | "niemand";
  /** Waarop gewacht wordt, wanneer `aan_zet` `wacht` is; anders `null`. */
  readonly wacht_soort: "gebeurtenis" | "uitvoerder" | "taak" | "pull-request" | null;
  /** Waar de taak op wacht, in één korte regel; de volledige tekst staat in `stappen`. */
  readonly wacht_op: string | null;
  /** Datum van de laatste commit met deze taak in de trailer, binnen het venster; null = geen. */
  readonly laatste_beweging: string | null;
  /**
   * Jarvis is aan zet en er is al dagen geen beweging: iets om te bewaken.
   * Wachtend werk telt nooit als stil — daar ís geen beweging te verwachten,
   * en "STIL" zou dan een storing suggereren waar een keuze staat.
   */
  readonly stil: boolean;
  /**
   * De scope waarop de eigenaar akkoord geeft (DEC-0043): de volledige tekst
   * van opdracht.md, alleen voor een actieve taak, en de SHA-256 ervan met
   * LF-regeleindes. De interface toont de tekst, hasht wat ze toont en legt
   * die hash bij het akkoord vast; de attestatie vergelijkt met het bestand
   * op de kop van de pull request.
   */
  readonly scope: string | null;
  readonly scope_hash: string | null;
  /**
   * De volgende open stap is het akkoord van de eigenaar (DEC-0043): de taak
   * wacht op hem, ook al staat er geen punt in zijn lijst. De interface toont
   * dit als actie zolang er geen geldig akkoord op de huidige scope ligt.
   */
  readonly akkoord_nodig: boolean;
};

/**
 * De vier patronen waarmee een open voortgangsstap zegt dat er op iets buiten
 * de wachtrij wordt gewacht. Ze staan hier, en niet in `regie.ts`, omdat twee
 * beelden van "wie is aan zet" onvermijdelijk uiteenlopen zodra er één wordt
 * bijgewerkt: het overzicht (de interface) zei "Jarvis aan zet" over taken die
 * de regie al als wachtend kende, en de eigenaar zag daardoor een systeem dat
 * druk leek maar stilstond. `regie.ts` importeert ze hier.
 */
export const WACHT_OP_TAAK = /wacht(?:en)?\s+op\s+(T-\d{8}-[a-z0-9-]+)/i;
export const WACHT_OP_PR = /wacht(?:en)?\s+op\s+(?:pr|pull request)\s*(?:([\w.-]+\/[\w.-]+))?#?(\d+)/i;
export const WACHT_OP_GEBEURTENIS = /^\s*wacht(?:en)?\s+op\s+gebeurtenis\s*:\s*(.+?)\s*$/i;
export const UITVOERDER_STAP = /\bUitvoerder:\s*\*{0,2}\s*([a-z][a-z0-9_-]*)/i;

/** Waarop een stap wacht; `null` betekent: er valt gewoon werk te doen. */
export type Wachtreden =
  | { readonly soort: "gebeurtenis"; readonly waarop: string }
  | { readonly soort: "uitvoerder"; readonly waarop: string }
  | { readonly soort: "taak"; readonly waarop: string }
  | { readonly soort: "pull-request"; readonly waarop: string }
  | null;

/**
 * Wacht deze stap ergens op, en waarop? De volgorde is die van `bepaalTaak`
 * in `regie.ts`, zodat beide dezelfde stap hetzelfde noemen. Het akkoord van
 * de eigenaar zit hier bewust níét in: dat loopt via `isAkkoordStap` en levert
 * `aan_zet: "eigenaar"`, een andere toestand dan wachten.
 */
export function wachtredenVanStap(stap: string | null): Wachtreden {
  if (stap === null) return null;
  const taak = WACHT_OP_TAAK.exec(stap);
  if (taak) return { soort: "taak", waarop: taak[1] ?? "" };
  const pr = WACHT_OP_PR.exec(stap);
  if (pr) return { soort: "pull-request", waarop: pr[1] ? `${pr[1]}#${pr[2]}` : `PR #${pr[2]}` };
  const gebeurtenis = WACHT_OP_GEBEURTENIS.exec(stap);
  if (gebeurtenis) return { soort: "gebeurtenis", waarop: gebeurtenis[1] ?? "" };
  const uitvoerder = UITVOERDER_STAP.exec(stap);
  if (uitvoerder) return { soort: "uitvoerder", waarop: (uitvoerder[1] ?? "").toLowerCase() };
  return null;
}

/**
 * Eén korte regel voor de interface. `wacht_op` droeg eerder de volledige
 * staptekst — in de praktijk een alinea van honderden tekens, die in de kaart
 * als onleesbare brij belandde. De volledige tekst blijft in `stappen` staan.
 */
export function wachtredenTekst(reden: Wachtreden): string | null {
  if (reden === null) return null;
  if (reden.soort === "gebeurtenis") return `wacht op: ${kortAf(reden.waarop, 120)}`;
  if (reden.soort === "uitvoerder") return `ligt bij uitvoerder ${reden.waarop}`;
  if (reden.soort === "taak") return `wacht op taak ${reden.waarop}`;
  return `wacht op ${reden.waarop}`;
}

/** Kort een regel af op een woordgrens, met een beletselteken. */
function kortAf(tekst: string, max: number): string {
  const schoon = tekst.replace(/\s+/g, " ").trim();
  if (schoon.length <= max) return schoon;
  const knip = schoon.slice(0, max);
  const spatie = knip.lastIndexOf(" ");
  return `${(spatie > max * 0.6 ? knip.slice(0, spatie) : knip).trimEnd()}…`;
}

/** Een voortgangsstap die het akkoord van de eigenaar op de taak beschrijft. */
export function isAkkoordStap(tekst: string): boolean {
  // De stap gaat over het akkoord zelf ("Akkoord van de eigenaar op deze taak …"),
  // niet over een stap die het woord ergens noemt ("… akkoord vanuit de app verwerkt").
  return /^\s*akkoord\b/i.test(tekst) && /\beigenaar\b/i.test(tekst);
}

/**
 * Een punt in de eigenaarslijst dat het akkoord van de eigenaar op de taak
 * zélf vraagt. Zo'n punt hoort niet als los aan te vinken handeling in de
 * lijst: het akkoord loopt over de akkoordkaart, want alleen die legt een
 * autorisatie vast waar de poort op kan varen (DEC-0043). Een punt dat het
 * als "gedaan" laat afvinken levert een antwoord en géén autorisatie op — de
 * eigenaar tikt dan iets af waar de poort niets mee kan, en dezelfde handeling
 * staat twee keer in zijn lijst.
 *
 * Breder dan `isAkkoordStap`: die leest de voortgangslijst, waar de stap met
 * het woord "akkoord" begint. In de eigenaarslijst staat het in gebiedende
 * wijs ("geef in de Jarvis-app akkoord op deze taak"), dus de vorm is vrij en
 * wat telt is de combinatie: een akkoord, op déze taak, in de app.
 */
export function isAkkoordVraag(tekst: string): boolean {
  if (isAkkoordStap(tekst)) return true;
  return /\bakkoord\b/i.test(tekst) && /\b(?:deze|de) taak\b/i.test(tekst) && /\bapp\b/i.test(tekst);
}

/**
 * Een afgevinkte regel in de eigenaarslijst: `- [x] …`. De handeling is al
 * gedaan en hoort niet meer in de lijst.
 *
 * Het faalpad dat dit dichtzet: een eigenaarshandeling was alleen te sluiten
 * door de tekst te herschrijven. Deed niemand dat, dan bleef de handeling
 * staan en vroeg de app hem opnieuw — er lagen items in de lijst die de
 * eigenaar dagen eerder al had gedaan. Met een vinkje is sluiten een
 * mechanische stap die het spoor laat staan in plaats van het weg te gummen.
 */
export function isAfgevinkt(tekst: string): boolean {
  return /^\s*\[[xX]\]/.test(tekst);
}

/** Na hoeveel dagen zonder commit een taak waar Jarvis aan zet is als stil geldt. */
export const STIL_NA_DAGEN = 2;

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
  /** Het project dat in het midden van de kaart staat (Jarvis zelf), of null. */
  readonly centraal: string | null;
  readonly projecten: readonly ProjectOverzicht[];
  /** Alles wat bij de eigenaar ligt, over alle projecten heen, urgentste eerst. */
  readonly voor_jou: readonly AandachtItem[];
  /**
   * Elke taak in precies één vak, en de open risico's apart. De interface
   * toont deze indeling en leidt hem niet zelf af: dat was de fout die
   * `aan_zet` en de regie uiteen liet lopen — twee beelden van dezelfde vraag,
   * elk met een eigen kopie van de regel.
   */
  readonly indeling: Indeling;
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
  /** De volledige tekst van opdracht.md (de scope); ontbreekt in oudere aanroepen. */
  readonly tekst?: string;
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
  /** Er loopt al een taak om dit project aan te sluiten; dan is "aansluiten" geen open vraag meer. */
  readonly aansluitingLoopt?: boolean;
  /**
   * Tag op een kennisrecord -> project-id. Een record dat over een ander
   * project gaat dan de repository waarin het staat (tag `jarvis` in de
   * repository van een product) hoort in het overzicht bij dat project.
   */
  readonly tagProjecten?: Readonly<Record<string, string>>;
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
      taak: /^Jarvis-Task:\s*(\S+)/im.exec(r.body)?.[1] ?? null,
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
      // "- Stap N: …" en "- Controle: …" op het hoogste niveau (LRN-0014, zoals de
      // cloud-uitvoerder ze schrijft onder een vette kop) zijn de stappen van één
      // handeling, geen losse handelingen — en een controle is werk van Jarvis,
      // nooit een actie voor de eigenaar (CON-0016).
      //
      // De dubbele punt mag binnen de sterretjes staan (`**Controle:** …`); dat
      // is dezelfde regel en krijgt dezelfde grens. Zonder `\**` ná de dubbele
      // punt bleven de sluitende sterretjes in de tekst staan.
      const stap = /^\**(Stap \d+|Controle)\**\s*:\**\s*(.*)$/i.exec(start[1]);
      if (stap) {
        const label = stap[1].trim();
        const regel = { label, tekst: stap[2].replace(/\*+$/, "").trim() };
        // Een controle opent nooit een handeling. Stond er een lege regel tussen
        // de stappen en de controle, dan is het lopende punt al gesloten; de
        // controle hoort dan bij het punt dat er net was, en anders bij niets.
        // Zonder deze grens werd de controletekst zelf een item, en daarmee in
        // "Voor jou" en in de regie een "wacht op jou" voor werk van Jarvis.
        if (!huidig && /^controle$/i.test(label)) {
          const vorige = items[items.length - 1];
          if (vorige) items[items.length - 1] = { ...vorige, regels: [...vorige.regels, regel] };
          continue;
        }
        if (!huidig) huidig = [context || regel.tekst];
        regels.push(regel);
        continue;
      }
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
/**
 * Welke labelregels als alternatief tellen. Elk aanroeppunt zegt het expliciet;
 * er is geen stilzwijgende regel meer.
 *
 * Dit is de kern van een bevinding die twee QA-rondes kostte. `bouwOpties` liet
 * élke niet-gereserveerde `- Label: tekst`-regel een knop worden, en die knop
 * verdrong de knoppen van het soort. Een blokkade met een regel `- Let op: …`
 * kreeg daardoor een knop "Let op" in plaats van "Opgelost", en een keuze kreeg
 * er een alternatief bij dat geen alternatief was. Wie hier een aanroep
 * toevoegt, moet kiezen — vandaar dat er geen standaardwaarde is.
 */
export type Alternatieven = "geen" | "elke-regel" | "alleen-optie";

const isAlternatief = (label: string, welke: Alternatieven): boolean => {
  if (welke === "geen") return false;
  if (welke === "alleen-optie") return /^optie\b/i.test(label.trim());
  return true;
};

export function bouwOpties(
  regels: readonly { label: string; tekst: string }[],
  standaard: readonly Optie[],
  welke: Alternatieven = "geen",
): { opties: readonly Optie[]; advies: string | null; waarom: string | null; stappen: readonly string[]; controle: string | null } {
  const opties: Optie[] = [];
  const stappen: { nr: number; tekst: string }[] = [];
  let advies: string | null = null;
  let waarom: string | null = null;
  let controle: string | null = null;
  for (const r of regels) {
    const l = r.label.toLowerCase();
    const stap = /^stap\s*(\d+)$/.exec(l);
    if (stap) stappen.push({ nr: Number(stap[1]), tekst: r.tekst });
    else if (l === "advies") advies = r.tekst;
    else if (l === "waarom") waarom = r.tekst;
    else if (l === "controle") controle = r.tekst;
    // `Keuze` draagt de vraag, `Extern` en `Bevestig` bepalen het soort. Alle
    // drie zijn betekenisdragers, geen alternatieven; zonder deze regel werd
    // "Extern" zelf een knop.
    else if (l === "keuze" || l === "extern" || l === "bevestig" || l === "wacht") continue;
    else if (r.tekst.length > 0 && isAlternatief(r.label, welke)) {
      const sleutel = sleutelVan(r.label);
      // `later` en `gedaan` hebben een vaste betekenis in de interface. Een
      // regel met die naam mag ze niet overnemen: een kennisrecord met een
      // regel `- Later: …` gaf de enige altijd-aanwezige knop een eigen gevolg,
      // en `- Gedaan: …` zette een handelingsknop op een risicokaart.
      if (sleutel === "later" || sleutel === "gedaan") continue;
      // Twee knoppen met dezelfde sleutel zijn niet ondubbelzinnig toe te
      // wijzen aan een antwoord.
      if (!opties.some((o) => o.keuze === sleutel)) opties.push({ keuze: sleutel, label: r.label, gevolg: r.tekst });
    }
  }
  // Eén alternatief is geen keuze. Met minder dan twee vervangt de bron de
  // vaste knoppen niet: een record met één optieregel verloor daardoor zijn
  // "Beslissing vastleggen" of "Accepteren"/"Aanpakken".
  const basis = opties.length >= 2 ? opties : [...standaard];
  if (!basis.some((o) => o.keuze === "later")) basis.push(OPTIE_LATER);
  return { opties: basis, advies, waarom, stappen: stappen.sort((a, b) => a.nr - b.nr).map((s) => s.tekst), controle };
}

/** Vult "waarom" met de standaardtekst wanneer de bron er geen geeft. */
function metWaarom(
  gebouwd: ReturnType<typeof bouwOpties>,
  standaard: string,
): { opties: readonly Optie[]; advies: string | null; waarom: string; stappen: readonly string[]; controle: string | null } {
  return { opties: gebouwd.opties, advies: gebouwd.advies, waarom: gebouwd.waarom ?? standaard, stappen: gebouwd.stappen, controle: gebouwd.controle };
}

const eersteZin = (tekst: string) => {
  const plat = tekst.replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(plat);
  return m ? m[1] : plat;
};

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
/** De knoppen per soort interactie. "Later" komt er altijd bij, in `bouwOpties`. */
const KNOPPEN: Record<EigenaarSoort, readonly Optie[]> = {
  akkoord: [
    { keuze: "akkoord", label: "Akkoord", gevolg: "Jarvis legt je autorisatie vast en voert uit wat eronder valt." },
    { keuze: "niet-akkoord", label: "Niet akkoord", gevolg: "Jarvis voert het niet uit en vraagt wat er anders moet." },
  ],
  keuze: [],
  "externe-handeling": [
    { keuze: "gedaan", label: "Gedaan", gevolg: "Jarvis streept dit punt af in het taakdossier en legt vast dat jij het hebt gedaan." },
  ],
  bevestiging: [
    { keuze: "gedaan", label: "Gedaan", gevolg: "Jarvis streept dit punt af en controleert bij de volgende ronde of het effect heeft gehad." },
    { keuze: "nog-niet", label: "Nog niet", gevolg: "Het punt blijft staan; Jarvis brengt het later opnieuw onder je aandacht." },
  ],
  uitstel: [],
};

/**
 * De alternatieven van een keuze die in één regel staat: "(a) … of (b) …".
 *
 * Dit is een migratiepad, geen tweede formaat. Bestaande dossiers hebben hun
 * keuzes zo geschreven, en zonder herkenning toont de kaart een half afgemaakte
 * vraag met één knop "Gedaan" — precies de fout die deze verzameling wegneemt.
 * Voor nieuwe dossierpunten is de norm een eigen optieregel, en `jarvis lint`
 * bewaakt dat.
 */
export const KEUZEWOORD = /\b(kies|kiezen|keuze|bepaal|bepalen|welke|of\b.*\bof)\b/i;

export function leesIngebedeKeuze(tekst: string): readonly Optie[] {
  const plat = tekst.replace(/\s+/g, " ").replace(/\*\*/g, "");
  // Twee merken maken nog geen keuze. "doe (a) het ene en (b) het andere" is
  // één handeling met twee delen, en "artikel 5 lid (a) en lid (b)" is een
  // verwijzing; allebei werden ze als keuze aangeboden, met onleesbare knoppen
  // en zonder manier om ze af te sluiten. Er moet een keuzewoord staan én de
  // alternatieven moeten met "of" gescheiden zijn.
  if (!KEUZEWOORD.test(plat)) return [];
  const merken = [...plat.matchAll(/\(([a-zA-Z])\)\s*/g)];
  if (merken.length < 2) return [];
  // Elk paar opeenvolgende merken hoort door "of" gescheiden te zijn; staat er
  // "en", dan moeten beide dingen gebeuren en is het geen keuze.
  for (let i = 0; i + 1 < merken.length; i += 1) {
    const tussen = plat.slice(merken[i].index + merken[i][0].length, merken[i + 1].index);
    if (!/\b(of|dan wel)\s*$/i.test(tussen.trim())) return [];
  }
  const uit: Optie[] = [];
  for (const [i, m] of merken.entries()) {
    const start = m.index + m[0].length;
    const eind = i + 1 < merken.length ? merken[i + 1].index : plat.length;
    let deel = plat.slice(start, eind).trim();
    // Het voegwoord vóór het volgende alternatief hoort bij de scheiding, niet
    // bij de tekst ervoor.
    deel = deel.replace(/[,;]?\s*(of|dan wel)\s*$/i, "").replace(/[.,;]\s*$/, "").trim();
    if (deel.length === 0) return [];
    const sleutel = `optie-${m[1].toLowerCase()}`;
    // Twee alternatieven met hetzelfde merk zijn niet ondubbelzinnig toe te
    // wijzen aan een antwoord; dan is het geen bruikbare keuze.
    if (uit.some((o) => o.keuze === sleutel)) return [];
    uit.push({ keuze: sleutel, label: `(${m[1].toLowerCase()}) ${kortTitel(deel, 60)}`, gevolg: deel });
  }
  return uit;
}

/**
 * Wat voor interactie dit eigenaarspunt is. In volgorde; de eerste die past
 * wint. Geen enkele stap leest het eerste woord van een titel — dat was de
 * fout: een keuze die met "kies" begon werd een handeling met één knop.
 */
/** Alternatieven met dezelfde sleutel zijn niet toe te wijzen aan een antwoord. */
function ontdubbelOpties(opties: readonly Optie[]): readonly Optie[] {
  const gezien = new Set<string>();
  return opties.filter((o) => (gezien.has(o.keuze) ? false : (gezien.add(o.keuze), true)));
}

export function bepaalEigenaarSoort(invoer: {
  readonly akkoordContext: boolean;
  readonly alternatieven: number;
  readonly labels: readonly string[];
}): EigenaarSoort {
  if (invoer.akkoordContext) return "akkoord";
  if (invoer.alternatieven >= 2) return "keuze";
  const heeft = (naam: string) => invoer.labels.some((l) => l.toLowerCase() === naam);
  if (heeft("extern")) return "externe-handeling";
  if (heeft("bevestig")) return "bevestiging";
  // Een punt dat zegt te wachten is geen handeling; dan ook geen knop die
  // suggereert van wel (CON-0016).
  if (heeft("wacht")) return "uitstel";
  // Anders: bevestiging, niet uitstel.
  //
  // Het uitvoeringsplan zet `uitstel` als terugval, en dat klopt zodra elk
  // dossierpunt expliciet zegt wat het is. Zolang dat niet zo is, betekent die
  // terugval iets anders: elk bestaand eigenaarspunt zonder `Extern`- of
  // `Bevestig`-regel verliest zijn enige knop en is voor de eigenaar niet meer
  // af te sluiten. Onafhankelijke QA heeft dat twee rondes achter elkaar als
  // verlies van werkend gedrag gemeten, en terecht: het is geen migratiepad
  // maar een regressie die pas bij de pin zichtbaar zou worden.
  //
  // `bevestiging` is hier de veilige terugval — de eigenaar kan zeggen dat het
  // gedaan is of dat het nog niet is — en hij breekt criterium 3 niet, want
  // "Gedaan" hoort bij dit soort. Zodra de dossiers zijn nagelopen (stap 5 van
  // het plan) kan de terugval alsnog naar `uitstel`; dat is dan een keuze met
  // een lege verzameling gevallen, geen stille breuk.
  return "bevestiging";
}

export function leesAandacht(invoer: ProjectInvoer): readonly AandachtItem[] {
  const items: AandachtItem[] = [];
  const p = invoer.id;

  if (!invoer.aangesloten && !invoer.aansluitingLoopt) {
    items.push({
      id: `${p}:aansluiten`,
      project: p,
      soort: "actie",
      // Aansluiten vraagt een handeling in de repository zelf; de eigenaar
      // meldt dat hij het gedaan heeft, Jarvis ziet het daarna vanzelf.
      interactie: "bevestiging",
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
      stappen: [],
      controle: null,
    });
    return items;
  }

  if (invoer.statusDocument) {
    const blok = leesItemsOnder(invoer.statusDocument, KOP_GEBLOKKEERD);
    const tekst = invoer.statusDocument.replace(/\r\n/g, "\n");
    const m = KOP_GEBLOKKEERD.exec(tekst);
    const sectie = m ? tekst.slice(m.index + m[0].length).split(/^## /m)[0].trim() : "";
    // De opmaaktekens eraf vóór de toets. `**Geen blokkade.**` bedoelt
    // hetzelfde als `Geen blokkade.`, maar greep niet: de sectie begon met een
    // sterretje, de toets faalde, en de zin werd zelf als blokkade opgevoerd —
    // met urgentie hoog in de lijst van de eigenaar. Dat kostte een volledige
    // pull request om terug te draaien.
    const nietsGeblokkeerd = /^(niets|geen|nvt|n\.v\.t\.)\b/i.test(sectie.replace(/^[*_#>\s]+/, ""));
    if (sectie.length > 0 && !nietsGeblokkeerd) {
      const bron: readonly GelezenItem[] =
        blok.length > 0 ? blok : [{ titel: kortTitel(sectie), toelichting: sectie, context: "", regels: [] }];
      for (const [i, b] of bron.entries()) {
        items.push({
          id: `${p}:blokkade:${i + 1}`,
          project: p,
          soort: "blokkade",
          interactie: null,
          titel: b.titel,
          toelichting: b.toelichting,
          bron: "docs/CURRENT_STATE.md",
          urgentie: "hoog",
          ...metWaarom(
            // Een blokkade uit het statusdocument heeft geen optieregels; wat
            // daar staat is toelichting, geen keuze.
            bouwOpties(b.regels, STANDAARD_BLOKKADE, "geen"),
            "Het werk staat stil tot dit is opgelost, en de oplossing ligt buiten wat Jarvis zelf kan doen.",
          ),
        });
      }
    }
  }

  const projectVoorRecord = (r: KnowledgeRecord): string => {
    for (const tag of r.tags ?? []) {
      const doel = invoer.tagProjecten?.[tag];
      if (doel) return doel;
    }
    return p;
  };

  for (const r of invoer.records) {
    if (r.type === "CFL" && r.status === "open") {
      items.push({
        id: `${p}:${r.id}`,
        project: projectVoorRecord(r),
        soort: "conflict",
        interactie: null,
        titel: r.titel,
        toelichting: r.samenvatting,
        bron: r.id,
        urgentie: "hoog",
        ...metWaarom(
          // De sectie `## Opties` van een record is per definitie een lijst
          // alternatieven; elke regel daarin is er een.
          bouwOpties(leesOptieRegels(r.opties), STANDAARD_BESLISSING, "elke-regel"),
          `Twee lezingen zijn allebei verdedigbaar en de repository beslist het niet (${(r.tussen ?? []).join(" tegenover ")}). ` +
            "Dit is een productkeuze die alleen jij kunt maken; tot die tijd bouwt Jarvis niets dat ervan afhangt.",
        ),
      });
    }
    // Een open risico met een lopende aanpak is werk van Jarvis, geen keuze
    // van de eigenaar; het staat dan niet in zijn lijst.
    if (r.type === "RSK" && r.status === "open" && !r.aanpak) {
      items.push({
        id: `${p}:${r.id}`,
        project: projectVoorRecord(r),
        soort: "risico",
        interactie: null,
        titel: r.titel,
        toelichting: r.samenvatting,
        bron: r.id,
        urgentie: r.impact === "hoog" ? "midden" : "laag",
        ...metWaarom(
          bouwOpties(leesOptieRegels(r.opties), risicoOpties(r), "elke-regel"),
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
      // Reconciliatie vóór de lijst, niet erna. Een punt dat aantoonbaar al
      // gedaan is (afgevinkt) of dat het akkoord op deze taak vraagt (dat
      // loopt over de akkoordkaart) is op dit moment geen handeling van de
      // eigenaar en hoort er dus niet in.
      if (isAfgevinkt(item.titel) || isAkkoordVraag(item.titel)) continue;
      const blokkerend = /blokkerend/i.test(item.context);
      const naMerge = /na merge/i.test(item.context);
      const akkoordContext = /akkoord[_ -]?pr/i.test(item.context);
      // De alternatieven komen uit eigen optieregels (de norm) of, voor
      // bestaande dossiers, uit een keuze die in één regel staat.
      // Alleen regels die zich als alternatief aandienen tellen mee. "Termijn"
      // en "Eigenaar" zijn geen keuzes; die maakten van elk punt met twee
      // losse labelregels een keuze met die labels als knoppen.
      // Alleen optieregels mét tekst tellen. Een `- Optie B:` zonder gevolg
      // leverde stil een "keuze" met één knop — of met alleen "Later" — en dat
      // is precies de kaart waarover de eigenaar klaagde: een vraag zonder
      // manier om te antwoorden.
      const uitRegels = item.regels.filter((r) => /^optie\b/i.test(r.label.trim()) && r.tekst.trim().length > 0);
      const keuzeRegel = item.regels.find((r) => r.label.toLowerCase() === "keuze");
      // Eén bron per keer, niet alles aan elkaar geplakt: dezelfde zin staat
      // vaak in de titel én in de toelichting én in de stapregel, en samen
      // geplakt levert dat elk alternatief drie keer op.
      // Het vangnet leest de tekst van het punt zelf en zijn stappen — nooit
      // een betekenisdragende labelregel. Een keuze die in `- Let op: …` of
      // `- Controle: …` stond, maakte anders het hele punt tot keuze en gaf de
      // eigenaar knoppen uit een waarschuwing; een `Controle` is bovendien werk
      // van Jarvis en nooit een handeling van de eigenaar (CON-0016).
      const vangnetBronnen = [
        ...item.regels.filter((r) => /^stap\s*\d+$/i.test(r.label.trim())).map((r) => r.tekst),
        item.toelichting,
        item.titel,
      ];
      const ingebed =
        uitRegels.length >= 2 ? [] : (vangnetBronnen.map((t) => leesIngebedeKeuze(t)).find((o) => o.length >= 2) ?? []);
      const alternatieven = uitRegels.length >= 2 ? ontdubbelOpties(uitRegels.map((r) => ({ keuze: sleutelVan(r.label), label: r.label, gevolg: r.tekst }))).length : ingebed.length;
      const interactie = bepaalEigenaarSoort({
        akkoordContext,
        alternatieven,
        labels: item.regels.map((r) => r.label),
      });
      // De titel is de hele vraag. Staat er een `Keuze`-regel, dan is dát de
      // vraag; anders de titel van het punt zelf.
      const titel = keuzeRegel ? kortTitel(keuzeRegel.tekst, 120) : item.titel;
      const gebouwd = bouwOpties(item.regels, KNOPPEN[interactie], "alleen-optie");
      // De knoppen volgen uit het soort — dat is de hele invariant van deze
      // verzameling, en hij mag niet van een toevallige labelregel afhangen.
      // `bouwOpties` laat elke niet-gereserveerde `- Label: tekst`-regel
      // vóórgaan op de standaardknoppen; daardoor verloor een externe
      // handeling zijn "Gedaan" zodra er een regel `- Let op: …` bij stond, en
      // kon een punt met een regel `- Gedaan: …` juist "Gedaan" tonen terwijl
      // het soort dat niet toestaat. Alleen bij een keuze zíjn de
      // alternatieven de knoppen; bij elk ander soort zijn ze het nooit.
      // De alternatieven komen uit de optieregels zelf, niet uit wat
      // `bouwOpties` er verder van maakt: anders glippen losse labelregels als
      // `- Let op: …` er alsnog als knop tussen.
      const uitOptieregels = uitRegels.map((r) => ({ keuze: sleutelVan(r.label), label: r.label, gevolg: r.tekst }));
      const alternatieveOpties = uitOptieregels.length >= 2 ? ontdubbelOpties(uitOptieregels) : ingebed;
      const opties =
        interactie === "keuze" && alternatieveOpties.length >= 2
          ? [...alternatieveOpties, OPTIE_LATER]
          : [...KNOPPEN[interactie === "keuze" ? "uitstel" : interactie], OPTIE_LATER];
      items.push({
        id: `${p}:${taak.id}:${korteSleutel(item.titel)}`,
        project: taak.opdracht["project"] ?? p,
        soort: interactie === "keuze" || interactie === "akkoord" ? "beslissing" : "actie",
        interactie,
        titel,
        toelichting: item.context ? `${item.context}. ${item.toelichting}` : item.toelichting,
        bron: `tasks/${taak.id}/resultaat.md`,
        urgentie: blokkerend ? "hoog" : naMerge ? "laag" : "midden",
        ...metWaarom(
          { ...gebouwd, opties },
          `Staat in het resultaat van ${taak.id} als punt dat alleen de eigenaar kan doen.`,
        ),
      });
    }
    const markeringen = taak.resultaat.match(/HUMAN_ACTION_REQUIRED[^\n]*/g) ?? [];
    for (const [i, m] of markeringen.entries()) {
      items.push({
        id: `${p}:${taak.id}:human-action:${i + 1}`,
        project: taak.opdracht["project"] ?? p,
        soort: "actie",
        interactie: "externe-handeling",
        titel: kortTitel(m.replace(/^HUMAN_ACTION_REQUIRED\W*/, "")),
        toelichting: m,
        bron: `tasks/${taak.id}/resultaat.md`,
        urgentie: "hoog",
        waarom: "Een agent kan dit niet zonder jouw toegang of toestemming; daarom staat er een markering in het taakdossier.",
        opties: [...STANDAARD_HUMAN, OPTIE_LATER],
        advies: null,
        stappen: [],
        controle: null,
      });
    }
  }

  return sorteerAandacht(items);
}

// ---------------------------------------------------------------------------
// Samenstellen
// ---------------------------------------------------------------------------

const KOP_VOORTGANG = /^## Voortgang\s*$/m;

/**
 * De checklist onder `## Voortgang` in resultaat.md: regels `- [x] ...` en
 * `- [ ] ...`, in volgorde. Een ingesprongen vervolgregel hoort bij de stap.
 */
export function leesVoortgang(resultaat: string | null): readonly TaakStap[] {
  if (!resultaat) return [];
  const tekst = resultaat.replace(/\r\n/g, "\n");
  const m = KOP_VOORTGANG.exec(tekst);
  if (!m) return [];
  const vanaf = tekst.slice(m.index + m[0].length);
  const volgende = /^## /m.exec(vanaf);
  const sectie = volgende ? vanaf.slice(0, volgende.index) : vanaf;
  const stappen: { tekst: string; gedaan: boolean }[] = [];
  for (const regel of sectie.split("\n")) {
    const stap = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(regel);
    if (stap) stappen.push({ tekst: stap[2].trim(), gedaan: stap[1] !== " " });
    else if (stappen.length > 0 && /^\s{2,}\S/.test(regel)) stappen[stappen.length - 1].tekst += ` ${regel.trim()}`;
  }
  return stappen;
}

/**
 * Vraagt de eigenaarslijst van dit dossier het akkoord op de taak zelf? Alleen
 * een punt dat nog niet is afgevinkt telt; een afgevinkt akkoord is gegeven.
 */
function vraagtAkkoord(resultaat: string | null): boolean {
  if (!resultaat) return false;
  return leesItemsOnder(resultaat, KOP_EIGENAAR).some(
    (item) => !isAfgevinkt(item.titel) && isAkkoordVraag(item.titel),
  );
}

export function leesTaken(
  taken: readonly TaakDossier[],
  gastheer: string,
  recent: readonly RecentItem[] = [],
  aandacht: readonly AandachtItem[] = [],
  nu: Date = new Date(),
): readonly TaakItem[] {
  return taken
    .map((t): TaakItem => {
      const status = t.opdracht["status"] ?? "onbekend";
      const stappen = leesVoortgang(t.resultaat);
      const openVoorEigenaar = aandacht.filter((a) => a.bron.startsWith(`tasks/${t.id}/`));
      const laatste = recent.filter((r) => r.taak === t.id).map((r) => r.datum).sort().pop() ?? null;
      const volgendeStap = stappen.find((s) => !s.gedaan)?.tekst ?? null;
      const actief = status === "actief" || status === "review";
      // Twee wegen naar hetzelfde akkoord, zodat het nooit wegvalt én nooit
      // dubbel staat: de voortgangslijst (`Akkoord van de eigenaar op …` als
      // eerste open stap) en de eigenaarslijst (`geef in de app akkoord op
      // deze taak`). Het punt uit de eigenaarslijst is hierboven uit de
      // aandachtlijst gehouden; deze kaart neemt het over.
      const akkoord_nodig =
        actief &&
        t.tekst !== undefined &&
        ((volgendeStap !== null && isAkkoordStap(volgendeStap)) || vraagtAkkoord(t.resultaat));
      // De eigenaar gaat voor: een openstaand punt of een akkoordvraag is een
      // echte handeling van een mens, en die verdwijnt niet doordat de stap
      // daarnaast ergens op wacht. Pas daarna telt de wachtreden.
      const wachtreden = !actief || openVoorEigenaar.length > 0 || akkoord_nodig ? null : wachtredenVanStap(volgendeStap);
      const aan_zet: TaakItem["aan_zet"] = !actief
        ? "niemand"
        : openVoorEigenaar.length > 0 || akkoord_nodig
          ? "eigenaar"
          : wachtreden !== null
            ? "wacht"
            : "jarvis";
      const dagenStil = laatste ? (nu.getTime() - new Date(laatste).getTime()) / 864e5 : Infinity;
      return {
        id: t.id,
        // `?? id` grijpt alleen bij een ontbrekend veld; een lege of
        // alleen-witruimte-titel gaf een lege cel in plaats van het taak-id.
        // `|| id` vangt allebei.
        titel: t.opdracht["titel"]?.trim() || t.id,
        status,
        klasse: t.opdracht["klasse"] ?? null,
        project: t.opdracht["project"] ?? gastheer,
        gastheer,
        stappen,
        aan_zet,
        wacht_soort: wachtreden?.soort ?? null,
        wacht_op:
          openVoorEigenaar.length > 0
            ? openVoorEigenaar[0].titel
            : (wachtredenTekst(wachtreden) ?? (volgendeStap === null ? null : kortAf(volgendeStap, 160))),
        laatste_beweging: laatste,
        stil: aan_zet === "jarvis" && dagenStil >= STIL_NA_DAGEN,
        scope: actief && t.tekst !== undefined ? t.tekst.replace(/\r\n/g, "\n") : null,
        scope_hash: actief && t.tekst !== undefined ? scopeHash(t.tekst) : null,
        akkoord_nodig,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Een taak telt als open zolang er nog aan gewerkt of over geoordeeld wordt. */
const OPEN_STATUSSEN = new Set(["actief", "review"]);

/**
 * De open taken zoals het feitenblok ze noemt: afleidbaar uit de
 * taakdossiers in de repository, dus een feit en geen narratief.
 *
 * Het faalpad dat dit dichtzet: `CURRENT_STATE.md` meldde "Open taken: geen"
 * terwijl er negen actieve taken lagen, omdat de verzamelaar het veld
 * hardgecodeerd leeg meegaf. Een statusdocument dat achterloopt maar wél
 * vertrouwd wordt, is erger dan geen statusdocument.
 */
export function openTakenUitDossiers(taken: readonly TaakDossier[]): readonly OpenTaak[] {
  return taken
    .map(velden)
    .filter((t) => OPEN_STATUSSEN.has(t.status))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * De drie velden waarmee een taak in het feitenblok verschijnt.
 *
 * De terugval grijpt op lege en op witte waarden, niet alleen op een
 * ontbrekend veld: `titel: ""` of `titel: "   "` in de front-matter gaf een
 * lege cel, en een taak zonder zichtbare naam is in de tabel niet te
 * onderscheiden van een fout in de generator.
 */
function velden(t: TaakDossier): OpenTaak {
  return {
    id: t.id,
    // `?? id` grijpt alleen bij een ontbrekend veld; een lege of
    // alleen-witruimte-titel gaf een lege cel in plaats van het taak-id.
    // `|| id` vangt allebei.
    titel: t.opdracht["titel"]?.trim() || t.id,
    status: t.opdracht["status"] ?? "onbekend",
  };
}

/** De statussen die een taakdossier bewust kan dragen. */
const BEKENDE_STATUSSEN = new Set([...OPEN_STATUSSEN, "afgerond"]);

/**
 * De dossiers die noch open noch afgerond zijn — kapotte front-matter, een
 * ontbrekende `status`, of een woord dat de engine niet kent (`open`,
 * `gepland`).
 *
 * Zulke dossiers vallen uit het feitenblok zonder dat iemand het merkt: de
 * filter laat ze weg en `state` eindigt met 0. Dat is precies het faalpad dat
 * `openTakenUitDossiers` dichtzette — een statusdocument dat achterloopt maar
 * wél vertrouwd wordt — alleen per dossier in plaats van repositorybreed.
 * Deze functie maakt ze zichtbaar; wat de aanroeper ermee doet, bepaalt hij
 * zelf.
 */
export function dossiersZonderBekendeStatus(taken: readonly TaakDossier[]): readonly OpenTaak[] {
  return taken
    .map(velden)
    .filter((t) => !BEKENDE_STATUSSEN.has(t.status))
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
    taken: leesTaken(invoer.taken, invoer.id, leesRecent(invoer.gitLog, nu), leesAandacht(invoer), nu),
    kennis: telKennis(invoer.records),
    aandacht: leesAandacht(invoer),
  };
}

/**
 * Een taakdossier kan over een ander project gaan dan het project dat het
 * draagt (`project:` in de front-matter): de aansluiting van een nieuw project
 * leeft in de repository die Jarvis al heeft, maar hoort in het overzicht bij
 * dat nieuwe project. Items en taken verhuizen dan; bestaat het doelproject
 * niet in het overzicht, dan blijven ze staan waar ze zijn.
 */
function herverdeel(projecten: readonly ProjectOverzicht[]): readonly ProjectOverzicht[] {
  const ids = new Set(projecten.map((p) => p.id));
  // Waar een taak heen gaat: het project dat zij zegt te zijn, als dat bestaat;
  // anders blijft zij bij de repository die het dossier draagt.
  const doelVan = (bronId: string, t: TaakItem): string => (ids.has(t.project) ? t.project : bronId);

  // Eerst globaal ontdubbelen, dan pas verdelen. Andersom — per doelproject,
  // zoals het eerst was — grijpt de dedup alleen wanneer de kopieën toevallig
  // in hetzelfde doelproject belanden. Noemt het dossier een `project:` dat
  // geen bestaand project-id is, dan blijft elke kopie in haar eigen bron en
  // komen ze elkaar nooit tegen: het overzicht toonde dan nog steeds één
  // dossier als twee of drie taakregels.
  const gekozen = eenTaakregelPerDossier(projecten.flatMap((bron) => bron.taken.map((t) => ({ bronId: bron.id, t }))));

  return projecten.map((doel) => ({
    ...doel,
    aandacht: sorteerAandacht(
      eenAandachtPerBron(
        projecten.flatMap((bron) =>
          bron.aandacht.filter((a) => (ids.has(a.project) ? a.project === doel.id : bron.id === doel.id)),
        ),
      ),
    ),
    taken: gekozen
      .filter(({ bronId, t }) => doelVan(bronId, t) === doel.id)
      .map(({ t }) => t)
      .sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

/**
 * Eén taakregel per dossier-id. Een dossier dat in meer dan één aangesloten
 * repository staat — een dossierspiegel — passeerde het filter hierboven per
 * bron en kwam dus tweemaal in de kaart. `bepaalRegie` had die wacht al
 * (`gezien`), het overzicht niet, en daardoor telde de interface meer werk
 * dan er bestond.
 *
 * Welke kopie wint: die van het project dat de taak zegt te zijn
 * (`gastheer === project`), want dat is de repository waar de commits landen
 * en waar het dossier dus het verst is. Is die er niet, dan de eerste — de
 * bronvolgorde is vast, dus de uitkomst is dat ook.
 */
/**
 * Eén aandachtpunt per bron en titel. Een gespiegeld dossier leverde hetzelfde
 * eigenaarspunt twee keer, met alleen een ander project-voorvoegsel in het id.
 * De eigenaar zag dan één handeling als twee, en de teller "X voor jou" telde
 * te hoog — precies het soort verschil dat de lijst onbetrouwbaar maakt.
 */
function eenAandachtPerBron(items: readonly AandachtItem[]): AandachtItem[] {
  const gezien = new Map<string, AandachtItem>();
  for (const a of items) {
    const sleutel = `${a.bron}\u0000${a.titel}`;
    if (!gezien.has(sleutel)) gezien.set(sleutel, a);
  }
  return [...gezien.values()];
}

function eenTaakregelPerDossier<T extends { readonly t: TaakItem }>(rijen: readonly T[]): T[] {
  const perId = new Map<string, T>();
  for (const rij of rijen) {
    const bestaand = perId.get(rij.t.id);
    if (bestaand === undefined || beterDossier(rij.t, bestaand.t)) perId.set(rij.t.id, rij);
  }
  return [...perId.values()];
}

/**
 * Welke kopie van een gespiegeld dossier het beeld bepaalt. Dit moet een
 * inhoudelijke keuze zijn, geen toevallige: twee kopieën van hetzelfde dossier
 * lopen in de praktijk uiteen — de ene repository is verder dan de andere — en
 * wie dan "de eerste" neemt, laat de uitkomst afhangen van de volgorde waarin
 * de projecten toevallig zijn meegegeven. Dezelfde taak kreeg zo een andere
 * `aan_zet` naar gelang welke repository de ronde draaide.
 *
 * Wint, in deze volgorde: de kopie in de repository die de taak zegt te zijn;
 * anders de kopie die het verst is (de meeste afgevinkte stappen); anders de
 * kopie met de meeste stappen; anders de eerste, en dan is het ook echt gelijk.
 */
function beterDossier(nieuw: TaakItem, oud: TaakItem): boolean {
  const eigen = (t: TaakItem): number => (t.gastheer === t.project ? 1 : 0);
  if (eigen(nieuw) !== eigen(oud)) return eigen(nieuw) > eigen(oud);
  const gedaan = (t: TaakItem): number => t.stappen.filter((s) => s.gedaan).length;
  if (gedaan(nieuw) !== gedaan(oud)) return gedaan(nieuw) > gedaan(oud);
  return nieuw.stappen.length > oud.stappen.length;
}

/**
 * Een stap "wacht op T-…" maakt een taak afhankelijk van een andere: wie daar
 * aan zet is, is het hier ook, en de taak is dan niet "stil" maar "wacht".
 * Pas na de verdeling over projecten, want de andere taak kan elders hangen.
 */
const WACHT_OP = /wacht op\s+(T-\d{8}-[a-z0-9-]+)/i;
export function verbindAfhankelijkheden(projecten: readonly ProjectOverzicht[]): readonly ProjectOverzicht[] {
  const alle = new Map(projecten.flatMap((p) => p.taken.map((t) => [t.id, t] as const)));
  const opgelost = new Map<string, TaakItem>();
  const los = (t: TaakItem, diepte = 0): TaakItem => {
    const klaar = opgelost.get(t.id);
    if (klaar) return klaar;
    const stap = t.stappen.find((s) => !s.gedaan)?.tekst ?? "";
    const m = WACHT_OP.exec(stap);
    const dep = m && m[1] !== t.id && diepte < 5 ? alle.get(m[1]) : undefined;
    const uit: TaakItem = dep
      ? (() => {
          const d = los(dep, diepte + 1);
          // Wachten op een andere taak is wachten, ook wanneer die taak zelf
          // wel loopt. Dit zette de uitkomst van `leesTaken` eerder terug op
          // "jarvis", zodat de kaart "JARVIS AAN ZET" toonde over een taak die
          // de regie WAITING_FOR_DEPENDENCY noemt — precies de tweespalt die
          // `wacht` moest opheffen. De eigenaar gaat nog steeds voor: wacht de
          // andere taak op hém, dan is dat hier ook de eerlijke weergave.
          return {
            ...t,
            aan_zet: d.aan_zet === "eigenaar" ? "eigenaar" : "wacht",
            wacht_soort: d.aan_zet === "eigenaar" ? null : "taak",
            wacht_op: `${d.id}: ${d.wacht_op ?? d.titel}`,
            stil: false,
          };
        })()
      : t;
    opgelost.set(t.id, uit);
    return uit;
  };
  return projecten.map((p) => ({ ...p, taken: p.taken.map((t) => los(t)) }));
}

/**
 * De vakken waarin het werk uiteenvalt. Ze zijn wederzijds uitsluitend en
 * samen volledig: elke taak valt in precies één vak. Dat is de hele reden dat
 * ze bestaan — de eigenaar kon actief werk, backlog, geparkeerd werk en
 * wachtend werk niet uit elkaar houden, omdat alles wat niet van hem was als
 * "Jarvis aan zet" op één hoop kwam.
 */
export type StandVak = "actief" | "backlog" | "bij_jou" | "wacht" | "geparkeerd" | "afgerond";

/** Eén taak, ingedeeld, met de reden in de woorden van de kaart. */
export type IngedeeldeTaak = {
  readonly id: string;
  readonly titel: string;
  readonly project: string;
  readonly status: string;
  readonly vak: StandVak;
  /** Waarom dit vak. Kort genoeg voor een regel onder de titel. */
  readonly reden: string;
  readonly stil: boolean;
  readonly wacht_soort: TaakItem["wacht_soort"];
  readonly laatste_beweging: string | null;
};

/** Eén open risico of blokkade: geen taak, wel iets dat zichtbaar moet blijven. */
export type IngedeeldRisico = {
  readonly id: string;
  readonly project: string;
  readonly titel: string;
  readonly soort: AandachtSoort;
  readonly urgentie: Urgentie;
};

export type Indeling = {
  readonly actief: readonly IngedeeldeTaak[];
  readonly backlog: readonly IngedeeldeTaak[];
  readonly bij_jou: readonly IngedeeldeTaak[];
  readonly wacht: readonly IngedeeldeTaak[];
  readonly geparkeerd: readonly IngedeeldeTaak[];
  readonly afgerond: readonly IngedeeldeTaak[];
  readonly risicos: readonly IngedeeldRisico[];
  /**
   * Er is geen actief werk. Uitsluitend daarop gebaseerd, niet op "niets te
   * zien": backlog, wachtend werk en risico's kunnen bestaan en blijven dan
   * ook staan. Een nulstand is een uitspraak, geen leegte.
   */
  readonly nulstand: boolean;
};

const WACHT_REDEN: Record<NonNullable<TaakItem["wacht_soort"]>, string> = {
  gebeurtenis: "wacht op een gebeurtenis buiten Jarvis",
  uitvoerder: "wacht op een andere uitvoerder",
  taak: "wacht op een andere taak",
  "pull-request": "wacht op een pull request",
};

/** In welk vak deze taak valt, en waarom. */
function vakVan(t: TaakItem): { readonly vak: StandVak; readonly reden: string } {
  if (t.status === "afgerond") return { vak: "afgerond", reden: "afgerond" };
  if (t.aan_zet === "eigenaar") return { vak: "bij_jou", reden: t.wacht_op ?? "een handeling van jou" };
  if (t.aan_zet === "wacht") return { vak: "wacht", reden: t.wacht_soort === null ? "wacht" : WACHT_REDEN[t.wacht_soort] };
  if (t.aan_zet === "niemand") return { vak: "geparkeerd", reden: `bewust niet actief (status ${t.status})` };
  // Jarvis is aan zet. Beweging in het venster scheidt werk dat loopt van werk
  // dat klaarligt: zonder dat onderscheid leest een volle wachtrij als een
  // druk systeem, ook wanneer er aan geen enkele taak iets gebeurt.
  return t.laatste_beweging !== null
    ? { vak: "actief", reden: "Jarvis aan zet; er is aan gewerkt" }
    : { vak: "backlog", reden: "Jarvis aan zet; nog niemand aan begonnen" };
}

/**
 * De indeling, afgeleid uit het overzicht dat er al staat. Puur: geen tweede
 * bron, geen eigen meting. Een taak die in meer dan één project voorkomt is
 * hierboven al door `herverdeel` teruggebracht tot één regel.
 */
export function deelIn(projecten: readonly ProjectOverzicht[], voor_jou: readonly AandachtItem[]): Indeling {
  const vakken: Record<StandVak, IngedeeldeTaak[]> = {
    actief: [],
    backlog: [],
    bij_jou: [],
    wacht: [],
    geparkeerd: [],
    afgerond: [],
  };
  for (const p of projecten) {
    for (const t of p.taken) {
      const { vak, reden } = vakVan(t);
      vakken[vak].push({
        id: t.id,
        titel: t.titel,
        project: t.project,
        status: t.status,
        vak,
        reden,
        stil: t.stil,
        wacht_soort: t.wacht_soort,
        laatste_beweging: t.laatste_beweging,
      });
    }
  }
  return {
    ...vakken,
    risicos: voor_jou
      .filter((a) => a.soort === "risico" || a.soort === "blokkade")
      .map((a) => ({ id: a.id, project: a.project, titel: a.titel, soort: a.soort, urgentie: a.urgentie })),
    nulstand: vakken.actief.length === 0,
  };
}

export function bouwOverzicht(projecten: readonly ProjectInvoer[], nu: Date, centraal: string | null = null): Overzicht {
  const uitgewerkt = verbindAfhankelijkheden(herverdeel(projecten.map((p) => bouwProjectOverzicht(p, nu))));
  const voor_jou = sorteerAandacht(uitgewerkt.flatMap((p) => p.aandacht));
  return {
    versie: OVERZICHT_VERSIE,
    gegenereerd_op: nu.toISOString(),
    centraal: centraal && uitgewerkt.some((p) => p.id === centraal) ? centraal : null,
    projecten: uitgewerkt,
    voor_jou,
    indeling: deelIn(uitgewerkt, voor_jou),
  };
}
