// Het overzicht: de gegevenslaag onder de interface.
//
// Alles hier draait op verzonnen invoer. De bouwer is puur, dus elk stuk van
// het overzicht - wat er onder "voor jou" komt, hoe dubbelingen samenvallen,
// wat "recent" is - is met een paar strings te toetsen zonder repository.
import { describe, expect, it } from "vitest";
import {
  OVERZICHT_VERSIE,
  RECENT_DAGEN,
  bouwOverzicht,
  korteSleutel,
  isAkkoordStap,
  isAkkoordVraag,
  isAfgevinkt,
  bouwOpties,
  leesAandacht,
  leesFeiten,
  leesItemsOnder,
  leesOptieRegels,
  leesRecent,
  leesStandSecties,
  leesTaken,
  leesVoortgang,
  dossiersZonderBekendeStatus,
  openTakenUitDossiers,
  sleutelVan,
  type GitRegel,
  type ProjectInvoer,
  type TaakDossier,
} from "@/jarvis/src/overzicht";
import type { KnowledgeRecord } from "@/jarvis/src/records";

const NU = new Date("2026-09-11T12:00:00Z");

const STATUS = [
  "# Stand",
  "",
  "<!-- jarvis:feiten:start -->",
  "| Feit | Waarde |",
  "|---|---|",
  "| Hoofdbranch | `main` op `abc1234` (2026-09-11) |",
  "| Testbestanden | 75 |",
  "<!-- jarvis:feiten:eind -->",
  "",
  "## Waar staan we",
  "",
  "Het gaat goed.",
  "",
  "## Wat is geblokkeerd, en waarop",
  "",
  "Niets.",
  "",
  "## Volgende stap",
  "",
  "De interface.",
].join("\n");

function record(over: Partial<KnowledgeRecord> & { id: string; type: KnowledgeRecord["type"] }): KnowledgeRecord {
  return {
    titel: `Titel ${over.id}`,
    samenvatting: `Samenvatting ${over.id}`,
    datum: "2026-09-10",
    tags: [],
    bronnen: [],
    ...over,
  } as KnowledgeRecord;
}

function project(over: Partial<ProjectInvoer> = {}): ProjectInvoer {
  return {
    id: "p",
    naam: "Project",
    aangesloten: true,
    hoofdbranch: { naam: "main", commit: "abc1234", datum: "2026-09-11" },
    statusDocument: STATUS,
    records: [],
    taken: [],
    gitLog: [],
    ...over,
  };
}

describe("het statusdocument", () => {
  it("leest de secties zonder het feitenblok", () => {
    const secties = leesStandSecties(STATUS);
    expect(secties.map((s) => s.kop)).toEqual(["Waar staan we", "Wat is geblokkeerd, en waarop", "Volgende stap"]);
    expect(secties[0].tekst).toBe("Het gaat goed.");
    expect(secties.some((s) => s.tekst.includes("jarvis:feiten"))).toBe(false);
  });

  it("leest de feiten als paren, zonder backticks", () => {
    expect(leesFeiten(STATUS)).toEqual([
      { feit: "Hoofdbranch", waarde: "main op abc1234 (2026-09-11)" },
      { feit: "Testbestanden", waarde: "75" },
    ]);
  });

  it("verdraagt Windows-regeleindes", () => {
    expect(leesStandSecties(STATUS.replace(/\n/g, "\r\n")).length).toBe(3);
  });
});

describe("recente beweging", () => {
  const regel = (dagenGeleden: number, onderwerp: string, body = ""): GitRegel => ({
    hash: `h${dagenGeleden}abcdef`,
    datum: new Date(NU.getTime() - dagenGeleden * 86_400_000).toISOString(),
    onderwerp,
    body,
  });

  it("houdt alleen de laatste twee weken over, nieuwste eerst", () => {
    const recent = leesRecent([regel(20, "oud"), regel(1, "gisteren"), regel(5, "vorige week")], NU);
    expect(recent.map((r) => r.onderwerp)).toEqual(["gisteren", "vorige week"]);
    expect(RECENT_DAGEN).toBe(14);
  });

  it("leest de rol uit de trailer en herkent een merge", () => {
    const recent = leesRecent(
      [regel(1, "Merge pull request #5 from x/y"), regel(2, "Iets", "tekst\n\nJarvis-Role: Developer\n")],
      NU,
    );
    expect(recent[0].soort).toBe("merge");
    expect(recent[1].rol).toBe("developer");
    expect(recent[0].rol).toBeNull();
  });

  it("kort de hash in", () => {
    expect(leesRecent([regel(1, "x")], NU)[0].hash).toHaveLength(7);
  });
});

describe("items onder een kop", () => {
  const DOC = [
    "## Wat de eigenaar nog moet doen",
    "",
    "**Blokkerend voor merge**",
    "",
    "1. **Twee acks.** Zet ze in een review.",
    "   Op een eigen regel.",
    "2. De pull request openen.",
    "",
    "**Na merge**",
    "",
    "- `DIAG_SECRET` zetten.",
    "",
    "## Bekende beperkingen",
    "",
    "- dit hoort er niet bij",
  ].join("\n");

  it("leest genummerde en opgesomde items met hun context", () => {
    const items = leesItemsOnder(DOC, /^## Wat de eigenaar nog moet doen\s*$/m);
    expect(items).toHaveLength(3);
    expect(items[0].titel).toBe("Twee acks.");
    expect(items[0].toelichting).toBe("Twee acks. Zet ze in een review. Op een eigen regel.");
    expect(items[0].context).toBe("Blokkerend voor merge");
    expect(items[2].context).toBe("Na merge");
  });

  it("stopt bij de volgende kop", () => {
    const items = leesItemsOnder(DOC, /^## Wat de eigenaar nog moet doen\s*$/m);
    expect(items.some((i) => i.toelichting.includes("hoort er niet bij"))).toBe(false);
  });

  it("geeft niets bij een ontbrekende kop", () => {
    expect(leesItemsOnder(DOC, /^## Bestaat niet$/m)).toEqual([]);
  });
});

describe("wat bij de eigenaar ligt", () => {
  it("levert precies één item voor een niet-aangesloten project", () => {
    const items = leesAandacht(project({ aangesloten: false, statusDocument: null, naam: "Kasboek" }));
    expect(items).toHaveLength(1);
    expect(items[0].soort).toBe("actie");
    expect(items[0].titel).toContain("Kasboek");
  });

  it("maakt van een open conflict een item met urgentie hoog", () => {
    const items = leesAandacht(project({ records: [record({ id: "CFL-0001", type: "CFL", status: "open" } as never)] }));
    expect(items).toEqual([
      expect.objectContaining({ soort: "conflict", bron: "CFL-0001", urgentie: "hoog", id: "p:CFL-0001" }),
    ]);
  });

  it("laat een opgelost conflict en een geaccepteerd risico weg", () => {
    const items = leesAandacht(
      project({
        records: [
          record({ id: "CFL-0002", type: "CFL", status: "opgelost" } as never),
          record({ id: "RSK-0001", type: "RSK", status: "geaccepteerd", kans: "laag", impact: "hoog" } as never),
        ],
      }),
    );
    expect(items).toEqual([]);
  });

  it("weegt een open risico naar impact", () => {
    const items = leesAandacht(
      project({
        records: [
          record({ id: "RSK-0001", type: "RSK", status: "open", kans: "laag", impact: "hoog" } as never),
          record({ id: "RSK-0002", type: "RSK", status: "open", kans: "laag", impact: "laag" } as never),
        ],
      }),
    );
    expect(items.map((i) => [i.bron, i.urgentie])).toEqual([
      ["RSK-0001", "midden"],
      ["RSK-0002", "laag"],
    ]);
  });

  it("laat een open risico met een lopende aanpak uit de eigenaarslijst: dat werk is van Jarvis", () => {
    const items = leesAandacht(
      project({
        records: [
          record({ id: "RSK-0001", type: "RSK", status: "open", kans: "laag", impact: "hoog", aanpak: "T-20260912-opruimen" } as never),
          record({ id: "RSK-0002", type: "RSK", status: "open", kans: "laag", impact: "laag" } as never),
        ],
      }),
    );
    expect(items.map((i) => i.bron)).toEqual(["RSK-0002"]);
  });

  it("leest de eigenaarslijst uit een taakdossier; het soort hangt niet aan een woord", () => {
    const resultaat = [
      "## Wat de eigenaar nog moet doen",
      "",
      "**Blokkerend voor merge**",
      "",
      "1. **Twee acks.** In een review.",
      "",
      "**Na merge**",
      "",
      "2. Iets zetten.",
      "3. **Beslissen of X mag.** Toelichting.",
    ].join("\n");
    const items = leesAandacht(project({ taken: [{ id: "T-1", opdracht: { status: "actief" }, resultaat }] }));
    // Geen van deze drie punten noemt alternatieven, een externe dienst of een
    // bevestiging, en geen ervan draagt een akkoordcontext. Ze vragen dus geen
    // handeling die Jarvis kan aanbieden — ook niet het punt dat toevallig met
    // "Beslissen" begint. Dat is de kern van criterium 1: het eerste woord van
    // een titel bepaalt niets meer. De urgentie blijft wél uit de context komen.
    // `soort` blijft geassserteerd: de interface rendert er een chip en een
    // icoon op en sorteert erop (SOORT_VOLGORDE), dus een stille wijziging
    // daar is zichtbaar voor de eigenaar.
    expect(items.map((i) => i.soort)).toEqual(["actie", "actie", "actie"]);
    expect(items.map((i) => [i.interactie, i.urgentie])).toEqual([
      ["uitstel", "hoog"],
      ["uitstel", "laag"],
      ["uitstel", "laag"],
    ]);
    // En zonder soort dat een handeling aanbiedt, ook geen knop die dat
    // suggereert: alleen "Later" (criterium 3).
    expect(items.map((i) => i.opties.map((o) => o.keuze))).toEqual([["later"], ["later"], ["later"]]);
    expect(items[0].bron).toBe("tasks/T-1/resultaat.md");
  });

  it("slaat een afgeronde taak over", () => {
    const resultaat = "## Wat de eigenaar nog moet doen\n\n1. Iets.\n";
    expect(leesAandacht(project({ taken: [{ id: "T-1", opdracht: { status: "afgerond" }, resultaat }] }))).toEqual([]);
  });

  it("leest een HUMAN_ACTION_REQUIRED-markering", () => {
    const resultaat = "Tekst.\n\n> **HUMAN_ACTION_REQUIRED** — zet X in Y.\n";
    const items = leesAandacht(project({ taken: [{ id: "T-1", opdracht: { status: "actief" }, resultaat }] }));
    expect(items).toHaveLength(1);
    expect(items[0].urgentie).toBe("hoog");
    expect(items[0].titel).toContain("zet X in Y");
  });

  it("maakt van een echte blokkade in het statusdocument een item", () => {
    const status = STATUS.replace("Niets.", "- De deploy wacht op een sleutel.");
    const items = leesAandacht(project({ statusDocument: status }));
    expect(items).toEqual([expect.objectContaining({ soort: "blokkade", urgentie: "hoog" })]);
  });

  it("maakt van 'Niets.' onder geblokkeerd geen item", () => {
    expect(leesAandacht(project())).toEqual([]);
  });

  describe("ontdubbeling", () => {
    it("laat een blokkade en een actie die naar een record verwijzen samenvallen met dat record", () => {
      // Hetzelfde conflict kwam uit drie bronnen: als record, als blokkade in
      // het statusdocument en als actie in een taakdossier. Dat is één item.
      const status = STATUS.replace("Niets.", "CFL-0001 wacht op een besluit.");
      const resultaat = "## Wat de eigenaar nog moet doen\n\n1. CFL-0001 beslissen.\n";
      const items = leesAandacht(
        project({
          statusDocument: status,
          records: [record({ id: "CFL-0001", type: "CFL", status: "open" } as never)],
          taken: [{ id: "T-1", opdracht: { status: "actief" }, resultaat }],
        }),
      );
      expect(items).toHaveLength(1);
      expect(items[0].bron).toBe("CFL-0001");
    });

    it("tilt de urgentie van het record op naar die van de verwijzing", () => {
      const resultaat = "## Wat de eigenaar nog moet doen\n\n**Blokkerend voor merge**\n\n1. RSK-0001 accepteren.\n";
      const items = leesAandacht(
        project({
          records: [record({ id: "RSK-0001", type: "RSK", status: "open", kans: "laag", impact: "laag" } as never)],
          taken: [{ id: "T-1", opdracht: { status: "actief" }, resultaat }],
        }),
      );
      expect(items).toHaveLength(1);
      expect(items[0].urgentie).toBe("hoog");
    });

    it("laat een verwijzing naar een record dat geen eigen item is gewoon staan", () => {
      const resultaat = "## Wat de eigenaar nog moet doen\n\n1. DEC-0005 nog eens lezen.\n";
      const items = leesAandacht(project({ taken: [{ id: "T-1", opdracht: { status: "actief" }, resultaat }] }));
      expect(items).toHaveLength(1);
    });
  });

  it("sorteert op urgentie, dan soort, dan id", () => {
    const resultaat = "## Wat de eigenaar nog moet doen\n\n**Blokkerend**\n\n1. Beslis A.\n\n**Na merge**\n\n2. Doe B.\n";
    const items = leesAandacht(
      project({
        records: [record({ id: "RSK-0001", type: "RSK", status: "open", kans: "laag", impact: "hoog" } as never)],
        taken: [{ id: "T-1", opdracht: { status: "actief" }, resultaat }],
      }),
    );
    expect(items.map((i) => i.urgentie)).toEqual(["hoog", "midden", "laag"]);
  });
});

describe("korteSleutel", () => {
  it("is stabiel en kort", () => {
    expect(korteSleutel("Twee acks.")).toBe(korteSleutel("Twee acks."));
    expect(korteSleutel("Twee acks.")).toMatch(/^[0-9a-f]{8}$/);
    expect(korteSleutel("Twee acks.")).not.toBe(korteSleutel("Drie acks."));
  });

  it("blijft ver onder de entropiedrempel van de sanitizer", () => {
    // Een slug van vijftig tekens haalde die drempel en blokkeerde het
    // wegschrijven van het overzicht. Acht tekens kunnen dat nooit.
    expect(korteSleutel("een heel lange titel met cijfers 12345 en meer tekst erin").length).toBeLessThan(32);
  });
});

describe("het hele overzicht", () => {
  it("bundelt projecten en legt alles voor de eigenaar bij elkaar, urgentste eerst", () => {
    const o = bouwOverzicht(
      [
        project({ id: "a", records: [record({ id: "CFL-0001", type: "CFL", status: "open" } as never)] }),
        project({ id: "b", naam: "B", aangesloten: false, statusDocument: null }),
      ],
      NU,
    );
    expect(o.versie).toBe(OVERZICHT_VERSIE);
    expect(o.gegenereerd_op).toBe("2026-09-11T12:00:00.000Z");
    expect(o.projecten.map((p) => p.id)).toEqual(["a", "b"]);
    expect(o.voor_jou.map((i) => [i.project, i.urgentie])).toEqual([
      ["a", "hoog"],
      ["b", "midden"],
    ]);
  });

  it("is deterministisch", () => {
    const invoer = [project({ records: [record({ id: "CFL-0001", type: "CFL", status: "open" } as never)] })];
    expect(JSON.stringify(bouwOverzicht(invoer, NU))).toBe(JSON.stringify(bouwOverzicht(invoer, NU)));
  });
});

describe("opties: wat de eigenaar kan kiezen", () => {
  it("leest ingesprongen keuzeregels onder een punt uit de eigenaarslijst", () => {
    const doc = [
      "## Wat de eigenaar nog moet doen",
      "",
      "1. **Beslissen of X mag.** Toelichting.",
      "   - Ja: X wordt gebouwd,",
      "     met alles erop en eraan.",
      "   - Nee: X blijft liggen.",
      "   - Advies: kies ja.",
      "   - Waarom: alleen jij weet dit.",
      "2. Iets anders.",
    ].join("\n");
    const items = leesItemsOnder(doc, /^## Wat de eigenaar nog moet doen\s*$/m);
    expect(items).toHaveLength(2);
    expect(items[0].regels).toEqual([
      { label: "Ja", tekst: "X wordt gebouwd, met alles erop en eraan." },
      { label: "Nee", tekst: "X blijft liggen." },
      { label: "Advies", tekst: "kies ja." },
      { label: "Waarom", tekst: "alleen jij weet dit." },
    ]);
    expect(items[0].toelichting).toBe("Beslissen of X mag. Toelichting.");
    expect(items[1].regels).toEqual([]);
  });

  it("maakt keuzes, advies en waarom uit de regels, met later er altijd bij", () => {
    const regels = leesOptieRegels("- **Smal**: alleen review.\n- Breed: alles.\n- Advies: smal.\n- Waarom: productkeuze.");
    const uit = bouwOpties(regels, []);
    expect(uit.opties.map((o) => o.keuze)).toEqual(["smal", "breed", "later"]);
    expect(uit.opties[0]).toEqual({ keuze: "smal", label: "Smal", gevolg: "alleen review." });
    expect(uit.advies).toBe("smal.");
    expect(uit.waarom).toBe("productkeuze.");
  });

  it("valt terug op de standaardopties zonder keuzeregels", () => {
    const standaard = [{ keuze: "gedaan", label: "Gedaan", gevolg: "af." }];
    const uit = bouwOpties([{ label: "Advies", tekst: "doe het." }], standaard);
    expect(uit.opties.map((o) => o.keuze)).toEqual(["gedaan", "later"]);
    expect(uit.advies).toBe("doe het.");
    expect(uit.waarom).toBeNull();
  });

  it("geeft elk item opties en een waarom", () => {
    const items = leesAandacht(
      project({
        records: [
          record({ id: "RSK-0001", type: "RSK", status: "open", impact: "hoog", kans: "laag", mitigatie: "Er is een backup. En meer." } as never),
          record({ id: "CFL-0001", type: "CFL", status: "open", opties: "- Smal: a.\n- Breed: b.\n- Advies: smal." } as never),
        ],
      }),
    );
    const risico = items.find((i) => i.bron === "RSK-0001")!;
    expect(risico.opties.map((o) => o.keuze)).toEqual(["accepteren", "aanpakken", "later"]);
    expect(risico.opties[0].gevolg).toContain("kans laag, impact hoog");
    expect(risico.opties[0].gevolg).toContain("Er is een backup.");
    expect(risico.waarom.length).toBeGreaterThan(10);
    const conflict = items.find((i) => i.bron === "CFL-0001")!;
    expect(conflict.opties.map((o) => o.keuze)).toEqual(["smal", "breed", "later"]);
    expect(conflict.advies).toBe("smal.");
  });

  it("maakt sleutels zonder accenten of spaties", () => {
    expect(sleutelVan("Niet aansluiten")).toBe("niet-aansluiten");
    expect(sleutelVan("Ja, graag!")).toBe("ja-graag");
    expect(sleutelVan("Één keer")).toBe("een-keer");
  });
});

describe("taken over een ander project", () => {
  it("leest de voortgangslijst met vinkjes", () => {
    const res = ["## Voortgang", "", "- [x] Scan gedaan", "- [ ] Remote", "  aanmaken en pushen", "- [ ] Aansluiting", "", "## Iets anders", "- [ ] telt niet"].join("\n");
    expect(leesVoortgang(res)).toEqual([
      { tekst: "Scan gedaan", gedaan: true },
      { tekst: "Remote aanmaken en pushen", gedaan: false },
      { tekst: "Aansluiting", gedaan: false },
    ]);
    expect(leesVoortgang(null)).toEqual([]);
  });

  it("verhuist items en taak naar het project uit de front-matter", () => {
    const resultaat = "## Voortgang\n- [ ] Stap\n\n## Wat de eigenaar nog moet doen\n\n1. **Iets doen.** Nu.\n";
    const drager = project({ id: "a", taken: [{ id: "T-1", opdracht: { status: "actief", titel: "Aansluiten", project: "b" }, resultaat }] });
    const doel = project({ id: "b", naam: "B", aangesloten: false, statusDocument: null, aansluitingLoopt: true });
    const o = bouwOverzicht([drager, doel], NU);
    const a = o.projecten.find((p) => p.id === "a")!;
    const b = o.projecten.find((p) => p.id === "b")!;
    expect(a.aandacht.map((i) => i.titel)).toEqual([]);
    expect(b.aandacht.map((i) => i.titel)).toEqual(["Iets doen."]);
    expect(b.aandacht[0].project).toBe("b");
    expect(a.taken).toEqual([]);
    expect(b.taken.map((t) => [t.id, t.gastheer, t.stappen.length])).toEqual([["T-1", "a", 1]]);
  });

  it("laat items staan wanneer het doelproject niet in het overzicht zit", () => {
    const resultaat = "## Wat de eigenaar nog moet doen\n\n1. Iets.\n";
    const drager = project({ id: "a", taken: [{ id: "T-1", opdracht: { status: "actief", project: "zzz" }, resultaat }] });
    const o = bouwOverzicht([drager], NU);
    expect(o.projecten[0].aandacht).toHaveLength(1);
    expect(o.projecten[0].taken).toHaveLength(1);
  });

  it("stelt de aansluitvraag niet meer zodra er een aansluittaak loopt", () => {
    expect(leesAandacht(project({ aangesloten: false, statusDocument: null, aansluitingLoopt: true }))).toEqual([]);
    expect(leesAandacht(project({ aangesloten: false, statusDocument: null }))).toHaveLength(1);
  });
});

describe("stappen van een handeling", () => {
  it("leest genummerde stappen en een controle, los van de keuzes", () => {
    const regels = leesOptieRegels("- Stap 2: klik Create.\n- Stap 1: open github.com/new.\n- Controle: de pagina toont de lege repository.\n- Gedaan: Jarvis pusht.");
    const uit = bouwOpties(regels, []);
    expect(uit.stappen).toEqual(["open github.com/new.", "klik Create."]);
    expect(uit.controle).toBe("de pagina toont de lege repository.");
    expect(uit.opties.map((o) => o.keuze)).toEqual(["gedaan", "later"]);
  });
});

describe("Jarvis als eigen project", () => {
  it("legt records met de kerntag bij het kernproject en zet de kern in het overzicht", () => {
    const drager = project({
      id: "product",
      records: [
        record({ id: "RSK-0001", type: "RSK", status: "open", impact: "hoog", kans: "laag", mitigatie: "x.", tags: ["jarvis"] } as never),
        record({ id: "RSK-0002", type: "RSK", status: "open", impact: "laag", kans: "laag", mitigatie: "x.", tags: ["product"] } as never),
      ],
      taken: [{ id: "T-1", opdracht: { status: "actief", titel: "Engine", project: "jarvis" }, resultaat: "## Voortgang" + "\n" + "- [ ] a" + "\n" }],
      tagProjecten: { jarvis: "jarvis" },
    });
    const kern = project({ id: "jarvis", naam: "Jarvis", statusDocument: null });
    const o = bouwOverzicht([kern, drager], NU, "jarvis");
    expect(o.centraal).toBe("jarvis");
    const j = o.projecten.find((p) => p.id === "jarvis")!;
    const pr = o.projecten.find((p) => p.id === "product")!;
    expect(j.aandacht.map((a) => a.bron)).toEqual(["RSK-0001"]);
    expect(pr.aandacht.map((a) => a.bron)).toEqual(["RSK-0002"]);
    expect(j.taken.map((t) => t.id)).toEqual(["T-1"]);
    expect(pr.taken).toEqual([]);
  });

  it("zet centraal op null als dat project niet bestaat", () => {
    expect(bouwOverzicht([project()], NU, "zzz").centraal).toBeNull();
    expect(bouwOverzicht([project()], NU).centraal).toBeNull();
  });
});

describe("wie is aan zet", () => {
  const dossier = (id: string, res: string, extra: Record<string, unknown> = {}) => ({ id, opdracht: { status: "actief", titel: id, ...extra }, resultaat: res });
  it("is de eigenaar zodra er een open eigenaarspunt uit de taak is, anders Jarvis", () => {
    const eig = dossier("T-20260901-a", "## Voortgang" + "\n" + "- [ ] Stap" + "\n" + "## Wat de eigenaar nog moet doen" + "\n" + "1. Doe iets." + "\n");
    const jar = dossier("T-20260901-b", "## Voortgang" + "\n" + "- [x] Klaar" + "\n" + "- [ ] Volgende stap" + "\n");
    const o = bouwOverzicht([project({ taken: [eig, jar] })], NU);
    const [a, b] = o.projecten[0].taken;
    expect([a.aan_zet, a.wacht_op]).toEqual(["eigenaar", "Doe iets."]);
    expect([b.aan_zet, b.wacht_op, b.stil, b.laatste_beweging]).toEqual(["jarvis", "Volgende stap", true, null]);
  });
  it("leest de laatste beweging uit de Jarvis-Task-trailer en is dan niet stil", () => {
    const jar = dossier("T-20260901-b", "## Voortgang" + "\n" + "- [ ] Stap" + "\n");
    const gitLog = [{ hash: "abc1234", datum: NU.toISOString(), onderwerp: "werk", body: "Jarvis-Role: developer" + "\n" + "Jarvis-Task: T-20260901-b" }];
    const t = bouwOverzicht([project({ taken: [jar], gitLog })], NU).projecten[0].taken[0];
    expect(t.laatste_beweging).toBe(NU.toISOString());
    expect(t.stil).toBe(false);
  });
  it("is de eigenaar als de volgende stap zijn akkoord op de taak is (DEC-0043)", () => {
    const tekst = "---" + "\n" + "status: actief" + "\n" + "---" + "\n" + "Scope." + "\n";
    const wacht = { ...dossier("T-20260901-d", "## Voortgang" + "\n" + "- [x] Gebouwd" + "\n" + "- [ ] Akkoord van de eigenaar op deze taak in de Jarvis-app → attestatie en merge" + "\n" + "- [ ] Uitrollen" + "\n"), tekst };
    const bouwt = { ...dossier("T-20260901-e", "## Voortgang" + "\n" + "- [ ] Bouwen" + "\n" + "- [ ] Akkoord van de eigenaar" + "\n"), tekst };
    const o = bouwOverzicht([project({ taken: [wacht, bouwt] })], NU);
    const [a, b] = o.projecten[0].taken;
    expect([a.aan_zet, a.akkoord_nodig, a.stil]).toEqual(["eigenaar", true, false]);
    expect(a.wacht_op).toMatch(/^Akkoord van de eigenaar/);
    expect([b.aan_zet, b.akkoord_nodig]).toEqual(["jarvis", false]);
    // Zonder scope (geen opdrachttekst) is er niets om akkoord op te geven.
    const zonder = dossier("T-20260901-f", "## Voortgang" + "\n" + "- [ ] Akkoord van de eigenaar" + "\n");
    expect(bouwOverzicht([project({ taken: [zonder] })], NU).projecten[0].taken[0].akkoord_nodig).toBe(false);
    // Een stap die het woord slechts noemt is geen akkoordstap (jarvis-app: "… akkoord vanuit de app verwerkt").
    expect(isAkkoordStap("Akkoord van de eigenaar op deze taak (DEC-0043)")).toBe(true);
    expect(isAkkoordStap("Wake-loop: vraag en akkoord vanuit de app verwerkt, ook als de eigenaar niet reageert")).toBe(false);
  });
  it("volgt een afhankelijkheid 'wacht op T-…', ook over projecten heen", () => {
    const eig = dossier("T-20260901-a", "## Wat de eigenaar nog moet doen" + "\n" + "1. Maak de repository aan." + "\n");
    const wacht = dossier("T-20260901-c", "## Voortgang" + "\n" + "- [ ] Inrichten — wacht op T-20260901-a" + "\n", { project: "b" });
    const o = bouwOverzicht([project({ id: "a", taken: [eig, wacht] }), project({ id: "b", naam: "B", statusDocument: null })], NU);
    const t = o.projecten.find((p) => p.id === "b")!.taken[0];
    expect(t.id).toBe("T-20260901-c");
    expect([t.aan_zet, t.stil]).toEqual(["eigenaar", false]);
    expect(t.wacht_op).toBe("T-20260901-a: Maak de repository aan.");
  });
});

describe("openTakenUitDossiers", () => {
  const d = (id: string, status: string, titel?: string): TaakDossier => ({
    id,
    opdracht: titel === undefined ? { status } : { status, titel },
    resultaat: null,
  });

  it("noemt de taken waar nog aan gewerkt of over geoordeeld wordt, op id gesorteerd", () => {
    const uit = openTakenUitDossiers([d("T-b", "review", "Tweede"), d("T-a", "actief", "Eerste")]);
    expect(uit).toEqual([
      { id: "T-a", titel: "Eerste", status: "actief" },
      { id: "T-b", titel: "Tweede", status: "review" },
    ]);
  });

  it("laat afgeronde, geblokkeerde en statusloze taken buiten het feitenblok", () => {
    const uit = openTakenUitDossiers([
      d("T-a", "afgerond", "Klaar"),
      d("T-b", "geblokkeerd", "Vast"),
      { id: "T-c", opdracht: {}, resultaat: null },
    ]);
    expect(uit).toEqual([]);
  });

  it("valt terug op het id als titel, zodat een taak nooit onzichtbaar wordt", () => {
    expect(openTakenUitDossiers([d("T-a", "actief")])).toEqual([{ id: "T-a", titel: "T-a", status: "actief" }]);
  });

  it("valt ook terug op het id bij een lege of alleen-witruimte-titel, in plaats van een lege cel", () => {
    expect(openTakenUitDossiers([d("T-a", "actief", "")])).toEqual([{ id: "T-a", titel: "T-a", status: "actief" }]);
    expect(openTakenUitDossiers([d("T-b", "actief", "   ")])).toEqual([{ id: "T-b", titel: "T-b", status: "actief" }]);
  });
});

describe("leesTaken", () => {
  const d = (id: string, opdracht: Record<string, string>): TaakDossier => ({ id, opdracht, resultaat: null });

  it("valt terug op het id bij een ontbrekende, lege of alleen-witruimte-titel", () => {
    const uit = leesTaken(
      [
        d("T-a", { status: "actief" }),
        d("T-b", { status: "actief", titel: "" }),
        d("T-c", { status: "actief", titel: "   " }),
        d("T-d", { status: "actief", titel: "  Met spaties eromheen  " }),
      ],
      "tovas-flow",
    );
    expect(uit.map((t) => t.titel)).toEqual(["T-a", "T-b", "T-c", "Met spaties eromheen"]);
  });
});

describe("stappen op het hoogste niveau (LRN-0014, cloud-schrijfwijze)", () => {
  it("bundelt '- Stap N:' en '- Controle:' onder de vette kop tot één handeling", () => {
    const tekst = "## Wat de eigenaar nog moet doen\n\n**Handeling 2 — de trigger bijstellen**\n\n- Stap 1: beperk de trigger tot main.\n- Stap 2: zet het rooster op twee keer per dag.\n- Controle: Jarvis meet daarna in de logboeken dat het werkt.\n";
    const items = leesItemsOnder(tekst, /^## Wat de eigenaar nog moet doen\s*$/m);
    expect(items).toHaveLength(1);
    expect(items[0].titel).toBe("Handeling 2 — de trigger bijstellen");
    expect(items[0].regels.map((r) => r.label)).toEqual(["Stap 1", "Stap 2", "Controle"]);
    const uit = bouwOpties(items[0].regels, []);
    expect(uit.stappen).toHaveLength(2);
    expect(uit.controle).toMatch(/^Jarvis meet/);
  });
  it("hangt losse stappen aan een gewoon punt ervoor en maakt van een controle nooit een actie", () => {
    const tekst = "## Wat de eigenaar nog moet doen\n\n- Pull request #17 opnieuw goedkeuren.\n- Stap 1: open de PR.\n- Controle: de poort wordt groen.\n- Kies een naam voor het project.\n";
    const items = leesItemsOnder(tekst, /^## Wat de eigenaar nog moet doen\s*$/m);
    expect(items.map((i) => i.titel)).toEqual(["Pull request #17 opnieuw goedkeuren.", "Kies een naam voor het project."]);
    expect(items[0].regels.map((r) => r.label)).toEqual(["Stap 1", "Controle"]);
  });

  // CON-0016 regel 0: een controle is de meting die Jarvis zelf doet. Stond er
  // een lege regel tussen de stappen en de controle, dan was het lopende punt
  // al gesloten en werd de controle zelf een handeling voor de eigenaar — met
  // zijn eigen tekst als titel, in "Voor jou" en in de regie als "wacht op jou".
  it("maakt van een losgeraakte controle geen eigen handeling, ook niet na een lege regel", () => {
    const tekst =
      "## Wat de eigenaar nog moet doen\n\n" +
      "**Handeling 1 — de sleutel zetten**\n\n" +
      "- Stap 1: zet de sleutel in de app.\n\n" +
      "- Controle: Jarvis meet daarna zelf dat de sleutel er staat.\n";
    const items = leesItemsOnder(tekst, /^## Wat de eigenaar nog moet doen\s*$/m);
    expect(items).toHaveLength(1);
    expect(items[0].titel).toBe("Handeling 1 — de sleutel zetten");
    expect(items[0].regels.map((r) => r.label)).toEqual(["Stap 1", "Controle"]);
  });

  it("maakt van een controle zonder enig punt ervoor helemaal geen handeling", () => {
    const tekst = "## Wat de eigenaar nog moet doen\n\n- Controle: Jarvis meet na de merge dat de poort groen is.\n";
    expect(leesItemsOnder(tekst, /^## Wat de eigenaar nog moet doen\s*$/m)).toEqual([]);
  });

  // De dossiers schrijven het label soms vet, met de dubbele punt binnen de
  // sterretjes. Dat is dezelfde regel en hoort dezelfde grens te krijgen.
  it("herkent '**Stap N:**' en '**Controle:**' met de dubbele punt binnen de sterretjes", () => {
    const tekst =
      "## Wat de eigenaar nog moet doen\n\n" +
      "**Handeling 3 — het recht toekennen**\n\n" +
      "- **Stap 1:** open de instellingen.\n" +
      "- **Controle:** Jarvis meet daarna zelf dat het recht er is.\n";
    const items = leesItemsOnder(tekst, /^## Wat de eigenaar nog moet doen\s*$/m);
    expect(items).toHaveLength(1);
    expect(items[0].titel).toBe("Handeling 3 — het recht toekennen");
    expect(items[0].regels.map((r) => r.label)).toEqual(["Stap 1", "Controle"]);
    expect(items[0].regels[0].tekst).toBe("open de instellingen.");
    const uit = bouwOpties(items[0].regels, []);
    expect(uit.stappen).toHaveLength(1);
    expect(uit.controle).toMatch(/^Jarvis meet/);
  });
});

// ---------------------------------------------------------------------------
// De invariant van "Voor jou"
// ---------------------------------------------------------------------------
//
// "Voor jou" is de actuele minimale actielijst van de eigenaar: ieder item
// vereist op dit moment aantoonbaar een handeling van hem, en iedere handeling
// die op dit moment aantoonbaar van hem vereist is, staat er precies één keer
// in. Het faalpad dat deze tests dichtzetten: de lijst groeide met reeds
// uitgevoerde handelingen en bood hetzelfde akkoord twee keer aan — één keer
// als aan te vinken punt uit het taakdossier (dat geen autorisatie oplevert)
// en één keer als akkoordkaart (die dat wél doet).
describe("de invariant van de eigenaarslijst", () => {
  const SCOPE = "---" + "\n" + "status: actief" + "\n" + "---" + "\n" + "Scope." + "\n";
  const met = (res: string) => ({
    id: "T-20260917-a",
    opdracht: { status: "actief", titel: "Taak", project: "p" },
    resultaat: res,
    tekst: SCOPE,
  });
  const eigenaarslijst = (regels: string) =>
    "## Voortgang" + "\n" + "- [ ] Bouwen" + "\n\n" + "## Wat de eigenaar nog moet doen" + "\n\n" + regels;

  it("laat een afgevinkte handeling verdwijnen: wat gedaan is, wordt niet opnieuw gevraagd", () => {
    const doc = eigenaarslijst("- [x] Zet de sleutel in de kluis.\n- Kies een naam voor het project.\n");
    const items = leesAandacht(project({ taken: [met(doc)] }));
    expect(items.map((i) => i.titel)).toEqual(["Kies een naam voor het project."]);
    expect(isAfgevinkt("[x] Zet de sleutel in de kluis.")).toBe(true);
    expect(isAfgevinkt("Zet de sleutel in de kluis.")).toBe(false);
  });

  it("biedt het akkoord op de taak niet óók als los punt aan, maar precies één keer als akkoordkaart", () => {
    const doc = eigenaarslijst("- Stap 1: geef in de Jarvis-app akkoord op deze taak, zodat de poort kan attesteren.\n");
    const p = project({ taken: [met(doc)] });
    // Geen los punt in de lijst: een vinkje erop levert een antwoord en geen
    // autorisatie, en de poort kan er dus niets mee.
    expect(leesAandacht(p)).toEqual([]);
    // Maar het akkoord valt niet weg: de taak draagt het als akkoordkaart.
    const t = bouwOverzicht([p], NU).projecten[0].taken[0];
    expect([t.akkoord_nodig, t.aan_zet]).toEqual([true, "eigenaar"]);
  });

  it("herkent het akkoordverzoek in gebiedende wijs, en niet elke regel met het woord akkoord", () => {
    expect(isAkkoordVraag("geef in de Jarvis-app akkoord op deze taak")).toBe(true);
    expect(isAkkoordVraag("bij (a) — geef akkoord in de Jarvis-app op deze taak met de reikwijdte \"deploygrens\"")).toBe(true);
    expect(isAkkoordVraag("Akkoord van de eigenaar op deze taak in de Jarvis-app")).toBe(true);
    expect(isAkkoordVraag("Kies tussen (a) een ignoreCommand en (b) niets doen.")).toBe(false);
    expect(isAkkoordVraag("Jarvis verwerkt het akkoord uit de app zelf")).toBe(false);
  });

  it("houdt een gegeven akkoord weg uit de lijst zodra het punt is afgevinkt", () => {
    const doc = eigenaarslijst("- [x] Stap 1: geef in de Jarvis-app akkoord op deze taak.\n");
    const p = project({ taken: [met(doc)] });
    expect(leesAandacht(p)).toEqual([]);
    expect(bouwOverzicht([p], NU).projecten[0].taken[0].akkoord_nodig).toBe(false);
  });

  it("houdt een echte eigenaarskeuze staan, en biedt hem aan als keuze", () => {
    // Dit is de regel die deze verzameling heeft uitgelokt. Vroeger werd hij
    // `actie` met één knop "Gedaan", en bereikten de twee alternatieven uit de
    // tekst de knoppen nooit; de eigenaar heeft de kaart toen met "Gedaan"
    // moeten sluiten voor een keuze die hij al in het gesprek had gegeven.
    const doc = eigenaarslijst("- Stap 1: kies tussen (a) een vercel.json met een ignoreCommand, of (b) niets doen.\n");
    const [item] = leesAandacht(project({ taken: [met(doc)] }));
    expect(item.interactie).toBe("keuze");
    const keuzes = item.opties.map((o) => o.keuze);
    expect(keuzes).toEqual(["optie-a", "optie-b", "later"]);
    // Een keuze is geen handeling: "Gedaan" hoort er niet bij (criterium 3).
    expect(keuzes).not.toContain("gedaan");
    // En elk alternatief draagt zijn eigen gevolg (criterium 2).
    expect(item.opties[0].gevolg).toContain("vercel.json");
    expect(item.opties[1].gevolg).toContain("niets doen");
  });
});

describe("dossiersZonderBekendeStatus", () => {
  const d = (id: string, status: string, titel?: string): TaakDossier => ({
    id,
    opdracht: titel === undefined ? { status } : { status, titel },
    resultaat: null,
  });

  it("noemt de dossiers die stil uit het feitenblok vallen, op id gesorteerd", () => {
    const uit = dossiersZonderBekendeStatus([
      d("T-b", "gepland", "Later"),
      d("T-a", "open", "Onbekend woord"),
      { id: "T-c", opdracht: {}, resultaat: null },
    ]);
    expect(uit).toEqual([
      { id: "T-a", titel: "Onbekend woord", status: "open" },
      { id: "T-b", titel: "Later", status: "gepland" },
      { id: "T-c", titel: "T-c", status: "onbekend" },
    ]);
  });

  it("zwijgt over de statussen die de engine wél kent", () => {
    expect(
      dossiersZonderBekendeStatus([d("T-a", "actief"), d("T-b", "review"), d("T-c", "afgerond")]),
    ).toEqual([]);

  });
});
