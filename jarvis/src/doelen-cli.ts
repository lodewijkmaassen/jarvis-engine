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

import { readFile } from "node:fs/promises";
import path from "node:path";

import { REVIEWER_DOOR } from "./attestatie";
import { leesArgumenten } from "./args";
import { laadConfig, vindWortel } from "./config";
import { ACTIVITEIT_SQL, DOEL_WERK_SQL, KETEN_SPOOR_SQL, DOELEN_SQL, LEES_REVIEW_SQL, TOETSING_SQL, VRAAG_REVIEW_SQL } from "./db";
import { eindoordeel, leesAcceptatieTests } from "./acceptatie";
import { leesEngineStand } from "./engine";
import { classificeerBlokkade, rendereerBlokkade, vanDeEigenaar } from "./blokkade";
import { ACCEPTATIE_MISLUKT_SQL, MAX_ACCEPTATIE_RONDES, schrijfAcceptatie, voerAcceptatieUit } from "./doel-acceptatie";
import { pasDoelMigratiesToe } from "./doel-migratie";
import { ketenSpoor, WACHTENDE_TOESTANDEN, checksGroen, dispatchNodig, doelUitPrTekst, hermeetbaar, metKetenVersie, REVIEW_MODEL, REVIEW_WACHT_MS, reviewBesluit, type Doel, type ReviewOordeel } from "./doelen";
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
/** Een uitrol krijgt een halfuur voordat de eindcontrole tegen productie meet. */
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

/**
 * De versie van de keten die nu draait: de engine-commit die in deze
 * repository is vastgepind. Die verandert precies dan wanneer er aan de keten
 * is gewerkt, en is daarmee het antwoord op "is er sinds die blokkade iets
 * veranderd?" (RSK-0033).
 *
 * Geen pin te lezen (de engine-repository zelf), dan de commit van deze
 * repository: grover, maar nooit verkeerd — hij wijzigt ook bij een wijziging
 * aan de keten.
 */
async function ketenVersie(): Promise<string | null> {
  const wortel = (await vindWortel(process.cwd())) ?? process.cwd();
  const lees = async (...delen: string[]): Promise<string | null> => {
    try {
      return await readFile(path.join(wortel, ...delen), "utf8");
    } catch {
      return null;
    }
  };
  const stand = leesEngineStand(
    await lees("package.json"),
    await lees("package-lock.json"),
    await lees("node_modules", ".package-lock.json"),
    false,
  );
  const uitPin = stand.modus === "consumer" ? (stand.shaGeinstalleerd ?? stand.shaLock) : null;
  const versie = uitPin ?? (process.env.GITHUB_SHA ?? "").trim();
  return versie === "" ? null : versie.slice(0, 7);
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
  const versie = await ketenVersie();
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
      // Eén samenvoeging wordt één keer vastgelegd. Zonder deze regel haalde de sweep een doel dat de
      // eindcontrole net terug in de herstelketen had gezet meteen weer naar samengevoegd, waarna de
      // eindcontrole het opnieuw terugzette: de twee stappen bleven elkaar overschrijven (gemeten
      // 2026-11-07 op D-20261107-010000001, tien keer in één uur). Herstel vraagt dus een nieuwe
      // samenvoeging — precies wat een hersteld doel ook oplevert.
      // Eén uitzondering op "één keer vastleggen", en met opzet een smalle: lag de fout in de keten zelf, dan
      // is er na het herstel geen weg terug naar `samengevoegd` en moest een mens een kunstmatige samenvoeging
      // op het eigen dossier maken om een doel opnieuw te laten meten (RSK-0033). `hermeetbaar` staat in
      // doelen.ts en eist drie dingen: het doel loopt met een vastgelegde samenvoeging, de laatste uitkomst is
      // een blokkade van Jarvis zélf ([fout] of [bevoegdheid]), en zij is gemeten met een ANDERE versie van de
      // keten dan de huidige. Is de keten niet veranderd, dan gebeurt er niets — en dat is wat het ping-pong
      // van 2026-11-07 tegenhoudt.
      if ((d.pr?.merge_sha ?? "").toLowerCase() === p.merge_commit_sha.toLowerCase()) {
        if (!hermeetbaar(d, versie)) {
          console.log(`jarvis doel: ${slug}#${p.number} is voor ${d.id} al vastgelegd op ${p.merge_commit_sha.slice(0, 7)}; niet opnieuw`);
          continue;
        }
        console.log(`jarvis doel: ${d.id} is gemeten met een andere versie van de keten dan de huidige (${versie}); opnieuw beoordelen op ${p.merge_commit_sha.slice(0, 7)}`);
      }
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
  const versie = await ketenVersie();
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
        const blok = classificeerBlokkade(bevoegdheid ? `${tekst} (ontbrekende bevoegdheid)` : tekst);
        const naar = vanDeEigenaar(blok) ? "vast" : "bezig";
        await sql.unsafe("select jarvis.doel_ci($1, $2, null, $3)", [d.id, naar, metKetenVersie(rendereerBlokkade(tekst, blok).slice(0, 1700), versie)]);
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
      // Niet klaar. Wat er daarna gebeurt, hangt af van wát er niet klopte:
      //   - niet te meten (een deur, een recht): een bevoegdheid. Terug naar de uitvoerder heeft geen zin;
      //     hij kan er niets aan herstellen. Het doel staat vast met de reden erbij.
      //   - gezakt: de bestaande herstelketen. Pas als herstel een paar keer niet lukt, staat het vast.
      const eerder = (await sql.unsafe(ACCEPTATIE_MISLUKT_SQL, [d.id])) as unknown as { aantal: string | number }[];
      const rondes = Number(eerder[0]?.aantal ?? 0);
      const tekst = eind.onmeetbaar
        ? `acceptatietest niet te meten — ${eind.samenvatting}`
        : `acceptatietest niet geslaagd (ronde ${rondes + 1} van ${MAX_ACCEPTATIE_RONDES}) — ${eind.samenvatting}`;
      const blok = classificeerBlokkade(eind.onmeetbaar ? `${tekst} (ontbrekende bevoegdheid)` : tekst);
      const naar = vanDeEigenaar(blok) || rondes >= MAX_ACCEPTATIE_RONDES ? "vast" : "bezig";
      await sql.unsafe("select jarvis.doel_ci($1, $2, null, $3)", [d.id, naar, metKetenVersie(rendereerBlokkade(tekst, blok).slice(0, 1700), versie)]);
      await schrijfAcceptatie(sql, d.id, `eindoordeel: ${naar} — ${tekst}`);
      console.log(`jarvis eindcontrole: ${d.id} → ${naar} [${blok.soort}] (${tekst.slice(0, 200)})`);
    } catch (fout) {
      console.error(`jarvis eindcontrole: ${d.id}: ${fout instanceof Error ? fout.message : String(fout)}`);
      code = 1;
    }
  }
  return code;
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

/**
 * Laat na dat deze ronde heeft gedraaid, en meldt het wanneer de vorige te
 * lang geleden was terwijl er werk stond. De regel zelf (wanneer schrijven,
 * wanneer stilstand) staat in doelen.ts; hier staat alleen de I/O.
 *
 * Best-effort: een spoor dat niet lukt, mag een ronde nooit tegenhouden.
 */
async function legKetenSpoorVast(sql: DbClient): Promise<void> {
  try {
    const vorige = (await sql.unsafe(KETEN_SPOOR_SQL)) as unknown as { op: string }[];
    const doelen = await leesDoelen(sql);
    const spoor = ketenSpoor({
      nu: new Date(),
      vorige: vorige[0]?.op ?? null,
      oorzaak: (process.env.GITHUB_EVENT_NAME ?? "").trim(),
      wachtend: doelen.filter((d) => WACHTENDE_TOESTANDEN.includes(d.status)).length,
    });
    if (spoor.stilstand) {
      console.log(`::warning title=keten stond stil::${spoor.tekst}`);
      console.log(
        `jarvis keten: ${spoor.tekst}. Deze ronde doet alsnog wat er lag; blijft dit gebeuren, dan is de ` +
          `starter in de database (jarvis.doel_ronde op het rooster) niet meer aan het werk.`,
      );
    }
    if (!spoor.schrijven) return;
    await sql.unsafe(ACTIVITEIT_SQL, ["ci", "systeem", null, null, "regie", spoor.tekst.slice(0, 500), null]);
  } catch (fout) {
    console.error(`jarvis keten: spoor niet vastgelegd: ${fout instanceof Error ? fout.message : String(fout)}`);
  }
}

/** `jarvis v3 sweep` in de bestaande workflow: reviewen en samenvoegingen vastleggen. */
export async function ciSweep(): Promise<number> {
  const token = (process.env.GITHUB_TOKEN ?? "").trim();
  if (!token) {
    console.error("jarvis review-ci: geen GITHUB_TOKEN.");
    return 1;
  }
  return await met(async (sql) => {
    // Het spoor eerst: het zegt iets over de ronde die nu begint, niet over wat zij deed.
    await legKetenSpoorVast(sql);
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
