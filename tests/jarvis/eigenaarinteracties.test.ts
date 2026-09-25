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
import { keuzeNietUitgesplitst, keuzeZonderAlternatieven } from "@/jarvis/src/lint";

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
    expect(eerste("- Stap 1: beslissen of X mag.").interactie).toBe("bevestiging");
  });

  it("kent elk soort uit de verzameling een eigen bepaling toe", () => {
    expect(bepaalEigenaarSoort({ akkoordContext: true, alternatieven: 9, labels: ["extern"] })).toBe("akkoord");
    expect(bepaalEigenaarSoort({ akkoordContext: false, alternatieven: 2, labels: ["extern"] })).toBe("keuze");
    expect(bepaalEigenaarSoort({ akkoordContext: false, alternatieven: 1, labels: ["Extern"] })).toBe("externe-handeling");
    expect(bepaalEigenaarSoort({ akkoordContext: false, alternatieven: 0, labels: ["Bevestig"] })).toBe("bevestiging");
    expect(bepaalEigenaarSoort({ akkoordContext: false, alternatieven: 0, labels: ["Wacht"] })).toBe("uitstel");
    // Zonder markering is de terugval `bevestiging`, niet `uitstel`: anders
    // verliest elk bestaand eigenaarspunt zijn enige knop.
    expect(bepaalEigenaarSoort({ akkoordContext: false, alternatieven: 0, labels: [] })).toBe("bevestiging");
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
    expect(keuzes("- **Wachten.**\n  - Wacht: tot de klant zich meldt")).toEqual(["later"]);
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
    // Dit gedrag bestond al vóór deze wijziging (engine-#49) en is hier een
    // vangrail, geen levering: criterium 7 vraagt méér dan dit ene geval en
    // wordt door stap 4 van het uitvoeringsplan gedekt, niet door deze
    // wijziging. De test staat hier om te bewaken dat de nieuwe classificatie
    // hem niet stukmaakt — en hij is daarom terecht groen op de oude code.
    expect(leesAandacht(dossier("- Stap 1: geef in de Jarvis-app akkoord op deze taak."))).toEqual([]);
  });
});

describe("de poort bewaakt het dossierformaat van een keuze", () => {
  it("herkent een keuze die niet in optieregels is uitgesplitst", () => {
    expect(keuzeNietUitgesplitst("kies tussen (a) een ignoreCommand, of (b) niets doen.")).toBe(true);
    expect(keuzeNietUitgesplitst("welke weg: (A) dit of (B) dat")).toBe(true);
  });

  it("laat een handeling met twee delen met rust", () => {
    // "en", geen "of": beide dingen moeten gebeuren, dat is geen keuze.
    expect(keuzeNietUitgesplitst("doe (a) het ene en (b) het andere.")).toBe(false);
    expect(keuzeNietUitgesplitst("controleer artikel 5 lid (a) en lid (b) van het contract.")).toBe(false);
    expect(keuzeNietUitgesplitst("zet de sleutel in de kluis.")).toBe(false);
  });

  it("keurt een half geschreven keuze af, op bruikbare alternatieven", () => {
    const r = (...paren: readonly (readonly [string, string])[]) => paren.map(([label, tekst]) => ({ label, tekst }));
    expect(keuzeZonderAlternatieven(r(["Keuze", "welke weg?"], ["Optie A", "dit"]))).toBe(true);
    // Een optieregel zonder gevolg is geen alternatief.
    expect(keuzeZonderAlternatieven(r(["Keuze", "welke weg?"], ["Optie A", "dit"], ["Optie B", ""]))).toBe(true);
    // Twee keer hetzelfde label levert geen tweede antwoord op.
    expect(keuzeZonderAlternatieven(r(["Keuze", "welke weg?"], ["Optie A", "dit"], ["Optie A", "nog eens"]))).toBe(true);
    expect(keuzeZonderAlternatieven(r(["Keuze", "welke weg?"], ["Optie A", "dit"], ["Optie B", "dat"]))).toBe(false);
    expect(keuzeZonderAlternatieven(r(["Stap 1", "doe iets"], ["Controle", "het staat er"]))).toBe(false);
  });
});

describe("de invariant: de knoppen volgen uit het soort", () => {
  // Niet per geval maar over álle items tegelijk. Een eerdere versie toetste
  // per geval en miste daardoor dat een enkele extra labelregel de knoppen van
  // het soort kon verdringen — een externe handeling verloor zijn "Gedaan",
  // en een punt met een regel "- Gedaan: …" kreeg er juist één.
  const MET_GEDAAN = new Set(["externe-handeling", "bevestiging"]);
  // `uitstel` vraagt sinds ronde 3 een expliciete `- Wacht:`-regel.
  const gevallen: readonly string[] = [
    "- Stap 1: kies tussen (a) de ene weg, of (b) de andere weg.",
    "- **Sleutel zetten.**\n  - Extern: de sleutelkluis van de database",
    "- **Sleutel zetten.**\n  - Extern: de sleutelkluis\n  - Let op: vandaag nog",
    "- **Iets geregeld?**\n  - Bevestig: of de instelling aanstaat\n  - Let op: vandaag nog",
    "- **Repository aanmaken.**\n  - Stap 1: klik\n  - Controle: het staat er\n  - Gedaan: Jarvis pusht",
    "- **Losse regels.**\n  - Termijn: morgen\n  - Eigenaar: jij",
    "**akkoord_pr**\n\n- Stap 1: deze pull request raakt een harde uitzondering.",
    "**akkoord_pr**\n\n- **Toch opties.**\n  - Optie A: dit — gevolg\n  - Optie B: dat — gevolg",
    "- **Wachten.**\n  - Wacht: tot de klant zich meldt",
  ];

  for (const punt of gevallen) {
    it(`houdt de invariant voor ${JSON.stringify(punt.split("\n")[0].slice(0, 46))}`, () => {
      const item = eerste(punt);
      const kn = item.opties.map((o) => o.keuze);
      expect(kn[kn.length - 1], "Later hoort er altijd bij").toBe("later");
      if (item.interactie === "keuze") {
        // Een keuze toont alternatieven en nooit een handeling.
        expect(kn.length).toBeGreaterThanOrEqual(3);
        expect(kn).not.toContain("gedaan");
      } else {
        // Elk ander soort toont precies de knoppen van zijn soort.
        expect(kn.slice(0, -1).every((k) => k !== "later")).toBe(true);
        expect(kn.includes("gedaan")).toBe(MET_GEDAAN.has(String(item.interactie)));
      }
    });
  }

  it("geeft een akkoord altijd akkoordknoppen, ook met optieregels erbij", () => {
    const item = eerste("**akkoord_pr**\n\n- **Toch opties.**\n  - Optie A: dit — gevolg\n  - Optie B: dat — gevolg");
    expect(item.interactie).toBe("akkoord");
    expect(item.opties.map((o) => o.keuze)).toEqual(["akkoord", "niet-akkoord", "later"]);
  });

  it("laat een externe handeling zijn Gedaan houden naast een andere labelregel", () => {
    expect(keuzes("- **Sleutel zetten.**\n  - Extern: de kluis\n  - Let op: vandaag nog")).toEqual(["gedaan", "later"]);
  });

  it("geeft geen Gedaan aan een punt dat er alleen een labelregel voor heeft", () => {
    const item = eerste("- **Repository aanmaken.**\n  - Stap 1: klik\n  - Gedaan: Jarvis pusht");
    // De regel `- Gedaan:` bepaalt niets; het soort is de terugval, en die
    // geeft "Gedaan" én "Nog niet" — niet de tekst van die regel.
    expect(item.interactie).toBe("bevestiging");
    expect(item.opties.map((o) => o.keuze)).toEqual(["gedaan", "nog-niet", "later"]);
  });

  it("maakt van twee willekeurige labelregels geen keuze", () => {
    const item = eerste("- **Losse regels.**\n  - Termijn: morgen\n  - Eigenaar: jij");
    expect(item.interactie).toBe("bevestiging");
    expect(item.opties.map((o) => o.keuze)).toEqual(["gedaan", "nog-niet", "later"]);
  });
});

describe("de invariant geldt op élk aanroeppunt, niet op één", () => {
  // QA-ronde 2: de eerste reparatie bouwde om `bouwOpties` heen in plaats van
  // de oorzaak weg te nemen. Een losse labelregel verdrong daardoor nog steeds
  // de knoppen van het soort — op de keuze-tak en op de drie andere
  // aanroeppunten (blokkade, CFL, RSK).
  function metStatus(sectie: string): ProjectInvoer {
    return {
      id: "jarvis",
      naam: "jarvis",
      aangesloten: true,
      hoofdbranch: { naam: "main", commit: "abc1234", datum: "2026-09-25" },
      statusDocument: `# CURRENT_STATE\n\n## Waar staan we\n\nIets.\n\n## Wat is geblokkeerd, en waarop\n\n${sectie}\n`,
      records: [],
      taken: [],
      gitLog: [],
    } as unknown as ProjectInvoer;
  }

  it("laat een blokkade zijn eigen knop houden naast een losse labelregel", () => {
    const [item] = leesAandacht(metStatus("- **De sleutel ontbreekt.**\n  - Let op: vandaag nog"));
    expect(item.soort).toBe("blokkade");
    expect(item.opties.map((o) => o.keuze)).toEqual(["opgelost", "later"]);
  });

  it("laat een losse labelregel geen alternatief worden bij een keuze", () => {
    const item = eerste(
      ["- **Het beslispunt.**", "  - Optie A: dit — gevolg", "  - Optie B: dat — gevolg", "  - Let op: vandaag nog"].join("\n"),
    );
    expect(item.interactie).toBe("keuze");
    expect(item.opties.map((o) => o.keuze)).toEqual(["optie-a", "optie-b", "later"]);
  });

  it("maakt van twee losse labelregels naast opties geen extra knoppen", () => {
    const item = eerste(
      ["- **Het beslispunt.**", "  - Optie A: dit — g", "  - Optie B: dat — g", "  - Termijn: morgen", "  - Eigenaar: jij"].join("\n"),
    );
    expect(item.opties.map((o) => o.keuze)).toEqual(["optie-a", "optie-b", "later"]);
  });

  it("is geen keuze zonder twee bruikbare alternatieven", () => {
    // Een lege `- Optie B:` gaf stil een keuze met één knop, of met alleen
    // "Later" — een vraag zonder manier om te antwoorden.
    const half = eerste("- **Het beslispunt.**\n  - Optie A: dit — gevolg\n  - Optie B:");
    expect(half.interactie).not.toBe("keuze");
    expect(half.opties.map((o) => o.keuze)).not.toContain("optie-a");
    const leeg = eerste("- **Het beslispunt.**\n  - Optie A:\n  - Optie B:");
    expect(leeg.interactie).not.toBe("keuze");
  });

  it("geeft twee optieregels met dezelfde sleutel geen dubbele knop", () => {
    const item = eerste("- **Het beslispunt.**\n  - Optie A: dit — g\n  - Optie A: nog eens — g");
    expect(item.interactie).not.toBe("keuze");
    expect(item.opties.map((o) => o.keuze)).not.toContain("optie-a");
  });
});

describe("bestaande dossierpunten houden hun knop (QA-ronde 3, NB-4)", () => {
  // Het uitvoeringsplan zet `uitstel` als terugval. Zolang niet elk dossierpunt
  // expliciet zegt wat het is, betekent dat: elk bestaand punt verliest zijn
  // enige knop en is niet meer af te sluiten. Twee QA-rondes hebben dat als
  // verlies van werkend gedrag gemeten. De terugval is daarom `bevestiging`.
  it("laat een gewone LRN-0014-vorm afsluitbaar", () => {
    const item = eerste("- **Repository aanmaken.**\n  - Stap 1: open de pagina\n  - Controle: hij staat er");
    expect(item.opties.map((o) => o.keuze)).toEqual(["gedaan", "nog-niet", "later"]);
  });

  it("laat een punt met alleen een titel afsluitbaar", () => {
    expect(keuzes("- **Iets doen.** Toelichting erbij.")).toEqual(["gedaan", "nog-niet", "later"]);
  });

  it("geeft uitstel alleen bij een expliciete wachtregel", () => {
    expect(eerste("- **Wachten.**\n  - Wacht: tot de klant zich meldt").interactie).toBe("uitstel");
    expect(keuzes("- **Wachten.**\n  - Wacht: tot de klant zich meldt")).toEqual(["later"]);
  });
});

describe("een record houdt zijn eigen knoppen (QA-ronde 3, NB-2 en B2)", () => {
  function metRecord(type: "CFL" | "RSK", opties: string): ProjectInvoer {
    return {
      id: "jarvis",
      naam: "jarvis",
      aangesloten: true,
      hoofdbranch: { naam: "main", commit: "abc1234", datum: "2026-09-25" },
      statusDocument: "# CURRENT_STATE\n\n## Waar staan we\n\nIets.\n",
      records: [
        {
          id: `${type}-0001`,
          type,
          titel: "Een record",
          status: "open",
          datum: "2026-09-25",
          samenvatting: "Iets.",
          velden: { opties },
          pad: `knowledge/${type}-0001.md`,
        },
      ],
      taken: [],
      gitLog: [],
    } as unknown as ProjectInvoer;
  }

  it("laat een losse labelregel de vaste knoppen van een conflict niet verdringen", () => {
    const items = leesAandacht(metRecord("CFL", "- Let op: vandaag nog"));
    const kn = items[0]?.opties.map((o) => o.keuze) ?? [];
    expect(kn).not.toContain("let-op");
    expect(kn).toContain("later");
  });

  it("laat een regel `Later:` de vaste Later-knop niet overnemen", () => {
    const items = leesAandacht(metRecord("RSK", "- Later: het gaat vanzelf weg"));
    const later = items[0]?.opties.find((o) => o.keuze === "later");
    expect(later?.gevolg).not.toContain("vanzelf weg");
  });

  it("laat een regel `Gedaan:` geen handelingsknop op een risico zetten", () => {
    const items = leesAandacht(metRecord("RSK", "- Gedaan: al af"));
    expect(items[0]?.opties.map((o) => o.keuze)).not.toContain("gedaan");
  });
});

describe("een halve keuze krijgt nooit een handelingsknop (QA-ronde 4, B4)", () => {
  // Een punt dat in het dossier letterlijk `- Keuze:` schrijft maar te weinig
  // bruikbare alternatieven heeft, kreeg "Gedaan"/"Nog niet" op een open
  // vraag. Dat is woordelijk de klacht waarmee deze taak begon.
  const halve: readonly string[] = [
    "- **Beslispunt.**\n  - Keuze: welke weg nemen we?",
    "- **Beslispunt.**\n  - Keuze: welke weg?\n  - Optie A: dit — gevolg",
    "- **Beslispunt.**\n  - Keuze: welke weg?\n  - Optie A: dit — gevolg\n  - Optie B:",
    "- **Beslispunt.**\n  - Keuze: welke weg?\n  - Optie A: dit — g\n  - Optie A: nog eens — g",
  ];
  for (const punt of halve) {
    it(`biedt geen handeling bij ${JSON.stringify(punt.split("\n")[1]?.trim().slice(0, 34))}`, () => {
      const item = eerste(punt);
      expect(item.interactie).toBe("uitstel");
      expect(item.opties.map((o) => o.keuze)).toEqual(["later"]);
    });
  }

  it("laat een volledige keuze wél zijn alternatieven tonen", () => {
    const item = eerste("- **Beslispunt.**\n  - Keuze: welke weg?\n  - Optie A: dit — g\n  - Optie B: dat — g");
    expect(item.interactie).toBe("keuze");
    expect(item.opties.map((o) => o.keuze)).toEqual(["optie-a", "optie-b", "later"]);
  });
});
