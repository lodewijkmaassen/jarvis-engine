// Doelen — de kleinste keten die werkt (T-20261017-jarvis-vereenvoudigen).
//
//   eigenaar geeft een doel → de uitvoerder bouwt en opent een pull request →
//   de reviewjob in CI (een ander model, rol jarvis_ci) beoordeelt → de
//   attestatie voegt samen → de eindcontrole in CI meet productie → klaar.
//
// Dit bestand is de pure kant: de beslisregels. Netwerk en database staan in
// doelen-cli.ts. De eigenaar komt in deze keten niet voor; zijn enige handeling
// is het doel zelf.

import { REVIEWER_DOOR } from "./attestatie";

export const DOEL_STATUSSEN = ["open", "bezig", "review", "samengevoegd", "klaar", "vast"] as const;
export type DoelStatus = (typeof DOEL_STATUSSEN)[number];

export type Doel = {
  readonly id: string;
  readonly titel: string;
  readonly opdracht: string;
  readonly acceptatie_url: string | null;
  readonly status: DoelStatus;
  readonly pr: { readonly repo?: string; readonly nummer?: number; readonly kop?: string; readonly merge_sha?: string } | null;
  readonly uitkomst: string | null;
  readonly pogingen: number;
  readonly bijgewerkt: string;
};

/**
 * Het tweede model en hoeveel tijd het krijgt. Eén plek, want twee aanroepers gebruiken dezelfde
 * voorziening: de review van een pull request en het beoordelen van een acceptatietest.
 */
export const REVIEW_MODEL = "gpt-5.1";
export const REVIEW_WACHT_MS = 240_000;

/** Na zoveel NO-GO's van de reviewer op een pull request staat het doel vast; geen eindeloze rondes. */
export const MAX_NO_GO = 2;

/** Zo lang mag een doel zonder beweging staan voordat de dispatcher de uitvoerder start. */
export const STIL_MINUTEN = 20;

/** Het doel dat een pull request dient: een regel "Doel: D-…" in de PR-tekst. */
/** De vorm van een doel-id zoals jarvis.doel_nieuw ze uitgeeft. Alles anders is geen doel en gaat niet in een filter. */
export const DOEL_VORM = /^D-[0-9]{8}-[0-9]{6}(?:[0-9]{3})?$/;

export function doelUitPrTekst(tekst: string): string | null {
  return /^\s*Doel:\s*(D-\d{8}-\d{6}(?:\d{3})?)\s*$/m.exec(tekst.replace(/\r\n/g, "\n"))?.[1] ?? null;
}

/**
 * De versie van de keten waarmee de eindcontrole een uitkomst schreef, als
 * sluitstuk achter die uitkomst: ` [keten 1a2b3c4]`.
 *
 * WAAROM DIT BESTAAT
 *
 * Eén samenvoeging wordt één keer vastgelegd. Die regel is er met reden: zonder
 * haar haalde de sweep een doel dat de eindcontrole net in de herstelketen had
 * gezet meteen weer naar `samengevoegd`, waarna de eindcontrole het opnieuw
 * terugzette — tien keer in één uur. Maar zij heeft een prijs: lag de fout in
 * de keten zélf, dan was er na het herstel geen weg terug naar `samengevoegd`,
 * en moest er een nieuwe samenvoeging op het eigen dossier worden gemaakt om
 * een doel opnieuw te laten meten. Dat is een kunstmatige handeling van een
 * mens (RSK-0033, gemeten 2026-11-07).
 *
 * Met deze markering is er een derde mogelijkheid: niet "altijd opnieuw" en
 * niet "nooit meer", maar "opnieuw zodra de keten zelf is veranderd". De
 * versie is de commit van de engine die in deze repository is vastgepind — en
 * die wijzigt precies dan, en alleen dan, wanneer er aan de keten is gewerkt.
 */
export function metKetenVersie(tekst: string, versie: string | null): string {
  const kort = (versie ?? "").trim().slice(0, 12);
  return kort === "" ? tekst : `${tekst} [keten ${kort}]`;
}

/** De versie uit zo'n uitkomst, of null als er geen in staat. */
export function ketenVersieUit(uitkomst: string | null): string | null {
  return /\[keten ([0-9a-zA-Z._-]{1,12})\]\s*$/.exec((uitkomst ?? "").trim())?.[1] ?? null;
}

/**
 * Mag dit doel opnieuw gemeten worden op de samenvoeging die er al is?
 *
 * Alleen wanneer alles hieronder klopt:
 *   - het doel loopt (`bezig`) en heeft een vastgelegde samenvoeging;
 *   - de laatste uitkomst is een blokkade die van Jarvis zélf is — `[fout]` of
 *     `[bevoegdheid]`. Een besluit of een beveiligingsgrens is niet van de
 *     keten en wordt hier niet overgedaan;
 *   - die uitkomst is gemeten met een andere versie van de keten dan de
 *     huidige. Is de keten niet veranderd, dan is er niets om opnieuw te
 *     meten en zou hetzelfde antwoord nog een keer komen.
 */
export function hermeetbaar(
  d: Pick<Doel, "status" | "pr" | "uitkomst">,
  huidigeVersie: string | null,
): boolean {
  if (d.status !== "bezig" || !d.pr?.merge_sha) return false;
  if (!/^\[(fout|bevoegdheid)\]/.test((d.uitkomst ?? "").trim())) return false;
  const gemetenMet = ketenVersieUit(d.uitkomst);
  if (gemetenMet === null || huidigeVersie === null) return false;
  return gemetenMet !== huidigeVersie.trim().slice(0, 12);
}

export type ReviewOordeel = { readonly kop: string; readonly oordeel: string; readonly door: string; readonly op?: string };

/**
 * Wat de reviewjob met een pull request doet.
 *   - "wacht": de checks op de kop zijn nog niet allemaal groen; eerst de poort en de tests.
 *   - "klaar": de reviewer heeft deze kop al beoordeeld; niet opnieuw.
 *   - "vast": MAX_NO_GO keer NO-GO; het doel staat vast, er wordt niet verder gereviewd. Heropende de eigenaar
 *     het doel (`sinds`), dan tellen alleen de NO-GO's van daarna: zijn heropenen is een nieuwe kans.
 *   - "review": beoordelen.
 */
export function reviewBesluit(
  kop: string,
  oordelen: readonly ReviewOordeel[],
  checksGroen: boolean,
  sinds: string | null = null,
): "wacht" | "klaar" | "vast" | "review" {
  const vanReviewer = oordelen.filter((o) => o.door === REVIEWER_DOOR);
  if (vanReviewer.some((o) => o.kop === kop)) return "klaar";
  const grens = sinds === null ? NaN : Date.parse(sinds);
  const telt = (o: ReviewOordeel) => Number.isNaN(grens) || (o.op !== undefined && Date.parse(o.op) > grens);
  if (vanReviewer.filter((o) => o.oordeel !== "GO" && telt(o)).length >= MAX_NO_GO) return "vast";
  if (!checksGroen) return "wacht";
  return "review";
}

/** Zijn alle checks op de kop afgerond en geslaagd (of overgeslagen), en is de verplichte check er? */
export function checksGroen(
  checks: readonly { readonly naam: string; readonly status: string; readonly conclusie: string | null }[],
  verplicht: string,
): boolean {
  if (!checks.some((c) => c.naam === verplicht)) return false;
  return checks.every((c) => c.status === "completed" && (c.conclusie === "success" || c.conclusie === "skipped" || c.conclusie === "neutral"));
}

/** Moet de dispatcher de uitvoerder starten? Ja als er een doel open, bezig of in review staat zonder recente beweging. */
/** Toestanden waarin een doel op de keten wacht: dan hoort er een ronde te komen. */
export const WACHTENDE_TOESTANDEN: readonly string[] = ["open", "bezig", "review", "samengevoegd"];

/** Een gat tussen twee ronden dat groter is dan dit heet stilstand, als er werk stond te wachten. */
export const KETEN_STILSTAND_MINUTEN = 30;

/** Niet vaker dan dit een spoor schrijven: een ronde elke twee minuten hoeft niet elke keer in de activiteit. */
export const KETEN_SPOOR_MINUTEN = 10;

export type KetenSpoor = {
  /** Moet deze ronde een regel schrijven? */
  readonly schrijven: boolean;
  /** Is dit stilstand: te lang geleden, terwijl er werk wachtte? */
  readonly stilstand: boolean;
  /** De regel zoals hij in de activiteit komt. */
  readonly tekst: string;
};

/**
 * Wat de keten over haar eigen ronde vastlegt, en of zij stilstand ziet.
 *
 * WAAROM DIT BESTAAT
 *
 * De keten wordt vanuit de database gestart: `jarvis.doel_ronde()` draait op
 * een rooster in Postgres en stuurt een dispatch zodra er werk is. Gemeten op
 * 2026-11-07: tijdens werk kwam er elke twee minuten een ronde, en zodra er
 * een GO lag ook de attestatie. Het rooster van GitHub zelf is onbetrouwbaar
 * (vier tot acht uur ertussen gemeten, in drie repositories gelijk) en is de
 * reserve, niet de motor.
 *
 * Wat ontbrak, was niet het starten maar het ZIEN. Valt die starter weg — een
 * token dat verloopt, een rooster dat verdwijnt, een netwerkroute die dicht
 * gaat — dan gebeurt er niets, en meldt niets dat er niets gebeurt. Elke ronde
 * laat daarom een spoor na met hoe lang geleden de vorige draaide. Stond er
 * werk te wachten en is dat gat te groot, dan heet dat stilstand; de ronde die
 * het opmerkt is tegelijk het herstel, want zij doet alsnog wat er lag.
 *
 * Niet elke ronde schrijft: tijdens druk werk zou dat elke twee minuten een
 * regel zijn. Eén regel per tien minuten laat elk gat zien dat ertoe doet, en
 * een gat dat stilstand heet wordt altijd geschreven.
 */
export function ketenSpoor(o: {
  readonly nu: Date;
  /** Wanneer de vorige ronde een spoor naliet, of null als er nog geen is. */
  readonly vorige: string | null;
  /** Waardoor deze ronde startte (het event van de workflow). */
  readonly oorzaak: string;
  /** Hoeveel doelen op de keten wachtten. */
  readonly wachtend: number;
}): KetenSpoor {
  const minuten = o.vorige === null ? null : Math.round((o.nu.getTime() - Date.parse(o.vorige)) / 60_000);
  const stilstand = minuten !== null && minuten >= KETEN_STILSTAND_MINUTEN && o.wachtend > 0;
  const hoelang = minuten === null ? "eerste spoor" : `vorige ronde ${minuten} min geleden`;
  const werk = o.wachtend === 0 ? "niets te doen" : `${o.wachtend} doel(en) wachtend`;
  return {
    schrijven: minuten === null || minuten >= KETEN_SPOOR_MINUTEN || stilstand,
    stilstand,
    tekst: `ketenronde (${o.oorzaak || "onbekend"}) — ${hoelang}; ${werk}${stilstand ? "; STILSTAND: er stond werk te wachten" : ""}`,
  };
}

export function dispatchNodig(doelen: readonly Pick<Doel, "id" | "status" | "bijgewerkt">[], nu: Date): { readonly start: boolean; readonly reden: string } {
  const werk = doelen.filter((d) => d.status === "open" || d.status === "bezig" || d.status === "review");
  if (werk.length === 0) return { start: false, reden: "geen doel in uitvoering" };
  const stil = werk.filter((d) => d.status === "open" || nu.getTime() - Date.parse(d.bijgewerkt) >= STIL_MINUTEN * 60_000);
  if (stil.length === 0) return { start: false, reden: `${werk.length} doel(en) in beweging` };
  return { start: true, reden: `${stil.length} doel(en) zonder recente beweging: ${stil.map((d) => d.id).join(", ")}` };
}
