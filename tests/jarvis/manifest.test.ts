// Jarvis-kern — context manifest
// genereren en verifiëren op drift.
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  computeManifestHash,
  contextManifestSchema,
  recordHash,
  verifyManifest,
  type ContextManifest,
} from "@/jarvis/src/manifest";
import { gitBlobHash } from "@/jarvis/src/hash";
import { validateRecordSet } from "@/jarvis/src/records";
import { buildIndex, search } from "@/jarvis/src/retrieval";
import {
  createFileReader,
  createMemoryReader,
  isVeiligBronpad,
} from "@/jarvis/src/sources";
import { GELDIGE_RECORDS } from "@/tests/jarvis/fixtures/records";

const FIXTURES = path.join(process.cwd(), "tests/jarvis/fixtures");
const RECORDS = validateRecordSet(GELDIGE_RECORDS).records;
const INDEX = buildIndex(RECORDS);
const OP = "2026-09-10T00:00:00.000Z";

const BESTANDEN = {
  "sources/architectuur.md": "# Architectuur (fake)\n\nDeterministisch.\n",
  "sources/telefonie.md": "# Telefonie (fake)\n\nEigen nummer blijft.\n",
  "sources/notificaties.md": "# Notificaties (fake)\n\nKeten telt.\n",
};

async function bouwManifest(
  query: string,
  bestanden: Readonly<Record<string, string>> = BESTANDEN,
): Promise<ContextManifest> {
  const resultaat = search(INDEX, query, { limiet: 3 });
  return buildManifest(resultaat, {
    gegenereerdOp: OP,
    readSource: createMemoryReader(bestanden),
  });
}

describe("buildManifest", () => {
  it("legt records met hun hash en verklarende termen vast", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling");
    expect(manifest.manifestVersie).toBe(1);
    expect(manifest.gegenereerdOp).toBe(OP);
    expect(manifest.records.length).toBeGreaterThan(0);
    for (const entry of manifest.records) {
      const record = RECORDS.find((r) => r.id === entry.id);
      expect(record).toBeDefined();
      expect(entry.hash).toBe(recordHash(record!));
      expect(entry.termen.length).toBeGreaterThan(0);
    }
  });

  it("legt de bronbestanden vast met hun Git-blob-hash en bytelengte", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling");
    expect(manifest.bronnen.length).toBeGreaterThan(0);
    for (const bron of manifest.bronnen) {
      const inhoud = BESTANDEN[bron.pad as keyof typeof BESTANDEN];
      expect(bron.blob).toBe(gitBlobHash(inhoud));
      expect(bron.bytes).toBe(Buffer.byteLength(inhoud, "utf8"));
    }
  });

  it("ontdubbelt en sorteert bronpaden", async () => {
    const manifest = await bouwManifest("externe keten acceptatie telefonie notificatie");
    const paden = manifest.bronnen.map((b) => b.pad);
    expect(paden).toEqual([...new Set(paden)]);
    expect(paden).toEqual([...paden].sort());
  });

  it("noteert een bron die niet gelezen kan worden apart, zonder te falen", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling", {
      "sources/architectuur.md": BESTANDEN["sources/architectuur.md"],
    });
    expect(manifest.ontbrekendeBronnen).toContain("sources/telefonie.md");
    expect(manifest.bronnen.map((b) => b.pad)).not.toContain("sources/telefonie.md");
  });

  it("de manifesthash dekt de hele inhoud", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling");
    const { manifestHash, ...body } = manifest;
    expect(computeManifestHash(body)).toBe(manifestHash);
    expect(computeManifestHash({ ...body, query: "iets anders" })).not.toBe(manifestHash);
  });

  it("is deterministisch: twee keer bouwen geeft een identiek manifest", async () => {
    const a = await bouwManifest("externe keten acceptatie");
    const b = await bouwManifest("externe keten acceptatie");
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("voldoet aan het manifestschema", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling");
    expect(contextManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("het schema weigert een manifest met een kapotte hash", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling");
    expect(
      contextManifestSchema.safeParse({ ...manifest, manifestHash: "geen-hash" }).success,
    ).toBe(false);
  });

  it("werkt met echte bestanden van schijf", async () => {
    const resultaat = search(INDEX, "eigen nummer doorschakeling", { limiet: 3 });
    const manifest = await buildManifest(resultaat, {
      gegenereerdOp: OP,
      readSource: createFileReader(FIXTURES),
    });
    expect(manifest.ontbrekendeBronnen).toEqual([]);
    expect(manifest.bronnen.length).toBeGreaterThan(0);
    for (const bron of manifest.bronnen) expect(bron.bytes).toBeGreaterThan(0);
  });
});

describe("verifyManifest", () => {
  it("meldt geen drift wanneer er niets is veranderd", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling");
    const uitkomst = await verifyManifest(manifest, {
      records: RECORDS,
      readSource: createMemoryReader(BESTANDEN),
    });
    expect(uitkomst.ok).toBe(true);
    expect(uitkomst.bevindingen).toEqual([]);
    expect(uitkomst.ongewijzigd).toBe(manifest.records.length + manifest.bronnen.length);
  });

  it("ziet een gewijzigd bronbestand", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling");
    const gewijzigd = {
      ...BESTANDEN,
      "sources/telefonie.md": BESTANDEN["sources/telefonie.md"] + "Regel erbij.\n",
    };
    const uitkomst = await verifyManifest(manifest, {
      records: RECORDS,
      readSource: createMemoryReader(gewijzigd),
    });
    expect(uitkomst.ok).toBe(false);
    const drift = uitkomst.bevindingen.find((b) => b.code === "bron_gewijzigd");
    expect(drift?.onderwerp).toBe("sources/telefonie.md");
    expect(drift?.gevonden).toBe(gitBlobHash(gewijzigd["sources/telefonie.md"]));
  });

  it("ziet een verdwenen bronbestand", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling");
    const uitkomst = await verifyManifest(manifest, {
      records: RECORDS,
      readSource: createMemoryReader({}),
    });
    expect(uitkomst.ok).toBe(false);
    expect(uitkomst.bevindingen.some((b) => b.code === "bron_ontbreekt")).toBe(true);
  });

  it("ziet een inhoudelijk gewijzigd record", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling");
    const doelId = manifest.records[0].id;
    const gewijzigd = RECORDS.map((r) =>
      r.id === doelId ? { ...r, samenvatting: `${r.samenvatting} (herzien)` } : r,
    );
    const uitkomst = await verifyManifest(manifest, {
      records: gewijzigd,
      readSource: createMemoryReader(BESTANDEN),
    });
    expect(uitkomst.ok).toBe(false);
    const drift = uitkomst.bevindingen.find((b) => b.code === "record_gewijzigd");
    expect(drift?.onderwerp).toBe(doelId);
    expect(drift?.verwacht).toBe(manifest.records[0].hash);
  });

  it("ziet een verdwenen record", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling");
    const doelId = manifest.records[0].id;
    const uitkomst = await verifyManifest(manifest, {
      records: RECORDS.filter((r) => r.id !== doelId),
      readSource: createMemoryReader(BESTANDEN),
    });
    expect(uitkomst.ok).toBe(false);
    const drift = uitkomst.bevindingen.find((b) => b.code === "record_ontbreekt");
    expect(drift?.onderwerp).toBe(doelId);
    expect(drift?.gevonden).toBeNull();
  });

  it("ziet een manipulatie van het manifest zelf", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling");
    const vervalst: ContextManifest = { ...manifest, query: "heel iets anders" };
    const uitkomst = await verifyManifest(vervalst, {
      records: RECORDS,
      readSource: createMemoryReader(BESTANDEN),
    });
    expect(uitkomst.ok).toBe(false);
    expect(uitkomst.bevindingen[0].code).toBe("manifest_hash_ongeldig");
  });

  it("meldt een eerder ontbrekende bron die terug is als info, niet als drift", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling", {
      "sources/architectuur.md": BESTANDEN["sources/architectuur.md"],
    });
    expect(manifest.ontbrekendeBronnen.length).toBeGreaterThan(0);
    const uitkomst = await verifyManifest(manifest, {
      records: RECORDS,
      readSource: createMemoryReader(BESTANDEN),
    });
    const info = uitkomst.bevindingen.find((b) => b.code === "bron_teruggekeerd");
    expect(info?.severity).toBe("info");
    expect(uitkomst.ok).toBe(true);
  });

  it("bevindingen staan in een vaste volgorde: manifest, records, bronnen", async () => {
    const manifest = await bouwManifest("eigen nummer doorschakeling");
    const vervalst: ContextManifest = { ...manifest, query: "anders" };
    const uitkomst = await verifyManifest(vervalst, {
      records: [],
      readSource: createMemoryReader({}),
    });
    const codes = uitkomst.bevindingen.map((b) => b.code);
    expect(codes[0]).toBe("manifest_hash_ongeldig");
    expect(codes.filter((c) => c === "record_ontbreekt")).toHaveLength(
      manifest.records.length,
    );
    expect(codes.indexOf("record_ontbreekt")).toBeLessThan(codes.indexOf("bron_ontbreekt"));
  });
});

describe("bronpadveiligheid", () => {
  it("weigert absolute paden, drive-letters en padtraversal", () => {
    expect(isVeiligBronpad("sources/architectuur.md")).toBe(true);
    expect(isVeiligBronpad("")).toBe(false);
    expect(isVeiligBronpad("/etc/hosts")).toBe(false);
    expect(isVeiligBronpad("C:/geheim.txt")).toBe(false);
    expect(isVeiligBronpad("../geheim.md")).toBe(false);
    expect(isVeiligBronpad("sources/../../geheim.md")).toBe(false);
    expect(isVeiligBronpad("sources\\..\\geheim.md")).toBe(false);
  });

  it("de bestandslezer geeft null in plaats van te lekken of te crashen", async () => {
    const lees = createFileReader(FIXTURES);
    expect(await lees("../../package.json")).toBeNull();
    expect(await lees("/etc/hosts")).toBeNull();
    expect(await lees("sources/bestaat-niet.md")).toBeNull();
    expect(await lees("sources/architectuur.md")).toContain("Synthetische");
  });
});
