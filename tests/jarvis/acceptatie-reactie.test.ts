// Een reactie van de eigenaar die de acceptatietests bijstelt (D-20261124-200610788, 2026-11-25): een test splitsen
// in onafhankelijke controles, en geslaagde tests behouden zonder ze opnieuw te meten.

import { describe, expect, it } from "vitest";

import { BEHOUDEN, behoudtGeslaagde, eigenaarsReactie, laatstGeslaagd, leesAcceptatieTests, splitsingenUit, testsVoorDoel, verdeelTests } from "../../jarvis/src/acceptatie";

const OPDRACHT = [
  "# Opdracht",
  "",
  "## Functionele acceptatietests",
  "",
  "Toon aan dat Jarvis antwoord geeft op vragen zoals:",
  "",
  "1. Wat wordt het weer morgen in Ede?",
  "2. Welke films draaien vandaag in de bioscoop in Ede?",
  "3. Welke informatie uit twee tegenstrijdige openbare bronnen is het meest betrouwbaar?",
  "",
  "Test daarnaast dat Jarvis geen externe zoekopdracht uitvoert wanneer zijn bestaande kennis voldoende is.",
  "",
  "## Uitvoering",
  "",
  "Onderzoek zelfstandig de beschikbare oplossingen.",
  "",
  "Reactie van de eigenaar (2026-11-25 12:02):",
  "Twee van de drie acceptatietests zijn geslaagd. Behoud deze resultaten en herhaal deze tests niet onnodig.",
  "",
  "Splits acceptatietest 3 in twee onafhankelijke controles:",
  "",
  "1. Bij tegenstrijdige openbare informatie beoordeelt Jarvis de actualiteit, juistheid en betrouwbaarheid van bronnen.",
  "2. Bij een afzonderlijke, tijdsonafhankelijke kennisvraag toont Jarvis aan dat hij geen onnodige externe zoekopdracht uitvoert.",
  "",
  "Herstel uitsluitend de daadwerkelijk resterende functionele tekortkomingen.",
  "",
  "(Vorige uitkomst: 1. Een oude regel die geen splitsing is. Splits acceptatietest 1 in: 1. x 2. y)",
].join("\n");

const doel = { opdracht: OPDRACHT, acceptatie_url: null, pr: { nummer: 1 } };

describe("de sectie met acceptatietests", () => {
  it("eindigt bij een nieuwe kop: wat onder ## Uitvoering staat hoort niet bij de laatste test", () => {
    const tests = leesAcceptatieTests(OPDRACHT);
    expect(tests.map((t) => t.id)).toEqual(["1", "2", "3"]);
    expect(tests[2]!.tekst).not.toContain("Onderzoek zelfstandig");
  });
});

describe("de reactie van de eigenaar", () => {
  it("is de laatste reactie, zonder de vorige uitkomst", () => {
    const r = eigenaarsReactie(OPDRACHT);
    expect(r.startsWith("Reactie van de eigenaar")).toBe(true);
    expect(r).not.toContain("Vorige uitkomst");
    expect(eigenaarsReactie("Geen reactie.")).toBe("");
  });

  it("splitst een test in zijn controles", () => {
    const s = splitsingenUit(eigenaarsReactie(OPDRACHT));
    expect(s).toHaveLength(1);
    expect(s[0]!.id).toBe("3");
    expect(s[0]!.delen).toHaveLength(2);
    expect(s[0]!.delen[1]).toContain("tijdsonafhankelijke kennisvraag");
  });

  it("testsVoorDoel vervangt de gesplitste test door 3.1 en 3.2, met de oorspronkelijke vraag als context", () => {
    const tests = testsVoorDoel(doel);
    expect(tests.map((t) => t.id)).toEqual(["1", "2", "3.1", "3.2"]);
    expect(tests[2]!.tekst).toContain("actualiteit, juistheid en betrouwbaarheid");
    expect(tests[2]!.tekst).not.toContain("geen onnodige externe zoekopdracht");
    expect(tests[3]!.tekst).toContain("Welke informatie uit twee tegenstrijdige openbare bronnen");
    expect(tests[3]!.soort).toBe("bewijs");
  });

  it("zonder reactie verandert er niets", () => {
    const zonder = OPDRACHT.slice(0, OPDRACHT.indexOf("Reactie van de eigenaar"));
    expect(testsVoorDoel({ ...doel, opdracht: zonder }).map((t) => t.id)).toEqual(["1", "2", "3"]);
    expect(behoudtGeslaagde("")).toBe(false);
  });
});

describe("geslaagde tests behouden", () => {
  const activiteit = [
    { soort: "status", tekst: "heropend" },
    { soort: "acceptatie", tekst: "eindoordeel: vast — acceptatietest niet geslaagd" },
    { soort: "acceptatie", tekst: "test 3: niet-geslaagd — geen expliciete conclusie" },
    { soort: "acceptatie", tekst: "test 2: geslaagd — films met tijden genoemd" },
    { soort: "acceptatie", tekst: "test 1: geslaagd — weer voor morgen met bron" },
    { soort: "acceptatie", tekst: "test 2: niet-geslaagd — oudere ronde" },
  ];

  it("leest per test alleen het laatste oordeel", () => {
    const g = laatstGeslaagd(activiteit);
    expect([...g.keys()].sort()).toEqual(["1", "2"]);
    expect(g.get("2")).toBe("films met tijden genoemd");
  });

  it("herkent het verzoek om resultaten te behouden", () => {
    expect(behoudtGeslaagde("Behoud deze resultaten en herhaal deze tests niet onnodig.")).toBe(true);
    expect(behoudtGeslaagde("Herhaal deze tests niet.")).toBe(true);
    expect(behoudtGeslaagde("Behoud alle bestaande functionaliteiten.")).toBe(false);
  });

  it("meet alleen wat niet geslaagd is; het behouden oordeel blijft in een volgende ronde te behouden", () => {
    const { behouden, teMeten } = verdeelTests(testsVoorDoel(doel), OPDRACHT, activiteit);
    expect(behouden.map((b) => b.id)).toEqual(["1", "2"]);
    expect(behouden.every((b) => b.staat === "geslaagd" && b.reden.startsWith(BEHOUDEN))).toBe(true);
    expect(teMeten.map((t) => t.id)).toEqual(["3.1", "3.2"]);
    const volgende = [{ soort: "acceptatie", tekst: `test 1: geslaagd — ${behouden[0]!.reden}` }];
    const nog = verdeelTests(testsVoorDoel(doel), OPDRACHT, volgende);
    expect(nog.behouden[0]!.reden.split(BEHOUDEN).length).toBe(2);
  });

  it("zonder verzoek van de eigenaar wordt alles gemeten", () => {
    const zonder = OPDRACHT.replace("Behoud deze resultaten en herhaal deze tests niet onnodig.", "");
    const { behouden, teMeten } = verdeelTests(testsVoorDoel({ ...doel, opdracht: zonder }), zonder, activiteit);
    expect(behouden).toEqual([]);
    expect(teMeten).toHaveLength(4);
  });
});
