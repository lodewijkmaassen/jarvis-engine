// De argumentparser.
//
// Deze tests bestaan omdat ze eerst NIET konden bestaan. De duplicaatweigering
// zat in `cli.ts`, dat eindigt op `void hoofd()`: wie de functie importeerde
// startte de CLI en werd door `process.exit` afgekapt vóór zijn eerste
// assertie. Een onafhankelijke QA merkte op dat een beveiligingsgrens daarmee
// nul dekking had — hij werkte, maar één refactor zou hem weghalen zonder dat
// een groene suite iets merkte.
//
// `leesArgumenten` staat nu in een eigen module zonder neveneffecten.
import { describe, expect, it } from "vitest";
import { leesArgumenten } from "@/jarvis/src/args";
import { AfbrekenFout, voerUit } from "@/jarvis/src/opdrachten";

const bij = (...argv: string[]) => leesArgumenten(argv);

describe("dubbele vlaggen worden gemeld", () => {
  // Niet de eerste laten winnen en niet de laatste: allebei geeft een verschil
  // tussen wat een lezer denkt dat er staat en wat er gebeurt. Precies dat
  // verschil maakte van elke review een OWNER-review toen de workflowcontrole
  // het eerste voorkomen las en de CLI het tweede gebruikte.
  const gevallen: [string, string[]][] = [
    ["--ack-relatie", ["lint", "--ack-relatie", "NONE", "--ack-relatie", "OWNER"]],
    ["--ack-bestand", ["lint", "--ack-bestand", "/a.txt", "--ack-bestand", "/b.txt"]],
    ["--ack-actor", ["lint", "--ack-actor", "iemand", "--ack-actor", "lodewijk"]],
    ["--schrijf", ["index", "--schrijf", "--schrijf"]],
    ["--controleer", ["state", "--controleer", "--controleer"]],
    ["--basis", ["lint", "--basis", "origin/main", "--basis", "HEAD"]],
    ["--wat-dan-ook", ["plan", "--wat-dan-ook", "a", "--wat-dan-ook", "b"]],
  ];
  for (const [naam, argv] of gevallen) {
    it(`meldt ${naam}`, () => {
      expect(bij(...argv).dubbel).toEqual([naam.slice(2)]);
    });
  }

  it("meldt een vlag die eerst zonder en daarna met waarde komt", () => {
    expect(bij("lint", "--ack-relatie", "--ack-relatie", "OWNER").dubbel).toEqual(["ack-relatie"]);
  });

  it("meldt een vlag die eerst met en daarna zonder waarde komt", () => {
    expect(bij("lint", "--ack-relatie", "OWNER", "--ack-relatie").dubbel).toEqual(["ack-relatie"]);
  });

  it("meldt elke dubbele vlag één keer, in volgorde van voorkomen", () => {
    const uit = bij("lint", "--b", "1", "--a", "1", "--b", "2", "--a", "2", "--b", "3");
    expect(uit.dubbel).toEqual(["b", "a"]);
  });

  it("meldt niets bij enkelvoudige vlaggen", () => {
    const uit = bij("lint", "--basis", "origin/main", "--ack-actor", "lodewijk", "--ack-relatie", "OWNER");
    expect(uit.dubbel).toEqual([]);
  });
});

describe("gewoon lezen blijft werken", () => {
  it("leest de opdracht", () => {
    expect(bij("lint").opdracht).toBe("lint");
    expect(bij().opdracht).toBe("help");
  });

  it("leest een vlag met waarde", () => {
    expect(bij("lint", "--basis", "origin/main").vlaggen.get("basis")).toBe("origin/main");
  });

  it("leest een vlag zonder waarde als \"true\"", () => {
    expect(bij("index", "--schrijf").vlaggen.get("schrijf")).toBe("true");
  });

  it("leest een vlag gevolgd door een andere vlag als \"true\"", () => {
    const uit = bij("state", "--controleer", "--schrijf");
    expect(uit.vlaggen.get("controleer")).toBe("true");
    expect(uit.vlaggen.get("schrijf")).toBe("true");
  });

  it("leest losse argumenten", () => {
    expect(bij("audit", "T-1", "--basis", "main").losse).toEqual(["T-1"]);
  });

  it("laat een waarde met streepjes met rust", () => {
    expect(bij("lint", "--basis", "jarvis/v1-bootstrap").vlaggen.get("basis")).toBe("jarvis/v1-bootstrap");
  });

  it("importeren start de CLI niet", () => {
    // Als dit bestand draait zonder dat er een helpscherm langskomt en zonder
    // dat het proces stopt, is de scheiding tussen entrypoint en logica intact.
    expect(typeof leesArgumenten).toBe("function");
  });
});

describe("de CLI weigert een dubbele vlag werkelijk", () => {
  // Deze tests roepen `voerUit` RECHTSTREEKS aan. Dat kon niet zolang het
  // entrypoint onderin dezelfde module stond: een import startte de CLI en het
  // proces stopte voordat de eerste assertie draaide. De weigering had daardoor
  // nul dekking - hij werkte, maar één refactor zou hem weghalen zonder dat een
  // groene suite iets merkte. Precies dat gat sluiten deze tests.
  async function verwachtWeigering(argv: string[]): Promise<AfbrekenFout> {
    try {
      await voerUit(argv);
    } catch (fout) {
      if (fout instanceof AfbrekenFout) return fout;
      throw fout;
    }
    throw new Error(`voerUit(${JSON.stringify(argv)}) had moeten weigeren maar deed dat niet`);
  }

  const gevallen: [string, string[]][] = [
    ["--ack-relatie", ["lint", "--ack-relatie", "NONE", "--ack-relatie", "OWNER"]],
    ["--ack-bestand", ["lint", "--ack-bestand", "/a.txt", "--ack-bestand", "/b.txt"]],
    ["--ack-actor", ["lint", "--ack-actor", "iemand", "--ack-actor", "lodewijk"]],
    ["--schrijf", ["index", "--schrijf", "--schrijf"]],
    ["--controleer", ["state", "--controleer", "--controleer"]],
    ["--basis", ["lint", "--basis", "main", "--basis", "HEAD"]],
    ["een willekeurige vlag", ["plan", "--wat-dan-ook", "a", "--wat-dan-ook", "b"]],
    ["eerst zonder waarde, daarna met", ["lint", "--ack-relatie", "--ack-relatie", "OWNER"]],
    ["eerst met waarde, daarna zonder", ["lint", "--ack-relatie", "OWNER", "--ack-relatie"]],
  ];

  for (const [naam, argv] of gevallen) {
    it(`weigert ${naam} met exitcode 2`, async () => {
      const fout = await verwachtWeigering(argv);
      expect(fout.code).toBe(2);
      expect(fout.message).toContain("meer dan een keer meegegeven");
    });
  }

  it("weigert vóórdat de opdracht iets doet", async () => {
    // De weigering moet de eerste stap zijn. Een dubbele --schrijf op `index`
    // mag de index niet alsnog wegschrijven.
    const fout = await verwachtWeigering(["index", "--schrijf", "--schrijf"]);
    expect(fout.code).toBe(2);
  });

  it("noemt elke dubbele vlag in de melding", async () => {
    const fout = await verwachtWeigering(["lint", "--a", "1", "--a", "2", "--b", "1", "--b", "2"]);
    expect(fout.message).toContain("--a");
    expect(fout.message).toContain("--b");
  });

  it("weigert niet bij enkelvoudige vlaggen", () => {
    // Geen aanroep van voerUit: die zou de hele poort draaien. Dat de parser
    // hier niets meldt, is wat de weigering niet laat afgaan.
    expect(leesArgumenten(["lint", "--basis", "main", "--ack-relatie", "OWNER"]).dubbel).toEqual([]);
  });
});
