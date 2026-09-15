// Providerafgeleiden van de rolcontracten: uit de bron gegenereerd, nooit met
// de hand. De QA van v1 mat dat de enige afgeleide twee secties miste; deze
// tests zetten vast dat de afgeleide het contract volledig draagt, dat de
// gereedschapsnamen uit de configuratie komen en niet uit de engine, en dat
// drift wordt gezien.
import { describe, expect, it } from "vitest";
import {
  ROLLEN_EIND,
  ROLLEN_START,
  NEUTRAAL_VERSIE,
  genereerAfgeleiden,
  genereerAgentdefinitie,
  genereerNeutraleAfgeleide,
  leesRolcontract,
  vervangOverzichtsblok,
  vindDrift,
  type AfgeleidenConfig,
} from "@/jarvis/src/rollen";

const CONTRACT = [
  "---",
  "rol: qa",
  "samenvatting: Toetst onafhankelijk.",
  "vermogens:",
  "  - lezen",
  "  - uitvoeren",
  "  - rapporteren",
  "---",
  "# Rolcontract — QA",
  "",
  "## 1. Doel",
  "",
  "Alles lezen.",
  "",
  "## 8. Escalatie",
  "",
  "BLOCKING_DECISION wanneer nodig.",
  "",
].join("\n");

const CONFIG: AfgeleidenConfig = {
  map: "agents",
  voorvoegsel: "j-",
  overzicht: "INSTAP.md",
  neutraal: "",
  gereedschap: { lezen: "Lees, Zoek", schrijven: "Schrijf, Bewerk", rapporteren: "Schrijf", uitvoeren: "Voer" },
};

const CONFIG_NEUTRAAL: AfgeleidenConfig = { ...CONFIG, neutraal: "rollen.json" };

describe("rolcontract lezen", () => {
  it("leest front-matter en houdt de volledige tekst", () => {
    const r = leesRolcontract("qa.md", CONTRACT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contract.rol).toBe("qa");
    expect(r.contract.titel).toBe("Rolcontract — QA");
    expect(r.contract.vermogens).toEqual(["lezen", "uitvoeren", "rapporteren"]);
    expect(r.contract.agent).toBe(true);
    expect(r.contract.tekst.startsWith("# Rolcontract — QA")).toBe(true);
    expect(r.contract.tekst).toContain("BLOCKING_DECISION");
  });

  it("weigert een contract zonder samenvatting of met een onbekend vermogen", () => {
    expect(leesRolcontract("x.md", "---\nvermogens:\n  - lezen\n---\n# X\n").ok).toBe(false);
    const r = leesRolcontract("x.md", "---\nsamenvatting: s\nvermogens:\n  - vliegen\n---\n# X\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fout).toContain("vliegen");
  });

  it("agent: nee betekent geen eigen agentdefinitie", () => {
    const r = leesRolcontract("orchestrator.md", "---\nsamenvatting: s\nvermogens:\n  - lezen\nagent: nee\n---\n# O\n");
    expect(r.ok && r.contract.agent).toBe(false);
  });
});

describe("agentdefinitie", () => {
  it("draagt het contract volledig, met gereedschap uit de configuratie en zonder dubbelingen", () => {
    const r = leesRolcontract("qa.md", CONTRACT);
    if (!r.ok) throw new Error(r.fout);
    const uit = genereerAgentdefinitie(r.contract, CONFIG, "rollen/qa.md");
    expect(uit.startsWith("---\nname: j-qa\ndescription: Toetst onafhankelijk.\ntools: Lees, Zoek, Voer, Schrijf\n---\n")).toBe(true);
    expect(uit).toContain("Gegenereerd door `jarvis rollen` uit rollen/qa.md");
    expect(uit).toContain("## 8. Escalatie");
    expect(uit).toContain("BLOCKING_DECISION wanneer nodig.");
    // rapporteren geeft Schrijf, niet Bewerk
    expect(uit).not.toContain("Bewerk");
  });

  it("laat de tools-regel weg als de configuratie niets vertaalt", () => {
    const r = leesRolcontract("qa.md", CONTRACT);
    if (!r.ok) throw new Error(r.fout);
    const uit = genereerAgentdefinitie(r.contract, { ...CONFIG, gereedschap: {} }, "rollen/qa.md");
    expect(uit).not.toContain("tools:");
  });
});

describe("afgeleiden en drift", () => {
  it("genereert per agentrol een bestand en één overzichtsblok in het instapdocument", () => {
    const qa = leesRolcontract("qa.md", CONTRACT);
    const orch = leesRolcontract("orchestrator.md", "---\nsamenvatting: Stuurt.\nvermogens:\n  - lezen\nagent: nee\n---\n# Rolcontract — Orchestrator\n");
    if (!qa.ok || !orch.ok) throw new Error("fixture");
    const uit = genereerAfgeleiden([qa.contract, orch.contract], CONFIG, "rollen", "# Instap\n\nEigen tekst.\n");
    expect(uit.map((a) => a.pad)).toEqual(["agents/j-qa.md", "INSTAP.md"]);
    const instap = uit[1].inhoud;
    expect(instap.startsWith("# Instap\n\nEigen tekst.")).toBe(true);
    expect(instap).toContain(ROLLEN_START);
    expect(instap).toContain("| Orchestrator | Stuurt. | `rollen/orchestrator.md` |");
    expect(instap).toContain("| QA | Toetst onafhankelijk. | `rollen/qa.md` |");
    expect(instap.trim().endsWith(ROLLEN_EIND)).toBe(true);
  });

  it("vervangt een bestaand blok en laat de rest van het document staan", () => {
    const doc = `# Kop\n\nBoven.\n\n${ROLLEN_START}\noud\n${ROLLEN_EIND}\n\nOnder.\n`;
    const uit = vervangOverzichtsblok(doc, `${ROLLEN_START}\nnieuw\n${ROLLEN_EIND}`);
    expect(uit).toBe(`# Kop\n\nBoven.\n\n${ROLLEN_START}\nnieuw\n${ROLLEN_EIND}\n\nOnder.\n`);
  });

  it("ziet een ontbrekende en een afwijkende afgeleide; regeleinden tellen niet", () => {
    const afgeleiden = [
      { pad: "a.md", inhoud: "x\ny\n" },
      { pad: "b.md", inhoud: "x\n" },
      { pad: "c.md", inhoud: "x\n" },
    ];
    const schijf = new Map<string, string | null>([
      ["a.md", "x\r\ny\r\n"],
      ["b.md", "anders\n"],
      ["c.md", null],
    ]);
    expect(vindDrift(afgeleiden, schijf)).toEqual([
      { pad: "b.md", reden: "wijkt af van de bron" },
      { pad: "c.md", reden: "ontbreekt" },
    ]);
  });

  it("genereert de neutrale afgeleide alleen als die geconfigureerd is", () => {
    const r = leesRolcontract("qa.md", CONTRACT);
    if (!r.ok) throw new Error(r.fout);
    expect(genereerAfgeleiden([r.contract], CONFIG, "rollen", null).map((a) => a.pad)).toEqual(["agents/j-qa.md", "INSTAP.md"]);
    expect(genereerAfgeleiden([r.contract], CONFIG_NEUTRAAL, "rollen", null).map((a) => a.pad)).toEqual([
      "agents/j-qa.md",
      "INSTAP.md",
      "rollen.json",
    ]);
  });

  it("is deterministisch", () => {
    const r = leesRolcontract("qa.md", CONTRACT);
    if (!r.ok) throw new Error(r.fout);
    const a = genereerAfgeleiden([r.contract], CONFIG, "rollen", null);
    const b = genereerAfgeleiden([r.contract], CONFIG, "rollen", null);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// De tweede afgeleide bestaat om AC-6 (wisselen van leverancier zonder
// kennisverlies) technisch mogelijk te maken: een ander gereedschap moet de
// contracten voluit kunnen lezen zonder de vorm van deze werkomgeving.
describe("leveranciersneutrale afgeleide", () => {
  const contracten = () => {
    const qa = leesRolcontract("qa.md", CONTRACT);
    const orch = leesRolcontract("orchestrator.md", "---\nsamenvatting: Stuurt.\nvermogens:\n  - lezen\nagent: nee\n---\n# Rolcontract — Orchestrator\n\nStuurt alles.\n");
    if (!qa.ok || !orch.ok) throw new Error("fixture");
    return [orch.contract, qa.contract];
  };

  it("draagt elk contract voluit, ook van een rol zonder eigen agentdefinitie", () => {
    const doc = JSON.parse(genereerNeutraleAfgeleide(contracten(), "rollen"));
    expect(doc.versie).toBe(NEUTRAAL_VERSIE);
    expect(doc.bron).toBe("rollen");
    expect(doc.rollen.map((r: { rol: string }) => r.rol)).toEqual(["orchestrator", "qa"]);
    const qa = doc.rollen[1];
    expect(qa.titel).toBe("Rolcontract — QA");
    expect(qa.vermogens).toEqual(["lezen", "uitvoeren", "rapporteren"]);
    expect(qa.agent).toBe(true);
    expect(qa.bron).toBe("rollen/qa.md");
    expect(qa.contract).toContain("## 1. Doel");
    expect(qa.contract).toContain("BLOCKING_DECISION wanneer nodig.");
    expect(doc.rollen[0].agent).toBe(false);
    expect(doc.rollen[0].contract).toContain("Stuurt alles.");
  });

  it("draagt geen enkele naam van een werkomgeving of leverancier", () => {
    const tekst = genereerNeutraleAfgeleide(contracten(), "rollen");
    for (const naam of ["Lees", "Zoek", "Schrijf", "Bewerk", "Voer", "j-", "name:", "tools:"]) {
      expect(tekst).not.toContain(naam);
    }
  });

  it("is deterministisch en sorteert op rol, ongeacht de leesvolgorde", () => {
    const [orch, qa] = contracten();
    expect(genereerNeutraleAfgeleide([qa, orch], "rollen")).toBe(genereerNeutraleAfgeleide([orch, qa], "rollen"));
    expect(genereerNeutraleAfgeleide([orch, qa], "rollen").endsWith("}\n")).toBe(true);
  });

  it("drift op de neutrale afgeleide wordt gezien", () => {
    const afgeleiden = genereerAfgeleiden(contracten(), CONFIG_NEUTRAAL, "rollen", null);
    const schijf = new Map<string, string | null>(afgeleiden.map((a) => [a.pad, a.inhoud]));
    expect(vindDrift(afgeleiden, schijf)).toEqual([]);
    schijf.set("rollen.json", "{}\n");
    expect(vindDrift(afgeleiden, schijf)).toEqual([{ pad: "rollen.json", reden: "wijkt af van de bron" }]);
  });
});
