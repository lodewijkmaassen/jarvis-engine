/**
 * De attestatieworkflow mag samenvoegen wat zij heeft goedgekeurd.
 *
 * De aanleiding zat niet in de governance maar in de uitvoeringsomgeving: de
 * uitvoerder kan `jarvis pr mergen` niet draaien, want de
 * permissieclassificatie van zijn omgeving weigert dat ook wanneer de
 * goedkeurende review er aantoonbaar staat — zij leest de opdrachtregel en
 * kan de autorisatietoestand niet zien. De laatste stap van een volledig
 * geautoriseerde keten bleef daardoor liggen voor een mens.
 *
 * Twee dingen moeten daarbij vastliggen, en dat is wat hier wordt getoetst:
 * de mogelijkheid staat standaard UIT, en zij kan niet stilletjes worden
 * aangezet zonder dat de workflow het recht heeft dat ervoor nodig is.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfigTekst } from "@/jarvis/src/config";
import { restPadAutorisatiesOpId, restPadToetsingOpId, UUID_VORM } from "@/jarvis/src/db";

const BASIS = [
  "project: proef",
  "enabled: true",
  "budget:",
  "  S: 8000",
  "  M: 20000",
  "  L: 40000",
  "limieten:",
  "  qa_rondes: 3",
  "  subagenten: 12",
  "  besluiten_per_taak: 1",
  "  nieuwe_dec_per_taak: 3",
  "  wallclock_minuten: 60",
].join("\n");

function config(extra: string) {
  const r = parseConfigTekst(`${BASIS}\n${extra}\n`);
  if (!r.ok) throw new Error(r.fouten.join("; "));
  return r.config;
}

describe("attestatie.samenvoegen", () => {
  it("staat uit wanneer het veld ontbreekt", () => {
    // De belangrijkste test van dit bestand. Een repository die niets zegt,
    // geeft de automatisering geen mergerecht — stilzwijgend aanzetten zou
    // precies de verruiming zijn die een bewuste keuze hoort te blijven.
    expect(config("attestatie:\n  bot: een-bot").attestatie.samenvoegen).toBe(false);
  });

  it("staat ook uit wanneer er helemaal geen attestatieblok is", () => {
    expect(config("knowledge_map: knowledge").attestatie.samenvoegen).toBe(false);
  });

  it("gaat alleen aan met een expliciete true", () => {
    expect(config("attestatie:\n  bot: een-bot\n  samenvoegen: true").attestatie.samenvoegen).toBe(true);
    expect(config("attestatie:\n  bot: een-bot\n  samenvoegen: false").attestatie.samenvoegen).toBe(false);
  });

  it("weigert een waarde die geen booleaan is in plaats van haar waarheidswaarde te raden", () => {
    const r = parseConfigTekst(`${BASIS}\nattestatie:\n  samenvoegen: misschien\n`);
    expect(r.ok).toBe(false);
  });
});

describe("de canonieke attestatieworkflow", () => {
  const yml = readFileSync(path.join(process.cwd(), "jarvis/canonical/jarvis-attestatie.yml"), "utf8");
  const spiegel = readFileSync(path.join(process.cwd(), ".github/workflows/jarvis-attestatie.yml"), "utf8");

  it("geeft op workflowniveau geen enkel recht", () => {
    // De kern van de scheiding: wie deze workflow spiegelt zonder de functie
    // aan te zetten, krijgt geen schrijfrecht op zijn hoofdbranch.
    expect(yml).toMatch(/^permissions: \{\}$/m);
  });

  it("geeft de attesterende job geen schrijfrecht op de inhoud", () => {
    const job = /^  attestatie:\n([\s\S]*?)(?=^  [a-z])/m.exec(yml)?.[1] ?? "";
    expect(job).toMatch(/contents: read/);
    expect(job).not.toMatch(/contents: write/);
  });

  it("geeft alleen de samenvoegende job contents: write, en niet meer dan nodig", () => {
    const job = /^  samenvoegen:\n([\s\S]*)/m.exec(yml)?.[1] ?? "";
    const blok = /permissions:\n((?:\s{6}[a-z-]+: [a-z]+\n)+)/.exec(job)?.[1] ?? "";
    const rechten = [...blok.matchAll(/^\s+([a-z-]+): ([a-z]+)$/gm)].map((m) => `${m[1]}:${m[2]}`);
    expect(rechten.sort()).toEqual(["checks:read", "contents:write", "pull-requests:read"]);
  });

  it("draait de samenvoegende job alleen wanneer de configuratie het aanzet", () => {
    expect(yml).toMatch(/if: needs\.attestatie\.outputs\.samenvoegen == 'true'/);
  });

  it("draait in beide jobs de code van de hoofdbranch en niet die van de pull request", () => {
    // Met mergerecht erbij weegt dit zwaarder dan voorheen: een pull request
    // mag de beslissende code nooit kunnen aanpassen om zichzelf goed te keuren.
    expect([...yml.matchAll(/ref: main/g)]).toHaveLength(2);
    expect(yml).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request\.head/);
  });

  it("is byte-identiek gespiegeld in deze repository", () => {
    expect(spiegel).toBe(yml);
  });
});

/**
 * De opzoeking op id via REST.
 *
 * Deze ontbrak, en de stub die er stond was erger dan niets: zij gaf een lege
 * uitkomst terug in plaats van een fout, zodat `verifieerAttestatie` elke
 * bestaande attestatie afwees met "bestaat niet in de database" terwijl de
 * rij er gewoon was. In een GitHub-runner — die geen databaserol heeft — kon
 * het samenvoegen daardoor nooit slagen, en de suite zag het niet omdat geen
 * enkele test deze weg raakte. Twee QA-ronden hadden hem nodig om boven water
 * te komen; hij hoort hier vast te liggen.
 */
describe("de REST-paden voor opzoeking op id", () => {
  const A = "11111111-2222-3333-4444-555555555555";
  const B = "66666666-7777-8888-9999-aaaaaaaaaaaa";

  it("zoekt meerdere autorisaties in één verzoek op", () => {
    const pad = restPadAutorisatiesOpId([A, B]);
    expect(pad).toContain("autorisaties_open?id=in.(");
    expect(pad).toContain(A);
    expect(pad).toContain(B);
  });

  it("vraagt niet minder rijen dan er id's zijn", () => {
    // Met het standaard limiet van 1 zou de tweede autorisatie van een pull
    // request die twee taken dient stilzwijgend ontbreken, en de attestatie
    // zou worden afgewezen op een rij die er wel is.
    expect(restPadAutorisatiesOpId([A, B])).toContain("limit=2");
    expect(restPadAutorisatiesOpId([A])).toContain("limit=1");
  });

  it("vraagt met een lege lijst geen onbegrensde zoekopdracht", () => {
    expect(restPadAutorisatiesOpId([])).toContain("limit=1");
  });

  it("zoekt de toetsing op haar eigen id, niet op de kop", () => {
    expect(restPadToetsingOpId(A)).toBe(`toetsingen_open?id=eq.${A}&limit=1`);
  });

  it("herkent alleen een echt uuid, zodat niets anders in een filter belandt", () => {
    expect(UUID_VORM.test(A)).toBe(true);
    for (const slecht of ["", "geen-uuid", `${A},${B}`, `${A})`, "*", "11111111-2222-3333-4444-5555555555"]) {
      expect(UUID_VORM.test(slecht), slecht).toBe(false);
    }
  });
});
