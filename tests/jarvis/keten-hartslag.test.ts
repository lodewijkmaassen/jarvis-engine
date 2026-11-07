import { describe, expect, it } from "vitest";
import { ketenSpoor, KETEN_SPOOR_MINUTEN, KETEN_STILSTAND_MINUTEN, WACHTENDE_TOESTANDEN } from "@/jarvis/src/doelen";

/**
 * Het spoor dat een ketenronde nalaat, en wanneer dat stilstand heet (RSK-0034).
 *
 * De keten wordt vanuit de database gestart zodra er werk is — gemeten op
 * 2026-11-07: elke twee minuten. Wat ontbrak was het zien dat die starter
 * wegvalt: dan gebeurt er niets, en meldt niets dat er niets gebeurt.
 */
const NU = new Date("2026-11-07T12:00:00Z");
const geleden = (minuten: number) => new Date(NU.getTime() - minuten * 60_000).toISOString();

describe("wanneer een ronde een spoor schrijft", () => {
  it("schrijft altijd als er nog geen spoor is", () => {
    const s = ketenSpoor({ nu: NU, vorige: null, oorzaak: "schedule", wachtend: 0 });
    expect(s.schrijven).toBe(true);
    expect(s.stilstand).toBe(false);
    expect(s.tekst).toContain("eerste spoor");
  });

  it("schrijft niet bij elke ronde: tijdens druk werk draait zij elke twee minuten", () => {
    expect(ketenSpoor({ nu: NU, vorige: geleden(2), oorzaak: "workflow_dispatch", wachtend: 3 }).schrijven).toBe(false);
    expect(ketenSpoor({ nu: NU, vorige: geleden(KETEN_SPOOR_MINUTEN - 1), oorzaak: "schedule", wachtend: 0 }).schrijven).toBe(false);
  });

  it("schrijft zodra het tien minuten geleden is", () => {
    const s = ketenSpoor({ nu: NU, vorige: geleden(KETEN_SPOOR_MINUTEN), oorzaak: "schedule", wachtend: 0 });
    expect(s.schrijven).toBe(true);
    expect(s.tekst).toContain(`vorige ronde ${KETEN_SPOOR_MINUTEN} min geleden`);
  });
});

describe("wanneer een gat stilstand heet", () => {
  it("heet stilstand zodra het gat te groot is en er werk stond", () => {
    const s = ketenSpoor({ nu: NU, vorige: geleden(KETEN_STILSTAND_MINUTEN), oorzaak: "schedule", wachtend: 1 });
    expect(s.stilstand).toBe(true);
    expect(s.schrijven).toBe(true);
    expect(s.tekst).toContain("STILSTAND");
    expect(s.tekst).toContain("1 doel(en) wachtend");
  });

  it("heet geen stilstand als er niets te doen was: dan hoeft er geen ronde te zijn", () => {
    const s = ketenSpoor({ nu: NU, vorige: geleden(8 * 60), oorzaak: "schedule", wachtend: 0 });
    expect(s.stilstand).toBe(false);
    expect(s.tekst).toContain("niets te doen");
  });

  it("heet geen stilstand net onder de grens", () => {
    expect(ketenSpoor({ nu: NU, vorige: geleden(KETEN_STILSTAND_MINUTEN - 1), oorzaak: "schedule", wachtend: 2 }).stilstand).toBe(false);
  });

  it("noemt waardoor de ronde startte, zodat te zien is wie haar nog start", () => {
    expect(ketenSpoor({ nu: NU, vorige: geleden(20), oorzaak: "workflow_dispatch", wachtend: 1 }).tekst).toContain("(workflow_dispatch)");
    expect(ketenSpoor({ nu: NU, vorige: geleden(20), oorzaak: "", wachtend: 1 }).tekst).toContain("(onbekend)");
  });
});

describe("welke doelen op de keten wachten", () => {
  it("zijn de vier toestanden waarin er nog iets moet gebeuren", () => {
    expect([...WACHTENDE_TOESTANDEN].sort()).toEqual(["bezig", "open", "review", "samengevoegd"]);
    expect(WACHTENDE_TOESTANDEN).not.toContain("vast");
    expect(WACHTENDE_TOESTANDEN).not.toContain("klaar");
    expect(WACHTENDE_TOESTANDEN).not.toContain("gesloten");
  });
});
