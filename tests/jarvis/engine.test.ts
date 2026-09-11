/**
 * Wat: toetst de enginecontrole van de poort — de engine als vastgepinde
 * afhankelijkheid van een consumer.
 *
 * Waarom: zodra de engine van buiten de repository komt, draait de poort op
 * code die niet in de PR staat. De poort moet dan kunnen zeggen: dit is de
 * SHA die package-lock.json noemt, dat is wat er geïnstalleerd is, en die
 * SHA staat op de hoofdbranch van de engine-repository. Elk van die drie
 * moet los aantoonbaar falen.
 */
import { describe, expect, it } from "vitest";

import { beoordeelEngine, bepaalModus, ENGINE_MAP, leesEngineStand, ontleedResolved } from "@/jarvis/src/engine";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function lock(sha: string, slug = "eigenaar/jarvis-engine"): string {
  return JSON.stringify({ packages: { [ENGINE_MAP]: { resolved: `git+ssh://git@github.com/${slug}.git#${sha}` } } });
}

describe("bepaalModus", () => {
  it("herkent de engine-repository aan de pakketnaam én de zelfkoppeling in node_modules", () => {
    expect(bepaalModus(JSON.stringify({ name: "jarvis-engine" }), true)).toBe("engine");
  });
  it("ziet een project dat alleen de pakketnaam nadoet als consumer (QA-bevinding H-1)", () => {
    expect(bepaalModus(JSON.stringify({ name: "jarvis-engine" }), false)).toBe("consumer");
    expect(bepaalModus(JSON.stringify({ name: "jarvis-engine" }))).toBe("consumer");
  });
  it("ziet elk ander project, en een onleesbare package.json, als consumer", () => {
    expect(bepaalModus(JSON.stringify({ name: "een-product" }), true)).toBe("consumer");
    expect(bepaalModus("{niet json", true)).toBe("consumer");
    expect(bepaalModus(null, true)).toBe("consumer");
  });
});

describe("ontleedResolved", () => {
  it("leest slug en SHA uit een GitHub-resolved", () => {
    expect(ontleedResolved(lock(SHA_A))).toEqual({ slug: "eigenaar/jarvis-engine", sha: SHA_A });
  });
  it("geeft niets terug voor een registry-pakket, een tag, of een ontbrekend item", () => {
    expect(ontleedResolved(JSON.stringify({ packages: { [ENGINE_MAP]: { resolved: "https://registry.npmjs.org/x.tgz" } } })).sha).toBeNull();
    expect(ontleedResolved(JSON.stringify({ packages: { [ENGINE_MAP]: { resolved: "git+ssh://git@github.com/e/r.git#v1" } } })).sha).toBeNull();
    expect(ontleedResolved(JSON.stringify({ packages: {} })).sha).toBeNull();
    expect(ontleedResolved(null).sha).toBeNull();
  });
});

describe("beoordeelEngine", () => {
  const SLUG = "eigenaar/jarvis-engine";
  const gezond = leesEngineStand(JSON.stringify({ name: "product" }), lock(SHA_A), lock(SHA_A));

  it("keurt goed: gepind, geïnstalleerd op dezelfde SHA, en op de hoofdbranch", () => {
    expect(beoordeelEngine(gezond, "identical", SLUG)).toEqual([]);
    expect(beoordeelEngine(gezond, "behind", SLUG)).toEqual([]);
  });

  it("heeft in de engine-repository zelf niets te beoordelen", () => {
    expect(beoordeelEngine({ modus: "engine" }, null, SLUG)).toEqual([]);
  });

  it("weigert een engine uit een andere repository dan jarvis.config.yml noemt, ook een fork met dezelfde naam", () => {
    // QA-bevinding B-2: de vergelijking met main liep tegen de repository die
    // de lockfile noemde; een fork met dezelfde naam gaf zo een groene poort.
    const fork = leesEngineStand(JSON.stringify({ name: "product" }), lock(SHA_A, "iemand-anders/jarvis-engine"), lock(SHA_A, "iemand-anders/jarvis-engine"));
    expect(beoordeelEngine(fork, "identical", SLUG).join(" ")).toContain("andere bron");
    expect(beoordeelEngine(gezond, "identical", "")).toEqual(
      expect.arrayContaining([expect.stringContaining("engine_repository")]),
    );
  });

  it("blokkeert een engine die niet op een GitHub-commit is gepind", () => {
    const stand = leesEngineStand(JSON.stringify({ name: "product" }), JSON.stringify({ packages: {} }), null);
    expect(beoordeelEngine(stand, "identical", SLUG).join(" ")).toContain("pint");
  });

  it("blokkeert een geïnstalleerde engine die niet de vastgepinde is", () => {
    const stand = leesEngineStand(JSON.stringify({ name: "product" }), lock(SHA_A), lock(SHA_B));
    expect(beoordeelEngine(stand, "identical", SLUG).join(" ")).toContain("niet de vastgepinde");
  });

  it("blokkeert als de engine niet is geïnstalleerd", () => {
    const stand = leesEngineStand(JSON.stringify({ name: "product" }), lock(SHA_A), null);
    expect(beoordeelEngine(stand, "identical", SLUG).join(" ")).toContain("niet geïnstalleerd");
  });

  it("blokkeert een SHA die de hoofdbranch nooit heeft gezien, en ook als dat niet vast te stellen is", () => {
    expect(beoordeelEngine(gezond, "ahead", SLUG).join(" ")).toContain("niet op de hoofdbranch");
    expect(beoordeelEngine(gezond, "diverged", SLUG).join(" ")).toContain("niet op de hoofdbranch");
    expect(beoordeelEngine(gezond, null, SLUG).join(" ")).toContain("kon niet vaststellen");
  });
});
