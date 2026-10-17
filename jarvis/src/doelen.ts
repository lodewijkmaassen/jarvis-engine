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

/** Na zoveel NO-GO's van de reviewer op een pull request staat het doel vast; geen eindeloze rondes. */
export const MAX_NO_GO = 2;

/** Zo lang mag een doel zonder beweging staan voordat de dispatcher de uitvoerder start. */
export const STIL_MINUTEN = 20;

/** Het doel dat een pull request dient: een regel "Doel: D-…" in de PR-tekst. */
export function doelUitPrTekst(tekst: string): string | null {
  return /^\s*Doel:\s*(D-\d{8}-\d{6}(?:\d{3})?)\s*$/m.exec(tekst.replace(/\r\n/g, "\n"))?.[1] ?? null;
}

export type ReviewOordeel = { readonly kop: string; readonly oordeel: string; readonly door: string };

/**
 * Wat de reviewjob met een pull request doet.
 *   - "wacht": de checks op de kop zijn nog niet allemaal groen; eerst de poort en de tests.
 *   - "klaar": de reviewer heeft deze kop al beoordeeld; niet opnieuw.
 *   - "vast": MAX_NO_GO keer NO-GO; het doel staat vast, er wordt niet verder gereviewd.
 *   - "review": beoordelen.
 */
export function reviewBesluit(
  kop: string,
  oordelen: readonly ReviewOordeel[],
  checksGroen: boolean,
): "wacht" | "klaar" | "vast" | "review" {
  const vanReviewer = oordelen.filter((o) => o.door === REVIEWER_DOOR);
  if (vanReviewer.some((o) => o.kop === kop)) return "klaar";
  if (vanReviewer.filter((o) => o.oordeel !== "GO").length >= MAX_NO_GO) return "vast";
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
export function dispatchNodig(doelen: readonly Pick<Doel, "id" | "status" | "bijgewerkt">[], nu: Date): { readonly start: boolean; readonly reden: string } {
  const werk = doelen.filter((d) => d.status === "open" || d.status === "bezig" || d.status === "review");
  if (werk.length === 0) return { start: false, reden: "geen doel in uitvoering" };
  const stil = werk.filter((d) => d.status === "open" || nu.getTime() - Date.parse(d.bijgewerkt) >= STIL_MINUTEN * 60_000);
  if (stil.length === 0) return { start: false, reden: `${werk.length} doel(en) in beweging` };
  return { start: true, reden: `${stil.length} doel(en) zonder recente beweging: ${stil.map((d) => d.id).join(", ")}` };
}
