/**
 * Wat: toetst de regels waaronder de bot een pull request opent en samenvoegt.
 *
 * Waarom: samenvoegen is techniek en dus van Jarvis, maar alleen ná de
 * inhoudelijke autorisatie van de eigenaar. Die grens moet in code staan en
 * per geval aantoonbaar falen: geen goedkeuring, goedkeuring op een oudere
 * commit, goedkeuring van de verkeerde persoon, checks niet groen, conflict.
 */
import { describe, expect, it } from "vitest";

import { beoordeelOpenen, beoordeelSamenvoegen, eigenaarVan, SAMENVOEGMETHODE, type PullRequestFeiten } from "@/jarvis/src/pr";

const KOP = "c".repeat(40);
const OUD = "d".repeat(40);

function pr(over: Partial<PullRequestFeiten> = {}): PullRequestFeiten {
  return {
    nummer: 7,
    auteur: "bot",
    kop: KOP,
    basis: "main",
    open: true,
    concept: false,
    samenvoegbaar: true,
    samenvoegStaat: "clean",
    reviews: [{ gebruiker: "eigenaar", staat: "APPROVED", commit: KOP }],
    checks: [{ naam: "poort", status: "completed", conclusie: "success" }],
    ...over,
  };
}

describe("beoordeelOpenen", () => {
  it("laat de bot een PR openen als er nog geen open PR van die branch is", () => {
    expect(beoordeelOpenen("bot", "eigenaar/repo", ["andere"], "jarvis/x")).toEqual([]);
  });
  it("weigert als het token van de eigenaar zelf is: die kan zijn eigen PR niet goedkeuren", () => {
    expect(beoordeelOpenen("Eigenaar", "eigenaar/repo", [], "jarvis/x").join(" ")).toContain("eigenaar van");
  });
  it("weigert een tweede open PR van dezelfde branch", () => {
    expect(beoordeelOpenen("bot", "eigenaar/repo", ["jarvis/x"], "jarvis/x").join(" ")).toContain("al een open");
  });
});

describe("beoordeelSamenvoegen", () => {
  it("voegt samen na goedkeuring van de eigenaar op de huidige kop, met groene checks", () => {
    expect(beoordeelSamenvoegen(pr(), "eigenaar")).toEqual([]);
  });

  it("weigert zonder goedkeuring van de eigenaar, ook als iemand anders goedkeurde", () => {
    const uit = beoordeelSamenvoegen(pr({ reviews: [{ gebruiker: "bot", staat: "APPROVED", commit: KOP }] }), "eigenaar");
    expect(uit.join(" ")).toContain("geen goedkeurende review van eigenaar");
  });

  it("weigert een goedkeuring op een eerdere commit dan de huidige kop", () => {
    const uit = beoordeelSamenvoegen(pr({ reviews: [{ gebruiker: "eigenaar", staat: "APPROVED", commit: OUD }] }), "eigenaar");
    expect(uit.join(" ")).toContain("eerdere commit");
  });

  it("weigert als de eigenaar op de huidige kop wijzigingen vroeg", () => {
    const uit = beoordeelSamenvoegen(
      pr({
        reviews: [
          { gebruiker: "eigenaar", staat: "APPROVED", commit: KOP },
          { gebruiker: "eigenaar", staat: "CHANGES_REQUESTED", commit: KOP },
        ],
      }),
      "eigenaar",
    );
    expect(uit.join(" ")).toContain("vroeg wijzigingen");
  });

  it("eist de poort-check bij naam: ontbrekend, overgeslagen, lopend of rood is geen goedkeuring", () => {
    // QA-bevinding H-2: elke check telde, ook een overgeslagen; de poort zelf
    // werd niet bij naam geëist.
    expect(beoordeelSamenvoegen(pr({ checks: [] }), "eigenaar").join(" ")).toContain('check "poort" ontbreekt');
    expect(beoordeelSamenvoegen(pr({ checks: [{ naam: "ci", status: "completed", conclusie: "success" }] }), "eigenaar").join(" ")).toContain('"poort" ontbreekt');
    expect(beoordeelSamenvoegen(pr({ checks: [{ naam: "poort", status: "completed", conclusie: "skipped" }] }), "eigenaar").join(" ")).toContain("poort is niet geslaagd");
    expect(beoordeelSamenvoegen(pr({ checks: [{ naam: "poort", status: "in_progress", conclusie: null }] }), "eigenaar").join(" ")).toContain("poort is nog niet klaar");
    expect(beoordeelSamenvoegen(pr({ checks: [{ naam: "poort", status: "completed", conclusie: "failure" }] }), "eigenaar").join(" ")).toContain("poort is niet geslaagd");
  });

  it("laat een andere check overgeslagen zijn, maar niet rood of lopend", () => {
    const basis = [{ naam: "poort", status: "completed", conclusie: "success" }];
    expect(beoordeelSamenvoegen(pr({ checks: [...basis, { naam: "ci", status: "completed", conclusie: "skipped" }] }), "eigenaar")).toEqual([]);
    expect(beoordeelSamenvoegen(pr({ checks: [...basis, { naam: "ci", status: "in_progress", conclusie: null }] }), "eigenaar").join(" ")).toContain("nog niet klaar");
    expect(beoordeelSamenvoegen(pr({ checks: [...basis, { naam: "ci", status: "completed", conclusie: "failure" }] }), "eigenaar").join(" ")).toContain("niet geslaagd");
  });

  it("weigert de staat unstable, ook als alle gemelde checks groen lijken", () => {
    expect(beoordeelSamenvoegen(pr({ samenvoegStaat: "unstable" }), "eigenaar").join(" ")).toContain("unstable");
  });

  it("weigert een conflict, een onbepaalde samenvoegbaarheid, een concept en een gesloten PR", () => {
    expect(beoordeelSamenvoegen(pr({ samenvoegbaar: false }), "eigenaar").join(" ")).toContain("conflict");
    expect(beoordeelSamenvoegen(pr({ samenvoegbaar: null }), "eigenaar").join(" ")).toContain("nog niet bepaald");
    expect(beoordeelSamenvoegen(pr({ concept: true }), "eigenaar").join(" ")).toContain("concept");
    expect(beoordeelSamenvoegen(pr({ open: false }), "eigenaar").join(" ")).toContain("niet open");
  });

  it("vergelijkt logins hoofdletterongevoelig", () => {
    expect(beoordeelSamenvoegen(pr({ reviews: [{ gebruiker: "Eigenaar", staat: "APPROVED", commit: KOP }] }), "eigenaar")).toEqual([]);
  });
});

describe("vaste keuzes", () => {
  it("voegt altijd samen met een mergecommit, zodat vastgepinde SHA's bereikbaar blijven", () => {
    expect(SAMENVOEGMETHODE).toBe("merge");
  });
  it("leest de eigenaar uit de slug", () => {
    expect(eigenaarVan("eigenaar/repo")).toBe("eigenaar");
  });
});
