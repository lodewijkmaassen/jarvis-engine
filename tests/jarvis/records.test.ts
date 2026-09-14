// Jarvis-kern — recordvalidatie
// voor DEC, CON, LRN, RSK en CFL.
import { describe, expect, it } from "vitest";
import {
  RECORD_TYPES,
  hoortInMap,
  isRecordType,
  recordTextFields,
  validateRecord,
  validateRecordSet,
  type KnowledgeRecord,
} from "@/jarvis/src/records";
import {
  GELDIGE_RECORDS,
  ONGELDIGE_RECORDS,
} from "@/tests/jarvis/fixtures/records";

function codes(issues: readonly { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

describe("recordtypes", () => {
  it("kent precies de vijf afgesproken types", () => {
    expect([...RECORD_TYPES]).toEqual(["DEC", "CON", "LRN", "RSK", "CFL"]);
  });

  it("isRecordType herkent alleen die vijf", () => {
    expect(isRecordType("DEC")).toBe(true);
    expect(isRecordType("dec")).toBe(false);
    expect(isRecordType("XYZ")).toBe(false);
    expect(isRecordType(null)).toBe(false);
  });
});

describe("hoortInMap — naam en id horen bij het type", () => {
  it("aanvaardt <id>.md met een id van het eigen type, in welke map dan ook", () => {
    expect(hoortInMap("CON", "CON-0001", "knowledge/CONSTRAINTS/CON-0001.md")).toBeNull();
    expect(hoortInMap("CON", "CON-0001", "kennis/REGELS/CON-0001.md")).toBeNull();
    expect(hoortInMap("DEC", "DEC-0044", "knowledge\\DECISIONS\\DEC-0044.md")).toBeNull();
  });
  it("weigert een id van een ander type en een afwijkende bestandsnaam", () => {
    // Een randvoorwaarde die zich als besluit vermomt: de administratieve
    // route herkent CON-records aan hun naam, dus die naam moet kloppen.
    expect(hoortInMap("CON", "DEC-0099", "knowledge/DECISIONS/DEC-0099.md")).toMatch(/past niet bij type CON/);
    expect(hoortInMap("CON", "CON-0099", "knowledge/DECISIONS/regel.md")).toMatch(/past niet bij id/);
    expect(hoortInMap("RSK", "RSK-0001", "knowledge/RISKS/RSK-0001.markdown")).toMatch(/past niet bij id/);
  });
});

describe("validateRecord — geldige records", () => {
  it("accepteert elk fixturerecord", () => {
    for (const record of GELDIGE_RECORDS) {
      const uitkomst = validateRecord(record);
      expect(uitkomst.ok, `${record.id} zou geldig moeten zijn`).toBe(true);
    }
  });

  it("dekt alle vijf de types met minstens één fixture", () => {
    const gedekt = new Set(GELDIGE_RECORDS.map((r) => r.type));
    expect([...gedekt].sort()).toEqual(["CFL", "CON", "DEC", "LRN", "RSK"]);
  });

  it("vult lege lijstvelden aan met een lege array", () => {
    const uitkomst = validateRecord({
      id: "LRN-0100",
      type: "LRN",
      titel: "Zonder tags of bronnen",
      samenvatting: "Minimaal record.",
      datum: "2026-03-01",
      observatie: "Iets waargenomen.",
      les: "Iets geleerd.",
    });
    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.record.tags).toEqual([]);
    expect(uitkomst.record.bronnen).toEqual([]);
    if (uitkomst.record.type !== "LRN") throw new Error("verwacht LRN");
    expect(uitkomst.record.bewijs).toEqual([]);
  });
});

describe("validateRecord — ongeldige records", () => {
  it("weigert een lege titel", () => {
    const uitkomst = validateRecord(ONGELDIGE_RECORDS.legeTitel);
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) return;
    expect(codes(uitkomst.issues)).toContain("schema_ongeldig");
    expect(uitkomst.issues[0].pad).toBe("titel");
  });

  it("weigert een id-voorvoegsel dat niet bij het type hoort", () => {
    const uitkomst = validateRecord(ONGELDIGE_RECORDS.voorvoegselMismatch);
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) return;
    expect(codes(uitkomst.issues)).toEqual(["type_voorvoegsel_mismatch"]);
  });

  it("weigert onbekende velden (typefouten in sleutels glippen er niet door)", () => {
    const uitkomst = validateRecord(ONGELDIGE_RECORDS.onbekendVeld);
    expect(uitkomst.ok).toBe(false);
  });

  it("weigert een absoluut bronpad", () => {
    const uitkomst = validateRecord(ONGELDIGE_RECORDS.absoluutBronpad);
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) return;
    expect(uitkomst.issues[0].pad).toBe("bronnen.0");
  });

  it("weigert padtraversal in een bronpad", () => {
    const uitkomst = validateRecord(ONGELDIGE_RECORDS.traversalBronpad);
    expect(uitkomst.ok).toBe(false);
  });

  it("weigert een datum in het verkeerde formaat", () => {
    const uitkomst = validateRecord(ONGELDIGE_RECORDS.verkeerdeDatum);
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) return;
    expect(uitkomst.issues[0].pad).toBe("datum");
  });

  it("weigert een opgelost conflict zonder oplossend besluit", () => {
    const uitkomst = validateRecord(ONGELDIGE_RECORDS.opgelostZonderBesluit);
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) return;
    expect(uitkomst.issues[0].pad).toBe("opgelost_door");
  });

  it("weigert een conflict met minder dan twee deelnemers", () => {
    const uitkomst = validateRecord(ONGELDIGE_RECORDS.conflictMetEenDeelnemer);
    expect(uitkomst.ok).toBe(false);
  });

  it("weigert een onbekend recordtype", () => {
    const uitkomst = validateRecord(ONGELDIGE_RECORDS.onbekendType);
    expect(uitkomst.ok).toBe(false);
  });

  it("weigert niet-objecten zonder te crashen", () => {
    for (const invoer of [null, undefined, 42, "DEC-0001", [], true]) {
      expect(validateRecord(invoer).ok).toBe(false);
    }
  });
});

describe("validateRecordSet — samenhang over de set", () => {
  it("keurt de complete fixtureset goed", () => {
    const uitkomst = validateRecordSet(GELDIGE_RECORDS);
    expect(uitkomst.ok).toBe(true);
    expect(uitkomst.records).toHaveLength(GELDIGE_RECORDS.length);
  });

  it("sorteert de records op id, ongeacht aanleveringsvolgorde", () => {
    const omgekeerd = [...GELDIGE_RECORDS].reverse();
    const a = validateRecordSet(GELDIGE_RECORDS).records.map((r) => r.id);
    const b = validateRecordSet(omgekeerd).records.map((r) => r.id);
    expect(b).toEqual(a);
    expect(a).toEqual([...a].sort());
  });

  it("signaleert het open conflict als waarschuwing, niet als fout", () => {
    const uitkomst = validateRecordSet(GELDIGE_RECORDS);
    const open = uitkomst.issues.filter((i) => i.code === "conflict_open");
    expect(open).toHaveLength(1);
    expect(open[0].recordId).toBe("CFL-0002");
    expect(open[0].severity).toBe("waarschuwing");
    expect(uitkomst.ok).toBe(true);
  });

  it("meldt een dubbele id", () => {
    const uitkomst = validateRecordSet([...GELDIGE_RECORDS, GELDIGE_RECORDS[0]]);
    expect(uitkomst.ok).toBe(false);
    expect(codes(uitkomst.issues)).toContain("dubbele_id");
  });

  it("meldt een verwijzing naar een onbekend record", () => {
    const zonderOudBesluit = GELDIGE_RECORDS.filter((r) => r.id !== "DEC-0004").filter(
      (r) => r.id !== "CFL-0001",
    );
    const uitkomst = validateRecordSet(zonderOudBesluit);
    expect(uitkomst.ok).toBe(false);
    const onbekend = uitkomst.issues.filter((i) => i.code === "verwijzing_onbekend");
    expect(onbekend).toHaveLength(1);
    expect(onbekend[0].recordId).toBe("DEC-0003");
    expect(onbekend[0].pad).toBe("vervangt[0]");
  });

  it("meldt een verwijzing naar het verkeerde recordtype", () => {
    const kapot: unknown[] = GELDIGE_RECORDS.map((r) =>
      r.id === "CON-0001" ? { ...r, bron_besluit: "LRN-0001" } : r,
    );
    const uitkomst = validateRecordSet(kapot);
    expect(uitkomst.ok).toBe(false);
    const fout = uitkomst.issues.find((i) => i.code === "verwijzing_verkeerd_type");
    expect(fout?.recordId).toBe("CON-0001");
    expect(fout?.boodschap).toContain("LRN");
  });

  it("meldt zelfverwijzing", () => {
    const kapot: unknown[] = GELDIGE_RECORDS.map((r) =>
      r.id === "DEC-0003" ? { ...r, vervangt: ["DEC-0003"] } : r,
    );
    const uitkomst = validateRecordSet(kapot);
    expect(uitkomst.ok).toBe(false);
    expect(codes(uitkomst.issues)).toContain("zelfverwijzing");
  });

  it("waarschuwt als een vervangen besluit nog actief staat", () => {
    const kapot: unknown[] = GELDIGE_RECORDS.map((r) =>
      r.id === "DEC-0004" ? { ...r, status: "besloten" } : r,
    );
    const uitkomst = validateRecordSet(kapot);
    const waarschuwing = uitkomst.issues.find(
      (i) => i.code === "vervangen_besluit_nog_actief",
    );
    expect(waarschuwing?.recordId).toBe("DEC-0003");
    expect(waarschuwing?.severity).toBe("waarschuwing");
    // Redactionele achterstand blokkeert de set niet.
    expect(uitkomst.ok).toBe(true);
  });

  it("laat een ongeldig record buiten de set maar valideert de rest door", () => {
    const uitkomst = validateRecordSet([
      ...GELDIGE_RECORDS,
      ONGELDIGE_RECORDS.verkeerdeDatum,
    ]);
    expect(uitkomst.ok).toBe(false);
    expect(uitkomst.records.map((r) => r.id)).not.toContain("DEC-0905");
    expect(uitkomst.records).toHaveLength(GELDIGE_RECORDS.length);
  });

  it("is idempotent: twee keer valideren geeft exact hetzelfde resultaat", () => {
    const a = validateRecordSet(GELDIGE_RECORDS);
    const b = validateRecordSet(GELDIGE_RECORDS);
    expect(JSON.stringify(b.issues)).toBe(JSON.stringify(a.issues));
  });
});

describe("recordTextFields", () => {
  it("geeft per type de typespecifieke tekstvelden terug", () => {
    const perType = new Map<string, readonly { veld: string }[]>();
    for (const record of GELDIGE_RECORDS) {
      if (!perType.has(record.type)) perType.set(record.type, recordTextFields(record));
    }
    expect(perType.get("DEC")?.map((v) => v.veld)).toEqual([
      "titel",
      "samenvatting",
      "tags",
      "besluit",
      "motivatie",
      "alternatieven",
      "gevolgen",
    ]);
    expect(perType.get("CON")?.map((v) => v.veld)).toEqual([
      "titel",
      "samenvatting",
      "tags",
      "regel",
    ]);
    expect(perType.get("RSK")?.map((v) => v.veld)).toEqual([
      "titel",
      "samenvatting",
      "tags",
      "beschrijving",
      "mitigatie",
    ]);
  });

  it("levert voor elk fixturerecord niet-lege tekst op", () => {
    for (const record of GELDIGE_RECORDS as readonly KnowledgeRecord[]) {
      const tekst = recordTextFields(record)
        .map((v) => v.tekst)
        .join(" ")
        .trim();
      expect(tekst.length).toBeGreaterThan(0);
    }
  });
});
