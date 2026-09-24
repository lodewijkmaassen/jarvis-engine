import { describe, expect, it } from "vitest";
import type { Overzicht, TaakItem } from "@/jarvis/src/overzicht";
import { readFileSync } from "node:fs";
import { HEARTBEAT_MINUTEN, UITVOERDER_TERMIJN_MINUTEN, bepaalRegie, rolVoorStap, uitvoerderToestand, type Activiteit, type UitvoerderItem, type Uitvoerders } from "@/jarvis/src/regie";

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
  it("RUNNING zolang de heartbeat leeft; daarna BLOCKED omdat de uitvoerder stilviel", () => {
    const claim = act({ soort: "claim", op: iso(30), tekst: "opgepakt" });
    const levend = bepaalRegie(overzicht([taak("T-1")]), [claim, act({ soort: "heartbeat", op: iso(10) })], NU);
    expect(levend.taken[0]).toMatchObject({ toestand: "RUNNING", verantwoordelijke: "developer", uitvoerder: "cloud", uitvoerbaar: false });
    expect(levend.rollen.find((r) => r.rol === "developer")).toMatchObject({ status: "bezig", taak: "T-1" });
    const oud = act({ soort: "claim", op: iso(HEARTBEAT_MINUTEN.developer + 40), tekst: "opgepakt" });
    const dood = bepaalRegie(overzicht([taak("T-1")]), [oud, act({ soort: "heartbeat", op: iso(HEARTBEAT_MINUTEN.developer + 5) })], NU);
    expect(dood.taken[0].toestand).toBe("BLOCKED");
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
  it("een stap die aan een uitvoerder is toegewezen is alleen werk voor die uitvoerder", () => {
    const stap = "Stap 1 — repository `ideeen` aanleggen. **Uitvoerder: laptop.** De cloud kan dit niet.";
    const t = taak("T-1", { stappen: [{ tekst: stap, gedaan: false }], wacht_op: stap });
    const cloud = bepaalRegie(overzicht([t]), [], NU, null, "cloud");
    expect(cloud.taken[0]).toMatchObject({ toestand: "WAITING_FOR_DEPENDENCY", verantwoordelijke: "task-controller", wacht_op: "laptop", uitvoerder: "laptop", uitvoerbaar: false });
    expect(cloud.taken[0].waarom).toMatch(/toegewezen aan uitvoerder laptop, niet aan cloud/);
    expect(cloud.uitvoerbaar).toEqual([]);
    const laptop = bepaalRegie(overzicht([t]), [], NU, null, "laptop");
    expect(laptop.taken[0]).toMatchObject({ toestand: "QUEUED", uitvoerder: "laptop", uitvoerbaar: true });
    expect(laptop.uitvoerbaar.map((x) => x.id)).toEqual(["T-1"]);
  });
  it("zonder bekende uitvoerder wacht een toegewezen stap, in plaats van aan iedereen te worden aangeboden", () => {
    const stap = "De app uitrollen. **Uitvoerder: laptop.**";
    const r = bepaalRegie(overzicht([taak("T-1", { stappen: [{ tekst: stap, gedaan: false }] })]), [], NU);
    expect(r.taken[0]).toMatchObject({ toestand: "WAITING_FOR_DEPENDENCY", wacht_op: "laptop", uitvoerbaar: false });
    expect(r.taken[0].waarom).toMatch(/weet niet welke uitvoerder ze draait/);
  });
  it("de toewijzing geldt alleen bij de markering, niet bij het woord uitvoerder in lopende tekst", () => {
    const stap = "Meten of de cloud-uitvoerder de branches kan opruimen";
    const r = bepaalRegie(overzicht([taak("T-1", { stappen: [{ tekst: stap, gedaan: false }] })]), [], NU, null, "cloud");
    expect(r.taken[0]).toMatchObject({ toestand: "QUEUED", uitvoerbaar: true });
  });
  it("een lopende uitvoering en een wachtende dependency gaan vóór de toewijzing", () => {
    const stap = "Herpinnen — wacht op PR #26. **Uitvoerder: cloud.**";
    const r = bepaalRegie(overzicht([taak("T-1", { stappen: [{ tekst: stap, gedaan: false }] })]), [], NU, null, "cloud");
    expect(r.taken[0]).toMatchObject({ toestand: "WAITING_FOR_DEPENDENCY", wacht_op: "PR #26" });
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
  // Een taak die op iets buiten Jarvis wacht viel terug op QUEUED en werd elke
  // run opnieuw aangeboden aan een uitvoerder die er niets mee kon — gemeten op
  // T-20260911-jarvis-app. De markering is expliciet en geen woordpatroon over
  // lopende tekst, zodat "er valt niets te dispatchen" nooit per ongeluk uit
  // een zinswending volgt.
  it("WAITING_FOR_EVENT bij een stap die op een gebeurtenis buiten Jarvis wacht, en niet uitvoerbaar", () => {
    const stap = "Wacht op gebeurtenis: de eigenaar typt de volgende opdracht in de app";
    const r = bepaalRegie(overzicht([taak("T-1", { stappen: [{ tekst: stap, gedaan: false }] })]), [], NU);
    expect(r.taken[0]).toMatchObject({
      toestand: "WAITING_FOR_EVENT",
      verantwoordelijke: "task-controller",
      uitvoerder: null,
      uitvoerbaar: false,
      wacht_op: "de eigenaar typt de volgende opdracht in de app",
    });
    expect(r.uitvoerbaar.some((t) => t.id === "T-1")).toBe(false);
  });

  it("legt WAITING_FOR_EVENT niet bij de eigenaar: er wordt niets van hem gevraagd (CON-0016)", () => {
    const stap = "Wacht op gebeurtenis: een klant meldt zich via het formulier";
    const r = bepaalRegie(overzicht([taak("T-1", { stappen: [{ tekst: stap, gedaan: false }] })]), [], NU);
    expect(r.taken[0].verantwoordelijke).not.toBe("eigenaar");
    expect(r.taken[0].toestand).not.toBe("WAITING_FOR_USER");
    expect(r.taken[0].waarom).toMatch(/er wordt niets van de eigenaar gevraagd/);
  });

  it("laat een gewone stap die het woord gebeurtenis noemt gewoon QUEUED", () => {
    const stap = "De gebeurtenistabel opschonen en de brug opnieuw meten";
    const r = bepaalRegie(overzicht([taak("T-1", { stappen: [{ tekst: stap, gedaan: false }] })]), [], NU);
    expect(r.taken[0]).toMatchObject({ toestand: "QUEUED", uitvoerbaar: true });
  });

  it("geeft de eigenaar voorrang: een akkoordstap blijft WAITING_FOR_USER, ook met een gebeurtenisstap erna", () => {
    const stappen = [
      { tekst: "Akkoord van de eigenaar op deze taak", gedaan: false },
      { tekst: "Wacht op gebeurtenis: de eerste import komt binnen", gedaan: false },
    ];
    const r = bepaalRegie(overzicht([taak("T-1", { stappen, aan_zet: "eigenaar", akkoord_nodig: true })]), [], NU);
    expect(r.taken[0].toestand).toBe("WAITING_FOR_USER");
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

// Een uitvoerder mag blokkeren; de regie mag dat nooit ongemerkt laten
// gebeuren. Gemeten geval (2026-09-17): een cloud-uitvoerder stond op een
// goedkeuringsvraag van een tool, hield zijn claim vast en meldde niets meer,
// terwijl opeenvolgende regierondes een rustige wachtrij bleven rapporteren.
describe("regie — een uitvoerder die stilvalt", () => {
  const stil = (minutenStil: number, over: Partial<Activiteit> = {}) => [
    act({ soort: "claim", op: iso(minutenStil + 10), tekst: "opgepakt", ...over }),
    act({ soort: "stap", op: iso(minutenStil), tekst: "bezig", ...over }),
  ];

  it("wordt BLOCKED en niet QUEUED zodra de heartbeat verloopt", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), stil(HEARTBEAT_MINUTEN.developer + 5), NU);
    expect(r.taken[0]).toMatchObject({ toestand: "BLOCKED", blokkade: "uitvoerder_stil", blokkade_rol: "developer", uitvoerder: "cloud" });
    expect(r.taken[0].waarom).toMatch(/houdt de claim vast/);
  });

  it("telt als afwijking, want hij meldt zichzelf niet", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), stil(HEARTBEAT_MINUTEN.developer + 5), NU);
    expect(r.afwijkingen.map((t) => t.id)).toEqual(["T-1"]);
    expect(r.rollen.find((x) => x.rol === "task-controller")?.wat).toMatch(/1 afwijking/);
  });

  it("legt het herstel bij de task-controller en nooit bij de eigenaar", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), stil(HEARTBEAT_MINUTEN.developer + 5), NU);
    expect(r.taken[0].verantwoordelijke).toBe("task-controller");
    expect(r.taken[0].verantwoordelijke).not.toBe("eigenaar");
    expect(r.taken[0].volgende_stap).toMatch(/claim van developer \(cloud\) vrijgeven/);
    expect(r.taken[0].waarom).toMatch(/werk voor Jarvis, niet voor de eigenaar/);
  });

  it("blijft uitvoerbaar en gaat vóór op gewoon werk, zodat herstel eerst komt", () => {
    const r = bepaalRegie(overzicht([taak("T-1"), taak("T-2")]), stil(HEARTBEAT_MINUTEN.developer + 5), NU);
    expect(r.taken[0].uitvoerbaar).toBe(true);
    expect(r.uitvoerbaar[0].id).toBe("T-1");
  });

  it("laat ander onafhankelijk werk gewoon doorlopen", () => {
    const r = bepaalRegie(overzicht([taak("T-1"), taak("T-2")]), stil(HEARTBEAT_MINUTEN.developer + 5), NU);
    expect(r.taken.find((t) => t.id === "T-2")).toMatchObject({ toestand: "QUEUED", uitvoerbaar: true });
    expect(r.uitvoerbaar.map((t) => t.id)).toContain("T-2");
  });

  it("zet de rol op herstel en nooit op beschikbaar", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), stil(HEARTBEAT_MINUTEN.developer + 5), NU);
    const dev = r.rollen.find((x) => x.rol === "developer");
    expect(dev?.status).toBe("herstel");
    expect(dev?.status).not.toBe("beschikbaar");
    expect(dev?.taak).toBe("T-1");
  });

  it("hervat vanzelf zodra de blokkade is opgeheven", () => {
    const basis = stil(HEARTBEAT_MINUTEN.developer + 5);
    expect(bepaalRegie(overzicht([taak("T-1")]), basis, NU).taken[0].toestand).toBe("BLOCKED");
    // vrijgave door de controller: de taak is weer gewoon werk
    const na = bepaalRegie(overzicht([taak("T-1")]), [...basis, act({ soort: "vrijgave", op: iso(1) })], NU);
    expect(na.taken[0]).toMatchObject({ toestand: "QUEUED", blokkade: null });
    expect(na.afwijkingen).toHaveLength(0);
    expect(na.rollen.find((x) => x.rol === "developer")?.status).not.toBe("herstel");
    // of de uitvoerder komt zelf terug met een nieuwe stap
    const terug = bepaalRegie(overzicht([taak("T-1")]), [...basis, act({ soort: "stap", op: iso(1), tekst: "weer bezig" })], NU);
    expect(terug.taken[0].toestand).toBe("RUNNING");
  });

  it("de time-out volgt de rol: qa valt eerder stil dan developer", () => {
    const minuten = HEARTBEAT_MINUTEN.qa + 5; // wel voorbij de qa-grens, nog binnen die van developer
    expect(minuten).toBeLessThan(HEARTBEAT_MINUTEN.developer);
    const alsQa = bepaalRegie(overzicht([taak("T-1")]), stil(minuten, { rol: "qa" }), NU);
    expect(alsQa.taken[0]).toMatchObject({ toestand: "BLOCKED", blokkade: "uitvoerder_stil", blokkade_rol: "qa" });
    const alsDev = bepaalRegie(overzicht([taak("T-1")]), stil(minuten), NU);
    expect(alsDev.taken[0].toestand).toBe("RUNNING");
  });

  it("overschrijft een wachttoestand niet, maar blijft er wel in zichtbaar", () => {
    // Wacht de taak op de eigenaar, dan blijft dat de toestand: anders raakt een
    // kaart voor de eigenaar een ronde lang uit beeld. De blokkade reist mee.
    const eigenaar = taak("T-1", { aan_zet: "eigenaar", wacht_op: "Akkoord van de eigenaar op deze taak", akkoord_nodig: true });
    const r = bepaalRegie(overzicht([eigenaar]), stil(HEARTBEAT_MINUTEN.developer + 5), NU);
    expect(r.taken[0]).toMatchObject({ toestand: "WAITING_FOR_USER", verantwoordelijke: "eigenaar", uitvoerbaar: false, blokkade: "uitvoerder_stil" });
    expect(r.taken[0].waarom).toMatch(/Ruim eerst de vastgelopen claim van developer \(cloud\) op\./);
    expect(r.afwijkingen.map((t) => t.id)).toEqual(["T-1"]);
    expect(r.rollen.find((x) => x.rol === "developer")?.status).toBe("herstel");
  });

  it("geeft geen dispatch-advies aan een taak die op een pull request wacht", () => {
    const wacht = taak("T-1", { stappen: [{ tekst: "Pinnen — wacht op PR #7", gedaan: false }] });
    const r = bepaalRegie(overzicht([wacht]), stil(HEARTBEAT_MINUTEN.developer + 5), NU);
    expect(r.taken[0]).toMatchObject({ toestand: "WAITING_FOR_DEPENDENCY", uitvoerbaar: false, blokkade: "uitvoerder_stil" });
    expect(r.taken[0].volgende_stap).not.toMatch(/opnieuw dispatchen/);
    expect(r.taken[0].waarom).toMatch(/Ruim eerst de vastgelopen claim/);
    expect(r.afwijkingen).toHaveLength(1);
  });

  it("zet ook de task-controller zelf op herstel, niet op beschikbaar", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), stil(HEARTBEAT_MINUTEN["task-controller"] + 5, { rol: "task-controller" }), NU);
    const tc = r.rollen.find((x) => x.rol === "task-controller");
    expect(tc?.status).toBe("herstel");
    expect(tc?.taak).toBe("T-1");
  });

  it("een fout die daarna stilvalt komt wél bij de rol terecht", () => {
    const rijen = [act({ soort: "claim", op: iso(HEARTBEAT_MINUTEN.developer + 20) }), act({ soort: "fout", op: iso(HEARTBEAT_MINUTEN.developer + 5), tekst: "tests rood" })];
    const dev = bepaalRegie(overzicht([taak("T-1")]), rijen, NU).rollen.find((x) => x.rol === "developer");
    expect(dev?.status).toBe("geblokkeerd");
    expect(dev?.taak).toBe("T-1");
  });

  it("een gemelde fout die daarna stilvalt blijft een fout, geen afwijking", () => {
    const rijen = [act({ soort: "claim", op: iso(HEARTBEAT_MINUTEN.developer + 20) }), act({ soort: "fout", op: iso(HEARTBEAT_MINUTEN.developer + 5), tekst: "tests rood" })];
    const r = bepaalRegie(overzicht([taak("T-1")]), rijen, NU);
    expect(r.taken[0]).toMatchObject({ toestand: "BLOCKED", blokkade: "fout" });
    expect(r.afwijkingen).toHaveLength(0);
    expect(r.taken[0].waarom).toMatch(/tests rood/);
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

describe("regie — de hervattingsregel: onderbroken werk vóór nieuw werk", () => {
  // T-1 is halverwege teruggegeven, T-2 is nog nooit aangeraakt en heeft de
  // óúdste beweging. Zonder de hervattingsregel zou T-2 vóór T-1 staan, want
  // binnen één klasse sorteert de regie oplopend op laatste_activiteit en de
  // vrijgave van T-1 is juist de jongste activiteit.
  const vrijgegeven = [
    act({ soort: "claim", taak: "T-1", op: iso(120), tekst: "opgepakt" }),
    act({ soort: "stap", taak: "T-1", op: iso(100), tekst: "helft gebouwd" }),
    act({ soort: "vrijgave", taak: "T-1", op: iso(90), tekst: "helft af, tests nog niet" }),
  ];
  const nieuw = taak("T-2", { laatste_beweging: iso(5000) });

  it("markeert een taak die is teruggegeven zonder af te ronden als onderbroken", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), vrijgegeven, NU);
    expect(r.taken[0]).toMatchObject({ toestand: "QUEUED", uitvoerbaar: true, onderbroken: true });
    expect(r.taken[0].waarom).toMatch(/onderbroken werk, te hervatten vóór nieuw werk/);
    expect(r.taken[0].waarom).toMatch(/helft af, tests nog niet/);
  });

  it("zet dat onderbroken werk vóór werk dat nog nooit is begonnen", () => {
    const r = bepaalRegie(overzicht([taak("T-1"), nieuw]), vrijgegeven, NU);
    expect(r.uitvoerbaar.map((t) => t.id)).toEqual(["T-1", "T-2"]);
    expect(r.taken.find((t) => t.id === "T-2")?.onderbroken).toBe(false);
  });

  it("dringt niet vóór herstel, afwijking of afronding", () => {
    const geblokkeerd = taak("T-3");
    const blokkade = [
      act({ soort: "claim", taak: "T-3", op: iso(HEARTBEAT_MINUTEN.developer + 30), tekst: "opgepakt" }),
      act({ soort: "fout", taak: "T-3", op: iso(HEARTBEAT_MINUTEN.developer + 10), tekst: "tests rood" }),
    ];
    const af = taak("T-4", { stappen: [{ tekst: "Gedaan", gedaan: true }] });
    const geen = taak("T-5", { stappen: [] });
    const r = bepaalRegie(overzicht([taak("T-1"), nieuw, geblokkeerd, af, geen]), [...vrijgegeven, ...blokkade], NU);
    const volgorde = r.uitvoerbaar.map((t) => t.id);
    expect(volgorde.indexOf("T-3")).toBeLessThan(volgorde.indexOf("T-1")); // BLOCKED eerst
    expect(volgorde.indexOf("T-5")).toBeLessThan(volgorde.indexOf("T-1")); // AFWIJKING daarna
    expect(volgorde.indexOf("T-4")).toBeLessThan(volgorde.indexOf("T-1")); // DONE-afronding daarna
    expect(volgorde.indexOf("T-1")).toBeLessThan(volgorde.indexOf("T-2")); // en dan pas nieuw werk
  });

  it("telt afgerond werk niet als onderbroken", () => {
    const klaar = [
      act({ soort: "claim", taak: "T-1", op: iso(120), tekst: "opgepakt" }),
      act({ soort: "klaar", taak: "T-1", op: iso(90), tekst: "stap af" }),
    ];
    const r = bepaalRegie(overzicht([taak("T-1"), nieuw]), klaar, NU);
    expect(r.taken.find((t) => t.id === "T-1")?.onderbroken).toBe(false);
    expect(r.uitvoerbaar.map((t) => t.id)).toEqual(["T-2", "T-1"]); // weer gewoon op ouderdom
  });

  it("maakt geen tweede uitvoerder wakker op werk dat loopt", () => {
    const hervat = [...vrijgegeven,
      act({ soort: "claim", taak: "T-1", op: iso(20), tekst: "hervat" }),
      act({ soort: "stap", taak: "T-1", op: iso(2), tekst: "verder" })];
    const r = bepaalRegie(overzicht([taak("T-1")]), hervat, NU);
    expect(r.taken[0]).toMatchObject({ toestand: "RUNNING", uitvoerbaar: false, onderbroken: false });
    expect(r.uitvoerbaar).toHaveLength(0);
  });
});

// T-20260917-uitvoerderbewaking, AC-1 t/m AC-9. De invariant: er bestaat geen
// regie-uitkomst waarin een uitvoerder geblokkeerd is en `afwijkingen` leeg.
// Elk criterium faalt aantoonbaar op de code van vóór deze wijziging, waar
// alleen een dóde claim BLOCKED kon opleveren.
describe("regie — het uitvoerdersregister bewaakt de uitvoerder zelf", () => {
  const register = (over: Partial<UitvoerderItem> = {}): Uitvoerders => ({
    gegenereerd_op: iso(1),
    uitvoerders: [{ naam: "cloud", soort: "routine", platformtoestand: "working", laatste_teken: iso(1), ...over }],
  });
  // Een springlevende claim: vijf minuten oud, ruim binnen de heartbeat van developer.
  const levendeClaim = [act({ soort: "claim", op: iso(20) }), act({ soort: "stap", op: iso(5), tekst: "bezig" })];

  it("AC-1: een uitvoerder op requires_action blokkeert zijn taak, ook met een levende heartbeat", () => {
    const zonder = bepaalRegie(overzicht([taak("T-1")]), levendeClaim, NU);
    expect(zonder.taken[0].toestand).toBe("RUNNING"); // het oude gedrag, zonder register

    const r = bepaalRegie(overzicht([taak("T-1")]), levendeClaim, NU, register({ platformtoestand: "requires_action", toelichting: "wacht op een goedkeuringsvraag" }));
    expect(r.taken[0]).toMatchObject({ toestand: "BLOCKED", blokkade: "uitvoerder_geblokkeerd", uitvoerder: "cloud" });
    expect(r.taken[0].waarom).toMatch(/requires_action/);
  });

  it("AC-2: platformtoestand working maar een teken ouder dan de houdbaarheid telt óók als blokkade", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), levendeClaim, NU,
      register({ platformtoestand: "working", laatste_teken: iso(UITVOERDER_TERMIJN_MINUTEN + 60), houdbaar_tot: iso(60) }));
    expect(r.taken[0]).toMatchObject({ toestand: "BLOCKED", blokkade: "uitvoerder_geblokkeerd" });
  });

  it("AC-3: een uitvoerder die in geen enkele bron een teken geeft, is onbekend en daarmee geblokkeerd", () => {
    // Geen register, en de enige activiteit van deze uitvoerder is ouder dan de houdbaarheid.
    const oud = [act({ soort: "claim", op: iso(UITVOERDER_TERMIJN_MINUTEN + 120) }), act({ soort: "stap", op: iso(UITVOERDER_TERMIJN_MINUTEN + 30) })];
    const r = bepaalRegie(overzicht([taak("T-1")]), oud, NU, null);
    expect(r.taken[0].toestand).toBe("BLOCKED");
    expect(r.taken[0].toestand).not.toBe("QUEUED");
    expect(r.afwijkingen).toHaveLength(1);
  });

  it("AC-4: in elk van die gevallen is afwijkingen niet leeg en meldt de controller geen 0 afwijking(en)", () => {
    for (const reg of [register({ platformtoestand: "requires_action" }), register({ platformtoestand: "blocked" }), register({ platformtoestand: "failed" })]) {
      const r = bepaalRegie(overzicht([taak("T-1")]), levendeClaim, NU, reg);
      expect(r.afwijkingen.length).toBeGreaterThan(0);
      const controller = r.rollen.find((x) => x.rol === "task-controller");
      expect(controller?.wat).not.toMatch(/0 afwijking\(en\)/);
      expect(controller?.wat).toMatch(/1 geblokkeerd/);
    }
  });

  it("AC-5: de geblokkeerde taak draagt een mensleesbare blokkadereden en staat niet op RUNNING", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), levendeClaim, NU, register({ platformtoestand: "blocked", toelichting: "sessie afgebroken" }));
    expect(r.taken[0].toestand).not.toBe("RUNNING");
    expect(r.taken[0].wacht_op).toBeTruthy();
    expect(r.taken[0].wacht_op).toMatch(/cloud/);
    expect(r.taken[0].wacht_op).toMatch(/sessie afgebroken/);
  });

  it("AC-6: ander uitvoerbaar werk blijft dispatchbaar en de geblokkeerde taak staat er niet bovenaan", () => {
    const r = bepaalRegie(overzicht([taak("T-1"), taak("T-2")]), levendeClaim, NU, register({ platformtoestand: "requires_action" }));
    expect(r.uitvoerbaar.map((t) => t.id)).toContain("T-2");
    expect(r.uitvoerbaar[0]?.id).toBe("T-2");
  });

  it("AC-7: een vers teken en platformtoestand working laten de taak vanzelf weer lopen, zonder extra aanroep", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), levendeClaim, NU, register({ platformtoestand: "working", laatste_teken: iso(2) }));
    expect(r.taken[0].toestand).toBe("RUNNING");
    expect(r.afwijkingen).toHaveLength(0);
  });

  it("AC-8: een geblokkeerde uitvoerder is werk voor Jarvis, nooit een handeling van de eigenaar", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), levendeClaim, NU, register({ platformtoestand: "requires_action" }));
    expect(r.taken[0].verantwoordelijke).toBe("task-controller");
    expect(r.taken[0].verantwoordelijke).not.toBe("eigenaar");
    expect(r.taken[0].uitvoerbaar).toBe(true);
    expect(r.taken[0].waarom).toMatch(/werk voor Jarvis, niet voor de eigenaar/);
  });

  it("AC-9: de regie voegt geen tweede scheduler, wekker of achtergrondproces toe", () => {
    const bron = readFileSync(new URL("../../jarvis/src/regie.ts", import.meta.url), "utf8");
    for (const verboden of [/\bsetInterval\s*\(/, /\bsetTimeout\s*\(/, /create_trigger/, /\bcron\b/i]) {
      expect(bron).not.toMatch(verboden);
    }
  });

  it("de rol van een geblokkeerde uitvoerder heet nooit beschikbaar", () => {
    const r = bepaalRegie(overzicht([taak("T-1")]), levendeClaim, NU, register({ platformtoestand: "requires_action" }));
    expect(r.rollen.find((x) => x.rol === "developer")?.status).not.toBe("beschikbaar");
  });
});

describe("uitvoerderToestand", () => {
  it("requires_action, blocked en failed blokkeren ongeacht het teken", () => {
    for (const t of ["requires_action", "blocked", "failed"] as const) {
      expect(uitvoerderToestand({ naam: "cloud", platformtoestand: t, laatste_teken: iso(0) }, iso(0), NU)).toBe("GEBLOKKEERD");
    }
  });
  it("completed en review_ready zijn geen blokkade: er is gewoon geen werk toegewezen", () => {
    for (const t of ["completed", "review_ready"] as const) {
      expect(uitvoerderToestand({ naam: "cloud", platformtoestand: t, laatste_teken: iso(99999) }, null, NU)).toBe("ACTIEF");
    }
  });
  it("onbekend zonder enig teken is een blokkade, geen leegte", () => {
    expect(uitvoerderToestand(null, null, NU)).toBe("GEBLOKKEERD");
    expect(uitvoerderToestand(null, iso(5), NU)).toBe("ACTIEF");
    expect(uitvoerderToestand(null, iso(UITVOERDER_TERMIJN_MINUTEN + 1), NU)).toBe("GEBLOKKEERD");
  });
});
