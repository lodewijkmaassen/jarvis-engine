// Canonieke serialisatie + hashing voor het Jarvis-calibratieprototype.
//
// Doel: elke hash die dit prototype produceert moet met standaard
// Git-gereedschap na te rekenen zijn. Daarom is de bronbestand-hash exact
// de Git-blob-hash (`git hash-object <pad>`) en niet een eigen variant.
//
// Geen I/O in deze module — alleen bytes in, hex uit.
import { createHash } from "node:crypto";

/** Waarden die canoniek geserialiseerd kunnen worden. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Canonieke JSON: objectsleutels altijd in codepoint-volgorde, geen
 * whitespace, `undefined`-velden weggelaten. Twee inhoudelijk gelijke
 * objecten leveren zo altijd dezelfde string — en dus dezelfde hash —
 * ongeacht de volgorde waarin ze zijn opgebouwd.
 *
 * Arrays behouden hun volgorde: die is inhoudelijk betekenisvol.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as { readonly [key: string]: JsonValue };
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * Git-blob-hash van ruwe inhoud: SHA-1 over `blob <bytelengte>\0<inhoud>`.
 *
 * Identiek aan `git hash-object`, dus verifieerbaar buiten dit prototype om.
 * Let op: de lengte is het aantal BYTES, niet het aantal tekens — daarom
 * eerst naar een Buffer (UTF-8) en pas dan meten.
 */
export function gitBlobHash(content: string | Uint8Array): string {
  const body =
    typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  const header = Buffer.from(`blob ${body.length}\0`, "utf8");
  return createHash("sha1").update(Buffer.concat([header, body])).digest("hex");
}

/**
 * Git-blob-hash over de canonieke JSON van een waarde. Gebruikt voor
 * kennisrecords: die staan (nog) niet als los bestand op schijf, maar
 * krijgen wél een hash in hetzelfde formaat als bronbestanden.
 */
export function gitBlobHashOfValue(value: JsonValue): string {
  return gitBlobHash(canonicalJson(value));
}

/** SHA-256 (hex) — gebruikt voor de manifesthash zelf. */
export function sha256(content: string): string {
  return createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
}

/** Verkorte weergave voor logs/rapportage. Nooit gebruiken om te vergelijken. */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
