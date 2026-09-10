// De deterministische poort.
//
// Dit is bewust de laag die GEEN model gebruikt. Een semantische controle door
// een agent is waardevol maar niet herhaalbaar; deze controle draait in CI,
// kost niets, en geeft bij dezelfde invoer altijd hetzelfde oordeel. Als een
// voorstel botst met een harde randvoorwaarde, hoort dat hier te stranden —
// niet pas als iemand het toevallig opmerkt.
//
// Twee soorten bevindingen:
//   fout          — blokkeert; de build faalt
//   waarschuwing  — zichtbaar, blokkeert niet
import { matchtGlob, normaliseerPad } from "./classify";
import type { JarvisConfig } from "./config";
import { isActiefRecord, type KnowledgeRecord } from "./records";
import { formatteerBevinding, formatteerLaadFout, type KennisLading } from "./store";

export const LINT_CODES = [
  "kennis_ongeldig",
  "kennis_signaal",
  "laadfout",
  "randvoorwaarde_geraakt",
  "randvoorwaarde_signaal",
  "ack_onbekend",
  "status_verouderd",
  "status_impact_ontbreekt",
  "workflow_gewijzigd",
  "dec_quotum",
] as const;
export type LintCode = (typeof LINT_CODES)[number];

export type LintBevinding = {
  readonly code: LintCode;
  readonly severity: "fout" | "waarschuwing";
  readonly onderwerp: string;
  readonly boodschap: string;
};

export type LintInvoer = {
  readonly config: JarvisConfig;
  readonly lading: KennisLading;
  /** Repo-relatieve paden die in deze wijziging zijn geraakt. */
  readonly gewijzigdeBestanden: readonly string[];
  /** Vrije tekst waarin triggerwoorden gezocht worden: taakomschrijving + PR-tekst. */
  readonly tekstCorpus: string;
  /** Expliciet afgevinkte randvoorwaarden ("Constraint-ack: CON-0004"). */
  readonly acks: readonly string[];
  /** Hoeveel status-dragende commits sinds CURRENT_STATE voor het laatst wijzigde. */
  readonly statusCommitsSinds?: number;
  /** Staat er een expliciete "Current-State-Impact"-verklaring in de PR-tekst? */
  readonly statusImpactVerklaard?: boolean;
  /** Aantal nieuwe DEC-records in deze wijziging. */
  readonly nieuweDecs?: number;
};

export type LintResultaat = {
  readonly ok: boolean;
  readonly bevindingen: readonly LintBevinding[];
};

function bevinding(
  code: LintCode,
  severity: "fout" | "waarschuwing",
  onderwerp: string,
  boodschap: string,
): LintBevinding {
  return { code, severity, onderwerp, boodschap };
}

/**
 * Zoekt een triggerwoord in vrije tekst.
 *
 * Woordgrenzen, hoofdletterongevoelig, meervouds-s toegestaan. Verder geen
 * fuzziness: stemming levert vals-positieven op, en die zijn hier duurder dan
 * een gemiste treffer — de semantische laag vangt de rest.
 *
 * Het streepje is bewust een GRENS en geen woordteken. Anders mist "webhook"
 * de zin "de klant vult zijn webhook-URL in", wat precies het geval is dat deze
 * controle moet vangen. Een meerdelige term als "API-key" bevat het streepje
 * zelf en matcht daardoor nog steeds letterlijk. De prijs is dat "webhook" ook
 * binnen "mijn-webhook-helper" aanslaat; dat is hier de juiste kant om op te
 * falen.
 */
export function bevatTriggerwoord(tekst: string, woord: string): boolean {
  const genormaliseerd = tekst.toLowerCase();
  const doel = woord.toLowerCase().trim();
  if (doel.length === 0) return false;
  const ontsnapt = doel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_])${ontsnapt}s?([^a-z0-9_]|$)`, "i").test(genormaliseerd);
}

/**
 * Controleert de harde en zachte randvoorwaarden tegen deze wijziging.
 *
 * Een randvoorwaarde wordt "geraakt" wanneer de wijziging een van haar paden
 * aanraakt OF de tekst een van haar triggerwoorden noemt. Bij een HARDE
 * randvoorwaarde is dat blokkerend tenzij er een expliciete ack is; die ack
 * hoort van een mens te komen, niet van de agent zelf.
 */
export function toetsRandvoorwaarden(
  records: readonly KnowledgeRecord[],
  gewijzigdeBestanden: readonly string[],
  tekstCorpus: string,
  acks: readonly string[],
): readonly LintBevinding[] {
  const bevindingen: LintBevinding[] = [];
  const paden = gewijzigdeBestanden.map(normaliseerPad);
  const ackSet = new Set(acks.map((a) => a.trim().toUpperCase()));

  const constraints = records
    .filter((r): r is Extract<KnowledgeRecord, { type: "CON" }> => r.type === "CON")
    .filter((r) => isActiefRecord(r))
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  for (const con of constraints) {
    const triggers = con.triggers;
    if (!triggers) continue;

    const geraaktePaden = triggers.paden.length > 0 ? paden.filter((p) => matchtGlob(p, triggers.paden)) : [];
    const geraakteWoorden = triggers.woorden.filter((w) => bevatTriggerwoord(tekstCorpus, w));
    if (geraaktePaden.length === 0 && geraakteWoorden.length === 0) continue;

    const aanleiding = [
      geraaktePaden.length > 0 ? `paden: ${geraaktePaden.slice(0, 5).join(", ")}` : null,
      geraakteWoorden.length > 0 ? `woorden: ${geraakteWoorden.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    if (con.hardheid === "zacht") {
      bevindingen.push(
        bevinding(
          "randvoorwaarde_signaal",
          "waarschuwing",
          con.id,
          `zachte randvoorwaarde geraakt (${aanleiding}). Regel: ${con.regel}`,
        ),
      );
      continue;
    }

    if (ackSet.has(con.id.toUpperCase())) continue;

    bevindingen.push(
      bevinding(
        "randvoorwaarde_geraakt",
        "fout",
        con.id,
        `harde randvoorwaarde geraakt zonder "Constraint-ack: ${con.id}" (${aanleiding}). ` +
          `Regel: ${con.regel} — los dit op of laat een mens de afweging vastleggen.`,
      ),
    );
  }

  // Een ack naar een niet-bestaande of niet-getriggerde randvoorwaarde wijst op
  // kopieerwerk; die moet opvallen, anders wordt "ack" een ritueel.
  const geldig = new Set(constraints.map((c) => c.id.toUpperCase()));
  for (const ack of ackSet) {
    if (!geldig.has(ack)) {
      bevindingen.push(
        bevinding("ack_onbekend", "waarschuwing", ack, `ack verwijst naar onbekende of vervallen randvoorwaarde`),
      );
    }
  }

  return bevindingen;
}

/** Alle controles samen. Volgorde is vast, zodat uitvoer vergelijkbaar blijft. */
export function lint(invoer: LintInvoer): LintResultaat {
  const { config, lading } = invoer;
  const bevindingen: LintBevinding[] = [];

  for (const fout of lading.laadFouten) {
    bevindingen.push(bevinding("laadfout", "fout", fout.bestand, formatteerLaadFout(fout)));
  }
  for (const issue of lading.validatie.issues) {
    bevindingen.push(
      bevinding(
        issue.severity === "fout" ? "kennis_ongeldig" : "kennis_signaal",
        issue.severity,
        issue.recordId ?? "(set)",
        formatteerBevinding(issue, lading.herkomst),
      ),
    );
  }

  bevindingen.push(
    ...toetsRandvoorwaarden(lading.records, invoer.gewijzigdeBestanden, invoer.tekstCorpus, invoer.acks),
  );

  // Statusdrift. Alleen relevant wanneer de wijziging status-dragende paden
  // raakt: een testrefactor of een UI-tekst hoort geen documentatieplicht te
  // veroorzaken, anders wordt de verklaring een betekenisloos ritueel.
  const raaktStatus = invoer.gewijzigdeBestanden.some((p) =>
    config.status_paden.some((s) => normaliseerPad(p).startsWith(normaliseerPad(s))),
  );
  const statusBijgewerkt = invoer.gewijzigdeBestanden.some(
    (p) => normaliseerPad(p) === normaliseerPad(config.current_state),
  );
  if (raaktStatus && !statusBijgewerkt && !invoer.statusImpactVerklaard) {
    bevindingen.push(
      bevinding(
        "status_impact_ontbreekt",
        "fout",
        config.current_state,
        `deze wijziging raakt status-dragende paden; werk ${config.current_state} bij of ` +
          `verklaar "Current-State-Impact: none" met een motivatie`,
      ),
    );
  }

  const drempel = 10;
  if ((invoer.statusCommitsSinds ?? 0) > drempel) {
    bevindingen.push(
      bevinding(
        "status_verouderd",
        "waarschuwing",
        config.current_state,
        `${invoer.statusCommitsSinds} status-dragende commits sinds de laatste wijziging van ${config.current_state}`,
      ),
    );
  }

  const workflows = invoer.gewijzigdeBestanden
    .map(normaliseerPad)
    .filter((p) => p.startsWith(".github/workflows/"));
  if (workflows.length > 0) {
    bevindingen.push(
      bevinding(
        "workflow_gewijzigd",
        "waarschuwing",
        workflows.join(", "),
        `wijziging in workflows raakt de beveiligingsgrens rond productiesecrets; ` +
          `vereist review door de code-eigenaar`,
      ),
    );
  }

  const decs = invoer.nieuweDecs ?? 0;
  if (decs > config.limieten.nieuwe_dec_per_taak) {
    bevindingen.push(
      bevinding(
        "dec_quotum",
        "waarschuwing",
        "knowledge/DECISIONS",
        `${decs} nieuwe besluiten in één taak (drempel ${config.limieten.nieuwe_dec_per_taak}) — ` +
          `meestal een teken van te fijnmazig registreren`,
      ),
    );
  }

  return { ok: !bevindingen.some((b) => b.severity === "fout"), bevindingen };
}

/** Eén regel per bevinding, geschikt voor CI-uitvoer. */
export function formatteerLint(resultaat: LintResultaat): string {
  if (resultaat.bevindingen.length === 0) return "jarvis lint: geen bevindingen.";
  const regels = resultaat.bevindingen.map(
    (b) => `${b.severity === "fout" ? "FOUT " : "WAARSCHUWING "} [${b.code}] ${b.onderwerp}: ${b.boodschap}`,
  );
  const fouten = resultaat.bevindingen.filter((b) => b.severity === "fout").length;
  const waarschuwingen = resultaat.bevindingen.length - fouten;
  regels.push("", `${fouten} fout(en), ${waarschuwingen} waarschuwing(en).`);
  return regels.join("\n");
}
