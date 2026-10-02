/**
 * Wat: bewaakt dat de kaart in rust vier hoofdbollen om Jarvis toont en geen
 * gesloten dossier als bol opvoert.
 *
 * Waarom: na de reset van 2026-09-28 meldde de Task Controller nul open taken,
 * terwijl de kaart nog achtentwintig ballen rond Jarvis tekende — elf afgerond
 * en zeventien vervallen. Twee oorzaken, en de suite zag geen van beide. Het
 * eigen werk van de kern werd los om de kern heen gehangen, zodat elke taak een
 * eigen hoofdbol werd; en de gesloten dossiers vielen alleen weg door een
 * filter die nergens was vastgelegd en dus stil kon verdwijnen.
 *
 * Deze test vangt de klasse: hij leest `jarvis.html` als tekst, want de kaart
 * draait in de browser en heeft hier geen DOM. Wie de boom herschrijft en een
 * van de vier takken of het sluitwoordfilter laat vallen, faalt hier.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sluitDossier } from "@/jarvis/src/overzicht";

const HTML = readFileSync(path.join(process.cwd(), "jarvis/interface/jarvis.html"), "utf8");

/** Het lichaam van `bouwBoom()`: waar de kaart haar knopen vandaan haalt. */
function bouwBoom(): string {
  const m = /function bouwBoom\(\) \{([\s\S]*?)\n\}/.exec(HTML);
  if (!m) throw new Error("bouwBoom is niet gevonden in jarvis.html");
  return m[1];
}

describe("de kaart in rust", () => {
  it("hangt de twee vaste takken van Jarvis onder de kern, zodat er vier hoofdbollen staan", () => {
    const body = bouwBoom();
    expect(body).toContain('label: "Ideeën"');
    expect(body).toContain('label: "Doorontwikkeling Jarvis"');
    // De projecten leveren de andere twee: elk niet-centraal project één bol.
    expect(body).toContain("o.projecten.filter((p) => p.id !== o.centraal)");
  });

  it("hangt het eigen werk van de kern ónder een tak en niet los om de kern heen", () => {
    const body = bouwBoom();
    // De oude vorm duwde de taken van de kern rechtstreeks op de wortel.
    expect(body).not.toContain("root.kinderen.push(...projectTakken(kern))");
    expect(body).toContain("kinderen: kern ? projectTakken(kern) : []");
  });

  it("laat geen gesloten dossier als bol op de kaart komen", () => {
    expect(bouwBoom()).toContain("p.taken.filter((t) => !sluitDossier(t.status))");
  });

  it("gebruikt in de kaart hetzelfde sluitwoord als de engine, zodat de twee niet uiteenlopen", () => {
    const m = /function sluitDossier\(status\) \{ return ([^;]*); \}/.exec(HTML);
    expect(m, "sluitDossier is niet gevonden in jarvis.html").toBeTruthy();
    const uitdrukking = m![1];
    for (const status of ["afgerond", "vervallen"]) {
      expect(sluitDossier(status), `de engine sluit ${status}`).toBe(true);
      expect(uitdrukking, `de kaart sluit ${status}`).toContain(`"${status}"`);
    }
    for (const status of ["actief", "review"]) {
      expect(sluitDossier(status), `de engine sluit ${status} niet`).toBe(false);
      expect(uitdrukking, `de kaart sluit ${status} niet`).not.toContain(`"${status}"`);
    }
  });

  it("geeft een vaste tak de ruimte van een hoofdbol in de lay-out", () => {
    // Zonder deze drie krijgt een onbekende soort de maat van een blad en
    // schuiven de labels van de hoofdbollen over elkaar heen.
    expect(HTML).toContain('if (n.soort === "tak") return Math.max(100,');
    expect(HTML).toMatch(/function schijfMaat\(n\) \{ return n\.soort === "project" \|\| n\.soort === "tak"/);
    expect(HTML).toMatch(/const eigen = n\.soort === "project" \|\| n\.soort === "tak"/);
  });
});
