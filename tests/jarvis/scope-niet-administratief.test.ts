/**
 * Het samenstellen van de attestatiefeiten, uitgevoerd.
 *
 * De vorige ronde leerde dat een test op brontekst een vorm borgt en geen
 * gedrag: twee velden die hier wegvallen — het patroon van het scope-bestand
 * en de status per bestand — maken `beoordeelAttestatie` stilletjes soepeler,
 * en geen enkele test merkte dat. Daarom draait hier het echte
 * `verzamelAttestatieFeiten`, met één nep-lezer op de plaats van GitHub, en
 * daarna de echte beoordeling op wat eruit komt.
 */
import { describe, expect, it } from "vitest";
import { scopeHash, beoordeelAttestatie, isAdministratievePr, herschrevenScope } from "@/jarvis/src/attestatie";
import { verzamelAttestatieFeiten, type GithubLezer } from "@/jarvis/src/opdrachten";
import type { JarvisConfig } from "@/jarvis/src/config";
import type { PullRequestFeiten } from "@/jarvis/src/pr";

const KOP = "c".repeat(40);
const TAAK = "T-20260913-proef";
const SCOPE_OUD = "---\nid: T-20260913-proef\n---\n\nde oude tekst\n";
const SCOPE_NIEUW = "---\nid: T-20260913-proef\n---\n\nde herschreven tekst\n";
const PAD = `tasks/${TAAK}/opdracht.md`;

const config = {
  taken_map: "tasks",
  knowledge_map: "knowledge",
  current_state: "docs/CURRENT_STATE.md",
  attestatie: { bot: "de-bot", uitvoerders: [], extra_paden: [], url: "", sleutel: "" },
} as unknown as JarvisConfig;

const prFeiten = { auteur: "de-bot", kop: KOP, checks: [{ naam: "poort", status: "completed", conclusie: "success" }] } as unknown as PullRequestFeiten;

/** Het akkoord staat op de oude tekst; de kop draagt de nieuwe. */
const bron = {
  taak: async () => ({
    id: "11111111-1111-1111-1111-111111111111",
    soort: "taak" as const,
    project: "proef",
    taak: TAAK,
    scope_hash: scopeHash(SCOPE_OUD),
    pr_repo: null,
    pr_nummer: null,
    commit_sha: null,
    op: "2026-09-13T10:00:00Z",
  }),
  pr: async () => null,
  toetsing: async () => null,
  opId: async () => ({ autorisaties: new Map(), toetsing: null }),
};

/** Een GitHub die precies één pull request kent, met één bestand in de gegeven staat. */
function lezer(status: string, pad = PAD): GithubLezer {
  return async (_token, _methode, url) => {
    const ok = (lading: unknown) => ({ status: 200, lading }) as never;
    if (/\/pulls\/7\/commits/.test(url)) {
      return ok([{ sha: KOP, commit: { message: `Kennisbeheerder: iets\n\nJarvis-Task: ${TAAK}\n` }, parents: [{}] }]);
    }
    if (/\/pulls\/7\/files/.test(url)) return ok([{ filename: pad, status }]);
    if (/\/contents\//.test(url)) {
      return ok({ encoding: "base64", content: Buffer.from(SCOPE_NIEUW, "utf8").toString("base64") });
    }
    if (/\/pulls\/7$/.test(url)) return ok({ body: "Uitzonderingen: geen", commits: 1, changed_files: 1 });
    return { status: 404, lading: {} } as never;
  };
}

async function feitenVan(status: string, pad?: string) {
  const f = await verzamelAttestatieFeiten("t", "eigenaar/proef", 7, prFeiten, config, bron as never, lezer(status, pad));
  if (typeof f === "string") throw new Error(f);
  return f;
}

describe("verzamelAttestatieFeiten draagt wat de beoordeling nodig heeft", () => {
  it("geeft het scopepatroon en de status per bestand door", async () => {
    const f = await feitenVan("modified");
    expect(f.scopeBestandPatroon, "zonder patroon valt de dichting stil terug op de oude regel").toBeDefined();
    expect(f.scopeBestandPatroon!.test(PAD)).toBe(true);
    expect(f.scopeBestandPatroon!.test(`tasks/${TAAK}/resultaat.md`)).toBe(false);
    expect(f.bestandStatus, "zonder status telt elk bestand als gewijzigd").toEqual({ [PAD]: "modified" });
  });

  it("weigert een herschreven opdracht, door de hele keten heen", async () => {
    const f = await feitenVan("modified");
    expect(herschrevenScope(f)).toEqual([PAD]);
    expect(isAdministratievePr(f)).toBe(false);
    const redenen = beoordeelAttestatie(f).join(" | ");
    expect(redenen).toMatch(/herschrijft tasks\/T-20260913-proef\/opdracht\.md/);
    expect(redenen, "de scope hoort vergeleken te worden").toMatch(/de scope van T-20260913-proef is veranderd/);
    expect(redenen, "en er hoort een toetsing te zijn").toMatch(/geen toetsing met oordeel GO/);
  });

  it("laat een nieuw dossier door, door de hele keten heen", async () => {
    const f = await feitenVan("added");
    expect(herschrevenScope(f)).toEqual([]);
    expect(isAdministratievePr(f)).toBe(true);
    expect(beoordeelAttestatie(f)).toEqual([]);
  });

  it("laat het resultaatdossier administratief blijven", async () => {
    const f = await feitenVan("modified", `tasks/${TAAK}/resultaat.md`);
    expect(herschrevenScope(f)).toEqual([]);
    expect(isAdministratievePr(f)).toBe(true);
    expect(beoordeelAttestatie(f)).toEqual([]);
  });
});
