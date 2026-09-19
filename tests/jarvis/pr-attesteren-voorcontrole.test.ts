import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { voerUit } from "../../jarvis/src/opdrachten.js";

/**
 * De voorcontrole van `jarvis pr attesteren` (T-20260917-attestatie-vooraf).
 *
 * Deze tests draaien de echte opdracht en vangen alleen het venster naar
 * buiten af: `fetch`. Daarmee lopen `leesPullRequest`, `leesConfigVanRepo`,
 * `verzamelAttestatieFeiten` en `beoordeelAttestatie` allemaal echt, en toetsen
 * de tests het gedrag in plaats van een nagebouwde beslisboom. Wat we meten is
 * één ding: is er wel of niet een POST naar het dispatch-eindpunt geweest, en
 * met welke exitcode eindigt de opdracht.
 */

const SLUG = "eigenaar/repo";
const NUMMER = 5;
const KOP = "a".repeat(40);
const BOT = "tovas-jarvis-bot";
const DB_API = "https://db.voorbeeld.test/functions/v1/jarvis-db";

const CONFIG_YML = `
project: voorbeeld
enabled: true
knowledge_map: knowledge
taken_map: tasks
current_state: docs/CURRENT_STATE.md
project_kaart: project/PROJECT.md
test_pad: tests
branch_voorvoegsel: jarvis/
budget:
  S: 8000
  M: 20000
  L: 40000
limieten:
  qa_rondes: 3
  subagenten: 12
  besluiten_per_taak: 1
  nieuwe_dec_per_taak: 3
  wallclock_minuten: 60
rollen_map: jarvis/roles
sanitize_paden:
  - docs
status_paden:
  - jarvis/src
attestatie:
  url: https://db.voorbeeld.test
  sleutel: publiek
  bot: ${BOT}
  uitvoerders: []
  extra_paden: []
`;

/** Wat een scenario aan de stub meegeeft; alles heeft een rijpe standaard. */
type Scenario = {
  /** Bestanden in de PR. Standaard: één codebestand, dus niet administratief. */
  bestanden?: readonly string[];
  /** De commitboodschap, waar de taak-id uit komt. */
  commitBoodschap?: string;
  /** Rijen die de databron teruggeeft, per SQL-statement-soort. */
  autorisatieTaak?: Record<string, unknown> | null;
  toetsing?: Record<string, unknown> | null;
  /** Conclusie van de check "poort". */
  poort?: string;
  /** De PR-tekst; standaard met een geldige Uitzonderingen-regel. */
  prTekst?: string;
  /** HTTP-status die het dispatch-eindpunt teruggeeft. Standaard 204. */
  dispatchStatus?: number;
  /** Laat de databron falen (netwerkfout), voor de fail-open-tak. */
  dbFaalt?: boolean;
  /** Laat het commits-eindpunt falen, voor de fail-open-tak. */
  commitsFalen?: boolean;
  /** Laat jarvis.config.yml onleesbaar zijn, voor de fail-open-tak. */
  configOnleesbaar?: boolean;
};

const TAAK = "T-20260101-voorbeeld";
const SCOPE_TEKST = "---\nid: T-20260101-voorbeeld\nstatus: actief\n---\n\n# Opdracht\n";

/** Dezelfde hash die de engine over opdracht.md legt, zodat de scope klopt. */
async function scopeHashVan(tekst: string): Promise<string> {
  const { scopeHash } = await import("../../jarvis/src/attestatie.js");
  return scopeHash(tekst);
}

type Aanroep = { readonly methode: string; readonly url: string; readonly body: unknown };

/** Installeert de fetch-stub en geeft de lijst met aanroepen terug. */
async function stubFetch(s: Scenario): Promise<Aanroep[]> {
  const aanroepen: Aanroep[] = [];
  const b64 = (t: string) => Buffer.from(t, "utf8").toString("base64");
  const hash = await scopeHashVan(SCOPE_TEKST);
  const bestanden = s.bestanden ?? ["jarvis/src/iets.ts"];

  const autorisatie =
    s.autorisatieTaak === undefined
      ? { id: "AUT-1", soort: "taak", taak: TAAK, scope_hash: hash, op: "2026-01-01T00:00:00Z", project: "voorbeeld" }
      : s.autorisatieTaak;
  const toetsing =
    s.toetsing === undefined
      ? { id: "TOE-1", oordeel: "GO", commit_sha: KOP, pr_repo: SLUG, pr_nummer: NUMMER }
      : s.toetsing;

  globalThis.fetch = (async (invoer: unknown, init?: { method?: string; body?: string }) => {
    const url = String(invoer);
    const methode = init?.method ?? "GET";
    const body: unknown = init?.body === undefined ? undefined : JSON.parse(init.body);
    aanroepen.push({ methode, url, body });
    const json = (status: number, lading: unknown) =>
      new Response(JSON.stringify(lading), { status, headers: { "Content-Type": "application/json" } });

    // De eigen database (Edge Function jarvis-db): één endpoint, dat per
    // statement een andere rij teruggeeft.
    if (url.startsWith(DB_API)) {
      if (s.dbFaalt) throw new Error("verbinding geweigerd");
      const sql = String((body as { sql?: unknown } | undefined)?.sql ?? "");
      const rij = sql.includes("toetsing") ? toetsing : sql.includes("autorisatie") ? autorisatie : null;
      return json(200, { rows: rij === null ? [] : [rij] });
    }

    if (url.endsWith("/user")) return json(200, { login: BOT });
    if (url.includes("/contents/jarvis.config.yml")) {
      if (s.configOnleesbaar) return json(404, { message: "Not Found" });
      return json(200, { content: b64(CONFIG_YML), encoding: "base64" });
    }
    if (url.includes(`/contents/tasks/${TAAK}/opdracht.md`)) return json(200, { content: b64(SCOPE_TEKST), encoding: "base64" });
    if (url.includes(`/pulls/${NUMMER}/reviews`)) return json(200, []);
    if (url.includes(`/commits/${KOP}/check-runs`)) {
      return json(200, { check_runs: [{ name: "poort", status: "completed", conclusion: s.poort ?? "success" }] });
    }
    if (url.includes(`/pulls/${NUMMER}/commits`)) {
      if (s.commitsFalen) return json(500, { message: "Server Error" });
      return json(200, [{ sha: KOP, commit: { message: s.commitBoodschap ?? `werk\n\nJarvis-Role: developer\nJarvis-Task: ${TAAK}` }, parents: [{}] }]);
    }
    if (url.includes(`/pulls/${NUMMER}/files`)) return json(200, bestanden.map((f) => ({ filename: f })));
    if (url.includes("/dispatches")) {
      const status = s.dispatchStatus ?? 204;
      return new Response(status === 204 ? null : JSON.stringify({ message: "Resource not accessible" }), { status });
    }
    if (url.includes(`/pulls/${NUMMER}`)) {
      return json(200, {
        user: { login: BOT },
        head: { sha: KOP },
        base: { ref: "main" },
        state: "open",
        draft: false,
        mergeable: true,
        mergeable_state: "clean",
        body: s.prTekst ?? "Wat er gebeurt.\n\nUitzonderingen: geen\n",
        commits: 1,
        changed_files: bestanden.length,
      });
    }
    return json(404, { message: `onverwacht pad: ${url}` });
  }) as typeof fetch;

  return aanroepen;
}

/** Is er een POST naar het dispatch-eindpunt geweest? */
const gedispatcht = (a: readonly Aanroep[]) => a.some((r) => r.methode === "POST" && r.url.includes("/dispatches"));

/**
 * Draait de opdracht en vangt stderr af. Dat laatste is niet decoratie: de
 * voorcontrole is fail open, dus een dispatch bewijst op zichzelf niet dat ze
 * heeft geoordeeld — ze kan ook zijn overgeslagen. `overgeslagen` maakt dat
 * verschil zichtbaar, zodat een test die de dispatch verwacht niet stilletjes
 * kan slagen doordat de voorcontrole niets deed.
 */
async function attesteer(): Promise<{ code: number; overgeslagen: boolean; meldingen: string }> {
  const regels: string[] = [];
  const origineel = console.error;
  console.error = (...a: unknown[]) => void regels.push(a.map(String).join(" "));
  try {
    const code = await voerUit(["pr", "attesteren", String(NUMMER), "--repo", SLUG]);
    const meldingen = regels.join("\n");
    return { code, overgeslagen: meldingen.includes("voorcontrole overgeslagen"), meldingen };
  } finally {
    console.error = origineel;
  }
}

describe("jarvis pr attesteren — voorcontrole vóór de dispatch", () => {
  const origineel = globalThis.fetch;
  const bewaard = { token: process.env.JARVIS_BOT_TOKEN, api: process.env.JARVIS_DB_API, url: process.env.JARVIS_DB_URL };

  beforeEach(() => {
    process.env.JARVIS_BOT_TOKEN = "token-voor-de-test";
    process.env.JARVIS_DB_API = DB_API;
    // Een verbindingsreeks zou een echte postgres-client openen; die weg is
    // in deze tests nadrukkelijk niet aan de orde.
    delete process.env.JARVIS_DB_URL;
  });

  afterEach(() => {
    globalThis.fetch = origineel;
    if (bewaard.token === undefined) delete process.env.JARVIS_BOT_TOKEN;
    else process.env.JARVIS_BOT_TOKEN = bewaard.token;
    if (bewaard.api === undefined) delete process.env.JARVIS_DB_API;
    else process.env.JARVIS_DB_API = bewaard.api;
    if (bewaard.url !== undefined) process.env.JARVIS_DB_URL = bewaard.url;
  });

  it("AC-1: zonder taakakkoord start er geen workflow en is de exitcode 3", async () => {
    const aanroepen = await stubFetch({ autorisatieTaak: null });
    const uit = await attesteer();
    expect(uit.code).toBe(3);
    expect(gedispatcht(aanroepen)).toBe(false);
    expect(uit.meldingen).toContain("nog niet rijp");
  });

  it("AC-1: zonder toetsing GO op de kop start er geen workflow", async () => {
    const aanroepen = await stubFetch({ toetsing: null });
    const uit = await attesteer();
    expect(uit.code).toBe(3);
    expect(gedispatcht(aanroepen)).toBe(false);
  });

  it("AC-1: een rode poort houdt de workflow tegen", async () => {
    const aanroepen = await stubFetch({ poort: "failure" });
    const uit = await attesteer();
    expect(uit.code).toBe(3);
    expect(gedispatcht(aanroepen)).toBe(false);
  });

  it("AC-2: bij volledige voorwaarden gaat dezelfde dispatch uit als hiervoor", async () => {
    const aanroepen = await stubFetch({});
    const uit = await attesteer();
    expect(uit.code).toBe(0);
    // Niet overgeslagen: de voorcontrole heeft werkelijk geoordeeld dat deze
    // pull request rijp is, en is niet op een leesfout blijven steken.
    expect(uit.overgeslagen).toBe(false);
    const dispatch = aanroepen.find((r) => r.url.includes("/dispatches"));
    expect(dispatch?.methode).toBe("POST");
    expect(dispatch?.url).toBe(`https://api.github.com/repos/${SLUG}/actions/workflows/jarvis-attestatie.yml/dispatches`);
    expect(dispatch?.body).toEqual({ ref: "main", inputs: { pr: String(NUMMER) } });
  });

  it("AC-4: een administratieve pull request passeert zonder akkoord en zonder toetsing", async () => {
    const aanroepen = await stubFetch({
      bestanden: [`tasks/${TAAK}/resultaat.md`, "docs/CURRENT_STATE.md"],
      autorisatieTaak: null,
      toetsing: null,
    });
    const uit = await attesteer();
    expect(uit.code).toBe(0);
    expect(uit.overgeslagen).toBe(false);
    expect(gedispatcht(aanroepen)).toBe(true);
  });

  it("AC-5: een onbereikbare databron laat de dispatch doorgaan", async () => {
    const aanroepen = await stubFetch({ dbFaalt: true });
    const uit = await attesteer();
    expect(uit.code).toBe(0);
    expect(uit.overgeslagen).toBe(true);
    expect(gedispatcht(aanroepen)).toBe(true);
  });

  it("AC-5: een leesfout op de commits laat de dispatch doorgaan", async () => {
    const aanroepen = await stubFetch({ commitsFalen: true });
    const uit = await attesteer();
    expect(uit.code).toBe(0);
    expect(uit.overgeslagen).toBe(true);
    expect(gedispatcht(aanroepen)).toBe(true);
  });

  it("AC-5: een onleesbare configuratie laat de dispatch doorgaan", async () => {
    const aanroepen = await stubFetch({ configOnleesbaar: true });
    const uit = await attesteer();
    expect(uit.code).toBe(0);
    expect(uit.overgeslagen).toBe(true);
    expect(gedispatcht(aanroepen)).toBe(true);
  });

  it("AC-8: een 403 op de dispatch zelf blijft een fout, geen 3", async () => {
    const aanroepen = await stubFetch({ dispatchStatus: 403 });
    const uit = await attesteer();
    expect(uit.code).not.toBe(3);
    expect(uit.code).not.toBe(0);
    expect(gedispatcht(aanroepen)).toBe(true);
  });
});

describe("jarvis help — de nieuwe exitcode staat erin (AC-6)", () => {
  it("noemt bij pr attesteren wat exitcode 3 betekent", async () => {
    const regels: string[] = [];
    const origineel = console.log;
    console.log = (...a: unknown[]) => void regels.push(a.map(String).join(" "));
    try {
      expect(await voerUit(["help"])).toBe(0);
    } finally {
      console.log = origineel;
    }
    const tekst = regels.join("\n");
    expect(tekst).toContain("attesteren");
    expect(tekst).toMatch(/nog niet rijp, niets gestart/);
  });
});
