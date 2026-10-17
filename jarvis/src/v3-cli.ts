// `jarvis v3 …` — de opdrachtregel van Jarvis V3.
//
// Dunne schil om de databasefuncties (jarvis/migrations/v3) en de pure
// beoordeling (v3.ts). Alles wat beslist staat daar; hier staat I/O.
//
//   nieuw --id <V3-…> --titel <t> --opdracht <t> [--bron <bericht-id>]
//   pak <taak> --door <naam>            neemt de lease; stil falen = exitcode 3
//   hartslag <taak> --door <naam>
//   blokkade <taak> --door <naam> [--tekst <t>]   zonder tekst: blokkade opgeheven
//   overgang <taak> --door <naam> --naar <TOESTAND> [--bewijs <json>]
//   vraag-akkoord <taak> --voorstel <json-bestand>
//   vraag <taak> --type beslissing|handeling --sleutel <s> --vraag <t> [--opties <json>] [--verificatie <json>]
//   meet <verzoek-id> --uitkomst <json>
//   werk [<taak>]                        taak + mandaat + verzoeken, als JSON
//   status                               alle taken (v3_actueel), als JSON
//   watchdog                             geeft verlopen leases vrij en toont uitvoerbaar werk
//   dispatch [--droog]                   start de routine via de API als er verweesd werk is
//   beoordeel-pr <nummer> --repo <slug> [--samenvoegen]   de poort: mandaat tegen PR, goedkeuren, samenvoegen
//   sweep --repo <slug>                  loopt alle open Jarvis-PR's langs (poort, goedkeuren, samenvoegen)
//   migreer --repo <slug> [--droog]      (alleen CI) past nieuwe migraties toe van taken met een vastgelegde samenvoeging
//   migreer --repo <slug> --basis <sha> --kop <sha> [--droog]   idem voor een expliciete reeks commits
//   eindcontrole                         (alleen CI, rol jarvis_ci) meet elk acceptatiecriterium en legt KLAAR of terug-naar-UITVOEREN vast
import { readFile } from "node:fs/promises";
import { ciDispatch, ciEindcontrole, ciSweep } from "./doelen-cli";
import { laadConfig, vindWortel } from "./config";
import { leesArgumenten } from "./args";
import { takenUitCommits } from "./attestatie";
import {
  V3_ACTUEEL_SQL,
  V3_VERZOEKEN_SQL,
  V3_WERK_SQL,
  v3Aanroep,
} from "./db";
import {
  foutTekst,
  github,
  leesAllePaginas,
  leesBotToken,
  leesPullRequest,
  verbindDb,
  type DbClient,
} from "./opdrachten";
import { laatstePerNaam, SAMENVOEGMETHODE, VERPLICHTE_CHECK } from "./pr";
import {
  geraaktePaden,
  beoordeelHttpMeting,
  leesBouwmerkUitPagina,
  beoordeelV3Pr,
  dispatchBesluit,
  magUitrollen,
  beoordeelMigraties,
  normaliseerMigratie,
  MIGRATIE_PAD,
  type Criterium,
  type Mandaat,
  type V3PrFeiten,
  type WerkRij,
} from "./v3";

/** Een bestandspad in een GitHub-URL: per segment gecodeerd. `encodeURI` laat `? # & =` staan, waardoor een bestandsnaam met een `?` een ander bestand opvraagt dan het samengevoegde. */
export function padNaarUrl(pad: string): string {
  return pad.split("/").map(encodeURIComponent).join("/");
}

/** Is er een GO op precies deze kop, en géén NO-GO? (Eén NO-GO weegt zwaarder dan elke GO; V2 blijft ongemoeid.) */
export const V3_TOETSING_GO_SQL =
  "select 1 as go from jarvis.toetsingen where lower(pr_repo) = lower($1) and pr_nummer = $2 and commit_sha = $3 and oordeel = 'GO' " +
  "and not exists (select 1 from jarvis.toetsingen where lower(pr_repo) = lower($1) and pr_nummer = $2 and commit_sha = $3 and oordeel <> 'GO') limit 1";

const TOESTANDEN = ["ANALYSE", "UITVOEREN", "CONTROLE", "UITROL", "EINDCONTROLE", "KLAAR", "MISLUKT"] as const;

function json(waarde: string | undefined, naam: string): unknown {
  if (waarde === undefined) return undefined;
  try {
    return JSON.parse(waarde);
  } catch {
    throw new Error(`--${naam} is geen geldige JSON`);
  }
}

function vereist(vlaggen: ReadonlyMap<string, string>, naam: string): string {
  const w = vlaggen.get(naam);
  if (w === undefined || w === "true" || w.trim() === "") throw new Error(`--${naam} is verplicht`);
  return w;
}

/** Het mandaat uit een rij van v3_werk; null als de taak er geen heeft. */
export function mandaatUitRij(rij: Record<string, unknown> | undefined): Mandaat | null {
  if (rij === undefined || rij["mandaat_id"] === null || rij["mandaat_id"] === undefined) return null;
  const lijst = (w: unknown): string[] => (Array.isArray(w) ? (w as string[]) : []);
  const acceptatie = typeof rij["acceptatie"] === "string" ? (JSON.parse(rij["acceptatie"]) as Criterium[]) : (rij["acceptatie"] as Criterium[]);
  return {
    taak_id: String(rij["id"]),
    doel: String(rij["doel"] ?? ""),
    acceptatie: Array.isArray(acceptatie) ? acceptatie : [],
    repos: lijst(rij["repos"]),
    paden_ja: lijst(rij["paden_ja"]),
    paden_nee: lijst(rij["paden_nee"]),
    productie: rij["productie"] === true,
    migraties: rij["migraties"] === true,
    destructief: rij["destructief"] === true,
    kosten_max_eur: Number(rij["kosten_max_eur"] ?? 0),
  };
}

/**
 * De noodstop. `enabled: false` in jarvis.config.yml van de uitgecheckte main stopt
 * ELKE V3-opdracht, net als bij V2: ook sweep, dispatch, migreren en de eindcontrole.
 * Kan de configuratie niet worden gelezen, dan faalt dit gesloten.
 */
export async function v3Ingeschakeld(wortel: string): Promise<{ readonly aan: boolean; readonly reden: string }> {
  const c = await laadConfig(wortel);
  if (!c.ok) return { aan: false, reden: `jarvis.config.yml niet te lezen (${c.fouten.join("; ")}); V3 faalt gesloten` };
  if (!c.config.enabled) return { aan: false, reden: "jarvis.config.yml staat op enabled: false (de noodstop); V3 doet niets" };
  return { aan: true, reden: "" };
}

async function met<T>(f: (sql: DbClient) => Promise<T>): Promise<T> {
  const v = await verbindDb();
  if (v === null) throw new Error("geen weg naar de database (JARVIS_DB_URL of de Edge Function)");
  try {
    return await f(v.sql);
  } finally {
    await v.sql.end({ timeout: 2 });
  }
}

// ------------------------------------------------------------------ de poort

async function beoordeelPr(nummer: number, slug: string, samenvoegen: boolean): Promise<number> {
  const token = (process.env.GITHUB_TOKEN ?? "").trim();
  if (!token) {
    console.error("jarvis v3 beoordeel-pr: geen GITHUB_TOKEN; deze opdracht draait alleen in de V3-poortworkflow.");
    return 1;
  }
  // De bot komt uit de configuratie van de uitgecheckte main, nooit uit de PR.
  const wortel = (await vindWortel(process.cwd())) ?? process.cwd();
  const config = await laadConfig(wortel);
  const bot = config.ok ? config.config.attestatie.bot : "";
  if (!bot) {
    console.error("jarvis v3 beoordeel-pr: jarvis.config.yml mist attestatie.bot; zonder bekende bot geen beoordeling.");
    return 1;
  }
  const pr = await leesPullRequest(token, slug, nummer);
  if (typeof pr === "string") {
    console.error(`jarvis v3 beoordeel-pr: ${pr}`);
    return 1;
  }
  const commits = await leesAllePaginas<{ sha: string; commit: { message: string }; parents: unknown[] }>(token, `/repos/${slug}/pulls/${nummer}/commits`, 5);
  const bestanden = await leesAllePaginas<{ filename: string; previous_filename?: string | null; status: string }>(token, `/repos/${slug}/pulls/${nummer}/files`, 10);
  if (typeof commits === "string" || typeof bestanden === "string") {
    console.error(`jarvis v3 beoordeel-pr: ${typeof commits === "string" ? commits : bestanden}`);
    return 1;
  }
  const t = takenUitCommits(commits.map((c) => ({ sha: c.sha, boodschap: c.commit.message, ouders: c.parents.length })));
  // Ook het OUDE pad van een hernoeming of kopie: anders verplaatst een PR een beschermd bestand naar elders.
  const namen = geraaktePaden(bestanden);
  // De inhoud van migraties wordt altijd van de kop gelezen, nooit aangenomen.
  const migratieBestanden: { pad: string; sql: string | null }[] = [];
  for (const b of bestanden) {
    if (!MIGRATIE_PAD.test(b.filename) || b.status === "removed") continue;
    const inhoud = await github(token, "GET", `/repos/${slug}/contents/${padNaarUrl(b.filename)}?ref=${pr.kop}`);
    const l = inhoud.lading as { content?: string; encoding?: string } | null;
    migratieBestanden.push({ pad: b.filename, sql: inhoud.status === 200 && l?.encoding === "base64" && typeof l.content === "string" ? Buffer.from(l.content, "base64").toString("utf8") : null });
  }
  const prRaw = (await github(token, "GET", `/repos/${slug}/pulls/${nummer}`)).lading as { body?: string | null; merged?: boolean; merge_commit_sha?: string | null } | null;

  const { mandaat, toestand, go } = await met(async (sql) => {
    const taak = t.taken[0];
    const werk = taak === undefined ? [] : await sql.unsafe(V3_WERK_SQL, [taak]);
    const toets = await sql.unsafe(V3_TOETSING_GO_SQL, [slug, nummer, pr.kop]);
    return { mandaat: mandaatUitRij(werk[0]), toestand: (werk[0]?.["toestand"] as string | undefined) ?? null, go: toets.length > 0 };
  });
  const poort = laatstePerNaam(pr.checks).filter((c) => c.naam === VERPLICHTE_CHECK);
  const f: V3PrFeiten = {
    repo: slug,
    nummer,
    kop: pr.kop,
    basis: pr.basis,
    auteur: pr.auteur,
    botLogin: bot,
    taken: t.taken,
    taakRedenen: t.redenen,
    bestanden: namen,
    extraPaden: config.ok ? config.config.attestatie.extra_paden : [],
    migratieBestanden,
    mandaat,
    taakToestand: toestand,
    toetsingGoOpKop: go,
    poortGroen: poort.length > 0 && poort.every((c) => c.status === "completed" && c.conclusie === "success"),
    prTekst: prRaw?.body ?? "",
  };
  const redenen = beoordeelV3Pr(f);
  if (redenen.length > 0) {
    for (const r of redenen) console.error(`jarvis v3 beoordeel-pr: ${r}`);
    console.error(`jarvis v3 beoordeel-pr: #${nummer} op ${pr.kop.slice(0, 7)} valt niet binnen het mandaat.`);
    // Een eerder gegeven goedkeuring van de poort op deze kop mag niet blijven staan (bijv. na een NO-GO).
    await trekGoedkeuringIn(token, slug, nummer, pr.kop);
    return 3;
  }
  const taak = f.taken[0]!;
  // Een pull request die al is samengevoegd (door deze sweep in een eerdere ronde, of door de eigenaar):
  // alleen nog vastleggen. De beoordeling hierboven (paden, repo, migraties, GO op de kop) is dan al gedaan.
  if (prRaw?.merged === true && typeof prRaw.merge_commit_sha === "string") {
    return await leggSamengevoegdVast(taak, slug, nummer, pr.kop, prRaw.merge_commit_sha);
  }
  const uitrol = magUitrollen(mandaat!, namen);
  if (!uitrol.samenvoegen) {
    // productie: false. De poort keurt NIET goed: een goedkeuring van de bot zou de samenvoegregel van de
    // repository vervullen, en dan kon de uitvoerder zelf samenvoegen. Samenvoegen is dan aan de eigenaar.
    console.log(`jarvis v3 beoordeel-pr: #${nummer} valt binnen het mandaat; niet goedgekeurd en niet samengevoegd: ${uitrol.reden}`);
    return (await trekGoedkeuringIn(token, slug, nummer, pr.kop)) ? 0 : 1;
  }
  const tekst = `Attestatie V3: ${taak} — binnen het mandaat, toetsing GO en poort groen op ${pr.kop.slice(0, 7)}.`;
  // Eerst kijken of samenvoegen nu kan; pas dan goedkeuren. Een goedkeuring blijft zo niet staan op een pull request
  // dat nog niet samenvoegbaar is (de uitvoerder zou daar zelf mee kunnen samenvoegen).
  if (samenvoegen) {
    const vers = await leesPullRequest(token, slug, nummer);
    if (typeof vers === "string") {
      console.error(`jarvis v3 beoordeel-pr: ${vers}`);
      return 1;
    }
    if (vers.kop !== pr.kop) {
      console.error("jarvis v3 beoordeel-pr: de kop is veranderd na de beoordeling; niet samengevoegd.");
      return 1;
    }
    if (!vers.open || vers.concept || vers.samenvoegbaar !== true || !["clean", "has_hooks", "blocked"].includes(vers.samenvoegStaat)) {
      // `blocked`: GitHub meldt dat zo zolang de verplichte goedkeuring ontbreekt, dus dat is juist onze beurt. Is er nog iets
      // anders mis, dan weigert het samenvoegen zelf en trekt de poort de goedkeuring in dezelfde ronde weer in.
      console.log(`jarvis v3 beoordeel-pr: nog niet samenvoegbaar (staat: ${vers.samenvoegStaat}); niet goedgekeurd; een volgende ronde probeert opnieuw.`);
      return (await trekGoedkeuringIn(token, slug, nummer, pr.kop)) ? 0 : 1;
    }
  }
  const al = pr.reviews.some((r) => r.staat === "APPROVED" && r.commit === pr.kop && r.tekst === tekst);
  let goedgekeurd = al;
  try {
    if (!al) {
      const review = await github(token, "POST", `/repos/${slug}/pulls/${nummer}/reviews`, { commit_id: pr.kop, event: "APPROVE", body: tekst });
      if (review.status !== 200) {
        console.error(`jarvis v3 beoordeel-pr: review afgeven mislukt (${foutTekst(review)})`);
        return 1;
      }
      goedgekeurd = true;
    }
    console.log(`jarvis v3 beoordeel-pr: ${tekst}`);
    if (!samenvoegen) return 0;
    // Vlak voor het samenvoegen opnieuw: een NO-GO die na de beoordeling is geschreven telt nog.
    const nogGo = (await met(async (sql) => await sql.unsafe(V3_TOETSING_GO_SQL, [slug, nummer, pr.kop]))).length > 0;
    if (!nogGo) {
      console.error(`jarvis v3 beoordeel-pr: #${nummer}: de toetsing op ${pr.kop.slice(0, 7)} is niet meer GO; niet samengevoegd, goedkeuring ingetrokken.`);
      await trekGoedkeuringIn(token, slug, nummer, pr.kop);
      return 3;
    }
    const samen = await github(token, "PUT", `/repos/${slug}/pulls/${nummer}/merge`, { merge_method: SAMENVOEGMETHODE, sha: pr.kop });
    if (samen.status !== 200) {
      console.error(`jarvis v3 beoordeel-pr: samenvoegen mislukte (${foutTekst(samen)}).`);
      await trekGoedkeuringIn(token, slug, nummer, pr.kop);
      return 1;
    }
    const mergeSha0 = (samen.lading as { sha?: string } | null)?.sha ?? "";
    console.log(`jarvis v3 beoordeel-pr: #${nummer} samengevoegd binnen het mandaat (${uitrol.reden}).`);
    return await leggSamengevoegdVast(taak, slug, nummer, pr.kop, mergeSha0);
  } catch (fout) {
    if (goedgekeurd) await trekGoedkeuringIn(token, slug, nummer, pr.kop);
    throw fout;
  }
}

/** Trekt elke goedkeuring van de poort (reviews met de attestatietekst van deze poort) op precies deze kop in. Best effort: een mislukking wordt gemeld, de afwijzing blijft staan. */
async function trekGoedkeuringIn(token: string, slug: string, nummer: number, kop: string): Promise<boolean> {
  const lijst = await leesAllePaginas<{ id: number; state: string; commit_id: string; body: string | null }>(token, `/repos/${slug}/pulls/${nummer}/reviews`, 10);
  if (typeof lijst === "string") {
    console.error(`jarvis v3 beoordeel-pr: reviews niet te lezen om de goedkeuring in te trekken (${lijst})`);
    return false;
  }
  let gelukt = true;
  for (const r of lijst) {
    if (r.state !== "APPROVED" || r.commit_id !== kop || !(r.body ?? "").startsWith("Attestatie V3:")) continue;
    const uit = await github(token, "PUT", `/repos/${slug}/pulls/${nummer}/reviews/${r.id}/dismissals`, { message: "Jarvis V3: niet meer binnen het mandaat of toetsing niet meer GO.", event: "DISMISS" });
    if (uit.status !== 200) {
      console.error(`jarvis v3 beoordeel-pr: goedkeuring intrekken mislukt (${foutTekst(uit)})`);
      gelukt = false;
    }
  }
  return gelukt;
}

/** Legt vast (als de CI-identiteit) dat de pull request is samengevoegd: de taak gaat naar UITROL. */
async function leggSamengevoegdVast(taak: string, slug: string, nummer: number, kop: string, mergeSha: string): Promise<number> {
  try {
    await met(async (sql) => {
      await sql.unsafe(v3Aanroep("ci_samengevoegd", ["text", "text", "int", "text", "text"], "naar"), [taak, slug, nummer, kop, mergeSha]);
    });
    console.log(`jarvis v3 beoordeel-pr: ${taak} → UITROL (samengevoegd #${nummer}).`);
    return 0;
  } catch (fout) {
    console.error(`jarvis v3 beoordeel-pr: samenvoegen vastleggen mislukte: ${fout instanceof Error ? fout.message : String(fout)}`);
    return 1;
  }
}

// ------------------------------------------------------------ eindcontrole

/** Staat `kandidaat` op of voor `main` na `basis`? Via de compare-API van GitHub; zonder token of bij een fout: nee. */
async function isNazaatVan(slug: string, basis: string, kandidaat: string): Promise<boolean> {
  const token = (process.env.GITHUB_TOKEN ?? "").trim();
  if (!token) return false;
  const a = await github(token, "GET", `/repos/${slug}/compare/${basis}...${kandidaat}`);
  if (a.status !== 200) return false;
  const status = (a.lading as { status?: string } | null)?.status;
  return status === "ahead" || status === "identical";
}

/**
 * De eindcontrole draait in de CI (rol jarvis_ci), niet in de sessie van de uitvoerder: alleen die rol kan
 * KLAAR vastleggen (v3_ci_eindcontrole). Elk criterium van het mandaat wordt hier gemeten op de echte
 * omgeving. Het bouwmerk moet de samenvoegcommit zijn die de CI zelf heeft vastgelegd.
 */
async function eindcontrole(): Promise<number> {
  return await met(async (sql) => {
    const taken = await sql.unsafe(V3_ACTUEEL_SQL);
    const aanDeBeurt = taken.filter((t) => t["toestand"] === "EINDCONTROLE");
    console.log(`jarvis v3 eindcontrole: ${aanDeBeurt.length} taak/taken in EINDCONTROLE.`);
    let code = 0;
    for (const t of aanDeBeurt) {
      const id = String(t["id"]);
      const werk = (await sql.unsafe(V3_WERK_SQL, [id]))[0];
      const m = mandaatUitRij(werk);
      if (m === null) {
        console.error(`jarvis v3 eindcontrole: ${id} heeft geen mandaat.`);
        code = 1;
        continue;
      }
      const pr = (werk?.["pr"] ?? null) as { merge_sha?: string; repo?: string } | null;
      const verwacht = pr?.merge_sha ?? null;
      const meting: { criterium: string; uitkomst: string; bewijs: string; gemeten_op: string }[] = [];
      for (const c of m.acceptatie) {
        let uit: { geslaagd: boolean; bewijs: string };
        if (c.meting.soort === "http") {
          try {
            const a = await fetch(c.meting.url, { redirect: "follow", headers: { "User-Agent": "jarvis-v3-eindcontrole", "Cache-Control": "no-cache" } });
            const tekst = await a.text();
            // Draait productie op een latere commit dan de samenvoeging, dan is het bouwmerk een nazaat daarvan.
            const gevonden = c.meting.bouwmerk ? leesBouwmerkUitPagina(tekst) : null;
            let nazaat = false;
            if (gevonden !== null && verwacht !== null && !(verwacht.startsWith(gevonden) || gevonden.startsWith(verwacht)) && pr?.repo) {
              nazaat = await isNazaatVan(pr.repo, verwacht, gevonden);
            }
            uit = beoordeelHttpMeting(c.meting, { status: a.status, tekst }, verwacht, () => nazaat);
          } catch (fout) {
            uit = { geslaagd: false, bewijs: `niet bereikbaar: ${fout instanceof Error ? fout.message : String(fout)}` };
          }
        } else {
          uit = { geslaagd: false, bewijs: `meting van soort ${c.meting.soort} is in deze versie nog niet gebouwd` };
        }
        meting.push({ criterium: c.id, uitkomst: uit.geslaagd ? "geslaagd" : "mislukt", bewijs: uit.bewijs, gemeten_op: new Date().toISOString() });
        console.log(`jarvis v3 eindcontrole: ${id} ${c.id} ${uit.geslaagd ? "geslaagd" : "MISLUKT"} — ${uit.bewijs}`);
      }
      const r = await sql.unsafe(v3Aanroep("ci_eindcontrole", ["text", "json"], "naar"), [id, JSON.stringify(meting)]);
      console.log(`jarvis v3 eindcontrole: ${id} → ${String(r[0]?.["naar"])}`);
    }
    return code;
  });
}

// ------------------------------------------------------------- dispatcher

/**
 * Start de routine via de API van het platform. Het token staat uitsluitend in
 * JARVIS_ROUTINE_TOKEN (een GitHub-secret) en wordt alleen in de
 * Authorization-header gezet: nooit in een argument, nooit in uitvoer.
 * De exacte URL komt uit JARVIS_ROUTINE_FIRE_URL (de "Call via API"-opdracht
 * van de routine), zodat een wijziging van het platform geen codewijziging is.
 */
async function dispatch(droog: boolean): Promise<number> {
  return await met(async (sql) => {
    const werk = (await sql.unsafe(v3Aanroep("watchdog", []))) as unknown as WerkRij[];
    const besluit = dispatchBesluit(werk, null, new Date());
    console.log(`jarvis v3 dispatch: ${besluit.reden}`);
    if (!besluit.start) return 0;
    const claim = await sql.unsafe(v3Aanroep("dispatch_claim", ["int"], "ok"), [20]);
    if (claim[0]?.["ok"] !== true) {
      console.log("jarvis v3 dispatch: er is net een start gedaan; geen tweede.");
      return 0;
    }
    if (droog) {
      console.log("jarvis v3 dispatch: droog — niet gestart.");
      return 0;
    }
    const url = (process.env.JARVIS_ROUTINE_FIRE_URL ?? "").trim();
    const token = (process.env.JARVIS_ROUTINE_TOKEN ?? "").trim();
    if (!url || !token) {
      console.error("jarvis v3 dispatch: JARVIS_ROUTINE_FIRE_URL en JARVIS_ROUTINE_TOKEN ontbreken als secrets; niet gestart.");
      return 1;
    }
    const antwoord = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ text: `V3-dispatch: ${besluit.reden}` }),
    });
    console.log(`jarvis v3 dispatch: routine gestart? HTTP ${antwoord.status}`);
    return antwoord.ok ? 0 : 1;
  });
}

// ------------------------------------------------------------------- sweep

/** Loopt alle open Jarvis-pull requests van de bot langs; idempotent en veilig om vaak te draaien. */
async function sweep(slug: string): Promise<number> {
  const token = (process.env.GITHUB_TOKEN ?? "").trim();
  if (!token) {
    console.error("jarvis v3 sweep: geen GITHUB_TOKEN.");
    return 1;
  }
  const wortel = (await vindWortel(process.cwd())) ?? process.cwd();
  const config = await laadConfig(wortel);
  const bot = config.ok ? config.config.attestatie.bot : "";
  if (!bot) {
    console.error("jarvis v3 sweep: jarvis.config.yml mist attestatie.bot.");
    return 1;
  }
  const lijst = await leesAllePaginas<{ number: number; draft: boolean; user: { login: string }; head: { ref: string } }>(token, `/repos/${slug}/pulls?state=open`, 3);
  if (typeof lijst === "string") {
    console.error(`jarvis v3 sweep: ${lijst}`);
    return 1;
  }
  const mijn = lijst.filter((p) => p.user.login.toLowerCase() === bot.toLowerCase() && p.head.ref.startsWith("jarvis/"));
  // Herstel: recent samengevoegde pull requests van de bot waarvan het vastleggen (nog) niet is gelukt,
  // of die de eigenaar zelf heeft samengevoegd (productie: false).
  const gesloten = await leesAllePaginas<{ number: number; merged_at: string | null; user: { login: string }; head: { ref: string }; base: { ref: string } }>(token, `/repos/${slug}/pulls?state=closed&sort=updated&direction=desc`, 1);
  const drieDagen = Date.now() - 3 * 24 * 3600 * 1000;
  const samengevoegd = typeof gesloten === "string" ? [] : gesloten.filter((p) =>
    p.merged_at !== null && Date.parse(p.merged_at) > drieDagen && p.base.ref === "main" &&
    p.user.login.toLowerCase() === bot.toLowerCase() && p.head.ref.startsWith("jarvis/"));
  for (const p of samengevoegd) {
    const commits = await leesAllePaginas<{ sha: string; commit: { message: string }; parents: unknown[] }>(token, `/repos/${slug}/pulls/${p.number}/commits`, 5);
    if (typeof commits === "string") continue;
    const taak = takenUitCommits(commits.map((c) => ({ sha: c.sha, boodschap: c.commit.message, ouders: c.parents.length }))).taken[0];
    if (taak === undefined || !/^V3-\d{8}-/.test(taak)) continue;
    const rij = await met(async (sql) => (await sql.unsafe(V3_WERK_SQL, [taak]))[0]);
    if (!["UITVOEREN", "CONTROLE"].includes(String(rij?.["toestand"]))) continue;
    // Al vastgelegd voor deze taak (bijvoorbeeld voor een eindcontrole die daarna mislukte): niet opnieuw.
    const vast = (rij?.["pr"] ?? null) as { nummer?: number; repo?: string; merge_sha?: string } | null;
    if (vast?.merge_sha && vast.nummer === p.number && String(vast.repo).toLowerCase() === slug.toLowerCase()) continue;
    const code = await beoordeelPr(p.number, slug, false);
    console.log(`jarvis v3 sweep: samengevoegde #${p.number} vastleggen → ${code === 0 ? "gedaan" : "niet gelukt"}`);
  }
  console.log(`jarvis v3 sweep: ${mijn.length} open pull request(s) van de bot in ${slug}.`);
  let uit = 0;
  for (const p of mijn) {
    // Een concept wordt niet beoordeeld en mag geen staande goedkeuring van de poort houden (bijv. na NO-GO,
    // en daarna weer "klaar voor review" zetten). Elke uitkomst behalve "in orde" trekt de goedkeuring ook in;
    // een fout of uitzondering telt als weigering.
    let code = 1;
    if (!p.draft) {
      try {
        code = await beoordeelPr(p.number, slug, true);
      } catch (fout) {
        console.error(`jarvis v3 sweep: #${p.number}: ${fout instanceof Error ? fout.message : String(fout)}`);
      }
    } else {
      code = 3;
    }
    if (code !== 0) {
      const vers = await leesPullRequest(token, slug, p.number);
      if (typeof vers === "string") uit = 1;
      else if (vers.open && !(await trekGoedkeuringIn(token, slug, p.number, vers.kop))) uit = 1;
    }
    console.log(`jarvis v3 sweep: #${p.number} → ${code === 0 ? "in orde" : code === 3 ? "valt (nog) niet binnen het mandaat" : "fout"}`);
  }
  return uit;
}

// ---------------------------------------------------------------- migraties

export type MigratieBestand = { readonly pad: string; readonly sql: string };

/** Versienummer voor het ledger: tijdstip van toepassing, zoals het productieledger het al kent. */
export function ledgerVersie(nu: Date): string {
  return nu.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/**
 * De gecontroleerde migratieroute. Draait uitsluitend in CI (een GitHub-omgeving met een eigen rol die
 * alleen kan wat een migratie nodig heeft), nooit in de sessie van de uitvoerder: Jarvis ziet de
 * verbindingsreeks nooit.
 *
 * Twee manieren om aan te wijzen WAT er toegepast wordt, met dezelfde controles daarna:
 *   - `migreer --repo X` (de gewone weg): uit de database. Elke taak met een mandaat dat migraties toestaat en
 *     met een vastgelegde samenvoeging (`pr.merge_sha`, vastgelegd door de CI) heeft nieuwe migratiebestanden in
 *     die pull request. Dit hangt NIET af van een `push`-event: een merge via GITHUB_TOKEN (de sweep) start
 *     geen push-workflow, en juist dat is het geval waar autonome migratie voor bedoeld is.
 *   - `migreer --repo X --basis A --kop B`: een expliciete reeks commits (handmatig of voor herstel).
 */
async function migreerGegevens(): Promise<{ token: string; dbUrl: string; ledger: string } | string> {
  const token = (process.env.GITHUB_TOKEN ?? "").trim();
  const dbUrl = (process.env.JARVIS_MIGRATIE_DB_URL ?? "").trim();
  const ledger = (process.env.JARVIS_MIGRATIE_LEDGER ?? "").trim();
  if (!token) return "geen GITHUB_TOKEN.";
  return { token, dbUrl, ledger };
}
const LEDGER_PATROON = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

/** Beoordeelt en past de migratiebestanden van één taak toe. Exitcode 0, 1 (fout) of 3 (geweigerd). */
async function migreerBestanden(o: {
  readonly token: string;
  readonly dbUrl: string;
  readonly ledger: string;
  readonly slug: string;
  readonly taak: string;
  readonly rij: Record<string, unknown> | undefined;
  readonly toegestaneToestanden: readonly string[];
  readonly bestandsnamen: readonly string[];
  readonly ref: string;
  readonly droog: boolean;
}): Promise<number> {
  const { token, dbUrl, ledger, slug, taak, rij, droog } = o;
  const m = mandaatUitRij(rij);
  if (m === null) {
    console.error(`jarvis v3 migreer: geen mandaat voor ${taak}.`);
    return 3;
  }
  if (!o.toegestaneToestanden.includes(String(rij?.["toestand"]))) {
    console.error(`jarvis v3 migreer: ${taak} staat in ${String(rij?.["toestand"])}; migraties worden alleen toegepast na samenvoegen (${o.toegestaneToestanden.join(", ")}).`);
    return 3;
  }
  const bestanden: { pad: string; sql: string }[] = [];
  for (const pad of o.bestandsnamen) {
    const inhoud = await github(token, "GET", `/repos/${slug}/contents/${padNaarUrl(pad)}?ref=${o.ref}`);
    const l = inhoud.lading as { content?: string; encoding?: string } | null;
    if (inhoud.status !== 200 || l?.encoding !== "base64" || typeof l.content !== "string") {
      console.error(`jarvis v3 migreer: ${pad} niet te lezen.`);
      return 1;
    }
    bestanden.push({ pad, sql: Buffer.from(l.content, "base64").toString("utf8") });
  }
  const oordeel = beoordeelMigraties(m, bestanden, ledger);
  if (oordeel.length > 0) {
    for (const x of oordeel) console.error(`jarvis v3 migreer: ${x.pad}: ${x.redenen.join("; ")}`);
    return 3;
  }
  bestanden.sort((a, b) => a.pad.localeCompare(b.pad));
  if (droog) {
    console.log(`jarvis v3 migreer: droog — ${bestanden.length} migratie(s) zouden worden toegepast voor ${taak}: ${bestanden.map((b) => b.pad).join(", ")}`);
    return 0;
  }
  if (!dbUrl || !LEDGER_PATROON.test(ledger)) {
    console.error("jarvis v3 migreer: JARVIS_MIGRATIE_DB_URL en JARVIS_MIGRATIE_LEDGER (schema.tabel) ontbreken; niets toegepast.");
    return 1;
  }
  const { default: postgres } = await import("postgres");
  const db = postgres(dbUrl, { max: 1, prepare: false, connect_timeout: 15 });
  try {
    // Least privilege, afgedwongen: de migratierol mag het schema van Jarvis niet kunnen gebruiken en geen
    // lid zijn van zijn eigenaar. De SQL-controle is een tweede laag; deze laag houdt stand als die een gat heeft.
    const rechten = await db.unsafe(
      "select exists (select 1 from pg_namespace where nspname = 'jarvis') as bestaat, " +
        "coalesce(has_schema_privilege(current_user, 'jarvis', 'USAGE'), false) as gebruik, " +
        "coalesce(pg_has_role(current_user, (select nspowner from pg_namespace where nspname = 'jarvis'), 'MEMBER'), false) as lid, " +
        // Standaardrechten van de migratierol zelf die nieuwe tabellen/sequenties aan een andere rol (of PUBLIC) geven:
        // dan wordt elk nieuw object (ook een kopie van bestaande rijen) direct leesbaar voor die rol.
        "exists (select 1 from pg_default_acl d where d.defaclrole = (select oid from pg_roles where rolname = current_user) " +
        "and d.defaclobjtype in ('r', 'S') and exists (select 1 from aclexplode(d.defaclacl) a where a.grantee <> d.defaclrole)) as standaardrechten",
    );
    if (rechten[0]?.["standaardrechten"] === true) {
      console.error("jarvis v3 migreer: de migratierol heeft standaardrechten die nieuwe tabellen aan andere rollen geven; niets toegepast. Haal die ALTER DEFAULT PRIVILEGES weg.");
      return 1;
    }
    if (rechten[0]?.["bestaat"] === true && (rechten[0]?.["gebruik"] === true || rechten[0]?.["lid"] === true)) {
      console.error("jarvis v3 migreer: de migratierol kan het schema jarvis gebruiken of is lid van zijn eigenaar; niets toegepast. Gebruik een rol die alleen de productietabellen mag wijzigen.");
      return 1;
    }
    for (const b of bestanden) {
      const naam = b.pad.split("/").pop()!.replace(/\.sql$/, "");
      const bestaat = await db.unsafe(`select 1 from ${ledger} where name = $1`, [naam]);
      if (bestaat.length > 0) {
        console.log(`jarvis v3 migreer: ${naam} staat al in het ledger; overgeslagen.`);
        continue;
      }
      // Precies de SQL die is beoordeeld: zonder eigen begin/commit-omhulling, in één transactie met de ledgerregel.
      const uit = normaliseerMigratie(b.sql);
      await db.begin(async (tx) => {
        await tx.unsafe(uit);
        await tx.unsafe(`insert into ${ledger} (version, name, statements) values ($1, $2, $3)`, [ledgerVersie(new Date()), naam, [uit]]);
      });
      console.log(`jarvis v3 migreer: ${naam} toegepast voor ${taak}.`);
    }
  } finally {
    await db.end({ timeout: 2 });
  }
  return 0;
}

/** Expliciete reeks commits (`--basis`/`--kop`). */
async function migreer(slug: string, basis: string, kop: string, droog: boolean): Promise<number> {
  const g = await migreerGegevens();
  if (typeof g === "string") {
    console.error(`jarvis v3 migreer: ${g}`);
    return 1;
  }
  const vergelijk = await github(g.token, "GET", `/repos/${slug}/compare/${basis}...${kop}`);
  if (vergelijk.status !== 200) {
    console.error(`jarvis v3 migreer: vergelijking niet te lezen (${foutTekst(vergelijk)})`);
    return 1;
  }
  const v = vergelijk.lading as { files?: { filename: string; status: string }[]; commits?: { commit: { message: string }; parents: unknown[] }[] };
  const migraties = (v.files ?? []).filter((f) => MIGRATIE_PAD.test(f.filename));
  if (migraties.length === 0) {
    console.log("jarvis v3 migreer: geen migraties in deze reeks.");
    return 0;
  }
  const niet_nieuw = migraties.filter((f) => f.status !== "added");
  if (niet_nieuw.length > 0) {
    console.error(`jarvis v3 migreer: alleen nieuwe migraties worden toegepast; gewijzigd of verwijderd: ${niet_nieuw.map((f) => f.filename).join(", ")}`);
    return 3;
  }
  const t = takenUitCommits((v.commits ?? []).map((c, i) => ({ sha: String(i), boodschap: c.commit.message, ouders: c.parents.length })));
  if (t.taken.length !== 1) {
    console.error(`jarvis v3 migreer: een migratiereeks hoort bij precies één V3-taak (gevonden: ${t.taken.join(", ") || "geen"}).`);
    return 3;
  }
  const taak = t.taken[0]!;
  const rij = await met(async (sql) => (await sql.unsafe(V3_WERK_SQL, [taak]))[0]);
  return await migreerBestanden({ ...g, slug, taak, rij, toegestaneToestanden: ["CONTROLE", "UITROL"], bestandsnamen: migraties.map((f) => f.filename), ref: kop, droog });
}

/** De gewone weg: elke taak met een vastgelegde samenvoeging en een mandaat dat migraties toestaat. */
async function migreerUitstaand(slug: string, droog: boolean): Promise<number> {
  const g = await migreerGegevens();
  if (typeof g === "string") {
    console.error(`jarvis v3 migreer: ${g}`);
    return 1;
  }
  const taken = await met(async (sql) => {
    const lijst = await sql.unsafe(V3_ACTUEEL_SQL);
    const uit: Record<string, unknown>[] = [];
    for (const t of lijst) {
      if (!["UITVOEREN", "UITROL", "EINDCONTROLE"].includes(String(t["toestand"]))) continue;
      const rij = (await sql.unsafe(V3_WERK_SQL, [String(t["id"])]))[0];
      if (rij !== undefined) uit.push(rij);
    }
    return uit;
  });
  let code = 0;
  let gedaan = 0;
  for (const rij of taken) {
    const m = mandaatUitRij(rij);
    const pr = (rij["pr"] ?? null) as { repo?: string; nummer?: number; merge_sha?: string } | null;
    if (m === null || !m.migraties || !pr?.merge_sha || !pr.nummer || String(pr.repo).toLowerCase() !== slug.toLowerCase()) continue;
    const taak = String(rij["id"]);
    // Wat de database zegt, wordt bij GitHub nagegaan: de pull request is werkelijk samengevoegd, in main, tot
    // precies deze samenvoegcommit, en hoort bij deze taak. Een vervalst of verouderd `merge_sha` leidt tot niets.
    const prInfo = await github(g.token, "GET", `/repos/${slug}/pulls/${pr.nummer}`);
    const pl = prInfo.lading as { merged?: boolean; merge_commit_sha?: string | null; base?: { ref?: string } } | null;
    if (prInfo.status !== 200 || pl?.merged !== true || !pl.merge_commit_sha || pl.merge_commit_sha.toLowerCase() !== pr.merge_sha.toLowerCase() || pl.base?.ref !== "main") {
      console.error(`jarvis v3 migreer: ${taak}: pull request #${pr.nummer} is bij GitHub niet samengevoegd in main met de vastgelegde samenvoegcommit; niets toegepast.`);
      code = Math.max(code, 3);
      continue;
    }
    const prCommits = await leesAllePaginas<{ sha: string; commit: { message: string }; parents: unknown[] }>(g.token, `/repos/${slug}/pulls/${pr.nummer}/commits`, 5);
    if (typeof prCommits === "string" || !takenUitCommits(prCommits.map((c) => ({ sha: c.sha, boodschap: c.commit.message, ouders: c.parents.length }))).taken.includes(taak)) {
      console.error(`jarvis v3 migreer: ${taak}: pull request #${pr.nummer} hoort volgens zijn commits niet bij deze taak; niets toegepast.`);
      code = Math.max(code, 3);
      continue;
    }
    const bestanden = await leesAllePaginas<{ filename: string; previous_filename?: string | null; status: string }>(g.token, `/repos/${slug}/pulls/${pr.nummer}/files`, 10);
    if (typeof bestanden === "string") {
      console.error(`jarvis v3 migreer: ${taak}: ${bestanden}`);
      code = Math.max(code, 1);
      continue;
    }
    const raakt = bestanden.filter((f) => MIGRATIE_PAD.test(f.filename) || (f.previous_filename ? MIGRATIE_PAD.test(f.previous_filename) : false));
    if (raakt.length === 0) continue;
    const niet_nieuw = raakt.filter((f) => f.status !== "added");
    if (niet_nieuw.length > 0) {
      console.error(`jarvis v3 migreer: ${taak}: alleen nieuwe migraties worden toegepast; gewijzigd, hernoemd of verwijderd: ${niet_nieuw.map((f) => f.filename).join(", ")}`);
      code = Math.max(code, 3);
      continue;
    }
    gedaan += 1;
    const c = await migreerBestanden({ ...g, slug, taak, rij, toegestaneToestanden: ["UITVOEREN", "UITROL", "EINDCONTROLE"], bestandsnamen: raakt.map((f) => f.filename), ref: pr.merge_sha, droog });
    code = Math.max(code, c);
  }
  console.log(`jarvis v3 migreer: ${gedaan} taak/taken met migraties beoordeeld.`);
  return code;
}

// -------------------------------------------------------------------- main

export async function voerV3Uit(argv: readonly string[]): Promise<number> {
  const { opdracht: wat, vlaggen, losse, dubbel } = leesArgumenten(argv);
  if (dubbel.length > 0) {
    console.error(dubbel.map((n) => `jarvis v3: de vlag --${n} is meer dan een keer meegegeven.`).join("\n"));
    return 2;
  }
  try {
    const wortel = (await vindWortel(process.cwd())) ?? process.cwd();
    const stand = await v3Ingeschakeld(wortel);
    if (!stand.aan) {
      console.error(`jarvis v3: ${stand.reden}.`);
      return 1;
    }
    const taak = losse[0] ?? "";
    switch (wat) {
      case "nieuw":
        return await met(async (sql) => {
          const r = await sql.unsafe(v3Aanroep("nieuwe_taak", ["text", "text", "text", "text"], "id"), [
            vereist(vlaggen, "id"), vereist(vlaggen, "titel"), vereist(vlaggen, "opdracht"), vlaggen.get("bron") ?? null,
          ]);
          console.log(JSON.stringify(r[0]));
          return 0;
        });
      case "pak":
        return await met(async (sql) => {
          const r = await sql.unsafe(v3Aanroep("pak", ["text", "text", "int"], "ok"), [taak, vereist(vlaggen, "door"), 40]);
          console.log(JSON.stringify(r[0]));
          return r[0]?.["ok"] === true ? 0 : 3;
        });
      case "hartslag":
        return await met(async (sql) => {
          const r = await sql.unsafe(v3Aanroep("hartslag", ["text", "text", "int"], "ok"), [taak, vereist(vlaggen, "door"), 40]);
          return r[0]?.["ok"] === true ? 0 : 3;
        });
      case "blokkade":
        return await met(async (sql) => {
          await sql.unsafe(v3Aanroep("blokkade", ["text", "text", "text"]), [taak, vereist(vlaggen, "door"), vlaggen.get("tekst") ?? ""]);
          return 0;
        });
      case "overgang": {
        const naar = vereist(vlaggen, "naar");
        if (!(TOESTANDEN as readonly string[]).includes(naar)) throw new Error(`--naar moet een van ${TOESTANDEN.join(", ")} zijn`);
        return await met(async (sql) => {
          const r = await sql.unsafe(v3Aanroep("overgang", ["text", "text", "text", "json"], "naar"), [
            taak, vereist(vlaggen, "door"), naar, JSON.stringify(json(vlaggen.get("bewijs"), "bewijs") ?? {}),
          ]);
          console.log(JSON.stringify(r[0]));
          return 0;
        });
      }
      case "vraag-akkoord": {
        const voorstel = JSON.parse(await readFile(vereist(vlaggen, "voorstel"), "utf8")) as unknown;
        return await met(async (sql) => {
          const r = await sql.unsafe(v3Aanroep("vraag_akkoord", ["text", "json"], "id"), [taak, JSON.stringify(voorstel)]);
          console.log(JSON.stringify(r[0]));
          return 0;
        });
      }
      case "vraag":
        return await met(async (sql) => {
          const r = await sql.unsafe(v3Aanroep("vraag", ["text", "text", "text", "text", "json", "json"]), [
            taak, vereist(vlaggen, "type"), vereist(vlaggen, "sleutel"), vereist(vlaggen, "vraag"),
            vlaggen.has("opties") ? JSON.stringify(json(vlaggen.get("opties"), "opties")) : null,
            vlaggen.has("verificatie") ? JSON.stringify(json(vlaggen.get("verificatie"), "verificatie")) : null,
          ]);
          console.log(JSON.stringify(r[0]));
          return 0;
        });
      case "meet":
        return await met(async (sql) => {
          const r = await sql.unsafe(v3Aanroep("meet_verzoek", ["uuid", "json"], "status"), [taak, JSON.stringify(json(vereist(vlaggen, "uitkomst"), "uitkomst"))]);
          console.log(JSON.stringify(r[0]));
          return 0;
        });
      case "werk":
        return await met(async (sql) => {
          const werk = taak ? await sql.unsafe(V3_WERK_SQL, [taak]) : await sql.unsafe(V3_ACTUEEL_SQL);
          const verzoeken = taak ? await sql.unsafe(V3_VERZOEKEN_SQL, [taak]) : [];
          console.log(JSON.stringify({ werk, verzoeken }, null, 2));
          return 0;
        });
      case "status":
        return await met(async (sql) => {
          console.log(JSON.stringify(await sql.unsafe(V3_ACTUEEL_SQL), null, 2));
          return 0;
        });
      case "watchdog":
        return await met(async (sql) => {
          console.log(JSON.stringify(await sql.unsafe(v3Aanroep("watchdog", [])), null, 2));
          return 0;
        });
      // Sinds T-20261017-jarvis-vereenvoudigen roept de workflow `jarvis-v3` hiermee de kleine keten van
      // doelen aan (doelen-cli.ts). De oude V3-implementaties blijven tot fase 4 staan maar draaien niet meer.
      case "dispatch":
        return await ciDispatch(vlaggen.has("droog"));
      case "beoordeel-pr": {
        const nummer = Number.parseInt(taak, 10);
        if (!Number.isInteger(nummer) || nummer <= 0) throw new Error("gebruik: jarvis v3 beoordeel-pr <nummer> --repo <slug> [--samenvoegen]");
        return await beoordeelPr(nummer, vlaggen.get("repo") || (process.env.GITHUB_REPOSITORY ?? "").trim(), vlaggen.has("samenvoegen"));
      }
      case "sweep":
        return await ciSweep();
      case "migreer":
        return vlaggen.has("basis") || vlaggen.has("kop")
          ? await migreer(vlaggen.get("repo") || (process.env.GITHUB_REPOSITORY ?? "").trim(), vereist(vlaggen, "basis"), vereist(vlaggen, "kop"), vlaggen.has("droog"))
          : await migreerUitstaand(vlaggen.get("repo") || (process.env.GITHUB_REPOSITORY ?? "").trim(), vlaggen.has("droog"));
      case "eindcontrole":
        return await ciEindcontrole();
      default:
        console.error("jarvis v3: onbekende opdracht. Zie de kop van jarvis/src/v3-cli.ts.");
        return 2;
    }
  } catch (fout) {
    console.error(`jarvis v3 ${wat}: ${(fout instanceof Error ? fout.message : String(fout)).replace(/postgres(ql)?:\/\/\S+/gi, "<verbindingsreeks>")}`);
    return 1;
  }
}
