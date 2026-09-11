/**
 * Wat: toetst het uitlezen van één `git log` over een hele branch, zoals de
 * rolcontrole dat doet.
 *
 * Waarom: de rolcontrole las eerder per commit drie keer git en kapte daarom
 * af bij vijftig commits; op een lange branch viel het oudste deel stil
 * buiten de toets. Eén aanroep met record- en veldscheiding maakt dat
 * afkappen overbodig, mits het parsen klopt bij lege bestandslijsten,
 * meerregelige berichten en trailers.
 */
import { describe, expect, it } from "vitest";

import { leesCommitLog } from "@/jarvis/src/opdrachten";

const RS = "";
const FS = "";
const HASH_A = "a".repeat(40);
const HASH_B = "b".repeat(40);

function record(hash: string, onderwerp: string, bericht: string, bestanden: readonly string[]): string {
  return `${RS}${hash}${FS}${onderwerp}${FS}${bericht}\n${FS}\n${bestanden.join("\n")}\n`;
}

describe("leesCommitLog", () => {
  it("leest hash, onderwerp, bericht en bestanden per commit in volgorde", () => {
    const uit =
      record(HASH_A, "Nieuwste", "Nieuwste\n\nJarvis-Role: builder\nJarvis-Task: T-1", ["a.ts", "b.ts"]) +
      record(HASH_B, "Oudste", "Oudste\n\nJarvis-Role: qa", ["tests/x.test.ts"]);
    const commits = leesCommitLog(uit);
    expect(commits.map((c) => c.hash)).toEqual([HASH_A, HASH_B]);
    expect(commits[0].onderwerp).toBe("Nieuwste");
    expect(commits[0].bericht).toContain("Jarvis-Task: T-1");
    expect(commits[0].bestanden).toEqual(["a.ts", "b.ts"]);
    expect(commits[1].bestanden).toEqual(["tests/x.test.ts"]);
  });

  it("geeft een lege bestandslijst voor een commit zonder wijzigingen", () => {
    const commits = leesCommitLog(record(HASH_A, "Leeg", "Leeg", []));
    expect(commits).toHaveLength(1);
    expect(commits[0].bestanden).toEqual([]);
  });

  it("laat rommel zonder geldige hash buiten beschouwing", () => {
    expect(leesCommitLog("")).toEqual([]);
    expect(leesCommitLog(`${RS}niet-een-hash${FS}x${FS}y${FS}`)).toEqual([]);
  });
});
