// Providerafgeleiden van de rolcontracten: uit de bron gegenereerd, nooit met
// de hand. De QA van v1 mat dat de enige afgeleide twee secties miste; deze
// tests zetten vast dat de afgeleide het contract volledig draagt, dat de
// gereedschapsnamen uit de configuratie komen en niet uit de engine, en dat
// drift wordt gezien.
import { describe, expect, it } from "vitest";
import {
  ROLLEN_EIND,
  ROLLEN_START,
  genereerAfgeleiden,
  genereerAgentdefinitie,
  genereerManifest,
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
  manifest: "",
  gereedschap: { lezen: "Lees, Zoek", schrijven: "Schrijf, Bewerk", rapporteren: "Schrijf", uitvoeren: "Voer" },
};

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

  it("is deterministisch", () => {
    const r = leesRolcontract("qa.md", CONTRACT);
    if (!r.ok) throw new Error(r.fout);
    const a = genereerAfgeleiden([r.contract], CONFIG, "rollen", null);
    const b = genereerAfgeleiden([r.contract], CONFIG, "rollen", null);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// Het manifest is de tweede afgeleide: de vorm waarmee een ander gereedschap
// de rollen kan overnemen. Deze tests zetten vast wat die wissel mogelijk
// maakt - het contract volledig, de vermogens neutraal - en wat hem juist zou
// blokkeren: gereedschapsnamen van één omgeving die erin lekken.
describe("leveranciersneutraal manifest", () => {
  it("draagt elk contract volledig, met de neutrale vermogens", () => {
    const r = leesRolcontract("qa.md", CONTRACT);
    if (!r.ok) throw new Error(r.fout);
    const manifest = JSON.parse(genereerManifest([r.contract], "rollen"));
    expect(manifest.versie).toBe(1);
    expect(manifest.bron).toBe("rollen");
    expect(manifest.rollen).toHaveLength(1);
    const qa = manifest.rollen[0];
    expect(qa.rol).toBe("qa");
    expect(qa.titel).toBe("Rolcontract — QA");
    expect(qa.samenvatting).toBe("Toetst onafhankelijk.");
    expect(qa.vermogens).toEqual(["lezen", "uitvoeren", "rapporteren"]);
    expect(qa.agent).toBe(true);
    expect(qa.bron).toBe("rollen/qa.md");
    expect(qa.contract).toContain("## 1. Doel");
    expect(qa.contract.trim()).toBe(r.contract.tekst.trim());
  });

  it("bevat geen gereedschapsnaam van een werkomgeving", () => {
    const r = leesRolcontract("qa.md", CONTRACT);
    if (!r.ok) throw new Error(r.fout);
    const uit = genereerManifest([r.contract], "rollen");
    for (const naam of ["Lees", "Zoek", "Schrijf", "Bewerk", "Voer", "tools:", "name:"]) {
      expect(uit).not.toContain(naam);
    }
  });

  it("neemt ook een rol zonder eigen agentdefinitie mee, op vaste volgorde", () => {
    const qa = leesRolcontract("qa.md", CONTRACT);
    const orch = leesRolcontract("orchestrator.md", "---\nsamenvatting: Stuurt.\nvermogens:\n  - lezen\nagent: nee\n---\n# Rolcontract — Orchestrator\n");
    if (!qa.ok || !orch.ok) throw new Error("fixture");
    const manifest = JSON.parse(genereerManifest([qa.contract, orch.contract], "rollen"));
    expect(manifest.rollen.map((r: { rol: string }) => r.rol)).toEqual(["orchestrator", "qa"]);
    expect(manifest.rollen[0].agent).toBe(false);
  });

  it("wordt alleen gegenereerd als de configuratie een pad noemt, en telt mee in de driftcontrole", () => {
    const r = leesRolcontract("qa.md", CONTRACT);
    if (!r.ok) throw new Error(r.fout);
    expect(genereerAfgeleiden([r.contract], CONFIG, "rollen", null).map((a) => a.pad)).not.toContain("rollen.json");
    const metManifest = genereerAfgeleiden([r.contract], { ...CONFIG, manifest: "rollen.json" }, "rollen", null);
    expect(metManifest.map((a) => a.pad)).toEqual(["agents/j-qa.md", "INSTAP.md", "rollen.json"]);
    expect(vindDrift(metManifest, new Map([["rollen.json", "{}"]]))).toContainEqual({ pad: "rollen.json", reden: "wijkt af van de bron" });
  });

  it("is deterministisch", () => {
    const r = leesRolcontract("qa.md", CONTRACT);
    if (!r.ok) throw new Error(r.fout);
    expect(genereerManifest([r.contract], "rollen")).toBe(genereerManifest([r.contract], "rollen"));
  });
});
