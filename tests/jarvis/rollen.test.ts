// Providerafgeleiden van de rolcontracten: uit de bron gegenereerd, nooit met
// de hand. De QA van v1 mat dat de enige afgeleide twee secties miste; deze
// tests zetten vast dat de afgeleide het contract volledig draagt, dat de
// gereedschapsnamen uit de configuratie komen en niet uit de engine, en dat
// drift wordt gezien.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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

  // Zoeken naar de gereedschapsnamen van de fixture toetst niets: die kunnen per
  // constructie niet in de uitvoer staan, en een mutatie die de échte namen van een
  // werkomgeving toevoegt komt er gewoon langs. Pin daarom de sleutelverzameling
  // zelf - dan valt elk nieuw veld op, of het nu `gereedschap` heet of `gegenereerd_op`.
  it("draagt precies deze sleutels, zodat er niets van een omgeving bij kan sluipen", () => {
    const r = leesRolcontract("qa.md", CONTRACT);
    if (!r.ok) throw new Error(r.fout);
    const manifest = JSON.parse(genereerManifest([r.contract], "rollen"));
    expect(Object.keys(manifest)).toEqual(["versie", "gegenereerd_door", "bron", "toelichting", "rollen"]);
    expect(Object.keys(manifest.rollen[0])).toEqual(["rol", "titel", "samenvatting", "vermogens", "agent", "bron", "contract"]);
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

  // Twee aanroepen na elkaar vallen in dezelfde milliseconde, dus een tijdstempel
  // glipt erdoor. Zet de klok tussen de twee generaties een jaar vooruit.
  it("is deterministisch, ook als de klok verspringt", () => {
    const r = leesRolcontract("qa.md", CONTRACT);
    if (!r.ok) throw new Error(r.fout);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const eerste = genereerManifest([r.contract], "rollen");
      vi.setSystemTime(new Date("2027-06-30T12:34:56Z"));
      expect(genereerManifest([r.contract], "rollen")).toBe(eerste);
    } finally {
      vi.useRealTimers();
    }
  });

  // Elke fixture hierboven is een paar regels lang; de echte contracten zijn ruim
  // elfduizend tekens. Precies de fout die deze taak veroorzaakte - twee ontbrekende
  // secties - heeft die ordegrootte en zou op een korte fixture onzichtbaar zijn.
  // Deze test draait de generator daarom op de bron zelf.
  it("draagt de echte contracten volledig, teken voor teken", async () => {
    const rollenMap = path.join(__dirname, "..", "..", "jarvis", "roles");
    const namen = (await readdir(rollenMap)).filter((n) => /\.md$/i.test(n)).sort();
    expect(namen.length).toBeGreaterThanOrEqual(5);
    const contracten = [];
    for (const naam of namen) {
      const gelezen = leesRolcontract(naam, await readFile(path.join(rollenMap, naam), "utf8"));
      if (!gelezen.ok) throw new Error(gelezen.fout);
      contracten.push(gelezen.contract);
    }
    const manifest = JSON.parse(genereerManifest(contracten, "jarvis/roles"));
    expect(manifest.rollen).toHaveLength(namen.length);
    for (const contract of contracten) {
      const uit = manifest.rollen.find((r: { rol: string }) => r.rol === contract.rol);
      expect(uit, `rol ${contract.rol} ontbreekt in het manifest`).toBeDefined();
      // Geen toContain en geen trim-vergelijking: byte voor byte, anders is afkappen onzichtbaar.
      expect(uit.contract).toBe(contract.tekst.trimEnd());
      expect(uit.contract.length).toBeGreaterThan(1000);
    }
  });
});
