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

  it("heeft contents: write, anders kan de samenvoeging niet slagen", () => {
    expect(yml).toMatch(/^\s{2}contents: write$/m);
  });

  it("draait nog altijd de code van de hoofdbranch en niet die van de pull request", () => {
    // Zonder dit zou een pull request de beslissende code kunnen aanpassen om
    // zichzelf goed te keuren — en met mergerecht erbij weegt dat zwaarder
    // dan voorheen.
    expect(yml).toMatch(/ref:\s*main/);
    expect(yml).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request\.head/);
  });

  it("vraagt geen rechten die het samenvoegen niet nodig heeft", () => {
    const blok = /permissions:\n((?:\s+#[^\n]*\n|\s{2}[a-z-]+: [a-z]+\n)+)/.exec(yml)?.[1] ?? "";
    const rechten = [...blok.matchAll(/^\s{2}([a-z-]+): ([a-z]+)$/gm)].map((m) => `${m[1]}:${m[2]}`);
    expect(rechten.sort()).toEqual(["checks:read", "contents:write", "pull-requests:write"]);
  });
});
