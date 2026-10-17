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
import { DOEL_WERK_SQL, DOELEN_SQL, LEES_REVIEW_SQL, TOETSING_SQL, VRAAG_REVIEW_SQL } from "./db";
import { checksGroen, dispatchNodig, doelUitPrTekst, reviewBesluit, type Doel, type ReviewOordeel } from "./doelen";
import { foutTekst, github, leesAllePaginas, leesPullRequest, verbindDb, type DbClient } from "./opdrachten";
import { laatstePerNaam, VERPLICHTE_CHECK } from "./pr";
import { antwoordTekst, bouwAanroep, bouwReviewVraag, leverancierFout, parseerReview, rendereerReview, type Review } from "./review";
import { beoordeelHttpMeting, leesBouwmerkUitPagina } from "./v3";

const OORDELEN_SQL =
  "select commit_sha as kop, oordeel, door from jarvis.toetsingen where lower(pr_repo) = lower($1) and pr_nummer = $2";
const REVIEW_MODEL = "gpt-5.1";
const REVIEW_WACHT_MS = 240_000;

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
  return { eigen, alle: [eigen, ...(engine && engine !== eigen ? [engine] : [])].filter(Boolean), bot };
}

/** Het tweede model leest één pull request. Geeft het oordeel, of een foutmelding. */
async function tweedeLezing(sql: DbClient, token: string, slug: string, nummer: number, doel: Doel | null): Promise<{ review: Review; kop: string } | string> {
  const pr = await github(token, "GET", `/repos/${slug}/pulls/${nummer}`);
  if (pr.status !== 200) return `pull request niet te lezen (${foutTekst(pr)})`;
  const p = pr.lading as { title: string; body: string | null; head: { sha: string } };
  const bestanden = await leesAllePaginas<{ filename: string; status: string; patch?: string }>(token, `/repos/${slug}/pulls/${nummer}/files`, 5);
  if (typeof bestanden === "string") return bestanden;
  const diff = bestanden.map((b) => ({ bestand: b.filename, status: b.status, patch: b.patch ?? "(geen patch: binair of te groot)" }));
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
    const review = parseerReview(tekst);
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
        const besluit = reviewBesluit(feiten.kop, oordelen, groen);
        const doelId = doelUitPrTekst(p.body ?? "");
        const doel = doelen.find((d) => d.id === doelId) ?? null;
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
        const oordeel = uit.review.oordeel === "akkoord" ? "GO" : "NO-GO";
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
  for (const slug of alle) {
    const gesloten = await leesAllePaginas<{ number: number; merged_at: string | null; merge_commit_sha: string | null; body: string | null; user: { login: string }; head: { sha: string }; base: { ref: string } }>(
      token, `/repos/${slug}/pulls?state=closed&sort=updated&direction=desc`, 1);
    if (typeof gesloten === "string") continue;
    for (const p of gesloten) {
      if (p.merged_at === null || p.merge_commit_sha === null || p.base.ref !== "main" || p.user.login.toLowerCase() !== bot.toLowerCase()) continue;
      const d = lopend.find((x) => x.id === doelUitPrTekst(p.body ?? ""));
      if (d === undefined) continue;
      const pr = { repo: slug, nummer: p.number, kop: p.head.sha, merge_sha: p.merge_commit_sha };
      await sql.unsafe("select jarvis.doel_ci($1, 'samengevoegd', $2::text::jsonb, null)", [d.id, JSON.stringify(pr)]);
      console.log(`jarvis doel: ${d.id} samengevoegd via ${slug}#${p.number} (${p.merge_commit_sha.slice(0, 7)})`);
    }
  }
  return 0;
}

/** Staat `kandidaat` op of na `basis`? Via de compare-API; bij twijfel nee. */
async function isNazaat(token: string, slug: string, basis: string, kandidaat: string): Promise<boolean> {
  const a = await github(token, "GET", `/repos/${slug}/compare/${basis}...${kandidaat}`);
  const status = (a.lading as { status?: string } | null)?.status;
  return a.status === 200 && (status === "ahead" || status === "identical");
}

/** De eindcontrole: meet productie voor elk samengevoegd doel. Een uitrol krijgt een halfuur. */
async function eindcontroleDoelen(sql: DbClient, token: string): Promise<number> {
  const doelen = (await leesDoelen(sql)).filter((d) => d.status === "samengevoegd");
  console.log(`jarvis eindcontrole: ${doelen.length} samengevoegd doel(en).`);
  for (const d of doelen) {
    const merge = d.pr?.merge_sha ?? null;
    if (d.acceptatie_url === null) {
      await sql.unsafe("select jarvis.doel_ci($1, 'klaar', null, $2)", [d.id, "samengevoegd; het doel noemt geen acceptatie-URL om te meten"]);
      console.log(`jarvis eindcontrole: ${d.id} → klaar (geen acceptatie-URL)`);
      continue;
    }
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
    const minuten = (Date.now() - Date.parse(d.bijgewerkt)) / 60_000;
    if (uitkomst.geslaagd) {
      await sql.unsafe("select jarvis.doel_ci($1, 'klaar', null, $2)", [d.id, `productie gemeten: ${uitkomst.bewijs}`]);
      console.log(`jarvis eindcontrole: ${d.id} → klaar (${uitkomst.bewijs})`);
    } else if (minuten >= 30) {
      await sql.unsafe("select jarvis.doel_ci($1, 'bezig', null, $2)", [d.id, `productie na ${Math.round(minuten)} min niet in orde: ${uitkomst.bewijs}`]);
      console.log(`jarvis eindcontrole: ${d.id} → terug naar de uitvoerder (${uitkomst.bewijs})`);
    } else {
      console.log(`jarvis eindcontrole: ${d.id} wacht op de uitrol (${Math.round(minuten)} min): ${uitkomst.bewijs}`);
    }
  }
  return 0;
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
        const r = await sql.unsafe(DOEL_WERK_SQL, [id, status, pr ?? null, vlaggen.get("uitkomst") ?? null]);
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
