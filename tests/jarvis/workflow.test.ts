// De canonieke governance-workflow.
//
// Dit bestand was tot deze commit ruim vierhonderd regels: een eigen YAML-lezer,
// een lijst verboden shellvormen, regexen op de vlaggen, controles per stap. Zes
// QA-rondes lang vond een onafhankelijke beoordelaar er telkens een gat in, en
// elke keer een laag naar buiten. De laatste twee wezen de oorzaak aan:
//
//   - De lezer knipte commentaar af op JavaScript's witruimteklasse, die U+00A0
//     en vijf andere tekens omvat terwijl YAML alleen spatie en tab kent. Een
//     regel met een harde spatie voor het hekje voldeed daardoor aan de
//     gelijkheidstoets en draaide in bash iets anders.
//   - De controle keek naar de stap die Jarvis aanroept. Elke ANDERE stap was
//     vrij, dus een stap ervoor kon met één `sed` de engine aanpassen waarna de
//     poort netjes groen werd.
//
// Om te oordelen of het bestand veilig was, werd het geïnterpreteerd. Daarmee
// was die interpretatie het aanvalsoppervlak, en een interpretatie van een taal
// is nooit af.
//
// Wat er nu staat is één eis: het actieve bestand is byte voor byte gelijk aan
// de goedgekeurde bron. Verder wordt er niets gelezen, niets begrepen en niets
// beoordeeld.
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIEVE_WORKFLOW,
  CANONIEKE_WORKFLOW,
  CANONIEKE_WORKFLOW_CONSUMER,
  GOVERNANCE_CONFIG,
  TOEGESTANE_WORKFLOWS,
  VERPLICHTE_GOVERNANCE_TESTS,
  controleerGovernance,
  vergelijkWorkflow,
  type BestandsFeiten,
  type GovernanceInvoer,
} from "@/jarvis/src/workflow";
import { controleerWorkflow, opdrachtPoort, poortStappen, poortUitkomst } from "@/jarvis/src/opdrachten";

/** Ruwe bytes, zonder encoding: elke omzetting naar tekst is al een interpretatie. */
const ACTIEF = readFileSync(path.join(process.cwd(), ".github/workflows/jarvis-lint.yml"));
const CANONIEK = readFileSync(path.join(process.cwd(), "jarvis/canonical/jarvis-lint.yml"));

describe("de actieve workflow is de goedgekeurde workflow", () => {
  it("is byte voor byte gelijk aan de canonieke bron", () => {
    const uitkomst = vergelijkWorkflow(ACTIEF, CANONIEK);
    expect(uitkomst.gelijk ? "" : uitkomst.reden).toBe("");
  });

  it("heeft dezelfde lengte", () => {
    expect(ACTIEF.length).toBe(CANONIEK.length);
  });
});

describe("elke afwijking is een fout", () => {
  // De mutaties hieronder draaien op een genormaliseerde kopie, en worden
  // vergeleken met diezelfde kopie als bron. Git kan het bestand met CRLF
  // uitchecken, en dan matcht geen enkel patroon met een kale regelafbreking.
  //
  // Dat normaliseren raakt de echte controle niet: die staat hierboven en
  // vergelijkt de twee bestanden zoals ze op schijf staan, zonder enige
  // omzetting. Hier gaat het om de vraag of een wijziging wordt opgemerkt, en
  // die vraag hangt niet van regeleindes af. Een regeleindewijziging staat er
  // trouwens zelf ook als geval tussen.
  const tekst = CANONIEK.toString("utf8").replace(/\r\n/g, "\n");
  const bytes = (s: string) => Buffer.from(s, "utf8");
  const BRON = bytes(tekst);

  // Alles wat een onafhankelijke QA over zes rondes heeft geprobeerd, plus de
  // vormen die de opdrachtgever expliciet noemde. Ze hoeven geen van alle
  // herkend te worden: het zijn andere bytes, en dat is genoeg.
  const wijzigingen: [string, string][] = [
    ["een harde spatie voor een hekje", tekst.replace("poort", "poort #c")],
    ["een zero-width teken", tekst.replace("poort", "poort​")],
    ["een unicode-regelscheider", tekst.replace("\n  push:", "   push:")],
    ["een byte order mark vooraan", `﻿${tekst}`],
    ["een gewoon commentaar erbij", `${tekst}# nog een notitie\n`],
    ["een spatie aan het eind", `${tekst} `],
    ["een tab in plaats van spaties", tekst.replace("    runs-on:", "\truns-on:")],
    ["CRLF in plaats van LF", tekst.replace(/\n/g, "\r\n")],
    [
      "een extra stap ervoor",
      tekst.replace("      - name: Jarvis-poort", "      - run: sed -i s/a/b/ jarvis/src/lint.ts\n      - name: Jarvis-poort"),
    ],
    [
      "een patch-stap die de engine terugzet",
      tekst.replace("      - run: npm ci", "      - run: git checkout origin/main -- jarvis/\n      - run: npm ci"),
    ],
    ["een uses-stap erbij", tekst.replace("      - run: npm ci", "      - uses: iemand/actie@v1\n      - run: npm ci")],
    ["een tweede job", `${tekst}\n  tweede:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hoi\n`],
    [
      "een tweede Jarvis-aanroep",
      tekst.replace("        run: node node_modules", "        run: npx tsx jarvis/src/cli.ts lint\n        run: npx tsx"),
    ],
    ["een andere shell op de stap", tekst.replace("        run: node node_modules", "        shell: bash -e {0}\n        run: npx tsx")],
    [
      "defaults.run.shell op jobniveau",
      tekst.replace("    runs-on: ubuntu-latest", "    runs-on: ubuntu-latest\n    defaults:\n      run:\n        shell: bash"),
    ],
    ["defaults op workflowniveau", tekst.replace("\njobs:", "\ndefaults:\n  run:\n    shell: bash\n\njobs:")],
    ["env op workflowniveau", tekst.replace("\njobs:", "\nenv:\n  REVIEW_RELATIE: OWNER\n\njobs:")],
    [
      "env op jobniveau",
      tekst.replace("    runs-on: ubuntu-latest", "    runs-on: ubuntu-latest\n    env:\n      REVIEW_RELATIE: OWNER"),
    ],
    [
      "een env-waarde op de stap",
      tekst.replace("REVIEW_RELATIE: ${{ github.event.review.author_association }}", "REVIEW_RELATIE: OWNER"),
    ],
    ["REVIEW_BODY uit de PR-tekst", tekst.replace("github.event.review.body", "github.event.pull_request.body")],
    ["REVIEW_ACTOR uit de PR-opener", tekst.replace("github.event.review.user.login", "github.actor")],
    ["schrijfrechten", tekst.replace("  contents: read", "  contents: write")],
    [
      "continue-on-error op de job",
      tekst.replace("    runs-on: ubuntu-latest", "    runs-on: ubuntu-latest\n    continue-on-error: true"),
    ],
    [
      "continue-on-error op de stap",
      tekst.replace("      - name: Jarvis-poort", "      - name: Jarvis-poort\n        continue-on-error: true"),
    ],
    ["een if op de stap", tekst.replace("      - name: Jarvis-poort", "      - name: Jarvis-poort\n        if: false")],
    ["een altijd-onware jobconditie", tekst.replace(/^    if: .*$/m, "    if: ${{ false }}")],
    ["de jobconditie weg", tekst.replace(/^    if: .*\n/m, "")],
    ["een paths-filter onder push", tekst.replace("\n  push:\n", '\n  push:\n    paths: ["jarvis/**"]\n')],
    ["een paths-ignore onder pull_request", tekst.replace("\n  pull_request:\n", '\n  pull_request:\n    paths-ignore: ["docs/**"]\n')],
    ["een ander eventfilter", tekst.replace(", edited]", "]")],
    ["het review-event weg", tekst.replace(/\n  pull_request_review:\n\s*types:.*\n/, "\n")],
    ["een ander branchfilter", tekst.replace('["jarvis/**"]', '["nooit/**"]')],
    ["een andere checkout-ref", tekst.replace("github.event.pull_request.head.sha", "github.sha")],
    ["een shallow clone", tekst.replace("fetch-depth: 0", "fetch-depth: 1")],
    [
      "NODE_OPTIONS erbij",
      tekst.replace("          PR_BASIS:", "          NODE_OPTIONS: --require ./patch.js\n          PR_BASIS:"),
    ],
    ["een vlag aan de aanroep", tekst.replace("jarvis.mjs poort", "jarvis.mjs poort --ack-relatie OWNER")],
    ["een fallback achter de aanroep", tekst.replace("jarvis.mjs poort", "jarvis.mjs poort || true")],
    ["één letter anders", tekst.replace("Jarvis-poort", "Jarvis-Poort")],
    ["één spatie erbij", tekst.replace("runs-on: ubuntu-latest", "runs-on:  ubuntu-latest")],
  ];

  for (const [naam, gewijzigd] of wijzigingen) {
    it(`vangt: ${naam}`, () => {
      expect(gewijzigd, "de wijziging veranderde niets aan het bestand").not.toBe(tekst);
      expect(vergelijkWorkflow(bytes(gewijzigd), BRON).gelijk).toBe(false);
    });
  }

  it("vangt een ontbrekend actief bestand", () => {
    expect(vergelijkWorkflow(null, CANONIEK).gelijk).toBe(false);
  });

  it("vangt een ontbrekende canonieke bron", () => {
    expect(vergelijkWorkflow(ACTIEF, null).gelijk).toBe(false);
  });

  it("wijst het eerste verschil aan met regel en teken", () => {
    const uitkomst = vergelijkWorkflow(bytes(tekst.replace("Jarvis-poort", "Jarvis-Poort")), BRON);
    expect(uitkomst.gelijk).toBe(false);
    if (uitkomst.gelijk) return;
    expect(uitkomst.reden).toMatch(/regel \d+, teken \d+/);
  });

  it("noemt het lengteverschil wanneer het begin gelijk is", () => {
    const uitkomst = vergelijkWorkflow(bytes(`${tekst}extra`), BRON);
    expect(uitkomst.gelijk).toBe(false);
    if (uitkomst.gelijk) return;
    expect(uitkomst.reden).toContain("bytes");
  });

  it("laat een identiek bestand door", () => {
    expect(vergelijkWorkflow(bytes(tekst), BRON).gelijk).toBe(true);
  });
});

describe("de gehardde governancecontrole", () => {
  const WORTEL = "/repo";
  const feiten = (over: Partial<BestandsFeiten> = {}): BestandsFeiten => ({
    bytes: Buffer.from("inhoud"),
    viaSymlink: false,
    echtPad: "/repo/ergens.yml",
    ...over,
  });

  const basis = (over: Partial<GovernanceInvoer> = {}): GovernanceInvoer => ({
    wortelEchtPad: WORTEL,
    actief: feiten({ echtPad: `${WORTEL}/${ACTIEVE_WORKFLOW}` }),
    canoniek: feiten({ echtPad: `${WORTEL}/${CANONIEKE_WORKFLOW}` }),
    workflowMapInhoud: [...TOEGESTANE_WORKFLOWS],
    testGroottes: new Map(VERPLICHTE_GOVERNANCE_TESTS.map((t) => [t, 100])),
    ...over,
  });

  it("keurt de gezonde situatie goed", () => {
    expect(controleerGovernance(basis())).toEqual([]);
  });

  it("blokkeert wanneer de twee bestanden verschillen", () => {
    const uit = controleerGovernance(basis({ actief: feiten({ bytes: Buffer.from("anders"), echtPad: "/repo/a" }) }));
    expect(uit.length).toBeGreaterThan(0);
    expect(uit.join(" ")).toContain("wijkt af");
  });

  it("blokkeert een symbolische link op de canonieke bron", () => {
    // QA liet `jarvis/canonical` naar `.github/workflows` wijzen, waarna het
    // bestand met zichzelf werd vergeleken en alles klopte.
    const uit = controleerGovernance(basis({ canoniek: feiten({ viaSymlink: true }) }));
    expect(uit.join(" ")).toContain("symbolische link");
  });

  it("blokkeert een symbolische link op het actieve bestand", () => {
    expect(controleerGovernance(basis({ actief: feiten({ viaSymlink: true }) })).join(" ")).toContain(
      "symbolische link",
    );
  });

  it("blokkeert wanneer beide paden hetzelfde bestand zijn", () => {
    // Dit was de kern van de bevinding: twee paden naar één bestand vergelijken
    // niets, en de poort meldde vrolijk dat alles gelijk was.
    const zelfde = `${WORTEL}/${CANONIEKE_WORKFLOW}`;
    const uit = controleerGovernance(
      basis({ actief: feiten({ echtPad: zelfde }), canoniek: feiten({ echtPad: zelfde }) }),
    );
    expect(uit.join(" ")).toContain("hetzelfde bestand");
  });

  it("blokkeert een pad dat buiten de repository uitkomt", () => {
    const uit = controleerGovernance(basis({ canoniek: feiten({ echtPad: "/ergens/anders/jarvis-lint.yml" }) }));
    expect(uit.join(" ")).toContain("buiten de repository");
  });

  it("blokkeert een onbekend extra workflowbestand", () => {
    const uit = controleerGovernance(basis({ workflowMapInhoud: [...TOEGESTANE_WORKFLOWS, "jarvis-lint-2.yml"] }));
    expect(uit.join(" ")).toContain("jarvis-lint-2.yml");
  });

  it("blokkeert een tweede workflow die de poort nabootst", () => {
    const uit = controleerGovernance(basis({ workflowMapInhoud: [...TOEGESTANE_WORKFLOWS, "jarvis-lint.yaml"] }));
    expect(uit.join(" ")).toContain("jarvis-lint.yaml");
  });

  it("blokkeert een onleesbare workflowmap", () => {
    expect(controleerGovernance(basis({ workflowMapInhoud: null })).join(" ")).toContain("niet te lezen");
  });

  it("blokkeert een ontbrekend actief bestand", () => {
    expect(controleerGovernance(basis({ actief: feiten({ bytes: null, echtPad: null }) })).length).toBeGreaterThan(0);
  });

  it("blokkeert een verplichte governance-test die ontbreekt", () => {
    // QA verwijderde tests/jarvis/workflow.test.ts en de suite bleef groen op
    // vierenzeventig bestanden. De dekking die een gat moet melden, mag niet
    // zelf stilzwijgend te verwijderen zijn.
    const zonder = new Map(VERPLICHTE_GOVERNANCE_TESTS.map((t) => [t, 100 as number | null]));
    zonder.set("tests/jarvis/workflow.test.ts", null);
    expect(controleerGovernance(basis({ testGroottes: zonder })).join(" ")).toContain("ontbreekt");
  });

  it("blokkeert een verplichte governance-test die is leeggemaakt", () => {
    const leeg = new Map(VERPLICHTE_GOVERNANCE_TESTS.map((t) => [t, 100 as number | null]));
    leeg.set("tests/jarvis/args.test.ts", 0);
    expect(controleerGovernance(basis({ testGroottes: leeg })).join(" ")).toContain("leeg");
  });

  it("eist de verplichte governance-tests niet bij een consumer: die draagt ze niet, de engine draait ze", () => {
    const zonder = new Map(VERPLICHTE_GOVERNANCE_TESTS.map((t) => [t, null as number | null]));
    const uit = controleerGovernance(
      basis({
        modus: "consumer",
        canoniek: feiten({ echtPad: `${WORTEL}/${CANONIEKE_WORKFLOW_CONSUMER}` }),
        testGroottes: zonder,
      }),
    );
    expect(uit).toEqual([]);
  });

  it("noemt bij een consumer de canonieke bron in de geïnstalleerde engine", () => {
    const uit = controleerGovernance(
      basis({
        modus: "consumer",
        canoniek: feiten({ echtPad: `${WORTEL}/${CANONIEKE_WORKFLOW_CONSUMER}`, viaSymlink: true }),
      }),
    );
    expect(uit.join(" ")).toContain(CANONIEKE_WORKFLOW_CONSUMER);
  });

  it("noemt elk van de verplichte testbestanden", () => {
    // Deze lijst is de dekking. Hij hoort niet stilletjes te krimpen.
    expect(VERPLICHTE_GOVERNANCE_TESTS).toContain("tests/jarvis/workflow.test.ts");
    expect(VERPLICHTE_GOVERNANCE_TESTS).toContain("tests/jarvis/args.test.ts");
    expect(VERPLICHTE_GOVERNANCE_TESTS.length).toBeGreaterThanOrEqual(5);
  });

  it("blokkeert een ontbrekende canonieke bron", () => {
    expect(controleerGovernance(basis({ canoniek: feiten({ bytes: null, echtPad: null }) })).length).toBeGreaterThan(0);
  });
});

describe("de paden liggen in code vast", () => {
  it("staan niet in de configuratie", () => {
    // Ze stonden er wel, en QA zette ze allebei op hetzelfde bestand. Deze test
    // valt om zodra iemand ze weer instelbaar maakt.
    const config = readFileSync(path.join(process.cwd(), "jarvis.config.yml"), "utf8");
    expect(config).not.toMatch(/^workflow_pad:/m);
    expect(config).not.toMatch(/^workflow_canoniek_pad:/m);
  });

  it("wijzen naar de bestanden die er werkelijk toe doen", () => {
    expect(ACTIEVE_WORKFLOW).toBe(".github/workflows/jarvis-lint.yml");
    expect(CANONIEKE_WORKFLOW).toBe("jarvis/canonical/jarvis-lint.yml");
    expect(GOVERNANCE_CONFIG).toBe("jarvis.config.yml");
  });
});

describe("de poort roept de workflowcontrole werkelijk aan", () => {
  // Zonder deze twee tests is de controle wel getest maar niet ingebouwd: QA
  // schrapte de aanroep en de hele suite bleef groen.
  const waarden = { basis: "origin/main", tekst: "", ackTekst: "", ackActor: "", ackRelatie: "" };

  it("heeft workflow als eerste stap", () => {
    const namen = poortStappen("/repo", waarden).map((s) => s.naam);
    expect(namen[0]).toBe("workflow");
    expect(namen).toEqual(["workflow", "engine", "rollen", "index", "state", "sanitize", "lint"]);
  });

  it("laat een falende stap de uitkomst bepalen", async () => {
    const uit = await poortUitkomst([
      { naam: "workflow", draai: async () => 1 },
      { naam: "rest", draai: async () => 0 },
    ]);
    expect(uit).toBe(1);
  });

  it("draait alle stappen, ook na een fout", async () => {
    const gedraaid: string[] = [];
    const stap = (naam: string, code: number) => ({
      naam,
      draai: async () => {
        gedraaid.push(naam);
        return code;
      },
    });
    const uit = await poortUitkomst([stap("workflow", 1), stap("index", 0), stap("lint", 2)]);
    expect(gedraaid).toEqual(["workflow", "index", "lint"]);
    expect(uit).toBe(1);
  });

  it("geeft nul wanneer alles slaagt", async () => {
    expect(await poortUitkomst([{ naam: "a", draai: async () => 0 }])).toBe(0);
  });
});

describe("controleerWorkflow geeft werkelijk een foutcode", () => {
  // QA zette `return 1` om naar `return 0` en de suite bleef groen: er was wel
  // getoetst DAT een schending gemeld werd, niet dat de exitcode klopte.
  async function repoMet(wijziging: (map: string) => Promise<void>): Promise<string> {
    const map = await mkdtemp(path.join(tmpdir(), "jarvis-poort-"));
    await mkdir(path.join(map, ".github/workflows"), { recursive: true });
    await mkdir(path.join(map, "jarvis/canonical"), { recursive: true });
    await mkdir(path.join(map, "tests/jarvis"), { recursive: true });
    const workflow = readFileSync(path.join(process.cwd(), "jarvis/canonical/jarvis-lint.yml"));
    // De proefrepository is de engine zelf (package.json noemt de engine), dus
    // de canonieke bron staat in de repository en de verplichte tests horen er.
    await writeFile(path.join(map, "package.json"), JSON.stringify({ name: "jarvis-engine" }));
    await writeFile(path.join(map, ".github/workflows/jarvis-lint.yml"), workflow);
    await writeFile(path.join(map, "jarvis/canonical/jarvis-lint.yml"), workflow);
    for (const naam of TOEGESTANE_WORKFLOWS) {
      if (naam !== "jarvis-lint.yml") await writeFile(path.join(map, ".github/workflows", naam), "op: {}\n");
    }
    for (const testpad of VERPLICHTE_GOVERNANCE_TESTS) {
      await mkdir(path.dirname(path.join(map, testpad)), { recursive: true });
      await writeFile(path.join(map, testpad), "// inhoud\n");
    }
    await wijziging(map);
    return map;
  }

  it("geeft 0 op een gezonde repository", async () => {
    const map = await repoMet(async () => {});
    await expect(controleerWorkflow(map)).resolves.toBe(0);
  });

  it("geeft niet-nul wanneer de workflow afwijkt van de canonieke bron", async () => {
    const map = await repoMet(async (m) => {
      await writeFile(path.join(m, ".github/workflows/jarvis-lint.yml"), "name: iets anders\n");
    });
    await expect(controleerWorkflow(map)).resolves.not.toBe(0);
  });

  it("geeft niet-nul bij een onverwacht extra workflowbestand", async () => {
    const map = await repoMet(async (m) => {
      await writeFile(path.join(m, ".github/workflows/jarvis-lint-2.yml"), "name: jarvis-lint\n");
    });
    await expect(controleerWorkflow(map)).resolves.not.toBe(0);
  });

  it("geeft niet-nul wanneer de canonieke bron ontbreekt", async () => {
    const map = await repoMet(async (m) => {
      await rm(path.join(m, "jarvis/canonical/jarvis-lint.yml"));
    });
    await expect(controleerWorkflow(map)).resolves.not.toBe(0);
  });

  it("geeft niet-nul wanneer een verplichte governance-test ontbreekt", async () => {
    const map = await repoMet(async (m) => {
      await rm(path.join(m, "tests/jarvis/workflow.test.ts"));
    });
    await expect(controleerWorkflow(map)).resolves.not.toBe(0);
  });

  it("geeft niet-nul wanneer een verplichte governance-test is leeggemaakt", async () => {
    const map = await repoMet(async (m) => {
      await writeFile(path.join(m, "tests/jarvis/args.test.ts"), "");
    });
    await expect(controleerWorkflow(map)).resolves.not.toBe(0);
  });
});

describe("opdrachtPoort draait de stappen werkelijk", () => {
  // Hier stond een test die opdrachtPoort op een lege map losliet. Die was
  // groen om de verkeerde reden: de wortelparameter bereikte alleen de
  // workflowstap, en de lintstap faalt in deze repository sowieso, dus de test
  // slaagde ook met de workflowcontrole hardgezet op nul.
  //
  // Wat er nu staat toetst twee dingen los van elkaar, allebei betrouwbaar: dat
  // opdrachtPoort de stappen werkelijk draait en hun uitkomst teruggeeft, en dat
  // de echte stappenlijst met de workflowcontrole begint.

  it("draait de stappen en geeft hun uitkomst terug", async () => {
    // Valt om zodra iemand `return 0` bovenin opdrachtPoort zet.
    const uit = await opdrachtPoort(() => [{ naam: "verzonnen", draai: async () => 7 }]);
    expect(uit).toBe(7);
  });

  it("geeft nul wanneer elke stap nul geeft", async () => {
    expect(await opdrachtPoort(() => [{ naam: "a", draai: async () => 0 }])).toBe(0);
  });

  it("draait alle stappen, ook na een fout", async () => {
    const gedraaid: string[] = [];
    const uit = await opdrachtPoort(() => [
      { naam: "een", draai: async () => (gedraaid.push("een"), 1) },
      { naam: "twee", draai: async () => (gedraaid.push("twee"), 0) },
    ]);
    expect(gedraaid).toEqual(["een", "twee"]);
    expect(uit).toBe(1);
  });

  it("gebruikt standaard de echte stappenlijst, met workflow als eerste", () => {
    const namen = poortStappen("/repo", {
      basis: "origin/main",
      tekst: "",
      ackTekst: "",
      ackActor: "",
      ackRelatie: "",
    }).map((s) => s.naam);
    expect(namen[0]).toBe("workflow");
    expect(namen).toEqual(["workflow", "engine", "rollen", "index", "state", "sanitize", "lint"]);
  });

  it("verbindt die eerste stap met de echte workflowcontrole", async () => {
    // Een lege map heeft geen workflow en geen canonieke bron. Draait de eerste
    // stap uit de lijst daarop, dan hoort hij te falen.
    const map = await mkdtemp(path.join(tmpdir(), "jarvis-leeg-"));
    const eerste = poortStappen(map, {
      basis: "origin/main",
      tekst: "",
      ackTekst: "",
      ackActor: "",
      ackRelatie: "",
    })[0];
    await expect(eerste.draai()).resolves.not.toBe(0);
  });
});
