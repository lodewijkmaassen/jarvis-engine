import { describe, expect, it } from "vitest";
import {
  attestatieInhoud,
  attestatieTekst,
  beoordeelAttestatie,
  isAdministratief,
  leesAttestatie,
  leesUitzonderingenRegel,
  raaktHardeUitzondering,
  scopeHash,
  takenUitCommits,
  verifieerAttestatie,
  type AttestatieFeiten,
  type Autorisatie,
  type Toetsing,
} from "@/jarvis/src/attestatie";
import { ATTESTATIE_GEBRUIKER, beoordeelSamenvoegen, laatstePerNaam, type PullRequestFeiten } from "@/jarvis/src/pr";
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
    taken: [{ taak: "T-20260913-proef", autorisatie, scopeHashKop: scopeHash(SCOPE) }],
    taakRedenen: [],
    toetsing,
    gewijzigdeBestanden: ["jarvis/src/iets.ts", "tests/jarvis/iets.test.ts"],
    prTekst: "## Wat\n\nIets.\n\nUitzonderingen: geen\n",
    autorisatiePr: null,
    checks: [{ naam: "poort", status: "completed", conclusie: "success" }],
    verplichteCheck: "poort",
    administratiefPaden: [/^tasks\//, /^knowledge\/(?!CONSTRAINTS\/)/, /^docs\/CURRENT_STATE\.md$/],
    ...over,
  };
}
/** Dezelfde feiten met één veld van de enige taak anders. */
function metTaak(over: Partial<AttestatieFeiten["taken"][number]>, rest: Partial<AttestatieFeiten> = {}): AttestatieFeiten {
  const basis = feiten();
  return { ...basis, taken: [{ ...basis.taken[0]!, ...over }], ...rest };
}

describe("scopeHash", () => {
  it("is onafhankelijk van regeleindes", () => {
    expect(scopeHash("a\r\nb\r\n")).toBe(scopeHash("a\nb\n"));
  });
  it("verandert met de inhoud", () => {
    expect(scopeHash("a")).not.toBe(scopeHash("b"));
  });
});

describe("takenUitCommits", () => {
  it("geeft de taken die de commits dragen, elk één keer, gesorteerd", () => {
    const uit = takenUitCommits([
      { sha: KOP, boodschap: "Iets\n\nJarvis-Role: developer\nJarvis-Task: T-2\n" },
      { sha: ANDERE, boodschap: "Nog iets\n\nJarvis-Task: T-1\n" },
      { sha: "c".repeat(40), boodschap: "Nog iets\n\nJarvis-Task: T-1\n" },
    ]);
    expect(uit).toEqual({ taken: ["T-1", "T-2"], redenen: [] });
  });
  it("weigert een commit zonder trailer of met twee trailers", () => {
    expect(takenUitCommits([{ sha: KOP, boodschap: "Zonder" }]).redenen[0]).toMatch(/geen of meer dan/);
    const twee = takenUitCommits([{ sha: KOP, boodschap: "Jarvis-Task: T-1\nJarvis-Task: T-2\n" }]);
    expect(twee.taken).toEqual([]);
    expect(twee.redenen).toHaveLength(1);
  });
  it("weigert een lege PR", () => {
    expect(takenUitCommits([]).redenen).toEqual(["de pull request heeft geen commits"]);
  });
});

describe("administratieve PR (DEC-0044)", () => {
  const patronen = [/^tasks\//, /^knowledge\/(?!CONSTRAINTS\/)/, /^docs\/CURRENT_STATE\.md$/];
  it("herkent dossiers, kennis, index en feitenblok; niet de randvoorwaarden of code", () => {
    expect(isAdministratief(["tasks/T-1/resultaat.md", "knowledge/INDEX.json", "knowledge/DECISIONS/DEC-1.md", "docs/CURRENT_STATE.md"], patronen)).toBe(true);
    expect(isAdministratief(["tasks/T-1/resultaat.md", "knowledge/CONSTRAINTS/CON-1.md"], patronen)).toBe(false);
    expect(isAdministratief(["tasks/T-1/resultaat.md", "src/a.ts"], patronen)).toBe(false);
    expect(isAdministratief([], patronen)).toBe(false);
    expect(isAdministratief(["tasks/T-1/resultaat.md"], [])).toBe(false);
  });
  it("attesteert zonder taakakkoord en zonder toetsing, met poort groen en een verklaring", () => {
    const admin = feiten({ gewijzigdeBestanden: ["tasks/T-1/resultaat.md", "knowledge/INDEX.json"], taken: [], toetsing: null });
    expect(beoordeelAttestatie(admin)).toEqual([]);
    expect(attestatieInhoud(admin)).toMatchObject({ taken: "administratief", autorisaties: "-", scope: "-", toetsing: "-" });
    // Zonder verklaring of zonder groene poort blijft ook een administratieve PR staan.
    expect(beoordeelAttestatie({ ...admin, prTekst: "niets" })).toContainEqual(expect.stringMatching(/verklaart niets/));
    expect(beoordeelAttestatie({ ...admin, checks: [] })).toContainEqual(expect.stringMatching(/ontbreekt/));
    // Eén codebestand erbij en het is geen administratie meer: dan telt het akkoord.
    expect(beoordeelAttestatie({ ...admin, gewijzigdeBestanden: [...admin.gewijzigdeBestanden, "src/a.ts"] })).toContainEqual(
      expect.stringMatching(/geen taak bekend/),
    );
  });
  it("laat een dossier-PR die ook de randvoorwaarden raakt niet door als administratie", () => {
    const uit = beoordeelAttestatie(feiten({ gewijzigdeBestanden: ["knowledge/CONSTRAINTS/CON-1.md"], taken: [], toetsing: null }));
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
  });
});

describe("meerdere taken in één PR", () => {
  const tweede: Autorisatie = { ...autorisatie, id: "44444444-4444-4444-4444-444444444444", taak: "T-20260913-twee", scope_hash: scopeHash("twee") };
  it("vraagt voor elke taak een akkoord met ongewijzigde scope", () => {
    const beide = feiten({ taken: [...feiten().taken, { taak: "T-20260913-twee", autorisatie: tweede, scopeHashKop: scopeHash("twee") }] });
    expect(beoordeelAttestatie(beide)).toEqual([]);
    expect(attestatieInhoud(beide).taken).toBe("T-20260913-proef+T-20260913-twee");
    expect(attestatieInhoud(beide).autorisaties).toBe(`${autorisatie.id}+${tweede.id}`);
    const half = feiten({ taken: [...feiten().taken, { taak: "T-20260913-twee", autorisatie: null, scopeHashKop: scopeHash("twee") }] });
    expect(beoordeelAttestatie(half)).toContainEqual(expect.stringMatching(/geen akkoord van de eigenaar op taak T-20260913-twee/));
  });
  it("verifieert een attestatie met twee taken paarsgewijs", () => {
    const beide = feiten({ taken: [...feiten().taken, { taak: "T-20260913-twee", autorisatie: tweede, scopeHashKop: scopeHash("twee") }] });
    const inhoud = attestatieInhoud(beide);
    const rijen = new Map<string, Autorisatie | null>([[autorisatie.id, autorisatie], [tweede.id, tweede]]);
    expect(verifieerAttestatie(inhoud, KOP, rijen, toetsing)).toEqual([]);
    expect(verifieerAttestatie(inhoud, KOP, new Map([[autorisatie.id, autorisatie]]), toetsing)).toContainEqual(expect.stringMatching(/bestaat niet/));
    expect(verifieerAttestatie({ ...inhoud, scope: `${scopeHash(SCOPE)}` }, KOP, rijen, toetsing)).toContainEqual(expect.stringMatching(/paarsgewijs/));
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
    expect(beoordeelAttestatie(metTaak({ autorisatie: null }))).toContainEqual(expect.stringMatching(/geen akkoord/));
  });
  it("weigert wanneer de scope sinds het akkoord veranderde", () => {
    const uit = beoordeelAttestatie(metTaak({ scopeHashKop: scopeHash(`${SCOPE}\nMeer.\n`) }));
    expect(uit).toContainEqual(expect.stringMatching(/scope .* is veranderd/));
  });
  it("weigert zonder dossier op de kop", () => {
    expect(beoordeelAttestatie(metTaak({ scopeHashKop: null }))).toContainEqual(expect.stringMatching(/opdracht\.md ontbreekt/));
  });
  it("weigert zonder GO op precies de kop", () => {
    expect(beoordeelAttestatie(feiten({ toetsing: null }))).toContainEqual(expect.stringMatching(/geen toetsing/));
    expect(beoordeelAttestatie(feiten({ toetsing: { ...toetsing, commit_sha: ANDERE } }))).toContainEqual(
      expect.stringMatching(/hoort niet bij deze pull request/),
    );
    expect(beoordeelAttestatie(feiten({ toetsing: { ...toetsing, pr_nummer: 8 } }))).toContainEqual(
      expect.stringMatching(/hoort niet bij deze pull request/),
    );
  });
  it("weigert zonder taak, zonder bestanden, met een akkoord voor een andere taak, en met een pr-akkoord op een ander nummer", () => {
    expect(beoordeelAttestatie(feiten({ taken: [], taakRedenen: [] }))).toContainEqual(expect.stringMatching(/geen taak bekend/));
    expect(beoordeelAttestatie(feiten({ gewijzigdeBestanden: [] }))).toContainEqual(expect.stringMatching(/geen bestanden/));
    expect(beoordeelAttestatie(metTaak({ autorisatie: { ...autorisatie, taak: "T-anders" } }))).toContainEqual(
      expect.stringMatching(/geen taakakkoord voor/),
    );
    const apart: Autorisatie = { ...autorisatie, id: "3", soort: "pr", pr_repo: "eigenaar/proef", pr_nummer: 8, commit_sha: KOP };
    expect(beoordeelAttestatie(feiten({ gewijzigdeBestanden: [".env"], autorisatiePr: apart }))).toContainEqual(
      expect.stringMatching(/harde uitzondering/),
    );
    expect(beoordeelAttestatie(feiten({ checks: [{ naam: "poort", status: "in_progress", conclusie: null }] }))).toContainEqual(
      expect.stringMatching(/nog niet klaar/),
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
  const inhoud = attestatieInhoud(feiten());
  const rijen = new Map<string, Autorisatie | null>([[autorisatie.id, autorisatie]]);
  it("is na schrijven weer te lezen", () => {
    expect(leesAttestatie(attestatieTekst(inhoud))).toEqual(inhoud);
  });
  it("leest alleen de eerste regel en weigert andere teksten", () => {
    expect(leesAttestatie(`${attestatieTekst(inhoud)}\n\nnaschrift`)).toEqual(inhoud);
    expect(leesAttestatie("LGTM")).toBeNull();
    expect(leesAttestatie("Attestatie (DEC-0043): kapot")).toBeNull();
    // Een korte kop, een korte scope, of de attestatie pas op een latere regel: geen attestatie.
    expect(leesAttestatie(attestatieTekst({ ...inhoud, kop: KOP.slice(0, 7) }))).toBeNull();
    expect(leesAttestatie(attestatieTekst({ ...inhoud, scope: "abc" }))).toBeNull();
    expect(leesAttestatie(`naschrift\n${attestatieTekst(inhoud)}`)).toBeNull();
    expect(leesAttestatie(`x ${attestatieTekst(inhoud)}`)).toBeNull();
  });
  it("verifieert tegen de database", () => {
    expect(inhoud).toMatchObject({ taken: "T-20260913-proef", autorisaties: autorisatie.id, scope: scopeHash(SCOPE), toetsing: toetsing.id, kop: KOP, uitzonderingen: "geen" });
    expect(verifieerAttestatie(inhoud, KOP, rijen, toetsing)).toEqual([]);
    expect(verifieerAttestatie(inhoud, ANDERE, rijen, toetsing)[0]).toMatch(/hoort bij/);
    expect(verifieerAttestatie(inhoud, KOP, new Map([[autorisatie.id, null]]), toetsing)).toContainEqual(expect.stringMatching(/bestaat niet/));
    expect(verifieerAttestatie(inhoud, KOP, new Map([[autorisatie.id, { ...autorisatie, scope_hash: "x" }]]), toetsing)).toContainEqual(
      expect.stringMatching(/scope/),
    );
    expect(verifieerAttestatie(inhoud, KOP, rijen, { ...toetsing, oordeel: "NO-GO" })).toContainEqual(
      expect.stringMatching(/geen GO/),
    );
    // Een administratieve attestatie noemt niets en heeft niets nodig.
    expect(verifieerAttestatie({ ...inhoud, taken: "administratief", autorisaties: "-", scope: "-", toetsing: "-" }, KOP, new Map(), null)).toEqual([]);
    expect(verifieerAttestatie({ ...inhoud, taken: "administratief" }, KOP, new Map(), null)[0]).toMatch(/administratieve attestatie/);
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
  it("telt een goedkeuring van de bot zelf of van een derde nooit", () => {
    const bot = { ...basis, reviews: [{ gebruiker: "de-bot", staat: "APPROVED", commit: KOP }] };
    expect(beoordeelSamenvoegen(bot, "eigenaar", [KOP])[0]).toMatch(/geen goedkeurende review/);
    const derde = { ...basis, reviews: [{ gebruiker: "voorbijganger", staat: "APPROVED", commit: KOP }] };
    expect(beoordeelSamenvoegen(derde, "eigenaar", [KOP])[0]).toMatch(/geen goedkeurende review/);
  });
});

describe("laatstePerNaam", () => {
  it("laat een geannuleerde run die door een geslaagde is opgevolgd niet meetellen", () => {
    const pr: PullRequestFeiten = {
      nummer: 7,
      auteur: "de-bot",
      kop: KOP,
      basis: "main",
      open: true,
      concept: false,
      samenvoegbaar: true,
      samenvoegStaat: "clean",
      reviews: [{ gebruiker: "eigenaar", staat: "APPROVED", commit: KOP }],
      checks: [
        { naam: "poort", status: "completed", conclusie: "cancelled", gestart: "2026-09-13T19:00:00Z" },
        { naam: "poort", status: "completed", conclusie: "success", gestart: "2026-09-13T19:01:00Z" },
      ],
    };
    expect(beoordeelSamenvoegen(pr, "eigenaar")).toEqual([]);
    // Andersom — de laatste run is geannuleerd — blijft geweigerd.
    const omgekeerd = { ...pr, checks: [...pr.checks].reverse().map((c, i) => ({ ...c, gestart: `2026-09-13T19:0${i}:00Z` })) };
    expect(beoordeelSamenvoegen(omgekeerd, "eigenaar")[0]).toMatch(/niet geslaagd \(cancelled\)/);
    // Alleen een opgevolgde geannuleerde run valt weg; een rode run blijft altijd staan (QA N-1).
    expect(laatstePerNaam([{ naam: "a", status: "completed", conclusie: "cancelled" }, { naam: "a", status: "completed", conclusie: "success" }]).map((c) => c.conclusie)).toEqual(["success"]);
    expect(laatstePerNaam([{ naam: "a", status: "completed", conclusie: "failure" }, { naam: "a", status: "completed", conclusie: "success" }]).map((c) => c.conclusie)).toEqual(["failure", "success"]);
    const overstemd = { ...pr, checks: [
      { naam: "poort", status: "completed", conclusie: "failure", gestart: "2026-09-13T19:00:00Z" },
      { naam: "poort", status: "completed", conclusie: "success", gestart: "2026-09-13T19:01:00Z" },
    ] };
    expect(beoordeelSamenvoegen(overstemd, "eigenaar")[0]).toMatch(/niet geslaagd \(failure\)/);
    // Een geannuleerde run zonder opvolger blijft rood.
    expect(laatstePerNaam([{ naam: "a", status: "completed", conclusie: "cancelled" }])).toHaveLength(1);
    // De attestatie kijkt op dezelfde manier.
    expect(beoordeelAttestatie(feiten({ checks: pr.checks }))).toEqual([]);
  });
});

describe("REST-paden", () => {
  it("bouwen een filter op taak, respectievelijk repository, nummer en kop", () => {
    expect(restPadAutorisatieTaak("T-1")).toBe("autorisaties_open?soort=eq.taak&taak=eq.T-1&order=op.desc&limit=1");
    expect(restPadToetsingKop("e/r", 7, KOP)).toContain("pr_repo=eq.e%2Fr&pr_nummer=eq.7&commit_sha=eq.");
  });
});
