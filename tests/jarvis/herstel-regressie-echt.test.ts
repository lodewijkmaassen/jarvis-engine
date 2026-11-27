import { describe, expect, it } from "vitest";
import {
  BEHOUDEN,
  behoudtGeslaagde,
  naOnvolledigeMeting,
  stelOnvolledigUit,
  verdeelTests,
  type AcceptatieTest,
  type AcceptatieUitkomst,
} from "@/jarvis/src/acceptatie";
import { ACCEPTATIE_MISLUKT_SQL, MAX_ACCEPTATIE_RONDES, rondeBesluit } from "@/jarvis/src/doel-acceptatie";
import { hervatbareDoelen } from "@/jarvis/src/doelen";
import { nietGesteldeVragen } from "@/jarvis/src/sparproef";

/**
 * DE REGRESSIESCENARIO'S NAGESPEELD OP DE ECHTE GESCHIEDENIS (D-20261127-191905240)
 *
 * De regels hieronder komen letterlijk uit jarvis.activiteit (gelezen op 2026-11-27, alleen lezen): per doel de
 * heropeningen ("… → open [heropend]") en de eindoordelen van de eindcontrole, met hun tijd. De tekst is ingekort
 * tot het begin; dat is alles wat de teller leest. Elk scenario speelt na wat de keten toen deed, en wat zij met
 * deze versie doet.
 *
 * De ronde-teller wordt hier nagespeeld zoals ACCEPTATIE_MISLUKT_SQL hem in Postgres telt: eindoordelen die
 * "acceptatietest niet geslaagd" zeggen, na de laatste heropening vóór het moment van meten.
 */
type Regel = readonly [op: string, soort: "status" | "acceptatie", tekst: string];

const BRAIN_V1: readonly Regel[] = [
  ["2026-11-20T21:47:04Z", "status", "vast → open [heropend]"],
  ["2026-11-20T22:43:16Z", "acceptatie", "eindoordeel: bezig — acceptatietest niet geslaagd (ronde 1 van 3) — ei"],
  ["2026-11-20T23:55:18Z", "acceptatie", "eindoordeel: bezig — acceptatietest niet geslaagd (ronde 2 van 3) — ei"],
];
const CONTEXTINTEGRATIE: readonly Regel[] = [
  ["2026-11-22T00:41:02Z", "acceptatie", "eindoordeel: bezig — acceptatietest niet geslaagd (ronde 1 van 3) — ei"],
  ["2026-11-22T01:18:12Z", "acceptatie", "eindoordeel: bezig — acceptatietest niet geslaagd (ronde 2 van 3) — ei"],
  ["2026-11-22T11:25:05Z", "status", "vast → open [heropend]"],
  ["2026-11-22T16:29:28Z", "status", "vast → open [heropend]"],
  ["2026-11-22T18:51:39Z", "status", "vast → open [heropend]"],
  ["2026-11-22T19:09:46Z", "status", "vast → open [heropend]"],
  ["2026-11-22T19:58:12Z", "acceptatie", "eindoordeel: bezig — acceptatietest niet geslaagd (ronde 3 van 3) — ei"],
  ["2026-11-22T20:34:44Z", "acceptatie", "eindoordeel: vast — acceptatietest niet geslaagd (ronde 4 van 3) — ein"],
  ["2026-11-22T20:39:56Z", "status", "vast → open [heropend]"],
];
const WEB_INTELLIGENCE: readonly Regel[] = [
  ["2026-11-24T21:01:25Z", "acceptatie", "eindoordeel: bezig — acceptatietest niet geslaagd (ronde 1 van 3) — 1:"],
  ["2026-11-24T21:37:26Z", "acceptatie", "eindoordeel: bezig — acceptatietest niet geslaagd (ronde 2 van 3) — 1:"],
  ["2026-11-24T22:43:36Z", "acceptatie", "eindoordeel: bezig — acceptatietest niet geslaagd (ronde 3 van 3) — 1:"],
  ["2026-11-24T23:50:17Z", "acceptatie", "eindoordeel: vast — acceptatietest niet geslaagd (ronde 4 van 3) — 1: "],
  ["2026-11-25T11:02:42Z", "status", "vast → open [heropend]"],
  ["2026-11-25T11:48:41Z", "acceptatie", "eindoordeel: vast — acceptatietest niet geslaagd (ronde 5 van 3) — 1: "],
  ["2026-11-27T14:17:11Z", "status", "vast → open [heropend]"],
  ["2026-11-27T15:21:31Z", "acceptatie", "eindoordeel: vast — acceptatietest niet geslaagd (ronde 6 van 3) — 1: "],
];
const PERFORMANCE: readonly Regel[] = [
  ["2026-11-27T15:53:30Z", "acceptatie", "eindoordeel: bezig — acceptatietest niet geslaagd (ronde 1 van 3) — ei"],
  ["2026-11-27T16:55:28Z", "acceptatie", "eindoordeel: bezig — acceptatietest niet geslaagd (ronde 2 van 3) — ei"],
  ["2026-11-27T17:26:46Z", "acceptatie", "eindoordeel: bezig — acceptatietest niet geslaagd (ronde 3 van 3) — ei"],
  ["2026-11-27T18:07:41Z", "status", "vast → open [heropend]"],
  ["2026-11-27T18:16:45Z", "acceptatie", "eindoordeel: vast — acceptatietest niet geslaagd (ronde 4 van 3) — ein"],
];

const gezakt = (r: Regel) => r[1] === "acceptatie" && /^eindoordeel:.*acceptatietest niet geslaagd/.test(r[2]);
const heropend = (r: Regel) => r[1] === "status" && r[2].includes("[heropend]");

/** Wat de nieuwe teller op elk moment van meten zou hebben gezegd: ronde, en of het doel toen vast was gegaan. */
function naspelen(regels: readonly Regel[]): { op: string; toen: string; nu: string }[] {
  return regels.filter(gezakt).map((meting) => {
    const t = Date.parse(meting[0]);
    const vorige = regels.filter((r) => heropend(r) && Date.parse(r[0]) < t).map((r) => Date.parse(r[0]));
    const sinds = vorige.length === 0 ? -Infinity : Math.max(...vorige);
    const eerder = regels.filter((r) => gezakt(r) && Date.parse(r[0]) < t && Date.parse(r[0]) > sinds).length;
    const b = rondeBesluit(eerder);
    const toen = /\(ronde (\d+) van 3\)/.exec(meting[2])![1]!;
    return { op: meting[0], toen: `ronde ${toen} van 3, ${meting[2].split(" ")[1]}`, nu: `ronde ${b.nummer} van 3, ${b.laatste ? "vast" : "bezig"}` };
  });
}

describe("de teller die hier wordt nagespeeld, is de teller van de database", () => {
  it("telt dezelfde regels: eindoordelen die zakten, na de laatste statusregel met [heropend]", () => {
    expect(ACCEPTATIE_MISLUKT_SQL).toContain("tekst like 'eindoordeel:%acceptatietest niet geslaagd%'");
    expect(ACCEPTATIE_MISLUKT_SQL).toContain("max(h.op)");
    expect(ACCEPTATIE_MISLUKT_SQL).toContain("h.tekst like '%[heropend]%'");
  });
});

describe("rondegrens: nergens meer een ronde boven de grens, elke heropening een eigen budget van drie", () => {
  it("Web Intelligence: 'ronde 4, 5 en 6 van 3' worden ronde 3 (vast), 1 en 1", () => {
    expect(naspelen(WEB_INTELLIGENCE).map((r) => r.nu)).toEqual([
      "ronde 1 van 3, bezig",
      "ronde 2 van 3, bezig",
      "ronde 3 van 3, vast", // toen pas bij ronde 4 vast; een betaalde ronde minder
      "ronde 3 van 3, vast", // (ronde 4 van 3, zonder heropening ertussen: komt niet meer voor)
      "ronde 1 van 3, bezig", // na de heropening van 25-11: toen "ronde 5 van 3" en meteen vast
      "ronde 1 van 3, bezig", // na de heropening van 27-11: toen "ronde 6 van 3" en meteen vast
    ]);
  });

  it("Performance: na de heropening van 18:07 'ronde 1 van 3' in plaats van 'ronde 4 van 3'", () => {
    const uit = naspelen(PERFORMANCE);
    expect(uit.map((r) => r.toen)).toEqual(["ronde 1 van 3, bezig", "ronde 2 van 3, bezig", "ronde 3 van 3, bezig", "ronde 4 van 3, vast"]);
    expect(uit.map((r) => r.nu)).toEqual(["ronde 1 van 3, bezig", "ronde 2 van 3, bezig", "ronde 3 van 3, vast", "ronde 1 van 3, bezig"]);
  });

  it("contextintegratie: na vier heropeningen telt de teller opnieuw vanaf één", () => {
    expect(naspelen(CONTEXTINTEGRATIE).map((r) => r.nu)).toEqual([
      "ronde 1 van 3, bezig",
      "ronde 2 van 3, bezig",
      "ronde 1 van 3, bezig",
      "ronde 2 van 3, bezig",
    ]);
  });

  it("Brain V1: ongewijzigd (twee ronden, daarna klaar)", () => {
    expect(naspelen(BRAIN_V1).map((r) => r.nu)).toEqual(["ronde 1 van 3, bezig", "ronde 2 van 3, bezig"]);
  });

  it("geen enkel nagespeeld oordeel noemt een ronde boven de grens", () => {
    for (const r of [BRAIN_V1, CONTEXTINTEGRATIE, WEB_INTELLIGENCE, PERFORMANCE].flatMap(naspelen)) {
      expect(Number(/ronde (\d+)/.exec(r.nu)![1])).toBeLessThanOrEqual(MAX_ACCEPTATIE_RONDES);
    }
  });
});

const test = (id: string): AcceptatieTest => ({ id, soort: "bewijs", tekst: `test ${id}`, vraag: null, url: null, onderwerp: null, volatiel: false });

describe("Web Intelligence, 27-11 15:21: de ronde die niet had mogen tellen", () => {
  // Wat er gebeurde (jarvis.activiteit): sparproef $0.8461, de proef stopte vóór gesprek 7 (vraag 6), tests 1–5
  // geslaagd, test 6 "niet-geslaagd — … gesprek 7, waarin dit had moeten gebeuren, is niet uitgevoerd", doel vast.
  const gekozen = ["1", "2", "3", "4", "5", "6"].map((nummer) => ({ nummer }));
  const gevoerd = [1, 2, 3, 4, 5, 6].map((gesprek) => ({ gesprek }));
  const reactie =
    "Reactie van de eigenaar (2026-11-27 15:17):\nDe eerste praktijktest van Web Intelligence toont een structurele tekortkoming.\n\n" +
    "Behoud de reeds geslaagde functionaliteiten en voorkom onnodige herhaling van acceptatietests. Respecteer de bestaande beveiligings- en kostenlimieten.";

  it("nu: test 6 wordt niet beoordeeld, de ronde telt niet, het doel blijft samengevoegd", () => {
    const { beoordelen, uitgesteld } = stelOnvolledigUit(["1", "2", "3", "4", "5", "6"].map(test), nietGesteldeVragen(gevoerd, gekozen));
    expect(uitgesteld.map((t) => t.id)).toEqual(["6"]);
    const gemeten: AcceptatieUitkomst[] = beoordelen.map((t) => ({ id: t.id, staat: "geslaagd", bewijs: "", reden: "geslaagd" }));
    expect(naOnvolledigeMeting(gemeten, uitgesteld).soort).toBe("volgende-ronde");
  });

  it("nu: de volgende ronde stelt alleen vraag 6; 1–5 blijven behouden (de reactie vraagt erom)", () => {
    expect(behoudtGeslaagde(reactie)).toBe(true);
    const activiteit = ["5", "4", "3", "2", "1"].map((id) => ({ soort: "acceptatie", tekst: `test ${id}: geslaagd — goed` }));
    const { behouden, teMeten } = verdeelTests(["1", "2", "3", "4", "5", "6"].map(test), `Opdracht\n\n${reactie}`, activiteit);
    expect(behouden.map((b) => b.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(behouden.every((b) => b.reden.startsWith(BEHOUDEN))).toBe(true);
    expect(teMeten.map((t) => t.id)).toEqual(["6"]);
    // Toen werd om 15:24 alles opnieuw gemeten ($0.6206), en kantelde de al geslaagde test 2 naar niet-geslaagd.
  });
});

describe("Performance: de nameting wacht op gegevens in plaats van op de eigenaar", () => {
  // De doelen zoals ze op 2026-11-27 rond 20:10 UTC in de administratie stonden (alleen id en status).
  const nu = [
    { id: "D-20261127-133830402", status: "klaar" as const, uitkomst: null },
    { id: "D-20261127-134415718", status: "klaar" as const, uitkomst: null },
    { id: "D-20261127-191905240", status: "bezig" as const, uitkomst: null },
  ];
  const wachtend = {
    id: "D-20261127-142321503",
    status: "vast" as const,
    uitkomst: "Nameting op vergelijkbare doelen van na de wijziging. [wacht op: 2 afgeronde doelen na 2026-11-27T17:24:00Z]",
  };

  it("nu: geen start (geen modelaanroep), want er is na 17:24 nog geen doel afgerond", () => {
    expect(hervatbareDoelen([wachtend, ...nu])).toEqual([]);
  });

  it("zodra er twee zijn afgerond: één start, met de doelen die de voorwaarde vervulden", () => {
    const later = [...nu.map((d) => (d.id === "D-20261127-191905240" ? { ...d, status: "klaar" as const } : d)), { id: "D-20261127-210000000", status: "klaar" as const, uitkomst: null }];
    const uit = hervatbareDoelen([wachtend, ...later]);
    expect(uit.map((h) => h.id)).toEqual(["D-20261127-142321503"]);
    expect(uit[0]!.reden).toContain("D-20261127-191905240, D-20261127-210000000");
  });

  it("de reactie 'herhaal geen reeds geslaagde tests' wordt gelezen als behoud", () => {
    expect(behoudtGeslaagde("Start geen volledige herstelcyclus en herhaal geen reeds geslaagde tests.")).toBe(true);
  });
});
