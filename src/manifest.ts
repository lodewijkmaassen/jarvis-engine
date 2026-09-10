// Context manifest: het bewijsstuk onder een Jarvis-antwoord.
//
// Een manifest legt vast WELKE kennisrecords en WELKE bronbestanden onder een
// antwoord lagen, elk met een hash. Daarmee is later hard vast te stellen of
// de grond onder dat antwoord nog hetzelfde is (drift-detectie) — het verschil
// tussen "de AI dacht dit ooit" en "dit klopt nu nog steeds".
//
// De module is puur op één punt na: bestandsinhoud komt binnen via een
// geïnjecteerde ReadSource. Er wordt hier nooit zelf een pad opgelost.
import { z } from "zod";
import {
  canonicalJson,
  gitBlobHash,
  gitBlobHashOfValue,
  sha256,
  type JsonValue,
} from "./hash";
import type { KnowledgeRecord } from "./records";
import { RECORD_TYPES } from "./records";
import type { RetrievalResult } from "./retrieval";

export const MANIFEST_VERSIE = 1 as const;

/**
 * Leest een repo-relatief bronpad. `null` = bestaat niet (of is niet
 * leesbaar); dat is een geldige uitkomst, geen exception.
 */
export type ReadSource = (pad: string) => Promise<string | null>;

export type ManifestRecordEntry = {
  readonly id: string;
  readonly type: string;
  readonly score: number;
  /** Git-blob-hash over de canonieke JSON van het record. */
  readonly hash: string;
  /** Querytermen die deze treffer verklaarden. */
  readonly termen: readonly string[];
};

export type ManifestSourceEntry = {
  readonly pad: string;
  /** Git-blob-hash, na te rekenen met `git hash-object <pad>`. */
  readonly blob: string;
  readonly bytes: number;
};

export type ContextManifest = {
  readonly manifestVersie: typeof MANIFEST_VERSIE;
  /** Expliciet meegegeven; nooit uit een verborgen klok. */
  readonly gegenereerdOp: string;
  readonly query: string;
  readonly termen: readonly string[];
  readonly records: readonly ManifestRecordEntry[];
  readonly bronnen: readonly ManifestSourceEntry[];
  /** Bronpaden waarnaar records verwijzen maar die niet gelezen konden worden. */
  readonly ontbrekendeBronnen: readonly string[];
  /** SHA-256 over de canonieke JSON van alle bovenstaande velden. */
  readonly manifestHash: string;
};

const manifestRecordSchema = z.strictObject({
  id: z.string().min(1),
  type: z.enum(RECORD_TYPES),
  score: z.number(),
  hash: z.string().regex(/^[0-9a-f]{40}$/, "verwacht een SHA-1 hex-hash"),
  termen: z.array(z.string()),
});

const manifestSourceSchema = z.strictObject({
  pad: z.string().min(1),
  blob: z.string().regex(/^[0-9a-f]{40}$/, "verwacht een SHA-1 hex-hash"),
  bytes: z.number().int().nonnegative(),
});

/** Schema voor een manifest dat van buiten komt (bestand, API, plakwerk). */
export const contextManifestSchema = z.strictObject({
  manifestVersie: z.literal(MANIFEST_VERSIE),
  gegenereerdOp: z.string().min(1),
  query: z.string(),
  termen: z.array(z.string()),
  records: z.array(manifestRecordSchema),
  bronnen: z.array(manifestSourceSchema),
  ontbrekendeBronnen: z.array(z.string()),
  manifestHash: z.string().regex(/^[0-9a-f]{64}$/, "verwacht een SHA-256 hex-hash"),
});

/** De velden waarover de manifesthash wordt berekend (dus zonder de hash zelf). */
function manifestBody(manifest: Omit<ContextManifest, "manifestHash">): JsonValue {
  return {
    manifestVersie: manifest.manifestVersie,
    gegenereerdOp: manifest.gegenereerdOp,
    query: manifest.query,
    termen: [...manifest.termen],
    records: manifest.records.map((r) => ({
      id: r.id,
      type: r.type,
      score: r.score,
      hash: r.hash,
      termen: [...r.termen],
    })),
    bronnen: manifest.bronnen.map((b) => ({ pad: b.pad, blob: b.blob, bytes: b.bytes })),
    ontbrekendeBronnen: [...manifest.ontbrekendeBronnen],
  };
}

/** Herberekent de manifesthash. Puur — handig om een manifest te controleren. */
export function computeManifestHash(manifest: Omit<ContextManifest, "manifestHash">): string {
  return sha256(canonicalJson(manifestBody(manifest)));
}

/** Git-blob-hash van één kennisrecord (over de canonieke JSON). */
export function recordHash(record: KnowledgeRecord): string {
  return gitBlobHashOfValue(record as unknown as JsonValue);
}

export type ManifestOptions = {
  readonly gegenereerdOp: string;
  readonly readSource: ReadSource;
  /**
   * Extra bronpaden die naast de recordbronnen in het manifest moeten komen:
   * de codebestanden die het contextpakket zelf heeft opgenomen. Zonder deze
   * zou het manifest wel bewijzen welke KENNIS onder een antwoord lag, maar
   * niet welke CODE — en juist daar zit de drift.
   */
  readonly extraBronnen?: readonly string[];
};

/**
 * Bouwt een manifest bij een retrievalresultaat.
 *
 * Bronnen zijn de vereniging van alle `bronnen` van de gevonden records,
 * ontdubbeld en gesorteerd — nooit de volgorde waarin ze toevallig langskwamen.
 */
export async function buildManifest(
  resultaat: RetrievalResult,
  options: ManifestOptions,
): Promise<ContextManifest> {
  const records: ManifestRecordEntry[] = resultaat.hits.map((hit) => ({
    id: hit.record.id,
    type: hit.record.type,
    score: hit.score,
    hash: recordHash(hit.record),
    termen: hit.termen.map((t) => t.term),
  }));

  const paden = [
    ...new Set([
      ...resultaat.hits.flatMap((hit) => [...hit.record.bronnen]),
      ...(options.extraBronnen ?? []),
    ]),
  ].sort();

  const bronnen: ManifestSourceEntry[] = [];
  const ontbrekendeBronnen: string[] = [];
  for (const pad of paden) {
    const inhoud = await options.readSource(pad);
    if (inhoud === null) {
      ontbrekendeBronnen.push(pad);
      continue;
    }
    bronnen.push({
      pad,
      blob: gitBlobHash(inhoud),
      bytes: Buffer.byteLength(inhoud, "utf8"),
    });
  }

  const body = {
    manifestVersie: MANIFEST_VERSIE,
    gegenereerdOp: options.gegenereerdOp,
    query: resultaat.query,
    termen: [...resultaat.termen],
    records,
    bronnen,
    ontbrekendeBronnen,
  } satisfies Omit<ContextManifest, "manifestHash">;

  return { ...body, manifestHash: computeManifestHash(body) };
}

export const DRIFT_CODES = [
  "manifest_hash_ongeldig",
  "record_ontbreekt",
  "record_gewijzigd",
  "bron_ontbreekt",
  "bron_gewijzigd",
  "bron_teruggekeerd",
] as const;
export type DriftCode = (typeof DRIFT_CODES)[number];

export type DriftBevinding = {
  readonly code: DriftCode;
  /** "drift" blokkeert hergebruik van het manifest; "info" is signalering. */
  readonly severity: "drift" | "info";
  /** Record-id of bronpad waar het over gaat. */
  readonly onderwerp: string;
  readonly verwacht: string | null;
  readonly gevonden: string | null;
  readonly boodschap: string;
};

export type VerificationResult = {
  /** true zodra er geen enkele bevinding met severity "drift" is. */
  readonly ok: boolean;
  readonly bevindingen: readonly DriftBevinding[];
  /** Aantal records/bronnen dat ongewijzigd is bevonden. */
  readonly ongewijzigd: number;
};

function bevinding(
  code: DriftCode,
  severity: "drift" | "info",
  onderwerp: string,
  verwacht: string | null,
  gevonden: string | null,
  boodschap: string,
): DriftBevinding {
  return { code, severity, onderwerp, verwacht, gevonden, boodschap };
}

export type VerifyOptions = {
  /** De kennisrecords zoals ze NU zijn. */
  readonly records: readonly KnowledgeRecord[];
  readonly readSource: ReadSource;
};

/**
 * Verifieert een manifest tegen de huidige stand van zaken.
 *
 * Volgorde van de bevindingen is vast: eerst de manifesthash zelf, dan de
 * records in manifestvolgorde, dan de bronnen in manifestvolgorde, tot slot
 * de eerder ontbrekende bronnen. Zo is de uitvoer stabiel genoeg om op te
 * toetsen én leesbaar genoeg om in een rapport te zetten.
 */
export async function verifyManifest(
  manifest: ContextManifest,
  options: VerifyOptions,
): Promise<VerificationResult> {
  const bevindingen: DriftBevinding[] = [];
  let ongewijzigd = 0;

  const herberekend = computeManifestHash(manifest);
  if (herberekend !== manifest.manifestHash) {
    bevindingen.push(
      bevinding(
        "manifest_hash_ongeldig",
        "drift",
        "(manifest)",
        manifest.manifestHash,
        herberekend,
        "het manifest is na generatie gewijzigd: de eigen hash klopt niet meer",
      ),
    );
  }

  const huidig = new Map(options.records.map((r) => [r.id, r] as const));
  for (const entry of manifest.records) {
    const record = huidig.get(entry.id);
    if (!record) {
      bevindingen.push(
        bevinding(
          "record_ontbreekt",
          "drift",
          entry.id,
          entry.hash,
          null,
          `record ${entry.id} bestaat niet meer`,
        ),
      );
      continue;
    }
    const nu = recordHash(record);
    if (nu !== entry.hash) {
      bevindingen.push(
        bevinding(
          "record_gewijzigd",
          "drift",
          entry.id,
          entry.hash,
          nu,
          `record ${entry.id} is inhoudelijk gewijzigd sinds het manifest`,
        ),
      );
      continue;
    }
    ongewijzigd += 1;
  }

  for (const bron of manifest.bronnen) {
    const inhoud = await options.readSource(bron.pad);
    if (inhoud === null) {
      bevindingen.push(
        bevinding(
          "bron_ontbreekt",
          "drift",
          bron.pad,
          bron.blob,
          null,
          `bronbestand ${bron.pad} is verdwenen of onleesbaar`,
        ),
      );
      continue;
    }
    const nu = gitBlobHash(inhoud);
    if (nu !== bron.blob) {
      bevindingen.push(
        bevinding(
          "bron_gewijzigd",
          "drift",
          bron.pad,
          bron.blob,
          nu,
          `bronbestand ${bron.pad} is gewijzigd sinds het manifest`,
        ),
      );
      continue;
    }
    ongewijzigd += 1;
  }

  for (const pad of manifest.ontbrekendeBronnen) {
    const inhoud = await options.readSource(pad);
    if (inhoud === null) continue;
    bevindingen.push(
      bevinding(
        "bron_teruggekeerd",
        "info",
        pad,
        null,
        gitBlobHash(inhoud),
        `bronbestand ${pad} ontbrak bij generatie maar bestaat nu wel`,
      ),
    );
  }

  return { ok: !bevindingen.some((b) => b.severity === "drift"), bevindingen, ongewijzigd };
}
