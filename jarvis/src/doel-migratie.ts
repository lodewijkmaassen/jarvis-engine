// De eigen migratielane, kant van de eindcontrole: de SQL van een samengevoegd
// doel toepassen, en zeggen wat er open blijft.
//
// Hier staat geen grens: die staat in de database (`jarvis.pas_migratie_toe`,
// alleen uitvoerbaar door `jarvis_ci`) en in `eigen-migratie.ts`, dat dezelfde
// grens spiegelt om een bezwaar leesbaar te melden. Dit bestand doet de I/O:
// de bestanden van de pull request lezen op de samenvoegcommit, het ledger
// raadplegen, en de deur aanroepen.
//
// Waarom in de eindcontrole en niet bij de uitvoerder: de uitvoerder levert SQL
// op, hij past hem niet toe. De eindcontrole is de enige identiteit die een doel
// klaar mag verklaren, en dus de enige plek waar het hoort te blijken dat er nog
// iets te doen was.

import { EIGEN_MIGRATIE_SQL, MIGRATIE_LEDGER_SQL } from "./db";
import type { Doel } from "./doelen";
import {
  beoordeelEigenSql,
  bezwaarIsBevoegdheid,
  doelVanMigratie,
  hashSql,
  migratieNaam,
} from "./eigen-migratie";
import { github, leesAllePaginas, type DbClient } from "./opdrachten";

/** Eén migratie uit een doeldossier, met zijn inhoud op de samenvoegcommit. */
export type DoelMigratie = {
  readonly pad: string;
  readonly bestand: string;
  readonly sql: string;
};

/** Wat er na een ronde toepassen open blijft staan, en of dat met de rechten van de eigenaar moet. */
export type OpenMigratie = {
  readonly naam: string;
  readonly reden: string;
  readonly bevoegdheid: boolean;
};

/** Hoe de bestanden worden gelezen. Apart, zodat een test de route zonder netwerk kan toetsen (zoals `Ophaler` in uitrol.ts). */
export type MigratieLezer = (
  token: string,
  slug: string,
  nummer: number,
  ref: string,
  doel: string,
) => Promise<readonly DoelMigratie[] | string>;

/** De doel-SQL uit de samengevoegde pull request, gelezen op de samenvoegcommit zelf. */
const doelMigratieBestanden: MigratieLezer =
  async function doelMigratieBestanden(
    token: string,
    slug: string,
    nummer: number,
    ref: string,
    doel: string,
  ): Promise<readonly DoelMigratie[] | string> {
    const bestanden = await leesAllePaginas<{
      filename: string;
      status: string;
    }>(token, `/repos/${slug}/pulls/${nummer}/files`, 5);
    if (typeof bestanden === "string") return bestanden;
    const uit: DoelMigratie[] = [];
    for (const b of bestanden) {
      const hoort = doelVanMigratie(b.filename);
      if (hoort === null || hoort.doel !== doel || b.status === "removed")
        continue;
      const inhoud = await github(
        token,
        "GET",
        `/repos/${slug}/contents/${b.filename.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`,
      );
      const l = inhoud.lading as { content?: string; encoding?: string } | null;
      if (
        inhoud.status !== 200 ||
        l?.encoding !== "base64" ||
        typeof l.content !== "string"
      )
        return `${b.filename} is niet te lezen op ${ref.slice(0, 7)}`;
      uit.push({
        pad: b.filename,
        bestand: hoort.bestand,
        sql: Buffer.from(l.content, "base64").toString("utf8"),
      });
    }
    return uit.sort((a, b) => a.pad.localeCompare(b.pad));
  };

/**
 * Past de SQL van een samengevoegd doel toe, één voor één, en zegt wat er open
 * blijft. Idempotent: het ledger in de database beslist of iets al is gedaan,
 * dus elke ronde mag opnieuw proberen.
 *
 * Wat hier open blijft, houdt het doel tegen. Dat is het hele punt: code die op
 * een migratie leunt mag niet klaar heten terwijl die migratie er niet is.
 */
export async function pasDoelMigratiesToe(
  sql: DbClient,
  token: string,
  d: Doel,
  lees: MigratieLezer = doelMigratieBestanden,
): Promise<{
  readonly gedaan: readonly string[];
  readonly open: readonly OpenMigratie[];
}> {
  const pr = d.pr;
  if (!pr?.repo || !pr.nummer || !pr.merge_sha) return { gedaan: [], open: [] };
  const bestanden = await lees(token, pr.repo, pr.nummer, pr.merge_sha, d.id);
  if (typeof bestanden === "string")
    return {
      gedaan: [],
      open: [{ naam: "(lezen)", reden: bestanden, bevoegdheid: false }],
    };
  if (bestanden.length === 0) return { gedaan: [], open: [] };

  // Is de lane zelf er nog niet, dan is dat een ontbrekende bevoegdheid van dit ene doel — en geen
  // reden om elk ander doel tegen te houden. Daarom hier gevangen en niet bij de aanroeper.
  let ledger: { naam: string; hash: string; uitkomst: string }[];
  try {
    ledger = (await sql.unsafe(MIGRATIE_LEDGER_SQL, [d.id])) as unknown as {
      naam: string;
      hash: string;
      uitkomst: string;
    }[];
  } catch (fout) {
    const tekst = fout instanceof Error ? fout.message : String(fout);
    return {
      gedaan: [],
      open: [
        {
          naam: bestanden.map((b) => b.bestand).join(", "),
          reden: `de eigen migratielane is niet ingericht (${tekst.slice(0, 200)}); zonder ledger wordt er niets toegepast`,
          bevoegdheid: true,
        },
      ],
    };
  }

  const gedaan: string[] = [];
  const open: OpenMigratie[] = [];
  for (const b of bestanden) {
    const naam = migratieNaam(d.id, b.bestand);
    const al = ledger.find(
      (r) => r.naam === naam && r.uitkomst === "toegepast",
    );
    if (al !== undefined) {
      if (al.hash !== hashSql(b.sql)) {
        open.push({
          naam,
          reden:
            "staat als toegepast in het ledger met andere inhoud; een toegepaste migratie wijzigt niet meer",
          bevoegdheid: true,
        });
        continue;
      }
      gedaan.push(naam);
      continue;
    }
    const bezwaren = beoordeelEigenSql(b.sql);
    if (bezwaren.length > 0) {
      open.push({
        naam,
        reden: bezwaren.join("; "),
        bevoegdheid: bezwaarIsBevoegdheid(bezwaren),
      });
      continue;
    }
    try {
      const r = await sql.unsafe(EIGEN_MIGRATIE_SQL, [naam, b.sql, d.id]);
      const uitkomst = String(r[0]?.["uitkomst"] ?? "toegepast");
      gedaan.push(`${naam} (${uitkomst})`);
      console.log(`jarvis eindcontrole: ${d.id}: migratie ${naam} ${uitkomst}`);
    } catch (fout) {
      const tekst = fout instanceof Error ? fout.message : String(fout);
      // Een weigering van de database of een ontbrekend recht is een bevoegdheid; een echte fout in de
      // SQL (een tikfout, een kolom die niet bestaat) kan de uitvoerder zelf herstellen.
      open.push({
        naam,
        reden: tekst.slice(0, 500),
        bevoegdheid:
          /geweigerd|permission|niet toegestaan|does not exist|bestaat niet/i.test(
            tekst,
          ),
      });
    }
  }
  return { gedaan, open };
}
