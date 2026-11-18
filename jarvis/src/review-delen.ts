// De wijziging in leesbare delen, en de oordelen van die delen weer samen.
//
// De grenzen op wat er naar de reviewer gaat waren afkapmaten: een patch boven
// `patchPerBestand` ging afgekapt mee en een bestand boven `diffTekens` werd
// weggelaten. De reviewer deed daardoor bevindingen over regels die hij nooit
// zag (gemeten op jarvis-engine#151: een patch van 22.803 tekens, waarvan hij
// 12.000 kreeg, met twee punten van ernst hoog over de knipplek). Hier worden
// het knipmaten: een grote patch gaat in genummerde delen, de delen gaan over
// leesronden, en wat écht niet te lezen is wordt benoemd.
//
// Dit staat niet in review.ts omdat het daar niet hoort, maar ook omdat een
// bestand waarvan de eigen diff te groot is om te beoordelen deel van hetzelfde
// probleem zou zijn.

import type { Review, ReviewPunt } from "./review";

/**
 * Grenzen op wat er naar de reviewer gaat; een review is geen tweede bouwronde.
 *
 * `patchPerBestand` en `diffTekens` zijn knipmaten, geen afkapmaten: een grotere
 * patch wordt in genummerde delen gelezen en een grotere diff in meer leesronden.
 * `ronden` begrenst wat dat mag kosten: daarboven is de wijziging te groot om in
 * één review volledig te lezen en volgt een NO-GO met die reden, nooit een stil
 * weggelaten bestand.
 */
export const REVIEW_LIMIETEN = {
  diffTekens: 60_000,
  patchPerBestand: 12_000,
  dossierTekens: 6_000,
  contextTekens: 24_000,
  beschrijvingTekens: 4_000,
  ronden: 4,
} as const;

/** Eén bestand uit de diff zoals GitHub het geeft. */
export type DiffBestand = {
  readonly bestand: string;
  readonly status: string;
  /** De patch-tekst, of null als GitHub er geen gaf (binair, of een diff die GitHub weglaat). */
  readonly patch: string | null;
  /** Het aantal gewijzigde regels dat GitHub meldt. 0 = geen tekst in dit bestand (afbeelding en dergelijke). */
  readonly wijzigingen?: number;
};

/** Eén stuk diff zoals de reviewer het ziet: de hele patch, of een genummerd deel ervan. Nooit afgekapt. */
export type Diffstuk = {
  readonly bestand: string;
  readonly status: string;
  readonly patch: string;
  /** Het hoeveelste deel van de patch dit is, en uit hoeveel delen zij bestaat. Weglaten = de hele patch. */
  readonly deel?: number;
  readonly delen?: number;
};

/** Eén leesronde: de stukken die samen binnen het diffbudget van één vraag passen. */
export type Leesronde = readonly Diffstuk[];

/** Een bestand zonder tekstdiff: bij naam gemeld, nooit als gelezen code geteld. */
export type ZonderTekst = { readonly bestand: string; readonly status: string };

/** Wat de reviewer te lezen krijgt, en wat hij niet kan lezen. */
export type Verdeling = {
  /** De leesronden: per ronde de stukken die binnen het diffbudget passen. */
  readonly ronden: readonly Leesronde[];
  /** De bestanden zonder tekstdiff; die gaan als lijst met namen mee, niet als inhoud. */
  readonly zonderTekst: readonly ZonderTekst[];
  /** Waarom deze wijziging niet volledig te lezen is; leeg = volledig te lezen. */
  readonly onvolledig: readonly string[];
};

/** De patch in regels die elk hun eigen regelovergang houden: alles achter elkaar is weer precies de patch. */
function regels(patch: string): readonly string[] {
  const stukken = patch.split("\n");
  return stukken.map((r, i) => (i === stukken.length - 1 ? r : `${r}\n`)).filter((r) => r !== "");
}

/** De patch in hunks: de kop (alles vóór de eerste @@) en daarna elk @@-blok. */
function hunks(patch: string): readonly string[] {
  const uit: string[] = [];
  let huidig = "";
  for (const regel of regels(patch)) {
    if (regel.startsWith("@@") && huidig !== "") {
      uit.push(huidig);
      huidig = "";
    }
    huidig += regel;
  }
  if (huidig !== "") uit.push(huidig);
  return uit;
}

/** Eén te groot blok op regelgrenzen knippen; een regel die zelf te lang is, op tekens. */
function opRegels(blok: string, max: number): readonly string[] {
  const uit: string[] = [];
  let huidig = "";
  for (const regel of regels(blok)) {
    if (regel.length > max) {
      if (huidig !== "") uit.push(huidig);
      huidig = "";
      for (let i = 0; i < regel.length; i += max) uit.push(regel.slice(i, i + max));
      continue;
    }
    if (huidig.length + regel.length > max && huidig !== "") {
      uit.push(huidig);
      huidig = regel;
      continue;
    }
    huidig += regel;
  }
  if (huidig !== "") uit.push(huidig);
  return uit;
}

/**
 * Knipt een patch in delen van hoogstens `max` tekens, het liefst op hunkgrenzen,
 * anders op regelgrenzen en pas in het uiterste geval op tekens. Afkappen gebeurt
 * nooit: de delen achter elkaar gezet zijn precies de oorspronkelijke patch.
 */
export function knipPatch(patch: string, max: number = REVIEW_LIMIETEN.patchPerBestand): readonly string[] {
  if (patch.length <= max) return [patch];
  const delen: string[] = [];
  let huidig = "";
  for (const h of hunks(patch)) {
    for (const stuk of h.length <= max ? [h] : opRegels(h, max)) {
      if (huidig !== "" && huidig.length + stuk.length > max) {
        delen.push(huidig);
        huidig = "";
      }
      huidig += stuk;
    }
  }
  if (huidig !== "") delen.push(huidig);
  return delen;
}

/**
 * Verdeelt de diff over leesronden zodat de reviewer de héle wijziging ziet: een
 * grote patch in genummerde delen, een grote diff in meer ronden. Een bestand
 * zonder tekstdiff waarvan GitHub wél gewijzigde regels meldt, is ongelezen code
 * en blijft een reden voor NO-GO (B3 op jarvis-engine#88); een bestand met nul
 * gewijzigde regels heeft geen tekst en wordt bij naam gemeld.
 */
export function verdeelDiff(diff: readonly DiffBestand[]): Verdeling {
  const stukken: Diffstuk[] = [];
  const zonderTekst: ZonderTekst[] = [];
  const onvolledig: string[] = [];
  for (const b of diff) {
    if (b.patch === null || b.patch.length === 0) {
      if (b.wijzigingen === 0) {
        zonderTekst.push({ bestand: b.bestand, status: b.status });
        continue;
      }
      onvolledig.push(
        b.wijzigingen === undefined
          ? `${b.bestand}: geen patch en geen regelaantal, dus niet te lezen`
          : `${b.bestand}: geen patch terwijl GitHub ${b.wijzigingen} gewijzigde regel(s) meldt`,
      );
      continue;
    }
    const delen = knipPatch(b.patch, REVIEW_LIMIETEN.patchPerBestand);
    delen.forEach((patch, i) => stukken.push({ bestand: b.bestand, status: b.status, patch, deel: i + 1, delen: delen.length }));
  }
  const ronden: Diffstuk[][] = [];
  let huidig: Diffstuk[] = [];
  let lengte = 0;
  for (const s of stukken) {
    const kosten = s.patch.length + s.bestand.length + 80;
    if (huidig.length > 0 && lengte + kosten > REVIEW_LIMIETEN.diffTekens) {
      ronden.push(huidig);
      huidig = [];
      lengte = 0;
    }
    huidig.push(s);
    lengte += kosten;
  }
  if (huidig.length > 0) ronden.push(huidig);
  if (ronden.length > REVIEW_LIMIETEN.ronden) {
    onvolledig.push(`de wijziging vraagt ${ronden.length} leesronden en dat is meer dan ${REVIEW_LIMIETEN.ronden}; splits de wijziging of maak haar kleiner`);
  }
  return { ronden, zonderTekst, onvolledig };
}

/**
 * Kan de reviewer deze diff volledig lezen? Code die hij niet ziet, mag geen GO krijgen
 * (QA-bevinding B3 op jarvis-engine#88). Omvang alleen is daarvoor geen reden meer: die
 * wordt in delen en ronden gelezen. Geeft de redenen; leeg = volledig.
 */
export function onvolledigGelezen(diff: readonly DiffBestand[]): readonly string[] {
  return verdeelDiff(diff).onvolledig;
}

/**
 * Eén oordeel uit de oordelen van de leesronden: wat één ronde afkeurt, keurt het
 * geheel af, en alle punten blijven staan. Zonder oordelen is er niets gelezen.
 */
export function combineerReviews(delen: readonly Review[]): Review {
  if (delen.length === 1 && delen[0] !== undefined) return delen[0];
  if (delen.length === 0) {
    return {
      oordeel: "correctie",
      samenvatting: "Geen enkele leesronde gaf een oordeel.",
      punten: [{ ernst: "hoog", tekst: "de reviewer gaf geen oordeel over deze wijziging", bestand: null }],
      conclusie_eigenaar: "De controle leverde geen oordeel op; de wijziging gaat daarom nog niet door.",
    };
  }
  const punten: ReviewPunt[] = [];
  const gezien = new Set<string>();
  for (const d of delen) {
    for (const p of d.punten) {
      const sleutel = `${p.ernst}|${p.bestand ?? ""}|${p.tekst}`;
      if (gezien.has(sleutel)) continue;
      gezien.add(sleutel);
      punten.push(p);
    }
  }
  const correctie = delen.find((d) => d.oordeel === "correctie");
  return {
    oordeel: correctie === undefined ? "akkoord" : "correctie",
    samenvatting: delen
      .map((d, i) => `Ronde ${i + 1}: ${d.samenvatting}`)
      .join(" ")
      .slice(0, 2_000),
    punten,
    conclusie_eigenaar: (correctie ?? delen[0] ?? { conclusie_eigenaar: "" }).conclusie_eigenaar,
  };
}
