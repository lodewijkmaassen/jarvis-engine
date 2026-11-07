// Het bewijs voor één acceptatietest ophalen: wat er werkelijk is gemeten.
//
// Apart van het uitvoeren en beoordelen (doel-acceptatie.ts), omdat dit de
// enige plek is die productie en de administratie aanraakt — en omdat hier de
// regel staat die het belangrijkst is: niet kunnen meten is geen mislukte test
// maar een ontbrekende bevoegdheid. Die twee verwarren zet een doel vast op
// iets wat niemand hoeft te beslissen.
//
// Wat hier niet gebeurt: SQL uit een opdrachttekst uitvoeren. Een test die over
// de database gaat, krijgt vast omschreven, read-only bewijs.

import type { AcceptatieTest } from "./acceptatie";
import { ACCEPTATIE_SLEUTEL_SQL, DOEL_ACTIVITEIT_SQL, MIGRATIE_LEDGER_SQL, SCHEMA_FEITEN_SQL } from "./db";
import type { Doel } from "./doelen";
import type { DbClient } from "./opdrachten";

/** Het adres van de acceptatiedeur van de AI Core staat als instelling in de database. */
const INSTELLING_SQL = "select waarde from jarvis.instellingen where sleutel = $1";

/** Het bewijs voor één test: wat er werkelijk is gemeten. Geen samenvatting en geen conclusie — die velt de beoordelaar. */
export async function bewijsVoorTest(
  sql: DbClient,
  d: Doel,
  test: AcceptatieTest,
  onderwerp: string | null,
): Promise<{ readonly bewijs: string; readonly onuitvoerbaar: string | null }> {
  if (test.soort === "http" && test.url !== null) {
    try {
      const a = await fetch(test.url, {
        redirect: "follow",
        headers: {
          "User-Agent": "jarvis-acceptatie",
          "Cache-Control": "no-cache",
        },
      });
      const tekst = await a.text();
      return {
        bewijs: `GET ${test.url} → HTTP ${a.status}\n\n${tekst.slice(0, 6000)}`,
        onuitvoerbaar: null,
      };
    } catch (fout) {
      return {
        bewijs: `GET ${test.url} mislukte: ${fout instanceof Error ? fout.message : String(fout)}`,
        onuitvoerbaar: null,
      };
    }
  }
  if (test.soort === "aivraag") {
    const sleutelRij = await sql
      .unsafe(ACCEPTATIE_SLEUTEL_SQL)
      .catch(() => [] as Record<string, unknown>[]);
    const sleutel = String(sleutelRij[0]?.["sleutel"] ?? "").trim();
    const urlRij = await sql
      .unsafe(INSTELLING_SQL, ["ai_core_url"])
      .catch(() => [] as Record<string, unknown>[]);
    const url = String(urlRij[0]?.["waarde"] ?? "").trim();
    if (!sleutel || !url) {
      return {
        bewijs: "",
        onuitvoerbaar:
          "de AI Core is vanuit de eindcontrole niet te bevragen: de acceptatiedeur ontbreekt (instelling ai_core_url en de sleutel acceptatie_sleutel). " +
          "Dat is een ontbrekende bevoegdheid, geen besluit.",
      };
    }
    const vraag =
      (onderwerp !== null && test.vraag !== null
        ? `${test.vraag} (het gaat om ${onderwerp})`
        : test.vraag) ?? "";
    try {
      const a = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sleutel}`,
          "Content-Type": "application/json",
          "User-Agent": "jarvis-acceptatie",
        },
        // Dezelfde vorm die de app gebruikt: een gesprek met één bericht van de eigenaar.
        body: JSON.stringify({ gesprek: [{ rol: "jij", tekst: vraag }], alleen_lezen: true }),
      });
      const tekst = await a.text();
      return {
        bewijs: `POST ${url}\nvraag: ${vraag}\n\nHTTP ${a.status}\n${tekst.slice(0, 8000)}`,
        onuitvoerbaar: null,
      };
    } catch (fout) {
      return {
        bewijs: `de AI Core antwoordde niet: ${fout instanceof Error ? fout.message : String(fout)}`,
        onuitvoerbaar: null,
      };
    }
  }
  // sql en bewijs: wat de administratie zelf vastlegt. Read-only en vast omschreven.
  let ledger: Record<string, unknown>[] = [];
  let activiteit: Record<string, unknown>[] = [];
  let feiten: Record<string, unknown>[] = [];
  try {
    ledger = (await sql.unsafe(MIGRATIE_LEDGER_SQL, [
      d.id,
    ])) as unknown as Record<string, unknown>[];
    activiteit = (await sql.unsafe(DOEL_ACTIVITEIT_SQL, [
      onderwerp ?? d.id,
    ])) as unknown as Record<string, unknown>[];
    // Altijd meegeleverd, niet alleen bij een test die als `sql` is herkend. Gemeten op 2026-11-07 in
    // de end-tot-endproef: test A vroeg om het bestaan van een view én om het migratieledger, werd als
    // soort `bewijs` herkend, en de beoordeelaar zag daardoor het ledger wél en de view niet. Terecht
    // niet-geslaagd, maar om de verkeerde reden. De feiten zijn een korte read-only lijst namen; die
    // hoort bij elk bewijs, zodat geen test faalt op wat er niet in het bewijs stond.
    feiten = (await sql.unsafe(SCHEMA_FEITEN_SQL)) as unknown as Record<
      string,
      unknown
    >[];
  } catch (fout) {
    // Niet kunnen lezen is geen mislukte test: het is een ontbrekend leesrecht van de eindcontrole.
    return {
      bewijs: "",
      onuitvoerbaar: `het bewijs is niet te lezen: ${fout instanceof Error ? fout.message : String(fout)} — ontbrekende bevoegdheid, geen besluit`,
    };
  }
  const delen = [
    `doel ${d.id} (${d.titel}) staat op ${d.status}; uitkomst: ${d.uitkomst ?? "(geen)"}`,
    `pull request: ${d.pr?.repo ?? "-"}#${d.pr?.nummer ?? "-"} kop ${String(d.pr?.kop ?? "-").slice(0, 7)} merge ${String(d.pr?.merge_sha ?? "-").slice(0, 7)}`,
    `migratieledger van dit doel:\n${ledger.length === 0 ? "(geen regels)" : JSON.stringify(ledger).slice(0, 4000)}`,
    `activiteit van ${onderwerp ?? d.id}:\n${activiteit.length === 0 ? "(geen regels)" : JSON.stringify(activiteit).slice(0, 8000)}`,
  ];
  if (feiten.length > 0)
    delen.push(
      `wat er in het schema jarvis staat:\n${JSON.stringify(feiten).slice(0, 6000)}`,
    );
  return { bewijs: delen.join("\n\n"), onuitvoerbaar: null };
}
