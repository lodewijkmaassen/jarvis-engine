/**
 * De controle die het gat tussen bron en productie dicht.
 *
 * Op 2026-10-02 verving een uitrol van de interface de bestanden niet. Elke
 * stap ervoor was groen — de bron klopte, de bouw klopte, de uitrolopdracht
 * eindigde met 0 — en het defect zat precies daarna. Deze tests leggen vast
 * dat die situatie nu rood is, en dat de randgevallen die er ook op lijken
 * (geen merk, een pagina die niet op te halen is) dat eveneens zijn.
 */
import { describe, expect, it } from "vitest";
import { beoordeelBouwmerk, controleerUitrol, leesBouwmerk } from "../../jarvis/src/uitrol";

const pagina = (merk: string | null) =>
  `<!doctype html><html><head><meta charset="utf-8">` +
  (merk === null ? "" : `<meta name="jarvis-bouwmerk" content="${merk}">`) +
  `</head><body>Jarvis</body></html>`;

const KOP = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";

describe("leesBouwmerk", () => {
  it("leest het merk uit de meta-tag", () => {
    expect(leesBouwmerk(pagina(KOP))).toBe(KOP);
  });

  it("geeft null als de pagina geen merk draagt", () => {
    expect(leesBouwmerk(pagina(null))).toBeNull();
  });

  it("leest ook enkele aanhalingstekens en een omgekeerde attribuutvolgorde", () => {
    const html = `<head><meta content='${KOP}' name='jarvis-bouwmerk'></head>`;
    expect(leesBouwmerk(html)).toBe(KOP);
  });

  it("laat zich niet verwarren door een andere meta-tag ervoor", () => {
    const html = `<head><meta name="viewport" content="width=device-width">${pagina(KOP)}</head>`;
    expect(leesBouwmerk(html)).toBe(KOP);
  });
});

describe("beoordeelBouwmerk", () => {
  it("keurt goed wanneer het merk de uitgerolde commit is", () => {
    const o = beoordeelBouwmerk(pagina(KOP), KOP, "https://voorbeeld/");
    expect(o.goed).toBe(true);
  });

  it("vergelijkt op het kortste voorvoegsel, zodat een afgekorte sha ook telt", () => {
    expect(beoordeelBouwmerk(pagina(KOP.slice(0, 7)), KOP, "https://voorbeeld/").goed).toBe(true);
  });

  it("keurt af wanneer de pagina een oudere commit draagt — het geval van 2026-10-02", () => {
    const oud = "0000000111111112222222333333344444445555";
    const o = beoordeelBouwmerk(pagina(oud), KOP, "https://voorbeeld/");
    expect(o.goed).toBe(false);
    expect(o.melding).toContain("niet vervangen");
    expect(o.gevonden).toBe(oud);
  });

  it("keurt af wanneer er geen merk staat; dat is geen onbekende maar een fout", () => {
    const o = beoordeelBouwmerk(pagina(null), KOP, "https://voorbeeld/");
    expect(o.goed).toBe(false);
    expect(o.gevonden).toBeNull();
  });

  it("keurt af bij een merk dat korter is dan zeven tekens, hoe goed het voorvoegsel ook lijkt", () => {
    expect(beoordeelBouwmerk(pagina("a1b2c3"), KOP, "https://voorbeeld/").goed).toBe(false);
  });
});

describe("controleerUitrol", () => {
  const ophaler = (status: number, tekst: string) => async () => ({ status, tekst });

  it("geeft 0 bij een pagina met het juiste merk", async () => {
    const r = await controleerUitrol("https://voorbeeld/", KOP, ophaler(200, pagina(KOP)));
    expect(r.code).toBe(0);
  });

  it("geeft 1 bij een pagina met een ander merk", async () => {
    const r = await controleerUitrol("https://voorbeeld/", KOP, ophaler(200, pagina("9999999888888877777776666666555555544444")));
    expect(r.code).toBe(1);
  });

  it("geeft 1 bij een andere status dan 200 — niet gemeten is niet geslaagd", async () => {
    const r = await controleerUitrol("https://voorbeeld/", KOP, ophaler(404, ""));
    expect(r.code).toBe(1);
    expect(r.melding).toContain("HTTP 404");
  });

  it("geeft 1 wanneer de pagina niet op te halen is, en niet 0", async () => {
    const stuk = async () => {
      throw new Error("proxy weigerde het adres");
    };
    const r = await controleerUitrol("https://voorbeeld/", KOP, stuk);
    expect(r.code).toBe(1);
    expect(r.melding).toContain("proxy weigerde het adres");
  });

  it("geeft 2 bij een merk dat geen commit-sha is", async () => {
    const r = await controleerUitrol("https://voorbeeld/", "geen-sha", ophaler(200, pagina(KOP)));
    expect(r.code).toBe(2);
  });
});
