/**
 * Eigenaarinteracties: het soort bepaalt de knoppen, en het soort hangt aan
 * structuur in het dossier — niet aan het eerste woord van een titel.
 *
 * De aanleiding is gemeten. Een dossierpunt luidde "kies tussen (a) een
 * vercel.json met een ignoreCommand …, of (b) niets doen". Het begon niet met
 * "beslis" en de context noemde het niet blokkerend, dus werd het `actie`: één
 * knop "Gedaan". De twee alternatieven die de eigenaar in de tekst kreeg
 * voorgelegd, bereikten de knoppen nooit — en hij heeft de kaart uiteindelijk
 * met "Gedaan" moeten sluiten voor een keuze die hij al in het gesprek had
 * gegeven.
 *
 * De nummers verwijzen naar de acceptatiecriteria van T-20260917-eigenaarinteracties.
 */
import { describe, expect, it } from "vitest";
import { bepaalEigenaarSoort, leesAandacht, leesIngebedeKeuze, type ProjectInvoer } from "@/jarvis/src/overzicht";
import { keuzeInStapregel } from "@/jarvis/src/lint";

function dossier(punt: string): ProjectInvoer {
  return {
    id: "jarvis",
    naam: "jarvis",
    aangesloten: true,
    hoofdbranch: { naam: "main", commit: "abc1234", datum: "2026-09-25" },
    statusDocument: "# CURRENT_STATE\n\n## Waar staan we\n\nIets.\n",
    records: [],
    taken: [{ id: "T-1", opdracht: { status: "actief" }, resultaat: `## Wat de eigenaar nog moet doen\n\n${punt}\n` }],
    gitLog: [],
  } as unknown as ProjectInvoer;
}
const eerste = (punt: string) => leesAandacht(dossier(punt))[0];
const keuzes = (punt: string) => eerste(punt).opties.map((o) => o.keuze);

describe("criterium 1 — classificatie naar betekenis, niet naar het eerste woord", () => {
  for (const woord of ["kies", "bepaal", "welke"]) {
    it(`herkent een keuze die met "${woord}" begint`, () => {
      const item = eerste(`- Stap 1: ${woord} tussen (a) de ene weg, of (b) de andere weg.`);
      expect(item.interactie).toBe("keuze");
    });
  }

  it("maakt van een punt dat met \"beslis\" begint géén keuze zonder alternatieven", () => {
    // De oude code las "beslis" en gaf een beslissing; nu telt alleen of er
    // werkelijk alternatieven zijn.
    expect(eerste("- Stap 1: beslissen of X mag.").interactie).toBe("uitstel");
  });

  it("kent elk soort uit de verzameling een eigen bepaling toe", () => {
    expect(bepaalEigenaarSoort({ akkoordContext: true, alternatieven: 9, labels: ["extern"] })).toBe("akkoord");
    expect(bepaalEigenaarSoort({ akkoordContext: false, alternatieven: 2, labels: ["extern"] })).toBe("keuze");
    expect(bepaalEigenaarSoort({ akkoordContext: false, alternatieven: 1, labels: ["Extern"] })).toBe("externe-handeling");
    expect(bepaalEigenaarSoort({ akkoordContext: false, alternatieven: 0, labels: ["Bevestig"] })).toBe("bevestiging");
    expect(bepaalEigenaarSoort({ akkoordContext: false, alternatieven: 0, labels: [] })).toBe("uitstel");
  });
});

describe("criterium 2 — een keuze toont zijn alternatieven", () => {
  it("leest aparte optieregels als alternatieven, met hun gevolg", () => {
    const item = eerste(
      [
        "- **De preview-bouw.**",
        "  - Optie A: een ignoreCommand toevoegen — scheelt deploys",
        "  - Optie B: niets doen — de limiet blijft vollopen",
      ].join("\n"),
    );
    expect(item.interactie).toBe("keuze");
    expect(item.opties.map((o) => o.label)).toEqual(["Optie A", "Optie B", "Later"]);
    expect(item.opties[0].gevolg).toContain("scheelt deploys");
  });

  it("herkent een keuze die in één regel staat, als vangnet voor bestaande dossiers", () => {
    const opties = leesIngebedeKeuze("kies tussen (a) de ene weg, of (b) de andere weg.");
    expect(opties.map((o) => o.keuze)).toEqual(["optie-a", "optie-b"]);
    expect(opties[0].gevolg).toBe("de ene weg");
    expect(opties[1].gevolg).toBe("de andere weg");
  });

  it("ziet één gemerkt alternatief niet aan voor een keuze", () => {
    expect(leesIngebedeKeuze("doe (a) dit en verder niets.")).toEqual([]);
  });

  it("neemt de hele vraag als titel wanneer het dossier een Keuze-regel schrijft", () => {
    const item = eerste(
      [
        "- **Het beslispunt.**",
        "  - Keuze: welke weg kiezen we voor de preview-bouw van pull requests?",
        "  - Optie A: een ignoreCommand — scheelt deploys",
        "  - Optie B: niets doen — de limiet blijft vollopen",
      ].join("\n"),
    );
    expect(item.titel).toBe("welke weg kiezen we voor de preview-bouw van pull requests?");
    // De Keuze-regel is de vraag, geen alternatief.
    expect(item.opties.map((o) => o.label)).not.toContain("Keuze");
  });
});

describe("criterium 3 — \"Gedaan\" alleen bij een externe handeling of een bevestiging", () => {
  it("biedt Gedaan bij een externe handeling", () => {
    expect(keuzes("- **Sleutel zetten.**\n  - Extern: de sleutelkluis van de database")).toEqual(["gedaan", "later"]);
  });

  it("biedt Gedaan en Nog niet bij een bevestiging", () => {
    expect(keuzes("- **Iets geregeld?**\n  - Bevestig: of de instelling aanstaat")).toEqual(["gedaan", "nog-niet", "later"]);
  });

  it("biedt Gedaan niet bij een keuze", () => {
    expect(keuzes("- Stap 1: kies tussen (a) de ene weg, of (b) de andere weg.")).not.toContain("gedaan");
  });

  it("biedt geen enkele handeling bij uitstel", () => {
    expect(keuzes("- Stap 1: wachten tot de klant zich meldt.")).toEqual(["later"]);
  });
});

describe("criterium 4 — een akkoordknop komt alleen uit de governance", () => {
  it("geeft akkoordknoppen bij een akkoord-PR-context", () => {
    expect(keuzes("**akkoord_pr**\n\n- Stap 1: deze pull request raakt een harde uitzondering.")).toEqual([
      "akkoord",
      "niet-akkoord",
      "later",
    ]);
  });

  it("vertaalt een keuze nooit in een akkoord", () => {
    expect(keuzes("- Stap 1: kies tussen (a) de ene weg, of (b) de andere weg.")).not.toContain("akkoord");
  });

  it("laat een akkoordvraag op de taak niet óók als dossierpunt staan", () => {
    // Criterium 7: één beslissing levert hoogstens één actuele actie op. De
    // akkoordkaart neemt hem over; het dossierpunt wordt onderdrukt.
    expect(leesAandacht(dossier("- Stap 1: geef in de Jarvis-app akkoord op deze taak."))).toEqual([]);
  });
});

describe("de poort bewaakt het dossierformaat van een keuze", () => {
  it("keurt een keuze in een stapregel af, met de hersteltekst erbij", () => {
    expect(keuzeInStapregel("- Stap 1: kies tussen (a) een ignoreCommand, of (b) niets doen.")).toBe(true);
    expect(keuzeInStapregel("- **Stap 2:** (a) dit of (b) dat")).toBe(true);
  });

  it("laat een gewone stapregel met rust", () => {
    expect(keuzeInStapregel("- Stap 1: zet de sleutel in de kluis.")).toBe(false);
    // Eén gemerkt alternatief is geen keuze.
    expect(keuzeInStapregel("- Stap 1: doe (a) dit en verder niets.")).toBe(false);
  });

  it("raakt alleen stapregels, niet een correct geschreven keuze", () => {
    expect(keuzeInStapregel("- Keuze: welke weg kiezen we?")).toBe(false);
    expect(keuzeInStapregel("- Optie A: een ignoreCommand — scheelt deploys")).toBe(false);
  });
});
