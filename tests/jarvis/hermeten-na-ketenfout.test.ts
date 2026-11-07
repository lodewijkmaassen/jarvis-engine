import { describe, expect, it } from "vitest";
import { classificeerBlokkade, rendereerBlokkade, vanDeEigenaar } from "@/jarvis/src/blokkade";
import { hermeetbaar, ketenVersieUit, metKetenVersie, type Doel } from "@/jarvis/src/doelen";

/**
 * Opnieuw beoordelen nadat de keten zelf is hersteld — zonder kunstmatige
 * nieuwe samenvoeging (RSK-0033).
 *
 * De meting die hierachter zit: op 2026-11-07 lag de fout van een doel in de
 * keten (het acceptatiebewijs was onvolledig). Na het herstel was er geen weg
 * terug naar `samengevoegd`: één samenvoeging wordt één keer vastgelegd, en
 * die regel is er omdat sweep en eindcontrole elkaar anders tien keer per uur
 * overschreven. Er moest dus een nieuwe samenvoeging op het eigen dossier
 * worden gemaakt om hetzelfde werk opnieuw te laten meten. Dat is een
 * handeling van een mens die niets oplevert.
 */
const doel = (over: Partial<Doel> = {}): Pick<Doel, "status" | "pr" | "uitkomst"> => ({
  status: "bezig",
  pr: { repo: "eigenaar/repo", nummer: 7, kop: "a".repeat(40), merge_sha: "b".repeat(40) },
  uitkomst: metKetenVersie(rendereerBlokkade("het bewijs was niet te lezen"), "1111111"),
  ...over,
});

describe("de versie van de keten in de uitkomst", () => {
  it("gaat erin en komt er weer uit", () => {
    expect(ketenVersieUit(metKetenVersie("iets", "abc1234"))).toBe("abc1234");
    expect(metKetenVersie("iets", null)).toBe("iets");
    expect(metKetenVersie("iets", "   ")).toBe("iets");
    expect(ketenVersieUit("iets zonder markering")).toBeNull();
    expect(ketenVersieUit(null)).toBeNull();
  });

  it("staat achteraan, zodat hij een afgekapte uitkomst overleeft", () => {
    expect(metKetenVersie("x".repeat(1700), "abc1234").endsWith("[keten abc1234]")).toBe(true);
  });
});

describe("wanneer een doel opnieuw gemeten mag worden", () => {
  it("mag het als de keten sinds de blokkade is veranderd", () => {
    expect(hermeetbaar(doel(), "2222222")).toBe(true);
  });

  it("mag het NIET als de keten dezelfde is: dat was het ping-pong van sweep en eindcontrole", () => {
    expect(hermeetbaar(doel(), "1111111")).toBe(false);
  });

  it("mag het niet zonder markering, en niet zonder bekende versie", () => {
    expect(hermeetbaar(doel({ uitkomst: rendereerBlokkade("het bewijs was niet te lezen") }), "2222222")).toBe(false);
    expect(hermeetbaar(doel(), null)).toBe(false);
  });

  it("mag het alleen bij een blokkade van Jarvis zelf, niet bij een besluit of een grens", () => {
    for (const tekst of ["de eigenaar moet een keuze maken over de scope", "dit zou productiegegevens verwijderen"]) {
      const blok = classificeerBlokkade(tekst);
      expect(vanDeEigenaar(blok), tekst).toBe(true);
      expect(hermeetbaar(doel({ uitkomst: metKetenVersie(rendereerBlokkade(tekst, blok), "1111111") }), "2222222")).toBe(false);
    }
  });

  it("mag het alleen voor een doel dat loopt en een vastgelegde samenvoeging heeft", () => {
    expect(hermeetbaar(doel({ status: "samengevoegd" }), "2222222")).toBe(false);
    expect(hermeetbaar(doel({ status: "review" }), "2222222")).toBe(false);
    expect(hermeetbaar(doel({ status: "vast" }), "2222222")).toBe(false);
    expect(hermeetbaar(doel({ pr: { repo: "e/r", nummer: 7, kop: "a".repeat(40) } }), "2222222")).toBe(false);
    expect(hermeetbaar(doel({ pr: null }), "2222222")).toBe(false);
  });
});

describe("welke stilstand bij de eigenaar hoort", () => {
  it("een ontbrekende bevoegdheid en een fout zijn werk van Jarvis (CON-0015)", () => {
    expect(vanDeEigenaar(classificeerBlokkade("permission denied voor de migratierol"))).toBe(false);
    expect(vanDeEigenaar(classificeerBlokkade("de pagina gaf HTTP 500"))).toBe(false);
  });

  it("een besluit en een beveiligingsgrens zijn van hem", () => {
    expect(vanDeEigenaar(classificeerBlokkade("welke van de twee opties wil je?"))).toBe(true);
    expect(vanDeEigenaar(classificeerBlokkade("dit is onomkeerbaar"))).toBe(true);
  });
});
