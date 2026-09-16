// Jarvis-kern — het gegenereerde feitenblok in CURRENT_STATE.
//
// Het faalpad dat dit dichtzet: een statusdocument dat achterloopt maar wél
// vertrouwd wordt. Alles wat de repository zelf kan weten wordt gegenereerd en
// in CI vergeleken; handmatig driften kan daardoor niet meer.
import { describe, expect, it } from "vitest";
import {
  blokIsActueel,
  FEITEN_EIND,
  FEITEN_START,
  genereerFeitenblok,
  leesFeitenblok,
  nieuwStateDocument,
  vervangFeitenblok,
  type StateFeiten,
} from "@/jarvis/src/state";

const FEITEN: StateFeiten = {
  gegenereerdOp: "2026-09-10",
  hoofdbranch: "main",
  hoofdbranchCommit: "a225bd8",
  hoofdbranchDatum: "2026-09-09",
  hoogsteMigratie: "0011_review_flow.sql",
  aantalTestbestanden: 74,
  recordTellingen: { DEC: 20, CON: 5, LRN: 3, RSK: 7, CFL: 1 },
  openConflicten: ["CFL-0001"],
  openTaken: [{ id: "T-0001", titel: "Eerste taak", status: "actief" }],
  actieveBranches: ["feature/review-flow"],
};

describe("genereerFeitenblok", () => {
  it("staat tussen de markeringen", () => {
    const blok = genereerFeitenblok(FEITEN);
    expect(blok.startsWith(FEITEN_START)).toBe(true);
    expect(blok.trimEnd().endsWith(FEITEN_EIND)).toBe(true);
  });

  it("bevat de afleidbare feiten, maar niet de commit van de hoofdbranch (die verandert bij elke merge)", () => {
    const blok = genereerFeitenblok(FEITEN);
    expect(blok).toContain("| Hoofdbranch | `main` |");
    expect(blok).not.toContain("a225bd8");
    expect(blok).toContain("0011_review_flow.sql");
    expect(blok).toContain("DEC 20");
    expect(blok).toContain("CFL-0001");
    expect(blok).toContain("T-0001");
  });

  it("houdt de tabel heel als een taaktitel een pijp bevat", () => {
    const blok = genereerFeitenblok({
      ...FEITEN,
      openTaken: [{ id: "T-0001", titel: "Import | export", status: "actief" }],
    });
    const rij = blok.split("\n").find((r) => r.includes("T-0001"))!;
    expect(rij).toBe("| T-0001 | actief | Import \\| export |");
  });

  it("houdt de tabel ook heel als er al een backslash vóór de pijp staat", () => {
    const blok = genereerFeitenblok({
      ...FEITEN,
      openTaken: [{ id: "T-0001", titel: "Import \\| export", status: "actief" }],
    });
    const rij = blok.split("\n").find((r) => r.includes("T-0001"))!;
    // De backslash uit het dossier wordt zelf ontsnapt, zodat de pijp
    // beschermd blijft: vier cellen, niet vijf.
    expect(rij).toBe("| T-0001 | actief | Import \\\\\\| export |");
    expect(rij.split(/(?<!\\)\|/)).toHaveLength(5);
  });

  it("houdt een ontsnapte markering uit een dossier onderscheidbaar van een echte", () => {
    const echt = genereerFeitenblok({
      ...FEITEN,
      openTaken: [{ id: "T-0001", titel: "Markering <!-- erin", status: "actief" }],
    });
    const alOntsnapt = genereerFeitenblok({
      ...FEITEN,
      openTaken: [{ id: "T-0001", titel: "Markering &lt;!-- erin", status: "actief" }],
    });
    expect(echt).toContain("Markering &lt;!-- erin");
    expect(alOntsnapt).toContain("Markering &amp;lt;!-- erin");
    expect(echt).not.toBe(alOntsnapt);
  });

  it("laat een taaktitel het blok niet van binnenuit sluiten", () => {
    const blok = genereerFeitenblok({
      ...FEITEN,
      openTaken: [{ id: "T-0001", titel: `Markering ${FEITEN_EIND} erin`, status: "actief" }],
    });
    // Precies één eindmarkering, en die staat aan het eind.
    expect(blok.split(FEITEN_EIND)).toHaveLength(2);
    expect(blok.trimEnd().endsWith(FEITEN_EIND)).toBe(true);
    // Zonder ontsnapping kapt `leesFeitenblok` het blok af op de eerste
    // eindmarkering, dus de titel zou de helft van het blok opeten.
    expect(leesFeitenblok(`# Titel\n\n${blok}\n\n## Narratief\nBlijft staan.\n`)).toBe(blok);
  });

  it("vouwt regeleindes in een taaktitel op tot spaties, zodat de rij één regel blijft", () => {
    const blok = genereerFeitenblok({
      ...FEITEN,
      openTaken: [{ id: "T-0001", titel: "Eerste regel\nTweede regel", status: "actief" }],
    });
    expect(blok).toContain("| T-0001 | actief | Eerste regel Tweede regel |");
  });

  it("waarschuwt in het blok zelf tegen handmatig bewerken", () => {
    expect(genereerFeitenblok(FEITEN)).toContain("gegenereerd");
  });

  it("is deterministisch bij gelijke feiten", () => {
    expect(genereerFeitenblok(FEITEN)).toBe(genereerFeitenblok(FEITEN));
  });

  it("meldt onbekende waarden expliciet in plaats van ze weg te laten", () => {
    const blok = genereerFeitenblok({ ...FEITEN, hoogsteMigratie: null, aantalTestbestanden: null });
    expect(blok).toContain("onbekend");
  });
});

describe("vervangFeitenblok", () => {
  it("vervangt een bestaand blok en laat de rest ongemoeid", () => {
    const document = `# Titel\n\n${genereerFeitenblok(FEITEN)}\n\n## Narratief\nDit blijft staan.\n`;
    const nieuw = genereerFeitenblok({ ...FEITEN, hoogsteMigratie: "0012_iets.sql" });
    const resultaat = vervangFeitenblok(document, nieuw);
    if (!resultaat.ok) throw new Error(resultaat.boodschap);
    expect(resultaat.tekst).toContain("0012_iets.sql");
    expect(resultaat.tekst).not.toContain("0011_review_flow.sql");
    expect(resultaat.tekst).toContain("Dit blijft staan.");
  });

  it("voegt het blok bovenaan in wanneer het nog niet bestaat", () => {
    const resultaat = vervangFeitenblok("# Titel\n\n## Narratief\ntekst\n", genereerFeitenblok(FEITEN));
    if (!resultaat.ok) throw new Error(resultaat.boodschap);
    const indexBlok = resultaat.tekst.indexOf(FEITEN_START);
    const indexNarratief = resultaat.tekst.indexOf("## Narratief");
    expect(indexBlok).toBeGreaterThan(-1);
    expect(indexBlok).toBeLessThan(indexNarratief);
  });

  it("meldt gewijzigd: false wanneer er niets verandert", () => {
    const blok = genereerFeitenblok(FEITEN);
    const document = `# Titel\n\n${blok}\n`;
    const resultaat = vervangFeitenblok(document, blok);
    if (!resultaat.ok) throw new Error(resultaat.boodschap);
    expect(resultaat.gewijzigd).toBe(false);
  });

  it("weigert een document met een halve markering", () => {
    const resultaat = vervangFeitenblok(`# T\n${FEITEN_START}\nzonder eind\n`, genereerFeitenblok(FEITEN));
    expect(resultaat.ok).toBe(false);
  });
});

describe("leesFeitenblok en blokIsActueel", () => {
  it("haalt het blok terug uit een document", () => {
    const blok = genereerFeitenblok(FEITEN);
    expect(leesFeitenblok(`# T\n\n${blok}\n\ntekst`)).toBe(blok);
  });

  it("geeft null wanneer er geen blok is", () => {
    expect(leesFeitenblok("# Alleen tekst")).toBeNull();
  });

  it("negeert de generatiedatum bij de vergelijking", () => {
    const a = genereerFeitenblok(FEITEN);
    const b = genereerFeitenblok({ ...FEITEN, gegenereerdOp: "2026-12-31" });
    expect(blokIsActueel(a, b)).toBe(true);
  });

  it("ziet een echte feitelijke wijziging wel", () => {
    const a = genereerFeitenblok(FEITEN);
    const b = genereerFeitenblok({ ...FEITEN, hoogsteMigratie: "0012_iets.sql" });
    expect(blokIsActueel(a, b)).toBe(false);
  });

  it("ziet een handmatig gemanipuleerd blok", () => {
    const a = genereerFeitenblok(FEITEN);
    const gemanipuleerd = a.replace("0011_review_flow.sql", "0099_verzonnen.sql");
    expect(blokIsActueel(gemanipuleerd, a)).toBe(false);
  });
  it("telt een ouder blok met de commit in de Hoofdbranch-regel als actueel", () => {
    const a = genereerFeitenblok(FEITEN);
    const oud = a.replace("| Hoofdbranch | `main` |", "| Hoofdbranch | `main` op `a225bd8` (2026-09-09) |");
    expect(blokIsActueel(oud, a)).toBe(true);
  });
});

describe("nieuwStateDocument", () => {
  it("bevat het feitenblok plus de vaste narratieve secties", () => {
    const document = nieuwStateDocument("proj", genereerFeitenblok(FEITEN));
    expect(document).toContain(FEITEN_START);
    for (const kop of ["Waar staan we", "Wat draait er in productie", "Wat is geblokkeerd", "Volgende stap"]) {
      expect(document).toContain(kop);
    }
  });

  it("levert een document waaruit het blok weer leesbaar is", () => {
    const blok = genereerFeitenblok(FEITEN);
    expect(leesFeitenblok(nieuwStateDocument("proj", blok))).toBe(blok);
  });
});
