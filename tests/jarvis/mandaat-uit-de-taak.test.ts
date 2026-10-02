/**
 * Eén akkoord op een afgebakende taak, in plaats van één per pull request.
 *
 * `DEC-0043` §2 eiste tot nu toe een apart akkoord van de eigenaar op élke
 * kop die een harde uitzondering raakt. Binnen één taak die nu eenmaal
 * workflows en governanceconfiguratie moet aanpassen, betekende dat vier
 * akkoorden voor vier pull requests die allemaal binnen diezelfde
 * goedgekeurde opdracht vielen. De eigenaar wees dat op 2026-10-02 aan als
 * het tegenovergestelde van wat hij wil.
 *
 * De oplossing verplaatst de vraag naar voren: het dossier kondigt in zijn
 * front-matter aan welke soorten het raakt, en de eigenaar keurt dát goed.
 * Wat dit veilig houdt is de scope-hash — die gaat over `opdracht.md` als
 * geheel, dus een aankondiging erbij schrijven laat het akkoord vervallen.
 *
 * Deze tests leggen beide kanten vast: dat het mandaat werkt, en dat het
 * niet verder reikt dan wat de eigenaar heeft gezien.
 */
import { describe, expect, it } from "vitest";
import {
  beoordeelAttestatie,
  gemandateerdeUitzonderingen,
  scopeHash,
  soortenHardeUitzondering,
  uitzonderingenInAttestatie,
  type AttestatieFeiten,
  type Autorisatie,
  type TaakFeiten,
  type Toetsing,
} from "@/jarvis/src/attestatie";

const KOP = "a".repeat(40);
const SCOPE = "---\nid: T-proef\nuitzonderingen: [workflows en repository-automatisering]\n---\n\nIets.\n";

const autorisatie: Autorisatie = {
  id: "11111111-1111-1111-1111-111111111111",
  soort: "taak",
  project: "proef",
  taak: "T-proef",
  scope_hash: scopeHash(SCOPE),
  pr_repo: null,
  pr_nummer: null,
  commit_sha: null,
  op: "2026-10-02T07:49:22.046Z",
};

const toetsing: Toetsing = {
  id: "22222222-2222-2222-2222-222222222222",
  pr_repo: "eigenaar/repo",
  pr_nummer: 7,
  commit_sha: KOP,
  oordeel: "GO",
  rapport: null,
  door: "cloud",
  op: "2026-10-02T12:00:00.000Z",
};

const taak = (over: Partial<TaakFeiten> = {}): TaakFeiten => ({
  taak: "T-proef",
  autorisatie,
  scopeHashKop: scopeHash(SCOPE),
  aangekondigdeUitzonderingen: ["workflows en repository-automatisering"],
  ...over,
});

const feiten = (over: Partial<AttestatieFeiten> = {}): AttestatieFeiten => ({
  nummer: 7,
  auteur: "een-bot",
  botLogin: "een-bot",
  kop: KOP,
  repo: "eigenaar/repo",
  taken: [taak()],
  taakRedenen: [],
  toetsing,
  gewijzigdeBestanden: [".github/workflows/iets.yml"],
  prTekst: "Uitzonderingen: .github/workflows",
  autorisatiePr: null,
  checks: [{ naam: "poort", status: "completed", conclusie: "success" }],
  verplichteCheck: "poort",
  ...over,
});

describe("soortenHardeUitzondering", () => {
  it("geeft de soort terug, niet het pad", () => {
    expect(soortenHardeUitzondering([".github/workflows/a.yml", ".github/workflows/b.yml"])).toEqual([
      "workflows en repository-automatisering",
    ]);
  });

  it("geeft niets terug voor een gewoon bestand", () => {
    expect(soortenHardeUitzondering(["src/iets.ts"])).toEqual([]);
  });

  it("neemt een projectpad mee als eigen soort", () => {
    expect(soortenHardeUitzondering(["vercel.json"], ["vercel.json"])).toEqual(["projectregel: vercel.json"]);
  });
});

describe("gemandateerdeUitzonderingen", () => {
  it("geeft wat het goedgekeurde dossier aankondigt", () => {
    expect(gemandateerdeUitzonderingen([taak()])).toEqual(["workflows en repository-automatisering"]);
  });

  it("geeft niets zonder akkoord — een aankondiging alleen is geen mandaat", () => {
    expect(gemandateerdeUitzonderingen([taak({ autorisatie: null })])).toEqual([]);
  });

  it("geeft niets wanneer de scope sinds het akkoord is veranderd", () => {
    // Dit is de hele waarborg: wie een soort bijschrijft, verandert de hash.
    expect(gemandateerdeUitzonderingen([taak({ scopeHashKop: scopeHash(`${SCOPE}meer`) })])).toEqual([]);
  });

  it("geeft niets wanneer het dossier niet is gevonden", () => {
    expect(gemandateerdeUitzonderingen([taak({ scopeHashKop: null })])).toEqual([]);
  });
});

describe("beoordeelAttestatie met mandaat uit de taak", () => {
  it("attesteert een uitzondering die de taak aankondigt, zonder apart akkoord", () => {
    expect(beoordeelAttestatie(feiten())).toEqual([]);
  });

  it("weigert een uitzondering die de taak NIET aankondigt", () => {
    // jarvis.config.yml is een andere soort dan workflows; het mandaat dekt
    // hem niet, en dan geldt de oude weg.
    const uit = beoordeelAttestatie(feiten({ gewijzigdeBestanden: ["jarvis.config.yml"] }));
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
  });

  it("weigert zodra één van meerdere soorten niet is aangekondigd", () => {
    const uit = beoordeelAttestatie(feiten({ gewijzigdeBestanden: [".github/workflows/a.yml", "jarvis.config.yml"] }));
    expect(uit).toContainEqual(expect.stringMatching(/governanceconfiguratie/));
  });

  it("weigert wanneer het akkoord op de taak ontbreekt, ook al kondigt het dossier het aan", () => {
    const uit = beoordeelAttestatie(feiten({ taken: [taak({ autorisatie: null })] }));
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
  });

  it("weigert wanneer de scope is veranderd sinds het akkoord", () => {
    const uit = beoordeelAttestatie(feiten({ taken: [taak({ scopeHashKop: scopeHash(`${SCOPE}meer`) })] }));
    expect(uit).toContainEqual(expect.stringMatching(/scope .* is veranderd/));
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
  });

  it("laat een apart akkoord op de kop nog gewoon werken", () => {
    const apart: Autorisatie = { ...autorisatie, id: "33333333-3333-3333-3333-333333333333", soort: "pr", pr_repo: "eigenaar/repo", pr_nummer: 7, commit_sha: KOP };
    const uit = beoordeelAttestatie(feiten({ taken: [taak({ aangekondigdeUitzonderingen: [] })], autorisatiePr: apart }));
    expect(uit).toEqual([]);
  });

  it("dekt niets af wanneer de PR-tekst een uitzondering verklaart die geen bestand raakt", () => {
    // Anders zou een verklaring in vrije tekst mandaat kunnen oproepen voor
    // iets wat nergens in de diff staat.
    const uit = beoordeelAttestatie(feiten({ gewijzigdeBestanden: ["src/iets.ts"], prTekst: "Uitzonderingen: van alles" }));
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
  });
});

describe("de attestatietekst noemt waarop is geattesteerd", () => {
  it("noemt het aparte akkoord wanneer dat er is", () => {
    const apart: Autorisatie = { ...autorisatie, id: "33333333-3333-3333-3333-333333333333", soort: "pr", pr_repo: "eigenaar/repo", pr_nummer: 7, commit_sha: KOP };
    expect(uitzonderingenInAttestatie(feiten({ autorisatiePr: apart }))).toContain("apart akkoord");
  });

  it("noemt het mandaat van de taak wanneer dat de grond is", () => {
    expect(uitzonderingenInAttestatie(feiten())).toBe("mandaat uit T-proef");
  });

  it("zegt geen wanneer er niets wordt geraakt", () => {
    expect(uitzonderingenInAttestatie(feiten({ gewijzigdeBestanden: ["src/iets.ts"] }))).toBe("geen");
  });
});
