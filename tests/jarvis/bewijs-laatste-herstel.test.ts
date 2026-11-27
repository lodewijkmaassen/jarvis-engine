// D-20261127-191905240: de productieproef D-20261127-142321503 (project-PR #352) zakte in ronde 5 op "alleen een
// nulmeting", terwijl het herstel juist de nameting met vóór/na-vergelijking toevoegde. Het werk van het hele doel
// werd per bestand samengevoegd (oudste eerst) en afgekapt; de nameting viel weg. Deze test speelt die vorm na:
// vier pull requests, hetzelfde document in elk, en een herstel dat alleen dat document raakt.
import { describe, expect, it } from "vitest";

import { bouwDoelBewijs, bouwPrBewijs, isAlHetWerk, LAATSTE_SAMENVOEGING_TEKENS, PR_BEWIJS_TEKENS, werkVanDoel, type DoelCommit } from "../../jarvis/src/acceptatie";

const DOEL = "D-20261127-142321503";
const trailer = `\n\nJarvis-Role: developer\nJarvis-Task: ${DOEL}`;
const regels = (kop: string, n: number) => `@@ -0,0 +1,${n} @@\n+## ${kop}\n${"+| meting | 46,0 | 12,3 | −33,7 | −73 % |\n".repeat(n)}`;

const nulmeting = regels("Nulmeting (vóór de wijzigingen)", 90);
const nameting1 = regels("Nameting", 130);
const nameting2 = `${regels("Tweede nameting", 120)}+| Wachten op een run na een niet-geslaagde acceptatie | 21,6 | 0,0 | −21,6 | −100 % |\n`;
const c = (sha: string, bestanden: DoelCommit["bestanden"]): DoelCommit => ({ sha, bericht: `werk${trailer}`, ouders: 1, bestanden });
const doc = (patch: string) => ({ naam: "docs/JARVIS_DOORLOOPTIJD.md", status: "modified", erbij: 90, eraf: 0, patch });
const groot = (naam: string, n: number) => ({ naam, status: "added", erbij: n, eraf: 0, patch: "+x\n".repeat(n) });

const commits: DoelCommit[] = [
  c("a", [doc(nulmeting), groot("docs/ROUTINE_V3.md", 1500), groot("scripts/jarvis-doorlooptijd.mjs", 2500), groot("tests/jarvis-doorlooptijd.test.ts", 1400)]),
  c("b", [{ naam: "docs/CURRENT_STATE.md", status: "modified", erbij: 1, eraf: 1, patch: "-a\n+b" }]),
  c("c", [doc(regels("Pin", 30)), { naam: "package.json", status: "modified", erbij: 1, eraf: 1, patch: "-pin\n+pin" }]),
  c("d", [doc(nameting1)]),
  c("e", [doc(nameting2)]),
];
const pr = { repo: "eigenaar/project", nummer: 352, titel: "Merge pull request #352", tekst: "tweede nameting" };
const laatste = [doc(nameting2)];
const heel = werkVanDoel(DOEL, commits);

describe("het herstel van deze ronde staat vooraan in het bewijs", () => {
  it("zonder het blok viel de nameting weg (de oude vorm, zoals ronde 5 hem zag)", () => {
    const oud = bouwPrBewijs(pr, heel, "inhoud van al het werk van dit doel:");
    expect(oud).toContain("Nulmeting (vóór de wijzigingen)");
    expect(oud).not.toContain("Tweede nameting");
  });

  it("met het blok ziet de beoordelaar de volledige nameting met de vóór/na-vergelijking", () => {
    const uit = bouwDoelBewijs(pr, laatste, heel, "inhoud van de laatste samenvoeging:", "inhoud van al het werk van dit doel:");
    const eerst = uit.indexOf("inhoud van de laatste samenvoeging:");
    expect(eerst).toBe(0);
    expect(uit).toContain("## Tweede nameting");
    expect(uit).toContain("−100 %");
    expect(uit.indexOf("−100 %")).toBeLessThan(uit.indexOf("inhoud van al het werk van dit doel:"));
    // Het werk van het hele doel blijft erbij, met de nulmeting om tegen te vergelijken.
    expect(uit).toContain("Nulmeting (vóór de wijzigingen)");
    expect(uit).toContain("scripts/jarvis-doorlooptijd.mjs");
  });

  it("maakt het bewijs als geheel niet groter", () => {
    expect(LAATSTE_SAMENVOEGING_TEKENS).toBeLessThan(PR_BEWIJS_TEKENS / 2);
    const uit = bouwDoelBewijs(pr, laatste, heel, "laatste:", "heel:");
    expect(uit.length).toBeLessThanOrEqual(PR_BEWIJS_TEKENS);
    const enorm = [{ naam: "x.md", status: "added", erbij: 1, eraf: 0, patch: "+".repeat(50_000) }];
    const twee = bouwDoelBewijs(pr, enorm, [...heel, ...enorm], "laatste:", "heel:");
    expect(twee.length).toBeLessThanOrEqual(PR_BEWIJS_TEKENS);
    expect(twee.indexOf("heel:")).toBeGreaterThan(LAATSTE_SAMENVOEGING_TEKENS - 200);
    expect(twee).toContain("afgekapt");
    // Een blok met een eigen budget blijft binnen dat budget, ook als de kop alleen al te groot is.
    const veel = Array.from({ length: 300 }, (_, i) => ({ naam: `f${i}.ts`, status: "added", erbij: 1, eraf: 0, patch: "+".repeat(900) }));
    expect(bouwPrBewijs(pr, veel, "blok:", 5_000).length).toBeLessThanOrEqual(5_000);
    expect(bouwDoelBewijs(pr, veel, [...heel, ...veel], "laatste:", "heel:").length).toBeLessThanOrEqual(PR_BEWIJS_TEKENS);
  });

  it("is de laatste samenvoeging al het werk, dan blijft het één blok zoals voorheen", () => {
    const enkel = werkVanDoel(DOEL, [commits[4]!]);
    expect(isAlHetWerk(laatste, enkel)).toBe(true);
    const uit = bouwDoelBewijs(pr, laatste, enkel, "laatste:", "heel:");
    expect(uit).toBe(bouwPrBewijs(pr, enkel, "heel:"));
    expect(isAlHetWerk(laatste, heel)).toBe(false);
  });
});
