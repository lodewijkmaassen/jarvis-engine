/**
 * Wat: toetst de regels waaronder de bot een pull request opent en samenvoegt.
 *
 * Waarom: samenvoegen is techniek en dus van Jarvis, maar alleen ná de
 * inhoudelijke autorisatie van de eigenaar. Die grens moet in code staan en
 * per geval aantoonbaar falen: geen goedkeuring, goedkeuring op een oudere
 * commit, goedkeuring van de verkeerde persoon, checks niet groen, conflict.
 */
import { describe, expect, it } from "vitest";

import { ATTESTATIE_WORKFLOW, beoordeelOpenen, beoordeelSamenvoegen, duidDispatchWeigering, duidRechten, eigenaarVan, SAMENVOEGMETHODE, type PullRequestFeiten } from "@/jarvis/src/pr";

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

describe("duidDispatchWeigering", () => {
  const PLATFORM = "Dispatching, enabling or disabling workflows and deleting workflow runs, logs or artifacts are not permitted for this session type.";

  it("herkent de weigering van het uitvoeringsplatform en noemt de terugval met workflow, ref en invoer", () => {
    const uit = duidDispatchWeigering(403, PLATFORM, "eigenaar/repo", 82);
    expect(uit.soort).toBe("sessietype");
    expect(uit.terugvalMogelijk).toBe(true);
    const tekst = uit.regels.join(" ");
    expect(tekst).toContain(ATTESTATIE_WORKFLOW);
    expect(tekst).toContain("pr: 82");
    expect(tekst).toContain("eigenaar/repo");
    // De weigering mag niet als een uitspraak over bevoegdheid gelezen worden.
    expect(tekst).toContain("niet het bottoken");
  });

  it("scheidt een ontbrekend recht van de weigering van het platform", () => {
    const uit = duidDispatchWeigering(403, "Resource not accessible by integration", "eigenaar/repo", 7);
    expect(uit.soort).toBe("recht");
    expect(uit.terugvalMogelijk).toBe(true);
    expect(uit.regels.join(" ")).toContain("actions: write");
  });

  it("biedt geen terugval bij een weigering die geen van beide is", () => {
    const uit = duidDispatchWeigering(404, "Not Found", "eigenaar/repo", 7);
    expect(uit.soort).toBe("anders");
    expect(uit.terugvalMogelijk).toBe(false);
    expect(uit.regels.join(" ")).toContain("op main van eigenaar/repo");
  });

  it("houdt de weigering zelf als eerste regel, zodat de meting niet verdwijnt", () => {
    expect(duidDispatchWeigering(403, PLATFORM, "eigenaar/repo", 82).regels[0]).toContain("403: Dispatching");
  });
});

describe("duidRechten", () => {
  const soorten = (uit: readonly { soort: string }[]) => uit.map((o) => o.soort);

  it("meldt de drie rechten altijd apart, in vaste volgorde", () => {
    expect(soorten(duidRechten(true, { push: true }, false))).toEqual(["lezen", "schrijven op inhoud", "workflow starten"]);
    expect(soorten(duidRechten(false, undefined, true))).toEqual(["lezen", "schrijven op inhoud", "workflow starten"]);
  });

  it("noemt het recht een workflow te starten nooit aanwezig of afwezig — een dispatch is zelf de handeling", () => {
    for (const uit of [duidRechten(true, { push: true }, false), duidRechten(true, { push: false }, false), duidRechten(true, undefined, true)]) {
      const workflow = uit.find((o) => o.soort === "workflow starten");
      expect(workflow?.heeft).toBeNull();
    }
  });

  it("leidt schrijfrecht af uit permissions buiten de cloud", () => {
    const ja = duidRechten(true, { push: true }, false).find((o) => o.soort === "schrijven op inhoud");
    expect(ja?.heeft).toBe(true);
    const nee = duidRechten(true, { push: false }, false).find((o) => o.soort === "schrijven op inhoud");
    expect(nee?.heeft).toBe(false);
    expect(nee?.regel).toContain("nodig hem uit");
  });

  it("noemt te veel recht bij naam", () => {
    expect(duidRechten(true, { push: true, admin: true }, false).find((o) => o.soort === "schrijven op inhoud")?.regel).toContain("te veel");
  });

  it("houdt schrijfrecht onbekend in de cloud, ook als permissions push:false meldt (RSK-0025)", () => {
    const uit = duidRechten(true, { push: false }, true).find((o) => o.soort === "schrijven op inhoud");
    expect(uit?.heeft).toBeNull();
    expect(uit?.regel).toContain("probeer gewoon");
  });

  it("houdt schrijfrecht onbekend wanneer het token zijn rechten niet meldt", () => {
    const uit = duidRechten(true, undefined, false).find((o) => o.soort === "schrijven op inhoud");
    expect(uit?.heeft).toBeNull();
    expect(uit?.regel).toContain("app-installatie");
  });

  it("stelt niets vast over schrijven of workflows zolang lezen niet lukt", () => {
    const uit = duidRechten(false, undefined, false);
    expect(uit.find((o) => o.soort === "lezen")?.heeft).toBe(false);
    expect(uit.find((o) => o.soort === "schrijven op inhoud")?.heeft).toBeNull();
    expect(uit.find((o) => o.soort === "workflow starten")?.heeft).toBeNull();
  });

  it("verwijst in de cloud naar RSK-0025 in plaats van naar het workflowbestand", () => {
    expect(duidRechten(true, undefined, true).find((o) => o.soort === "workflow starten")?.regel).toContain("RSK-0025");
  });
});
