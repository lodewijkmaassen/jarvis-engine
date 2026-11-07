import { describe, expect, it } from "vitest";
import {
  attestatieInhoud,
  beoordeelAttestatie,
  doelenMetMandaat,
  raaktHardeUitzondering,
  uitzonderingenBuitenDoel,
  type AttestatieFeiten,
  type Toetsing,
} from "@/jarvis/src/attestatie";

/**
 * Een doel van de eigenaar is het mandaat (opdracht van 2026-11-07).
 *
 * WAT HIER WORDT VASTGELEGD
 *
 * Binnen een doel dat de eigenaar zelf heeft aangemaakt, hoeft Jarvis niet per
 * pull request opnieuw om een akkoord te vragen voor het werk dat de eigenaar
 * heeft opgesomd: code, niet-destructieve databasemigraties, documentatie,
 * infrastructuur, reviews, samenvoegen, uitrollen en acceptatietests.
 *
 * En wat NIET verandert: de bestanden die bepalen wat Jarvis mag en wie hem
 * beoordeelt, en de bestanden waarin geheimen staan, blijven zijn handtekening
 * vragen. Zonder doel geldt de oude regel onveranderd.
 */
const KOP = "a".repeat(40);
const DOEL = "D-20261021-161119608";

const toetsing: Toetsing = {
  id: "22222222-2222-2222-2222-222222222222",
  pr_repo: "eigenaar/proef",
  pr_nummer: 7,
  commit_sha: KOP,
  oordeel: "GO",
  rapport: null,
  door: "ci-review",
  op: "2026-11-07T09:00:00Z",
};

function feiten(over: Partial<AttestatieFeiten> = {}): AttestatieFeiten {
  return {
    nummer: 7,
    auteur: "de-bot",
    botLogin: "de-bot",
    kop: KOP,
    repo: "eigenaar/proef",
    taken: [{ taak: DOEL, autorisatie: null, scopeHashKop: null }],
    taakRedenen: [],
    doelen: new Map([[DOEL, "bezig"]]),
    toetsing,
    gewijzigdeBestanden: ["supabase/migrations/20261107_iets.sql"],
    prTekst: "## Wat\n\nIets.\n\nUitzonderingen: supabase/migrations/\n",
    autorisatiePr: null,
    checks: [{ naam: "poort", status: "completed", conclusie: "success" }],
    verplichteCheck: "poort",
    administratiefPaden: [/^tasks\//],
    ...over,
  };
}

const overUitzondering = (f: AttestatieFeiten) => beoordeelAttestatie(f).filter((r) => r.includes("uitzondering"));

describe("welke uitzondering een doel dekt", () => {
  it("dekt databasemigraties en infrastructuur", () => {
    expect(uitzonderingenBuitenDoel(["supabase/migrations/x.sql", ".github/workflows/ci.yml"])).toEqual([]);
    expect(raaktHardeUitzondering(["supabase/migrations/x.sql"])).toHaveLength(1);
  });

  it("dekt niet wat bepaalt wat Jarvis mag of wie hem beoordeelt", () => {
    for (const pad of [
      ".github/CODEOWNERS",
      "jarvis.config.yml",
      "jarvis/roles/orchestrator.md",
      "jarvis/canonical/jarvis-v3.yml",
      "jarvis/allowlist.yml",
      ".claude/agents/jarvis-qa.md",
      "knowledge/CONSTRAINTS/CON-0015.md",
      ".env.example",
      ".npmrc",
    ]) {
      expect(uitzonderingenBuitenDoel([pad]), pad).toHaveLength(1);
    }
  });

  it("laat .github/CODEOWNERS bij de eigenaar, ook al valt het ook onder .github/", () => {
    expect(uitzonderingenBuitenDoel([".github/CODEOWNERS"])[0]).toContain("wie wat mag beoordelen");
  });

  it("laat een projectregel bij de eigenaar: het project noemt dat pad niet voor niets apart", () => {
    expect(uitzonderingenBuitenDoel(["infra/deploy.sh"], ["infra"])).toHaveLength(1);
  });
});

describe("de attestatie met en zonder doel", () => {
  it("attesteert een migratie binnen een lopend doel zonder apart akkoord", () => {
    expect(overUitzondering(feiten())).toEqual([]);
    expect(beoordeelAttestatie(feiten())).toEqual([]);
  });

  it("weigert dezelfde pull request zonder doel", () => {
    const zonder = feiten({ doelen: new Map(), taken: [{ taak: "T-20260913-iets", autorisatie: null, scopeHashKop: null }] });
    expect(overUitzondering(zonder)).toHaveLength(1);
    expect(overUitzondering(zonder)[0]).toContain("zonder doel van de eigenaar");
  });

  it("weigert hem ook wanneer het doel gesloten is: dan is het nieuw werk", () => {
    expect(overUitzondering(feiten({ doelen: new Map([[DOEL, "gesloten"]]) }))).toHaveLength(1);
  });

  it("weigert hem wanneer de kaart met doelen ontbreekt (geen leesweg: onbekend is niet soepel)", () => {
    expect(overUitzondering(feiten({ doelen: undefined }))).toHaveLength(1);
  });

  it("weigert het deel dat het doel niet dekt, en noemt alleen dat deel", () => {
    const gemengd = feiten({
      gewijzigdeBestanden: ["supabase/migrations/x.sql", ".github/CODEOWNERS"],
      prTekst: "## Wat\n\nIets.\n\nUitzonderingen: migraties en CODEOWNERS\n",
    });
    const redenen = overUitzondering(gemengd);
    expect(redenen).toHaveLength(1);
    expect(redenen[0]).toContain("CODEOWNERS");
    expect(redenen[0]).not.toContain("migrations/x.sql");
  });

  it("laat de oude weg bestaan: een apart akkoord op deze kop blijft werken", () => {
    const metAkkoord = feiten({
      doelen: new Map(),
      gewijzigdeBestanden: [".github/CODEOWNERS"],
      autorisatiePr: {
        id: "33333333-3333-3333-3333-333333333333",
        soort: "pr",
        project: null,
        taak: DOEL,
        scope_hash: null,
        pr_repo: "eigenaar/proef",
        pr_nummer: 7,
        commit_sha: KOP,
        op: "2026-11-07T09:00:00Z",
      },
    });
    expect(overUitzondering(metAkkoord)).toEqual([]);
  });

  it("blijft een verklaring in de PR-tekst eisen", () => {
    expect(beoordeelAttestatie(feiten({ prTekst: "## Wat\n\nIets.\n" }))).toContainEqual(expect.stringContaining("verklaart niets over uitzonderingen"));
  });

  it("telt alleen doelen die bij deze pull request horen", () => {
    const anderDoel = feiten({ doelen: new Map([["D-20261107-010000001", "bezig"]]) });
    expect(doelenMetMandaat(anderDoel)).toEqual([]);
    expect(overUitzondering(anderDoel)).toHaveLength(1);
  });
});

describe("de attestatietekst draagt waarop zij leunt", () => {
  it("noemt het doel wanneer zij op het mandaat leunt", () => {
    expect(attestatieInhoud(feiten()).uitzonderingen).toBe(`mandaat van doel ${DOEL}`);
  });

  it("noemt het aparte akkoord wanneer dat er is", () => {
    const f = feiten({
      autorisatiePr: {
        id: "44444444-4444-4444-4444-444444444444",
        soort: "pr",
        project: null,
        taak: DOEL,
        scope_hash: null,
        pr_repo: "eigenaar/proef",
        pr_nummer: 7,
        commit_sha: KOP,
        op: "2026-11-07T09:00:00Z",
      },
    });
    expect(attestatieInhoud(f).uitzonderingen).toContain("apart akkoord");
  });

  it("zegt geen bij een pull request die niets bijzonders raakt", () => {
    expect(attestatieInhoud(feiten({ gewijzigdeBestanden: ["src/iets.ts"], prTekst: "Uitzonderingen: geen\n" })).uitzonderingen).toBe("geen");
  });
});
