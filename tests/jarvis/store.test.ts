// Jarvis-kern — kennisopslag en contextassemblage tegen een echte fixture.
//
// Deze tests draaien op knowledge-bestanden in tests/jarvis/fixtures/kennis:
// markdown zoals een mens het schrijft, niet een handgemaakt object. Daarmee
// dekken ze de hele keten front-matter -> secties -> validatie -> retrieval ->
// budget -> manifest.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bouwContextPakket, rendereerPakket } from "@/jarvis/src/context";
import type { JarvisConfig } from "@/jarvis/src/config";
import { createFileReader, createMemoryReader } from "@/jarvis/src/sources";
import { laadKennis } from "@/jarvis/src/store";

const WORTEL = path.join(process.cwd(), "tests/jarvis/fixtures");
const KENNIS = "kennis";

const CONFIG: JarvisConfig = {
  project: "fixture",
  enabled: true,
  knowledge_map: KENNIS,
  taken_map: "tasks",
  current_state: "STATE.md",
  project_kaart: "PROJECT.md",
  budget: { S: 800, M: 20000, L: 40000 },
  limieten: {
    qa_rondes: 3,
    subagenten: 12,
    besluiten_per_taak: 1,
    nieuwe_dec_per_taak: 3,
    wallclock_minuten: 60,
  },
  context_nooit: ["**/*.lock"],
  context_symbolen: ["**/types.ts"],
  context_fragment_regels: 40,
  sanitize_paden: [],
  status_paden: [],
  migratie_pad: "",
  rol_controle_vanaf: "",
  test_pad: "tests",
  branch_voorvoegsel: "jarvis/",
  rollen_map: "jarvis/roles",
  engine_repository: "",
  attestatie: { url: "", sleutel: "", bot: "", uitvoerders: [], extra_paden: [] },
  overzicht_kern_id: "",
  overzicht_kern_naam: "",
  overzicht_kern_paden: [],
  overzicht_kern_tag: "",
  rol_afgeleiden_map: "",
  rol_afgeleiden_voorvoegsel: "",
  rol_overzicht: "",
  rol_gereedschap: { lezen: "", schrijven: "", rapporteren: "", uitvoeren: "" },
};

async function laadFixture() {
  const lading = await laadKennis(WORTEL, KENNIS);
  return lading;
}

describe("laadKennis", () => {
  it("laadt alle records uit markdown zonder laadfouten", async () => {
    const lading = await laadFixture();
    expect(lading.laadFouten).toEqual([]);
    expect(lading.records.map((r) => r.id)).toEqual(["CON-0001", "DEC-0001", "DEC-0002", "RSK-0001"]);
  });

  it("vult tekstvelden uit de markdown-secties, niet uit de front-matter", async () => {
    const lading = await laadFixture();
    const dec = lading.records.find((r) => r.id === "DEC-0001");
    expect(dec?.type).toBe("DEC");
    if (dec?.type === "DEC") {
      expect(dec.besluit).toContain("API-routes");
      expect(dec.motivatie).toContain("Eén runtime");
      expect(dec.alternatieven).toHaveLength(1);
      expect(dec.alternatieven[0]).toContain("edge-functies");
      expect(dec.gevolgen).toHaveLength(1);
    }
  });

  it("leest geneste triggers van een randvoorwaarde", async () => {
    const lading = await laadFixture();
    const con = lading.records.find((r) => r.id === "CON-0001");
    if (con?.type !== "CON") throw new Error("CON-0001 ontbreekt");
    expect(con.hardheid).toBe("hard");
    expect(con.triggers?.woorden).toContain("webhook");
    expect(con.triggers?.paden).toEqual(["app/onboarding/**"]);
  });

  it("houdt bij uit welk bestand een record kwam", async () => {
    const lading = await laadFixture();
    expect(lading.herkomst.get("DEC-0001")).toBe("kennis/DECISIONS/DEC-0001.md");
  });

  it("keurt de set goed maar signaleert niets onverwachts", async () => {
    const lading = await laadFixture();
    expect(lading.validatie.ok).toBe(true);
    expect(lading.ok).toBe(true);
  });

  it("is deterministisch over herhaalde ladingen", async () => {
    const a = await laadFixture();
    const b = await laadFixture();
    expect(JSON.stringify(a.records)).toBe(JSON.stringify(b.records));
  });
});

describe("bouwContextPakket", () => {
  const basis = {
    config: CONFIG,
    readSource: createFileReader(WORTEL),
    gegenereerdOp: "2026-09-10T00:00:00Z",
  };

  it("neemt harde randvoorwaarden altijd op, ook zonder tekstuele treffer", async () => {
    const lading = await laadFixture();
    const pakket = await bouwContextPakket({
      ...basis,
      taak: "iets over rapportage dat niets met onboarding te maken heeft",
      klasse: "M",
      records: lading.records,
    });
    expect(pakket.items.filter((i) => i.soort === "randvoorwaarde").map((i) => i.id)).toEqual(["CON-0001"]);
  });

  it("vindt het relevante besluit op basis van de taakomschrijving", async () => {
    const lading = await laadFixture();
    const pakket = await bouwContextPakket({
      ...basis,
      taak: "waar draait de backendlogica, in api-routes of aparte functies",
      klasse: "M",
      records: lading.records,
    });
    const records = pakket.items.filter((i) => i.soort === "record").map((i) => i.id);
    expect(records).toContain("DEC-0001");
  });

  it("biedt herzien besluit niet aan als geldende kennis", async () => {
    const lading = await laadFixture();
    const pakket = await bouwContextPakket({
      ...basis,
      taak: "backendlogica runtime functies",
      klasse: "M",
      records: lading.records,
    });
    expect(pakket.items.map((i) => i.id)).not.toContain("DEC-0002");
  });

  it("respecteert het budget en verantwoordt wat wegvalt", async () => {
    const lading = await laadFixture();
    const pakket = await bouwContextPakket({
      ...basis,
      taak: "backendlogica runtime api routes functies onboarding verwerking",
      klasse: "S",
      records: lading.records,
    });
    expect(pakket.budget).toBe(800);
    expect(pakket.weggelaten.length).toBeGreaterThan(0);
    for (const w of pakket.weggelaten) expect(w.reden.length).toBeGreaterThan(0);
  });

  it("laat kern en harde randvoorwaarden nooit vallen voor budget", async () => {
    const lading = await laadFixture();
    const pakket = await bouwContextPakket({
      ...basis,
      taak: "alles",
      klasse: "S",
      records: lading.records,
    });
    const verplicht = pakket.items.filter((i) => i.soort === "randvoorwaarde");
    expect(verplicht.map((i) => i.id)).toContain("CON-0001");
  });

  it("levert een manifest met een verifieerbare hash en de gebruikte bronnen", async () => {
    const lading = await laadFixture();
    const pakket = await bouwContextPakket({
      ...basis,
      taak: "backendlogica",
      klasse: "M",
      records: lading.records,
    });
    expect(pakket.manifest.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pakket.manifest.records.length).toBeGreaterThan(0);
    for (const r of pakket.manifest.records) expect(r.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("is deterministisch: twee identieke aanroepen geven hetzelfde manifest", async () => {
    const lading = await laadFixture();
    const maak = () =>
      bouwContextPakket({ ...basis, taak: "backendlogica runtime", klasse: "M", records: lading.records });
    const a = await maak();
    const b = await maak();
    expect(a.manifest.manifestHash).toBe(b.manifest.manifestHash);
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
  });

  it("symboliseert een gegenereerd bestand in plaats van het voluit op te nemen", async () => {
    const lading = await laadFixture();
    const groot = Array.from({ length: 400 }, (_, i) => `          veld${i}: string`).join("\n");
    const pakket = await bouwContextPakket({
      ...basis,
      taak: "types",
      klasse: "M",
      records: lading.records,
      bestanden: ["db/types.ts"],
      readSource: createMemoryReader({ "db/types.ts": groot, "PROJECT.md": "# P", "STATE.md": "# S" }),
    });
    const bestand = pakket.items.find((i) => i.id === "db/types.ts");
    expect(bestand?.bestandsKlasse).toBe("symbolen");
    expect(bestand?.tekst).toContain("symbolenskelet");
  });

  it("sluit bestanden op de nooit-lijst uit met vermelding", async () => {
    const lading = await laadFixture();
    const pakket = await bouwContextPakket({
      ...basis,
      taak: "iets",
      klasse: "M",
      records: lading.records,
      bestanden: ["deps.lock"],
      readSource: createMemoryReader({ "deps.lock": "x".repeat(5000), "PROJECT.md": "# P", "STATE.md": "# S" }),
    });
    expect(pakket.items.map((i) => i.id)).not.toContain("deps.lock");
    expect(pakket.weggelaten.map((w) => w.id)).toContain("deps.lock");
  });

  it("meldt een ontbrekend kernbestand als signaal in plaats van stil te falen", async () => {
    const lading = await laadFixture();
    const pakket = await bouwContextPakket({
      ...basis,
      taak: "iets",
      klasse: "M",
      records: lading.records,
      readSource: createMemoryReader({}),
    });
    expect(pakket.signalen.some((s) => s.includes("kernbestand ontbreekt"))).toBe(true);
  });
});

describe("codecontext uit de gevonden kennis", () => {
  // Een blanco sessie weet niet welke bestanden bij de taak horen. De records
  // weten dat wel: hun bronnen wijzen de code aan. Zonder deze stap levert het
  // pakket alleen kennis en geen code — precies wat een cold-start-agent als
  // gat rapporteerde.
  const bestanden = {
    "PROJECT.md": "# P",
    "STATE.md": "# S",
    "docs/ARCH.md": "# Architectuur",
    "src/api/routes.ts": "export const routes = [];\n",
    "src/onboarding/stap.ts": "export const stap = 1;\n",
  };

  it("neemt de codebestanden mee waar de gevonden records naar verwijzen", async () => {
    const lading = await laadFixture();
    const records = lading.records.map((r) =>
      r.id === "DEC-0001" ? { ...r, bronnen: ["docs/ARCH.md", "src/api/routes.ts"] } : r,
    );
    const pakket = await bouwContextPakket({
      config: CONFIG,
      readSource: createMemoryReader(bestanden),
      gegenereerdOp: "2026-09-10T00:00:00Z",
      taak: "waar draait de backendlogica, in api-routes of aparte functies",
      klasse: "M",
      records,
    });
    const paden = pakket.items.filter((i) => i.soort === "bestand").map((i) => i.id);
    expect(paden).toContain("src/api/routes.ts");
  });

  it("laat documentatie liggen: die zit al als kennis in het pakket", async () => {
    const lading = await laadFixture();
    const records = lading.records.map((r) =>
      r.id === "DEC-0001" ? { ...r, bronnen: ["docs/ARCH.md", "src/api/routes.ts"] } : r,
    );
    const pakket = await bouwContextPakket({
      config: CONFIG,
      readSource: createMemoryReader(bestanden),
      gegenereerdOp: "2026-09-10T00:00:00Z",
      taak: "backendlogica api-routes",
      klasse: "M",
      records,
    });
    expect(pakket.items.map((i) => i.id)).not.toContain("docs/ARCH.md");
  });

  it("verantwoordt waar een bestand vandaan komt", async () => {
    const lading = await laadFixture();
    const records = lading.records.map((r) =>
      r.id === "DEC-0001" ? { ...r, bronnen: ["src/api/routes.ts"] } : r,
    );
    const pakket = await bouwContextPakket({
      config: CONFIG,
      readSource: createMemoryReader(bestanden),
      gegenereerdOp: "2026-09-10T00:00:00Z",
      taak: "backendlogica api-routes",
      klasse: "M",
      records,
      bestanden: ["src/onboarding/stap.ts"],
    });
    const afgeleid = pakket.items.find((i) => i.id === "src/api/routes.ts");
    const genoemd = pakket.items.find((i) => i.id === "src/onboarding/stap.ts");
    expect(afgeleid?.reden).toContain("aangewezen door de gevonden kennis");
    expect(genoemd?.reden).toContain("expliciet genoemd bij de taak");
  });

  it("zet code van taakrelevante records vóór code van altijd-geldende randvoorwaarden", async () => {
    const lading = await laadFixture();
    const records = lading.records.map((r) => {
      if (r.id === "DEC-0001") return { ...r, bronnen: ["src/api/routes.ts"] };
      if (r.id === "CON-0001") return { ...r, bronnen: ["src/onboarding/stap.ts"] };
      return r;
    });
    const pakket = await bouwContextPakket({
      config: CONFIG,
      readSource: createMemoryReader(bestanden),
      gegenereerdOp: "2026-09-10T00:00:00Z",
      taak: "backendlogica api-routes",
      klasse: "M",
      records,
    });
    const paden = pakket.items.filter((i) => i.soort === "bestand").map((i) => i.id);
    expect(paden.indexOf("src/api/routes.ts")).toBeLessThan(paden.indexOf("src/onboarding/stap.ts"));
  });
});

describe("rendereerPakket", () => {
  it("noemt altijd expliciet wat is weggelaten", async () => {
    const lading = await laadFixture();
    const pakket = await bouwContextPakket({
      config: CONFIG,
      readSource: createFileReader(WORTEL),
      gegenereerdOp: "2026-09-10T00:00:00Z",
      taak: "backendlogica",
      klasse: "M",
      records: lading.records,
    });
    const markdown = rendereerPakket(pakket);
    expect(markdown).toContain("## Weggelaten");
    expect(markdown).toContain(pakket.manifest.manifestHash);
  });
});
