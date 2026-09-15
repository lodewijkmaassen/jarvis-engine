import { describe, expect, it } from "vitest";
import type { Overzicht, TaakItem } from "@/jarvis/src/overzicht";
import { HEARTBEAT_MINUTEN, bepaalRegie, rolVoorStap, type Activiteit } from "@/jarvis/src/regie";

const NU = new Date("2026-09-14T22:00:00Z");
const iso = (minutenGeleden: number) => new Date(NU.getTime() - minutenGeleden * 60_000).toISOString();

function taak(id: string, over: Partial<TaakItem> = {}): TaakItem {
  return {
    id, titel: id, status: "actief", klasse: "S", project: "jarvis", gastheer: "jarvis",
    stappen: [{ tekst: "Gedaan", gedaan: true }, { tekst: "Bouw de knop", gedaan: false }],
    aan_zet: "jarvis", wacht_op: "Bouw de knop", laatste_beweging: iso(600), stil: false, scope: "x", scope_hash: "y", akkoord_nodig: false,
    ...over,
  };
}
function overzicht(taken: TaakItem[]): Overzicht {
  return { versie: 1, gegenereerd_op: NU.toISOString(), centraal: "jarvis", projecten: [{ id: "jarvis", naam: "Jarvis", aangesloten: true, hoofdbranch: null, stand: [], feiten: [], recent: [], taken, kennis: {}, aandacht: [] }], voor_jou: [] } as unknown as Overzicht;
}
const act = (over: Partial<Activiteit>): Activiteit => ({ op: iso(5), uitvoerder: "cloud", rol: "developer", taak: "T-1", project: "jarvis", soort: "stap", tekst: "iets", verwijzing: null, ...over });

describe("regie — toestand per open taak", () => {
  it("QUEUED: uitvoerbaar, niemand werkt eraan; de rol volgt uit de stap", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), [], NU);
    expect(r.taken[0]).toMatchObject({ toestand: "QUEUED", verantwoordelijke: "developer", uitvoerbaar: true, volgende_stap: "Bouw de knop" });
    expect(r.uitvoerbaar.map((t) => t.id)).toEqual(["T-1"]);
  });
  it("RUNNING zolang de heartbeat leeft; daarna weer QUEUED als uitgevallen", () => {
    const claim = act({ soort: "claim", op: iso(30), tekst: "opgepakt" });
    const levend = bepaalRegie(overzicht([taak("T-1")]), [claim, act({ soort: "heartbeat", op: iso(10) })], NU);
    expect(levend.taken[0]).toMatchObject({ toestand: "RUNNING", verantwoordelijke: "developer", uitvoerder: "cloud", uitvoerbaar: false });
    expect(levend.rollen.find((r) => r.rol === "developer")).toMatchObject({ status: "bezig", taak: "T-1" });
    const oud = act({ soort: "claim", op: iso(HEARTBEAT_MINUTEN.developer + 40), tekst: "opgepakt" });
    const dood = bepaalRegie(overzicht([taak("T-1")]), [oud, act({ soort: "heartbeat", op: iso(HEARTBEAT_MINUTEN.developer + 5) })], NU);
    expect(dood.taken[0].toestand).toBe("QUEUED");
    expect(dood.taken[0].waarom).toMatch(/geen teken meer/);
  });
  it("vrijgave of klaar beëindigt de uitvoering", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), [act({ soort: "claim", op: iso(20) }), act({ soort: "vrijgave", op: iso(2) })], NU);
    expect(r.taken[0].toestand).toBe("QUEUED");
  });
  it("BLOCKED na een fout zonder latere stap", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), [act({ soort: "claim", op: iso(20) }), act({ soort: "fout", op: iso(3), tekst: "tests rood" })], NU);
    expect(r.taken[0]).toMatchObject({ toestand: "BLOCKED", uitvoerbaar: true });
    expect(r.taken[0].waarom).toMatch(/tests rood/);
    expect(r.rollen.find((x) => x.rol === "developer")?.status).toBe("geblokkeerd");
    expect(r.uitvoerbaar[0].id).toBe("T-1"); // herstel gaat voor
  });
  it("WAITING_FOR_USER als de eigenaar aan zet is (eigenaarspunt of akkoord)", () => {
    const r = bepaalRegie(overzicht([taak("T-1", { aan_zet: "eigenaar", wacht_op: "Akkoord van de eigenaar op deze taak", akkoord_nodig: true })]), [], NU);
    expect(r.taken[0]).toMatchObject({ toestand: "WAITING_FOR_USER", verantwoordelijke: "eigenaar", uitvoerbaar: false });
  });
  it("WAITING_FOR_DEPENDENCY op een taak die nog loopt, en niet meer zodra die is afgerond", () => {
    const wacht = taak("T-20260901-b", { stappen: [{ tekst: "Inrichten — wacht op T-20260901-a", gedaan: false }], wacht_op: "Inrichten — wacht op T-20260901-a" });
    const loopt = bepaalRegie(overzicht([taak("T-20260901-a"), wacht]), [], NU);
    expect(loopt.taken.find((t) => t.id === "T-20260901-b")).toMatchObject({ toestand: "WAITING_FOR_DEPENDENCY", wacht_op: "T-20260901-a", uitvoerbaar: false });
    const klaar = bepaalRegie(overzicht([taak("T-20260901-a", { status: "afgerond" }), wacht]), [], NU);
    expect(klaar.taken.find((t) => t.id === "T-20260901-b")?.toestand).toBe("QUEUED");
  });
  it("AFWIJKING als de taak waarop gewacht wordt in geen enkel project bestaat", () => {
    const r = bepaalRegie(overzicht([taak("T-1", { stappen: [{ tekst: "Inrichten — wacht op T-20260101-spook", gedaan: false }] })]), [], NU);
    expect(r.taken[0]).toMatchObject({ toestand: "AFWIJKING", uitvoerbaar: true, wacht_op: "T-20260101-spook" });
  });
  it("WAITING_FOR_DEPENDENCY op een pull request tot die is samengevoegd (merge-activiteit of mergecommit)", () => {
    const wacht = taak("T-1", { stappen: [{ tekst: "Herpinnen — wacht op PR #26", gedaan: false }], wacht_op: "Herpinnen — wacht op PR #26" });
    const open = bepaalRegie(overzicht([wacht]), [], NU);
    expect(open.taken[0]).toMatchObject({ toestand: "WAITING_FOR_DEPENDENCY", wacht_op: "PR #26", uitvoerbaar: false });
    const merge = act({ soort: "merge", rol: "orchestrator", taak: null, verwijzing: "lodewijkmaassen/jarvis-engine#26", tekst: "pull request #26 samengevoegd" });
    expect(bepaalRegie(overzicht([wacht]), [merge], NU).taken[0]).toMatchObject({ toestand: "QUEUED", uitvoerbaar: true });
    // Een andere PR met hetzelfde nummer telt niet als de stap de repository noemt.
    const precies = taak("T-1", { stappen: [{ tekst: "Herpinnen — wacht op PR lodewijkmaassen/tovas-flow#26", gedaan: false }] });
    expect(bepaalRegie(overzicht([precies]), [merge], NU).taken[0].toestand).toBe("WAITING_FOR_DEPENDENCY");
    // De mergecommit in de recente historie volstaat ook.
    const o = overzicht([wacht]);
    (o.projecten[0] as unknown as { recent: unknown[] }).recent = [{ datum: iso(1), hash: "abc1234", onderwerp: "Merge pull request #26 from x/jarvis/regie", rol: null, taak: null, soort: "merge" }];
    expect(bepaalRegie(o, [], NU).taken[0].toestand).toBe("QUEUED");
  });
  it("DONE als alle stappen af zijn: de afronding is uitvoerbaar werk voor de kennisbeheerder", () => {
    const r = bepaalRegie(overzicht([taak("T-1", { stappen: [{ tekst: "Klaar", gedaan: true }] })]), [], NU);
    expect(r.taken[0]).toMatchObject({ toestand: "DONE", verantwoordelijke: "knowledge-manager", uitvoerbaar: true });
  });
  it("AFWIJKING zonder voortgangsstappen", () => {
    const r = bepaalRegie(overzicht([taak("T-1", { stappen: [] })]), [], NU);
    expect(r.taken[0].toestand).toBe("AFWIJKING");
    expect(r.afwijkingen).toHaveLength(1);
  });
  it("telt een dossierspiegel in een ander project niet als tweede taak", () => {
    const o = overzicht([taak("T-1")]);
    const dubbel = { ...o, projecten: [...o.projecten, { ...o.projecten[0], id: "kasboek", naam: "Kasboek" }] } as Overzicht;
    expect(bepaalRegie(dubbel, [], NU).taken).toHaveLength(1);
  });
  it("de task-controller is bezig na een recente regie-run en noemt het volgende uitvoerbare werk", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), [act({ soort: "regie", rol: "task-controller", taak: null, op: iso(2), tekst: "regie" })], NU);
    const tc = r.rollen.find((x) => x.rol === "task-controller");
    expect(tc).toMatchObject({ status: "bezig", wachtrij: 1 });
    expect(tc?.volgende_stap).toMatch(/^T-1: Bouw de knop/);
  });
});

describe("rolVoorStap", () => {
  it("kiest de rol op de tekst van de stap", () => {
    expect(rolVoorStap("QA-ronde 2 laten draaien")).toBe("qa");
    expect(rolVoorStap("Onderzoek: welke rollen volgen uit de architectuur")).toBe("architect");
    expect(rolVoorStap("Dossier afronden en DEC-0045 vastleggen")).toBe("knowledge-manager");
    expect(rolVoorStap("Bouw: de Team-view in de app")).toBe("developer");
  });
});
