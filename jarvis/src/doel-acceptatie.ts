// De functionele acceptatietest van een doel uitvoeren, kant van de
// eindcontrole: het bewijs ophalen en het oordeel vragen aan het tweede model.
//
// Het lezen van de tests, het bouwen van de vraag en het lezen van het oordeel
// staan in `acceptatie.ts` (puur, los te toetsen). Hier staat de I/O: HTTP naar
// productie, lezen uit de administratie, en de modelaanroep langs de bestaande
// voorziening in de database (`jarvis.vraag_review` / `jarvis.lees_review`).
// Bewust dezelfde weg als de review van een pull request: geen tweede
// modelvoorziening, geen tweede token, geen tweede CI.
//
// Wat hier niet gebeurt: SQL uit een opdrachttekst uitvoeren. Een test die over
// de database gaat, krijgt vast omschreven, read-only bewijs: het migratieledger
// van het doel, de activiteit, en wat er in het schema staat.

import {
  BEOORDELAAR_SYSTEEM,
  bouwBeoordelingsVraag,
  parseerBeoordeling,
  volatielBezwaar,
  type AcceptatieTest,
  type AcceptatieUitkomst,
} from "./acceptatie";
import { ACTIVITEIT_SQL, DOEL_ACTIVITEIT_SQL, LEES_REVIEW_SQL, VRAAG_REVIEW_SQL } from "./db";
import { bewijsVoorTest } from "./doel-bewijs";
import { REVIEW_MODEL, REVIEW_WACHT_MS, type Doel } from "./doelen";
import type { DbClient } from "./opdrachten";
import { antwoordTekst, bouwAanroep, leverancierFout } from "./review";

/** Het adres van de acceptatiedeur van de AI Core staat als instelling in de database. */
const INSTELLING_SQL =
  "select waarde from jarvis.instellingen where sleutel = $1";
/** Het doel dat als laatste vastliep of is hervat: waarop een onbepaalbare acceptatietest één keer wordt vastgezet. */
const LAATST_VAST_SQL =
  "select id from jarvis.doelen where vast_door is not null or heropend_op is not null order by coalesce(heropend_op, bijgewerkt) desc limit 1";
/** Hoe vaak een acceptatietest van dit doel al niet slaagde: daarna is herstellen geen herstellen meer. */
export const ACCEPTATIE_MISLUKT_SQL =
  "select count(*) as aantal from jarvis.activiteit where taak = $1 and soort = 'acceptatie' and tekst like '%: niet-geslaagd%'";
export const MAX_ACCEPTATIE_RONDES = 3;

/** Eén regel in de bestaande activiteitenlog; dat is waar de AI Core en de eigenaar kijken. */
export async function schrijfAcceptatie(
  sql: DbClient,
  doel: string,
  tekst: string,
): Promise<void> {
  try {
    await sql.unsafe(ACTIVITEIT_SQL, [
      "ci",
      "qa",
      doel,
      null,
      "acceptatie",
      tekst.slice(0, 500),
      null,
    ]);
  } catch (fout) {
    console.error(
      `jarvis acceptatie: activiteit niet geschreven: ${fout instanceof Error ? fout.message : String(fout)}`,
    );
  }
}

/** Eén vraag aan het tweede model via de bestaande voorziening in de database. */
async function vraagBeoordelaar(
  sql: DbClient,
  vraag: string,
): Promise<string | { readonly fout: string }> {
  const gevraagd = await sql.unsafe(VRAAG_REVIEW_SQL, [
    JSON.stringify(bouwAanroep(REVIEW_MODEL, vraag, BEOORDELAAR_SYSTEEM)),
  ]);
  const id = Number(gevraagd[0]?.["id"]);
  if (!Number.isInteger(id) || id <= 0)
    return { fout: "de database verstuurde het verzoek niet" };
  const start = Date.now();
  while (Date.now() - start < REVIEW_WACHT_MS) {
    await new Promise((klaar) => setTimeout(klaar, 5_000));
    const r = (await sql.unsafe(LEES_REVIEW_SQL, [id]))[0];
    if (
      !r ||
      (r["status_code"] === null &&
        r["error_msg"] === null &&
        r["timed_out"] !== true)
    )
      continue;
    if (r["timed_out"] === true || r["error_msg"])
      return {
        fout: `het verzoek mislukte (${r["timed_out"] === true ? "time-out" : String(r["error_msg"])})`,
      };
    let lading: unknown = null;
    try {
      lading = r["content"] == null ? null : JSON.parse(String(r["content"]));
    } catch {
      lading = null;
    }
    if (Number(r["status_code"]) !== 200) {
      return {
        fout: `de beoordelaar antwoordde HTTP ${String(r["status_code"])}${leverancierFout(lading) ? ` — ${leverancierFout(lading)}` : ""}`,
      };
    }
    const tekst = antwoordTekst(lading);
    return tekst === null ? { fout: "het antwoord bevat geen tekst" } : tekst;
  }
  return { fout: "geen antwoord binnen de wachttijd" };
}

/** Het onderwerp waarop een onbepaalbare test eerder is vastgezet, uit de activiteit van het doel. */
function vastgezetOnderwerp(
  activiteit: readonly { soort: string; tekst: string }[],
  testId: string,
): string | null {
  for (const a of activiteit) {
    if (a.soort !== "acceptatie") continue;
    const m = new RegExp(`vastgezet: ${testId}=([^\\s;]+)`).exec(a.tekst);
    if (m !== null) return m[1]!;
  }
  return null;
}

/**
 * Voert de acceptatietests van een doel uit en laat elk oordeel vellen door het
 * tweede model.
 *
 * Drie uitkomsten, niet twee: een test die niet kón worden uitgevoerd is
 * `niet-meetbaar` en geen `niet-geslaagd`. Beide houden het doel tegen — niet
 * gemeten is niet bewezen — maar alleen bij `niet-geslaagd` is er voor de
 * uitvoerder iets te herstellen; `niet-meetbaar` wijst naar een bevoegdheid die
 * ontbreekt.
 */
export async function voerAcceptatieUit(
  sql: DbClient,
  d: Doel,
  tests: readonly AcceptatieTest[],
): Promise<readonly AcceptatieUitkomst[]> {
  const activiteit = (await sql.unsafe(DOEL_ACTIVITEIT_SQL, [
    d.id,
  ])) as unknown as { soort: string; tekst: string }[];
  const uit: AcceptatieUitkomst[] = [];
  for (const test of tests) {
    let onderwerp = test.onderwerp ?? vastgezetOnderwerp(activiteit, test.id);
    if (test.volatiel && onderwerp === null) {
      // Een test die van het toeval afhangt, wordt één keer vastgezet op wat nu het onderwerp is;
      // daarna meet dezelfde test hetzelfde. De eigenaar hoeft daar niets voor te doen.
      const kandidaat = (await sql.unsafe(LAATST_VAST_SQL)) as unknown as {
        id: string;
      }[];
      onderwerp = kandidaat[0]?.id ?? null;
      if (onderwerp !== null) {
        await schrijfAcceptatie(
          sql,
          d.id,
          `vastgezet: ${test.id}=${onderwerp} (${volatielBezwaar(test)})`,
        );
        console.log(
          `jarvis acceptatie: ${d.id}: test ${test.id} vastgezet op ${onderwerp}`,
        );
      }
    }
    const { bewijs, onuitvoerbaar } = await bewijsVoorTest(
      sql,
      d,
      test,
      onderwerp,
    );
    if (onuitvoerbaar !== null) {
      uit.push({ id: test.id, staat: "niet-meetbaar", bewijs: "", reden: onuitvoerbaar });
      await schrijfAcceptatie(sql, d.id, `test ${test.id}: niet-meetbaar — ${onuitvoerbaar}`);
      console.log(`jarvis acceptatie: ${d.id}: test ${test.id} → niet-meetbaar (${onuitvoerbaar.slice(0, 120)})`);
      continue;
    }
    const antwoord = await vraagBeoordelaar(
      sql,
      bouwBeoordelingsVraag(test, bewijs),
    );
    if (typeof antwoord !== "string") {
      // De beoordelaar niet kunnen vragen is ook niet meten: er is niets mislukt om te herstellen.
      const reden = `de beoordeling kon niet worden gevraagd: ${antwoord.fout}`;
      uit.push({ id: test.id, staat: "niet-meetbaar", bewijs, reden });
      await schrijfAcceptatie(sql, d.id, `test ${test.id}: niet-meetbaar — ${reden}`);
      continue;
    }
    const oordeel = parseerBeoordeling(antwoord);
    const staat = oordeel.geslaagd ? "geslaagd" : "niet-geslaagd";
    uit.push({ id: test.id, staat, bewijs, reden: oordeel.reden });
    await schrijfAcceptatie(sql, d.id, `test ${test.id}: ${staat} — ${oordeel.reden}`);
    console.log(`jarvis acceptatie: ${d.id}: test ${test.id} → ${staat} (${oordeel.reden.slice(0, 120)})`);
  }
  return uit;
}
