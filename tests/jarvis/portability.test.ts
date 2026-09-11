// Jarvis-kern — portabiliteit.
//
// De engine mag geen enkele aanname bevatten over het project waarin hij
// toevallig is gebouwd. Deze test draait de volledige keten tegen een fictief
// project in een ander domein, met andere mapnamen, andere drempels en andere
// recordinhoud: `jarvis/fixtures/demo-project`. Slaagt dit niet, dan is de
// engine niet generiek, hoe netjes de mappen ook heten.
//
// Daarnaast staat hier de verboden-woordencontrole. Die is grover maar vangt
// wat een functionele test mist: een projectnaam of leveranciersnaam die in
// een rolcontract of in de engine sluipt.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bouwAuditRapport } from "@/jarvis/src/audit";
import { bouwContextPakket } from "@/jarvis/src/context";
import { laadConfig } from "@/jarvis/src/config";
import { lint } from "@/jarvis/src/lint";
import { laadAllowlist, sanitizeBestanden, LEGE_ALLOWLIST } from "@/jarvis/src/sanitize";
import { createFileReader } from "@/jarvis/src/sources";
import { laadKennis } from "@/jarvis/src/store";
import { genereerFeitenblok } from "@/jarvis/src/state";

const DEMO = path.join(process.cwd(), "jarvis/fixtures/demo-project");

async function demoConfig() {
  const resultaat = await laadConfig(DEMO);
  if (!resultaat.ok) throw new Error(`config laadt niet: ${resultaat.fouten.join("; ")}`);
  return resultaat.config;
}

describe("de engine draait tegen een vreemd project", () => {
  it("leest de configuratie van dat project, met eigen mapnamen en drempels", async () => {
    const config = await demoConfig();
    expect(config.project).toBe("bibliotheek");
    expect(config.knowledge_map).toBe("kennis");
    expect(config.taken_map).toBe("taken");
    expect(config.budget.S).toBe(1200);
    expect(config.branch_voorvoegsel).toBe("robot/");
  });

  it("laadt de kennis ondanks volstrekt andere mapnamen", async () => {
    const config = await demoConfig();
    const lading = await laadKennis(DEMO, config.knowledge_map);
    expect(lading.laadFouten).toEqual([]);
    expect(lading.ok).toBe(true);
    // De mappen heten BESLUITEN/REGELS/RISICOS; het type komt uit de
    // front-matter, niet uit het pad.
    expect(lading.records.map((r) => r.id).sort()).toEqual(["CON-0001", "DEC-0001", "RSK-0001"]);
  });

  it("stelt een contextpakket samen binnen het budget van dat project", async () => {
    const config = await demoConfig();
    const lading = await laadKennis(DEMO, config.knowledge_map);
    const pakket = await bouwContextPakket({
      taak: "herinneringstermijn per medium instelbaar maken voor tijdschriften",
      klasse: "S",
      config,
      records: lading.records,
      bestanden: ["bron/schema.ts"],
      readSource: createFileReader(DEMO),
      gegenereerdOp: "2026-09-10T00:00:00Z",
    });
    expect(pakket.budget).toBe(1200);
    expect(pakket.items.some((i) => i.id === "DEC-0001")).toBe(true);
    // De harde regel van dat project komt altijd mee, ook al gaat de taak
    // ergens anders over.
    expect(pakket.items.some((i) => i.id === "CON-0001" && i.soort === "randvoorwaarde")).toBe(true);
    expect(pakket.manifest.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handhaaft de randvoorwaarde van dat project", async () => {
    const config = await demoConfig();
    const lading = await laadKennis(DEMO, config.knowledge_map);
    const resultaat = lint({
      config,
      lading,
      gewijzigdeBestanden: ["bron/uitleen/overzicht.ts"],
      tekstCorpus: "toon een overzicht van alle leden en hun leengeschiedenis",
      acks: [],
    });
    expect(resultaat.ok).toBe(false);
    expect(resultaat.bevindingen.some((b) => b.code === "randvoorwaarde_geraakt" && b.onderwerp === "CON-0001")).toBe(
      true,
    );
  });

  it("gebruikt de status-dragende paden van dat project, niet die van een ander", async () => {
    const config = await demoConfig();
    const lading = await laadKennis(DEMO, config.knowledge_map);
    // supabase/migrations is elders status-dragend, hier niet.
    const vreemd = lint({
      config,
      lading,
      gewijzigdeBestanden: ["supabase/migrations/0001_x.sql"],
      tekstCorpus: "",
      acks: [],
    });
    expect(vreemd.bevindingen.some((b) => b.code === "status_impact_ontbreekt")).toBe(false);

    const eigen = lint({
      config,
      lading,
      gewijzigdeBestanden: ["bron/migraties/0001_x.sql"],
      tekstCorpus: "",
      acks: [],
    });
    expect(eigen.bevindingen.some((b) => b.code === "status_impact_ontbreekt")).toBe(true);
  });

  it("sanitizet de kennis van dat project", async () => {
    const config = await demoConfig();
    const bestanden = ["kennis/REGELS/CON-0001.md", "kennis/BESLUITEN/DEC-0001.md"];
    expect(config.sanitize_paden).toContain("kennis");
    const resultaat = await sanitizeBestanden(
      bestanden,
      async (pad) => readFile(path.join(DEMO, pad), "utf8"),
      async () => {
        throw new Error("de fixture is schoon; er hoort niets herschreven te worden");
      },
      LEGE_ALLOWLIST,
    );
    expect(resultaat.ok).toBe(true);
    expect(resultaat.gewijzigd).toEqual([]);
  });

  it("bouwt een auditrapport voor dat project", async () => {
    const config = await demoConfig();
    const lading = await laadKennis(DEMO, config.knowledge_map);
    const rapport = await bouwAuditRapport({
      taakId: "T-0001",
      dossier: new Map(),
      manifestJson: null,
      commits: [],
      diffStat: null,
      records: lading.records,
      readSource: createFileReader(DEMO),
    });
    // Leeg dossier: het rapport hoort te WERKEN en te vertellen wat er mist.
    expect(rapport.taakId).toBe("T-0001");
    expect(rapport.volledig).toBe(false);
    expect(rapport.bevindingen.length).toBeGreaterThan(0);
  });

  it("genereert een feitenblok zonder iets over het andere project te weten", async () => {
    const config = await demoConfig();
    const lading = await laadKennis(DEMO, config.knowledge_map);
    const blok = genereerFeitenblok({
      gegenereerdOp: "2026-09-10",
      hoofdbranch: "main",
      hoofdbranchCommit: "abc1234",
      hoofdbranchDatum: "2026-09-09",
      hoogsteMigratie: null,
      aantalTestbestanden: null,
      recordTellingen: { DEC: 1, CON: 1, RSK: 1 },
      openConflicten: [],
      openTaken: [],
      actieveBranches: [],
    });
    expect(blok).toContain("DEC 1");
    expect(lading.records).toHaveLength(3);
  });

  it("weigert een allowlist met een intern identificatienummer, ook hier", async () => {
    const resultaat = laadAllowlist("emails:\n  - a@b.nl\ntelefoonnummers: []\ntokens:\n  - 520b540f-93cb-48a9-8f40-7ad8b5256f23\n");
    expect(resultaat.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Verboden woorden
// ---------------------------------------------------------------------------

const VERBODEN_IN_ROLLEN = [
  "claude",
  "anthropic",
  "openai",
  "gpt",
  "gemini",
  "copilot",
  "sonnet",
  "opus",
  "haiku",
];

/**
 * Woorden die nergens in de engine mogen staan: ze horen bij het project
 * waarin de engine toevallig is gebouwd, of bij zijn domein.
 */
const PROJECTWOORDEN = ["tovas", "whatsapp", "offerte", "business_id", "lead"];

/**
 * Leveranciersnamen. Die mogen op precies één plek staan: de patroonlijst van
 * de secretscanner. Een scanner die niet weet hoe een sleutel van een bekende
 * leverancier eruitziet, is geen scanner — dat is domeinkennis over secrets,
 * geen koppeling aan dit project. Overal elders is een leveranciersnaam een
 * lek.
 */
const LEVERANCIERSWOORDEN = ["twilio", "supabase", "resend", "vercel", "openai"];
const SCANNER_BESTAND = "sanitize.ts";

async function bestandenOnder(map: string, filter: (naam: string) => boolean): Promise<readonly string[]> {
  const uit: string[] = [];
  for (const item of await readdir(map, { withFileTypes: true })) {
    const kind = path.join(map, item.name);
    if (item.isDirectory()) {
      uit.push(...(await bestandenOnder(kind, filter)));
      continue;
    }
    if (filter(item.name)) uit.push(kind);
  }
  return uit;
}

async function zoekWoorden(bestanden: readonly string[], woorden: readonly string[]) {
  const treffers: string[] = [];
  for (const bestand of bestanden) {
    const inhoud = (await readFile(bestand, "utf8")).toLowerCase();
    for (const woord of woorden) {
      if (inhoud.includes(woord)) {
        treffers.push(`${path.relative(process.cwd(), bestand)} bevat "${woord}"`);
      }
    }
  }
  return treffers;
}

describe("verboden woorden", () => {
  it("rolcontracten noemen geen enkele leverancier of modelnaam", async () => {
    const rollen = await bestandenOnder(path.join(process.cwd(), "jarvis/roles"), (n) => n.endsWith(".md"));
    expect(rollen.length).toBeGreaterThan(0);
    expect(await zoekWoorden(rollen, VERBODEN_IN_ROLLEN)).toEqual([]);
  });

  it("policies noemen geen enkele leverancier of modelnaam", async () => {
    const policies = await bestandenOnder(path.join(process.cwd(), "jarvis/policies"), (n) => n.endsWith(".md"));
    expect(await zoekWoorden(policies, VERBODEN_IN_ROLLEN)).toEqual([]);
  });

  it("de engine bevat nergens een woord uit het domein van dit project", async () => {
    const engine = await bestandenOnder(path.join(process.cwd(), "jarvis/src"), (n) => n.endsWith(".ts"));
    expect(engine.length).toBeGreaterThan(0);
    expect(await zoekWoorden(engine, PROJECTWOORDEN)).toEqual([]);
  });

  it("leveranciersnamen staan alleen in de patroonlijst van de secretscanner", async () => {
    const engine = await bestandenOnder(path.join(process.cwd(), "jarvis/src"), (n) => n.endsWith(".ts"));
    const buitenScanner = engine.filter((b) => path.basename(b) !== SCANNER_BESTAND);
    expect(buitenScanner.length).toBeGreaterThan(0);
    expect(await zoekWoorden(buitenScanner, LEVERANCIERSWOORDEN)).toEqual([]);
  });

  it("de scanner kent die leveranciers wel — anders zou hij hun sleutels missen", async () => {
    const scanner = path.join(process.cwd(), "jarvis/src", SCANNER_BESTAND);
    const treffers = await zoekWoorden([scanner], LEVERANCIERSWOORDEN);
    expect(treffers.length).toBeGreaterThan(0);
  });
});
