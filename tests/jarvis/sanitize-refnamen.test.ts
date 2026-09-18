/**
 * Wat: toetst dat de scan van gegenereerde uitvoer (`jarvis overzicht`) niet
 * meer afgaat op de naam van een git-ref, en dat die vrijstelling uit de refs
 * zelf komt in plaats van uit een lijst met opgeschreven namen.
 *
 * Waarom: een branchnaam als `cloud-20260915-attestatie-dispatch` haalt de
 * entropiedrempel van de sanitizer. Hij belandt via het onderwerp van een
 * merge-commit in de git-log en dus in de uitvoer van het overzicht, waarna de
 * scan die uitvoer afkeurde en het volledige eigenaarsoverzicht stopte met
 * verversen. Dat is met de hand opgelost door de namen één voor één in
 * `allowlist.yml` te zetten — een lijst die bij elke nieuwe branch opnieuw
 * moet groeien en die het overzicht dus opnieuw kan blokkeren.
 *
 * De reparatie is `refNamenAlsAllowlist`: bij het scannen is al bekend DÁT een
 * naam een ref is, want hij staat in `for-each-ref`. Deze tests dekken de vier
 * eigenschappen die die reparatie moet hebben:
 *
 *   A. een willekeurige, nieuw aangemaakte geldige branchnaam blokkeert de
 *      uitvoer niet — zonder dat die naam ergens is opgeschreven;
 *   B. de controle is niet leeg: dezelfde namen worden zonder de reparatie wél
 *      gevlagd (anders zou A ook slagen als de entropieregel stuk was);
 *   C. een echt secret wordt nog steeds gevonden, mét de reparatie actief;
 *   D. de vrijstelling hangt aan de ref en niet aan de vorm: een string die
 *      eruitziet als een branchnaam maar in geen enkele ref voorkomt, wordt
 *      nog steeds gevlagd.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { refNamenAlsAllowlist } from "@/jarvis/src/opdrachten";
import { LEGE_ALLOWLIST, isVerdachteEntropie, scanTekst } from "@/jarvis/src/sanitize";

/**
 * Namen in de vorm die de bot werkelijk gebruikt, maar met een wisselend deel,
 * zodat de test niet kan slagen doordat de naam toevallig ergens in een
 * allowlist staat. Ze zijn lang genoeg en mengen cijfers en letters, dus ze
 * halen de entropiedrempel — eigenschap B bewijst dat ook echt.
 */
function verzinBranchNamen(): readonly string[] {
  const stam = Math.random().toString(36).slice(2, 8);
  return [
    `jarvis/cloud-20260917-${stam}-attestatie-dispatch`,
    `jarvis/cloud-20260918-${stam}-bewijspunt4-opdracht`,
    `jarvis/${stam}-provider-wissel-neutrale-afgeleide-2026`,
  ];
}

/**
 * Een bevinding toont de waarde gemaskeerd (`qFh************G7`), nooit
 * voluit — vandaar dat een test op kop en staart vergelijkt in plaats van op
 * de hele string.
 */
function hoortBij(fragment: string, waarde: string): boolean {
  return fragment.startsWith(waarde.slice(0, 3)) && fragment.endsWith(waarde.slice(-2));
}

/** De uitvoer zoals het overzicht hem opbouwt: mergeonderwerpen uit de git-log. */
function uitvoerMet(namen: readonly string[], extra = ""): string {
  const regels = namen.map(
    (n, i) => `      "onderwerp": "Merge pull request #${100 + i} from lodewijkmaassen/${n}"`,
  );
  return `{\n  "versie": 1,\n  "stand": [\n${regels.join(",\n")}${extra ? `,\n${extra}` : ""}\n  ]\n}\n`;
}

describe("refNamenAlsAllowlist", () => {
  let repo: string;
  let namen: readonly string[];

  beforeAll(async () => {
    repo = await mkdtemp(path.join(tmpdir(), "jarvis-refnamen-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "test"], { cwd: repo });
    await writeFile(path.join(repo, "README.md"), "# Test\n");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "start"], { cwd: repo });

    namen = verzinBranchNamen();
    for (const naam of namen) execFileSync("git", ["branch", naam], { cwd: repo });
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  // B — eerst de controle, anders bewijst A niets.
  it("B: zonder de reparatie vlagt de scan deze branchnamen wel degelijk", () => {
    const bevindingen = scanTekst(uitvoerMet(namen), LEGE_ALLOWLIST, "overzicht.json");
    expect(bevindingen.length).toBeGreaterThan(0);
    // En het zijn werkelijk de namen die de drempel halen, niet iets anders.
    for (const naam of namen) {
      const kort = naam.split("/").pop() as string;
      expect(isVerdachteEntropie(kort)).toBe(true);
    }
  });

  // A — de eigenschap waar het om gaat.
  it("A: nieuwe, willekeurige geldige branchnamen blokkeren de uitvoer niet", async () => {
    const allowlist = await refNamenAlsAllowlist([repo], LEGE_ALLOWLIST);
    expect(scanTekst(uitvoerMet(namen), allowlist, "overzicht.json")).toEqual([]);
  });

  // A, tweede meting: een branch die ná het bouwen van de allowlist ontstaat,
  // is bij de volgende run vanzelf gedekt. Geen menselijke stap ertussen.
  it("A: een zojuist aangemaakte branch is bij de volgende scan meteen gedekt", async () => {
    const nieuw = `jarvis/cloud-20260919-${Math.random().toString(36).slice(2, 10)}-vers-gemaakte-branch`;
    expect(isVerdachteEntropie(nieuw.split("/").pop() as string)).toBe(true);
    execFileSync("git", ["branch", nieuw], { cwd: repo });
    const allowlist = await refNamenAlsAllowlist([repo], LEGE_ALLOWLIST);
    expect(scanTekst(uitvoerMet([nieuw]), allowlist, "overzicht.json")).toEqual([]);
  });

  // C — de poort blijft een poort.
  it("C: een echt secret wordt nog steeds gevonden terwijl de refnamen zijn vrijgesteld", async () => {
    const allowlist = await refNamenAlsAllowlist([repo], LEGE_ALLOWLIST);
    const secret = "qFh82LmZpX4vTn0wYbKe93RdSuAcJhG7";
    expect(isVerdachteEntropie(secret)).toBe(true);
    const tekst = uitvoerMet(namen, `      "notitie": "SERVICE_TOKEN=${secret}"`);
    const bevindingen = scanTekst(tekst, allowlist, "overzicht.json");
    // Precies één: het secret. De drie refnamen in dezelfde tekst tellen niet mee.
    expect(bevindingen).toHaveLength(1);
    expect(hoortBij(bevindingen[0].fragment, secret)).toBe(true);
  });

  // D — geen vormachterdeur: lijken op een branchnaam is niet genoeg.
  it("D: een string in branchvorm die in geen enkele ref voorkomt, wordt gevlagd", async () => {
    const allowlist = await refNamenAlsAllowlist([repo], LEGE_ALLOWLIST);
    const nep = "cloud-20260920-deze-branch-bestaat-niet-7";
    expect(isVerdachteEntropie(nep)).toBe(true);
    const bevindingen = scanTekst(uitvoerMet(namen, `      "onderwerp": "${nep}"`), allowlist, "overzicht.json");
    expect(bevindingen).toHaveLength(1);
    expect(hoortBij(bevindingen[0].fragment, nep)).toBe(true);
  });
});
