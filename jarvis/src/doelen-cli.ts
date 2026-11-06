// Doelen — de I/O-kant (T-20261017-jarvis-vereenvoudigen). De regels staan in doelen.ts.
//
// Vier CI-taken, aangeroepen door de bestaande workflow `jarvis-v3` (sweep, dispatch, eindcontrole), zodat
// er geen workflow hoeft te veranderen:
//   reviewen        de reviewjob: een ander model leest elke open pull request van de bot (deze repository en
//                   de engine), het oordeel wordt een toetsing met door = ci-review — die alleen jarvis_ci kan
//                   schrijven. De attestatie voegt samen op een GO van ci-review.
//   vastleggen      samengevoegde pull requests met een regel "Doel: D-…" zetten dat doel op samengevoegd.
//   eindcontrole    meet de acceptatie-URL van elk samengevoegd doel (bouwmerk = de merge of later) → klaar.
//   dispatch        start de routine van de uitvoerder als er een doel zonder beweging staat.
// En één opdracht voor de uitvoerder: `jarvis doel lijst | zet <id> <status> [--pr <json>] [--uitkomst <t>]`.

import { REVIEWER_DOOR } from "./attestatie";
import { leesArgumenten } from "./args";
import { laadConfig, vindWortel } from "./config";
import {
  ACCEPTATIE_SLEUTEL_SQL,
  ACTIVITEIT_SQL,
  DOEL_ACTIVITEIT_SQL,
  DOEL_WERK_SQL,
  DOELEN_SQL,
  EIGEN_MIGRATIE_SQL,
  LEES_REVIEW_SQL,
  MIGRATIE_LEDGER_SQL,
  SCHEMA_FEITEN_SQL,
  TOETSING_SQL,
  VRAAG_REVIEW_SQL,
} from "./db";
import {
  BEOORDELAAR_SYSTEEM,
  bouwBeoordelingsVraag,
  eindoordeel,
  leesAcceptatieTests,
  parseerBeoordeling,
  volatielBezwaar,
  type AcceptatieTest,
  type AcceptatieUitkomst,
} from "./acceptatie";
import { classificeerBlokkade, rendereerBlokkade } from "./blokkade";
import { beoordeelEigenSql, bezwaarIsBevoegdheid, doelVanMigratie, hashSql, migratieNaam } from "./eigen-migratie";
import { checksGroen, dispatchNodig, doelUitPrTekst, reviewBesluit, type Doel, type ReviewOordeel } from "./doelen";
import { foutTekst, github, leesAllePaginas, leesPullRequest, verbindDb, type DbClient } from "./opdrachten";
import { laatstePerNaam, VERPLICHTE_CHECK } from "./pr";
import { antwoordTekst, bouwAanroep, bouwReviewVraag, leverancierFout, onvolledigGelezen, parseerReview, rendereerReview, type Review } from "./review";
import { beoordeelHttpMeting, leesBouwmerkUitPagina } from "./v3";

const OORDELEN_SQL =
  "select commit_sha as kop, oordeel, door, op::text as op from jarvis.toetsingen where lower(pr_repo) = lower($1) and pr_nummer = $2 order by op";
// Wanneer de eigenaar een doel heropende (Reageer en hervat): de NO-GO-teller telt vanaf dan. Bewust een eigen
// query van de reviewjob (directe databaseverbinding in CI), niet in DOELEN_SQL: die staat in de allowlist van de
// Edge Function waarmee de uitvoerder leest.
const HEROPEND_SQL = "select id, heropend_op::text as heropend_op from jarvis.doelen where heropend_op is not null";
const REVIEW_MODEL = "gpt-5.1";
const REVIEW_WACHT_MS = 240_000;
/** De instelling met het adres van de acceptatiedeur van de AI Core; CI leest hem, de uitvoerder niet. */
const INSTELLING_SQL = "select waarde from jarvis.instellingen where sleutel = $1";
/** Het doel dat als laatste vastliep of is hervat: waarop een onbepaalbare acceptatietest één keer wordt vastgezet. */
const LAATST_VAST_SQL =
  "select id from jarvis.doelen where vast_door is not null or heropend_op is not null order by coalesce(heropend_op, bijgewerkt) desc limit 1";
/** Hoe vaak een acceptatietest van dit doel al niet slaagde: daarna is herstellen geen herstellen meer. */
const ACCEPTATIE_MISLUKT_SQL =
  "select count(*) as aantal from jarvis.activiteit where taak = $1 and soort = 'acceptatie' and tekst like '%niet geslaagd%'";
const MAX_ACCEPTATIE_RONDES = 3;
/** Een uitrol krijgt een halfuur voordat er tegen productie wordt gemeten. */
const UITROL_WACHT_MINUTEN = 30;

async function met<T>(f: (sql: DbClient) => Promise<T>): Promise<T> {
  const v = await verbindDb();
  if (v === null) throw new Error("geen weg naar de database (JARVIS_DB_URL of de Edge Function)");
  try {
    return await f(v.sql);
  } finally {
    await v.sql.end({ timeout: 2 });
  }
}

async function leesDoelen(sql: DbClient): Promise<Doel[]> {
  return (await sql.unsafe(DOELEN_SQL)) as unknown as Doel[];
}

/** De repositories die de reviewjob leest: deze, en de engine als de configuratie die noemt. */
async function reviewRepos(): Promise<{ readonly eigen: string; readonly alle: readonly string[]; readonly bot: string }> {
  const eigen = (process.env.GITHUB_REPOSITORY ?? "").trim();
  const wortel = (await vindWortel(process.cwd())) ?? process.cwd();
  const config = await laadConfig(wortel);
  const bot = config.ok ? config.config.attestatie.bot : "";
  const engine = config.ok ? config.config.engine_repository : "";
  // In de engine-repository zelf (geen engine_repository) reviewt niemand: dat doet de consument, die de engine
  // ook leest. Twee sweeps op dezelfde kop gaven anders twee oordelen (QA ronde 1 op jarvis-engine#88).
  if (!engine) return { eigen, alle: [], bot };
  return { eigen, alle: [eigen, ...(engine !== eigen ? [engine] : [])].filter(Boolean), bot };
}

/** Het tweede model leest één pull request. Geeft het oordeel, of een foutmelding. */
async function tweedeLezing(sql: DbClient, token: string, slug: string, nummer: number, doel: Doel | null): Promise<{ review: Review; kop: string } | string> {
  const pr = await github(token, "GET", `/repos/${slug}/pulls/${nummer}`);
  if (pr.status !== 200) return `pull request niet te lezen (${foutTekst(pr)})`;
  const p = pr.lading as { title: string; body: string | null; head: { sha: string } };
  const bestanden = await leesAllePaginas<{ filename: string; status: string; patch?: string }>(token, `/repos/${slug}/pulls/${nummer}/files`, 5);
  if (typeof bestanden === "string") return bestanden;
  // Is de pull request tijdens het lezen verder gegaan, dan hoort deze diff niet bij de kop: volgende ronde.
  const opnieuw = await github(token, "GET", `/repos/${slug}/pulls/${nummer}`);
  if (opnieuw.status !== 200 || (opnieuw.lading as { head: { sha: string } }).head.sha !== p.head.sha) return "de kop veranderde tijdens het lezen";
  // Wat de reviewer niet volledig kan lezen, krijgt geen GO maar een vastgelegde NO-GO met de reden (B3).
  const onvolledig = onvolledigGelezen(bestanden.map((b) => ({ bestand: b.filename, patch: b.patch ?? null })));
  if (onvolledig.length > 0) {
    return {
      kop: p.head.sha,
      review: {
        oordeel: "correctie",
        samenvatting: "De reviewer kan deze wijziging niet volledig lezen; zonder volledige lezing geen GO.",
        punten: onvolledig.map((tekst) => ({ ernst: "hoog" as const, tekst: `${tekst}; splits de wijziging of maak haar kleiner`, bestand: null })),
        conclusie_eigenaar: "De wijziging is te groot om volledig na te lezen en gaat daarom nog niet door.",
      },
    };
  }
  const diff = bestanden.map((b) => ({ bestand: b.filename, status: b.status, patch: b.patch ?? "" }));
  const dossier = doel === null ? null : `Doel van de eigenaar: ${doel.titel}\n\n${doel.opdracht}\n\nAcceptatie: ${doel.acceptatie_url ?? "(geen URL)"}`;
  const vraag = bouwReviewVraag({ repo: slug, nummer, kop: p.head.sha, titel: p.title, beschrijving: p.body ?? "", diff, dossier, context: "" });
  const gevraagd = await sql.unsafe(VRAAG_REVIEW_SQL, [JSON.stringify(bouwAanroep(REVIEW_MODEL, vraag))]);
  const id = Number(gevraagd[0]?.["id"]);
  if (!Number.isInteger(id) || id <= 0) return "de database verstuurde het reviewverzoek niet";
  const start = Date.now();
  while (Date.now() - start < REVIEW_WACHT_MS) {
    await new Promise((klaar) => setTimeout(klaar, 5_000));
    const r = (await sql.unsafe(LEES_REVIEW_SQL, [id]))[0];
    if (!r || (r["status_code"] === null && r["error_msg"] === null && r["timed_out"] !== true)) continue;
    if (r["timed_out"] === true || r["error_msg"]) return `het reviewverzoek mislukte (${r["timed_out"] === true ? "time-out" : String(r["error_msg"])})`;
    let lading: unknown = null;
    try {
      lading = r["content"] == null ? null : JSON.parse(String(r["content"]));
    } catch {
      lading = null;
    }
    if (Number(r["status_code"]) !== 200) return `de reviewer antwoordde HTTP ${String(r["status_code"])}${leverancierFout(lading) ? ` — ${leverancierFout(lading)}` : ""}`;
    const tekst = antwoordTekst(lading);
    if (tekst === null) return "het antwoord van de reviewer bevat geen tekst";
    // Streng: alleen een uitgesproken akkoord is een GO, geen "correctie zonder hoog punt".
    const review = parseerReview(tekst, false);
    return typeof review === "string" ? `het oordeel is onleesbaar (${review})` : { review, kop: p.head.sha };
  }
  return "geen antwoord van de reviewer binnen de wachttijd";
}

/** De reviewjob. Een fout bij één pull request houdt de rest niet tegen. */
async function reviewen(sql: DbClient, token: string): Promise<number> {
  const { eigen, alle, bot } = await reviewRepos();
  if (!bot) {
    console.error("jarvis review-ci: jarvis.config.yml mist attestatie.bot.");
    return 1;
  }
  const doelen = await leesDoelen(sql);
  const heropend = new Map(((await sql.unsafe(HEROPEND_SQL)) as unknown as { id: string; heropend_op: string }[]).map((r) => [r.id, r.heropend_op]));
  let code = 0;
  for (const slug of alle) {
    const open = await leesAllePaginas<{ number: number; draft: boolean; user: { login: string }; head: { ref: string }; body: string | null }>(token, `/repos/${slug}/pulls?state=open`, 3);
    if (typeof open === "string") {
      console.error(`jarvis review-ci: ${slug}: ${open}`);
      code = 1;
      continue;
    }
    const mijn = open.filter((p) => !p.draft && p.user.login.toLowerCase() === bot.toLowerCase() && p.head.ref.startsWith("jarvis/"));
    console.log(`jarvis review-ci: ${slug}: ${mijn.length} open pull request(s) van de bot.`);
    for (const p of mijn) {
      try {
        const feiten = await leesPullRequest(token, slug, p.number);
        if (typeof feiten === "string") throw new Error(feiten);
        const oordelen = (await sql.unsafe(OORDELEN_SQL, [slug, p.number])) as unknown as ReviewOordeel[];
        const groen = checksGroen(laatstePerNaam(feiten.checks), VERPLICHTE_CHECK);
        const doelId = doelUitPrTekst(p.body ?? "");
        const doel = doelen.find((d) => d.id === doelId) ?? null;
        const besluit = reviewBesluit(feiten.kop, oordelen, groen, (doel && heropend.get(doel.id)) ?? null);
        if (besluit === "vast") {
          if (doel !== null && ["open", "bezig", "review"].includes(doel.status)) {
            await sql.unsafe("select jarvis.doel_ci($1, 'vast', null, $2)", [doel.id, `de reviewer gaf ${oordelen.length} keer NO-GO op ${slug}#${p.number}`]);
          }
          console.log(`jarvis review-ci: ${slug}#${p.number} → vast (te vaak NO-GO)`);
          continue;
        }
        if (besluit !== "review") {
          console.log(`jarvis review-ci: ${slug}#${p.number} → ${besluit === "wacht" ? "wacht op groene checks" : "kop al beoordeeld"}`);
          continue;
        }
        const uit = await tweedeLezing(sql, token, slug, p.number, doel);
        if (typeof uit === "string") throw new Error(uit);
        // De reviewer las de kop die hij kreeg; is de pull request intussen verder, dan geldt dit oordeel niet.
        if (uit.kop !== feiten.kop) {
          console.log(`jarvis review-ci: ${slug}#${p.number} → kop veranderd tijdens de review; volgende ronde`);
          continue;
        }
        // Een akkoord met een punt van ernst hoog is geen GO: dat punt hoort eerst hersteld.
        const oordeel = uit.review.oordeel === "akkoord" && !uit.review.punten.some((x) => x.ernst === "hoog") ? "GO" : "NO-GO";
        const rapport = rendereerReview(uit.review, { repo: slug, nummer: p.number, kop: uit.kop, model: REVIEW_MODEL });
        await sql.unsafe(TOETSING_SQL, [slug, p.number, uit.kop, oordeel, rapport, REVIEWER_DOOR]);
        // Commentaar alleen in de eigen repository: het GITHUB_TOKEN van deze run kan niet elders schrijven.
        if (slug === eigen) {
          await github(token, "POST", `/repos/${slug}/issues/${p.number}/comments`, { body: `**Review ${oordeel}** (${REVIEW_MODEL}, ${REVIEWER_DOOR}) op \`${uit.kop.slice(0, 7)}\`\n\n${rapport}` });
        }
        console.log(`jarvis review-ci: ${slug}#${p.number} op ${uit.kop.slice(0, 7)} → ${oordeel}`);
      } catch (fout) {
        console.error(`jarvis review-ci: ${slug}#${p.number}: ${fout instanceof Error ? fout.message : String(fout)}`);
        code = 1;
      }
    }
  }
  return code;
}

/** Samengevoegde pull requests van de bot met "Doel: D-…": het doel gaat naar samengevoegd. */
async function vastleggen(sql: DbClient, token: string): Promise<number> {
  const { alle, bot } = await reviewRepos();
  const doelen = await leesDoelen(sql);
  const lopend = doelen.filter((d) => d.status === "bezig" || d.status === "review");
  if (lopend.length === 0) return 0;
  let code = 0;
  for (const slug of alle) {
    // Alleen de recentst bijgewerkte gesloten pull requests: één expliciete pagina. Eerder via leesAllePaginas
    // met een plafond van één pagina; bij meer dan 100 gesloten PR's gaf dat een foutmelding terug die hier
    // stil werd overgeslagen, zodat geen enkel doel ooit op samengevoegd kwam (proef fase 3, #286, 2026-10-18).
    const antwoord = await github(token, "GET", `/repos/${slug}/pulls?state=closed&sort=updated&direction=desc&per_page=50`);
    if (antwoord.status !== 200 || !Array.isArray(antwoord.lading)) {
      console.error(`jarvis doel: gesloten pull requests van ${slug} niet te lezen (${foutTekst(antwoord)})`);
      code = 1;
      continue;
    }
    const gesloten = antwoord.lading as { number: number; merged_at: string | null; merge_commit_sha: string | null; body: string | null; user: { login: string }; head: { sha: string }; base: { ref: string } }[];
    for (const p of gesloten) {
      if (p.merged_at === null || p.merge_commit_sha === null || p.base.ref !== "main" || p.user.login.toLowerCase() !== bot.toLowerCase()) continue;
      const d = lopend.find((x) => x.id === doelUitPrTekst(p.body ?? ""));
      if (d === undefined) continue;
      // Alleen werk dat de reviewer op precies die kop goedkeurde, telt voor een doel. Een administratieve
      // pull request (zonder review samengevoegd) brengt een doel nergens (QA-bevinding B2 op jarvis-engine#88).
      // doel_ci in de database eist hetzelfde.
      const oordelen = (await sql.unsafe(OORDELEN_SQL, [slug, p.number])) as unknown as (ReviewOordeel & { op?: string })[];
      const opKop = oordelen.filter((o) => o.door === REVIEWER_DOOR && o.kop === p.head.sha);
      if (opKop.length === 0 || opKop[opKop.length - 1]!.oordeel !== "GO") {
        console.log(`jarvis doel: ${slug}#${p.number} noemt ${d.id} maar heeft geen GO van de reviewer op ${p.head.sha.slice(0, 7)}; niet vastgelegd`);
        continue;
      }
      const pr = { repo: slug, nummer: p.number, kop: p.head.sha, merge_sha: p.merge_commit_sha };
      await sql.unsafe("select jarvis.doel_ci($1, 'samengevoegd', $2::text::jsonb, null)", [d.id, JSON.stringify(pr)]);
      console.log(`jarvis doel: ${d.id} samengevoegd via ${slug}#${p.number} (${p.merge_commit_sha.slice(0, 7)})`);
    }
  }
  return code;
}

/** Staat `kandidaat` op of na `basis`? Via de compare-API; bij twijfel nee. */
async function isNazaat(token: string, slug: string, basis: string, kandidaat: string): Promise<boolean> {
  const a = await github(token, "GET", `/repos/${slug}/compare/${basis}...${kandidaat}`);
  const status = (a.lading as { status?: string } | null)?.status;
  return a.status === 200 && (status === "ahead" || status === "identical");
}

/**
 * De eindcontrole: voor elk samengevoegd doel eerst de database, dan de
 * uitrol, dan de acceptatietests — en pas als alles drie klopt: klaar.
 *
 * Een doel dat op een van de drie struikelt, gaat terug de bestaande
 * herstelketen in (bezig) of staat vast als er een bevoegdheid ontbreekt.
 * Elk doel staat op zichzelf: wat bij het ene doel misgaat, legt het andere
 * niet stil — daarom de try per doel en niet één om de lus.
 */
async function eindcontroleDoelen(sql: DbClient, token: string): Promise<number> {
  const doelen = (await leesDoelen(sql)).filter((d) => d.status === "samengevoegd");
  console.log(`jarvis eindcontrole: ${doelen.length} samengevoegd doel(en).`);
  let code = 0;
  for (const d of doelen) {
    try {
      // 1. De database. Code die op een migratie leunt mag niet klaar heten terwijl die migratie er niet is.
      const mig = await pasDoelMigratiesToe(sql, token, d);
      if (mig.open.length > 0) {
        const tekst = `migratie nog niet toegepast — ${mig.open.map((o) => `${o.naam}: ${o.reden}`).join(" | ")}`;
        const bevoegdheid = mig.open.some((o) => o.bevoegdheid);
        const naar = bevoegdheid ? "vast" : "bezig";
        await sql.unsafe("select jarvis.doel_ci($1, $2, null, $3)", [d.id, naar, rendereerBlokkade(tekst, classificeerBlokkade(bevoegdheid ? `${tekst} (ontbrekende bevoegdheid)` : tekst)).slice(0, 1800)]);
        console.log(`jarvis eindcontrole: ${d.id} → ${naar} (${tekst.slice(0, 160)})`);
        continue;
      }
      if (mig.gedaan.length > 0) await schrijfAcceptatie(sql, d.id, `migraties toegepast: ${mig.gedaan.join(", ")}`);

      // 2. De uitrol, zoals altijd: draagt de pagina het bouwmerk van deze samenvoeging of later?
      const merge = d.pr?.merge_sha ?? null;
      const minuten = (Date.now() - Date.parse(d.bijgewerkt)) / 60_000;
      if (d.acceptatie_url !== null) {
        let uitkomst: { geslaagd: boolean; bewijs: string };
        try {
          const a = await fetch(d.acceptatie_url, { redirect: "follow", headers: { "User-Agent": "jarvis-eindcontrole", "Cache-Control": "no-cache" } });
          const tekst = await a.text();
          const gevonden = leesBouwmerkUitPagina(tekst);
          const nazaat = gevonden !== null && merge !== null && d.pr?.repo ? await isNazaat(token, d.pr.repo, merge, gevonden) : false;
          uitkomst = beoordeelHttpMeting({ soort: "http", url: d.acceptatie_url, bouwmerk: true }, { status: a.status, tekst }, merge, () => nazaat);
        } catch (fout) {
          uitkomst = { geslaagd: false, bewijs: `niet bereikbaar: ${fout instanceof Error ? fout.message : String(fout)}` };
        }
        if (!uitkomst.geslaagd) {
          if (minuten >= 30) {
            await sql.unsafe("select jarvis.doel_ci($1, 'bezig', null, $2)", [d.id, `productie na ${Math.round(minuten)} min niet in orde: ${uitkomst.bewijs}`]);
            console.log(`jarvis eindcontrole: ${d.id} → terug naar de uitvoerder (${uitkomst.bewijs})`);
          } else {
            console.log(`jarvis eindcontrole: ${d.id} wacht op de uitrol (${Math.round(minuten)} min): ${uitkomst.bewijs}`);
          }
          continue;
        }
      }

      // 3. De acceptatietests die de eigenaar in de opdracht zette. Staat er geen, dan meet de keten zoals altijd.
      const tests = leesAcceptatieTests(d.opdracht);
      if (tests.length === 0) {
        const bewijs = d.acceptatie_url === null ? "samengevoegd; het doel noemt geen acceptatie-URL en geen expliciete acceptatietest" : "productie gemeten op de acceptatie-URL";
        await sql.unsafe("select jarvis.doel_ci($1, 'klaar', null, $2)", [d.id, mig.gedaan.length > 0 ? `${bewijs}; migraties toegepast: ${mig.gedaan.join(", ")}` : bewijs]);
        console.log(`jarvis eindcontrole: ${d.id} → klaar (${bewijs})`);
        continue;
      }
      // Een uitrol krijgt een halfuur voordat er wordt gemeten; anders meet de test de oude pagina.
      if (d.acceptatie_url === null && minuten < UITROL_WACHT_MINUTEN) {
        console.log(`jarvis eindcontrole: ${d.id} wacht op de uitrol vóór de acceptatietest (${Math.round(minuten)} van ${UITROL_WACHT_MINUTEN} min)`);
        continue;
      }
      const uitkomsten = await voerAcceptatieUit(sql, d, tests);
      const eind = eindoordeel(uitkomsten);
      if (eind.klaar) {
        await sql.unsafe("select jarvis.doel_ci($1, 'klaar', null, $2)", [d.id, `acceptatietests geslaagd — ${eind.samenvatting}`]);
        console.log(`jarvis eindcontrole: ${d.id} → klaar (${uitkomsten.length} acceptatietest(s) geslaagd)`);
        continue;
      }
      // Mislukt: de bestaande herstelketen. Pas als herstel niet lukt, staat het doel vast — niet eerder.
      const eerder = (await sql.unsafe(ACCEPTATIE_MISLUKT_SQL, [d.id])) as unknown as { aantal: string | number }[];
      const rondes = Number(eerder[0]?.aantal ?? 0);
      const bevoegdheid = uitkomsten.some((u) => classificeerBlokkade(u.reden).soort === "bevoegdheid");
      const naar = bevoegdheid || rondes >= MAX_ACCEPTATIE_RONDES ? "vast" : "bezig";
      const tekst = `acceptatietest niet geslaagd — ${eind.samenvatting}`;
      await sql.unsafe("select jarvis.doel_ci($1, $2, null, $3)", [d.id, naar, rendereerBlokkade(tekst).slice(0, 1800)]);
      console.log(`jarvis eindcontrole: ${d.id} → ${naar} (${tekst.slice(0, 200)})`);
    } catch (fout) {
      console.error(`jarvis eindcontrole: ${d.id}: ${fout instanceof Error ? fout.message : String(fout)}`);
      code = 1;
    }
  }
  return code;
}

// ---------------------------------------------------------------------------
// De eigen migratielane en de functionele acceptatietest
//
// Beide horen bij de eindcontrole in CI en nergens anders: dat is de enige
// identiteit (jarvis_ci) die een doel klaar mag verklaren, en dus de enige
// plek waar het hoort te blijken dat er nog iets te doen was. De uitvoerder
// levert SQL en tests op; hij past ze niet toe en keurt ze niet goed.
// ---------------------------------------------------------------------------

/** Eén migratie uit een doeldossier, met zijn inhoud op de samenvoegcommit. */
type DoelMigratie = { readonly pad: string; readonly bestand: string; readonly sql: string };

/** De doel-SQL uit de samengevoegde pull request, gelezen op de samenvoegcommit zelf. */
async function doelMigratieBestanden(token: string, slug: string, nummer: number, ref: string, doel: string): Promise<readonly DoelMigratie[] | string> {
  const bestanden = await leesAllePaginas<{ filename: string; status: string }>(token, `/repos/${slug}/pulls/${nummer}/files`, 5);
  if (typeof bestanden === "string") return bestanden;
  const uit: DoelMigratie[] = [];
  for (const b of bestanden) {
    const hoort = doelVanMigratie(b.filename);
    if (hoort === null || hoort.doel !== doel) continue;
    if (b.status === "removed") continue;
    const inhoud = await github(token, "GET", `/repos/${slug}/contents/${b.filename.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`);
    const l = inhoud.lading as { content?: string; encoding?: string } | null;
    if (inhoud.status !== 200 || l?.encoding !== "base64" || typeof l.content !== "string") return `${b.filename} is niet te lezen op ${ref.slice(0, 7)}`;
    uit.push({ pad: b.filename, bestand: hoort.bestand, sql: Buffer.from(l.content, "base64").toString("utf8") });
  }
  return uit.sort((a, b) => a.pad.localeCompare(b.pad));
}

/**
 * Past de SQL van een samengevoegd doel toe, één voor één, en zegt wat er
 * open blijft. Idempotent: het ledger in de database beslist of iets al is
 * gedaan, dus elke ronde mag opnieuw proberen.
 *
 * Wat hier open blijft, houdt het doel tegen. Dat is het hele punt: code die
 * op een migratie leunt mag niet klaar heten terwijl die migratie er niet is.
 */
async function pasDoelMigratiesToe(
  sql: DbClient,
  token: string,
  d: Doel,
): Promise<{ readonly gedaan: readonly string[]; readonly open: readonly { readonly naam: string; readonly reden: string; readonly bevoegdheid: boolean }[] }> {
  const pr = d.pr;
  if (!pr?.repo || !pr.nummer || !pr.merge_sha) return { gedaan: [], open: [] };
  const bestanden = await doelMigratieBestanden(token, pr.repo, pr.nummer, pr.merge_sha, d.id);
  if (typeof bestanden === "string") return { gedaan: [], open: [{ naam: "(lezen)", reden: bestanden, bevoegdheid: false }] };
  if (bestanden.length === 0) return { gedaan: [], open: [] };
  // Is de lane zelf er nog niet, dan is dat een ontbrekende bevoegdheid van dit ene doel — en geen reden
  // om elk ander doel tegen te houden. Daarom hier gevangen en niet verderop in de lus.
  let ledger: { naam: string; hash: string; uitkomst: string; reden: string | null }[];
  try {
    ledger = (await sql.unsafe(MIGRATIE_LEDGER_SQL, [d.id])) as unknown as { naam: string; hash: string; uitkomst: string; reden: string | null }[];
  } catch (fout) {
    const tekst = fout instanceof Error ? fout.message : String(fout);
    return {
      gedaan: [],
      open: [
        {
          naam: bestanden.map((b) => b.bestand).join(", "),
          reden: `de eigen migratielane is niet ingericht (${tekst.slice(0, 200)}); zonder ledger wordt er niets toegepast — ontbrekende bevoegdheid`,
          bevoegdheid: true,
        },
      ],
    };
  }
  const gedaan: string[] = [];
  const open: { naam: string; reden: string; bevoegdheid: boolean }[] = [];
  for (const b of bestanden) {
    const naam = migratieNaam(d.id, b.bestand);
    const al = ledger.find((r) => r.naam === naam && r.uitkomst === "toegepast");
    if (al !== undefined) {
      if (al.hash !== hashSql(b.sql)) {
        open.push({ naam, reden: "staat als toegepast in het ledger met andere inhoud; een toegepaste migratie wijzigt niet meer", bevoegdheid: true });
        continue;
      }
      gedaan.push(naam);
      continue;
    }
    const bezwaren = beoordeelEigenSql(b.sql);
    if (bezwaren.length > 0) {
      const bevoegdheid = bezwaarIsBevoegdheid(bezwaren);
      open.push({ naam, reden: bezwaren.join("; "), bevoegdheid });
      continue;
    }
    try {
      const r = await sql.unsafe(EIGEN_MIGRATIE_SQL, [naam, b.sql, d.id]);
      gedaan.push(`${naam} (${String(r[0]?.["uitkomst"] ?? "toegepast")})`);
      console.log(`jarvis eindcontrole: ${d.id}: migratie ${naam} ${String(r[0]?.["uitkomst"] ?? "toegepast")}`);
    } catch (fout) {
      const tekst = fout instanceof Error ? fout.message : String(fout);
      open.push({ naam, reden: tekst.slice(0, 500), bevoegdheid: /geweigerd|permission|niet toegestaan|bestaat niet|does not exist/i.test(tekst) });
    }
  }
  return { gedaan, open };
}

/** Eén vraag aan het tweede model via de bestaande voorziening in de database; geen tweede modelweg. */
async function vraagBeoordelaar(sql: DbClient, systeem: string, vraag: string): Promise<string | { readonly fout: string }> {
  const gevraagd = await sql.unsafe(VRAAG_REVIEW_SQL, [JSON.stringify(bouwAanroep(REVIEW_MODEL, vraag, systeem))]);
  const id = Number(gevraagd[0]?.["id"]);
  if (!Number.isInteger(id) || id <= 0) return { fout: "de database verstuurde het verzoek niet" };
  const start = Date.now();
  while (Date.now() - start < REVIEW_WACHT_MS) {
    await new Promise((klaar) => setTimeout(klaar, 5_000));
    const r = (await sql.unsafe(LEES_REVIEW_SQL, [id]))[0];
    if (!r || (r["status_code"] === null && r["error_msg"] === null && r["timed_out"] !== true)) continue;
    if (r["timed_out"] === true || r["error_msg"]) return { fout: `het verzoek mislukte (${r["timed_out"] === true ? "time-out" : String(r["error_msg"])})` };
    let lading: unknown = null;
    try {
      lading = r["content"] == null ? null : JSON.parse(String(r["content"]));
    } catch {
      lading = null;
    }
    if (Number(r["status_code"]) !== 200) return { fout: `de beoordelaar antwoordde HTTP ${String(r["status_code"])}${leverancierFout(lading) ? ` — ${leverancierFout(lading)}` : ""}` };
    const tekst = antwoordTekst(lading);
    return tekst === null ? { fout: "het antwoord bevat geen tekst" } : tekst;
  }
  return { fout: "geen antwoord binnen de wachttijd" };
}

/** Het onderwerp waarop een onbepaalbare test eerder is vastgezet, uit de activiteit van het doel. */
function vastgezetOnderwerp(activiteit: readonly { soort: string; tekst: string }[], testId: string): string | null {
  for (const a of activiteit) {
    if (a.soort !== "acceptatie") continue;
    const m = new RegExp(`vastgezet: ${testId}=([^\\s;]+)`).exec(a.tekst);
    if (m !== null) return m[1]!;
  }
  return null;
}

/**
 * Het bewijs voor één acceptatietest: wat er werkelijk is gemeten. Geen
 * samenvatting en geen conclusie — die velt de beoordelaar.
 */
async function bewijsVoorTest(
  sql: DbClient,
  d: Doel,
  test: AcceptatieTest,
  onderwerp: string | null,
): Promise<{ readonly bewijs: string; readonly onuitvoerbaar: string | null }> {
  if (test.soort === "http" && test.url !== null) {
    try {
      const a = await fetch(test.url, { redirect: "follow", headers: { "User-Agent": "jarvis-acceptatie", "Cache-Control": "no-cache" } });
      const tekst = await a.text();
      return { bewijs: `GET ${test.url} → HTTP ${a.status}\n\n${tekst.slice(0, 6000)}`, onuitvoerbaar: null };
    } catch (fout) {
      return { bewijs: `GET ${test.url} mislukte: ${fout instanceof Error ? fout.message : String(fout)}`, onuitvoerbaar: null };
    }
  }
  if (test.soort === "aivraag") {
    const sleutelRij = await sql.unsafe(ACCEPTATIE_SLEUTEL_SQL).catch(() => [] as Record<string, unknown>[]);
    const sleutel = String(sleutelRij[0]?.["sleutel"] ?? "").trim();
    const urlRij = await sql.unsafe(INSTELLING_SQL, ["ai_core_url"]).catch(() => [] as Record<string, unknown>[]);
    const url = String(urlRij[0]?.["waarde"] ?? "").trim();
    if (!sleutel || !url) {
      return {
        bewijs: "",
        onuitvoerbaar:
          "de AI Core is vanuit CI niet te bevragen: de acceptatiedeur (instelling ai_core_url en de sleutel acceptatie_sleutel) is er niet. " +
          "Dat is een ontbrekende technische bevoegdheid, geen besluit.",
      };
    }
    const vraag = (onderwerp !== null && test.vraag !== null ? `${test.vraag} (het gaat om ${onderwerp})` : test.vraag) ?? "";
    try {
      const a = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${sleutel}`, "Content-Type": "application/json", "User-Agent": "jarvis-acceptatie" },
        body: JSON.stringify({ bericht: vraag, alleen_lezen: true }),
      });
      const tekst = await a.text();
      return { bewijs: `POST ${url}\nvraag: ${vraag}\n\nHTTP ${a.status}\n${tekst.slice(0, 8000)}`, onuitvoerbaar: null };
    } catch (fout) {
      return { bewijs: `de AI Core antwoordde niet: ${fout instanceof Error ? fout.message : String(fout)}`, onuitvoerbaar: null };
    }
  }
  // sql en bewijs: wat de administratie zelf vastlegt. Read-only en vast omschreven; nooit SQL uit een opdrachttekst.
  let ledger: Record<string, unknown>[] = [];
  let activiteit: Record<string, unknown>[] = [];
  let feiten: Record<string, unknown>[] = [];
  try {
    ledger = (await sql.unsafe(MIGRATIE_LEDGER_SQL, [d.id])) as unknown as Record<string, unknown>[];
    activiteit = (await sql.unsafe(DOEL_ACTIVITEIT_SQL, [onderwerp ?? d.id])) as unknown as Record<string, unknown>[];
    if (test.soort === "sql") feiten = (await sql.unsafe(SCHEMA_FEITEN_SQL)) as unknown as Record<string, unknown>[];
  } catch (fout) {
    // Niet kunnen lezen is geen mislukte test: het is een ontbrekend leesrecht van de eindcontrole.
    return {
      bewijs: "",
      onuitvoerbaar: `het bewijs is niet te lezen: ${fout instanceof Error ? fout.message : String(fout)} — ontbrekende bevoegdheid van de eindcontrole, geen besluit`,
    };
  }
  const delen = [
    `doel ${d.id} (${d.titel}) staat op ${d.status}; uitkomst: ${d.uitkomst ?? "(geen)"}`,
    `pull request: ${d.pr?.repo ?? "-"}#${d.pr?.nummer ?? "-"} kop ${String(d.pr?.kop ?? "-").slice(0, 7)} merge ${String(d.pr?.merge_sha ?? "-").slice(0, 7)}`,
    `migratieledger van dit doel:\n${ledger.length === 0 ? "(geen regels)" : JSON.stringify(ledger).slice(0, 4000)}`,
    `activiteit van ${onderwerp ?? d.id}:\n${activiteit.length === 0 ? "(geen regels)" : JSON.stringify(activiteit).slice(0, 8000)}`,
  ];
  if (feiten.length > 0) delen.push(`wat er in het schema jarvis staat:\n${JSON.stringify(feiten).slice(0, 6000)}`);
  return { bewijs: delen.join("\n\n"), onuitvoerbaar: null };
}

/**
 * Voert de acceptatietests van een doel uit en laat elk oordeel door het
 * tweede model vellen. Een test die niet uit te voeren is, is niet geslaagd:
 * niet gemeten is niet bewezen.
 */
async function voerAcceptatieUit(sql: DbClient, d: Doel, tests: readonly AcceptatieTest[]): Promise<readonly AcceptatieUitkomst[]> {
  const activiteit = (await sql.unsafe(DOEL_ACTIVITEIT_SQL, [d.id])) as unknown as { soort: string; tekst: string }[];
  const uit: AcceptatieUitkomst[] = [];
  for (const test of tests) {
    let onderwerp = test.onderwerp ?? vastgezetOnderwerp(activiteit, test.id);
    if (test.volatiel && onderwerp === null) {
      // Een test die van het toeval afhangt, wordt één keer vastgezet op wat nu het onderwerp is;
      // daarna meet dezelfde test hetzelfde. De eigenaar hoeft daar niets voor te doen.
      const kandidaat = (await sql.unsafe(LAATST_VAST_SQL)) as unknown as { id: string }[];
      onderwerp = kandidaat[0]?.id ?? null;
      if (onderwerp !== null) {
        await schrijfAcceptatie(sql, d.id, `vastgezet: ${test.id}=${onderwerp} (${volatielBezwaar(test)})`);
        console.log(`jarvis acceptatie: ${d.id}: test ${test.id} vastgezet op ${onderwerp}`);
      }
    }
    const { bewijs, onuitvoerbaar } = await bewijsVoorTest(sql, d, test, onderwerp);
    if (onuitvoerbaar !== null) {
      uit.push({ id: test.id, geslaagd: false, bewijs: "", reden: onuitvoerbaar });
      continue;
    }
    const antwoord = await vraagBeoordelaar(sql, BEOORDELAAR_SYSTEEM, bouwBeoordelingsVraag(test, bewijs));
    if (typeof antwoord !== "string") {
      uit.push({ id: test.id, geslaagd: false, bewijs, reden: `de beoordeling kon niet worden gevraagd: ${antwoord.fout}` });
      continue;
    }
    const oordeel = parseerBeoordeling(antwoord);
    uit.push({ id: test.id, geslaagd: oordeel.geslaagd, bewijs, reden: oordeel.reden });
    await schrijfAcceptatie(sql, d.id, `test ${test.id}: ${oordeel.geslaagd ? "geslaagd" : "niet geslaagd"} — ${oordeel.reden}`);
    console.log(`jarvis acceptatie: ${d.id}: test ${test.id} → ${oordeel.geslaagd ? "geslaagd" : "niet geslaagd"} (${oordeel.reden.slice(0, 120)})`);
  }
  return uit;
}

/** Eén regel in de bestaande activiteitenlog; dat is waar de AI Core en de eigenaar kijken. */
async function schrijfAcceptatie(sql: DbClient, doel: string, tekst: string): Promise<void> {
  try {
    await sql.unsafe(ACTIVITEIT_SQL, ["ci", "qa", doel, null, "acceptatie", tekst.slice(0, 500), null]);
  } catch (fout) {
    console.error(`jarvis acceptatie: activiteit niet geschreven: ${fout instanceof Error ? fout.message : String(fout)}`);
  }
}

/** Start de routine via de API als er een doel zonder beweging staat. Het token gaat alleen in een header. */
async function dispatchDoelen(sql: DbClient, droog: boolean): Promise<number> {
  const besluit = dispatchNodig(await leesDoelen(sql), new Date());
  console.log(`jarvis dispatch: ${besluit.reden}`);
  if (!besluit.start) return 0;
  const claim = await sql.unsafe("select jarvis.v3_dispatch_claim($1) as ok", [20]);
  if (claim[0]?.["ok"] !== true) {
    console.log("jarvis dispatch: er is net een start gedaan; geen tweede.");
    return 0;
  }
  if (droog) return 0;
  const url = (process.env.JARVIS_ROUTINE_FIRE_URL ?? "").trim();
  const token = (process.env.JARVIS_ROUTINE_TOKEN ?? "").trim();
  if (!url || !token) {
    console.error("jarvis dispatch: JARVIS_ROUTINE_FIRE_URL en JARVIS_ROUTINE_TOKEN ontbreken; niet gestart.");
    return 1;
  }
  const antwoord = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "anthropic-beta": "experimental-cc-routine-2026-04-01", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ text: `Doelen: ${besluit.reden}` }),
  });
  console.log(`jarvis dispatch: routine gestart? HTTP ${antwoord.status}`);
  return antwoord.ok ? 0 : 1;
}

/** `jarvis v3 sweep` in de bestaande workflow: reviewen en samenvoegingen vastleggen. */
export async function ciSweep(): Promise<number> {
  const token = (process.env.GITHUB_TOKEN ?? "").trim();
  if (!token) {
    console.error("jarvis review-ci: geen GITHUB_TOKEN.");
    return 1;
  }
  return await met(async (sql) => {
    const a = await vastleggen(sql, token);
    const b = await reviewen(sql, token);
    return a || b;
  });
}

/** `jarvis v3 eindcontrole` in de bestaande workflow. */
export async function ciEindcontrole(): Promise<number> {
  const token = (process.env.GITHUB_TOKEN ?? "").trim();
  return await met((sql) => eindcontroleDoelen(sql, token));
}

/** `jarvis v3 dispatch` in de bestaande workflow. */
export async function ciDispatch(droog: boolean): Promise<number> {
  return await met((sql) => dispatchDoelen(sql, droog));
}

/**
 * Legt een statuswisseling van de uitvoerder vast in de bestaande activiteit, zodat de AI Core later kan uitleggen
 * wat er met een doel gebeurde (vastlopen en reden, hervatting, pull request). Best-effort: een mislukte regel
 * breekt de statuswisseling niet.
 */
async function leg(sql: DbClient, id: string, van: string, naar: string, pr: string | null, uitkomst: string | null): Promise<void> {
  const soort = naar === "vast" ? "fout" : van === "vast" || van === "klaar" ? "herstel" : naar === "review" ? "pr" : "stap";
  let verwijzing: string | null = null;
  try {
    const p = pr === null ? null : (JSON.parse(pr) as { repo?: string; nummer?: number });
    if (p?.repo && p.nummer) verwijzing = `${p.repo.split("/").pop()}#${p.nummer}`;
  } catch { /* pr is al gevalideerd door de aanroeper */ }
  const tekst = `Status ${van} → ${naar}${uitkomst ? `: ${uitkomst}` : ""}`.slice(0, 500);
  try {
    await sql.unsafe(ACTIVITEIT_SQL, [process.env.JARVIS_UITVOERDER ?? "cloud", "developer", id, null, soort, tekst, verwijzing]);
  } catch {
    console.error("jarvis doel: statuswisseling niet in de activiteit gelegd.");
  }
}

/** `jarvis doel lijst | zet <id> <status> [--pr <json>] [--uitkomst <tekst>]` — voor de uitvoerder. */
export async function voerDoelUit(argv: readonly string[]): Promise<number> {
  const { opdracht, vlaggen, losse } = leesArgumenten(argv);
  try {
    if (opdracht === "lijst") {
      return await met(async (sql) => {
        console.log(JSON.stringify(await leesDoelen(sql), null, 2));
        return 0;
      });
    }
    if (opdracht === "zet") {
      const [id, status] = losse;
      if (!id || !status) throw new Error("gebruik: jarvis doel zet <id> <bezig|review|vast> [--pr <json>] [--uitkomst <tekst>]");
      const pr = vlaggen.get("pr");
      if (pr !== undefined) JSON.parse(pr);
      return await met(async (sql) => {
        const voor = (await leesDoelen(sql)).find((d) => d.id === id)?.status ?? "?";
        const r = await sql.unsafe(DOEL_WERK_SQL, [id, status, pr ?? null, vlaggen.get("uitkomst") ?? null]);
        await leg(sql, id, voor, String(r[0]?.["status"]), pr ?? null, vlaggen.get("uitkomst") ?? null);
        console.log(`jarvis doel: ${id} → ${String(r[0]?.["status"])}`);
        return 0;
      });
    }
    console.error("jarvis doel: gebruik: jarvis doel lijst | jarvis doel zet <id> <status> [--pr <json>] [--uitkomst <tekst>]");
    return 2;
  } catch (fout) {
    console.error(`jarvis doel: ${(fout instanceof Error ? fout.message : String(fout)).replace(/postgres(ql)?:\/\/\S+/gi, "<verbindingsreeks>")}`);
    return 1;
  }
}
