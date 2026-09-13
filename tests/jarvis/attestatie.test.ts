import { describe, expect, it } from "vitest";
import {
  attestatieTekst,
  beoordeelAttestatie,
  leesAttestatie,
  leesUitzonderingenRegel,
  raaktHardeUitzondering,
  scopeHash,
  taakUitCommits,
  verifieerAttestatie,
  type AttestatieFeiten,
  type Autorisatie,
  type Toetsing,
} from "@/jarvis/src/attestatie";
import { ATTESTATIE_GEBRUIKER, beoordeelSamenvoegen, type PullRequestFeiten } from "@/jarvis/src/pr";
import { restPadAutorisatieTaak, restPadToetsingKop } from "@/jarvis/src/db";

const KOP = "a".repeat(40);
const ANDERE = "b".repeat(40);
const SCOPE = "---\nid: T-20260913-proef\n---\n\n## Wat de opdrachtgever vroeg\n\nIets.\n";

const autorisatie: Autorisatie = {
  id: "11111111-1111-1111-1111-111111111111",
  soort: "taak",
  project: "proef",
  taak: "T-20260913-proef",
  scope_hash: scopeHash(SCOPE),
  pr_repo: null,
  pr_nummer: null,
  commit_sha: null,
  op: "2026-09-13T10:00:00Z",
};

const toetsing: Toetsing = {
  id: "22222222-2222-2222-2222-222222222222",
  pr_repo: "eigenaar/proef",
  pr_nummer: 7,
  commit_sha: KOP,
  oordeel: "GO",
  rapport: null,
  door: "cloud",
  op: "2026-09-13T10:05:00Z",
};

function feiten(over: Partial<AttestatieFeiten> = {}): AttestatieFeiten {
  return {
    nummer: 7,
    auteur: "de-bot",
    botLogin: "de-bot",
    kop: KOP,
    repo: "eigenaar/proef",
    taak: "T-20260913-proef",
    taakRedenen: [],
    autorisatieTaak: autorisatie,
    scopeHashKop: scopeHash(SCOPE),
    toetsing,
    gewijzigdeBestanden: ["jarvis/src/iets.ts", "tests/jarvis/iets.test.ts"],
    prTekst: "## Wat\n\nIets.\n\nUitzonderingen: geen\n",
    autorisatiePr: null,
    checks: [{ naam: "poort", status: "completed", conclusie: "success" }],
    verplichteCheck: "poort",
    ...over,
  };
}

describe("scopeHash", () => {
  it("is onafhankelijk van regeleindes", () => {
    expect(scopeHash("a\r\nb\r\n")).toBe(scopeHash("a\nb\n"));
  });
  it("verandert met de inhoud", () => {
    expect(scopeHash("a")).not.toBe(scopeHash("b"));
  });
});

describe("taakUitCommits", () => {
  it("geeft de ene taak die alle commits dragen", () => {
    const uit = taakUitCommits([
      { sha: KOP, boodschap: "Iets\n\nJarvis-Role: developer\nJarvis-Task: T-1\n" },
      { sha: ANDERE, boodschap: "Nog iets\n\nJarvis-Task: T-1\n" },
    ]);
    expect(uit).toEqual({ taak: "T-1", redenen: [] });
  });
  it("weigert een commit zonder trailer en een mix van taken", () => {
    expect(taakUitCommits([{ sha: KOP, boodschap: "Zonder" }]).redenen[0]).toMatch(/geen Jarvis-Task/);
    const mix = taakUitCommits([
      { sha: KOP, boodschap: "Jarvis-Task: T-1" },
      { sha: ANDERE, boodschap: "Jarvis-Task: T-2" },
    ]);
    expect(mix.taak).toBeNull();
    expect(mix.redenen[0]).toMatch(/meer dan één taak/);
  });
  it("weigert een lege PR", () => {
    expect(taakUitCommits([]).redenen).toEqual(["de pull request heeft geen commits"]);
  });
});

describe("harde uitzonderingen", () => {
  it("herkent workflows, CODEOWNERS, migraties, .env, governance en rolcontracten", () => {
    const treffers = raaktHardeUitzondering([
      ".github/workflows/ci.yml",
      "CODEOWNERS",
      "supabase/migrations/20260913_x.sql",
      ".env.local",
      "jarvis.config.yml",
      "jarvis/allowlist.yml",
      "knowledge/CONSTRAINTS/CON-0001.md",
      "jarvis/roles/qa.md",
      "jarvis/canonical/jarvis-lint.yml",
      ".claude/agents/x.md",
      "src/gewoon.ts",
    ]);
    expect(treffers).toHaveLength(10);
    expect(treffers.some((t) => t.startsWith("src/gewoon.ts"))).toBe(false);
  });
  it("neemt projectpaden uit de configuratie mee, als pad of als map", () => {
    const treffers = raaktHardeUitzondering(["deploy.json", "infra/x.tf", "src/a.ts"], ["deploy.json", "infra"]);
    expect(treffers).toEqual(["deploy.json (projectregel: deploy.json)", "infra/x.tf (projectregel: infra)"]);
  });
  it("leest de verklaring in de PR-tekst", () => {
    expect(leesUitzonderingenRegel("bla\nUitzonderingen: geen\n")).toBe("geen");
    expect(leesUitzonderingenRegel("Uitzonderingen: raakt de migraties")).toBe("raakt de migraties");
    expect(leesUitzonderingenRegel("niets verklaard")).toBeNull();
  });
});

describe("beoordeelAttestatie", () => {
  it("attesteert een schone PR", () => {
    expect(beoordeelAttestatie(feiten())).toEqual([]);
  });
  it("weigert werk van een ander dan de bot", () => {
    expect(beoordeelAttestatie(feiten({ auteur: "iemand" }))[0]).toMatch(/niet de bot/);
  });
  it("weigert zonder akkoord op de taak", () => {
    expect(beoordeelAttestatie(feiten({ autorisatieTaak: null }))).toContainEqual(expect.stringMatching(/geen akkoord/));
  });
  it("weigert wanneer de scope sinds het akkoord veranderde", () => {
    const uit = beoordeelAttestatie(feiten({ scopeHashKop: scopeHash(`${SCOPE}\nMeer.\n`) }));
    expect(uit).toContainEqual(expect.stringMatching(/scope .* is veranderd/));
  });
  it("weigert zonder dossier op de kop", () => {
    expect(beoordeelAttestatie(feiten({ scopeHashKop: null }))).toContainEqual(expect.stringMatching(/opdracht\.md ontbreekt/));
  });
  it("weigert zonder GO op precies de kop", () => {
    expect(beoordeelAttestatie(feiten({ toetsing: null }))).toContainEqual(expect.stringMatching(/geen toetsing/));
    expect(beoordeelAttestatie(feiten({ toetsing: { ...toetsing, commit_sha: ANDERE } }))).toContainEqual(
      expect.stringMatching(/hoort niet bij de kop/),
    );
  });
  it("weigert een harde uitzondering zonder apart akkoord, en aanvaardt die met", () => {
    const met = feiten({ gewijzigdeBestanden: ["supabase/migrations/x.sql"] });
    expect(beoordeelAttestatie(met)).toContainEqual(expect.stringMatching(/harde uitzondering/));
    const apart: Autorisatie = { ...autorisatie, id: "3", soort: "pr", pr_repo: "eigenaar/proef", pr_nummer: 7, commit_sha: KOP };
    expect(beoordeelAttestatie({ ...met, autorisatiePr: apart })).toEqual([]);
    // Een apart akkoord op een eerdere kop telt niet.
    expect(beoordeelAttestatie({ ...met, autorisatiePr: { ...apart, commit_sha: ANDERE } })).toContainEqual(
      expect.stringMatching(/harde uitzondering/),
    );
  });
  it("weigert een verklaarde uitzondering zonder apart akkoord", () => {
    expect(beoordeelAttestatie(feiten({ prTekst: "Uitzonderingen: raakt productie" }))).toContainEqual(
      expect.stringMatching(/verklaard: raakt productie/),
    );
  });
  it("weigert zonder verklaring", () => {
    expect(beoordeelAttestatie(feiten({ prTekst: "geen regel" }))).toContainEqual(expect.stringMatching(/verklaart niets/));
  });
  it("weigert zonder groene poort", () => {
    expect(beoordeelAttestatie(feiten({ checks: [] }))).toContainEqual(expect.stringMatching(/ontbreekt/));
    expect(beoordeelAttestatie(feiten({ checks: [{ naam: "poort", status: "completed", conclusie: "failure" }] }))).toContainEqual(
      expect.stringMatching(/niet geslaagd/),
    );
  });
});

describe("attestatietekst", () => {
  const inhoud = {
    autorisatie: autorisatie.id,
    taak: "T-20260913-proef",
    scope: scopeHash(SCOPE),
    toetsing: toetsing.id,
    kop: KOP,
    uitzonderingen: "geen",
  };
  it("is na schrijven weer te lezen", () => {
    expect(leesAttestatie(attestatieTekst(inhoud))).toEqual(inhoud);
  });
  it("leest alleen de eerste regel en weigert andere teksten", () => {
    expect(leesAttestatie(`${attestatieTekst(inhoud)}\n\nnaschrift`)).toEqual(inhoud);
    expect(leesAttestatie("LGTM")).toBeNull();
    expect(leesAttestatie("Attestatie (DEC-0043): kapot")).toBeNull();
  });
  it("verifieert tegen de database", () => {
    expect(verifieerAttestatie(inhoud, KOP, autorisatie, toetsing)).toEqual([]);
    expect(verifieerAttestatie(inhoud, ANDERE, autorisatie, toetsing)[0]).toMatch(/hoort bij/);
    expect(verifieerAttestatie(inhoud, KOP, null, toetsing)).toContainEqual(expect.stringMatching(/bestaat niet/));
    expect(verifieerAttestatie(inhoud, KOP, { ...autorisatie, scope_hash: "x" }, toetsing)).toContainEqual(
      expect.stringMatching(/scope/),
    );
    expect(verifieerAttestatie(inhoud, KOP, autorisatie, { ...toetsing, oordeel: "NO-GO" })).toContainEqual(
      expect.stringMatching(/geen GO/),
    );
  });
});

describe("beoordeelSamenvoegen met een attestatie", () => {
  const basis: PullRequestFeiten = {
    nummer: 7,
    auteur: "de-bot",
    kop: KOP,
    basis: "main",
    open: true,
    concept: false,
    samenvoegbaar: true,
    samenvoegStaat: "clean",
    reviews: [{ gebruiker: ATTESTATIE_GEBRUIKER, staat: "APPROVED", commit: KOP, tekst: "Attestatie (DEC-0043): …" }],
    checks: [{ naam: "poort", status: "completed", conclusie: "success" }],
  };
  it("telt een geverifieerde attestatie op de kop als autorisatie", () => {
    expect(beoordeelSamenvoegen(basis, "eigenaar", [KOP])).toEqual([]);
  });
  it("telt een ongeverifieerde attestatie niet", () => {
    expect(beoordeelSamenvoegen(basis, "eigenaar", [])[0]).toMatch(/geen goedkeurende review/);
  });
  it("telt een attestatie op een eerdere kop niet", () => {
    const eerder = { ...basis, reviews: [{ ...basis.reviews[0]!, commit: ANDERE }] };
    expect(beoordeelSamenvoegen(eerder, "eigenaar", [ANDERE])[0]).toMatch(/eerdere commit/);
  });
  it("telt een goedkeuring van de bot zelf nooit", () => {
    const bot = { ...basis, reviews: [{ gebruiker: "de-bot", staat: "APPROVED", commit: KOP }] };
    expect(beoordeelSamenvoegen(bot, "eigenaar", [KOP])[0]).toMatch(/geen goedkeurende review/);
  });
});

describe("REST-paden", () => {
  it("bouwen een filter op taak, respectievelijk repository, nummer en kop", () => {
    expect(restPadAutorisatieTaak("T-1")).toBe("autorisaties_open?soort=eq.taak&taak=eq.T-1&order=op.desc&limit=1");
    expect(restPadToetsingKop("e/r", 7, KOP)).toContain("pr_repo=eq.e%2Fr&pr_nummer=eq.7&commit_sha=eq.");
  });
});
