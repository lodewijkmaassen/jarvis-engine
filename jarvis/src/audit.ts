// Audittrail: een afgeronde taak achteraf reconstrueren uit de repository.
//
// De eis is niet "we hebben logs" maar "we kunnen het naspelen". Concreet moet
// uit Git alleen — zonder toegang tot enige AI-provider — te herleiden zijn:
// welke opdracht er lag, welke context daaronder lag en of die inmiddels is
// gedrift, wie welke stap deed, wat er veranderde, wat de tests deden, wat QA
// oordeelde en wie het goedkeurde.
//
// Vandaar de driftcontrole: een dossier dat naar records verwijst die sindsdien
// zijn gewijzigd, is geen bewijs meer maar een momentopname. Dat verschil moet
// zichtbaar zijn.
import { contextManifestSchema, verifyManifest, type ReadSource, type VerificationResult } from "./manifest";
import type { KnowledgeRecord } from "./records";

/** Eén stap in het dossier, afgeleid uit de aanwezige bestanden. */
export type DossierStap = {
  readonly bestand: string;
  readonly rol: string;
  readonly aanwezig: boolean;
  readonly regels: number;
};

/** Vaste dossierbestanden. Ontbreken is een bevinding, geen crash. */
export const DOSSIER_BESTANDEN: readonly { readonly bestand: string; readonly rol: string }[] = [
  { bestand: "opdracht.md", rol: "opdrachtgever" },
  { bestand: "context-pack.md", rol: "knowledge-manager" },
  { bestand: "analysis.md", rol: "architect" },
  { bestand: "implementatie.md", rol: "developer" },
  { bestand: "qa-rapport.md", rol: "qa" },
  { bestand: "resultaat.md", rol: "orchestrator" },
];

export type CommitRegel = {
  readonly hash: string;
  readonly auteur: string;
  readonly datum: string;
  readonly onderwerp: string;
  readonly taak: string | null;
  readonly rol: string | null;
};

export type AuditInvoer = {
  readonly taakId: string;
  /** Inhoud per dossierbestand; ontbrekende bestanden weglaten. */
  readonly dossier: ReadonlyMap<string, string>;
  /** Ruwe inhoud van context-pack.json, indien aanwezig. */
  readonly manifestJson: string | null;
  readonly commits: readonly CommitRegel[];
  readonly diffStat: string | null;
  readonly records: readonly KnowledgeRecord[];
  readonly readSource: ReadSource;
};

export type AuditBevinding = {
  readonly severity: "fout" | "waarschuwing" | "info";
  readonly boodschap: string;
};

export type AuditRapport = {
  readonly taakId: string;
  readonly volledig: boolean;
  readonly stappen: readonly DossierStap[];
  readonly commits: readonly CommitRegel[];
  readonly diffStat: string | null;
  readonly manifestVerificatie: VerificationResult | null;
  readonly bevindingen: readonly AuditBevinding[];
};

/** Leest de Jarvis-trailers uit een commitbericht. */
export function leesTrailers(bericht: string): { readonly taak: string | null; readonly rol: string | null } {
  const taak = /^Jarvis-Task:\s*(\S+)\s*$/im.exec(bericht);
  const rol = /^Jarvis-Role:\s*(\S+)\s*$/im.exec(bericht);
  return { taak: taak?.[1] ?? null, rol: rol?.[1] ?? null };
}

/**
 * Stelt het auditrapport samen.
 *
 * `volledig` betekent: elk verplicht dossierbestand is aanwezig, het manifest
 * is leesbaar én er is geen drift. Alles daaronder levert bevindingen op in
 * plaats van een uitzondering — een onvolledig dossier moet je kunnen LEZEN,
 * juist omdat je dan wilt weten wat er mist.
 */
export async function bouwAuditRapport(invoer: AuditInvoer): Promise<AuditRapport> {
  const bevindingen: AuditBevinding[] = [];

  const stappen: DossierStap[] = DOSSIER_BESTANDEN.map(({ bestand, rol }) => {
    const inhoud = invoer.dossier.get(bestand);
    return {
      bestand,
      rol,
      aanwezig: inhoud !== undefined,
      regels: inhoud ? inhoud.split("\n").length : 0,
    };
  });

  for (const stap of stappen) {
    if (!stap.aanwezig) {
      bevindingen.push({
        severity: stap.bestand === "qa-rapport.md" ? "fout" : "waarschuwing",
        boodschap: `dossierbestand ${stap.bestand} (${stap.rol}) ontbreekt`,
      });
    }
  }

  let manifestVerificatie: VerificationResult | null = null;
  if (invoer.manifestJson === null) {
    bevindingen.push({
      severity: "fout",
      boodschap: "context-pack.json ontbreekt: niet vast te stellen welke context onder deze taak lag",
    });
  } else {
    let geparsed: unknown;
    try {
      geparsed = JSON.parse(invoer.manifestJson);
    } catch {
      geparsed = null;
      bevindingen.push({ severity: "fout", boodschap: "context-pack.json is geen geldige JSON" });
    }
    if (geparsed !== null) {
      // Het pakket bevat het manifest als deelobject; een kaal manifest mag ook.
      const kandidaat = (geparsed as { manifest?: unknown }).manifest ?? geparsed;
      const uitkomst = contextManifestSchema.safeParse(kandidaat);
      if (!uitkomst.success) {
        bevindingen.push({
          severity: "fout",
          boodschap: `manifest voldoet niet aan het schema: ${uitkomst.error.issues[0]?.message ?? "onbekend"}`,
        });
      } else {
        manifestVerificatie = await verifyManifest(uitkomst.data, {
          records: invoer.records,
          readSource: invoer.readSource,
        });
        for (const drift of manifestVerificatie.bevindingen) {
          bevindingen.push({
            severity: drift.severity === "drift" ? "waarschuwing" : "info",
            boodschap: `${drift.code} op ${drift.onderwerp}: ${drift.boodschap}`,
          });
        }
      }
    }
  }

  if (invoer.commits.length === 0) {
    bevindingen.push({ severity: "waarschuwing", boodschap: "geen commits gevonden voor deze taak" });
  }
  const zonderTrailer = invoer.commits.filter((c) => c.taak === null);
  if (zonderTrailer.length > 0) {
    bevindingen.push({
      severity: "waarschuwing",
      boodschap: `${zonderTrailer.length} commit(s) zonder Jarvis-Task-trailer: rol niet herleidbaar`,
    });
  }

  const volledig =
    stappen.every((s) => s.aanwezig) &&
    manifestVerificatie !== null &&
    manifestVerificatie.ok &&
    invoer.commits.length > 0;

  return {
    taakId: invoer.taakId,
    volledig,
    stappen,
    commits: invoer.commits,
    diffStat: invoer.diffStat,
    manifestVerificatie,
    bevindingen,
  };
}

/** Het rapport als leesbaar markdowndocument. */
export function rendereerAudit(rapport: AuditRapport): string {
  const uit: string[] = [
    `# Audit — ${rapport.taakId}`,
    "",
    `**Reconstructie volledig:** ${rapport.volledig ? "ja" : "nee"}`,
    "",
    "## Dossier",
    "",
    "| Bestand | Rol | Aanwezig | Regels |",
    "|---|---|---|---:|",
  ];
  for (const stap of rapport.stappen) {
    uit.push(`| ${stap.bestand} | ${stap.rol} | ${stap.aanwezig ? "ja" : "**nee**"} | ${stap.regels} |`);
  }

  uit.push("", "## Gebruikte context", "");
  if (rapport.manifestVerificatie === null) {
    uit.push("Geen leesbaar manifest — de gebruikte context is niet vast te stellen.", "");
  } else {
    const v = rapport.manifestVerificatie;
    uit.push(
      `Manifest geverifieerd tegen de huidige repository: **${v.ok ? "geen drift" : "drift gevonden"}**`,
      `(${v.ongewijzigd} onderdelen ongewijzigd, ${v.bevindingen.length} bevinding(en)).`,
      "",
    );
  }

  uit.push("## Commits", "", "| Commit | Rol | Datum | Onderwerp |", "|---|---|---|---|");
  if (rapport.commits.length === 0) {
    uit.push("| — | — | — | geen commits gevonden |");
  } else {
    for (const c of rapport.commits) {
      uit.push(`| \`${c.hash}\` | ${c.rol ?? "—"} | ${c.datum} | ${c.onderwerp} |`);
    }
  }

  if (rapport.diffStat) {
    uit.push("", "## Codewijziging", "", "```", rapport.diffStat.trim(), "```");
  }

  uit.push("", "## Bevindingen", "");
  if (rapport.bevindingen.length === 0) {
    uit.push("Geen. Het dossier is compleet en de context is onveranderd.");
  } else {
    for (const b of rapport.bevindingen) {
      const merk = b.severity === "fout" ? "**FOUT**" : b.severity === "waarschuwing" ? "WAARSCHUWING" : "info";
      uit.push(`- ${merk} — ${b.boodschap}`);
    }
  }
  uit.push("");
  return uit.join("\n");
}
