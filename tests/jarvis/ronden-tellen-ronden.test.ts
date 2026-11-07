import { describe, expect, it } from "vitest";
import { ACCEPTATIE_MISLUKT_SQL, MAX_ACCEPTATIE_RONDES } from "@/jarvis/src/doel-acceptatie";

/**
 * De ronde-teller telt ronden, geen losse tests (RSK-0040).
 *
 * De eindcontrole schrijft per ronde één regel per test ("test A:
 * niet-geslaagd") en daarna één eindoordeel. De teller telde de eerste soort,
 * dus een doel met drie acceptatietests zat na zijn eerste zakkende ronde al
 * op drie van drie en werd meteen vastgezet - de herstelketen kwam nooit op
 * gang. Gemeten op 2026-11-07 aan D-20261021-161119608, vastgezet met de
 * tekst "ronde 40 van 3".
 */
const PER_TEST = "test A: niet-geslaagd — het bewijs toont het niet";
const EINDOORDEEL_GEZAKT = "eindoordeel: bezig — acceptatietest niet geslaagd (ronde 1 van 3)";
const EINDOORDEEL_ONMEETBAAR = "eindoordeel: vast — acceptatietest niet te meten — B: niet-meetbaar";

/** Dezelfde vergelijking als Postgres doet voor `like`, met % als enige jokerteken. */
function like(tekst: string, patroon: string): boolean {
  const stukken = patroon.split("%");
  let plek = 0;
  for (let i = 0; i < stukken.length; i += 1) {
    const deel = stukken[i]!;
    if (deel === "") continue;
    const gevonden = tekst.indexOf(deel, plek);
    if (gevonden === -1) return false;
    if (i === 0 && gevonden !== 0) return false;
    plek = gevonden + deel.length;
  }
  const laatste = stukken[stukken.length - 1]!;
  if (laatste !== "" && !tekst.endsWith(laatste)) return false;
  return true;
}

const PATROON = "eindoordeel:%acceptatietest niet geslaagd%";

describe("de ronde-teller telt ronden", () => {
  it("telt een eindoordeel dat zakt", () => {
    expect(like(EINDOORDEEL_GEZAKT, PATROON)).toBe(true);
  });

  it("telt de losse testregels van diezelfde ronde niet mee", () => {
    expect(like(PER_TEST, PATROON)).toBe(false);
    expect(like("test C: niet-geslaagd — de gecontroleerde test ontbreekt", PATROON)).toBe(false);
  });

  it("telt een ronde die niet te meten was niet als zakken", () => {
    // Niet kunnen meten is een ontbrekende bevoegdheid, geen mislukt herstel.
    expect(like(EINDOORDEEL_ONMEETBAAR, PATROON)).toBe(false);
  });

  it("telt de geslaagde ronde niet", () => {
    expect(like("eindoordeel: klaar — acceptatietests geslaagd", PATROON)).toBe(false);
  });

  it("vraagt dit patroon ook werkelijk op", () => {
    expect(ACCEPTATIE_MISLUKT_SQL).toContain(PATROON);
    expect(ACCEPTATIE_MISLUKT_SQL).not.toContain("%: niet-geslaagd%");
    expect(ACCEPTATIE_MISLUKT_SQL.trim().toLowerCase().startsWith("select ")).toBe(true);
  });

  it("laat drie ronden toe, niet drie tests", () => {
    expect(MAX_ACCEPTATIE_RONDES).toBe(3);
  });
});
