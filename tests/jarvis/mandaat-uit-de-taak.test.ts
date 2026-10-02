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
  leesUitzonderingenRegel,
  scopeHash,
  soortenHardeUitzondering,
  uitzonderingenInAttestatie,
  type AttestatieFeiten,
  type Autorisatie,
  type TaakFeiten,
  type Toetsing,
} from "@/jarvis/src/attestatie";
import { uitzonderingenUitDossier } from "@/jarvis/src/opdrachten";

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
  prTekst: "Uitzonderingen: workflows en repository-automatisering",
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
    const uit = beoordeelAttestatie(feiten({ gewijzigdeBestanden: ["src/iets.ts"], prTekst: "Uitzonderingen: van alles" }));
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
  });

  it("laat een vrije-tekstverklaring NIET meeliften op een gemandateerde treffer", () => {
    // De gevaarlijkste weg, en de reden dat de verklaring een vaste vorm
    // heeft: een uitzondering zonder bestandspad — een productieactie, een
    // sleutelrotatie — kan alleen via deze regel worden aangekondigd. Zonder
    // deze test glipt zij mee met een workflowwijziging die wél gemandateerd
    // is.
    const uit = beoordeelAttestatie(
      feiten({ prTekst: "Uitzonderingen: rotatie van de productie-deploykey en een handmatige DB-mutatie" }),
    );
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
    expect(uit.join(" ")).toContain("verwacht:");
  });

  it("weigert ook een onjuiste \"Uitzonderingen: geen\" bij een echte treffer", () => {
    const uit = beoordeelAttestatie(feiten({ prTekst: "Uitzonderingen: geen" }));
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
  });

  it("neemt spaties, hoofdletters en een sluitende punt niet zwaar op", () => {
    expect(beoordeelAttestatie(feiten({ prTekst: "Uitzonderingen:   Workflows en  repository-automatisering." }))).toEqual([]);
  });

  it("geeft geen mandaat wanneer er meer dan één taak in de pull request zit", () => {
    // Dan is niet te zien welk bestand bij welke taak hoort, en zou de
    // aankondiging van de ene de andere dekken.
    const tweede = taak({ taak: "T-ander", autorisatie: { ...autorisatie, taak: "T-ander" }, aangekondigdeUitzonderingen: [] });
    const uit = beoordeelAttestatie(feiten({ taken: [taak(), tweede] }));
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
  });

  it("geeft geen mandaat voor een soort die niet bestaat — een typefout dekt niets", () => {
    const uit = beoordeelAttestatie(feiten({ taken: [taak({ aangekondigdeUitzonderingen: ["workflos en repository-automatisering"] })] }));
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
  });

  it("dekt CODEOWNERS niet met een mandaat op workflows", () => {
    // Wie wat mag beoordelen is een andere beslissing dan hoe CI draait.
    const uit = beoordeelAttestatie(feiten({ gewijzigdeBestanden: [".github/CODEOWNERS"], prTekst: "Uitzonderingen: wie wat mag beoordelen" }));
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

/**
 * De enige schakel tussen het goedgekeurde dossier en het mandaat.
 *
 * Deze functie had geen enkele test, terwijl zij bepaalt wat de eigenaar
 * geacht wordt te hebben goedgekeurd. Een vorm die zij verkeerd leest, is een
 * mandaat dat niemand heeft gegeven — of een dat ten onrechte uitblijft.
 */
describe("uitzonderingenUitDossier", () => {
  const dossier = (fm: string) => `---\nid: T-proef\n${fm}\n---\n\nIets.\n`;

  it("leest een inline lijst", () => {
    expect(uitzonderingenUitDossier(dossier("uitzonderingen: [a, b]"))).toEqual(["a", "b"]);
  });

  it("leest een bloklijst", () => {
    expect(uitzonderingenUitDossier(dossier("uitzonderingen:\n  - a\n  - b"))).toEqual(["a", "b"]);
  });

  it("leest één waarde als lijst van één", () => {
    expect(uitzonderingenUitDossier(dossier("uitzonderingen: alleen-dit"))).toEqual(["alleen-dit"]);
  });

  it("geeft niets bij een ontbrekend veld", () => {
    expect(uitzonderingenUitDossier(dossier("klasse: L"))).toEqual([]);
  });

  it("geeft niets bij kapotte front-matter — falen naar minder mandaat", () => {
    expect(uitzonderingenUitDossier("---\n\tfout: tab\n---\n")).toEqual([]);
  });

  it("geeft niets bij een bestand zonder front-matter", () => {
    expect(uitzonderingenUitDossier("# Gewone tekst\n")).toEqual([]);
  });
});

/**
 * De verklaringsregel is sinds het mandaat dragend voor de autorisatie.
 *
 * Daarmee werd het de moeite waard om haar te omzeilen, en dat kon: er werd
 * alleen naar de eerste `Uitzonderingen:`-regel gekeken. Een pull request met
 * de juiste verklaring vooraan en de werkelijke uitzondering — een
 * sleutelrotatie, een productieactie — verderop in de tekst, werd
 * geattesteerd. De uitkomst hing af van de volgorde.
 */
describe("alle verklaringsregels tellen", () => {
  const WORKFLOWS = "workflows en repository-automatisering";

  it("leest één regel zoals voorheen", () => {
    expect(leesUitzonderingenRegel(`Tekst.\n\nUitzonderingen: ${WORKFLOWS}\n`)).toBe(WORKFLOWS);
    expect(leesUitzonderingenRegel("Uitzonderingen: geen\n")).toBe("geen");
  });

  it("weigert wanneer een tweede regel iets anders beweert", () => {
    const tekst = `Uitzonderingen: ${WORKFLOWS}\n\nNog wat tekst.\n\nUitzonderingen: rotatie van de productie-deploykey\n`;
    const gelezen = leesUitzonderingenRegel(tekst);
    expect(gelezen).not.toBe(WORKFLOWS);
    expect(gelezen).toContain("rotatie");
  });

  it("laat zich niet omzeilen door de volgorde", () => {
    // Beide volgordes horen hetzelfde op te leveren; dat was precies wat
    // eerder niet zo was.
    const a = `Uitzonderingen: ${WORKFLOWS}\n\nUitzonderingen: rotatie van de productie-deploykey\n`;
    const b = `Uitzonderingen: rotatie van de productie-deploykey\n\nUitzonderingen: ${WORKFLOWS}\n`;
    expect(leesUitzonderingenRegel(a)).not.toBe(WORKFLOWS);
    expect(leesUitzonderingenRegel(b)).not.toBe(WORKFLOWS);
  });

  it("ziet een tweede regel in elke opmaak die markdown toelaat", () => {
    // De eerste reparatie keek alleen achter spatie, tab, > en - of *.
    // Daarmee bleef dezelfde meelifter gewoon werken achter een kop, een
    // genummerde regel, een tabelstreep of het begin van een commentaar.
    for (const voorvoegsel of ["", "> ", ">> ", "- ", "* ", "+ ", "## ", "### ", "1. ", "2) ", "| ", "<!-- ", "   ", "\t", "- [ ] "]) {
      const tekst = `Uitzonderingen: ${WORKFLOWS}\n\n${voorvoegsel}Uitzonderingen: rotatie van de productie-deploykey\n`;
      expect(leesUitzonderingenRegel(tekst), JSON.stringify(voorvoegsel)).toContain("rotatie");
    }
  });

  it("ziet geen verklaring midden in een zin", () => {
    // Proza bevat letters vóór het woord, dus dat is geen regel maar een
    // verwijzing. Anders zou elke uitleg over het mechanisme een PR blokkeren.
    expect(leesUitzonderingenRegel(`Zie hieronder bij Uitzonderingen: niets aan de hand.\n`)).toBeNull();
  });

  it("neemt een identieke herhaling niet zwaar op", () => {
    const tekst = `Uitzonderingen: ${WORKFLOWS}\n\nSamengevat.\n\nUitzonderingen: ${WORKFLOWS}\n`;
    expect(leesUitzonderingenRegel(tekst)).toBe(WORKFLOWS);
  });

  it("attesteert niet wanneer een tweede regel een andere uitzondering noemt", () => {
    const uit = beoordeelAttestatie(
      feiten({ prTekst: `Uitzonderingen: ${WORKFLOWS}\n\nUitzonderingen: rotatie van de productie-deploykey\n` }),
    );
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
  });
});

/**
 * De scheiding van de soorten zelf.
 *
 * De vorige ronde wees erop dat deze eigenschap werkte maar door geen test
 * werd vastgelegd: de volgorde in `HARDE_UITZONDERINGEN` terugdraaien liet
 * alle tests slagen, omdat de bestaande test eerder op de
 * verklaringsvergelijking strandde.
 */
describe("soorten blijven van elkaar gescheiden", () => {
  it("geeft een pad élke soort die het raakt, niet alleen de eerste", () => {
    // `.github/CODEOWNERS` raakt twee patronen. Eerder won de eerste in de
    // lijst, en dat was een gat: `.github/` matcht ook `.github/.env`,
    // `.github/migrations/` en `.github/CON-*.md`, zodat een mandaat op
    // "workflows" er stilzwijgend secrets, productiedata en
    // governance-records bij kreeg. Nu moeten beide soorten zijn aangekondigd.
    expect([...soortenHardeUitzondering([".github/CODEOWNERS"])].sort()).toEqual(
      ["wie wat mag beoordelen", "workflows en repository-automatisering"].sort(),
    );
  });

  it("laat een mandaat op workflows de smallere soorten onder .github niet dekken", () => {
    // Dit is het gat zelf, in de vier vormen waarin het werd gemeten.
    const gevallen: readonly [string, string][] = [
      [".github/.env", "omgevingsbestanden"],
      [".github/migrations/1.sql", "databasemigraties (productiedata)"],
      [".github/CON-9999.md", "een randvoorwaarde-record, waar het ook staat"],
      [".github/constraints/x.md", "harde randvoorwaarden"],
    ];
    for (const [pad, soort] of gevallen) {
      expect(soortenHardeUitzondering([pad]), pad).toContain(soort);
      const uit = beoordeelAttestatie(
        feiten({
          gewijzigdeBestanden: [pad],
          prTekst: "Uitzonderingen: workflows en repository-automatisering",
          taken: [taak({ aangekondigdeUitzonderingen: ["workflows en repository-automatisering"] })],
        }),
      );
      expect(uit.join(" | "), `${pad} hoort niet gedekt te zijn`).toMatch(/harde uitzondering/);
    }
  });

  it("houdt een gewone workflow bij workflows", () => {
    expect(soortenHardeUitzondering([".github/workflows/a.yml"])).toEqual(["workflows en repository-automatisering"]);
  });

  it("dekt CODEOWNERS niet met een mandaat op workflows, ook met een kloppende verklaring", () => {
    const uit = beoordeelAttestatie(
      feiten({ gewijzigdeBestanden: [".github/CODEOWNERS"], prTekst: "Uitzonderingen: wie wat mag beoordelen" }),
    );
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
  });
});

/**
 * Het filter op bestaande soorten. De vorige ronde noemde het bewijsbaar
 * inert; deze test maakt het dragend door de aankondiging te laten botsen met
 * wat er werkelijk wordt geraakt.
 */
describe("een onbekende soort geeft geen mandaat", () => {
  it("dekt niets wanneer het dossier een soort noemt die niet bestaat", () => {
    const uit = beoordeelAttestatie(
      feiten({
        taken: [taak({ aangekondigdeUitzonderingen: ["workflos en repository-automatisering"] })],
      }),
    );
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
  });

  it("laat een geldige aankondiging naast een onbekende gewoon werken", () => {
    const uit = beoordeelAttestatie(
      feiten({
        taken: [taak({ aangekondigdeUitzonderingen: ["onzin", "workflows en repository-automatisering"] })],
      }),
    );
    expect(uit).toEqual([]);
  });
});

/**
 * De code die de autorisatie beoordeelt, is zelf een harde uitzondering.
 *
 * Dit is de grens die sluit wat het zelfstandig samenvoegen openzette. Zonder
 * haar raakte een pull request die alleen `attestatie.ts` of `pr.ts` wijzigt
 * geen enkele harde uitzondering: hij werd door de poort zelf geattesteerd en
 * samengevoegd, en elke volgende levering werd daarna door de gewijzigde code
 * beoordeeld. Niet in één stap — de beslissende code draait van de
 * hoofdbranch — maar wel in twee.
 *
 * Standaard is zij niet onder een taakmandaat te brengen: een taak moet die
 * soort uitdrukkelijk aankondigen, en dan heeft de eigenaar het gezien in het
 * dossier dat hij goedkeurt.
 */
describe("de beslissende code is een harde uitzondering", () => {
  it("merkt een wijziging in attestatie.ts en in pr.ts", () => {
    expect(soortenHardeUitzondering(["jarvis/src/attestatie.ts"])).toEqual(["de code die de autorisatie beoordeelt"]);
    expect(soortenHardeUitzondering(["jarvis/src/pr.ts"])).toEqual(["de code die de autorisatie beoordeelt"]);
  });

  it("laat gewone enginecode ongemoeid", () => {
    for (const pad of ["jarvis/src/regie.ts", "jarvis/src/uitrol.ts", "tests/jarvis/pr.test.ts"]) {
      expect(soortenHardeUitzondering([pad]), pad).toEqual([]);
    }
  });

  it("weigert zo'n wijziging wanneer de taak de soort niet aankondigt", () => {
    const uit = beoordeelAttestatie(
      feiten({
        gewijzigdeBestanden: ["jarvis/src/attestatie.ts"],
        prTekst: "Uitzonderingen: de code die de autorisatie beoordeelt",
      }),
    );
    expect(uit).toContainEqual(expect.stringMatching(/harde uitzondering/));
  });

  it("laat haar toe wanneer de taak haar wél aankondigt", () => {
    const uit = beoordeelAttestatie(
      feiten({
        taken: [taak({ aangekondigdeUitzonderingen: ["de code die de autorisatie beoordeelt"] })],
        gewijzigdeBestanden: ["jarvis/src/attestatie.ts"],
        prTekst: "Uitzonderingen: de code die de autorisatie beoordeelt",
      }),
    );
    expect(uit).toEqual([]);
  });
});

/**
 * Het scherm waarop de eigenaar tekent, moet zeggen wat hij mandateert.
 *
 * De akkoordkaart beloofde "een harde uitzondering vraagt apart". Zodra een
 * taak er een aankondigt, is dat onwaar: het akkoord dekt die soorten dan
 * juist wel. De aankondiging stond wel in de getoonde tekst, maar ongemarkeerd
 * in een front-matter van elf regels, onder een onderschrift dat haar
 * tegensprak. Dat is geen informed consent.
 */
import { readFileSync as leesBestand } from "node:fs";
import path from "node:path";

describe("de akkoordkaart noemt wat zij mandateert", () => {
  const html = leesBestand(path.join(process.cwd(), "jarvis/interface/jarvis.html"), "utf8");
  const stuk = (naam: string) => {
    const m = new RegExp(`\\nfunction ${naam}\\s*\\(`).exec(html);
    if (m === null) throw new Error(`${naam} is niet gevonden`);
    const haakje = html.indexOf("{", m.index + m[0].length);
    let diepte = 0;
    for (let i = haakje; i < html.length; i += 1) {
      if (html[i] === "{") diepte += 1;
      else if (html[i] === "}" && --diepte === 0) return html.slice(m.index + 1, i + 1);
    }
    throw new Error(`${naam} is niet afgesloten`);
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const lees = new Function(`${stuk("aangekondigdeUitzonderingen")}\nreturn aangekondigdeUitzonderingen;`)() as (s: string) => string[];

  const dossier = (blok: string) => `---\nid: T-x\nstatus: actief\n${blok}---\n\nde tekst\n`;

  it("leest een bloklijst", () => {
    expect(lees(dossier("uitzonderingen:\n  - workflows en repository-automatisering\n  - governanceconfiguratie\n"))).toEqual([
      "workflows en repository-automatisering",
      "governanceconfiguratie",
    ]);
  });

  it("leest een inline-lijst en een enkele waarde", () => {
    expect(lees(dossier("uitzonderingen: [a, b]\n"))).toEqual(["a", "b"]);
    expect(lees(dossier('uitzonderingen: "een randvoorwaarde-record, waar het ook staat"\n'))).toEqual([
      "een randvoorwaarde-record, waar het ook staat",
    ]);
  });

  it("geeft niets wanneer de taak niets aankondigt", () => {
    expect(lees(dossier(""))).toEqual([]);
    expect(lees("geen front-matter\n")).toEqual([]);
  });

  it("leest niets uit de hoofdtekst", () => {
    expect(lees("---\nid: T-x\n---\n\nuitzonderingen:\n  - stiekem\n")).toEqual([]);
  });

  it("belooft `vraagt apart` alleen wanneer er niets is aangekondigd", () => {
    const kaart = stuk("akkoordHtml");
    // De belofte staat achter een voorwaarde op het aantal aangekondigde soorten.
    expect(kaart).toMatch(/uitz\.length \? "" : " Een harde uitzondering vraagt apart\."/);
    // En wat wél wordt gemandateerd, staat er met zoveel woorden bij — zowel
    // vóór het akkoord als erna.
    expect(kaart).toMatch(/deze taak mag ook dit raken, zonder je per keer te vragen/);
    expect([...kaart.matchAll(/watJeMandateert/g)]).toHaveLength(3);
  });
});
