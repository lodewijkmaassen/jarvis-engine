import { describe, expect, it } from "vitest";
import { uitrolProef } from "@/jarvis/src/doelen";

/**
 * De uitrol wordt vastgesteld, niet afgewacht (RSK-0045).
 *
 * De eindcontrole wachtte een vast halfuur na een samenvoeging voordat zij de
 * acceptatietests uitvoerde. Voor een doel dat geen pagina meet maar de keten
 * zelf is er niets om op te wachten: de run weet welke commit zij uitvoert en
 * welke engine-pin zij heeft geïnstalleerd. Gemeten op 2026-11-07 aan
 * D-20261021-161119608: elke correctie kostte ruim dertig minuten wachten op
 * een uitrol die al klaar was.
 *
 * Wat niet vast te stellen is, blijft wachten. Dat is de helft die niet mag
 * verdwijnen: liever een halfuur wachten dan meten op werk dat er nog niet is.
 */
const EIGEN = "org/app";
const ENGINE = "org/engine";
const MERGE = "a".repeat(40);
const COMMIT = "b".repeat(40);
const PIN = "c".repeat(40);

describe("de samenvoeging staat in de repository van deze run", () => {
  it("vergelijkt haar met de commit die de run uitvoert", () => {
    const p = uitrolProef({ eigen: EIGEN, engine: ENGINE, repo: EIGEN, merge: MERGE, draaiend: COMMIT, pin: PIN });
    expect(p).toEqual({ soort: "vergelijk", repo: EIGEN, basis: MERGE, kandidaat: COMMIT, wat: "de commit die deze run uitvoert" });
  });

  it("let niet op hoofdletters in de naam van de repository", () => {
    const p = uitrolProef({ eigen: EIGEN, engine: ENGINE, repo: EIGEN.toUpperCase(), merge: MERGE, draaiend: COMMIT, pin: null });
    expect(p.soort).toBe("vergelijk");
  });

  it("wacht wanneer de run niet weet welke commit zij uitvoert", () => {
    const p = uitrolProef({ eigen: EIGEN, engine: ENGINE, repo: EIGEN, merge: MERGE, draaiend: "", pin: PIN });
    expect(p).toEqual({ soort: "onbepaald", reden: "deze run weet niet welke commit zij uitvoert" });
  });
});

describe("de samenvoeging staat in de engine-repository", () => {
  it("vergelijkt haar met de engine-pin van deze run", () => {
    const p = uitrolProef({ eigen: EIGEN, engine: ENGINE, repo: ENGINE, merge: MERGE, draaiend: COMMIT, pin: PIN });
    expect(p).toEqual({ soort: "vergelijk", repo: ENGINE, basis: MERGE, kandidaat: PIN, wat: "de engine-pin van deze run" });
  });

  it("wacht wanneer deze run geen pin leest", () => {
    const p = uitrolProef({ eigen: EIGEN, engine: ENGINE, repo: ENGINE, merge: MERGE, draaiend: COMMIT, pin: null });
    expect(p).toEqual({ soort: "onbepaald", reden: "deze run leest geen engine-pin" });
  });
});

describe("wat niet vast te stellen is, blijft wachten", () => {
  it("wacht bij een samenvoeging in een derde repository", () => {
    const p = uitrolProef({ eigen: EIGEN, engine: ENGINE, repo: "org/ander", merge: MERGE, draaiend: COMMIT, pin: PIN });
    expect(p.soort).toBe("onbepaald");
    expect(p.soort === "onbepaald" && p.reden).toContain("draait deze run niet");
  });

  it("wacht bij een doel zonder samenvoeging", () => {
    expect(uitrolProef({ eigen: EIGEN, engine: ENGINE, repo: EIGEN, merge: null, draaiend: COMMIT, pin: PIN }).soort).toBe("onbepaald");
    expect(uitrolProef({ eigen: EIGEN, engine: ENGINE, repo: "", merge: MERGE, draaiend: COMMIT, pin: PIN }).soort).toBe("onbepaald");
    expect(uitrolProef({ eigen: EIGEN, engine: ENGINE, repo: EIGEN, merge: "   ", draaiend: COMMIT, pin: PIN }).soort).toBe("onbepaald");
  });

  it("wacht in de engine-repository zelf, waar geen engine-pin bestaat", () => {
    // Geen engine_repository in de configuratie: dan is de pin geen bewijs van iets.
    const p = uitrolProef({ eigen: ENGINE, engine: "", repo: ENGINE, merge: MERGE, draaiend: "", pin: null });
    expect(p.soort).toBe("onbepaald");
  });

  it("wacht wanneer de run niet weet in welke repository zij draait en de samenvoeging niet van de engine is", () => {
    const p = uitrolProef({ eigen: "", engine: ENGINE, repo: EIGEN, merge: MERGE, draaiend: COMMIT, pin: PIN });
    expect(p.soort).toBe("onbepaald");
  });
});
