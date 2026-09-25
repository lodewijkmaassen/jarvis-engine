/**
 * De routinetekst hoort niet opnieuw in het promptveld van de uitvoerder te
 * staan. Die kopie is er twee keer geweest, en zij valt niemand op: de routine
 * wordt bijgewerkt in de repository, het promptveld houdt een oude versie, en de
 * uitvoerder draait maanden op instructies die niemand meer leest.
 *
 * T-20260917-autonome-opvolging, de laatste open bouwstap.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROMPT_KOPIE_MINIMUM, lint, promptKopieRegels } from "@/jarvis/src/lint";
import { laadKennis } from "@/jarvis/src/store";
import { CONFIG } from "./fixtures/config";

const WORTEL = path.join(process.cwd(), "tests/jarvis/fixtures");

const ROUTINE = [
  "# Routine — cloud-uitvoerder",
  "",
  "## Stap 0 — de dodemansregel (vóór alle andere stappen)",
  "",
  "Plan aan het begin van de ronde een vervolgbeurt in en onthoud het trigger_id.",
  "Verwijder die vervolgbeurt aan het eind als er geen cloud-uitvoerbaar werk meer is.",
  "",
  "## Stap 1 — de werkmap en het schrijfrecht",
  "",
  "Controleer de werkmap en of de bot schrijfrecht heeft op de repository.",
].join("\n");

const VERWIJZING =
  "Lees vóór alles docs/ROUTINE_CLOUD.md op branch main en voer die routine letterlijk uit, " +
  "te beginnen bij stap 0. Dat bestand is de volledige en enige operationele instructie.";

async function poort(routine?: { tekst: string; prompt: string; verwijzing?: string }) {
  const lading = await laadKennis(WORTEL, "kennis");
  return lint({
    config: CONFIG,
    lading,
    gewijzigdeBestanden: [] as readonly string[],
    tekstCorpus: "",
    acks: [] as readonly string[],
    routine,
  }).bevindingen.filter((b) => b.code === "routine_prompt_kopie");
}

describe("promptKopieRegels — overlap van hele regels, niet van woorden", () => {
  it("ziet geen kopie in een prompt die alleen naar de routine verwijst", () => {
    expect(promptKopieRegels(ROUTINE, VERWIJZING)).toEqual([]);
  });

  it("betrapt een prompt die de routine opnieuw uitschrijft", () => {
    const kopie = promptKopieRegels(ROUTINE, `${VERWIJZING}\n\n${ROUTINE}`);
    expect(kopie.length).toBeGreaterThanOrEqual(3);
    expect(kopie.some((r) => r.includes("vervolgbeurt"))).toBe(true);
    // Een kop die letterlijk terugkomt is ook een kopie: hij hoort alleen in de
    // routine te staan, niet in het promptveld.
    expect(kopie).toContain("Stap 0 — de dodemansregel (vóór alle andere stappen)");
  });

  it("betrapt ook één overgebleven regel", () => {
    const kopie = promptKopieRegels(
      ROUTINE,
      `${VERWIJZING}\n\nVerwijder die vervolgbeurt aan het eind als er geen cloud-uitvoerbaar werk meer is.`,
    );
    expect(kopie).toHaveLength(1);
  });

  it("negeert opmaak en inspringing: een gekopieerde regel als opsommingsteken telt ook", () => {
    const kopie = promptKopieRegels(ROUTINE, `- Verwijder die vervolgbeurt aan het eind als er geen cloud-uitvoerbaar werk meer is.`);
    expect(kopie).toHaveLength(1);
  });

  it("laat korte regels buiten beschouwing", () => {
    // Een losse term of een korte kop zegt niets: een prompt die naar de routine
    // verwijst noemt onvermijdelijk haar naam en haar eerste stap.
    expect(PROMPT_KOPIE_MINIMUM).toBeGreaterThan(20);
    expect(promptKopieRegels(ROUTINE, "Stap 0 — de dodemansregel")).toEqual([]);
    expect(promptKopieRegels(ROUTINE, "# Routine — cloud-uitvoerder")).toEqual([]);
    expect(promptKopieRegels("## Stap 1 — de werkmap", "Stap 1 — de werkmap")).toEqual([]);
  });

  it("telt dezelfde regel niet dubbel", () => {
    const regel = "Verwijder die vervolgbeurt aan het eind als er geen cloud-uitvoerbaar werk meer is.";
    expect(promptKopieRegels(`${regel}\n${regel}`, regel)).toHaveLength(1);
  });
});

describe("routine_prompt_kopie — de poortregel", () => {
  it("vuurt niet zonder routine-invoer: de poort beweert niets over wat zij niet heeft gezien", async () => {
    expect(await poort()).toHaveLength(0);
    expect(await poort({ tekst: ROUTINE, prompt: "" })).toHaveLength(0);
    expect(await poort({ tekst: "", prompt: ROUTINE })).toHaveLength(0);
  });

  it("laat een prompt die naar de routine verwijst groen", async () => {
    expect(await poort({ tekst: ROUTINE, prompt: VERWIJZING })).toHaveLength(0);
  });

  it("is een fout zodra de routinetekst opnieuw in het promptveld staat", async () => {
    const b = await poort({ tekst: ROUTINE, prompt: `${VERWIJZING}\n\n${ROUTINE}`, verwijzing: "trig_ABC" });
    expect(b).toHaveLength(1);
    expect(b[0].severity).toBe("fout");
    expect(b[0].boodschap).toContain("trig_ABC");
    expect(b[0].boodschap).toMatch(/één verwijzing/);
  });

  it("noemt de uitvoerder neutraal als er geen verwijzing is meegegeven", async () => {
    const b = await poort({ tekst: ROUTINE, prompt: ROUTINE });
    expect(b[0].boodschap).toContain("de routine van deze uitvoerder");
  });
});
