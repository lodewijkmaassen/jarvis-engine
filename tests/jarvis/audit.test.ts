// Jarvis-kern — audittrail.
//
// De eis is niet "we hebben logs" maar "we kunnen het naspelen, uit de
// repository alleen". Deze tests borgen vooral het onderscheid tussen een
// dossier dat compleet is en een dossier dat er compleet UITZIET: een manifest
// dat naar sindsdien gewijzigde records wijst is geen bewijs meer.
import { describe, expect, it } from "vitest";
import { bouwAuditRapport, leesTrailers, rendereerAudit, type CommitRegel } from "@/jarvis/src/audit";
import { buildManifest } from "@/jarvis/src/manifest";
import { buildIndex, search } from "@/jarvis/src/retrieval";
import { validateRecordSet, type KnowledgeRecord } from "@/jarvis/src/records";
import { createMemoryReader } from "@/jarvis/src/sources";

const RECORDS_RUW = [
  {
    id: "DEC-0001",
    type: "DEC",
    titel: "Backendlogica in api-routes",
    samenvatting: "Een runtime, een deploy.",
    datum: "2026-01-10",
    status: "besloten",
    tags: ["architectuur"],
    bronnen: ["docs/ARCH.md"],
    besluit: "Alles in api-routes.",
    motivatie: "Eenvoud.",
    alternatieven: [],
    gevolgen: [],
    vervangt: [],
  },
];

function records(): readonly KnowledgeRecord[] {
  const validatie = validateRecordSet(RECORDS_RUW);
  expect(validatie.ok).toBe(true);
  return validatie.records;
}

const BRONNEN = { "docs/ARCH.md": "# Architectuur\nEen runtime.\n" };

async function maakManifestJson(bron: Record<string, string> = BRONNEN): Promise<string> {
  const resultaat = search(buildIndex(records()), "backendlogica api-routes");
  const manifest = await buildManifest(resultaat, {
    gegenereerdOp: "2026-09-10T00:00:00Z",
    readSource: createMemoryReader(bron),
  });
  return JSON.stringify({ manifest });
}

const COMMITS: readonly CommitRegel[] = [
  {
    hash: "abc1234",
    auteur: "Claude",
    datum: "2026-09-10",
    onderwerp: "feat: iets",
    taak: "T-0001",
    rol: "developer",
  },
];

const VOLLEDIG_DOSSIER = new Map([
  ["opdracht.md", "# Opdracht\ntekst"],
  ["context-pack.md", "# Context\ntekst"],
  ["analysis.md", "# Analyse\ntekst"],
  ["implementatie.md", "# Implementatie\ntekst"],
  ["qa-rapport.md", "# QA\nPASS"],
  ["resultaat.md", "# Resultaat\ntekst"],
]);

describe("leesTrailers", () => {
  it("leest taak en rol uit een commitbericht", () => {
    const bericht = "feat: iets\n\nUitleg.\n\nJarvis-Task: T-0007\nJarvis-Role: qa\n";
    expect(leesTrailers(bericht)).toEqual({ taak: "T-0007", rol: "qa" });
  });

  it("geeft null wanneer de trailers ontbreken", () => {
    expect(leesTrailers("feat: iets zonder trailers")).toEqual({ taak: null, rol: null });
  });
});

describe("bouwAuditRapport", () => {
  it("noemt een volledig dossier zonder drift volledig", async () => {
    const rapport = await bouwAuditRapport({
      taakId: "T-0001",
      dossier: VOLLEDIG_DOSSIER,
      manifestJson: await maakManifestJson(),
      commits: COMMITS,
      diffStat: " 2 files changed",
      records: records(),
      readSource: createMemoryReader(BRONNEN),
    });
    expect(rapport.volledig).toBe(true);
    expect(rapport.bevindingen).toEqual([]);
    expect(rapport.manifestVerificatie?.ok).toBe(true);
  });

  it("markeert een ontbrekend QA-rapport als fout, niet als waarschuwing", async () => {
    const zonderQa = new Map(VOLLEDIG_DOSSIER);
    zonderQa.delete("qa-rapport.md");
    const rapport = await bouwAuditRapport({
      taakId: "T-0001",
      dossier: zonderQa,
      manifestJson: await maakManifestJson(),
      commits: COMMITS,
      diffStat: null,
      records: records(),
      readSource: createMemoryReader(BRONNEN),
    });
    expect(rapport.volledig).toBe(false);
    const qaBevinding = rapport.bevindingen.find((b) => b.boodschap.includes("qa-rapport.md"));
    expect(qaBevinding?.severity).toBe("fout");
  });

  it("faalt hard wanneer niet vast te stellen is welke context er lag", async () => {
    const rapport = await bouwAuditRapport({
      taakId: "T-0001",
      dossier: VOLLEDIG_DOSSIER,
      manifestJson: null,
      commits: COMMITS,
      diffStat: null,
      records: records(),
      readSource: createMemoryReader(BRONNEN),
    });
    expect(rapport.bevindingen.some((b) => b.severity === "fout" && b.boodschap.includes("context"))).toBe(true);
  });

  it("detecteert dat een bronbestand sinds het manifest is gewijzigd", async () => {
    const rapport = await bouwAuditRapport({
      taakId: "T-0001",
      dossier: VOLLEDIG_DOSSIER,
      manifestJson: await maakManifestJson(),
      commits: COMMITS,
      diffStat: null,
      records: records(),
      readSource: createMemoryReader({ "docs/ARCH.md": "# Architectuur\nIETS ANDERS\n" }),
    });
    expect(rapport.volledig).toBe(false);
    expect(rapport.manifestVerificatie?.ok).toBe(false);
    expect(rapport.bevindingen.some((b) => b.boodschap.includes("bron_gewijzigd"))).toBe(true);
  });

  it("detecteert dat een kennisrecord sinds het manifest is gewijzigd", async () => {
    const gewijzigd = validateRecordSet([{ ...RECORDS_RUW[0], besluit: "Toch iets anders." }]).records;
    const rapport = await bouwAuditRapport({
      taakId: "T-0001",
      dossier: VOLLEDIG_DOSSIER,
      manifestJson: await maakManifestJson(),
      commits: COMMITS,
      diffStat: null,
      records: gewijzigd,
      readSource: createMemoryReader(BRONNEN),
    });
    expect(rapport.bevindingen.some((b) => b.boodschap.includes("record_gewijzigd"))).toBe(true);
  });

  it("meldt onleesbare JSON in plaats van te crashen", async () => {
    const rapport = await bouwAuditRapport({
      taakId: "T-0001",
      dossier: VOLLEDIG_DOSSIER,
      manifestJson: "{ dit is geen json",
      commits: COMMITS,
      diffStat: null,
      records: records(),
      readSource: createMemoryReader(BRONNEN),
    });
    expect(rapport.bevindingen.some((b) => b.boodschap.includes("geldige JSON"))).toBe(true);
  });

  it("waarschuwt over commits zonder taak-trailer", async () => {
    const rapport = await bouwAuditRapport({
      taakId: "T-0001",
      dossier: VOLLEDIG_DOSSIER,
      manifestJson: await maakManifestJson(),
      commits: [{ ...COMMITS[0], taak: null, rol: null }],
      diffStat: null,
      records: records(),
      readSource: createMemoryReader(BRONNEN),
    });
    expect(rapport.bevindingen.some((b) => b.boodschap.includes("zonder Jarvis-Task-trailer"))).toBe(true);
  });

  it("waarschuwt wanneer er helemaal geen commits zijn", async () => {
    const rapport = await bouwAuditRapport({
      taakId: "T-0001",
      dossier: VOLLEDIG_DOSSIER,
      manifestJson: await maakManifestJson(),
      commits: [],
      diffStat: null,
      records: records(),
      readSource: createMemoryReader(BRONNEN),
    });
    expect(rapport.volledig).toBe(false);
    expect(rapport.bevindingen.some((b) => b.boodschap.includes("geen commits"))).toBe(true);
  });
});

describe("rendereerAudit", () => {
  it("toont dossier, context, commits en bevindingen", async () => {
    const rapport = await bouwAuditRapport({
      taakId: "T-0001",
      dossier: VOLLEDIG_DOSSIER,
      manifestJson: await maakManifestJson(),
      commits: COMMITS,
      diffStat: " 2 files changed",
      records: records(),
      readSource: createMemoryReader(BRONNEN),
    });
    const uit = rendereerAudit(rapport);
    expect(uit).toContain("# Audit — T-0001");
    expect(uit).toContain("Reconstructie volledig:** ja");
    expect(uit).toContain("qa-rapport.md");
    expect(uit).toContain("abc1234");
    expect(uit).toContain("geen drift");
    expect(uit).toContain("2 files changed");
  });
});
