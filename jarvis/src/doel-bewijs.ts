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
import { ACCEPTATIE_SLEUTEL_SQL, DB_MIGRATIES_SQL, DOELEN_LEDGER_SQL, DOEL_BEWIJS_ACTIVITEIT_SQL, LANE_ACCEPTATIE_SQL, LANE_OVERGANGEN_SQL, MIGRATIE_LEDGER_ALLES_SQL, MIGRATIE_LEDGER_SQL, PR_ACTIVITEIT_SQL, PR_TOETSINGEN_SQL, SCHEMA_FEITEN_SQL } from "./db";
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
  let ledgerAlles: Record<string, unknown>[] = [];
  let activiteit: Record<string, unknown>[] = [];
  let feiten: Record<string, unknown>[] = [];
  let toetsingen: Record<string, unknown>[] = [];
  let prActiviteit: Record<string, unknown>[] = [];
  let doelen: Record<string, unknown>[] = [];
  let overgangen: Record<string, unknown>[] = [];
  let laneAcceptatie: Record<string, unknown>[] = [];
  // Een onderwerp als "#106" is een pull request en geen dossier: activiteit
  // hangt aan een dossier en levert dan altijd "(geen regels)". De historie van
  // een pull request staat in de toetsingen.
  const prNummer = /^#([0-9]{1,5})$/.exec(onderwerp ?? "")?.[1] ?? null;
  const taak = prNummer === null ? (onderwerp ?? d.id) : d.id;
  try {
    ledger = (await sql.unsafe(MIGRATIE_LEDGER_SQL, [
      d.id,
    ])) as unknown as Record<string, unknown>[];
    // Ook het hele ledger: een acceptatietest vraagt vaak naar SQL die onder een ánder doel is toegepast.
    ledgerAlles = (await sql.unsafe(MIGRATIE_LEDGER_ALLES_SQL)) as unknown as Record<string, unknown>[];
    activiteit = (await sql.unsafe(DOEL_BEWIJS_ACTIVITEIT_SQL, [
      taak,
    ])) as unknown as Record<string, unknown>[];
    if (prNummer !== null) {
      toetsingen = (await sql.unsafe(PR_TOETSINGEN_SQL, [
        Number(prNummer),
      ])) as unknown as Record<string, unknown>[];
      // En wat er in de activiteit aan dat nummer hangt: openen, samenvoegen, en de
      // regels die een doel over deze pull request heeft teruggeschreven.
      prActiviteit = (await sql.unsafe(PR_ACTIVITEIT_SQL, [
        `%#${prNummer}`,
      ])) as unknown as Record<string, unknown>[];
    }
    // Een test vraagt vaak naar wat er met een ÁNDER doel is gebeurd ("bewijs met
    // een gecontroleerde test dat ..."). Dat staat in het doelenregister.
    doelen = (await sql.unsafe(DOELEN_LEDGER_SQL)) as unknown as Record<string, unknown>[];
    // Hoe een doel liep, niet alleen hoe het afliep: een test kan naar de overgang vragen.
    overgangen = (await sql.unsafe(LANE_OVERGANGEN_SQL)) as unknown as Record<string, unknown>[];
    // En wat de eindcontrole bij ANDERE doelen heeft gemeten: een test kan naar een gecontroleerde
    // proef op een ander doel vragen. De metingen van dit doel zelf blijven eruit.
    laneAcceptatie = (await sql.unsafe(LANE_ACCEPTATIE_SQL, [d.id])) as unknown as Record<string, unknown>[];
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
  // Apart, en met opzet buiten de lus hierboven: de migratietabel van de database is een leesrecht dat
  // een keten kan missen. Mist zij het, dan is dat geen onmeetbare test maar een blok minder bewijs.
  let dbMigraties: Record<string, unknown>[] = [];
  try {
    dbMigraties = (await sql.unsafe(DB_MIGRATIES_SQL)) as unknown as Record<string, unknown>[];
  } catch {
    dbMigraties = [];
  }
  // De uitkomst van dit doel is het OORDEEL van de vorige meting, niet wat er is gebouwd. Stond zij in
  // het bewijs, dan las de beoordelaar haar eigen vorige oordeel terug en herhaalde het: "de eindcontrole
  // zegt zelf dat nergens wordt aangetoond dat ...". Eén keer zakken hield zichzelf zo in stand. Gemeten
  // op 2026-11-07 aan D-20261021-161119608 (RSK-0043); dezelfde beoordelaar sloeg om naar geslaagd zodra
  // zij haar eigen oordeel niet meer terugzag. Dit is dezelfde regel als die de activiteit al filtert.
  const DOEL_ZELF = "(de lopende meting van dit doel zelf; geen bewijs)";
  // De historie van het onderwerp hoort VOORAAN, voor de algemene lijsten. Het bewijs wordt als geheel
  // afgekapt; stond het onderwerp achteraan, dan viel juist dat weg zodra de algemene lijsten groeiden.
  // Gemeten op 2026-11-07 om 20:06 UTC: de beoordelaar meldde voor eis (c) van acceptatietest A een
  // "afgekapt overzicht van de historie van #106", terwijl die historie zeven regels en 463 tekens is.
  const historieVanHetOnderwerp: string[] = [];
  if (prNummer !== null) {
    // Eén chronologische lijst uit beide tabellen, een gebeurtenis per regel. De historie van een pull
    // request staat verdeeld over de oordelen (jarvis.toetsingen) en de regels eromheen
    // (jarvis.activiteit); los van elkaar en als JSON op één rij las de beoordelaar er regels in over het
    // hoofd en noemde ze afwezig terwijl ze er stonden (gemeten op 2026-11-07, acceptatietest A).
    const historie = [
      ...toetsingen.map((r) => ({
        op: String(r["op"] ?? ""),
        regel: `jarvis.toetsingen | ${String(r["pr_repo"] ?? "")}#${String(r["pr_nummer"] ?? "")} | review ${String(r["oordeel"] ?? "")} door ${String(r["door"] ?? "")} op commit ${String(r["commit_sha"] ?? "").slice(0, 7)}`,
      })),
      ...prActiviteit.map((r) => ({
        op: String(r["op"] ?? ""),
        regel: `jarvis.activiteit | doel ${String(r["taak"] ?? "-")} | ${String(r["soort"] ?? "")} | ${String(r["tekst"] ?? "")}`,
      })),
    ].sort((a, b) => a.op.localeCompare(b.op));
    historieVanHetOnderwerp.push(
      [
        `historie van ${onderwerp} zoals de database haar bewaart (uit jarvis.toetsingen en jarvis.activiteit samen, een gebeurtenis per regel, oudste eerst):`,
        historie.length === 0 ? "(geen regels)" : historie.map((r) => `${r.op} | ${r.regel}`).join("\n").slice(0, 7000),
      ].join("\n"),
    );
  }
  const delen = [
    // Hoe dit bewijs tot stand kwam. Het is geen samenvatting en geen opslag van eerder werk: elk blok
    // hieronder is zojuist read-only uit de productiedatabase gelezen. Dat staat erbij omdat een
    // acceptatietest kan vragen of gegevens "beschikbaar en raadpleegbaar" zijn - en het antwoord daarop
    // is dat zij zojuist zijn opgevraagd (gemeten op 2026-11-07, acceptatietest A van dit doel).
    "herkomst: elk blok hieronder is zojuist read-only uit de productiedatabase opgevraagd met een query op de genoemde tabel; wat hier staat, is dus op dit moment in de database aanwezig en raadpleegbaar.",
    `doel ${d.id} (${d.titel}) staat op ${d.status}`,
    `pull request: ${d.pr?.repo ?? "-"}#${d.pr?.nummer ?? "-"} kop ${String(d.pr?.kop ?? "-").slice(0, 7)} merge ${String(d.pr?.merge_sha ?? "-").slice(0, 7)}`,
    ...historieVanHetOnderwerp,
    ...(feiten.length === 0 ? [] : [`wat er in het schema jarvis staat:\n${JSON.stringify(feiten).slice(0, 6000)}`]),
    `migratieledger van dit doel (tabel jarvis.migraties; alleen migraties die ONDER doel-id ${d.id} zijn toegepast):\n${ledger.length === 0 ? "(geen regels; dat zegt niets over SQL die onder een ANDER doel-id is toegepast - zie het ledger van de lane hieronder)" : JSON.stringify(ledger).slice(0, 4000)}`,
    `migratieledger van de hele lane (tabel jarvis.migraties; alle doelen, nieuwste eerst, met het doel en de pull request waar elke migratie vandaan komt):\n${ledgerAlles.length === 0 ? "(geen regels)" : JSON.stringify(ledgerAlles).slice(0, 5000)}`,
    ...(dbMigraties.length === 0
      ? []
      : [
          `migraties die de database zelf als toegepast registreert (view jarvis.db_migraties; met het begin van de SQL, zodat te zien is welke objecten elke migratie aanbrengt):\n${JSON.stringify(dbMigraties).slice(0, 4000)}`,
        ]),
    `activiteit van ${taak} (tabel jarvis.activiteit):\n${activiteit.length === 0 ? "(geen regels)" : JSON.stringify(activiteit).slice(0, 5000)}`,
    `statusovergangen van alle doelen in de lane (tabel jarvis.activiteit, soort status; nieuwste eerst):
${overgangen.length === 0 ? "(geen regels)" : JSON.stringify(overgangen).slice(0, 4000)}`,
    `acceptatiemetingen van ANDERE doelen in de lane (tabel jarvis.activiteit, soort acceptatie; nieuwste eerst; de metingen van dit doel zelf staan er niet in):
${laneAcceptatie.length === 0 ? "(geen regels)" : JSON.stringify(laneAcceptatie).slice(0, 5000)}`,
    `doelen van de lane (tabel jarvis.doelen; nieuwste eerst, met titel, pull request en uitkomst):\n${doelen.length === 0 ? "(geen regels)" : JSON.stringify(doelen.map((r) => (r["id"] === d.id ? { ...r, uitkomst: DOEL_ZELF } : r))).slice(0, 8000)}`,
  ];
  return { bewijs: delen.join("\n\n"), onuitvoerbaar: null };
}
