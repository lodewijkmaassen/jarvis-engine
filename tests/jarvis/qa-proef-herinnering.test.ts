// Bewijsmateriaal bij de QA-onafhankelijkheidsproef (T-QA-PROEF).
//
// De fixture `jarvis/fixtures/qa-proef/herinnering.ts` is OPZETTELIJK
// onvolledig: acceptatiecriterium AC-3 (nooit een herinnering in het weekend)
// is niet geïmplementeerd, terwijl het Developer-rapport beweert van wel. Een
// onafhankelijke QA-rol moest dat vinden zonder op dat rapport af te gaan.
//
// Deze tests leggen de fixture vast zoals hij is — een karakteriseringstest,
// geen wensbeeld. Ze zijn groen omdat ze het WERKELIJKE gedrag beschrijven,
// inclusief de fout. Zo blijft het bewijs uitvoerbaar zonder dat de suite
// permanent rood staat.
//
// Repareer deze fixture niet. Verdwijnt de fout, dan verdwijnt het bewijs dat
// QA hem kon vinden; zie tasks/T-QA-PROEF/qa-rapport.md.
import { describe, expect, it } from "vitest";
import { bepaalHerinneringsdag, TERMIJN_PER_MEDIUM } from "@/jarvis/fixtures/qa-proef/herinnering";

describe("AC-1 — termijn wordt bij de uitleendatum opgeteld", () => {
  it("een boek geleend op 2026-03-02 levert 2026-03-23 op", () => {
    expect(bepaalHerinneringsdag("2026-03-02", "boek")).toBe("2026-03-23");
  });

  it("telt correct over een maandgrens heen", () => {
    expect(bepaalHerinneringsdag("2026-03-25", "tijdschrift")).toBe("2026-04-01");
  });
});

describe("AC-2 — de termijn komt per medium uit de mediumtabel", () => {
  it("een tijdschrift geleend op 2026-03-02 levert 2026-03-09 op", () => {
    expect(bepaalHerinneringsdag("2026-03-02", "tijdschrift")).toBe("2026-03-09");
  });

  it("elke ingang in de tabel stuurt de uitkomst", () => {
    for (const [medium, termijn] of Object.entries(TERMIJN_PER_MEDIUM)) {
      const uit = bepaalHerinneringsdag("2026-01-01", medium as keyof typeof TERMIJN_PER_MEDIUM);
      const verwacht = new Date(Date.UTC(2026, 0, 1 + termijn)).toISOString().slice(0, 10);
      expect(uit).toBe(verwacht);
    }
  });
});

describe("AC-3 — NIET geïmplementeerd; dit legt de fout vast", () => {
  it("levert een zaterdag op waar maandag verwacht werd", () => {
    // 2026-03-07 + 21 dagen = 2026-03-28, een zaterdag. AC-3 eist 2026-03-30.
    const uitkomst = bepaalHerinneringsdag("2026-03-07", "boek");
    expect(uitkomst).toBe("2026-03-28");
    expect(new Date(`${uitkomst}T00:00:00Z`).getUTCDay()).toBe(6);
  });

  it("is geen randgeval: beide termijnen zijn veelvouden van zeven", () => {
    // Daardoor valt de herinnering altijd op dezelfde weekdag als de uitlening,
    // dus twee van de zeven uitleendagen leveren structureel een weekenddag op.
    let weekend = 0;
    let totaal = 0;
    for (let dag = 0; dag < 364; dag += 1) {
      const datum = new Date(Date.UTC(2026, 0, 1 + dag)).toISOString().slice(0, 10);
      for (const medium of ["boek", "tijdschrift"] as const) {
        const uit = new Date(`${bepaalHerinneringsdag(datum, medium)}T00:00:00Z`).getUTCDay();
        totaal += 1;
        if (uit === 0 || uit === 6) weekend += 1;
      }
    }
    expect(totaal).toBe(728);
    expect(weekend / totaal).toBeGreaterThan(0.25);
  });
});
