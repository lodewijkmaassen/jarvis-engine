import { describe, expect, it } from "vitest";
import {
  BEHOUDEN,
  BEHOUDEN_ZELFDE_WERK,
  behoudtGeslaagde,
  eigenaarsReactie,
  gemetenOp,
  gemetenOpLabel,
  naOnvolledigeMeting,
  stelOnvolledigUit,
  verdeelTests,
  type AcceptatieTest,
  type AcceptatieUitkomst,
} from "@/jarvis/src/acceptatie";
import { ACCEPTATIE_MISLUKT_SQL, MAX_ACCEPTATIE_RONDES } from "@/jarvis/src/doel-acceptatie";
import { aangemaaktUitId, hervatbareDoelen, wachtVoorwaarde } from "@/jarvis/src/doelen";
import { nietGesteldeVragen } from "@/jarvis/src/sparproef";

/**
 * Herstel zonder nutteloze rondes (D-20261127-191905240).
 *
 * De regressiescenario's zijn de echte gevallen uit de doelenadministratie:
 *   - Web Intelligence V1 (D-20261124-200610788), ronde 6: de sparproef stopte op haar kostengrens vóór gesprek 7,
 *     test 6 heette "niet-geslaagd" omdat er niets gemeten was, en het doel stond vast met "ronde 6 van 3".
 *   - Performance & Intelligent Task Routing V1 (D-20261127-142321503): de nameting kon niet, want er waren nog geen
 *     doelen van na de wijziging; de eigenaar moest tussenkomen om te zeggen dat er alleen gemeten moest worden.
 *   - Brain V1 / contextintegratie (D-20261120-213559610, D-20261121-235241117): rondes waarin dezelfde, al geslaagde
 *     metingen telkens opnieuw werden gedaan en betaald.
 */

const SHA = "7a003486eaa72444dc659ae70ccc47d2e024cc69";
const ANDER = "fb576a058cb00dc3e6a60566e606d40b526546d4";

const test = (id: string): AcceptatieTest => ({ id, soort: "bewijs", tekst: `test ${id}`, vraag: null, url: null, onderwerp: null, volatiel: false });
const regel = (tekst: string) => ({ soort: "acceptatie", tekst });

describe("de rondegrens wordt echt afgedwongen, per opdracht van de eigenaar", () => {
  it("telt alleen de ronden sinds het heropenen, zoals de NO-GO-teller", () => {
    expect(ACCEPTATIE_MISLUKT_SQL).toContain("heropend_op");
    expect(ACCEPTATIE_MISLUKT_SQL).toMatch(/op > coalesce\(\(select heropend_op from jarvis\.doelen where id = \$1\), '-infinity'::timestamptz\)/);
    // De bestaande eis blijft: ronden, geen losse tests.
    expect(ACCEPTATIE_MISLUKT_SQL).toContain("eindoordeel:%acceptatietest niet geslaagd%");
    expect(MAX_ACCEPTATIE_RONDES).toBe(3);
  });
});

describe("Web Intelligence, ronde 6: een onvolledige meting is geen gezakte ronde", () => {
  // Zeven gesprekken: de controlevraag (1) en de vragen 1..6 (gesprek 2..7). De proef stopte vóór gesprek 7.
  const gekozen = ["1", "2", "3", "4", "5", "6"].map((nummer) => ({ nummer }));
  const beurten = [1, 2, 3, 4, 5, 6].map((gesprek) => ({ gesprek }));

  it("weet welke vraag niet gesteld is", () => {
    expect([...nietGesteldeVragen(beurten, gekozen)]).toEqual(["6"]);
    expect(nietGesteldeVragen([...beurten, { gesprek: 7 }], gekozen).size).toBe(0);
  });

  it("beoordeelt de gesplitste test 6 dan niet (geen modelaanroep), de rest wel", () => {
    const tests = ["1", "2", "3", "4", "5", "6.1", "6.2"].map(test);
    const { beoordelen, uitgesteld } = stelOnvolledigUit(tests, new Set(["6"]));
    expect(beoordelen.map((t) => t.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(uitgesteld.map((t) => t.id)).toEqual(["6.1", "6.2"]);
  });

  it("telt geen ronde als alles wat gemeten is slaagde: de volgende ronde meet alleen de rest", () => {
    const gemeten: AcceptatieUitkomst[] = ["1", "2", "3", "4", "5"].map((id) => ({ id, staat: "geslaagd", bewijs: "", reden: "ok" }));
    const uit = naOnvolledigeMeting(gemeten, [test("6.1"), test("6.2")]);
    expect(uit.soort).toBe("volgende-ronde");
    expect(uit.tekst).toContain("6.1, 6.2");
  });

  it("is wél een ronde als iets dat gemeten is werkelijk zakte, en noemt het ongemeten deel niet gezakt", () => {
    const gemeten: AcceptatieUitkomst[] = [
      { id: "1", staat: "geslaagd", bewijs: "", reden: "ok" },
      { id: "2", staat: "niet-geslaagd", bewijs: "", reden: "geen datum" },
    ];
    const uit = naOnvolledigeMeting(gemeten, [test("6.1")]);
    expect(uit.soort).toBe("oordeel");
    expect(uit.nietsGemeten).toBe(false);
    expect(uit.tekst).toContain("nog niet gemeten");
  });

  it("eindigt: een ronde die niets nieuws mat, gaat niet nog eens rond", () => {
    const alleenBehouden: AcceptatieUitkomst[] = [{ id: "1", staat: "geslaagd", bewijs: "", reden: `${BEHOUDEN_ZELFDE_WERK} ok` }];
    const uit = naOnvolledigeMeting(alleenBehouden, [test("6.1")]);
    expect(uit.soort).toBe("oordeel");
    expect(uit.nietsGemeten).toBe(true);
  });

  it("verandert niets als alles gemeten is", () => {
    expect(stelOnvolledigUit([test("1")], new Set()).uitgesteld).toEqual([]);
    expect(naOnvolledigeMeting([], []).soort).toBe("oordeel");
  });
});

describe("geslaagde criteria blijven behouden, tenzij het werk veranderde", () => {
  const tests = ["1", "2", "6.1"].map(test);
  const activiteit = [
    // nieuwste eerst, zoals DOEL_ACTIVITEIT_SQL
    regel(`test 2: geslaagd — goed${gemetenOpLabel(SHA)}`),
    regel(`test 1: geslaagd — goed${gemetenOpLabel(ANDER)}`),
    regel("test 6.1: niet-geslaagd — niet gemeten"),
  ];

  it("labelt een oordeel met de samenvoeging en leest dat terug", () => {
    expect(gemetenOpLabel(SHA)).toBe(" [gemeten op 7a003486eaa7]");
    expect(gemetenOp(`goed${gemetenOpLabel(SHA)}`)).toBe("7a003486eaa7");
    expect(gemetenOpLabel(null)).toBe("");
    expect(gemetenOpLabel("geen-sha")).toBe("");
  });

  it("behoudt wat op deze zelfde samenvoeging slaagde, en meet wat op ander werk slaagde opnieuw", () => {
    const { behouden, teMeten } = verdeelTests(tests, "opdracht zonder reactie", activiteit, SHA);
    expect(behouden.map((b) => b.id)).toEqual(["2"]);
    expect(behouden[0]!.reden.startsWith(BEHOUDEN_ZELFDE_WERK)).toBe(true);
    expect(teMeten.map((t) => t.id)).toEqual(["1", "6.1"]);
  });

  it("meet zonder samenvoeging en zonder verzoek alles, zoals altijd", () => {
    expect(verdeelTests(tests, "opdracht", activiteit).teMeten.map((t) => t.id)).toEqual(["1", "2", "6.1"]);
  });

  it("zet een al behouden oordeel niet dubbel voorvoegsel", () => {
    const eerder = [regel(`test 2: geslaagd — ${BEHOUDEN_ZELFDE_WERK} goed${gemetenOpLabel(SHA)}`)];
    const { behouden } = verdeelTests([test("2")], "opdracht", eerder, SHA);
    expect(behouden[0]!.reden.split(BEHOUDEN_ZELFDE_WERK).length).toBe(2);
  });
});

describe("de eigenaar hoeft niet twee keer te zeggen dat geslaagde tests blijven", () => {
  it("herkent de reactie van 2026-11-27 bij Web Intelligence", () => {
    const opdracht =
      "Opdracht\n\nReactie van de eigenaar (2026-11-27 15:17):\nGebruik de oorspronkelijke bioscoopvraag als praktijktest.\n\n" +
      "Behoud de reeds geslaagde functionaliteiten en voorkom onnodige herhaling van acceptatietests. Respecteer de bestaande beveiligings- en kostenlimieten.\n\n(Vorige uitkomst: x)";
    expect(behoudtGeslaagde(eigenaarsReactie(opdracht))).toBe(true);
  });

  it("herkent de reactie bij Performance", () => {
    expect(behoudtGeslaagde("Start geen volledige herstelcyclus en herhaal geen reeds geslaagde tests.")).toBe(true);
  });

  it("herkent nog steeds de eerdere vorm, en niet een reactie die er niet om vraagt", () => {
    expect(behoudtGeslaagde("Behoud deze resultaten en herhaal deze tests niet onnodig.")).toBe(true);
    expect(behoudtGeslaagde("Behoud de bestaande vormgeving.")).toBe(false);
    expect(behoudtGeslaagde("Herhaal de test met een andere vraag.")).toBe(false);
  });
});

describe("Performance: wachten op gegevens die vanzelf ontstaan, zonder de eigenaar en zonder AI-aanroepen", () => {
  const uitkomst = "Nameting kan pas als er vergelijkbare doelen zijn. [wacht op: 2 afgeronde doelen na 2026-11-27T17:24:00Z]";

  it("leest de voorwaarde uit de uitkomst", () => {
    const w = wachtVoorwaarde(uitkomst);
    expect(w?.aantal).toBe(2);
    expect(w?.na.toISOString()).toBe("2026-11-27T17:24:00.000Z");
    expect(wachtVoorwaarde("gewone blokkade")).toBeNull();
    expect(wachtVoorwaarde("[wacht op: 0 afgeronde doelen na 2026-11-27T17:24:00Z]")).toBeNull();
  });

  it("leest de aanmaaktijd uit het doel-id", () => {
    expect(aangemaaktUitId("D-20261127-191905240")?.toISOString()).toBe("2026-11-27T19:19:05.240Z");
    expect(aangemaaktUitId("D-20261127-191905")?.toISOString()).toBe("2026-11-27T19:19:05.000Z");
    expect(aangemaaktUitId("T-iets")).toBeNull();
  });

  it("hervat pas als genoeg doelen van ná het moment zijn afgerond", () => {
    const wachtend = { id: "D-20261127-142321503", status: "vast" as const, uitkomst };
    const ervoor = { id: "D-20261127-133830402", status: "klaar" as const, uitkomst: null };
    const eenNa = { id: "D-20261127-191905240", status: "klaar" as const, uitkomst: null };
    const nogBezig = { id: "D-20261127-200000000", status: "bezig" as const, uitkomst: null };
    expect(hervatbareDoelen([wachtend, ervoor, eenNa, nogBezig])).toEqual([]);
    const tweedeNa = { id: "D-20261127-210000000", status: "klaar" as const, uitkomst: null };
    const uit = hervatbareDoelen([wachtend, ervoor, eenNa, nogBezig, tweedeNa]);
    expect(uit.map((h) => h.id)).toEqual(["D-20261127-142321503"]);
    expect(uit[0]!.reden).toContain("D-20261127-191905240, D-20261127-210000000");
  });

  it("raakt een doel zonder voorwaarde, of dat niet vast staat, niet aan", () => {
    const klaar = { id: "D-20261128-100000000", status: "klaar" as const, uitkomst: null };
    expect(hervatbareDoelen([{ id: "D-1", status: "vast", uitkomst: "[besluit] iets" }, klaar])).toEqual([]);
    expect(hervatbareDoelen([{ id: "D-2", status: "bezig", uitkomst }, klaar, { ...klaar, id: "D-20261128-100000001" }])).toEqual([]);
  });
});
