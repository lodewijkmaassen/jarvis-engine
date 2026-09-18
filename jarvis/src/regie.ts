// Regie: de operationele toestand van elke open taak en van elke rol van het
// digitale team, afgeleid uit wat er al is (T-20260914-agent-operations).
//
// De toestand wordt nooit handmatig bijgehouden. Ze volgt uit het overzicht
// (dossiers: stappen, eigenaarspunten, akkoord) en uit de activiteit die
// uitvoerders wegschrijven (claim, stap, heartbeat, fout, klaar, vrijgave).
// Daardoor kan geen open taak stil "open" zijn: ze is QUEUED (uitvoerbaar,
// niemand werkt eraan), RUNNING (geclaimd met levende heartbeat), BLOCKED
// (laatste uitvoering meldde een fout), WAITING_FOR_USER (de eigenaar is aan
// zet), WAITING_FOR_DEPENDENCY (wacht op een andere taak of pull request),
// WAITING_FOR_EVENT (wacht op iets buiten Jarvis dat niemand kan afdwingen),
// DONE (alles af, dossier nog te sluiten) of AFWIJKING (de zes vragen zijn
// niet te beantwoorden; de controller onderzoekt).

import type { Overzicht, TaakItem } from "./overzicht";

export const ROLLEN = ["orchestrator", "task-controller", "architect", "developer", "qa", "knowledge-manager"] as const;
export type Rol = (typeof ROLLEN)[number];

export const TOESTANDEN = ["QUEUED", "RUNNING", "BLOCKED", "WAITING_FOR_USER", "WAITING_FOR_DEPENDENCY", "WAITING_FOR_EVENT", "DONE", "AFWIJKING"] as const;
export type Toestand = (typeof TOESTANDEN)[number];

export type Activiteit = {
  readonly op: string;
  readonly uitvoerder: string;
  readonly rol: string;
  readonly taak: string | null;
  readonly project: string | null;
  readonly soort: string;
  readonly tekst: string;
  readonly verwijzing: string | null;
};

export type TaakRegie = {
  readonly id: string;
  readonly project: string;
  readonly titel: string;
  readonly toestand: Toestand;
  /** Wie verantwoordelijk is voor de volgende stap: een rol, of "eigenaar". */
  readonly verantwoordelijke: Rol | "eigenaar";
  /** Waarom de taak deze toestand heeft, in één zin. */
  readonly waarom: string;
  readonly laatste_activiteit: string | null;
  readonly volgende_stap: string | null;
  /** Wie of wat de volgende stap uitvoert: laptop, cloud, eigenaar, of null als onbekend. */
  readonly uitvoerder: string | null;
  /** Sinds wanneer de huidige toestand geldt (claim, fout, laatste commit), als bekend. */
  readonly sinds: string | null;
  /** Kan een uitvoerder dit nu oppakken zonder de eigenaar? */
  readonly uitvoerbaar: boolean;
  /** Bij WAITING_FOR_DEPENDENCY of WAITING_FOR_EVENT: waarop. */
  readonly wacht_op: string | null;
  /**
   * Aard van de blokkade bij BLOCKED. `fout`: de uitvoerder meldde zelf een
   * fout. `uitvoerder_stil`: hij houdt de claim vast maar meldt niets meer —
   * de handtekening van een sessie die op een goedkeuringsvraag staat of
   * anderszins is weggevallen. Dat tweede geval telt als afwijking, want het
   * meldt zichzelf per definitie niet.
   */
  readonly blokkade: "fout" | "uitvoerder_stil" | null;
  /** Bij een blokkade: de rol wiens uitvoering vastliep (niet wie herstelt). */
  readonly blokkade_rol: Rol | null;
};

export type RolRegie = {
  readonly rol: Rol;
  readonly status: "bezig" | "beschikbaar" | "wacht" | "geblokkeerd" | "herstel";
  readonly taak: string | null;
  readonly project: string | null;
  readonly wat: string | null;
  readonly sinds: string | null;
  readonly laatste_activiteit: string | null;
  readonly volgende_stap: string | null;
  readonly wachtrij: number;
  readonly uitvoerder: string | null;
};

export type Regie = {
  readonly gegenereerd_op: string;
  readonly taken: readonly TaakRegie[];
  readonly rollen: readonly RolRegie[];
  /** Uitvoerbaar werk in prioriteitsvolgorde: eerst herstel, dan afronding, dan bouw. */
  readonly uitvoerbaar: readonly TaakRegie[];
  readonly afwijkingen: readonly TaakRegie[];
};

/** Time-out van een heartbeat per rol, in minuten: geen blinde timeout voor alles. */
export const HEARTBEAT_MINUTEN: Readonly<Record<Rol, number>> = {
  orchestrator: 20,
  "task-controller": 30,
  architect: 45,
  developer: 90,
  qa: 45,
  "knowledge-manager": 20,
};

const ms = (iso: string): number => new Date(iso).getTime();

function isRol(x: string): x is Rol {
  return (ROLLEN as readonly string[]).includes(x);
}

/** Welke rol een open stap uitvoert, afgeleid uit de tekst van die stap. */
export function rolVoorStap(tekst: string): Rol {
  const t = tekst.toLowerCase();
  if (/\b(qa|toets\w*|kwaliteits)/.test(t)) return "qa";
  if (/\b(onderzoek\w*|ontwerp\w*|analyse|analyseer|architect\w*|impact)/.test(t)) return "architect";
  if (/\b(dossier\w*|kennisrecord\w*|record\b|dec-\d|con-\d|lrn-\d|rsk-\d|documentatie|afsluit\w*|afrond\w*|index|feitenblok|kennis)/.test(t)) return "knowledge-manager";
  return "developer";
}

const WACHT_OP_TAAK = /wacht(?:en)?\s+op\s+(T-\d{8}-[a-z0-9-]+)/i;
// "wacht op PR #26", "wacht op pull request lodewijkmaassen/jarvis-engine#26".
const WACHT_OP_PR = /wacht(?:en)?\s+op\s+(?:pr|pull request)\s*(?:([\w.-]+\/[\w.-]+))?#?(\d+)/i;
const AKKOORD_STAP = /\bakkoord\b.*\beigenaar\b|\beigenaar\b.*\bakkoord\b/i;
// "wacht op gebeurtenis: de eigenaar typt de volgende opdracht in de app".
//
// Anders dan de drie patronen hierboven is dit een expliciete markering en
// geen woordpatroon over lopende tekst. Dat is met opzet: een taak die op iets
// buiten Jarvis wacht valt anders terug op QUEUED en wordt elke run opnieuw
// aan een uitvoerder aangeboden die er niets mee kan. Wie zo'n stap schrijft
// zegt daarmee uitdrukkelijk dat er niets te dispatchen valt — dat mag niet
// per ongeluk uit een zinswending volgen.
//
// Dit is nadrukkelijk géén eigenaarswerk: er wordt niets van de eigenaar
// gevraagd, er is alleen niets te doen tot de gebeurtenis zich voordoet
// (CON-0016). Daarom blijft de verantwoordelijke de task-controller.
const WACHT_OP_GEBEURTENIS = /^\s*wacht(?:en)?\s+op\s+gebeurtenis\s*:\s*(.+?)\s*$/i;

export type Uitvoering = {
  readonly claim: Activiteit;
  readonly laatste: Activiteit;
  readonly fout: Activiteit | null;
  readonly levend: boolean;
};

/** De lopende uitvoering van een taak: laatste claim zonder latere vrijgave/klaar, met heartbeat. */
export function uitvoeringVan(taak: string, activiteit: readonly Activiteit[], nu: Date): Uitvoering | null {
  const rijen = activiteit.filter((a) => a.taak === taak).sort((a, b) => ms(a.op) - ms(b.op));
  let claim: Activiteit | null = null;
  let laatste: Activiteit | null = null;
  let fout: Activiteit | null = null;
  for (const a of rijen) {
    if (a.soort === "claim") { claim = a; laatste = a; fout = null; continue; }
    if (!claim) continue;
    if (a.soort === "vrijgave" || a.soort === "klaar") { claim = null; laatste = null; fout = null; continue; }
    laatste = a;
    if (a.soort === "fout") fout = a;
    else if (a.soort === "stap" || a.soort === "heartbeat" || a.soort === "pr") fout = null;
  }
  if (!claim || !laatste) return null;
  const rol = isRol(claim.rol) ? claim.rol : "developer";
  const levend = nu.getTime() - ms(laatste.op) <= HEARTBEAT_MINUTEN[rol] * 60_000;
  return { claim, laatste, fout, levend };
}

function laatsteActiviteit(taak: string, activiteit: readonly Activiteit[]): string | null {
  let best: string | null = null;
  for (const a of activiteit) if (a.taak === taak && (best === null || ms(a.op) > ms(best))) best = a.op;
  return best;
}

function vindTaak(overzicht: Overzicht, taakId: string): TaakItem | undefined {
  return overzicht.projecten.flatMap((p) => p.taken).find((x) => x.id === taakId);
}

/**
 * Is pull request #nummer al samengevoegd? Twee onafhankelijke bronnen: de
 * merge-activiteit die `jarvis pr mergen` wegschrijft (verwijzing `slug#n`),
 * en de mergecommit in de recente git-historie van het overzicht ("Merge pull
 * request #n …"). Zonder repository in de stap telt elk project mee; met
 * repository alleen die.
 */
export function prGemerged(overzicht: Overzicht, activiteit: readonly Activiteit[], nummer: string, repo: string | null): boolean {
  const naam = repo?.split("/").pop()?.toLowerCase() ?? null;
  const viaActiviteit = activiteit.some((a) =>
    a.soort === "merge" && a.verwijzing !== null && a.verwijzing.endsWith(`#${nummer}`) &&
    (repo === null || a.verwijzing.toLowerCase() === `${repo.toLowerCase()}#${nummer}`));
  if (viaActiviteit) return true;
  const onderwerp = new RegExp(`^Merge pull request #${nummer}\\b`, "i");
  return overzicht.projecten.some((p) =>
    (naam === null || p.id.toLowerCase() === naam || p.naam.toLowerCase() === naam) &&
    p.recent.some((r) => r.soort === "merge" && onderwerp.test(r.onderwerp)));
}

function bepaalTaak(t: TaakItem, project: string, overzicht: Overzicht, activiteit: readonly Activiteit[], nu: Date): TaakRegie {
  const stappen = t.stappen ?? [];
  const open = stappen.filter((s) => !s.gedaan);
  const volgende = open[0]?.tekst ?? null;
  const laatste = laatsteActiviteit(t.id, activiteit) ?? t.laatste_beweging;
  const basis = { id: t.id, project, titel: t.titel, laatste_activiteit: laatste, volgende_stap: volgende, wacht_op: null as string | null,
    blokkade: null as TaakRegie["blokkade"], blokkade_rol: null as Rol | null };

  const uitvoering = uitvoeringVan(t.id, activiteit, nu);
  if (uitvoering && uitvoering.fout && uitvoering.levend) {
    const rol = isRol(uitvoering.claim.rol) ? uitvoering.claim.rol : "developer";
    return { ...basis, toestand: "BLOCKED", verantwoordelijke: rol, uitvoerder: uitvoering.claim.uitvoerder, sinds: uitvoering.fout.op, uitvoerbaar: true,
      blokkade: "fout", blokkade_rol: rol,
      waarom: `de uitvoering door ${rol} (${uitvoering.claim.uitvoerder}) meldde een fout: ${uitvoering.fout.tekst}` };
  }
  if (uitvoering && uitvoering.levend) {
    const rol = isRol(uitvoering.claim.rol) ? uitvoering.claim.rol : "developer";
    return { ...basis, toestand: "RUNNING", verantwoordelijke: rol, uitvoerder: uitvoering.claim.uitvoerder, sinds: uitvoering.claim.op, uitvoerbaar: false,
      waarom: `${rol} (${uitvoering.claim.uitvoerder}) werkt eraan sinds ${uitvoering.claim.op}: ${uitvoering.laatste.tekst}` };
  }
  // Een uitvoerder die zijn claim vasthoudt maar niets meer laat horen, is geen
  // vrije taak. Tot 2026-09-18 viel dit geval door naar QUEUED met de reden in
  // de tekst: de taak werd opnieuw aangeboden, maar de blokkade zelf stond
  // nergens en telde niet als afwijking. Een regieronde kon dus een rustige
  // wachtrij melden terwijl een sessie op een goedkeuringsvraag stond — precies
  // wat er op 2026-09-17 gebeurde. Een uitvoerder mag blokkeren; de regie mag
  // dat nooit ongemerkt laten gebeuren.
  //
  // De blokkade reist daarom mee in `basis`: ook wanneer de taak hieronder op
  // een eigenaarsakkoord of een dependency blijkt te wachten, blijft ze
  // zichtbaar als afwijking en komt de rol niet op "beschikbaar". Wat ze dan
  // níét doet, is die wachttoestand overschrijven — anders zou een kaart voor
  // de eigenaar een ronde lang uit beeld raken en zou "opnieuw dispatchen"
  // verkeerd advies zijn bij een taak die op een merge wacht.
  const dood = uitvoering !== null && !uitvoering.levend ? uitvoering : null;
  const doodRol: Rol | null = dood === null ? null : isRol(dood.claim.rol) ? dood.claim.rol : "developer";
  const grond = dood === null ? basis : { ...basis, blokkade: (dood.fout ? "fout" : "uitvoerder_stil") as TaakRegie["blokkade"], blokkade_rol: doodRol };
  const opruimen = dood === null ? "" : ` Ruim eerst de vastgelopen claim van ${doodRol} (${dood.claim.uitvoerder}) op.`;

  if (t.aan_zet === "eigenaar" || (volgende !== null && AKKOORD_STAP.test(volgende) && t.akkoord_nodig)) {
    return { ...grond, toestand: "WAITING_FOR_USER", verantwoordelijke: "eigenaar", uitvoerder: "eigenaar", sinds: laatste, uitvoerbaar: false,
      waarom: (t.wacht_op ? `de eigenaar is aan zet: ${t.wacht_op}` : "de eigenaar is aan zet") + opruimen };
  }
  if (volgende !== null) {
    const taakDep = WACHT_OP_TAAK.exec(volgende);
    if (taakDep) {
      const dep = vindTaak(overzicht, taakDep[1]);
      if (dep === undefined) {
        // Een dependency die nergens bestaat wacht anders eeuwig: dat is een afwijking, geen wachttoestand.
        return { ...grond, toestand: "AFWIJKING", verantwoordelijke: "task-controller", uitvoerder: null, sinds: laatste, uitvoerbaar: true, wacht_op: taakDep[1],
          volgende_stap: `De verwijzing naar ${taakDep[1]} in het dossier herstellen`,
          waarom: `de stap wacht op taak ${taakDep[1]}, maar die taak bestaat in geen enkel project` + opruimen };
      }
      if (dep.status !== "afgerond") {
        return { ...grond, toestand: "WAITING_FOR_DEPENDENCY", verantwoordelijke: "task-controller", uitvoerder: null, sinds: laatste, uitvoerbaar: false, wacht_op: taakDep[1],
          waarom: `wacht op taak ${taakDep[1]}, die nog niet is afgerond; de controller hervat zodra dat wel zo is` + opruimen };
      }
      // Afgerond: de stap is weer gewoon uitvoerbaar werk (valt hieronder door).
    }
    const prDep = WACHT_OP_PR.exec(volgende);
    if (prDep && !prGemerged(overzicht, activiteit, prDep[2], prDep[1] ?? null)) {
      const label = prDep[1] ? `${prDep[1]}#${prDep[2]}` : `PR #${prDep[2]}`;
      return { ...grond, toestand: "WAITING_FOR_DEPENDENCY", verantwoordelijke: "task-controller", uitvoerder: null, sinds: laatste, uitvoerbaar: false, wacht_op: label,
        waarom: `wacht op pull request ${label}, die nog niet is samengevoegd; de controller hervat na de merge` + opruimen };
    }
    // Een gemergede PR is geen wachtreden meer: de stap wordt weer uitvoerbaar werk.
    const gebeurtenis = WACHT_OP_GEBEURTENIS.exec(volgende);
    if (gebeurtenis) {
      return { ...basis, toestand: "WAITING_FOR_EVENT", verantwoordelijke: "task-controller", uitvoerder: null, sinds: laatste, uitvoerbaar: false, wacht_op: gebeurtenis[1],
        waarom: `wacht op een gebeurtenis buiten Jarvis: ${gebeurtenis[1]}; er is niets te dispatchen tot die zich voordoet, en er wordt niets van de eigenaar gevraagd` };
    }
  }
  // Niets anders houdt de taak tegen: dan ís de vastgelopen uitvoerder de
  // blokkade. Het herstel ligt bij de task-controller — een vastgelopen sessie
  // is een ontbrekende capability of een interne toolgoedkeuring, en die zijn
  // van Jarvis, nooit van de eigenaar. De taak blijft uitvoerbaar zodat een
  // andere uitvoerder hem kan overnemen; ander werk raakt dit niet.
  if (dood !== null && doodRol !== null) {
    const stil = Math.round((nu.getTime() - ms(dood.laatste.op)) / 60_000);
    return { ...grond, toestand: "BLOCKED", verantwoordelijke: "task-controller", uitvoerder: dood.claim.uitvoerder,
      sinds: dood.laatste.op, uitvoerbaar: true,
      volgende_stap: `De vastgelopen claim van ${doodRol} (${dood.claim.uitvoerder}) vrijgeven en ${t.id} opnieuw dispatchen`,
      waarom: dood.fout !== null
        ? `de uitvoering door ${doodRol} (${dood.claim.uitvoerder}) meldde een fout en gaf daarna ${stil} min geen teken meer: ${dood.fout.tekst}`
        : `de uitvoering door ${doodRol} (${dood.claim.uitvoerder}) houdt de claim vast maar gaf ${stil} min geen teken meer (time-out ${HEARTBEAT_MINUTEN[doodRol]} min) en meldde geen fout, klaar of vrijgave; een geblokkeerde uitvoerder is werk voor Jarvis, niet voor de eigenaar` };
  }
  if (open.length === 0 && stappen.length > 0) {
    return { ...basis, toestand: "DONE", verantwoordelijke: "knowledge-manager", uitvoerder: null, sinds: laatste, uitvoerbaar: true,
      volgende_stap: "Dossier afronden (status afgerond) en de stand bijwerken",
      waarom: "alle stappen zijn af en er ligt niets bij de eigenaar; alleen de administratieve afronding ontbreekt" };
  }
  if (volgende === null) {
    return { ...basis, toestand: "AFWIJKING", verantwoordelijke: "task-controller", uitvoerder: null, sinds: laatste, uitvoerbaar: true,
      volgende_stap: "Voortgangsstappen in het dossier zetten",
      waarom: "het dossier heeft geen voortgangsstappen; zonder volgende stap is de taak niet te bewaken" };
  }
  // Hier is er geen uitvoering meer: een levende claim werd hierboven RUNNING of
  // BLOCKED, een dode claim werd BLOCKED of ging op in een wachttoestand. Wat
  // overblijft is vrij werk.
  const rol = rolVoorStap(volgende);
  return { ...basis, toestand: "QUEUED", verantwoordelijke: rol, uitvoerder: null, sinds: laatste, uitvoerbaar: true,
    waarom: "uitvoerbaar, niemand werkt eraan" };
}

function prioriteit(t: TaakRegie): number {
  if (t.toestand === "BLOCKED") return 0;
  if (t.toestand === "AFWIJKING") return 1;
  if (t.toestand === "DONE") return 2;
  return 3;
}

/** De regie over alle open taken en alle rollen. */
export function bepaalRegie(overzicht: Overzicht, activiteit: readonly Activiteit[], nu: Date = new Date()): Regie {
  const taken: TaakRegie[] = [];
  const gezien = new Set<string>();
  for (const p of overzicht.projecten) {
    for (const t of p.taken) {
      if (t.status !== "actief" && t.status !== "review") continue;
      if (gezien.has(t.id)) continue; // een dossierspiegel in een ander project telt niet als tweede taak
      gezien.add(t.id);
      taken.push(bepaalTaak(t, t.project ?? p.id, overzicht, activiteit, nu));
    }
  }
  const uitvoerbaar = taken
    .filter((t) => t.uitvoerbaar)
    .sort((a, b) => prioriteit(a) - prioriteit(b) || (a.laatste_activiteit ?? "").localeCompare(b.laatste_activiteit ?? ""));
  // Een stilgevallen uitvoerder telt als afwijking: hij meldt zichzelf per
  // definitie niet, dus zonder deze regel blijft hij buiten elke rapportage.
  // Een gemelde fout hoeft dat niet — die staat al luid in de regie.
  const afwijkingen = taken.filter((t) => t.toestand === "AFWIJKING" || t.blokkade === "uitvoerder_stil");

  const rollen: RolRegie[] = ROLLEN.map((rol) => {
    const eigen = activiteit.filter((a) => a.rol === rol).sort((a, b) => ms(b.op) - ms(a.op));
    const laatste = eigen[0] ?? null;
    const lopend = taken.find((t) => t.toestand === "RUNNING" && t.verantwoordelijke === rol) ?? null;
    const wachtrij = taken.filter((t) => t.toestand === "QUEUED" && t.verantwoordelijke === rol).length;
    // Nooit "beschikbaar" bij een vastgelopen sessie, en dat geldt voor élke
    // rol — ook voor de task-controller, die zelf een taak kan claimen. De
    // rolstatus wordt uit de werkactiviteit afgeleid, en een sessie die op een
    // goedkeuringsvraag staat stopt met heartbeaten zonder luid te falen.
    // Zonder deze tak heette de rol "beschikbaar" terwijl er niets beschikbaar
    // was. `blokkade_rol` wijst de rol aan wiens uitvoering vastliep, ook als
    // het herstel bij een andere rol ligt; daarom gaat hij vóór de rest.
    const geblokkeerd = taken.find((t) => t.blokkade !== null && t.blokkade_rol === rol) ?? null;
    if (geblokkeerd) {
      return { rol, status: geblokkeerd.blokkade === "uitvoerder_stil" ? "herstel" : "geblokkeerd",
        taak: geblokkeerd.id, project: geblokkeerd.project, wat: geblokkeerd.waarom, sinds: geblokkeerd.sinds,
        laatste_activiteit: laatste?.op ?? null, volgende_stap: geblokkeerd.volgende_stap, wachtrij, uitvoerder: geblokkeerd.uitvoerder };
    }
    if (rol === "task-controller") {
      const regie = eigen.find((a) => a.soort === "regie") ?? null;
      const bezig = regie !== null && nu.getTime() - ms(regie.op) <= HEARTBEAT_MINUTEN[rol] * 60_000;
      return { rol, status: bezig ? "bezig" : "beschikbaar", taak: null, project: null,
        wat: `bewaakt ${taken.length} open ${taken.length === 1 ? "taak" : "taken"}: ${uitvoerbaar.length} uitvoerbaar, ${taken.filter((t) => t.toestand === "WAITING_FOR_USER").length} bij de eigenaar, ${afwijkingen.length} afwijking(en)`,
        sinds: regie?.op ?? null, laatste_activiteit: laatste?.op ?? null, volgende_stap: uitvoerbaar[0] ? `${uitvoerbaar[0].id}: ${uitvoerbaar[0].volgende_stap ?? ""}` : null, wachtrij: uitvoerbaar.length, uitvoerder: regie?.uitvoerder ?? null };
    }
    if (lopend) {
      const u = uitvoeringVan(lopend.id, activiteit, nu);
      return { rol, status: "bezig", taak: lopend.id, project: lopend.project, wat: u?.laatste.tekst ?? lopend.waarom, sinds: lopend.sinds,
        laatste_activiteit: laatste?.op ?? null, volgende_stap: lopend.volgende_stap, wachtrij, uitvoerder: lopend.uitvoerder };
    }
    const wachtOpAnder = rol === "qa" ? taken.find((t) => t.toestand === "RUNNING" && t.verantwoordelijke === "developer") ?? null : null;
    if (wachtOpAnder) {
      return { rol, status: "wacht", taak: wachtOpAnder.id, project: wachtOpAnder.project, wat: `wacht tot developer klaar is met ${wachtOpAnder.id}`, sinds: wachtOpAnder.sinds,
        laatste_activiteit: laatste?.op ?? null, volgende_stap: "toetsing zodra de pull request er is", wachtrij, uitvoerder: null };
    }
    return { rol, status: "beschikbaar", taak: null, project: null, wat: wachtrij ? `${wachtrij} ${wachtrij === 1 ? "taak" : "taken"} in de wachtrij` : null, sinds: null,
      laatste_activiteit: laatste?.op ?? null, volgende_stap: null, wachtrij, uitvoerder: null };
  });

  return { gegenereerd_op: nu.toISOString(), taken, rollen, uitvoerbaar, afwijkingen };
}
