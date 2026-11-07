import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkNamenVanWorkflow, laatstePerNaam, uniekeHerkomstPerNaam, VERPLICHTE_CHECK, type Check } from "@/jarvis/src/pr";

/**
 * De herkomst van een check-run uit de workflowbestanden (RSK-0032).
 *
 * De meting die hierachter zit: op ToVas Flow-#307 bleef één rode run staan
 * die GitHub met een 504 had afgebroken. Een latere run van dezelfde workflow
 * was groen, maar de poort kon niet vaststellen dát het dezelfde workflow was
 * — daarvoor is `actions: read` nodig, en dat heeft de sweep niet. Zonder dat
 * bewijs verviel er niets en bleef de pull request voor altijd wachten; een
 * mens moest de run met de hand herstarten.
 *
 * De vervanging mag geen versoepeling zijn: QA-bevinding N-1 (een tweede
 * workflow met een job `poort` die een echte rode poort onzichtbaar maakt)
 * moet onveranderd worden tegengehouden.
 */
describe("checknamen uit een workflowbestand", () => {
  it("leest de jobs van een gewone workflow", () => {
    const yml = ["name: x", "on:", "  push: {}", "jobs:", "  poort:", "    runs-on: ubuntu-latest", "    steps:", "      - name: niet de jobnaam", "        run: echo"].join("\n");
    expect(checkNamenVanWorkflow(yml)).toEqual({ namen: ["poort"], onzeker: false });
  });

  it("neemt de name: van een job boven zijn sleutel", () => {
    const yml = ["jobs:", "  bouw:", '    name: "poort"', "    runs-on: x"].join("\n");
    expect(checkNamenVanWorkflow(yml)).toEqual({ namen: ["poort"], onzeker: false });
  });

  it("is onzeker bij een expressie in de naam of een matrix", () => {
    const expressie = ["jobs:", "  bouw:", "    name: poort ${{ matrix.node }}", "    runs-on: x"].join("\n");
    expect(checkNamenVanWorkflow(expressie).onzeker).toBe(true);
    const matrix = ["jobs:", "  bouw:", "    strategy:", "      matrix:", "        node: [20, 22]"].join("\n");
    expect(checkNamenVanWorkflow(matrix).onzeker).toBe(true);
  });

  it("is onzeker als er geen jobs te lezen zijn", () => {
    expect(checkNamenVanWorkflow("name: x\non:\n  push: {}\n").onzeker).toBe(true);
    expect(checkNamenVanWorkflow("").onzeker).toBe(true);
  });
});

describe("welke naam bewijsbaar uit één workflow komt", () => {
  it("wijst de naam toe aan het enige bestand dat haar kan opleveren", () => {
    const map = uniekeHerkomstPerNaam([
      { pad: ".github/workflows/a.yml", inhoud: "jobs:\n  poort:\n    runs-on: x" },
      { pad: ".github/workflows/b.yml", inhoud: "jobs:\n  sweep:\n    runs-on: x" },
    ]);
    expect(map.get("poort")).toBe("wf:.github/workflows/a.yml");
    expect(map.get("sweep")).toBe("wf:.github/workflows/b.yml");
  });

  it("zegt niets over een naam die twee bestanden kunnen opleveren (QA N-1)", () => {
    const map = uniekeHerkomstPerNaam([
      { pad: ".github/workflows/a.yml", inhoud: "jobs:\n  poort:\n    runs-on: x" },
      { pad: ".github/workflows/kwaad.yml", inhoud: "jobs:\n  poort:\n    runs-on: x" },
    ]);
    expect(map.get("poort")).toBeUndefined();
  });

  it("zegt niets over welke naam ook zodra één bestand onzeker is", () => {
    const map = uniekeHerkomstPerNaam([
      { pad: ".github/workflows/a.yml", inhoud: "jobs:\n  poort:\n    runs-on: x" },
      { pad: ".github/workflows/b.yml", inhoud: "jobs:\n  bouw:\n    strategy:\n      matrix:\n        n: [1, 2]" },
    ]);
    expect([...map.keys()]).toEqual([]);
  });

  it("de workflows van deze repository: alleen jarvis-lint.yml kan de poort opleveren", () => {
    const map = path.join(process.cwd(), ".github/workflows");
    const bestanden = readdirSync(map)
      .filter((n) => /\.ya?ml$/i.test(n))
      .map((n) => ({ pad: `.github/workflows/${n}`, inhoud: readFileSync(path.join(map, n), "utf8") }));
    expect(bestanden.length).toBeGreaterThan(1);
    const herkomst = uniekeHerkomstPerNaam(bestanden);
    expect(herkomst.get(VERPLICHTE_CHECK)).toBe("wf:.github/workflows/jarvis-lint.yml");
  });
});

describe("met die herkomst doet laatstePerNaam weer zijn werk", () => {
  const check = (conclusie: string, gestart: string, herkomst: string | null): Check => ({ naam: "poort", status: "completed", conclusie, gestart, herkomst });

  it("een afgebroken rode run vervalt voor de latere groene van dezelfde workflow", () => {
    const uit = ".github/workflows/jarvis-lint.yml";
    const checks = [check("failure", "2026-11-07T00:10:00Z", `wf:${uit}`), check("success", "2026-11-07T00:40:00Z", `wf:${uit}`)];
    expect(laatstePerNaam(checks).map((c) => c.conclusie)).toEqual(["success"]);
  });

  it("en zonder die herkomst blijft de rode staan", () => {
    const checks = [check("failure", "2026-11-07T00:10:00Z", null), check("success", "2026-11-07T00:40:00Z", null)];
    expect(laatstePerNaam(checks)).toHaveLength(2);
  });
});
