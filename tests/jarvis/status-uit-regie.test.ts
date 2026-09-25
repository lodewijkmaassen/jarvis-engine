/**
 * Het derde statusdocument komt uit dezelfde run als de regie.
 *
 * `jarvis/status` stond tot nu toe in een eigen stap van de routine. Dat is de
 * scheefstand die de eigenaar eerder zag bij `overzicht/huidig`: eindigde een
 * ronde anders dan in de afsluitstap, dan bleef de app een sessie melden die niet
 * meer liep, zonder dat iets dat meldde.
 *
 * T-20260917-autonome-opvolging, de stap "de drie statusdocumenten in één
 * afsluiting schrijven".
 */
import { describe, expect, it } from "vitest";
import { bouwStatus, type Regie, type RolRegie, type TaakRegie } from "@/jarvis/src/regie";

const NU = new Date("2026-09-25T16:00:00Z");

const taak = (over: Partial<TaakRegie> = {}): TaakRegie =>
  ({
    id: "T-1",
    titel: "T-1",
    project: "jarvis",
    toestand: "QUEUED",
    verantwoordelijke: "developer",
    waarom: "uitvoerbaar",
    volgende_stap: "De knop bouwen",
    wacht_op: null,
    blokkade: null,
    blokkade_rol: null,
    onderbroken: false,
    uitvoerbaar: true,
    uitvoerder: null,
    sinds: null,
    laatste_activiteit: null,
    ...over,
  }) as unknown as TaakRegie;

const rol = (over: Partial<RolRegie> = {}): RolRegie =>
  ({ rol: "developer", status: "beschikbaar", wat: null, taak: null, project: null, wachtrij: 0, uitvoerder: null, sinds: null, volgende_stap: null, laatste_activiteit: null, ...over }) as unknown as RolRegie;

const regie = (over: Partial<Regie> = {}): Regie =>
  ({ gegenereerd_op: NU.toISOString(), taken: [], rollen: [], uitvoerbaar: [], afwijkingen: [], ...over }) as Regie;

describe("bouwStatus — de sessieregel die de app leest", () => {
  it("zet de naam, de rol en een vers levensteken", () => {
    const s = bouwStatus(regie(), { naam: "Jarvis — cloud-uitvoerder", nu: NU });
    expect(s.sessie.naam).toBe("Jarvis — cloud-uitvoerder");
    expect(s.sessie.rol).toBe("orchestrator");
    expect(s.sessie.laatste).toBe(NU.toISOString());
  });

  it("houdt `sinds` van de vorige versie vast", () => {
    // Anders leest de app elke ronde als een nieuwe sessie.
    const eerder = "2026-09-25T09:00:00.000Z";
    expect(bouwStatus(regie(), { naam: "x", sinds: eerder, nu: NU }).sessie.sinds).toBe(eerder);
    expect(bouwStatus(regie(), { naam: "x", sinds: null, nu: NU }).sessie.sinds).toBe(NU.toISOString());
  });

  it("zet de eerste uitvoerbare taak in `bezig_met`, en niets als er geen werk is", () => {
    const met = bouwStatus(regie({ uitvoerbaar: [taak()] }), { naam: "x", nu: NU });
    expect(met.sessie.bezig_met).toBe("T-1: De knop bouwen");
    expect(bouwStatus(regie(), { naam: "x", nu: NU }).sessie.bezig_met).toBe("");
  });

  it("kort een lange volgende stap af en haalt regeleinden weg", () => {
    const lang = `Doe dit\nen dan dat, ${"x".repeat(200)}`;
    const s = bouwStatus(regie({ uitvoerbaar: [taak({ volgende_stap: lang })] }), { naam: "x", nu: NU });
    expect(s.sessie.bezig_met).not.toContain("\n");
    expect(s.sessie.bezig_met.length).toBeLessThanOrEqual(130);
  });

  it("noemt alleen rollen die werkelijk iets doen of iets in de wachtrij hebben", () => {
    const s = bouwStatus(
      regie({
        rollen: [
          rol({ rol: "developer", status: "bezig", wat: "bouwt de knop" }),
          rol({ rol: "qa", status: "beschikbaar", wachtrij: 2, wat: "2 taken in de wachtrij" }),
          rol({ rol: "reviewer", status: "beschikbaar", wachtrij: 0 }),
        ],
      }),
      { naam: "x", nu: NU },
    );
    expect(s.agenten.map((a) => a.naam)).toEqual(["developer", "qa"]);
    expect(s.agenten[0].wat).toBe("bouwt de knop");
    // Een lijst van zeven rollen die allemaal "beschikbaar" heten, zegt niets.
    expect(s.agenten.some((a) => a.naam === "reviewer")).toBe(false);
  });

  it("telt in de toelichting hetzelfde als de slotregel van de opdracht", () => {
    const s = bouwStatus(
      regie({
        taken: [taak(), taak({ id: "T-2", toestand: "BLOCKED", uitvoerbaar: false })],
        uitvoerbaar: [taak()],
        afwijkingen: [taak({ id: "T-2", toestand: "BLOCKED" })],
      }),
      { naam: "x", nu: NU },
    );
    expect(s.toelichting).toBe("2 open taak/taken, 1 uitvoerbaar, 1 geblokkeerd, 1 afwijking(en).");
  });

  it("draagt geen enkel veld dat de app niet leest", () => {
    // De app leest sessie.{naam,rol,laatste,sinds,bezig_met}, agenten[] en
    // toelichting. Een extra veld hier is stille dode data in de database.
    const s = bouwStatus(regie(), { naam: "x", nu: NU });
    expect(Object.keys(s).sort()).toEqual(["agenten", "sessie", "toelichting"]);
    expect(Object.keys(s.sessie).sort()).toEqual(["bezig_met", "laatste", "naam", "rol", "sinds"]);
  });
});
