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
import { bepaalEigenaarSoort, leesAandacht, leesAlternatieven, leesIngebedeKeuze, lijktOpKeuze, type ProjectInvoer } from "@/jarvis/src/overzicht";
import { keuzeNietUitgesplitst, keuzeZonderAlternatieven, wachtNaastKeuze } from "@/jarvis/src/lint";

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
    expect(keuzeNietUitgesplitst({ tekst: "kies tussen (a) een ignoreCommand, of (b) niets doen." })).toBe(true);
    expect(keuzeNietUitgesplitst({ tekst: "welke weg: (A) dit of (B) dat" })).toBe(true);
  });

  it("laat een handeling met twee delen met rust", () => {
    // "en", geen "of": beide dingen moeten gebeuren, dat is geen keuze.
    expect(keuzeNietUitgesplitst({ tekst: "doe (a) het ene en (b) het andere." })).toBe(false);
    expect(keuzeNietUitgesplitst({ tekst: "controleer artikel 5 lid (a) en lid (b) van het contract." })).toBe(false);
    expect(keuzeNietUitgesplitst({ tekst: "zet de sleutel in de kluis." })).toBe(false);
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
          // `leesAandacht` leest `r.opties`, niet `velden.opties`. Met het
          // veld op de verkeerde plek bereikten deze optieregels `bouwOpties`
          // nooit en slaagden de drie asserties hieronder ongeacht de code —
          // ook op de merge-base (QA-ronde 6, N2).
          opties,
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

  it("laat de betekenisdragende labels van de eigenaarslijst een record ongemoeid (QA-ronde 6, N1)", () => {
    // `Keuze`, `Extern`, `Bevestig` en `Wacht` dragen betekenis op de
    // eigenaarslijst, niet in de `## Opties`-sectie van een kennisrecord: daar
    // zijn het gewone woorden. Door het filter ook dáár toe te passen
    // verdwenen beide alternatieven van een conflict en viel de kaart terug op
    // "Beslissing vastleggen".
    const items = leesAandacht(metRecord("CFL", "- Doorgaan: nu bouwen\n- Wacht: nog een maand afwachten"));
    const kn = items[0]?.opties.map((o) => o.keuze) ?? [];
    expect(kn).toEqual(["doorgaan", "wacht", "later"]);
    expect(kn).not.toContain("beslist");
  });

  for (const label of ["Keuze", "Extern", "Bevestig"]) {
    it(`laat "${label}" als gewoon optielabel van een record staan (QA-ronde 6, N1)`, () => {
      const items = leesAandacht(metRecord("CFL", `- ${label}: de ene weg\n- Anders: de andere weg`));
      expect(items[0]?.opties.map((o) => o.keuze)).toEqual([label.toLowerCase(), "anders", "later"]);
    });
  }
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

describe("QA-ronde 5 — de alternatieven bereiken de eigenaar, of de poort keurt af", () => {
  const r = (...paren: readonly (readonly [string, string])[]) => paren.map(([label, tekst]) => ({ label, tekst }));

  describe("B1: lint en engine ontdubbelen op dezelfde sleutel", () => {
    // `Optie A` en `Optie-A` verschillen als tekst maar niet als sleutel. De
    // engine telde op `sleutelVan` en hield één alternatief over; de lint telde
    // op de ruwe labeltekst en zag er twee. Uitkomst: poort groen, kaart met
    // alleen "Later", en de eigenaar kan de vraag niet beantwoorden.
    for (const [eerst, tweede] of [
      ["Optie A", "Optie-A"],
      ["Optie A", "Optie A."],
      ["Optie A", "Optie  A"],
      ["Optie 1", "Optie (1)"],
    ] as const) {
      it(`keurt "${eerst}" naast "${tweede}" af in plaats van er stil één van te maken`, () => {
        const regels = r(["Keuze", "welke weg kiezen we?"], [eerst, "de ene weg"], [tweede, "de andere weg"]);
        expect(keuzeZonderAlternatieven(regels)).toBe(true);
        const item = eerste(
          `- **Het beslispunt.**\n  - Keuze: welke weg kiezen we?\n  - ${eerst}: de ene weg\n  - ${tweede}: de andere weg`,
        );
        expect(item.interactie).toBe("uitstel");
      });
    }
  });

  describe("B2: een `Keuze`-regel die haar eigen alternatieven draagt, verliest ze niet", () => {
    it("leest de keuze uit de `Keuze`-regel zelf", () => {
      const item = eerste("- Het beslispunt.\n  - Keuze: kies (a) een ignoreCommand toevoegen, of (b) niets doen.");
      expect(item.interactie).toBe("keuze");
      expect(item.opties.map((o) => o.keuze)).toEqual(["optie-a", "optie-b", "later"]);
    });

    it("meldt die vorm als niet-uitgesplitst, want de norm is een eigen optieregel", () => {
      const regels = r(["Keuze", "kies (a) een ignoreCommand toevoegen, of (b) niets doen."]);
      expect(keuzeNietUitgesplitst({ tekst: "Het beslispunt.", regels })).toBe(true);
      // En niet twee keer: een halve keuze is het niet, de alternatieven staan er.
      expect(keuzeZonderAlternatieven(regels)).toBe(false);
    });
  });

  describe("B3: een keuze onder een akkoordcontext houdt haar alternatieven", () => {
    it("geeft de vraag haar eigen knoppen in plaats van Akkoord/Niet akkoord", () => {
      const item = eerste(
        "**akkoord_pr**\n\n- Het beslispunt.\n  - Keuze: welke weg?\n  - Optie A: de ene weg\n  - Optie B: de andere weg",
      );
      expect(item.interactie).toBe("keuze");
      expect(item.opties.map((o) => o.keuze)).toEqual(["optie-a", "optie-b", "later"]);
    });

    it("houdt een akkoord zonder `Keuze`-regel wél een akkoord, ook met optieregels erbij", () => {
      expect(bepaalEigenaarSoort({ akkoordContext: true, alternatieven: 2, labels: ["Optie A", "Optie B"] })).toBe("akkoord");
    });

    it("zet geen akkoordknop onder een vraag die het punt zelf stelt", () => {
      expect(bepaalEigenaarSoort({ akkoordContext: true, alternatieven: 2, labels: ["Keuze", "Optie A", "Optie B"] })).toBe("keuze");
      expect(bepaalEigenaarSoort({ akkoordContext: true, alternatieven: 0, labels: ["Keuze"] })).toBe("uitstel");
    });
  });

  describe("N1: `Keuze A` / `Keuze B` zijn alternatieven, `Keuze` is de vraag", () => {
    it("leest twee `Keuze X`-regels als alternatieven", () => {
      const item = eerste("- Het beslispunt.\n  - Keuze A: de ene weg\n  - Keuze B: de andere weg");
      expect(item.interactie).toBe("keuze");
      expect(item.opties.map((o) => o.keuze)).toEqual(["keuze-a", "keuze-b", "later"]);
    });
  });

  describe("N2: alleen opmaak is geen gevolg", () => {
    for (const leeg of ["**", "-", "…"]) {
      it(`telt "${leeg}" niet als alternatief`, () => {
        const regels = r(["Keuze", "welke weg?"], ["Optie A", "de ene weg"], ["Optie B", leeg]);
        expect(keuzeZonderAlternatieven(regels)).toBe(true);
      });
    }
  });

  describe("N3: de lint leest de stapregels waar de norm ze verwacht", () => {
    it("vuurt op de LRN-0014-vorm, waar de keuze in een `Stap 1`-regel staat", () => {
      const regels = r(["Stap 1", "kies tussen (a) de ene weg, of (b) de andere weg."]);
      expect(keuzeNietUitgesplitst({ tekst: "Het beslispunt.", regels })).toBe(true);
    });

    it("zwijgt zodra dezelfde keuze wél is uitgesplitst", () => {
      const regels = r(
        ["Stap 1", "kies tussen (a) de ene weg, of (b) de andere weg."],
        ["Keuze", "welke weg?"],
        ["Optie A", "de ene weg"],
        ["Optie B", "de andere weg"],
      );
      expect(keuzeNietUitgesplitst({ tekst: "Het beslispunt.", regels })).toBe(false);
    });
  });

  describe("N4/N7: een punt dat alleen zegt te wachten krijgt geen handelingsknop", () => {
    it("geeft een punt met alleen een `Wacht`-regel enkel Later", () => {
      expect(bepaalEigenaarSoort({ akkoordContext: false, alternatieven: 0, labels: ["Wacht"] })).toBe("uitstel");
    });

    it("laat `Wacht` een externe handeling niet overrulen", () => {
      // Anders kan de eigenaar een handeling die hij wél heeft gedaan niet
      // melden zolang het dossier ergens een wachtregel draagt (QA-ronde 6, N7).
      expect(bepaalEigenaarSoort({ akkoordContext: false, alternatieven: 0, labels: ["Wacht", "Extern"] })).toBe("externe-handeling");
      expect(bepaalEigenaarSoort({ akkoordContext: false, alternatieven: 0, labels: ["Wacht", "Bevestig"] })).toBe("bevestiging");
    });
  });
});

describe("QA-ronde 6 — geen kaart meer die de eigenaar niet kan afhandelen", () => {
  const r = (...paren: readonly (readonly [string, string])[]) => paren.map(([label, tekst]) => ({ label, tekst }));

  describe("B1: een `Wacht`-regel wist de knoppen van een uitgeschreven keuze niet", () => {
    const punt =
      "- **De preview-bouw.**\n" +
      "  - Keuze: welke weg kiezen we voor de preview-bouw?\n" +
      "  - Optie A: een ignoreCommand toevoegen — scheelt deploys\n" +
      "  - Optie B: niets doen — de limiet blijft vollopen\n" +
      "  - Wacht: op het antwoord van de leverancier";

    it("houdt de keuze een keuze, met beide alternatieven als knop", () => {
      const item = eerste(punt);
      expect(item.interactie).toBe("keuze");
      expect(item.opties.map((o) => o.keuze)).toEqual(["optie-a", "optie-b", "later"]);
    });

    it("meldt de tegenspraak in het dossier in plaats van haar stil op te lossen", () => {
      const regels = r(
        ["Keuze", "welke weg kiezen we?"],
        ["Optie A", "de ene weg"],
        ["Optie B", "de andere weg"],
        ["Wacht", "op de leverancier"],
      );
      expect(wachtNaastKeuze(regels)).toBe(true);
    });

    it("zwijgt over een wachtregel zonder keuze", () => {
      const regels = r(["Wacht", "op de leverancier"]);
      expect(wachtNaastKeuze(regels)).toBe(false);
      expect(wachtNaastKeuze(r(["Optie A", "de ene weg"], ["Optie B", "de andere weg"]))).toBe(false);
    });
  });

  describe("B2: optieregels zonder `Keuze`-regel krijgen nooit stil een Gedaan", () => {
    for (const [wat, extra] of [
      ["tweemaal hetzelfde label", "  - Optie A: de andere weg — dit gebeurt er dan"],
      ["een optie zonder gevolg", "  - Optie B:"],
      ["een label dat na normalisatie samenvalt", "  - Optie-A: de andere weg — dit gebeurt er dan"],
    ] as const) {
      it(`geeft alleen Later bij ${wat}`, () => {
        const item = eerste(`- **Het beslispunt.**\n  - Optie A: de ene weg — dit gebeurt er dan\n${extra}`);
        expect(item.interactie).toBe("uitstel");
        expect(item.opties.map((o) => o.keuze)).toEqual(["later"]);
      });
    }

    it("keurt die vorm af, ook zonder `Keuze`-regel", () => {
      expect(keuzeZonderAlternatieven(r(["Optie A", "de ene weg"], ["Optie A", "de andere weg"]))).toBe(true);
      expect(keuzeZonderAlternatieven(r(["Optie A", "de ene weg"], ["Optie B", ""]))).toBe(true);
      expect(keuzeZonderAlternatieven(r(["Optie A", "de ene weg"]))).toBe(true);
    });

    it("laat twee bruikbare optieregels zonder `Keuze`-regel gewoon een keuze zijn", () => {
      const item = eerste("- **Het beslispunt.**\n  - Optie A: de ene weg\n  - Optie B: de andere weg");
      expect(item.interactie).toBe("keuze");
      expect(keuzeZonderAlternatieven(r(["Optie A", "de ene weg"], ["Optie B", "de andere weg"]))).toBe(false);
    });

    it("laat een punt zonder enige optieregel met rust", () => {
      expect(eerste("- Stap 1: zet de sleutel in de kluis.\n  - Controle: de sleutel staat er.").interactie).toBe("bevestiging");
      expect(keuzeZonderAlternatieven(r(["Stap 1", "zet de sleutel in de kluis."]))).toBe(false);
    });
  });

  describe("B3: een keuze die het vangnet net niet leest, wordt door de poort afgedwongen", () => {
    it("leest cijfers als merk", () => {
      const item = eerste("- Stap 1: kies tussen (1) de ene weg, of (2) de andere weg.");
      expect(item.interactie).toBe("keuze");
      expect(item.opties.map((o) => o.keuze)).toEqual(["optie-1", "optie-2", "later"]);
    });

    for (const [wat, tekst] of [
      ["tweemaal hetzelfde merk", "kies tussen (a) de ene weg, of (A) de andere weg."],
      ["een leeg alternatief", "kies tussen (a), of (b) de andere weg."],
      // QA-ronde 7, bevinding 1: vijf vormen die zowel het vangnet als de poort
      // ontglipten omdat `lijktOpKeuze` dezelfde strenge scheidingstoets deed
      // als de lezer.
      ["een merk ná het alternatief", "Kies of je de rekening nu betaalt (a) of pas na de levering (b)."],
      ["een bijzin tussen de alternatieven", "kies tussen (a) de ene weg, of, als je liever wacht, (b) de andere weg."],
      ['"ofwel" in plaats van "of"', "kies tussen (a) de ene weg, ofwel (b) de andere weg."],
      ["een derde merk ertussen", "kies tussen (a) de ene weg (1), of (b) de andere weg."],
      ["een keuze zonder merken", "Kies of je nu betaalt of pas na de levering."],
    ] as const) {
      it(`herkent ${wat} als bijna-keuze`, () => {
        expect(lijktOpKeuze(tekst)).toBe(true);
      });
    }

    it("zwijgt over een handeling met twee delen", () => {
      for (const tekst of [
        "doe (a) het ene en (b) het andere.",
        "controleer artikel 5 lid (a) en lid (b) van het contract.",
        "zet de sleutel in de kluis.",
      ]) {
        expect(lijktOpKeuze(tekst)).toBe(false);
      }
    });

    it("zwijgt over een verwijzing met merken zonder keuzewoord (QA-ronde 7, bevinding 7)", () => {
      // Twee merken met een "of" ertussen zijn niet genoeg: dit zijn
      // verwijzingen, geen vragen. Het keuzewoord is de discriminant.
      for (const tekst of [
        "Lees punt (a) of (b) van het contract door voordat je betaalt.",
        "Betaal de factuur (1) of (2), ze horen bij dezelfde levering.",
        "neem (a) de ene weg, of (b) de andere weg.",
      ]) {
        expect(lijktOpKeuze(tekst)).toBe(false);
      }
    });

    it("zwijgt over een ja-nee-vraag met één \"of\"", () => {
      // "beslissen of X mag" is geen keuze tussen twee benoemde alternatieven.
      expect(lijktOpKeuze("beslissen of X mag.")).toBe(false);
      expect(lijktOpKeuze("Kies in de app of een samenvoeging een taaknummer moet dragen.")).toBe(false);
    });

    it("laat een uitgesplitste keuze een gewone keuze zijn", () => {
      const item = eerste(
        "- **Het beslispunt.**\n  - Stap 1: neem (a) de ene weg, of (b) de andere weg.\n" +
          "  - Keuze: welke weg?\n  - Optie A: de ene weg\n  - Optie B: de andere weg",
      );
      expect(item.interactie).toBe("keuze");
      expect(item.opties.map((o) => o.keuze)).toEqual(["optie-a", "optie-b", "later"]);
    });
  });

  describe("N3: een lege `Keuze`-regel geeft geen kaart zonder titel", () => {
    it("valt terug op de titel van het punt", () => {
      const item = eerste("- **Beslispunt.**\n  - Keuze:\n  - Optie A: de ene weg\n  - Optie B: de andere weg");
      expect(item.titel).toBe("Beslispunt.");
      expect(item.opties.map((o) => o.keuze)).toEqual(["optie-a", "optie-b", "later"]);
    });

    it("doet dat ook bij een regel met alleen opmaak", () => {
      expect(eerste("- **Beslispunt.**\n  - Keuze: **\n  - Optie A: de ene weg\n  - Optie B: de andere weg").titel).toBe("Beslispunt.");
    });
  });

  describe("N4/N6: wat niet in een knop past, staat wél op de kaart", () => {
    it("bewaart de staart van een lange vraag in de toelichting", () => {
      const lang =
        "welke weg kiezen we voor de preview-bouw van pull requests, gegeven dat de gratis limiet van de leverancier " +
        "al twee keer is volgelopen en de bouw dan stilvalt?";
      const item = eerste(`- **De preview-bouw.**\n  - Keuze: ${lang}\n  - Optie A: de ene weg\n  - Optie B: de andere weg`);
      expect(item.titel.length).toBeLessThan(lang.length);
      expect(item.toelichting).toContain("volgelopen");
    });

    it("zet de alternatieven in de tekst als zij geen knop worden", () => {
      const item = eerste(
        "**akkoord_pr**\n\n- **Het akkoord.**\n  - Optie A: de ene weg\n  - Optie B: de andere weg",
      );
      expect(item.interactie).toBe("akkoord");
      expect(item.toelichting).toContain("de ene weg");
      expect(item.toelichting).toContain("de andere weg");
    });
  });
});

describe("N5: de regels van een eigenaarspunt komen werkelijk uit het dossier", () => {
  // `leesEigenaarsPunten` vult wat de drie keuzeregels van de poort lezen.
  // Zonder die doorgifte zwijgen ze op elk echt dossier, en dat had geen test.
  it("leest label én tekst van elke regel onder een punt", async () => {
    const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { leesEigenaarsPunten } = await import("@/jarvis/src/opdrachten");
    const wortel = await mkdtemp(path.join(tmpdir(), "jarvis-eig-"));
    await mkdir(path.join(wortel, "tasks", "T-1"), { recursive: true });
    await writeFile(
      path.join(wortel, "tasks", "T-1", "resultaat.md"),
      "# Resultaat\n\n## Wat de eigenaar nog moet doen\n\n" +
        "- **De preview-bouw.**\n  - Keuze: welke weg kiezen we?\n  - Optie A: de ene weg\n  - Optie B: de andere weg\n",
      "utf8",
    );
    const punten = await leesEigenaarsPunten(wortel, { taken_map: "tasks" } as never, ["tasks/T-1/resultaat.md"]);
    expect(punten).toHaveLength(1);
    expect(punten[0].tekst).toContain("De preview-bouw.");
    expect(punten[0].regels.map((r) => r.label)).toEqual(["Keuze", "Optie A", "Optie B"]);
    expect(punten[0].regels.map((r) => r.tekst)).toEqual(["welke weg kiezen we?", "de ene weg", "de andere weg"]);
    // En daarmee valt het punt door de poort als een geldige keuze, niet als half.
    expect(keuzeZonderAlternatieven(punten[0].regels)).toBe(false);
  });
});

describe("QA-ronde 7 — de laatste twee paden, en een oude fout in de poort", () => {
  const r = (...paren: readonly (readonly [string, string])[]) => paren.map(([label, tekst]) => ({ label, tekst }));

  describe("bevinding 2: een keuze in een `Extern`- of `Bevestig`-regel bereikt de poort", () => {
    for (const label of ["Extern", "Bevestig", "Wacht"]) {
      it(`meldt een keuze in een \`${label}\`-regel als niet-uitgesplitst`, () => {
        const regels = r([label, "kies tussen (a) de ene sleutel, of (b) de andere sleutel."]);
        expect(keuzeNietUitgesplitst({ tekst: "Er ligt iets bij jou.", regels })).toBe(true);
      });
    }

    it("leest ook `Let op` en `Controle` (QA-ronde 8, bevinding 2)", () => {
      // De oude motivering — "een waarschuwing hoort geen kaart met knoppen te
      // worden" — is meetbaar onjuist: de kaart krijgt haar knoppen uit het
      // soort, niet uit deze lijst. Uitsluiten verhinderde geen knoppen, alleen
      // dat de poort de tegenspraak meldde. Over de hele historie van de drie
      // projecten kost de verbreding nul nieuwe bevindingen.
      for (const label of ["Let op", "Controle", "Voorwaarde", "Toelichting"]) {
        const regels = r([label, "kies tussen (a) de ene weg, of (b) de andere weg."]);
        expect(keuzeNietUitgesplitst({ tekst: "Er ligt iets bij jou.", regels })).toBe(true);
      }
    });

    it("leest de keuze ook in de vette tussenkop (QA-ronde 8, bevinding 3)", () => {
      // De kaart plakt de kop vóór de toelichting, dus de eigenaar ziet de vraag;
      // de poort zag haar niet, want `leesEigenaarsPunten` gaf haar niet door.
      expect(
        keuzeNietUitgesplitst({
          tekst: "Leg de termijn vast in het contract.",
          context: "Kies tussen (a) nu betalen, of (b) na levering",
          regels: [],
        }),
      ).toBe(true);
      expect(keuzeNietUitgesplitst({ tekst: "Leg de termijn vast in het contract.", context: "Betaaltermijn", regels: [] })).toBe(false);
    });
  });

  describe("bevinding 3: de tekst van een soortbepalende regel staat op de kaart", () => {
    it("zet de instructie van een `Extern`-regel in de toelichting", () => {
      const item = eerste(
        "- **Zet de sleutel in de kluis.**\n" +
          "  - Extern: log in op het platform, open Instellingen en plak de waarde onder de afgesproken naam\n" +
          "  - Controle: de naam staat in de lijst",
      );
      expect(item.interactie).toBe("externe-handeling");
      expect(item.toelichting).toContain("log in op het platform");
      expect(item.controle).toContain("staat in de lijst");
    });

    it("zegt waarop gewacht wordt", () => {
      const item = eerste("- **Het punt.**\n  - Wacht: op het antwoord van de leverancier");
      expect(item.interactie).toBe("uitstel");
      expect(item.toelichting).toContain("antwoord van de leverancier");
    });
  });

  describe("bevinding 5: de eerste ongecommitte wijziging valt niet meer buiten de poort", () => {
    it("leest het pad van elke statusregel, ook de eerste met een leidende spatie", async () => {
      const { padenUitPorcelain } = await import("@/jarvis/src/opdrachten");
      expect(padenUitPorcelain(" M tasks/T-1/resultaat.md\n?? nieuw.md\n")).toEqual([
        "tasks/T-1/resultaat.md",
        "nieuw.md",
      ]);
      expect(padenUitPorcelain("MM a.ts\n M b.ts\nA  c.ts\n")).toEqual(["a.ts", "b.ts", "c.ts"]);
    });

    it("neemt bij een herbenoeming het nieuwe pad", () => {
      return import("@/jarvis/src/opdrachten").then(({ padenUitPorcelain }) => {
        expect(padenUitPorcelain("R  oud.md -> nieuw.md\n")).toEqual(["nieuw.md"]);
      });
    });

    it("negeert lege regels en een lege uitvoer", async () => {
      const { padenUitPorcelain } = await import("@/jarvis/src/opdrachten");
      expect(padenUitPorcelain("")).toEqual([]);
      expect(padenUitPorcelain("\n\n")).toEqual([]);
    });
  });
});

describe("QA-ronde 8 — het formaat van de dossiers, niet dat van de poort", () => {
  const r = (...paren: readonly (readonly [string, string])[]) => paren.map(([label, tekst]) => ({ label, tekst }));

  describe("bevinding 1: alternatieven onder een eigen label zijn alternatieven", () => {
    it("leest `- Laten staan:` / `- Herschrijven:` als twee knoppen", () => {
      // Deze vorm staat letterlijk in de dossiers van dit project. Gemeten over de
      // hele historie: 16 van de 140 eigenaarspunten schreven hun alternatieven zo,
      // en alle zestien kwamen bij de eigenaar aan als één knop "Gedaan".
      const item = eerste(
        "- **Bepaal wat er met de vier bootstrapcommits gebeurt.**\n" +
          "  - Laten staan: de historie blijft zoals zij is, met LRN-0012 als verklaring\n" +
          "  - Herschrijven: Jarvis legt een plan voor; dat vraagt een force-push",
      );
      expect(item.interactie).toBe("keuze");
      expect(item.opties.map((o) => o.keuze)).toEqual(["laten-staan", "herschrijven", "later"]);
      expect(item.opties[0].gevolg).toContain("LRN-0012");
    });

    it("leest `- Publiek:` / `- Privé:` als twee knoppen, met accent", () => {
      const item = eerste("- **Beslissen of de engine publiek of privé wordt.**\n  - Publiek: geen tokens nodig\n  - Privé: een leestoken per consumer");
      expect(item.opties.map((o) => o.keuze)).toEqual(["publiek", "prive", "later"]);
    });

    it("laat de uitgeschreven vorm winnen boven een los label ernaast", () => {
      const item = eerste(
        "- **Het beslispunt.**\n  - Optie A: dit — gevolg\n  - Optie B: dat — gevolg\n  - Eigenaar: jij",
      );
      expect(item.opties.map((o) => o.keuze)).toEqual(["optie-a", "optie-b", "later"]);
    });

    for (const [wat, regels] of [
      ["annotaties", "  - Let op: morgen vervalt de licentie\n  - Termijn: vóór 1 oktober"],
      ["stappen die beide moeten gebeuren", "  - Stap 3 (cloud): zet de reeks\n  - Stap 4 (laptop): zet de reeks"],
      ["één los label", "  - Eigenaar: jij"],
    ] as const) {
      it(`maakt van ${wat} geen keuze`, () => {
        const item = eerste(`- **Zet de verbindingsreeks.**\n${regels}`);
        expect(item.interactie).not.toBe("keuze");
        expect(item.opties.map((o) => o.keuze)).toContain("gedaan");
      });
    }
  });

  describe("bevinding 5: elke labelregel staat op de kaart", () => {
    it("zet de tekst van een annotatie in de toelichting", () => {
      const item = eerste(
        "- **Zet de sleutel in de kluis.**\n  - Extern: log in op het platform\n  - Termijn: vóór 1 oktober, anders vervalt de licentie",
      );
      expect(item.toelichting).toContain("log in op het platform");
      expect(item.toelichting).toContain("vóór 1 oktober");
    });

    it("zet een alternatief dat al knop is niet nóg eens in de tekst", () => {
      const item = eerste("- **Het beslispunt.**\n  - Optie A: de ene weg\n  - Optie B: de andere weg");
      expect(item.opties.map((o) => o.keuze)).toEqual(["optie-a", "optie-b", "later"]);
      expect(item.toelichting).not.toContain("Optie A: de ene weg");
    });
  });

  describe("bevinding 12: de vette kop staat één keer op de kaart", () => {
    it("plakt de kop er niet nog eens voor als het punt met haar is geopend", () => {
      // De kop moet op een eigen regel staan: dán wordt zij `item.context` en
      // loopt het gewijzigde pad. Binnen de opsommingsregel is de context leeg en
      // bewaakt de test niets (QA-ronde 9, bevinding 6).
      const item = eerste("**Zet de sleutel in de kluis.**\n\n- Stap 1: log in\n- Controle: de naam staat in de lijst");
      const aantal = item.toelichting.split("Zet de sleutel in de kluis.").length - 1;
      expect(aantal).toBe(1);
    });
  });

  describe("bevinding 9: de porcelain-uitvoer in al zijn vormen", () => {
    it("leest een pad met aanhalingstekens, octale escapes en een pijl in de naam", async () => {
      const { padenUitPorcelain } = await import("@/jarvis/src/opdrachten");
      expect(padenUitPorcelain(' M "tasks/caf\\303\\251.md"\n')).toEqual(["tasks/café.md"]);
      expect(padenUitPorcelain('?? "tasks/a -> b.md"\n')).toEqual(["tasks/a -> b.md"]);
      expect(padenUitPorcelain('R  "tasks/a -> b.md" -> "tasks/c.md"\n')).toEqual(["tasks/c.md"]);
      expect(padenUitPorcelain(" M map met spaties/bestand.md\n")).toEqual(["map met spaties/bestand.md"]);
      expect(padenUitPorcelain("C  van.md -> naar.md\nUU conflict.md\n!! genegeerd.md\n")).toEqual([
        "naar.md",
        "conflict.md",
        "genegeerd.md",
      ]);
    });
  });

  describe("bevinding 7: een handeling naast een keuze wordt gemeld", () => {
    it("verliest zijn Gedaan aan de keuze, en de poort zegt dat", () => {
      const regels = r(["Extern", "zet de sleutel"], ["Optie A", "de ene weg"], ["Optie B", "de andere weg"]);
      const item = eerste(
        "- **Het punt.**\n  - Extern: zet de sleutel\n  - Optie A: de ene weg\n  - Optie B: de andere weg",
      );
      expect(item.interactie).toBe("keuze");
      expect(item.opties.map((o) => o.keuze)).not.toContain("gedaan");
      expect(leesAlternatieven(regels).length).toBe(2);
    });
  });

  describe("de vroege terugval van lijktOpKeuze (QA-ronde 8, bevinding 10)", () => {
    it("zwijgt over een tekst die het vangnet wél kan lezen", () => {
      // Anders stond er een dubbele bevinding op één punt.
      expect(lijktOpKeuze("kies tussen (a) de ene weg, of (b) de andere weg.")).toBe(false);
    });
  });
});

describe("QA-ronde 9 — de asymmetrie was verplaatst, niet weg", () => {
  const r = (...paren: readonly (readonly [string, string])[]) => paren.map(([label, tekst]) => ({ label, tekst }));

  describe("bevinding 1: één beschrijvend label is geen halve keuze", () => {
    for (const [wat, label] of [
      ["een rotatie-aanwijzing", "Rotatie/intrekking"],
      ["een volgorde-aanwijzing", "Volgorde"],
      ["een eigenaar", "Eigenaar"],
    ] as const) {
      it(`laat de poort zwijgen over ${wat}`, () => {
        // Echte historische dossierpunten. De kaart eist twee aandienende labels,
        // de lint eiste er één, en keurde daarmee vijf punten af die niets met een
        // keuze te maken hadden — met een boodschap over een `Keuze`-regel die er
        // niet stond.
        const regels = r(["Stap 1", "doe dit"], ["Controle", "zo zie je het"], [label, "een toelichting"]);
        expect(keuzeZonderAlternatieven(regels)).toBe(false);
      });
    }

    it("meldt twee aandienende labels nog steeds als halve keuze", () => {
      expect(keuzeZonderAlternatieven(r(["Publiek", "geen tokens"], ["Publiek", "nog eens"]))).toBe(true);
      expect(keuzeZonderAlternatieven(r(["Publiek", "geen tokens"], ["Privé", ""]))).toBe(true);
    });

    it("meldt één uitgeschreven `Optie` wel: die kondigt een keuze aan", () => {
      expect(keuzeZonderAlternatieven(r(["Optie A", "de ene weg"]))).toBe(true);
    });

    it("spreekt in de boodschap niet over een `Keuze`-regel die er niet is", () => {
      const uit = keuzeZonderAlternatieven(r(["Publiek", "geen tokens"], ["Publiek", "nog eens"]));
      expect(uit).toBe(true);
    });
  });

  describe("bevinding 2: de annotatietoets is geankerd", () => {
    for (const [eerst, tweede] of [
      ["Bevestigd", "Correcties nodig"],
      ["Termijn 30 dagen", "Termijn 60 dagen"],
      ["Controle door mij", "Controle door Jarvis"],
      ["Advies volgen", "Advies afwijken"],
      ["Bevestiging per mail", "Bevestiging per app"],
    ] as const) {
      it(`leest "${eerst}" / "${tweede}" als twee knoppen`, () => {
        const item = eerste(`- Bepaal hoe het verder gaat.\n  - ${eerst}: het ene gevolg\n  - ${tweede}: het andere gevolg`);
        expect(item.interactie).toBe("keuze");
        expect(item.opties).toHaveLength(3);
        expect(item.opties[2].keuze).toBe("later");
      });
    }

    for (const [wat, regels] of [
      ["stappen met een toevoeging", "  - Stap 3 (cloud): zet de reeks\n  - Stap 4 (laptop): zet de reeks"],
      ["twee uitlegregels", "  - Waarom deze volgorde: anders faalt de tweede\n  - Waarom precies deze rechten: minder kan niet"],
      ["een gevolg-annotatie naast een uitleg", "  - Gevolg voor nu: niets\n  - Waarom: het kan wachten"],
    ] as const) {
      it(`houdt ${wat} annotatie`, () => {
        const item = eerste(`- Zet de verbindingsreeks.\n${regels}`);
        expect(item.interactie).not.toBe("keuze");
      });
    }

    it("houdt de kale annotatiewoorden annotatie", () => {
      const item = eerste("- Zet de sleutel.\n  - Let op: morgen vervalt de licentie\n  - Termijn: vóór 1 oktober");
      expect(item.interactie).not.toBe("keuze");
    });
  });

  describe("bevinding 3: een lang label is nog steeds een labelregel", () => {
    it("leest twee alternatieven met een label van boven de veertig tekens", () => {
      const a = "Zelf bouwen met de bestaande koppelinglaag erbij";
      const b = "Een externe dienst inkopen en die laten koppelen";
      expect(a.length).toBeGreaterThan(40);
      const item = eerste(`- Bepaal de weg voor de nieuwe koppeling.\n  - ${a}: duurt twee weken, geen kosten per maand\n  - ${b}: klaar in twee dagen, kost 40 euro per maand`);
      expect(item.interactie).toBe("keuze");
      expect(item.opties.map((o) => o.gevolg)[0]).toContain("twee weken");
    });
  });
});
