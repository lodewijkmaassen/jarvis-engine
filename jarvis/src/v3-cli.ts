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
//   migreer --repo <slug> --basis <sha> --kop <sha> [--droog]   de gecontroleerde migratieroute (alleen CI)
//   eindcontrole <taak> --door <naam> [--sha <commit>]    meet de acceptatiecriteria en sluit af
import { readFile } from "node:fs/promises";
import { laadConfig, vindWortel } from "./config";
import { leesArgumenten } from "./args";
import { takenUitCommits } from "./attestatie";
import {
  TOETSING_KOP_SQL,
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
  beoordeelHttpMeting,
  beoordeelV3Pr,
  dispatchBesluit,
  magUitrollen,
  beoordeelMigraties,
  MIGRATIE_PAD,
  type Criterium,
  type Mandaat,
  type V3PrFeiten,
  type WerkRij,
} from "./v3";

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
  const bestanden = await leesAllePaginas<{ filename: string; status: string }>(token, `/repos/${slug}/pulls/${nummer}/files`, 10);
  if (typeof commits === "string" || typeof bestanden === "string") {
    console.error(`jarvis v3 beoordeel-pr: ${typeof commits === "string" ? commits : bestanden}`);
    return 1;
  }
  const t = takenUitCommits(commits.map((c) => ({ sha: c.sha, boodschap: c.commit.message, ouders: c.parents.length })));
  const namen = bestanden.map((b) => b.filename);
  // De inhoud van migraties wordt altijd van de kop gelezen, nooit aangenomen.
  const migratieBestanden: { pad: string; sql: string | null }[] = [];
  for (const b of bestanden) {
    if (!MIGRATIE_PAD.test(b.filename) || b.status === "removed") continue;
    const inhoud = await github(token, "GET", `/repos/${slug}/contents/${encodeURI(b.filename)}?ref=${pr.kop}`);
    const l = inhoud.lading as { content?: string; encoding?: string } | null;
    migratieBestanden.push({ pad: b.filename, sql: inhoud.status === 200 && l?.encoding === "base64" && typeof l.content === "string" ? Buffer.from(l.content, "base64").toString("utf8") : null });
  }
  const prRaw = (await github(token, "GET", `/repos/${slug}/pulls/${nummer}`)).lading as { body?: string | null } | null;

  const { mandaat, toestand, go } = await met(async (sql) => {
    const taak = t.taken[0];
    const werk = taak === undefined ? [] : await sql.unsafe(V3_WERK_SQL, [taak]);
    const toets = await sql.unsafe(TOETSING_KOP_SQL, [slug, nummer, pr.kop]);
    return { mandaat: mandaatUitRij(werk[0]), toestand: (werk[0]?.["toestand"] as string | undefined) ?? null, go: toets.length > 0 };
  });
  const poort = laatstePerNaam(pr.checks).filter((c) => c.naam === VERPLICHTE_CHECK);
  const f: V3PrFeiten = {
    repo: slug,
    nummer,
    kop: pr.kop,
    auteur: pr.auteur,
    botLogin: bot,
    taken: t.taken,
    taakRedenen: t.redenen,
    bestanden: namen,
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
    return 3;
  }
  const tekst = `Attestatie V3: ${f.taken[0]} — binnen het mandaat, toetsing GO en poort groen op ${pr.kop.slice(0, 7)}.`;
  const al = pr.reviews.some((r) => r.staat === "APPROVED" && r.commit === pr.kop && r.tekst === tekst);
  if (!al) {
    const review = await github(token, "POST", `/repos/${slug}/pulls/${nummer}/reviews`, { commit_id: pr.kop, event: "APPROVE", body: tekst });
    if (review.status !== 200) {
      console.error(`jarvis v3 beoordeel-pr: review afgeven mislukt (${foutTekst(review)})`);
      return 1;
    }
  }
  console.log(`jarvis v3 beoordeel-pr: ${tekst}`);
  if (!samenvoegen) return 0;
  const uitrol = magUitrollen(mandaat!, namen);
  if (!uitrol.samenvoegen) {
    console.log(`jarvis v3 beoordeel-pr: niet samengevoegd: ${uitrol.reden}`);
    return 0;
  }
  const vers = await leesPullRequest(token, slug, nummer);
  if (typeof vers === "string") {
    console.error(`jarvis v3 beoordeel-pr: ${vers}`);
    return 1;
  }
  if (vers.kop !== pr.kop) {
    console.error("jarvis v3 beoordeel-pr: de kop is veranderd na de beoordeling; niet samengevoegd.");
    return 1;
  }
  if (!vers.open || vers.concept || vers.samenvoegbaar !== true || !["clean", "has_hooks"].includes(vers.samenvoegStaat)) {
    console.log(`jarvis v3 beoordeel-pr: nog niet samenvoegbaar (staat: ${vers.samenvoegStaat}); een volgende ronde probeert opnieuw.`);
    return 0;
  }
  const samen = await github(token, "PUT", `/repos/${slug}/pulls/${nummer}/merge`, { merge_method: SAMENVOEGMETHODE, sha: pr.kop });
  if (samen.status !== 200) {
    console.error(`jarvis v3 beoordeel-pr: samenvoegen mislukte (${foutTekst(samen)}).`);
    return 1;
  }
  console.log(`jarvis v3 beoordeel-pr: #${nummer} samengevoegd binnen het mandaat (${uitrol.reden}).`);
  return 0;
}

// ------------------------------------------------------------ eindcontrole

async function eindcontrole(taak: string, door: string, sha: string | null): Promise<number> {
  return await met(async (sql) => {
    const werk = (await sql.unsafe(V3_WERK_SQL, [taak]))[0];
    const m = mandaatUitRij(werk);
    if (m === null) {
      console.error("jarvis v3 eindcontrole: de taak heeft geen mandaat.");
      return 1;
    }
    const pak = await sql.unsafe(v3Aanroep("pak", ["text", "text", "int"], "ok"), [taak, door, 40]);
    if (pak[0]?.["ok"] !== true) {
      console.error("jarvis v3 eindcontrole: lease niet gekregen.");
      return 3;
    }
    const pr = (werk?.["pr"] ?? null) as { sha?: string } | null;
    const verwacht = sha ?? pr?.sha ?? null;
    const meting: { criterium: string; uitkomst: string; bewijs: string; gemeten_op: string }[] = [];
    for (const c of m.acceptatie) {
      let uit: { geslaagd: boolean; bewijs: string };
      if (c.meting.soort === "http") {
        try {
          const a = await fetch(c.meting.url, { redirect: "follow", headers: { "User-Agent": "jarvis-v3-eindcontrole", "Cache-Control": "no-cache" } });
          uit = beoordeelHttpMeting(c.meting, { status: a.status, tekst: await a.text() }, verwacht);
        } catch (fout) {
          uit = { geslaagd: false, bewijs: `niet bereikbaar: ${fout instanceof Error ? fout.message : String(fout)}` };
        }
      } else {
        uit = { geslaagd: false, bewijs: `meting van soort ${c.meting.soort} is in deze versie nog niet gebouwd` };
      }
      meting.push({ criterium: c.id, uitkomst: uit.geslaagd ? "geslaagd" : "mislukt", bewijs: uit.bewijs, gemeten_op: new Date().toISOString() });
      console.log(`jarvis v3 eindcontrole: ${c.id} ${uit.geslaagd ? "geslaagd" : "MISLUKT"} — ${uit.bewijs}`);
    }
    const alles = meting.every((x) => x.uitkomst === "geslaagd");
    const naar = alles ? "KLAAR" : "UITVOEREN";
    await sql.unsafe(v3Aanroep("overgang", ["text", "text", "text", "json"], "naar"), [taak, door, naar, JSON.stringify({ eindcontrole: meting })]);
    console.log(`jarvis v3 eindcontrole: ${taak} → ${naar}`);
    return alles ? 0 : 3;
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
  const mijn = lijst.filter((p) => !p.draft && p.user.login.toLowerCase() === bot.toLowerCase() && p.head.ref.startsWith("jarvis/"));
  console.log(`jarvis v3 sweep: ${mijn.length} open pull request(s) van de bot in ${slug}.`);
  for (const p of mijn) {
    const code = await beoordeelPr(p.number, slug, true);
    console.log(`jarvis v3 sweep: #${p.number} → ${code === 0 ? "in orde" : code === 3 ? "valt (nog) niet binnen het mandaat" : "fout"}`);
  }
  return 0;
}

// ---------------------------------------------------------------- migraties

export type MigratieBestand = { readonly pad: string; readonly sql: string };

/** Versienummer voor het ledger: tijdstip van toepassing, zoals het productieledger het al kent. */
export function ledgerVersie(nu: Date): string {
  return nu.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/**
 * De gecontroleerde migratieroute. Draait uitsluitend in CI (een
 * GitHub-omgeving met een eigen rol die alleen kan wat een migratie nodig
 * heeft), nooit in de sessie van de uitvoerder: Jarvis ziet de verbindingsreeks
 * nooit. Per toe te passen bestand, in volgorde:
 *   1. alleen NIEUW toegevoegde bestanden onder migrations/ (een gewijzigde
 *      of verwijderde migratie wordt nooit opnieuw toegepast: weigeren);
 *   2. de taak komt uit de Jarvis-Task-trailers van de samengevoegde commits;
 *   3. de taak moet KLAAR-weg zijn (UITROL) met een mandaat dat `migraties`
 *      toestaat, en bevat de SQL destructieve delen dan ook `destructief`;
 *   4. één transactie per bestand, ON_ERROR_STOP, en een regel in het ledger.
 */
async function migreer(slug: string, basis: string, kop: string, droog: boolean): Promise<number> {
  const token = (process.env.GITHUB_TOKEN ?? "").trim();
  const dbUrl = (process.env.JARVIS_MIGRATIE_DB_URL ?? "").trim();
  const ledger = (process.env.JARVIS_MIGRATIE_LEDGER ?? "").trim();
  if (!token) {
    console.error("jarvis v3 migreer: geen GITHUB_TOKEN.");
    return 1;
  }
  if (!droog && (!dbUrl || !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(ledger))) {
    console.error("jarvis v3 migreer: JARVIS_MIGRATIE_DB_URL en JARVIS_MIGRATIE_LEDGER (schema.tabel) ontbreken; niets toegepast.");
    return 1;
  }
  const vergelijk = await github(token, "GET", `/repos/${slug}/compare/${basis}...${kop}`);
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
  const m = mandaatUitRij(rij);
  if (m === null) {
    console.error(`jarvis v3 migreer: geen mandaat voor ${taak}.`);
    return 3;
  }
  if (!["CONTROLE", "UITROL"].includes(String(rij?.["toestand"]))) {
    console.error(`jarvis v3 migreer: ${taak} staat in ${String(rij?.["toestand"])}; migraties worden alleen toegepast na samenvoegen (CONTROLE of UITROL).`);
    return 3;
  }
  const bestanden: { pad: string; sql: string }[] = [];
  for (const f of migraties) {
    const inhoud = await github(token, "GET", `/repos/${slug}/contents/${encodeURI(f.filename)}?ref=${kop}`);
    const l = inhoud.lading as { content?: string; encoding?: string } | null;
    if (inhoud.status !== 200 || l?.encoding !== "base64" || typeof l.content !== "string") {
      console.error(`jarvis v3 migreer: ${f.filename} niet te lezen.`);
      return 1;
    }
    bestanden.push({ pad: f.filename, sql: Buffer.from(l.content, "base64").toString("utf8") });
  }
  const oordeel = beoordeelMigraties(m, bestanden);
  if (oordeel.length > 0) {
    for (const o of oordeel) console.error(`jarvis v3 migreer: ${o.pad}: ${o.redenen.join("; ")}`);
    return 3;
  }
  bestanden.sort((a, b) => a.pad.localeCompare(b.pad));
  if (droog) {
    console.log(`jarvis v3 migreer: droog — ${bestanden.length} migratie(s) zouden worden toegepast: ${bestanden.map((b) => b.pad).join(", ")}`);
    return 0;
  }
  const { default: postgres } = await import("postgres");
  const db = postgres(dbUrl, { max: 1, prepare: false, connect_timeout: 15 });
  try {
    for (const b of bestanden) {
      const naam = b.pad.split("/").pop()!.replace(/\.sql$/, "");
      const bestaat = await db.unsafe(`select 1 from ${ledger} where name = $1`, [naam]);
      if (bestaat.length > 0) {
        console.log(`jarvis v3 migreer: ${naam} staat al in het ledger; overgeslagen.`);
        continue;
      }
      await db.begin(async (tx) => {
        await tx.unsafe(b.sql);
        await tx.unsafe(`insert into ${ledger} (version, name, statements) values ($1, $2, $3)`, [ledgerVersie(new Date()), naam, [b.sql]]);
      });
      console.log(`jarvis v3 migreer: ${naam} toegepast voor ${taak}.`);
    }
  } finally {
    await db.end({ timeout: 2 });
  }
  return 0;
}

// -------------------------------------------------------------------- main

export async function voerV3Uit(argv: readonly string[]): Promise<number> {
  const { opdracht: wat, vlaggen, losse, dubbel } = leesArgumenten(argv);
  if (dubbel.length > 0) {
    console.error(dubbel.map((n) => `jarvis v3: de vlag --${n} is meer dan een keer meegegeven.`).join("\n"));
    return 2;
  }
  try {
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
      case "dispatch":
        return await dispatch(vlaggen.has("droog"));
      case "beoordeel-pr": {
        const nummer = Number.parseInt(taak, 10);
        if (!Number.isInteger(nummer) || nummer <= 0) throw new Error("gebruik: jarvis v3 beoordeel-pr <nummer> --repo <slug> [--samenvoegen]");
        return await beoordeelPr(nummer, vlaggen.get("repo") || (process.env.GITHUB_REPOSITORY ?? "").trim(), vlaggen.has("samenvoegen"));
      }
      case "sweep":
        return await sweep(vlaggen.get("repo") || (process.env.GITHUB_REPOSITORY ?? "").trim());
      case "migreer":
        return await migreer(vlaggen.get("repo") || (process.env.GITHUB_REPOSITORY ?? "").trim(), vereist(vlaggen, "basis"), vereist(vlaggen, "kop"), vlaggen.has("droog"));
      case "eindcontrole":
        return await eindcontrole(taak, vereist(vlaggen, "door"), vlaggen.get("sha") ?? null);
      default:
        console.error("jarvis v3: onbekende opdracht. Zie de kop van jarvis/src/v3-cli.ts.");
        return 2;
    }
  } catch (fout) {
    console.error(`jarvis v3 ${wat}: ${(fout instanceof Error ? fout.message : String(fout)).replace(/postgres(ql)?:\/\/\S+/gi, "<verbindingsreeks>")}`);
    return 1;
  }
}
