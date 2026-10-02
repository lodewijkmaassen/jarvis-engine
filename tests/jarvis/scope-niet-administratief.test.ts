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

const prFeiten = { auteur: "de-bot", kop: KOP, basis: "main", checks: [{ naam: "poort", status: "completed", conclusie: "success" }] } as unknown as PullRequestFeiten;

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

/**
 * Een GitHub die precies één pull request kent.
 *
 * `status: null` laat het `status`-veld wég uit de `files`-lading — dat is
 * het geval waarin de verzamelaar zelf moet terugvallen op "modified", en
 * precies die terugval was ongetest.
 */
function lezer(status: string | null, pad = PAD, opBasis = SCOPE_OUD, opKop = SCOPE_NIEUW): GithubLezer {
  return async (_token, _methode, url) => {
    const ok = (lading: unknown) => ({ status: 200, lading }) as never;
    const base64 = (t: string) => ok({ encoding: "base64", content: Buffer.from(t, "utf8").toString("base64") });
    if (/\/pulls\/7\/commits/.test(url)) {
      return ok([{ sha: KOP, commit: { message: `Kennisbeheerder: iets\n\nJarvis-Task: ${TAAK}\n` }, parents: [{}] }]);
    }
    if (/\/pulls\/7\/files/.test(url)) return ok([status === null ? { filename: pad } : { filename: pad, status }]);
    if (/\/contents\//.test(url)) return base64(/ref=main/.test(url) ? opBasis : opKop);
    if (/\/pulls\/7$/.test(url)) return ok({ body: "Uitzonderingen: geen", commits: 1, changed_files: 1 });
    return { status: 404, lading: {} } as never;
  };
}

async function feitenVan(status: string | null, pad?: string, opBasis?: string, opKop?: string) {
  const f = await verzamelAttestatieFeiten("t", "eigenaar/proef", 7, prFeiten, config, bron as never, lezer(status, pad, opBasis, opKop));
  if (typeof f === "string") throw new Error(f);
  return f;
}

describe("verzamelAttestatieFeiten draagt wat de beoordeling nodig heeft", () => {
  it("geeft het scopepatroon en de status per bestand door", async () => {
    const f = await feitenVan("modified");
    expect(f.scopeBestandPatroon, "zonder patroon valt de dichting terug op haar eigen ruime vorm").toBeDefined();
    expect(f.scopeBestandPatroon!.test(PAD)).toBe(true);
    expect(f.scopeBestandPatroon!.test(`tasks/${TAAK}/resultaat.md`)).toBe(false);
    expect(f.bestandStatus, "zonder status telt elk bestand als gewijzigd").toEqual({ [PAD]: "modified" });
  });

  it("bouwt het patroon hoofdletterongevoelig", async () => {
    // `tasks/<taak>/Opdracht.md` kwam er administratief doorheen. Dit toetst
    // het patroon dat de verzamelaar zélf maakt, niet een dat de test geeft.
    const hoofdletter = `tasks/${TAAK}/Opdracht.md`;
    const f = await feitenVan("modified", hoofdletter);
    expect(f.scopeBestandPatroon!.test(hoofdletter), "het patroon ziet de hoofdlettervariant niet").toBe(true);
    expect(herschrevenScope(f)).toEqual([hoofdletter]);
    expect(isAdministratievePr(f)).toBe(false);
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

describe("de twee gevallen die de verzamelaar zelf moet afleiden", () => {
  it("telt een bestand zonder status-veld in de lading als gewijzigd", async () => {
    // De GitHub-lading geeft hier geen `status`. De verzamelaar vult
    // "modified" in, en de pull request hoort geweigerd te worden. Deze
    // terugval was ongetest; zonder haar zou een lading zonder status de
    // soepelste uitkomst geven.
    const f = await feitenVan(null);
    expect(f.bestandStatus).toEqual({ [PAD]: "modified" });
    expect(herschrevenScope(f)).toEqual([PAD]);
    expect(isAdministratievePr(f)).toBe(false);
  });

  it("merkt zelf op dat alleen de statusregel wijzigde, en laat het door", async () => {
    const dossier = (status: string) => `---\nid: ${TAAK}\nstatus: ${status}\n---\n\nde tekst\n`;
    const f = await feitenVan("modified", PAD, dossier("actief"), dossier("afgerond"));
    expect(f.alleenStatusregel).toEqual([PAD]);
    expect(herschrevenScope(f)).toEqual([]);
    expect(isAdministratievePr(f)).toBe(true);
    expect(beoordeelAttestatie(f)).toEqual([]);
  });

  it("merkt het níét op zodra er meer verandert dan de statusregel", async () => {
    const f = await feitenVan(
      "modified",
      PAD,
      `---\nid: ${TAAK}\nstatus: actief\n---\n\nde tekst\n`,
      `---\nid: ${TAAK}\nstatus: afgerond\n---\n\neen andere tekst\n`,
    );
    expect(f.alleenStatusregel).toEqual([]);
    expect(herschrevenScope(f)).toEqual([PAD]);
    expect(isAdministratievePr(f)).toBe(false);
  });
});
