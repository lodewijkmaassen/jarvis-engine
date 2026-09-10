// Deterministische term-based retrieval over kennisrecords.
//
// Geen embeddings, geen LLM, geen netwerk: een tf-idf-variant met
// veldgewichten en verzadiging. Dezelfde index + dezelfde query geven altijd
// exact dezelfde lijst, inclusief volgorde. Dat is de hele bestaansreden —
// een context manifest dat morgen anders scoort is waardeloos als bewijs.
import type { KnowledgeRecord, RecordType } from "./records";
import { recordTextFields } from "./records";
import { tokenize, uniqueTokens } from "./text";

/**
 * Veldgewichten. Een treffer in de titel weegt zwaarder dan één diep in de
 * motivatie. Gehele getallen, zodat de scoreberekening geen extra
 * afrondingsruis krijgt.
 */
const VELDGEWICHTEN: Readonly<Record<string, number>> = {
  titel: 4,
  tags: 3,
  samenvatting: 2,
};
const STANDAARD_GEWICHT = 1;

/** Verzadigingsconstante: de 5e treffer van een term mag niet 5x zo zwaar wegen. */
const K_VERZADIGING = 1.2;

/** Schaal waarop scores worden afgerond, zodat float-ruis nooit de volgorde bepaalt. */
const SCORE_PRECISIE = 1e6;

function rond(score: number): number {
  return Math.round(score * SCORE_PRECISIE) / SCORE_PRECISIE;
}

export type IndexedRecord = {
  readonly record: KnowledgeRecord;
  /** Gewogen termfrequentie per token binnen dit record. */
  readonly gewichten: ReadonlyMap<string, number>;
};

export type KnowledgeIndex = {
  readonly records: readonly IndexedRecord[];
  /** Aantal records waarin een token voorkomt. */
  readonly documentFrequentie: ReadonlyMap<string, number>;
  readonly aantalRecords: number;
};

/**
 * Bouwt de index. Records worden op id gesorteerd opgeslagen, zodat ook de
 * interne volgorde onafhankelijk is van de aanleveringsvolgorde.
 */
export function buildIndex(records: readonly KnowledgeRecord[]): KnowledgeIndex {
  const gesorteerd = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const documentFrequentie = new Map<string, number>();
  const geindexeerd: IndexedRecord[] = [];

  for (const record of gesorteerd) {
    const gewichten = new Map<string, number>();
    for (const { veld, tekst } of recordTextFields(record)) {
      const gewicht = VELDGEWICHTEN[veld] ?? STANDAARD_GEWICHT;
      for (const token of tokenize(tekst)) {
        gewichten.set(token, (gewichten.get(token) ?? 0) + gewicht);
      }
    }
    for (const token of gewichten.keys()) {
      documentFrequentie.set(token, (documentFrequentie.get(token) ?? 0) + 1);
    }
    geindexeerd.push({ record, gewichten });
  }

  return {
    records: geindexeerd,
    documentFrequentie,
    aantalRecords: geindexeerd.length,
  };
}

export type RetrievalFilters = {
  /** Alleen deze recordtypes. Leeg/weggelaten = alle types. */
  readonly types?: readonly RecordType[];
  /** Record moet ALLE genoemde tags hebben. */
  readonly tags?: readonly string[];
  /** Alleen records met datum >= deze datum (JJJJ-MM-DD, lexicografisch veilig). */
  readonly vanaf?: string;
};

export type RetrievalOptions = RetrievalFilters & {
  /** Maximum aantal resultaten. Standaard 5. */
  readonly limiet?: number;
  /** Ondergrens; records met een lagere score vallen af. Standaard > 0. */
  readonly minimumScore?: number;
};

export type TermBijdrage = {
  readonly term: string;
  readonly bijdrage: number;
};

export type RetrievalHit = {
  readonly record: KnowledgeRecord;
  readonly score: number;
  /** Welke querytermen deze treffer verklaren, hoogste bijdrage eerst. */
  readonly termen: readonly TermBijdrage[];
};

export type RetrievalResult = {
  /** De query zoals aangeleverd. */
  readonly query: string;
  /** Unieke, genormaliseerde querytermen (stopwoorden eruit). */
  readonly termen: readonly string[];
  readonly hits: readonly RetrievalHit[];
  /** Aantal records dat de filters doorstond (vóór minimumScore/limiet). */
  readonly onderzocht: number;
};

function voldoetAanFilters(record: KnowledgeRecord, filters: RetrievalFilters): boolean {
  if (filters.types && filters.types.length > 0 && !filters.types.includes(record.type)) {
    return false;
  }
  if (filters.tags && filters.tags.length > 0) {
    const eigen = new Set(record.tags.map((t) => t.toLowerCase()));
    for (const tag of filters.tags) {
      if (!eigen.has(tag.toLowerCase())) return false;
    }
  }
  if (filters.vanaf && record.datum < filters.vanaf) return false;
  return true;
}

/**
 * Inverse document frequency. `ln(1 + N/df)` blijft positief, ook als een
 * term in álle records voorkomt — zo'n term draagt dan weinig bij maar
 * verandert nooit van teken.
 */
function idf(index: KnowledgeIndex, term: string): number {
  const df = index.documentFrequentie.get(term) ?? 0;
  if (df === 0) return 0;
  return Math.log(1 + index.aantalRecords / df);
}

/**
 * Zoekt records bij een query.
 *
 * Sorteervolgorde: score aflopend, bij gelijke (afgeronde) score het id
 * oplopend. Nooit op invoegvolgorde — die is geen eigenschap van de kennis.
 */
export function search(
  index: KnowledgeIndex,
  query: string,
  options: RetrievalOptions = {},
): RetrievalResult {
  const termen = uniqueTokens(query);
  const limiet = options.limiet ?? 5;
  const minimumScore = options.minimumScore ?? 0;

  const kandidaten = index.records.filter((entry) =>
    voldoetAanFilters(entry.record, options),
  );

  const hits: RetrievalHit[] = [];
  for (const entry of kandidaten) {
    const bijdragen: TermBijdrage[] = [];
    let totaal = 0;
    for (const term of termen) {
      const tf = entry.gewichten.get(term);
      if (!tf) continue;
      const verzadigd = tf / (tf + K_VERZADIGING);
      const bijdrage = rond(idf(index, term) * verzadigd);
      if (bijdrage <= 0) continue;
      bijdragen.push({ term, bijdrage });
      totaal += bijdrage;
    }
    const score = rond(totaal);
    if (score <= minimumScore) continue;
    bijdragen.sort((a, b) =>
      b.bijdrage !== a.bijdrage ? b.bijdrage - a.bijdrage : a.term < b.term ? -1 : 1,
    );
    hits.push({ record: entry.record, score, termen: bijdragen });
  }

  hits.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : a.record.id < b.record.id
        ? -1
        : a.record.id > b.record.id
          ? 1
          : 0,
  );

  return {
    query,
    termen,
    hits: hits.slice(0, Math.max(0, limiet)),
    onderzocht: kandidaten.length,
  };
}
