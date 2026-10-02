/**
 * Eén waarheid over "wie is aan zet", en de database hoort erbij.
 *
 * Het defect dat deze tests vastleggen, meldde de eigenaar op 2026-10-02. Eén
 * taak toonde tegelijk:
 *
 *   - status **WACHT OP JOU**;
 *   - "Wie en waar": *de eigenaar is aan zet: Eigenaar: één herbevestiging van
 *     het akkoord op deze taak*;
 *   - "Bij jou uit deze taak": **Niets — Jarvis is aan zet**;
 *   - het centrale "Voor jou": **niets voor jou**.
 *
 * Hij kon de gevraagde herbevestiging dus nergens geven. De oorzaak was één
 * waarheid die op twee plaatsen werd berekend: `leesTaken` leidde
 * `akkoord_nodig` uitsluitend uit de tekst van het dossier af, terwijl de
 * akkoordkaart in de interface óók in `jarvis.autorisaties` keek en daardoor
 * verdween zodra het akkoord er lag. De vraag bleef staan, het antwoord was al
 * gegeven, en de knop was weg.
 *
 * De reparatie: `leesTaken` krijgt de gemeten akkoordstand mee en past dezelfde
 * toets toe. De interface leest wat de bouw zegt, corrigeert alleen nog het
 * venster tussen een vers akkoord en de volgende bouw, en mag daarbij alleen
 * afzwakken — nooit een vraag toevoegen die de bouw niet stelde.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scopeHash } from "../../jarvis/src/attestatie";
import { bouwOverzicht, leesTaken, type Akkoordstand, type AandachtItem, type ProjectInvoer, type TaakDossier } from "../../jarvis/src/overzicht";
import { bepaalRegie } from "../../jarvis/src/regie";
import { leesTaakakkoorden } from "../../jarvis/src/opdrachten";
import { PAGINA, uitPagina } from "./paginafuncties";

const NU = new Date("2026-10-02T16:00:00Z");
const SCOPE = "---\nid: T-1\n---\n\nde opdracht zoals de eigenaar haar goedkeurde\n";

/**
 * Een actief dossier waarvan de eigenaarslijst om het akkoord vraagt — precies
 * de vorm die `isAkkoordVraag` herkent, en dus de vorm die de taak op "wacht op
 * jou" zette.
 */
function dossier(vraagtAkkoord: boolean): TaakDossier {
  const eigenaar = vraagtAkkoord
    ? "\n## Wat de eigenaar nog moet doen\n\n- Stap 4: **Eén keer je akkoord op deze taak herbevestigen in de Jarvis-app.**\n"
    : "";
  return {
    id: "T-1",
    opdracht: { status: "actief", titel: "Technische uitvoering", project: "jarvis", klasse: "L" },
    resultaat: `# Resultaat\n\n## Voortgang\n\n- [x] Begonnen\n- [ ] Bouwen\n${eigenaar}`,
    tekst: SCOPE,
  } as unknown as TaakDossier;
}

function project(taken: readonly TaakDossier[]): ProjectInvoer {
  return {
    id: "jarvis",
    naam: "Jarvis",
    aangesloten: true,
    hoofdbranch: { naam: "main", commit: "abc1234", datum: "2026-10-02" },
    statusDocument: "# CURRENT_STATE\n\n## Waar staan we\n\nIets.\n",
    records: [],
    taken,
    // Eén verse commit op de taak, zodat `stil` niet aanslaat: een taak zonder
    // beweging leest als STIL en dan zegt de statusregel niet wie aan zet is.
    gitLog: [{ hash: "abc1234def", datum: "2026-10-02T15:00:00Z", onderwerp: "Developer: iets", body: "Jarvis-Role: developer\nJarvis-Task: T-1\n" }],
  };
}

/**
 * Hetzelfde dossier, maar met naast de akkoordvraag een handeling die
 * werkelijk alleen de eigenaar kan doen. Beide staan onder dezelfde kop, want
 * dat is hoe het in de praktijk gaat — en het is het enige geval waarin de
 * vangrail `heeftEigenPunten` het verschil maakt.
 */
const dossierMetPunt = {
  ...dossier(true),
  // Twee losse punten, en met opzet niet als "Stap N:" geschreven: die vorm
  // voegt `leesItemsOnder` samen tot deelstappen van één handeling, en dan is
  // er maar één punt met één titel.
  resultaat:
    "# Resultaat\n\n## Voortgang\n\n- [x] Begonnen\n- [ ] Bouwen\n\n## Wat de eigenaar nog moet doen\n\n" +
    "- **Geef in de Jarvis-app akkoord op deze taak.**\n" +
    "- **Maak een Vercel-token aan en sla het op als repository-secret.**\n" +
    "  Een token bestaat alleen als een mens hem aanmaakt.\n",
} as unknown as TaakDossier;

const stand = (hash: string | null): Akkoordstand => new Map(hash === null ? [] : [["T-1", hash]]);

describe("de akkoordstand telt mee in wie aan zet is", () => {
  it("vraagt het akkoord zolang de stand niet is gemeten", () => {
    const [t] = leesTaken([dossier(true)], "jarvis", [], [], NU, null);
    expect(t.akkoord_gemeten).toBe(false);
    expect(t.akkoord_nodig).toBe(true);
    expect(t.aan_zet).toBe("eigenaar");
  });

  it("vraagt het akkoord wanneer de stand is gemeten en er geen akkoord ligt", () => {
    const [t] = leesTaken([dossier(true)], "jarvis", [], [], NU, stand(null));
    expect(t.akkoord_gemeten).toBe(true);
    expect(t.akkoord_nodig).toBe(true);
    expect(t.aan_zet).toBe("eigenaar");
  });

  it("vraagt het akkoord niet meer zodra het op precies deze scope ligt", () => {
    const [t] = leesTaken([dossier(true)], "jarvis", [], [], NU, stand(scopeHash(SCOPE)));
    expect(t.scope_hash).toBe(scopeHash(SCOPE));
    expect(t.akkoord_nodig).toBe(false);
    expect(t.aan_zet).toBe("jarvis");
  });

  it("vraagt het akkoord wél opnieuw wanneer de scope sinds het akkoord veranderde", () => {
    const [t] = leesTaken([dossier(true)], "jarvis", [], [], NU, stand(scopeHash("een oudere opdracht\n")));
    expect(t.akkoord_nodig).toBe(true);
    expect(t.aan_zet).toBe("eigenaar");
  });

  it("laat een geldig akkoord een echt punt uit de eigenaarslijst niet wegpoetsen", () => {
    const punt = {
      id: "jarvis:T-1:token",
      project: "jarvis",
      soort: "actie",
      titel: "Maak een Vercel-token aan",
      toelichting: "Alleen jij kunt dit.",
      bron: "tasks/T-1/resultaat.md",
      urgentie: "hoog",
    } as unknown as AandachtItem;
    const [t] = leesTaken([dossier(true)], "jarvis", [], [punt], NU, stand(scopeHash(SCOPE)));
    expect(t.akkoord_nodig).toBe(false);
    expect(t.aan_zet).toBe("eigenaar");
    expect(t.wacht_op).toBe("Maak een Vercel-token aan");
  });

  it("draagt de stand door de hele bouw heen, niet alleen door leesTaken", () => {
    const o = bouwOverzicht([project([dossier(true)])], NU, "jarvis", stand(scopeHash(SCOPE)));
    const t = o.projecten[0]!.taken[0]!;
    expect(t.akkoord_nodig).toBe(false);
    expect(t.aan_zet).toBe("jarvis");
  });

  it("haalt de taak uit WAITING_FOR_USER zodra het akkoord er ligt", () => {
    const metAkkoord = bouwOverzicht([project([dossier(true)])], NU, "jarvis", stand(scopeHash(SCOPE)));
    const zonder = bouwOverzicht([project([dossier(true)])], NU, "jarvis", stand(null));
    const regie = (o: ReturnType<typeof bouwOverzicht>) =>
      bepaalRegie(o, [], NU).taken.find((r) => r.id === "T-1");
    expect(regie(zonder)?.toestand).toBe("WAITING_FOR_USER");
    expect(regie(metAkkoord)?.toestand).not.toBe("WAITING_FOR_USER");
  });
});

// ---------------------------------------------------------------------------
// De interface: dezelfde waarheid, één keer berekend
// ---------------------------------------------------------------------------

describe("zetVan — de interface spreekt de bouw niet tegen", () => {
  const zetVan = uitPagina(["zetVan"], null)["zetVan"] as (t: Record<string, unknown>) => string;

  it("laat alles wat niet op de eigenaar staat ongemoeid", () => {
    for (const z of ["jarvis", "wacht", "niemand"]) {
      expect(zetVan({ aan_zet: z, akkoord_nodig: true, akkoord_open: false, eigen_punten: false })).toBe(z);
    }
  });

  it("zwakt af zodra het gevraagde akkoord er blijkt te liggen", () => {
    expect(zetVan({ aan_zet: "eigenaar", akkoord_nodig: true, akkoord_open: false, eigen_punten: false })).toBe("jarvis");
  });

  it("houdt de eigenaar aan zet zolang de kaart het akkoord nog vraagt", () => {
    expect(zetVan({ aan_zet: "eigenaar", akkoord_nodig: true, akkoord_open: true, eigen_punten: false })).toBe("eigenaar");
  });

  it("houdt de eigenaar aan zet bij een echt punt uit zijn lijst", () => {
    expect(zetVan({ aan_zet: "eigenaar", akkoord_nodig: true, akkoord_open: false, eigen_punten: true })).toBe("eigenaar");
  });

  it("zwakt nooit af wanneer de eigenaar om een andere reden dan het akkoord aan zet is", () => {
    expect(zetVan({ aan_zet: "eigenaar", akkoord_nodig: false, akkoord_open: false, eigen_punten: false })).toBe("eigenaar");
  });

  it("scherpt nooit aan: een taak die niet op de eigenaar staat, komt er niet op", () => {
    expect(zetVan({ aan_zet: "jarvis", akkoord_nodig: true, akkoord_open: true, eigen_punten: true })).toBe("jarvis");
  });
});

describe("akkoordNodig — de kaart en de status stellen dezelfde vraag", () => {
  /** De echte `akkoordNodig` uit de pagina, met één autorisatie in `staat`. */
  const maak = (laatste: { scope_hash: string } | null) =>
    uitPagina(["sluitDossier", "akkoordVan", "akkoordNodig"], {
      autorisaties: laatste === null ? [] : [{ soort: "taak", taak: "T-1", scope_hash: laatste.scope_hash, op: "2026-10-02T07:49:22Z" }],
    })["akkoordNodig"] as (t: Record<string, unknown>) => boolean;

  const taak = { id: "T-1", status: "actief", scope: SCOPE, scope_hash: scopeHash(SCOPE), akkoord_nodig: true, stappen: [] };

  it("toont de kaart zolang er geen akkoord ligt", () => {
    expect(maak(null)(taak)).toBe(true);
  });
  it("haalt de kaart weg zodra er een geldig akkoord ligt", () => {
    expect(maak({ scope_hash: scopeHash(SCOPE) })(taak)).toBe(false);
  });
  it("telt een akkoord op een oudere scope niet", () => {
    expect(maak({ scope_hash: "een andere scope" })(taak)).toBe(true);
  });
  it("vraagt niets wanneer de bouw niets vraagt", () => {
    expect(maak(null)({ ...taak, akkoord_nodig: false })).toBe(false);
  });
  it("vraagt niets voor een gesloten dossier", () => {
    for (const status of ["afgerond", "vervallen"]) expect(maak(null)({ ...taak, status })).toBe(false);
  });
  it("vraagt niets voor een taak zonder scope", () => {
    expect(maak(null)({ ...taak, scope: null, scope_hash: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// De bedrading, niet alleen de onderdelen
// ---------------------------------------------------------------------------
//
// QA-ronde 1 op deze branch keurde af met één blokkerende bevinding: zeven
// sabotages op het productiepad lieten alle 989 tests slagen. De suite toetste
// de pure functies en niet de verbindingen ertussen — en juist in zo'n
// verbinding zat het defect dat de eigenaar meldde. Wat hieronder staat dekt
// die zeven af.


describe("leesTaakakkoorden — faalt dicht, niet open", () => {
  it("geeft een lege map zonder taken, zonder de database aan te raken", async () => {
    let geroepen = false;
    const uit = await leesTaakakkoorden([], async () => { geroepen = true; return null; });
    expect(uit).toEqual(new Map());
    expect(geroepen).toBe(false);
  });

  it("geeft null — niet een lege map — wanneer er geen verbinding is", async () => {
    expect(await leesTaakakkoorden(["T-1"], async () => null)).toBeNull();
  });

  it("geeft null wanneer het opzetten van de verbinding zelf werpt", async () => {
    expect(await leesTaakakkoorden(["T-1"], async () => { throw new Error("geen weg naar de database"); })).toBeNull();
  });

  it("geeft null wanneer de bevraging werpt, en sluit de verbinding alsnog", async () => {
    let gesloten = false;
    const sql = { unsafe: async () => { throw new Error("stuk"); }, end: async () => { gesloten = true; } };
    expect(await leesTaakakkoorden(["T-1"], async () => ({ sql, bron: "test" }) as never)).toBeNull();
    expect(gesloten).toBe(true);
  });

  it("geeft per taak de scope_hash van haar laatste akkoord, en vraagt elke taak één keer", async () => {
    const gevraagd: string[] = [];
    const rijen: Record<string, unknown[]> = {
      "T-1": [{ scope_hash: "aaa" }],
      "T-2": [],
      "T-3": [{ scope_hash: "" }],
    };
    const sql = {
      unsafe: async (_sql: string, params: readonly string[]) => {
        gevraagd.push(params[0]!);
        return rijen[params[0]!] ?? [];
      },
      end: async () => {},
    };
    const uit = await leesTaakakkoorden(["T-1", "T-2", "T-3", "T-1"], async () => ({ sql, bron: "test" }) as never);
    expect(uit).toEqual(new Map([["T-1", "aaa"]]));
    expect(gevraagd).toEqual(["T-1", "T-2", "T-3"]);
  });
});

describe("de doorgifte in bouwOverzichtVanuit", () => {
  // Dit is bewust een test op de brontekst, en wel om de reden die de pure
  // tests hierboven juist niet dekken: `bouwOverzichtVanuit` leest de
  // werkmap, git en de configuratie, dus zij valt niet uit te voeren. De
  // sabotage die ongemerkt doorkwam was `bouwOverzicht(projecten, nu, kernId,
  // null)` — de hele reparatie dood, geen enkele test die protesteert. Op de
  // vorm van die ene aanroep valt dat wél vast te leggen.
  const bron = readFileSync(path.join(process.cwd(), "jarvis/src/opdrachten.ts"), "utf8");

  it("leest de akkoordstand en geeft hem door aan bouwOverzicht", () => {
    const aanroep = /bouwOverzicht\(([^)]*)\)/.exec(bron);
    expect(aanroep, "de aanroep van bouwOverzicht is niet gevonden").not.toBeNull();
    const argumenten = aanroep![1]!.split(",").map((a) => a.trim());
    expect(argumenten.length, "bouwOverzicht krijgt de akkoordstand niet mee").toBe(4);
    expect(argumenten[3], "het vierde argument is geen variabele maar een vaste waarde").toBe("akkoorden");
    expect(bron).toMatch(/const akkoorden = await leesTaakakkoorden\(/);
  });

  it("vraagt de stand alleen voor taken die nog open zijn", () => {
    expect(bron).toMatch(/leesTaakakkoorden\(\s*\n?\s*projecten\.flatMap\(\(p\) => p\.taken\.filter\(\(t\) => !sluitDossier\(/);
  });
});

describe("de pagina: één ijking, en alle vier de plaatsen lezen haar", () => {
  it("roept ijkZetten aan vóór er iets getekend wordt", () => {
    const render = /\nfunction render\(\) \{([\s\S]*?)\n\}/.exec(PAGINA);
    expect(render, "render is niet gevonden").not.toBeNull();
    const regels = render![1]!.split("\n").map((r) => r.trim()).filter((r) => r.length > 0);
    const ijk = regels.findIndex((r) => r.startsWith("ijkZetten()"));
    const teken = regels.findIndex((r) => r.includes("tekenKaart()"));
    expect(ijk, "render ijkt de taken niet; akkoord_open en eigen_punten blijven undefined").toBeGreaterThanOrEqual(0);
    expect(ijk).toBeLessThan(teken);
  });

  /**
   * Eén wereld, en daarna de vier plaatsen uit de melding van de eigenaar
   * naast elkaar: de statusregel, het blok "Wie en waar", de lijst "Bij jou
   * uit deze taak" en het centrale "Voor jou".
   */
  function wereld(
    akkoorden: Akkoordstand | null,
    autorisaties: readonly { soort: string; taak: string; scope_hash: string; op: string }[],
    dos: TaakDossier = dossier(true),
  ) {
    const o = bouwOverzicht([project([dos])], NU, "jarvis", akkoorden);
    const staat = {
      overzicht: o,
      regie: bepaalRegie(o, [], NU),
      autorisaties,
      antwoorden: new Map(),
      berichten: [],
      concept: new Map(),
    };
    const f = uitPagina(
      ["esc", "md", "inlineMd", "MAANDEN", "datumKort", "tijd", "relatief", "RECENT_DAGEN", "WACHT_WOORD",
       "TOESTAND_TEKST", "ROLNAAM", "SOORT", "URG", "isOpen", "heeftEigenPunten", "zetVan", "zetTekst",
       "regieVan", "sluitDossier", "akkoordVan", "akkoordNodig", "akkoordHtml", "lijstRegel", "taakHtml",
       "ijkZetten", "verzamelActies"],
      staat,
    );
    f.ijkZetten!();
    const t = o.projecten[0]!.taken[0]!;
    const knoop = { taak: t, project: o.projecten[0]!, kinderen: (o.voor_jou ?? []).filter((a) => a.bron.startsWith("tasks/T-1/")).map((a) => ({ item: a })) };
    const acties = f.verzamelActies!() as { nu: readonly unknown[] };
    return { html: f.taakHtml!(knoop) as string, voorJou: acties.nu.length, taak: t };
  }

  const akkoordRij = (hash: string) => [{ soort: "taak", taak: "T-1", scope_hash: hash, op: "2026-10-02T07:49:22Z" }];

  it("A — geen akkoord: alle vier zeggen dat het bij de eigenaar ligt", () => {
    const w = wereld(new Map(), []);
    expect(w.html).toContain("WACHT OP JOU");
    expect(w.html).toContain("wacht op jou");
    expect(w.html).toContain("Je akkoord hierboven is wat deze taak van je vraagt.");
    expect(w.html).not.toContain("Jarvis is aan zet.");
    expect(w.voorJou).toBe(1);
  });

  it("B — akkoord gemeten en geldig: alle vier zeggen dat Jarvis aan zet is", () => {
    const hash = scopeHash(SCOPE);
    const w = wereld(new Map([["T-1", hash]]), akkoordRij(hash));
    expect(w.html).toContain("JARVIS AAN ZET");
    expect(w.html).not.toContain("WACHT OP JOU");
    expect(w.html).toContain("Jarvis is aan zet.");
    expect(w.voorJou).toBe(0);
  });

  it("C — akkoord net gegeven, de bouw nog niet bij: geen tegenspraak, en de pagina zegt waarom", () => {
    const hash = scopeHash(SCOPE);
    const w = wereld(null, akkoordRij(hash));
    expect(w.taak.akkoord_nodig, "de bouw vraagt het akkoord nog").toBe(true);
    expect(w.taak.akkoord_gemeten, "de bouw kon de akkoorden niet lezen").toBe(false);
    expect(w.html, "de statusregel mag niet meer op de eigenaar staan").not.toContain("WACHT OP JOU");
    expect(w.html).toContain("JARVIS AAN ZET");
    expect(w.html).toContain("Jarvis is aan zet.");
    expect(w.html).toContain("die bouw kon de akkoorden niet lezen");
    expect(w.voorJou).toBe(0);
  });

  it("D — akkoord op een oudere scope: terug naar de vraag", () => {
    const w = wereld(new Map([["T-1", "oud"]]), akkoordRij("oud"));
    expect(w.html).toContain("WACHT OP JOU");
    expect(w.voorJou).toBe(1);
  });

  it("F — geldig akkoord én een echt eigenaarspunt: de eigenaar blijft aan zet, met het punt erbij", () => {
    const hash = scopeHash(SCOPE);
    // Hetzelfde dossier, maar met een handeling die werkelijk alleen de
    // eigenaar kan doen. Een geldig akkoord mag die niet wegpoetsen.
    const w = wereld(new Map([["T-1", hash]]), akkoordRij(hash), dossierMetPunt);
    expect(w.taak.akkoord_nodig, "het akkoord zelf wordt niet meer gevraagd").toBe(false);
    expect(w.html, "de statusregel hoort bij de eigenaar te blijven").toContain("WACHT OP JOU");
    expect(w.html).toContain("Vercel-token");
    expect(w.html).not.toContain("<strong>Niets</strong>");
    expect(w.voorJou).toBe(1);
  });

  it("G — vers akkoord én een echt eigenaarspunt: de correctielaag zwakt niet af", () => {
    // Het enige geval waarin `heeftEigenPunten` werkelijk het verschil maakt:
    // de bouw vraagt het akkoord nog (zij kon de database niet lezen), het
    // akkoord blijkt er te liggen, en er ligt daarnáást een echte handeling
    // van de eigenaar. Zonder die vangrail zou de taak hier op "Jarvis aan
    // zet" springen en het punt uit beeld raken.
    const w = wereld(null, akkoordRij(scopeHash(SCOPE)), dossierMetPunt);
    expect(w.taak.akkoord_gemeten, "de bouw heeft de akkoorden niet gelezen").toBe(false);
    expect(w.taak.akkoord_nodig, "en vraagt het akkoord dus nog").toBe(true);
    expect(w.html, "maar er ligt een echt punt, dus de eigenaar blijft aan zet").toContain("WACHT OP JOU");
    expect(w.html).toContain("Vercel-token");
    expect(w.voorJou).toBe(1);
  });

  it("de precieze combinatie die de eigenaar meldde, komt nergens meer voor", () => {
    for (const w of [wereld(new Map(), []), wereld(new Map([["T-1", scopeHash(SCOPE)]]), akkoordRij(scopeHash(SCOPE))), wereld(null, akkoordRij(scopeHash(SCOPE)))]) {
      const wachtOpJou = w.html.includes("WACHT OP JOU");
      const nietsVoorJou = w.voorJou === 0 && w.html.includes("<strong>Niets</strong>Jarvis is aan zet.");
      expect(wachtOpJou && nietsVoorJou, "status en lijst spreken elkaar tegen").toBe(false);
    }
  });
});
