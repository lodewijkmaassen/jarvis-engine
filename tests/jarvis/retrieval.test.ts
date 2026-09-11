// Jarvis-kern — deterministische
// term-based retrieval.
import { describe, expect, it } from "vitest";
import { buildIndex, search } from "@/jarvis/src/retrieval";
import { validateRecordSet } from "@/jarvis/src/records";
import { isStopwoord, tokenize, uniqueTokens } from "@/jarvis/src/text";
import { GELDIGE_RECORDS } from "@/tests/jarvis/fixtures/records";

const RECORDS = validateRecordSet(GELDIGE_RECORDS).records;
const INDEX = buildIndex(RECORDS);

describe("tokenize", () => {
  it("verlaagt naar kleine letters en gooit leestekens weg", () => {
    expect(tokenize("Telefonie, doorschakeling!")).toEqual(["telefonie", "doorschakeling"]);
  });

  it("verwijdert diakrieten", () => {
    expect(tokenize("café coöperatie")).toEqual(["cafe", "cooperatie"]);
    // "één" normaliseert naar "een" en valt daarna als stopwoord weg — dat is
    // de bedoelde volgorde: eerst normaliseren, dan pas filteren.
    expect(tokenize("één café")).toEqual(["cafe"]);
  });

  it("verwijdert stopwoorden en tekens van één letter", () => {
    expect(tokenize("de klant en het nummer a b")).toEqual(["klant", "nummer"]);
    expect(isStopwoord("De")).toBe(true);
    expect(isStopwoord("nummer")).toBe(false);
  });

  it("behoudt cijfers en alfanumerieke codes", () => {
    expect(tokenize("ronde 4 en DEC-0003")).toEqual(["ronde", "dec", "0003"]);
  });

  it("uniqueTokens ontdubbelt op volgorde van eerste voorkomen", () => {
    expect(uniqueTokens("nummer nummer klant nummer")).toEqual(["nummer", "klant"]);
  });
});

describe("buildIndex", () => {
  it("indexeert elk record", () => {
    expect(INDEX.aantalRecords).toBe(RECORDS.length);
    expect(INDEX.records.map((r) => r.record.id)).toEqual([...RECORDS.map((r) => r.id)]);
  });

  it("weegt een titeltreffer zwaarder dan een treffer in een gewoon veld", () => {
    const record = INDEX.records.find((r) => r.record.id === "DEC-0003");
    // "nummer" staat in de titel (gewicht 4) en verderop nog vaker;
    // "vertrouwen" staat alleen in de motivatie (gewicht 1).
    const nummer = record?.gewichten.get("nummer") ?? 0;
    const vertrouwen = record?.gewichten.get("vertrouwen") ?? 0;
    expect(nummer).toBeGreaterThan(vertrouwen);
    expect(vertrouwen).toBe(1);
  });

  it("telt documentfrequentie per record, niet per voorkomen", () => {
    const df = INDEX.documentFrequentie.get("telefonie") ?? 0;
    expect(df).toBeGreaterThan(0);
    expect(df).toBeLessThanOrEqual(INDEX.aantalRecords);
  });

  it("is onafhankelijk van de aanleveringsvolgorde", () => {
    const omgekeerd = buildIndex([...RECORDS].reverse());
    expect(omgekeerd.records.map((r) => r.record.id)).toEqual(
      INDEX.records.map((r) => r.record.id),
    );
  });
});

describe("search", () => {
  it("vindt het nummerbesluit bovenaan bij een gerichte vraag", () => {
    const resultaat = search(INDEX, "mag een platformnummer het eigen nummer vervangen");
    expect(resultaat.hits.length).toBeGreaterThan(0);
    expect(resultaat.hits[0].record.id).toBe("DEC-0003");
  });

  it("verklaart elke treffer met de termen die eraan bijdroegen", () => {
    const resultaat = search(INDEX, "doorschakeling telefonie");
    const top = resultaat.hits[0];
    expect(top.termen.length).toBeGreaterThan(0);
    for (const term of top.termen) {
      expect(resultaat.termen).toContain(term.term);
      expect(term.bijdrage).toBeGreaterThan(0);
    }
    // Bijdragen aflopend gesorteerd.
    const bijdragen = top.termen.map((t) => t.bijdrage);
    expect(bijdragen).toEqual([...bijdragen].sort((a, b) => b - a));
  });

  it("geeft bij dezelfde invoer exact dezelfde uitvoer (determinisme)", () => {
    const a = search(INDEX, "externe keten acceptatie bewijs");
    const b = search(buildIndex([...RECORDS].reverse()), "externe keten acceptatie bewijs");
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("negeert stopwoorden in de query", () => {
    const met = search(INDEX, "wat is de doorschakeling van de klant");
    const zonder = search(INDEX, "doorschakeling klant");
    expect(met.termen).toEqual(zonder.termen);
    expect(met.hits.map((h) => h.record.id)).toEqual(zonder.hits.map((h) => h.record.id));
  });

  it("geeft niets terug bij een query zonder bruikbare termen", () => {
    const resultaat = search(INDEX, "de en het");
    expect(resultaat.termen).toEqual([]);
    expect(resultaat.hits).toEqual([]);
  });

  it("geeft niets terug voor een term die nergens voorkomt", () => {
    expect(search(INDEX, "kwantumverstrengeling").hits).toEqual([]);
  });

  it("respecteert de limiet", () => {
    const resultaat = search(INDEX, "telefonie klant nummer testen bericht", { limiet: 2 });
    expect(resultaat.hits).toHaveLength(2);
    expect(resultaat.onderzocht).toBe(RECORDS.length);
  });

  it("filtert op recordtype", () => {
    const resultaat = search(INDEX, "telefonie", { types: ["RSK"], limiet: 10 });
    expect(resultaat.hits.length).toBeGreaterThan(0);
    for (const hit of resultaat.hits) expect(hit.record.type).toBe("RSK");
  });

  it("filtert op tags (alle opgegeven tags moeten aanwezig zijn)", () => {
    const een = search(INDEX, "telefonie", { tags: ["telefonie"], limiet: 10 });
    const beide = search(INDEX, "telefonie", { tags: ["telefonie", "onboarding"], limiet: 10 });
    expect(een.hits.length).toBeGreaterThan(beide.hits.length);
    expect(beide.hits.map((h) => h.record.id)).toEqual(["RSK-0002"]);
  });

  it("filtert op datum", () => {
    const resultaat = search(INDEX, "telefonie nummer", { vanaf: "2026-02-01", limiet: 10 });
    for (const hit of resultaat.hits) {
      expect(hit.record.datum >= "2026-02-01").toBe(true);
    }
    expect(resultaat.hits.map((h) => h.record.id)).not.toContain("DEC-0004");
  });

  it("sorteert op score aflopend en bij gelijke score op id oplopend", () => {
    const resultaat = search(INDEX, "besluit telefonie testen bericht klant", { limiet: 20 });
    for (let i = 1; i < resultaat.hits.length; i += 1) {
      const vorige = resultaat.hits[i - 1];
      const huidige = resultaat.hits[i];
      expect(vorige.score).toBeGreaterThanOrEqual(huidige.score);
      if (vorige.score === huidige.score) {
        expect(vorige.record.id < huidige.record.id).toBe(true);
      }
    }
  });

  it("laat een zeldzame term zwaarder wegen dan een alledaagse", () => {
    const zeldzaam = search(INDEX, "kwantum doorschakeling", { limiet: 10 });
    const veelvoorkomend = search(INDEX, "record", { limiet: 10 });
    expect(zeldzaam.hits[0].score).toBeGreaterThan(veelvoorkomend.hits[0]?.score ?? 0);
  });

  it("past minimumScore toe", () => {
    const ruim = search(INDEX, "telefonie klant nummer", { limiet: 20 });
    const streng = search(INDEX, "telefonie klant nummer", {
      limiet: 20,
      minimumScore: ruim.hits[0].score - 0.000001,
    });
    expect(streng.hits).toHaveLength(1);
    expect(streng.hits[0].record.id).toBe(ruim.hits[0].record.id);
  });

  it("scores zijn afgerond, zodat float-ruis de volgorde nooit bepaalt", () => {
    for (const hit of search(INDEX, "telefonie klant", { limiet: 20 }).hits) {
      expect(hit.score).toBe(Math.round(hit.score * 1e6) / 1e6);
    }
  });
});
