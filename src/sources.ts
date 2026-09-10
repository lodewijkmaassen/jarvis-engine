// De enige plek in dit prototype die de schijf aanraakt.
//
// Bewust apart gehouden van manifest.ts: de kern blijft puur en testbaar met
// een fake reader, en alle padveiligheid zit op één plek.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReadSource } from "./manifest";

/** Repo-relatief, geen `..`, geen absoluut pad, geen Windows-drive. */
export function isVeiligBronpad(pad: string): boolean {
  if (pad.length === 0) return false;
  if (path.isAbsolute(pad)) return false;
  if (/^[a-zA-Z]:/.test(pad)) return false;
  return !pad.split(/[\\/]/).includes("..");
}

/**
 * Maakt een ReadSource die uitsluitend binnen `wortel` leest.
 *
 * Onveilige paden en niet-bestaande bestanden geven allebei `null`: voor de
 * manifestlaag is dat hetzelfde geval ("deze bron kan ik niet vaststellen"),
 * en het voorkomt dat padinformatie via foutmeldingen weglekt.
 */
export function createFileReader(wortel: string): ReadSource {
  return async (pad: string) => {
    if (!isVeiligBronpad(pad)) return null;
    try {
      return await readFile(path.join(wortel, pad), "utf8");
    } catch {
      return null;
    }
  };
}

/** In-memory ReadSource voor tests en droogdraaien. */
export function createMemoryReader(bestanden: Readonly<Record<string, string>>): ReadSource {
  return async (pad: string) => (pad in bestanden ? bestanden[pad] : null);
}
