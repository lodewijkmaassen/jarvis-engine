/**
 * Wat: bewaakt dat de interface elke toestand kent die de regie kan opleveren.
 *
 * Waarom: `TOESTANDEN` in regie.ts en de interface in jarvis/interface/ zijn
 * twee lijsten die hetzelfde moeten weten, zonder dat iets ze aan elkaar
 * bindt. Toen `WAITING_FOR_EVENT` erbij kwam, verdween een taak met die
 * toestand volledig uit het blok "Open taken" van de Team-view — terwijl de
 * teller op diezelfde regel hem wél meetelde, zodat het aantal niet klopte met
 * wat eronder stond. De suite merkte daar niets van; een QA-ronde vond het.
 *
 * Deze test vangt de klasse, niet het geval: elke volgende toestand die aan
 * `TOESTANDEN` wordt toegevoegd faalt hier tot de interface hem ook kent.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOESTANDEN } from "@/jarvis/src/regie";

const HTML = readFileSync(path.join(process.cwd(), "jarvis/interface/jarvis.html"), "utf8");

/** De lijst waarover de Team-view de open taken groepeert. */
function groepeerLijst(): readonly string[] {
  const m = /\[((?:\s*"(?:[A-Z_]+)"\s*,?)+)\]\s*\.map\(\(ts\)/.exec(HTML);
  if (!m) throw new Error("de groepeerlijst van de Team-view is niet gevonden in jarvis.html");
  return [...m[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
}

/** De sleutels van TOESTAND_TEKST: de Nederlandse tekst per toestand. */
function toestandTekstSleutels(): readonly string[] {
  const m = /const TOESTAND_TEKST = \{([^}]*)\}/.exec(HTML);
  if (!m) throw new Error("TOESTAND_TEKST is niet gevonden in jarvis.html");
  return [...m[1].matchAll(/([A-Z_]+)\s*:/g)].map((x) => x[1]);
}

describe("de interface kent elke toestand van de regie", () => {
  it("groepeert de open taken over álle toestanden, zodat er geen taak uit de Team-view valt", () => {
    const lijst = groepeerLijst();
    expect([...TOESTANDEN].filter((t) => !lijst.includes(t))).toEqual([]);
  });

  it("groepeert geen toestand die de regie niet kent", () => {
    expect(groepeerLijst().filter((t) => !(TOESTANDEN as readonly string[]).includes(t))).toEqual([]);
  });

  it("heeft voor elke toestand een Nederlandse tekst, zodat er nooit een ruwe sleutel op het scherm komt", () => {
    const sleutels = toestandTekstSleutels();
    expect([...TOESTANDEN].filter((t) => !sleutels.includes(t))).toEqual([]);
  });

  it("geeft elke toestand een eigen kleurregel in de stijl", () => {
    const ontbreekt = [...TOESTANDEN].filter((t) => !HTML.includes(`.toestand.t-${t}{`) && !HTML.includes(`.toestand.t-${t},`));
    expect(ontbreekt).toEqual([]);
  });
});
