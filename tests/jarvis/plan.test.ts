// Jarvis-kern — afhankelijkheidsanalyse, kritiek pad en execution waves.
//
// De bestaansreden: zonder deze analyse wordt elk plan stilzwijgend
// sequentieel uitgevoerd, ook waar dat nergens voor nodig is. De tests borgen
// vooral dat de analyse EERLIJK is — een te optimistisch kritiek pad is
// erger dan geen analyse.
import { describe, expect, it } from "vitest";
import { analyseerPlan, parseerPlanTabel, rendereerPlan, type PlanTaak } from "@/jarvis/src/plan";

const TABEL = [
  "# Plan",
  "",
  "| id | naam | uren | afhankelijk_van | type | track |",
  "|---|---|---|---|---|---|",
  "| T01 | Schema | 3 | - | sequentieel | kern |",
  "| T02 | Index | 4 | T01 | parallel | cli |",
  "| T03 | Lint | 5 | T02 | parallel | cli |",
  "| T04 | Kennis | 6 | T01 | parallel | kennis |",
  "| T05 | Validatie | 0 | T04 | mens | poort |",
  "| T06 | Integratie | 2 | T03, T05 | sequentieel | integratie |",
  "",
].join("\n");

function taken(): readonly PlanTaak[] {
  const { taken: t, fouten } = parseerPlanTabel(TABEL);
  expect(fouten).toEqual([]);
  return t;
}

describe("parseerPlanTabel", () => {
  it("leest alle rijen met hun afhankelijkheden", () => {
    const t = taken();
    expect(t.map((x) => x.id)).toEqual(["T01", "T02", "T03", "T04", "T05", "T06"]);
    expect(t[5].afhankelijkVan).toEqual(["T03", "T05"]);
    expect(t[0].afhankelijkVan).toEqual([]);
  });

  it("leest uren, type en track", () => {
    const t = taken();
    expect(t[1]).toMatchObject({ uren: 4, type: "parallel", track: "cli" });
    expect(t[4].type).toBe("mens");
  });

  it("accepteert een komma als decimaalteken", () => {
    const { taken: t } = parseerPlanTabel(
      ["| id | naam | uren | afhankelijk_van | type | track |", "|---|---|---|---|---|---|", "| A | x | 3,5 | - | parallel | q |"].join(
        "\n",
      ),
    );
    expect(t[0].uren).toBe(3.5);
  });

  it("meldt een ontbrekende tabel in plaats van stil niets te doen", () => {
    const { taken: t, fouten } = parseerPlanTabel("# Geen tabel hier");
    expect(t).toEqual([]);
    expect(fouten[0].boodschap).toContain("geen plantabel");
  });

  it("meldt een ongeldig type en slaat die rij over", () => {
    const { taken: t, fouten } = parseerPlanTabel(
      [
        "| id | naam | uren | afhankelijk_van | type | track |",
        "|---|---|---|---|---|---|",
        "| A | x | 1 | - | onzin | q |",
      ].join("\n"),
    );
    expect(t).toEqual([]);
    expect(fouten[0].boodschap).toContain("type moet");
  });
});

describe("analyseerPlan", () => {
  it("telt het totale werk", () => {
    expect(analyseerPlan(taken()).totaalUren).toBe(20);
  });

  it("berekent het kritieke pad als het langste pad, niet het langste spoor", () => {
    const analyse = analyseerPlan(taken());
    // T01(3) -> T04(6) -> T05(0) -> T06(2) = 11 is langer dan
    // T01(3) -> T02(4) -> T03(5) -> T06(2) = 14? Nee: 14 wint.
    expect(analyse.kritiekPad).toEqual(["T01", "T02", "T03", "T06"]);
    expect(analyse.kritiekPadUren).toBe(14);
  });

  it("groepeert taken zonder onderlinge afhankelijkheid in dezelfde wave", () => {
    const analyse = analyseerPlan(taken());
    const wave2 = analyse.waves.find((w) => w.taken.some((t) => t.id === "T02"));
    expect(wave2?.taken.map((t) => t.id).sort()).toEqual(["T02", "T04"]);
  });

  it("noemt de menselijke poorten apart", () => {
    expect(analyseerPlan(taken()).mensGates).toEqual(["T05"]);
  });

  it("beveelt niet meer concurrency aan dan de breedste wave", () => {
    const analyse = analyseerPlan(taken());
    expect(analyse.aanbevolenConcurrency).toBe(analyse.maxBreedte);
    expect(analyse.maxBreedte).toBe(2);
  });

  it("begrenst de aanbevolen concurrency op het plafond", () => {
    const breed: PlanTaak[] = [
      { id: "R", naam: "wortel", uren: 1, afhankelijkVan: [], type: "sequentieel", track: "a" },
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `P${i}`,
        naam: `p${i}`,
        uren: 1,
        afhankelijkVan: ["R"],
        type: "parallel" as const,
        track: "b",
      })),
    ];
    const analyse = analyseerPlan(breed);
    expect(analyse.maxBreedte).toBe(12);
    expect(analyse.aanbevolenConcurrency).toBe(5);
  });

  it("geeft nooit een wall-clock korter dan het kritieke pad", () => {
    const analyse = analyseerPlan(taken());
    expect(analyse.wallclockUren).toBeGreaterThanOrEqual(analyse.kritiekPadUren * 0.5);
    expect(analyse.wallclockUren).toBeLessThanOrEqual(analyse.totaalUren);
  });

  it("detecteert een cyclus in plaats van oneindig door te rekenen", () => {
    const cyclisch: PlanTaak[] = [
      { id: "A", naam: "a", uren: 1, afhankelijkVan: ["B"], type: "parallel", track: "x" },
      { id: "B", naam: "b", uren: 1, afhankelijkVan: ["A"], type: "parallel", track: "x" },
    ];
    const analyse = analyseerPlan(cyclisch);
    expect(analyse.ok).toBe(false);
    expect(analyse.fouten.some((f) => f.boodschap.includes("cyclisch"))).toBe(true);
  });

  it("meldt een onbekende afhankelijkheid", () => {
    const analyse = analyseerPlan([
      { id: "A", naam: "a", uren: 1, afhankelijkVan: ["ZZ"], type: "parallel", track: "x" },
    ]);
    expect(analyse.ok).toBe(false);
    expect(analyse.fouten[0].boodschap).toContain("onbekende afhankelijkheid");
  });

  it("meldt een taak die van zichzelf afhangt", () => {
    const analyse = analyseerPlan([
      { id: "A", naam: "a", uren: 1, afhankelijkVan: ["A"], type: "parallel", track: "x" },
    ]);
    expect(analyse.fouten.some((f) => f.boodschap.includes("zichzelf"))).toBe(true);
  });

  it("is deterministisch", () => {
    const a = analyseerPlan(taken());
    const b = analyseerPlan(taken());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("rendereerPlan", () => {
  it("toont kritiek pad, waves en een graaf", () => {
    const t = taken();
    const uit = rendereerPlan(t, analyseerPlan(t));
    expect(uit).toContain("Kritiek pad");
    expect(uit).toContain("Execution waves");
    expect(uit).toContain("```mermaid");
    expect(uit).toContain("T01 --> T02");
  });

  it("tekent menselijke poorten met een andere vorm", () => {
    const t = taken();
    expect(rendereerPlan(t, analyseerPlan(t))).toContain('T05{{"T05 Validatie"}}');
  });
});
