// D-20261117-194518764: de acceptatietest van "Ideeën" zakte op een afgekapt bewijs, niet op het werk.
// De diff van v3.html (ruim 7000 tekens) werd na 1500 tekens afgekapt, de test na de helft, terwijl het
// geheel ruim binnen het budget paste. Daarnaast wijst een doel na een herstel-PR naar die tweede
// samenvoeging; het bewijs moet dan nog steeds het werk van het hele doel tonen.
import { describe, expect, it } from "vitest";

import { bouwPrBewijs, isCommitVanDoel, PR_BEWIJS_TEKENS, verdeelDiffBudget, werkVanDoel, type DoelCommit } from "../../jarvis/src/acceptatie";

const DOEL = "D-20261117-194518764";

describe("het budget voor de diffs wordt eerlijk verdeeld", () => {
  it("laat kleine diffs heel en geeft wat over is aan de grote", () => {
    expect(verdeelDiffBudget([100, 7000, 3000], 12_000)).toEqual([100, 7000, 3000]);
    const krap = verdeelDiffBudget([100, 9000, 3000], 6_000);
    expect(krap[0]).toBe(100);
    expect(krap[2]).toBe(2950);
    expect(krap[1]).toBe(2950);
  });

  it("geeft elk bestand minstens een begin, ook bij veel bestanden", () => {
    const veel = verdeelDiffBudget(Array.from({ length: 100 }, () => 5000), 10_000);
    expect(Math.min(...veel)).toBeGreaterThanOrEqual(400);
  });
});

describe("bouwPrBewijs toont een diff die in het budget past volledig", () => {
  it("kapt een diff van 7000 tekens niet meer af na 1500", () => {
    const html = `@@ -1 +1 @@\n${"+  const x = 1;\n".repeat(400)}+  function weergaveIdeeen() {}`;
    const test = `@@ -0,0 +1 @@\n${"+  expect(a).toBe(b);\n".repeat(150)}+  it("filtert ideeën")`;
    const uit = bouwPrBewijs({ repo: "r/x", nummer: 147, titel: "Ideeën", tekst: "" }, [
      { naam: "jarvis/interface/v3.html", status: "modified", erbij: 70, eraf: 6, patch: html },
      { naam: "tests/jarvis/v3-ideeen.test.ts", status: "added", erbij: 51, eraf: 0, patch: test },
    ]);
    expect(html.length).toBeGreaterThan(6000);
    expect(uit).toContain("function weergaveIdeeen() {}");
    expect(uit).toContain('it("filtert ideeën")');
    expect(uit).not.toContain("afgekapt");
  });

  it("zegt per bestand dat en hoeveel er is afgekapt als het niet past", () => {
    const uit = bouwPrBewijs({ repo: "r/x", nummer: 1, titel: "t", tekst: "" }, [
      { naam: "groot.ts", status: "added", erbij: 1, eraf: 0, patch: "+".repeat(PR_BEWIJS_TEKENS * 2) },
    ]);
    expect(uit).toMatch(/diff van dit bestand afgekapt na \d+ van 40000 tekens/);
    expect(uit.length).toBeLessThan(PR_BEWIJS_TEKENS + 100);
  });
});

describe("het werk van een heel doel, over al zijn pull requests", () => {
  const commit = (sha: string, bericht: string, ouders: number, bestanden: DoelCommit["bestanden"]): DoelCommit => ({ sha, bericht, ouders, bestanden });

  it("herkent de trailer van het doel en slaat samenvoegingen en andere doelen over", () => {
    expect(isCommitVanDoel({ bericht: `V3: Ideeën\n\nJarvis-Role: developer\nJarvis-Task: ${DOEL}`, ouders: 1 }, DOEL)).toBe(true);
    expect(isCommitVanDoel({ bericht: `Merge\n\nJarvis-Task: ${DOEL}`, ouders: 2 }, DOEL)).toBe(false);
    expect(isCommitVanDoel({ bericht: "Jarvis-Task: D-20261117-194904457", ouders: 1 }, DOEL)).toBe(false);
    expect(isCommitVanDoel({ bericht: `Jarvis-Task: ${DOEL}9`, ouders: 1 }, DOEL)).toBe(false);
  });

  it("voegt de eerste PR en de herstel-PR per bestand samen, oudste eerst", () => {
    const werk = werkVanDoel(DOEL, [
      commit("a", `Ideeën\n\nJarvis-Task: ${DOEL}`, 1, [{ naam: "v3.html", status: "modified", erbij: 70, eraf: 6, patch: "+weergaveIdeeen" }]),
      commit("b", "Projecten\n\nJarvis-Task: D-20261117-194904457", 1, [{ naam: "v3.html", status: "modified", erbij: 9, eraf: 0, patch: "+projecten" }]),
      commit("c", `Bewijs\n\nJarvis-Task: ${DOEL}`, 1, [
        { naam: "v3.html", status: "modified", erbij: 1, eraf: 0, patch: "+herstel" },
        { naam: "acceptatie.ts", status: "modified", erbij: 5, eraf: 1, patch: "+verdeel" },
      ]),
    ]);
    const html = werk.find((b) => b.naam === "v3.html")!;
    expect(html.patch).toBe("+weergaveIdeeen\n+herstel");
    expect(html.erbij).toBe(71);
    expect(werk.map((b) => b.naam)).toEqual(["v3.html", "acceptatie.ts"]);
    expect(JSON.stringify(werk)).not.toContain("+projecten");
  });
});
