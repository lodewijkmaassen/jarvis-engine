import { describe, expect, it } from "vitest";
import {
  akkoordOpDezeKop,
  alleenStatusVerschil,
  herschrevenScope,
  isAdministratievePr,
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
  it("vraagt geen trailer van een mergecommit, maar wel werk naast de merges", () => {
    const merge = { sha: ANDERE, boodschap: "Merge remote-tracking branch 'origin/main' into jarvis/x", ouders: 2 };
    const werk = { sha: KOP, boodschap: "Iets\n\nJarvis-Task: T-1\n", ouders: 1 };
    expect(takenUitCommits([merge, werk])).toEqual({ taken: ["T-1"], redenen: [] });
    expect(takenUitCommits([merge]).redenen).toEqual(["de pull request bevat alleen mergecommits en geen werk"]);
    // Zonder ouders-informatie blijft de strenge regel gelden.
    expect(takenUitCommits([{ sha: ANDERE, boodschap: merge.boodschap }]).redenen[0]).toMatch(/geen of meer dan/);
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
  it("herkent een randvoorwaarde aan haar naam, in elke map en elke kast (QA-bevinding PR #16)", () => {
    for (const pad of ["knowledge/DECISIONS/CON-0099.md", "knowledge/constraints/regel.md", "kennis/REGELS/con-0001.md", "knowledge/x/y/CON-7.md"]) {
      expect(raaktHardeUitzondering([pad]).length, pad).toBe(1);
      const uit = beoordeelAttestatie(feiten({ gewijzigdeBestanden: [pad], taken: [], toetsing: null }));
      expect(uit, pad).toContainEqual(expect.stringMatching(/harde uitzondering/));
    }
    // Een gewoon besluit blijft administratief.
    expect(beoordeelAttestatie(feiten({ gewijzigdeBestanden: ["knowledge/DECISIONS/DEC-0044.md"], taken: [], toetsing: null }))).toEqual([]);
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
    // De cloud-uitvoerder opent onder de identiteit van het platform; die staat in de configuratie.
    expect(beoordeelAttestatie(feiten({ auteur: "claude[bot]", uitvoerders: ["claude[bot]"] }))).toEqual([]);
    expect(beoordeelAttestatie(feiten({ auteur: "claude[bot]" }))[0]).toMatch(/niet de bot/);
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
    // Een opgevolgde geannuleerde run valt weg, ook zonder bekende herkomst.
    expect(laatstePerNaam([{ naam: "a", status: "completed", conclusie: "cancelled" }, { naam: "a", status: "completed", conclusie: "success" }]).map((c) => c.conclusie)).toEqual(["success"]);
    // Zonder herkomst blijft een rode run staan: er is niets dat haar aantoonbaar vervangt.
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

describe("laatstePerNaam met herkomst", () => {
  const groen = (naam: string, herkomst: string | null, gestart: string) => ({
    naam,
    status: "completed",
    conclusie: "success",
    gestart,
    herkomst,
  });
  const rood = (naam: string, herkomst: string | null, gestart: string) => ({
    naam,
    status: "completed",
    conclusie: "failure",
    gestart,
    herkomst,
  });

  it("laat een rode run vervallen voor een latere geldige run van dezelfde workflow", () => {
    // De kop van ToVas Flow-#230: dezelfde workflow draaide op push, op
    // pull_request en op pull_request_review; alleen de middelste was rood.
    const checks = [
      groen("poort", "354869867", "2026-09-29T05:21:35Z"),
      rood("poort", "354869867", "2026-09-29T05:21:37Z"),
      groen("poort", "354869867", "2026-09-29T05:44:41Z"),
    ];
    expect(laatstePerNaam(checks).map((c) => c.gestart)).toEqual(["2026-09-29T05:44:41Z"]);
  });

  it("laat een rode run NIET vervallen voor een groene uit een andere workflow (QA N-1)", () => {
    const checks = [rood("poort", "111", "2026-09-29T05:00:00Z"), groen("poort", "222", "2026-09-29T06:00:00Z")];
    expect(laatstePerNaam(checks).map((c) => c.conclusie)).toEqual(["failure", "success"]);
  });

  it("laat niets vervallen zolang de herkomst onbekend of leeg is", () => {
    expect(laatstePerNaam([rood("poort", null, "1"), groen("poort", null, "2")])).toHaveLength(2);
    expect(laatstePerNaam([rood("poort", "", "1"), groen("poort", "", "2")])).toHaveLength(2);
    expect(laatstePerNaam([rood("poort", "9", "1"), groen("poort", null, "2")])).toHaveLength(2);
  });

  it("laat een eerdere run niet vervallen voor een LATERE run die zelf geen geldig resultaat is", () => {
    // Een afgebroken run vervangt niets; de rode ervoor blijft dus blokkeren.
    const checks = [
      rood("poort", "354869867", "2026-09-29T05:00:00Z"),
      { naam: "poort", status: "completed", conclusie: "cancelled", gestart: "2026-09-29T06:00:00Z", herkomst: "354869867" },
    ];
    expect(laatstePerNaam(checks).map((c) => c.conclusie)).toEqual(["failure", "cancelled"]);
  });

  it("laat een nog lopende run de eerdere vervangen, zodat de poort op wachten uitkomt", () => {
    const checks = [
      rood("poort", "354869867", "2026-09-29T05:00:00Z"),
      { naam: "poort", status: "in_progress", conclusie: null, gestart: "2026-09-29T06:00:00Z", herkomst: "354869867" },
    ];
    expect(laatstePerNaam(checks).map((c) => c.status)).toEqual(["in_progress"]);
  });

  it("raakt runs met verschillende namen niet", () => {
    const checks = [rood("lint-test-build", "1", "1"), groen("poort", "1", "2")];
    expect(laatstePerNaam(checks)).toHaveLength(2);
  });

  it("maakt #230 samenvoegbaar zonder aan de autorisatie te raken", () => {
    const kop = KOP;
    const basis: PullRequestFeiten = {
      nummer: 230,
      auteur: "de-bot",
      kop,
      basis: "main",
      open: true,
      concept: false,
      samenvoegbaar: true,
      samenvoegStaat: "clean",
      reviews: [{ gebruiker: "eigenaar", staat: "APPROVED", commit: kop }],
      checks: [
        groen("poort", "354869867", "2026-09-29T05:21:35Z"),
        rood("poort", "354869867", "2026-09-29T05:21:37Z"),
        groen("poort", "354869867", "2026-09-29T05:44:41Z"),
        groen("lint-test-build", "354869868", "2026-09-29T05:21:37Z"),
      ],
    };
    expect(beoordeelSamenvoegen(basis, "eigenaar")).toEqual([]);
    // Zonder goedkeuring van de eigenaar blijft het antwoord hetzelfde als eerst.
    expect(beoordeelSamenvoegen({ ...basis, reviews: [] }, "eigenaar")[0]).toMatch(/geen goedkeurende review/);
  });
});

/**
 * Het gat dat QA op 2026-10-02 vond, en de dichting ervan.
 *
 * `DEC-0044` laat een administratieve pull request door zonder taakakkoord,
 * zonder scopevergelijking en zonder onafhankelijke toetsing. `tasks/` viel
 * daar volledig onder — ook `tasks/<taak>/opdracht.md`, de tekst waarvan de
 * hash het akkoord van de eigenaar draagt en die sinds de aankondiging van
 * harde uitzonderingen ook de omvang van het mandaat vastlegt. Een pull
 * request die precies dat bestand herschreef, kreeg in een consumentproject
 * de review `taken administratief · autorisaties - · scope - · toetsing -`.
 *
 * Dat is geen weg om stiekem mandaat te winnen — de hash klopt daarna niet
 * meer, dus het akkoord vervalt en de eigenaar ziet de nieuwe tekst voordat
 * hij opnieuw autoriseert. Het gat zit ervóór: die nieuwe tekst werd zonder
 * toetsing en zonder zijn medeweten geschreven.
 */
describe("de opdrachttekst is geen administratieve wijziging", () => {
  const SCOPEPATROON = /^tasks\/[^/]+\/opdracht\.md$/;
  const dossierPr = (status: string, bestanden = ["tasks/T-20260913-proef/opdracht.md"]) =>
    feiten({
      gewijzigdeBestanden: bestanden,
      bestandStatus: Object.fromEntries(bestanden.map((b) => [b, status])),
      scopeBestandPatroon: SCOPEPATROON,
      // Zoals bij een herschreven opdracht: de kop draagt een andere tekst dan
      // waarop het akkoord staat, en er is geen toetsing.
      taken: [{ taak: "T-20260913-proef", autorisatie, scopeHashKop: scopeHash(`${SCOPE}\nextra\n`) }],
      toetsing: null,
    });

  it("laat een bestaand dossier herschrijven niet als administratief gelden", () => {
    const f = dossierPr("modified");
    expect(isAdministratievePr(f)).toBe(false);
    expect(herschrevenScope(f)).toEqual(["tasks/T-20260913-proef/opdracht.md"]);
    const redenen = beoordeelAttestatie(f);
    expect(redenen.join(" | ")).toMatch(/herschrijft tasks\/T-20260913-proef\/opdracht\.md/);
    expect(redenen.join(" | "), "de scope hoort ook gewoon te worden vergeleken").toMatch(/de scope van T-20260913-proef is veranderd/);
    expect(redenen.join(" | "), "en een toetsing hoort te worden geëist").toMatch(/geen toetsing met oordeel GO/);
  });

  it("laat een nieuw dossier wél administratief zijn — het mandateert nog niets", () => {
    const f = dossierPr("added");
    expect(herschrevenScope(f)).toEqual([]);
    expect(isAdministratievePr(f)).toBe(true);
    expect(beoordeelAttestatie(f)).toEqual([]);
  });

  it("telt een hernoemd dossier als herschreven", () => {
    expect(herschrevenScope(dossierPr("renamed"))).toHaveLength(1);
  });

  it("telt een bestand zonder bekende status als herschreven — onbekend is nooit het soepelst", () => {
    const f = feiten({
      gewijzigdeBestanden: ["tasks/T-20260913-proef/opdracht.md"],
      scopeBestandPatroon: SCOPEPATROON,
      toetsing: null,
    });
    expect(f.bestandStatus).toBeUndefined();
    expect(herschrevenScope(f)).toHaveLength(1);
    expect(isAdministratievePr(f)).toBe(false);
  });

  it("raakt de rest van een administratieve pull request niet", () => {
    const f = feiten({
      gewijzigdeBestanden: ["tasks/T-20260913-proef/resultaat.md", "knowledge/RISKS/RSK-0001.md"],
      bestandStatus: { "tasks/T-20260913-proef/resultaat.md": "modified", "knowledge/RISKS/RSK-0001.md": "modified" },
      scopeBestandPatroon: SCOPEPATROON,
      toetsing: null,
    });
    expect(herschrevenScope(f)).toEqual([]);
    expect(isAdministratievePr(f)).toBe(true);
    expect(beoordeelAttestatie(f)).toEqual([]);
  });

  it("valt dicht, niet open, wanneer er geen scopepatroon is meegegeven", () => {
    // Deze test legde eerder het omgekeerde vast — een ontbrekend patroon gaf
    // een lege lijst en dus de soepelste uitkomst, in tegenspraak met de regel
    // één test hoger. Wie het patroon vergeet mee te geven hoort een
    // strengere beoordeling te krijgen, geen ruimere.
    const f = feiten({
      gewijzigdeBestanden: ["tasks/T-20260913-proef/opdracht.md"],
      bestandStatus: { "tasks/T-20260913-proef/opdracht.md": "modified" },
      toetsing: null,
    });
    expect(f.scopeBestandPatroon).toBeUndefined();
    expect(herschrevenScope(f)).toEqual(["tasks/T-20260913-proef/opdracht.md"]);
    expect(isAdministratievePr(f)).toBe(false);
  });

  it("ziet een hoofdlettervariant van de bestandsnaam ook", () => {
    // `tasks/<taak>/Opdracht.md` kwam er administratief doorheen. Dezelfde
    // ongevoeligheid die HARDE_UITZONDERINGEN al voor CON-records heeft.
    const bestanden = ["tasks/T-20260913-proef/Opdracht.md"];
    const f = feiten({
      gewijzigdeBestanden: bestanden,
      bestandStatus: { [bestanden[0]!]: "modified" },
      scopeBestandPatroon: /^tasks\/[^/]+\/opdracht\.md$/i,
      toetsing: null,
    });
    expect(herschrevenScope(f)).toEqual(bestanden);
    expect(isAdministratievePr(f)).toBe(false);
  });

  it("laat een wijziging die alleen de statusregel raakt administratief blijven", () => {
    const bestand = "tasks/T-20260913-proef/opdracht.md";
    const f = feiten({
      gewijzigdeBestanden: [bestand],
      bestandStatus: { [bestand]: "modified" },
      scopeBestandPatroon: SCOPEPATROON,
      alleenStatusregel: [bestand],
      toetsing: null,
    });
    expect(herschrevenScope(f)).toEqual([]);
    expect(isAdministratievePr(f)).toBe(true);
    expect(beoordeelAttestatie(f)).toEqual([]);
  });

});

describe("alleenStatusVerschil — een dossier sluiten is boekhouding", () => {
  const dossier = (status: string, staart = "## Wat\n\nIets.\n") =>
    `---\nid: T-20260913-proef\ntitel: Proef\nstatus: ${status}\nklasse: S\n---\n\n${staart}`;

  it("herkent een statusovergang als enige verschil", () => {
    for (const naar of ["review", "afgerond", "vervallen", "geblokkeerd"]) {
      expect(alleenStatusVerschil(dossier("actief"), dossier(naar)), `naar ${naar}`).toBe(true);
    }
  });

  it("telt een identiek bestand niet als statuswijziging", () => {
    expect(alleenStatusVerschil(dossier("actief"), dossier("actief"))).toBe(false);
  });

  it("weigert zodra er ook maar één andere regel verandert", () => {
    expect(alleenStatusVerschil(dossier("actief"), dossier("afgerond", "## Wat\n\nIets anders.\n"))).toBe(false);
  });

  it("weigert een regel erbij of eraf, ook met dezelfde status", () => {
    expect(alleenStatusVerschil(dossier("actief"), `${dossier("afgerond")}extra\n`)).toBe(false);
    expect(alleenStatusVerschil(`${dossier("actief")}extra\n`, dossier("afgerond"))).toBe(false);
  });

  it("weigert een statuswoord dat niet bestaat", () => {
    expect(alleenStatusVerschil(dossier("actief"), dossier("ongeldig"))).toBe(false);
  });

  it("weigert een wijziging buiten de front-matter, ook als zij op status lijkt", () => {
    const oud = `---\nid: T\nstatus: actief\n---\n\nstatus: actief\n`;
    const nieuw = `---\nid: T\nstatus: actief\n---\n\nstatus: afgerond\n`;
    expect(alleenStatusVerschil(oud, nieuw)).toBe(false);
  });

  it("weigert een andere sleutel die toevallig op dezelfde regel staat", () => {
    const oud = `---\nid: T\nklasse: S\n---\n\ntekst\n`;
    const nieuw = `---\nid: T\nklasse: L\n---\n\ntekst\n`;
    expect(alleenStatusVerschil(oud, nieuw)).toBe(false);
  });

  it("weigert een bestand zonder front-matter", () => {
    expect(alleenStatusVerschil("status: actief\n", "status: afgerond\n")).toBe(false);
  });

  it("behandelt CRLF en LF als hetzelfde", () => {
    expect(alleenStatusVerschil(dossier("actief").replace(/\n/g, "\r\n"), dossier("afgerond"))).toBe(true);
  });
});

describe("de uitweg die DEC-0043 §2 belooft, bestaat ook werkelijk", () => {
  const bestand = "tasks/T-20260913-proef/opdracht.md";
  const herschrijving = (over: Partial<AttestatieFeiten> = {}) =>
    feiten({
      gewijzigdeBestanden: [bestand],
      bestandStatus: { [bestand]: "modified" },
      scopeBestandPatroon: /^tasks\/[^/]+\/opdracht\.md$/i,
      taken: [{ taak: "T-20260913-proef", autorisatie, scopeHashKop: scopeHash(`${SCOPE}\nextra\n`) }],
      toetsing: null,
      ...over,
    });
  const prAkkoord = (over: Partial<Autorisatie> = {}): Autorisatie => ({
    ...autorisatie,
    id: "33333333-3333-3333-3333-333333333333",
    soort: "pr",
    scope_hash: null,
    pr_repo: "eigenaar/proef",
    pr_nummer: 7,
    commit_sha: KOP,
    ...over,
  });

  it("weigert zonder apart akkoord", () => {
    expect(beoordeelAttestatie(herschrijving()).join(" | ")).toMatch(/herschrijft tasks/);
  });

  it("laat de herschrijving door met een apart akkoord op precies deze kop", () => {
    // Deze reden stond er onvoorwaardelijk, waardoor een herschreven
    // opdrachttekst nóóit geattesteerd kon worden — ook niet met het akkoord
    // dat de tekst eromheen belooft.
    const f = herschrijving({ autorisatiePr: prAkkoord(), toetsing });
    expect(akkoordOpDezeKop(f)).toBe(true);
    expect(beoordeelAttestatie(f).join(" | ")).not.toMatch(/herschrijft tasks/);
  });

  it("telt een akkoord op een andere kop, pull request of repository niet", () => {
    for (const [wat, over] of [
      ["andere kop", { commit_sha: ANDERE }],
      ["ander nummer", { pr_nummer: 8 }],
      ["andere repository", { pr_repo: "iemand/anders" }],
      ["geen pr-soort", { soort: "taak" as const }],
    ] as const) {
      const f = herschrijving({ autorisatiePr: prAkkoord(over), toetsing });
      expect(akkoordOpDezeKop(f), wat).toBe(false);
      expect(beoordeelAttestatie(f).join(" | "), wat).toMatch(/herschrijft tasks/);
    }
  });
});

describe("alleenStatusVerschil — de wachters afzonderlijk", () => {
  // Elk van deze vier wachters overleefde de suite als enige regel die hem
  // tegenhield; ze worden hier stuk voor stuk vastgelegd, zodat een geval dat
  // nu door een ándere wachter wordt gevangen dat niet verhult.

  it("laat een `---` verderop in de tekst de front-matter niet oprekken", () => {
    // Het lek dat QA vond: de front-matter is niet gesloten, en een `---`
    // verderop verschoof de grens, waardoor een statusregel in de hoofdtekst
    // als front-matter telde.
    const oud = "---\nid: T-x\nstatus: actief\n\nAC-1 moet X.\nstatus: actief\n---\n";
    const nieuw = "---\nid: T-x\nstatus: actief\n\nAC-1 moet X.\nstatus: vervallen\n---\n";
    expect(alleenStatusVerschil(oud, nieuw)).toBe(false);
  });

  it("weigert een front-matter die vrije tekst of een lege regel bevat", () => {
    const oud = "---\nid: T-x\nstatus: actief\n\nvrije tekst\n---\n";
    const nieuw = "---\nid: T-x\nstatus: afgerond\n\nvrije tekst\n---\n";
    expect(alleenStatusVerschil(oud, nieuw)).toBe(false);
  });

  it("laat een lijstitem in de front-matter wél toe — dat hoort erbij", () => {
    const met = (status: string) => `---\nid: T-x\nstatus: ${status}\ngebieden:\n  - jarvis\n  - ci\n---\n\ntekst\n`;
    expect(alleenStatusVerschil(met("actief"), met("afgerond"))).toBe(true);
  });

  it("de regelaantalcontrole staat op zichzelf: een regel erbij ná de statusregel", () => {
    // Beide versies hebben een geldige front-matter en het enige tekstuele
    // verschil zit vóór de sluitstreep; alleen de regelteller houdt dit tegen.
    // Een eerder voorbeeld hier werd al door `i >= eind` gevangen en pinde de
    // teller dus niet — precies de faalvorm die de vorige ronde benoemde.
    // De lus loopt over de óúde versie, dus wat achter het einde daarvan is
    // aangehangen ziet zij niet. Zonder afsluitende regeleinde valt die staart
    // precies buiten bereik, en alleen de regelteller houdt hem tegen.
    const oud = "---\nid: T-x\nstatus: actief\n---\ntekst";
    const nieuw = "---\nid: T-x\nstatus: afgerond\n---\ntekst\nAC-9 vervalt.";
    expect(alleenStatusVerschil(oud, nieuw)).toBe(false);
  });

  it("de eis dat regel 0 `---` is, staat op zichzelf", () => {
    // Zonder die eis zou `indexOf("---", 1)` de éérste streep als sluitstreep
    // nemen en alles ervóór als front-matter tellen. Hier staat de statusregel
    // vóór de openingsstreep, dus met de eis eruit zou dit doorglippen.
    const oud = "status: actief\n---\nid: T-x\n---\ntekst\n";
    const nieuw = "status: afgerond\n---\nid: T-x\n---\ntekst\n";
    expect(alleenStatusVerschil(oud, nieuw)).toBe(false);
  });

  it("weigert elke vorm die geen sleutel of lijstitem is", () => {
    // De drie deelregels van de vormcontrole, elk apart: een lege regel, een
    // lijstitem zonder inspringing, en een sleutel die met een cijfer begint.
    const met = (vreemd: string, status: string) => `---\nid: T-x\nstatus: ${status}\n${vreemd}\n---\n\ntekst\n`;
    for (const vreemd of ["", "- los", "1nummer: x", "# commentaar", "  gevouwen"]) {
      expect(alleenStatusVerschil(met(vreemd, "actief"), met(vreemd, "afgerond")), JSON.stringify(vreemd)).toBe(false);
    }
  });

  it("eist precies één gewijzigde regel, niet minstens één", () => {
    // `gezien >= 1` zou twee statusregels tegelijk laten wijzigen.
    const met = (a: string, b: string) => `---\nid: T-x\nstatus: ${a}\nstatus: ${b}\n---\n\ntekst\n`;
    expect(alleenStatusVerschil(met("actief", "actief"), met("afgerond", "vervallen"))).toBe(false);
  });

  it("de eis dat ook de oude regel een statusregel is, staat op zichzelf", () => {
    const oud = "---\nid: T-x\nklasse: S\n---\ntekst\n";
    const nieuw = "---\nid: T-x\nstatus: afgerond\n---\ntekst\n";
    expect(alleenStatusVerschil(oud, nieuw)).toBe(false);
  });
});
