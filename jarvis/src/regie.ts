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
import { UITVOERDER_STAP, WACHT_OP_GEBEURTENIS, WACHT_OP_PR, WACHT_OP_TAAK } from "./overzicht";

export const ROLLEN = ["orchestrator", "task-controller", "architect", "developer", "reviewer", "qa", "knowledge-manager"] as const;
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
   * anderszins is weggevallen. `uitvoerder_geblokkeerd`: het
   * uitvoerdersregister meldt hem als geblokkeerd, ook als zijn heartbeat nog
   * leeft. De laatste twee tellen als afwijking, want ze melden zichzelf per
   * definitie niet.
   */
  readonly blokkade: "fout" | "uitvoerder_stil" | "uitvoerder_geblokkeerd" | null;
  /** Bij een blokkade: de rol wiens uitvoering vastliep (niet wie herstelt). */
  readonly blokkade_rol: Rol | null;
  /**
   * Aantoonbaar onderbroken werk: een uitvoerder is aan deze taak begonnen en
   * heeft hem teruggegeven zonder af te ronden (`jarvis werk vrijgave`), en er
   * staat geen nieuwe claim achter. Zulk werk gaat vóór werk dat nog nooit is
   * begonnen — zie `prioriteit`.
   */
  readonly onderbroken: boolean;
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

/**
 * De toestand van één uitvoerder in de regie-uitkomst.
 *
 * Zonder deze lijst was een geblokkeerde uitvoerder alleen zichtbaar via zijn
 * taken, en dus onzichtbaar zodra hij er geen had. Dat is precies het geval van
 * de gepauzeerde roosterroutine: niets wekt de keten nog, geen enkele taak hangt
 * eraan, en de regie meldde nul afwijkingen (QA op AC-11, criterium H). Eis 9 van
 * de opdracht verbiedt een tweede wekker; zíen dat de wekker uit staat is geen
 * tweede wekker.
 */
export type UitvoerderRegie = {
  readonly naam: string;
  readonly toestand: UitvoerderToestand;
  readonly reden: string;
  /** De taken die aan deze uitvoerder hangen, geclaimd of toegewezen. */
  readonly taken: readonly string[];
};

export type Regie = {
  readonly gegenereerd_op: string;
  readonly taken: readonly TaakRegie[];
  readonly rollen: readonly RolRegie[];
  /** Elke uitvoerder die het register kent of die in de werkactiviteit voorkomt. */
  readonly uitvoerders: readonly UitvoerderRegie[];
  /**
   * De geblokkeerde uitvoerders, apart geteld naast `afwijkingen`.
   *
   * De invariant uit ontwerp §5 is dat er geen regie-uitkomst bestaat waarin een
   * uitvoerder geblokkeerd is en er niets afwijkt. `afwijkingen` filtert taken, en
   * een geblokkeerde uitvoerder zonder taken leverde er dus nul — precies de casus
   * van de gepauzeerde roosterroutine (QA op AC-11, ronde 2, bevinding 1).
   *
   * Hier wijkt de uitvoering bewust af van de létter van §5: een uitvoerder is geen
   * taak en hoort niet in een takenlijst. De gárantie is wat telt, en die luidt nu:
   * `afwijkingen.length + blokkades.length` is nooit nul zolang een uitvoerder
   * geblokkeerd is. `telAfwijkingen` rekent dat uit en de slotregel van
   * `jarvis regie` meldt het totaal.
   */
  readonly blokkades: readonly UitvoerderRegie[];
  /** Uitvoerbaar werk in prioriteitsvolgorde: eerst herstel, dan afronding, dan onderbroken werk, dan nieuw werk. */
  readonly uitvoerbaar: readonly TaakRegie[];
  readonly afwijkingen: readonly TaakRegie[];
};

/** Time-out van een heartbeat per rol, in minuten: geen blinde timeout voor alles. */
export const HEARTBEAT_MINUTEN: Readonly<Record<Rol, number>> = {
  orchestrator: 20,
  "task-controller": 30,
  architect: 45,
  developer: 90,
  reviewer: 10,
  qa: 45,
  "knowledge-manager": 20,
};

/**
 * Het uitvoerdersregister (`uitvoerders/huidig`): de tweede bron naast de
 * werkactiviteit. De werkactiviteit kent alleen uitvoerders die al schreven,
 * en dat is per definitie niet de uitvoerder die op een goedkeuringsvraag
 * blijft staan. De engine bevraagt de platformlaag nooit zelf — ze kent geen
 * tokens en mag die niet leren kennen — dus komt de platformtoestand als
 * document binnen, geschreven door de uitvoerder die de platformlaag wél mag
 * bevragen.
 */
export const PLATFORMTOESTANDEN = ["working", "blocked", "requires_action", "review_ready", "completed", "failed", "onbekend"] as const;
export type Platformtoestand = (typeof PLATFORMTOESTANDEN)[number];

export type UitvoerderItem = {
  /** Dezelfde naam als `--door` bij `jarvis werk`. */
  readonly naam: string;
  readonly soort?: "routine" | "sessie" | "laptop";
  readonly verwijzing?: string | null;
  readonly platformtoestand: Platformtoestand;
  /** Laatste run of heartbeat volgens de platformlaag. */
  readonly laatste_teken?: string | null;
  /** `laatste_teken` + twee roosterintervallen. Ontbreekt hij, dan geldt UITVOERDER_TERMIJN_MINUTEN. */
  readonly houdbaar_tot?: string | null;
  readonly toelichting?: string | null;
};

export type Uitvoerders = {
  readonly gegenereerd_op: string;
  readonly uitvoerders: readonly UitvoerderItem[];
};

/**
 * Houdbaarheid van een teken van een uitvoerder, als het register er geen
 * geeft: tweemaal het roosterinterval van de cloud-uitvoerder (`0 5,17 * * *`,
 * dus twaalf uur). Dit is bewust niet de taak-heartbeat uit
 * HEARTBEAT_MINUTEN — een uitvoerder mag tussen twee taken door legitiem stil
 * zijn, een claim niet.
 */
export const UITVOERDER_TERMIJN_MINUTEN = 24 * 60;

export type UitvoerderToestand = "ACTIEF" | "GEBLOKKEERD";

/**
 * Alles wat afwijkt: taken én geblokkeerde uitvoerders. Dit is de teller waarop de
 * invariant van ontwerp §5 rust — nul betekent werkelijk niets aan de hand.
 */
export function telAfwijkingen(regie: Pick<Regie, "afwijkingen" | "blokkades">): number {
  return regie.afwijkingen.length + regie.blokkades.length;
}

/** Een platformtoestand die op zichzelf al een blokkade is, ongeacht de heartbeat. */
const BLOKKERENDE_TOESTANDEN: readonly Platformtoestand[] = ["requires_action", "blocked", "failed"];

const ms = (iso: string): number => new Date(iso).getTime();

/**
 * De platformtoestand van een item, of `onbekend` als er iets anders staat.
 *
 * Het register wordt buiten de engine geschreven, dus een tikfout is een
 * normaal geval en geen uitzondering. Zonder deze normalisatie viel elke
 * onbekende waarde (`"requires-action"` met een streepje, `"REQUIRES_ACTION"`,
 * een leeg veld) door de blokkerende lijst heen en werd zij, met een vers
 * teken, stil als `ACTIEF` gelezen — precies het stille falen dat dit register
 * hoort weg te nemen. Een waarde die de engine niet kent is `onbekend`, en
 * `onbekend` zonder vers teken is een blokkade.
 */
export function platformtoestandVan(ruw: unknown): Platformtoestand {
  if (typeof ruw !== "string") return "onbekend";
  const k = ruw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (PLATFORMTOESTANDEN as readonly string[]).includes(k) ? (k as Platformtoestand) : "onbekend";
}

/**
 * Is dit register nog bruikbaar, of is het zelf de stille schakel geworden?
 *
 * `gegenereerd_op` werd tot nu toe gelezen en nooit gebruikt. Een register dat
 * dagen oud is maar per uitvoerder een `houdbaar_tot` in de toekomst draagt,
 * las daardoor als "alles in orde" terwijl de schrijver ervan al lang stil
 * lag. Dat is dezelfde fout als de rolstatus die "beschikbaar" bleef heten:
 * ontwerp §2.2 en §7 eisen dat een register dat stilvalt luid faalt, en een
 * register buiten zijn eigen houdbaarheid telt daarom als afwezig.
 */
export function registerBruikbaar(uitvoerders: Uitvoerders | null, nu: Date): boolean {
  if (uitvoerders === null) return false;
  const op = uitvoerders.gegenereerd_op;
  if (typeof op !== "string" || Number.isNaN(ms(op))) return false;
  return nu.getTime() - ms(op) <= UITVOERDER_TERMIJN_MINUTEN * 60_000;
}

/**
 * De toestand van één uitvoerder volgens het register (ontwerp §2.4). Een
 * ontbrekend of verlopen register is geen leegte maar de toestand `onbekend`;
 * `onbekend` zonder vers teken telt als blokkade, want een register dat
 * stilvalt mag niet hetzelfde effect hebben als een register dat "alles in
 * orde" meldt.
 */
export function uitvoerderToestand(item: UitvoerderItem | null, laatsteTeken: string | null, nu: Date): UitvoerderToestand {
  const toestand = item === null ? "onbekend" : platformtoestandVan(item.platformtoestand);
  if (BLOKKERENDE_TOESTANDEN.includes(toestand)) return "GEBLOKKEERD";
  if (toestand === "completed" || toestand === "review_ready") return "ACTIEF";
  const teken = item?.laatste_teken ?? laatsteTeken;
  if (teken === null || teken === undefined) return "GEBLOKKEERD";
  const grens = item?.houdbaar_tot != null ? ms(item.houdbaar_tot) : ms(teken) + UITVOERDER_TERMIJN_MINUTEN * 60_000;
  return nu.getTime() <= grens ? "ACTIEF" : "GEBLOKKEERD";
}

/** Waarom een uitvoerder geblokkeerd heet, in één mensleesbare regel zonder secrets. */
function blokkadeReden(naam: string, item: UitvoerderItem | null, laatsteTeken: string | null, nu: Date): string {
  const toestand = item === null ? "onbekend" : platformtoestandVan(item.platformtoestand);
  if (BLOKKERENDE_TOESTANDEN.includes(toestand)) {
    const toelichting = item?.toelichting != null && item.toelichting !== "" ? `: ${item.toelichting}` : "";
    return `uitvoerder ${naam} staat volgens het uitvoerdersregister op ${toestand}${toelichting}`;
  }
  const teken = item?.laatste_teken ?? laatsteTeken;
  if (teken === null || teken === undefined) {
    return `uitvoerder ${naam} komt niet in het uitvoerdersregister voor en gaf geen enkel teken; zijn toestand is onbekend en telt daarom als blokkade`;
  }
  const stil = Math.round((nu.getTime() - ms(teken)) / 60_000);
  const bron = item === null ? "geen register" : `register meldt ${toestand}`;
  return `uitvoerder ${naam} gaf ${stil} min geen teken meer (${bron}, houdbaarheid ${UITVOERDER_TERMIJN_MINUTEN} min verstreken)`;
}

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

// De vier wachtpatronen staan in `overzicht.ts` en worden hier geïmporteerd.
// Ze stonden eerder hier, als eigen kopie, en het overzicht kende ze helemaal
// niet: de regie zette een taak op WAITING_FOR_EVENT terwijl de interface
// "JARVIS AAN ZET" toonde over diezelfde taak. Eén bron voorkomt dat de twee
// beelden opnieuw uit elkaar lopen; de toelichting per patroon staat bij de
// definitie.
//
// `AKKOORD_STAP` blijft hier: hij werkt samen met `akkoord_nodig` uit het
// overzicht en hoort bij de eigenaarstak, niet bij de wachtredenen.
const AKKOORD_STAP = /\bakkoord\b.*\beigenaar\b|\beigenaar\b.*\bakkoord\b/i;

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

/**
 * Aantoonbaar onderbroken werk: de laatste werkgang van deze taak eindigde in
 * een `vrijgave` — "ik ben gewoon niet klaar" — en er staat geen nieuwe claim
 * achter. Dat is het enige signaal dat een uitvoerder achterlaat wanneer hij
 * halverwege stopt zonder vast te lopen; een `klaar` telt niet, want dan is de
 * stap af, en een openstaande claim telt niet, want die is RUNNING of BLOCKED.
 *
 * Zonder dit signaal valt zulk werk terug in de gewone wachtrij en sorteert het
 * daar zelfs achteraan: de vrijgave is de jóngste activiteit, en `bepaalRegie`
 * sorteert binnen een klasse oplopend op `laatste_activiteit`. Werk dat
 * halverwege is afgebroken kwam zo achter werk dat nog nooit is begonnen.
 */
export function onderbrokenVan(taak: string, activiteit: readonly Activiteit[]): Activiteit | null {
  const rijen = activiteit.filter((a) => a.taak === taak).sort((a, b) => ms(a.op) - ms(b.op));
  let claim: Activiteit | null = null;
  let vrijgave: Activiteit | null = null;
  for (const a of rijen) {
    if (a.soort === "claim") { claim = a; vrijgave = null; continue; }
    if (!claim) continue;
    if (a.soort === "vrijgave") { claim = null; vrijgave = a; continue; }
    if (a.soort === "klaar") { claim = null; vrijgave = null; continue; }
  }
  return claim === null ? vrijgave : null;
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

/** Oordeel over één uitvoerder, zoals `bepaalTaak` het nodig heeft. */
type UitvoerderOordeel = (naam: string) => { readonly toestand: UitvoerderToestand; readonly reden: string };

/**
 * Hetzelfde oordeel, maar alleen wanneer het register de uitvoerder **kent**;
 * anders null.
 *
 * Voor een lopende claim geldt "ontbreken is een toestand": zonder register en
 * zonder vers teken is die claim geen lopende uitvoering meer (ontwerp §2.2).
 * Voor een stap die alleen aan een uitvoerder is *toegewezen* geldt dat niet: die
 * uitvoerder mag tussen twee taken door legitiem stil zijn, en zonder register zou
 * elke toegewezen stap een blokkade worden. Dat is het valse alarm van §7, en het
 * brak twee bestaande toetsen die vastleggen dat een toegewezen stap een
 * wachttoestand is.
 */
type RegisterOordeel = (naam: string) => { readonly toestand: UitvoerderToestand; readonly reden: string } | null;

function bepaalTaak(t: TaakItem, project: string, overzicht: Overzicht, activiteit: readonly Activiteit[], nu: Date, oordeel: UitvoerderOordeel, uitvoerder: string | null, uitRegister: RegisterOordeel = () => null): TaakRegie {
  const stappen = t.stappen ?? [];
  const open = stappen.filter((s) => !s.gedaan);
  const volgende = open[0]?.tekst ?? null;
  const laatste = laatsteActiviteit(t.id, activiteit) ?? t.laatste_beweging;
  const basis = { id: t.id, project, titel: t.titel, laatste_activiteit: laatste, volgende_stap: volgende, wacht_op: null as string | null,
    blokkade: null as TaakRegie["blokkade"], blokkade_rol: null as Rol | null,
    onderbroken: onderbrokenVan(t.id, activiteit) !== null };

  const uitvoering = uitvoeringVan(t.id, activiteit, nu);
  if (uitvoering && uitvoering.fout && uitvoering.levend) {
    const rol = isRol(uitvoering.claim.rol) ? uitvoering.claim.rol : "developer";
    return { ...basis, toestand: "BLOCKED", verantwoordelijke: rol, uitvoerder: uitvoering.claim.uitvoerder, sinds: uitvoering.fout.op, uitvoerbaar: true,
      blokkade: "fout", blokkade_rol: rol,
      waarom: `de uitvoering door ${rol} (${uitvoering.claim.uitvoerder}) meldde een fout: ${uitvoering.fout.tekst}` };
  }
  // De blokkade van een uitvoerder staat los van zijn heartbeat. Een sessie op
  // *Needs permissions* kan zojuist nog een stap hebben gemeld en dus springlevend
  // lijken, terwijl ze geen letter meer verzet. Tot 2026-09-21 kon alleen een
  // dóde claim BLOCKED opleveren (de tak hieronder), en bleef precies de
  // productiecasus van 2026-09-17 buiten beeld: `RUNNING`, nul afwijkingen. Het
  // register is daarom de eerste vraag, niet de laatste.
  if (uitvoering) {
    const rol = isRol(uitvoering.claim.rol) ? uitvoering.claim.rol : "developer";
    const over = oordeel(uitvoering.claim.uitvoerder);
    if (over.toestand === "GEBLOKKEERD") {
      return { ...basis, toestand: "BLOCKED", verantwoordelijke: "task-controller", uitvoerder: uitvoering.claim.uitvoerder,
        sinds: uitvoering.laatste.op, uitvoerbaar: true, wacht_op: over.reden,
        blokkade: "uitvoerder_geblokkeerd", blokkade_rol: rol,
        volgende_stap: `De claim van ${rol} (${uitvoering.claim.uitvoerder}) op ${t.id} vrijgeven en opnieuw dispatchen zodra de uitvoerder weer een teken geeft`,
        waarom: `${over.reden}; de claim van ${rol} op deze taak is daarmee geen lopende uitvoering meer. Een geblokkeerde uitvoerder is werk voor Jarvis, niet voor de eigenaar` };
    }
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

    // Een stap die aan één uitvoerder is toegewezen is alleen werk voor die
    // uitvoerder. Voor elke andere — en voor een regieronde die niet weet wie
    // ze draait — is het een wachttoestand, geen wachtrij.
    const toegewezen = UITVOERDER_STAP.exec(volgende);
    if (toegewezen) {
      const naam = toegewezen[1].toLowerCase();
      // Een stap die aan een uitvoerder is toegewezen is werk dat aan hém hangt,
      // ook zonder claim. Staat hij volgens het register geblokkeerd, dan wacht de
      // taak niet op hem — zij ligt stil, en dat is een blokkade.
      //
      // Dit was de productiecasus, en zij bleef buiten beeld: deze tak bouwde op
      // `...basis` en vroeg het register nooit. Drie taken stonden aan de
      // onbereikbare laptop toegewezen als `WAITING_FOR_DEPENDENCY` met
      // `blokkade: null`, en de regie meldde nul afwijkingen terwijl het register
      // die uitvoerder al dagen als geblokkeerd kende (QA op AC-11, bevinding 1).
      const overToegewezen = uitRegister(naam);
      if (overToegewezen !== null && overToegewezen.toestand === "GEBLOKKEERD") {
        return { ...basis, toestand: "BLOCKED", verantwoordelijke: "task-controller", uitvoerder: naam, sinds: laatste, uitvoerbaar: false,
          wacht_op: overToegewezen.reden, blokkade: "uitvoerder_geblokkeerd", blokkade_rol: null,
          volgende_stap: `${t.id} is aan ${naam} toegewezen, en die uitvoerder is geblokkeerd: de blokkade opheffen of de stap aan een andere uitvoerder toewijzen`,
          waarom: `${overToegewezen.reden}; de stap is aan ${naam} toegewezen en ligt daarmee stil. Een geblokkeerde uitvoerder is werk voor Jarvis, niet voor de eigenaar` };
      }
      if (uitvoerder === null || uitvoerder.toLowerCase() !== naam) {
        return { ...basis, toestand: "WAITING_FOR_DEPENDENCY", verantwoordelijke: "task-controller", uitvoerder: naam, sinds: laatste, uitvoerbaar: false, wacht_op: naam,
          waarom: uitvoerder === null
            ? `de stap is toegewezen aan uitvoerder ${naam}; deze regieronde weet niet welke uitvoerder ze draait`
            : `de stap is toegewezen aan uitvoerder ${naam}, niet aan ${uitvoerder}` };
      }
      const rolToegewezen = rolVoorStap(volgende);
      return { ...basis, toestand: "QUEUED", verantwoordelijke: rolToegewezen, uitvoerder: naam, sinds: laatste, uitvoerbaar: true,
        waarom: `uitvoerbaar, aan ${naam} toegewezen en niemand werkt eraan` };
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
  const onderbroken = onderbrokenVan(t.id, activiteit);
  return { ...basis, toestand: "QUEUED", verantwoordelijke: rol, uitvoerder: null, sinds: onderbroken?.op ?? laatste, uitvoerbaar: true,
    waarom: onderbroken !== null
      ? `onderbroken werk, te hervatten vóór nieuw werk: ${onderbroken.rol} (${onderbroken.uitvoerder}) gaf de taak terug zonder af te ronden — ${onderbroken.tekst}`
      : "uitvoerbaar, niemand werkt eraan" };
}

/**
 * De volgorde van uitvoerbaar werk. Herstel eerst, dan de afwijking, dan de
 * administratieve afronding, dan aantoonbaar onderbroken werk, en pas daarna
 * werk dat nog nooit is begonnen. Onderbroken werk dringt dus niet vóór een
 * blokkade, maar wel vóór nieuw werk: een halve levering afmaken gaat voor een
 * tweede halve levering beginnen.
 */
function prioriteit(t: TaakRegie): number {
  // Een taak waarvan de úítvoerder geblokkeerd is, is geen herstelwerk dat
  // voorgaat: er valt aan de taak zelf niets te repareren, en zolang de
  // blokkade duurt is elke andere taak nuttiger werk. Ze blijft uitvoerbaar —
  // een andere uitvoerder mag hem overnemen — maar zakt naar achteren, zodat
  // "ander uitvoerbaar werk gaat door" ook in de volgorde waar is (eis 6).
  if (t.blokkade === "uitvoerder_geblokkeerd") return 4;
  if (t.toestand === "BLOCKED") return 0;
  if (t.toestand === "AFWIJKING") return 1;
  if (t.toestand === "DONE") return 2;
  if (t.onderbroken) return 3;
  return 4;
}

/**
 * De regie over alle open taken en alle rollen.
 *
 * `uitvoerders` is het uitvoerdersregister: het bepaalt of een uitvoerder nog
 * leeft. `uitvoerder` is de uitvoerder die déze ronde draait (`laptop`,
 * `cloud`, …); stappen die aan een ándere uitvoerder zijn toegewezen tellen
 * dan niet als uitvoerbaar werk. Zonder uitvoerder telt geen enkele
 * toegewezen stap mee. Beide zijn optioneel, zodat bestaande aanroepen blijven
 * werken.
 */
export function bepaalRegie(overzicht: Overzicht, activiteit: readonly Activiteit[], nu: Date = new Date(), uitvoerders: Uitvoerders | null = null, uitvoerder: string | null = null): Regie {
  // Het register is optioneel, zodat bestaande aanroepen blijven werken.
  // Ontbreekt het, dan geldt `onbekend` — en `onbekend` is een toestand, geen
  // leegte: zonder vers teken telt hij als blokkade.
  // Eén uitvoerder kan meer dan één ingang hebben: de cloud-uitvoerder is
  // tegelijk een sessie die nu draait en een roosterroutine die morgen wekt.
  // Een `Map<naam, item>` hield daarvan stil de laatste over, en welke dat was
  // hing van de schrijfvolgorde af — een gepauzeerde routine verdween zo achter
  // een werkende sessie. Alle ingangen worden bewaard en het ergste geval wint:
  // is één ingang geblokkeerd, dan is de uitvoerder geblokkeerd.
  // De sleutel is de naam in kleine letters. Op de ruwe naam kende het register
  // `Laptop` "niet" terwijl het `laptop` beschrijft, en dan blokkeerde niets —
  // één tikfout van de schrijvende uitvoerder zette de hele tak uit, en de
  // uitvoer sprak zichzelf tegen (QA op AC-11, ronde 2, bevinding 3).
  const register = new Map<string, UitvoerderItem[]>();
  const bruikbaar = registerBruikbaar(uitvoerders, nu);
  for (const u of uitvoerders?.uitvoerders ?? []) {
    // Leeftijd mag twijfel toevoegen, nooit een gemelde blokkade wegnemen. Een
    // verlopen register werd hier in zijn geheel weggegooid, en daarna las
    // `oordeel` elke uitvoerder met een vers activiteitsteken als `ACTIEF` — ook
    // een uitvoerder die het register letterlijk als `blocked` beschrijft. Dat is
    // het omgekeerde van wat ontwerp §2.2 en §7 eisen ("het faalt luid"), en het
    // was bedoeld als verscherping (QA op AC-11, ronde 2, bevinding 2).
    if (!bruikbaar && !BLOKKERENDE_TOESTANDEN.includes(platformtoestandVan(u.platformtoestand))) continue;
    const sleutel = u.naam.toLowerCase();
    const rij = register.get(sleutel);
    if (rij === undefined) register.set(sleutel, [u]);
    else rij.push(u);
  }
  const tekenVan = (naam: string): string | null => {
    let best: string | null = null;
    for (const a of activiteit) if (a.uitvoerder === naam && (best === null || ms(a.op) > ms(best))) best = a.op;
    return best;
  };
  /** Het oordeel over een rij ingangen: het ergste geval wint. */
  const oordeelOver = (naam: string, rij: readonly UitvoerderItem[]) => {
    const teken = tekenVan(naam);
    if (rij.length === 0) return { toestand: uitvoerderToestand(null, teken, nu), reden: blokkadeReden(naam, null, teken, nu) };
    const slechtste = rij.find((item) => uitvoerderToestand(item, teken, nu) === "GEBLOKKEERD");
    if (slechtste !== undefined) return { toestand: "GEBLOKKEERD" as const, reden: blokkadeReden(naam, slechtste, teken, nu) };
    return { toestand: "ACTIEF" as const, reden: blokkadeReden(naam, rij[0], teken, nu) };
  };
  const ingangen = (naam: string) => register.get(naam.toLowerCase()) ?? [];
  /**
   * Continuïteit: wekt er nog iets de keten? Alle ingangen tellen, het ergste
   * geval wint. Dit is het oordeel voor de lijst `uitvoerders` en voor `blokkades`.
   */
  const oordeel: UitvoerderOordeel = (naam) => oordeelOver(naam, ingangen(naam));
  /**
   * De ingangen die over het werk van *nu* gaan: een sessie of een laptop.
   *
   * In het echte register is `cloud` tegelijk een `working` sessie met een vers
   * teken én een `blocked` roosterroutine. Met "het ergste geval wint" op zowel
   * continuïteit als dispatch werd elke stap met `Uitvoerder: cloud` geblokkeerd
   * met de routine als reden — de uitvoerder die de regieronde op dat moment
   * zelf draait, zou zijn eigen geclaimde werk blokkeren. Dat is het valse alarm
   * dat ontwerp §7 verbiedt (QA op AC-11, ronde 2, bevinding 4).
   *
   * Maar een routine mag alleen wijken voor een ingang die wél over nu gaat.
   * Een filter zonder terugval gooide de énige uitspraak weg die het register
   * over zo'n uitvoerder deed, en dan las een `requires_action`-uitvoerder met
   * een vers teken weer stil als `ACTIEF` — hetzelfde stille falen dat dit
   * register wegneemt, nu een laag dieper. Kent het register voor deze
   * uitvoerder geen sessie en geen laptop, dan tellen al zijn ingangen.
   */
  const dispatchIngangen = (naam: string): readonly UitvoerderItem[] => {
    const rij = ingangen(naam);
    const nu2 = rij.filter((u) => u.soort === undefined || u.soort === "sessie" || u.soort === "laptop");
    return nu2.length > 0 ? nu2 : rij;
  };
  /**
   * Dispatch: kan deze uitvoerder nú werk doen? Dat is een andere vraag dan
   * "wekt er nog iets de keten?", en die twee waren samengevoegd. Een
   * gepauzeerde routine blijft zichtbaar in `uitvoerders` en in de
   * blokkadeteller; zij houdt alleen geen lopend werk meer tegen zolang een
   * sessie of laptop over dit moment spreekt.
   */
  const oordeelDispatch: UitvoerderOordeel = (naam) => oordeelOver(naam, dispatchIngangen(naam));
  // Alleen wat het register expliciet over deze uitvoerder zegt; kent het hem
  // niet, dan is er geen oordeel. Zie `RegisterOordeel` voor waarom dat verschil
  // ertoe doet.
  const uitRegister: RegisterOordeel = (naam) =>
    dispatchIngangen(naam).length === 0 ? null : oordeelDispatch(naam);

  const taken: TaakRegie[] = [];
  const gezien = new Set<string>();
  for (const p of overzicht.projecten) {
    for (const t of p.taken) {
      if (t.status !== "actief" && t.status !== "review") continue;
      if (gezien.has(t.id)) continue; // een dossierspiegel in een ander project telt niet als tweede taak
      gezien.add(t.id);
      taken.push(bepaalTaak(t, t.project ?? p.id, overzicht, activiteit, nu, oordeelDispatch, uitvoerder, uitRegister));
    }
  }
  const uitvoerbaar = taken
    .filter((t) => t.uitvoerbaar)
    .sort((a, b) => prioriteit(a) - prioriteit(b) || (a.laatste_activiteit ?? "").localeCompare(b.laatste_activiteit ?? ""));
  // Een stilgevallen of volgens het register geblokkeerde uitvoerder telt als
  // afwijking: hij meldt zichzelf per definitie niet, dus zonder deze regel
  // blijft hij buiten elke rapportage. Een gemelde fout hoeft dat niet — die
  // staat al luid in de regie. Dit is de directe toets op de invariant: er
  // bestaat geen regie-uitkomst met een geblokkeerde uitvoerder én
  // `afwijkingen.length === 0`.
  const afwijkingen = taken.filter((t) => t.toestand === "AFWIJKING" || t.blokkade === "uitvoerder_stil" || t.blokkade === "uitvoerder_geblokkeerd");
  const aantalGeblokkeerd = taken.filter((t) => t.toestand === "BLOCKED").length;

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
        wat: `bewaakt ${taken.length} open ${taken.length === 1 ? "taak" : "taken"}: ${uitvoerbaar.length} uitvoerbaar, ${taken.filter((t) => t.toestand === "WAITING_FOR_USER").length} bij de eigenaar, ${aantalGeblokkeerd} geblokkeerd, ${afwijkingen.length} afwijking(en)`,
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

  // Elke uitvoerder die het register kent of die in de werkactiviteit voorkomt,
  // met zijn toestand en de taken die aan hem hangen. Een geblokkeerde uitvoerder
  // zonder taken was anders onzichtbaar.
  const namen = new Set<string>([...register.keys()]);
  for (const a of activiteit) namen.add(a.uitvoerder);
  const uitvoerderStand: UitvoerderRegie[] = [...namen]
    .sort()
    .map((naam) => {
      const over = oordeel(naam);
      return {
        naam,
        toestand: over.toestand,
        reden: over.reden,
        taken: taken.filter((t) => t.uitvoerder !== null && t.uitvoerder.toLowerCase() === naam.toLowerCase()).map((t) => t.id),
      };
    });
  const blokkades = uitvoerderStand.filter((u) => u.toestand === "GEBLOKKEERD");
  return { gegenereerd_op: nu.toISOString(), taken, rollen, uitvoerders: uitvoerderStand, blokkades, uitvoerbaar, afwijkingen };
}
