// Jarvis-kern — de deterministische poort.
//
// Dit is de laag die conflictdetectie herhaalbaar maakt. Een agent die dezelfde
// botsing de ene keer ziet en de andere keer niet, is geen vangrail. Deze tests
// leggen vast dat de poort valt bij een echte botsing, NIET valt bij werk dat
// er niets mee te maken heeft, en niet door de agent zelf te omzeilen is.
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { JarvisConfig } from "@/jarvis/src/config";
import {
  ackBronIsVertrouwd,
  bevatTriggerwoord,
  isAdministratieveBevestiging,
  lint,
  parseerAcks,
  rolSchrijfrechten,
  toetsRandvoorwaarden,
} from "@/jarvis/src/lint";
import { laadKennis, type KennisLading } from "@/jarvis/src/store";

const WORTEL = path.join(process.cwd(), "tests/jarvis/fixtures");

const CONFIG: JarvisConfig = {
  project: "fixture",
  enabled: true,
  knowledge_map: "kennis",
  taken_map: "tasks",
  current_state: "docs/CURRENT_STATE.md",
  project_kaart: "PROJECT.md",
  budget: { S: 8000, M: 20000, L: 40000 },
  limieten: {
    qa_rondes: 3,
    subagenten: 12,
    besluiten_per_taak: 1,
    nieuwe_dec_per_taak: 3,
    wallclock_minuten: 60,
  },
  context_nooit: [],
  context_symbolen: [],
  context_fragment_regels: 400,
  sanitize_paden: [],
  status_paden: ["supabase/migrations", "app/api"],
  migratie_pad: "",
  rol_controle_vanaf: "",
  test_pad: "tests",
  branch_voorvoegsel: "jarvis/",
  rollen_map: "jarvis/roles",
  engine_repository: "",
  attestatie: { url: "", sleutel: "", bot: "", uitvoerders: [], extra_paden: [] },
  overzicht_kern_id: "",
  overzicht_kern_naam: "",
  overzicht_kern_paden: [],
  overzicht_kern_tag: "",
  rol_afgeleiden_map: "",
  rol_afgeleiden_voorvoegsel: "",
  rol_overzicht: "",
  rol_neutraal: "",
  rol_gereedschap: { lezen: "", schrijven: "", rapporteren: "", uitvoeren: "" },
};

async function lading(): Promise<KennisLading> {
  return laadKennis(WORTEL, "kennis");
}

function basis(l: KennisLading) {
  return {
    config: CONFIG,
    lading: l,
    gewijzigdeBestanden: [] as readonly string[],
    tekstCorpus: "",
    acks: [] as readonly string[],
  };
}

describe("eigenaarslijst_technisch — de eigenaar leest gewone taal (DEC-0045)", () => {
  it("waarschuwt bij technische namen in een eigenaarspunt en laat gewone taal met rust", async () => {
    const l = await lading();
    const technisch = lint({ ...basis(l), eigenaarsPunten: [{ bestand: "tasks/T-1/resultaat.md", tekst: "Kies of DEC-0043 regel 66 letterlijk geldt; de engine op pin fe24676 handhaaft anders (attestatie.ts)." }] });
    const b = technisch.bevindingen.find((x) => x.code === "eigenaarslijst_technisch");
    expect(b?.severity).toBe("waarschuwing");
    expect(b?.boodschap).toMatch(/gewone taal/);
    const gewoon = lint({ ...basis(l), eigenaarsPunten: [{ bestand: "tasks/T-1/resultaat.md", tekst: "Kies in de Jarvis-app of een samenvoeging ook een taaknummer moet dragen; het advies is nee." }] });
    expect(gewoon.bevindingen.some((x) => x.code === "eigenaarslijst_technisch")).toBe(false);
  });
});

describe("eigenaarslijst_administratief — documentatie bevestigt Jarvis zelf (CON-0016)", () => {
  it("herkent een documentatie- of statusbevestiging en laat echte eigenaarshandelingen staan", () => {
    expect(isAdministratieveBevestiging("Het bijgewerkte narratief in `docs/CURRENT_STATE.md` bevestigen.")).toBe(true);
    expect(isAdministratieveBevestiging("Lees het feitenblok na en bevestig dat het klopt")).toBe(true);
    expect(isAdministratieveBevestiging("Controleer of het dossier de stand goed beschrijft")).toBe(true);
    expect(isAdministratieveBevestiging("Zet in de cloudomgeving de API credential voor de database (Settings → Environment)")).toBe(false);
    expect(isAdministratieveBevestiging("Akkoord geven op de scope van deze taak in de Jarvis-app")).toBe(false);
    expect(isAdministratieveBevestiging("Log in op Vercel en koppel het project")).toBe(false);
    expect(isAdministratieveBevestiging("Beslis of Kasboek een eigen repository krijgt")).toBe(false);
  });
  it("is een fout in de poort zodra zo'n punt in een geraakt dossier staat", async () => {
    const l = await lading();
    const uit = lint({ ...basis(l), eigenaarsPunten: [{ bestand: "tasks/T-1/resultaat.md", tekst: "Het narratief in docs/CURRENT_STATE.md bevestigen." }] });
    expect(uit.bevindingen.some((b) => b.code === "eigenaarslijst_administratief" && b.severity === "fout")).toBe(true);
    const ok = lint({ ...basis(l), eigenaarsPunten: [{ bestand: "tasks/T-1/resultaat.md", tekst: "Vink in GitHub de instelling aan en geef akkoord." }] });
    expect(ok.bevindingen.some((b) => b.code === "eigenaarslijst_administratief")).toBe(false);
  });
});

describe("bevatTriggerwoord", () => {
  it("matcht op woordgrens, hoofdletterongevoelig", () => {
    expect(bevatTriggerwoord("De klant stelt een Webhook in", "webhook")).toBe(true);
    expect(bevatTriggerwoord("webhook aan het begin", "webhook")).toBe(true);
    expect(bevatTriggerwoord("eindigt op webhook", "webhook")).toBe(true);
  });

  it("staat een meervouds-s toe", () => {
    expect(bevatTriggerwoord("meerdere webhooks instellen", "webhook")).toBe(true);
  });

  it("matcht niet binnen een aaneengeschreven groter woord", () => {
    expect(bevatTriggerwoord("webhookconfiguratiescherm", "webhook")).toBe(false);
  });

  it("behandelt het streepje als woordgrens, zodat samenstellingen wél aanslaan", () => {
    // Dit is het geval dat de poort moet vangen: "webhook-URL" is precies hoe
    // iemand het opschrijft die de randvoorwaarde dreigt te overtreden.
    expect(bevatTriggerwoord("de klant vult zijn webhook-URL in", "webhook")).toBe(true);
    expect(bevatTriggerwoord("mijn-webhook-helper", "webhook")).toBe(true);
  });

  it("matcht een meerdelige term nog steeds letterlijk", () => {
    expect(bevatTriggerwoord("vul de API-key in", "API-key")).toBe(true);
    expect(bevatTriggerwoord("vul de APIkey in", "API-key")).toBe(false);
  });

  it("matcht meerwoordstermen", () => {
    expect(bevatTriggerwoord("de klant moet dit zelf instellen", "zelf instellen")).toBe(true);
  });
});

describe("toetsRandvoorwaarden", () => {
  it("blokkeert bij een triggerwoord in de tekst zonder ack", async () => {
    const l = await lading();
    const bevindingen = toetsRandvoorwaarden(
      l.records,
      [],
      "Bouw de onboarding om zodat de klant zelf zijn webhook invult.",
      [],
    );
    const fout = bevindingen.find((b) => b.code === "randvoorwaarde_geraakt");
    expect(fout?.severity).toBe("fout");
    expect(fout?.onderwerp).toBe("CON-0001");
    expect(fout?.boodschap).toContain("Constraint-ack: CON-0001");
  });

  it("blokkeert bij een geraakt pad, ook zonder triggerwoord", async () => {
    const l = await lading();
    const bevindingen = toetsRandvoorwaarden(l.records, ["app/onboarding/stap.tsx"], "gewone tekst", []);
    expect(bevindingen.some((b) => b.code === "randvoorwaarde_geraakt")).toBe(true);
  });

  it("laat door met een expliciete ack", async () => {
    const l = await lading();
    const bevindingen = toetsRandvoorwaarden(l.records, [], "de klant vult zelf een webhook in", ["CON-0001"]);
    expect(bevindingen.some((b) => b.code === "randvoorwaarde_geraakt")).toBe(false);
  });

  it("geeft geen vals-positief bij werk dat de randvoorwaarde niet raakt", async () => {
    const l = await lading();
    const bevindingen = toetsRandvoorwaarden(
      l.records,
      ["lib/rapportage/maand.ts"],
      "Voeg een maandrapportage toe aan het dashboard.",
      [],
    );
    expect(bevindingen).toEqual([]);
  });

  it("waarschuwt over een ack die nergens op slaat", async () => {
    const l = await lading();
    const bevindingen = toetsRandvoorwaarden(l.records, [], "gewone tekst", ["CON-9999"]);
    expect(bevindingen.some((b) => b.code === "ack_onbekend")).toBe(true);
  });

  it("is deterministisch", async () => {
    const l = await lading();
    const maak = () => toetsRandvoorwaarden(l.records, ["app/onboarding/x.ts"], "webhook", []);
    expect(JSON.stringify(maak())).toBe(JSON.stringify(maak()));
  });
});

describe("lint", () => {
  it("keurt een schone wijziging goed", async () => {
    const l = await lading();
    const resultaat = lint({ ...basis(l), gewijzigdeBestanden: ["lib/rapportage/maand.ts"] });
    expect(resultaat.ok).toBe(true);
  });

  it("faalt op een botsing met een harde randvoorwaarde", async () => {
    const l = await lading();
    const resultaat = lint({
      ...basis(l),
      tekstCorpus: "de klant vult tijdens onboarding zelf zijn webhook-URL in",
    });
    expect(resultaat.ok).toBe(false);
    expect(resultaat.bevindingen.some((b) => b.code === "randvoorwaarde_geraakt")).toBe(true);
  });

  it("eist een statusverklaring bij wijziging van status-dragende paden", async () => {
    const l = await lading();
    const resultaat = lint({ ...basis(l), gewijzigdeBestanden: ["supabase/migrations/0012_iets.sql"] });
    expect(resultaat.ok).toBe(false);
    expect(resultaat.bevindingen.some((b) => b.code === "status_impact_ontbreekt")).toBe(true);
  });

  it("accepteert een expliciete Current-State-Impact-verklaring", async () => {
    const l = await lading();
    const resultaat = lint({
      ...basis(l),
      gewijzigdeBestanden: ["supabase/migrations/0012_iets.sql"],
      statusImpactVerklaard: true,
    });
    expect(resultaat.bevindingen.some((b) => b.code === "status_impact_ontbreekt")).toBe(false);
  });

  it("accepteert een bijgewerkt statusbestand als verklaring", async () => {
    const l = await lading();
    const resultaat = lint({
      ...basis(l),
      gewijzigdeBestanden: ["supabase/migrations/0012_iets.sql", "docs/CURRENT_STATE.md"],
    });
    expect(resultaat.bevindingen.some((b) => b.code === "status_impact_ontbreekt")).toBe(false);
  });

  // De drie gebeurtenissen waarop de poort draait, op dezelfde wijziging.
  // `push` heeft geen `github.event.pull_request`, dus daar zijn PR_TITEL en
  // PR_BODY leeg en is de verklaring principieel onvindbaar; `pull_request` en
  // `pull_request_review` dragen de tekst wél.
  it("slaat de statusverklaring over bij een push-gebeurtenis, die geen PR-tekst heeft", async () => {
    const l = await lading();
    const resultaat = lint({
      ...basis(l),
      gewijzigdeBestanden: ["supabase/migrations/0012_iets.sql"],
      prContext: false,
      statusImpactVerklaard: false,
    });
    expect(resultaat.bevindingen.some((b) => b.code === "status_impact_ontbreekt")).toBe(false);
  });

  it("eist de statusverklaring wél bij een pull_request-gebeurtenis zonder verklaring", async () => {
    const l = await lading();
    const resultaat = lint({
      ...basis(l),
      gewijzigdeBestanden: ["supabase/migrations/0012_iets.sql"],
      prContext: true,
      statusImpactVerklaard: false,
    });
    expect(resultaat.bevindingen.some((b) => b.code === "status_impact_ontbreekt")).toBe(true);
  });

  it("accepteert de verklaring bij een pull_request_review-gebeurtenis, die de PR-tekst meedraagt", async () => {
    const l = await lading();
    const resultaat = lint({
      ...basis(l),
      gewijzigdeBestanden: ["supabase/migrations/0012_iets.sql"],
      prContext: true,
      statusImpactVerklaard: true,
    });
    expect(resultaat.bevindingen.some((b) => b.code === "status_impact_ontbreekt")).toBe(false);
  });

  it("houdt de controle aan als de aanroeper geen context meegeeft", async () => {
    const l = await lading();
    const resultaat = lint({
      ...basis(l),
      gewijzigdeBestanden: ["supabase/migrations/0012_iets.sql"],
    });
    expect(resultaat.bevindingen.some((b) => b.code === "status_impact_ontbreekt")).toBe(true);
  });

  it("vraagt geen statusverklaring voor werk buiten status-dragende paden", async () => {
    const l = await lading();
    const resultaat = lint({ ...basis(l), gewijzigdeBestanden: ["tests/iets.test.ts", "app/(dashboard)/knop.tsx"] });
    expect(resultaat.bevindingen.some((b) => b.code === "status_impact_ontbreekt")).toBe(false);
  });

  it("signaleert een workflowwijziging als beveiligingsgrens", async () => {
    const l = await lading();
    const resultaat = lint({ ...basis(l), gewijzigdeBestanden: [".github/workflows/nieuw.yml"] });
    const bevinding = resultaat.bevindingen.find((b) => b.code === "workflow_gewijzigd");
    expect(bevinding?.severity).toBe("waarschuwing");
    expect(bevinding?.boodschap).toContain("productiesecrets");
  });

  it("waarschuwt boven het besluitquotum zonder te blokkeren", async () => {
    const l = await lading();
    const resultaat = lint({ ...basis(l), nieuweDecs: 7 });
    expect(resultaat.bevindingen.some((b) => b.code === "dec_quotum")).toBe(true);
    expect(resultaat.ok).toBe(true);
  });

  it("waarschuwt bij een verouderd statusbestand", async () => {
    const l = await lading();
    const resultaat = lint({ ...basis(l), statusCommitsSinds: 25 });
    expect(resultaat.bevindingen.some((b) => b.code === "status_verouderd")).toBe(true);
  });
});

describe("rolmandaat", () => {
  // Aanleiding: een onafhankelijke QA wees erop dat het bevoegdheidsmodel alleen
  // in proza bestond, en vond meteen een commit met rol `qa` die enginecode
  // wijzigde. Een regel die alleen in een rolcontract staat, bindt niet.
  const commit = (rol: string | null, bestanden: readonly string[], voorStartpunt = false) => ({
    hash: "abc1234",
    onderwerp: "iets",
    rol,
    taak: "T-1",
    bestanden,
    voorStartpunt,
  });

  it("blokkeert een rol die buiten zijn mandaat schrijft", async () => {
    const l = await lading();
    const resultaat = lint({
      ...basis(l),
      commits: [commit("qa", ["tests/iets.test.ts", "jarvis/src/lint.ts"])],
    });
    const bevinding = resultaat.bevindingen.find((b) => b.code === "rol_overschrijding");
    expect(bevinding?.severity).toBe("fout");
    expect(bevinding?.boodschap).toContain("jarvis/src/lint.ts");
    expect(resultaat.ok).toBe(false);
  });

  it("laat een rol door die binnen zijn mandaat blijft", async () => {
    const l = await lading();
    const resultaat = lint({
      ...basis(l),
      commits: [commit("qa", ["tasks/T-1/qa-rapport.md"])],
    });
    expect(resultaat.bevindingen.some((b) => b.code === "rol_overschrijding")).toBe(false);
  });

  it("laat QA geen tests committen: dat is werk van de bouwende rol", async () => {
    // Het QA-contract verbood het al; de poort stond het toe en sprak het
    // contract tegen. Beslist door de eigenaar op 2026-09-12: het contract wint.
    const l = await lading();
    const resultaat = lint({
      ...basis(l),
      commits: [commit("qa", ["tests/iets.test.ts", "tasks/T-1/qa-rapport.md"])],
    });
    const bevinding = resultaat.bevindingen.find((b) => b.code === "rol_overschrijding");
    expect(bevinding?.severity).toBe("fout");
    expect(bevinding?.boodschap).toContain("tests/iets.test.ts");
  });

  it("legt een onbekende rol geen padbeperking op", async () => {
    const l = await lading();
    const resultaat = lint({
      ...basis(l),
      commits: [commit("developer", ["jarvis/src/lint.ts", "app/api/route.ts"])],
    });
    expect(resultaat.bevindingen.some((b) => b.code === "rol_overschrijding")).toBe(false);
  });

  it("waarschuwt bij een ontbrekende rol-trailer zonder te blokkeren", async () => {
    const l = await lading();
    const resultaat = lint({ ...basis(l), commits: [commit(null, ["jarvis/src/lint.ts"])] });
    const bevinding = resultaat.bevindingen.find((b) => b.code === "rol_ontbreekt");
    expect(bevinding?.severity).toBe("waarschuwing");
    expect(resultaat.ok).toBe(true);
  });

  it("slaat commits over van vóór het ingevoerde startpunt", async () => {
    // Het startpunt bestaat omdat de bootstraphistorie de regel voorafgaat en
    // corrigeren een force-push zou vragen. Het mag alleen naar ACHTEREN werken:
    // een commit ná het startpunt wordt onverminderd getoetst.
    const l = await lading();
    const oud = lint({ ...basis(l), commits: [commit("qa", ["jarvis/src/lint.ts"], true)] });
    expect(oud.bevindingen.some((b) => b.code === "rol_overschrijding")).toBe(false);

    const nieuw = lint({ ...basis(l), commits: [commit("qa", ["jarvis/src/lint.ts"], false)] });
    expect(nieuw.bevindingen.some((b) => b.code === "rol_overschrijding")).toBe(true);
  });
});

describe("rolmandaat — de gaten die de tweede QA-ronde vond", () => {
  const commit = (rol: string | null, bestanden: readonly string[], voorStartpunt = false) => ({
    hash: "abc1234",
    onderwerp: "iets",
    rol,
    taak: "T-1",
    bestanden,
    voorStartpunt,
  });

  it("normaliseert de rolnaam, zodat een hoofdletter geen ontsnapping is", async () => {
    const l = await lading();
    for (const geschreven of ["QA", "Qa", " qa "]) {
      const resultaat = lint({ ...basis(l), commits: [commit(geschreven, ["jarvis/src/lint.ts"])] });
      expect(
        resultaat.bevindingen.some((b) => b.code === "rol_overschrijding"),
        `rol "${geschreven}" hoort dezelfde grens te krijgen als "qa"`,
      ).toBe(true);
    }
  });

  it("wijst een onbekende rol af in plaats van hem alles toe te staan", async () => {
    const l = await lading();
    const resultaat = lint({ ...basis(l), commits: [commit("tovenaar", ["jarvis/src/lint.ts"])] });
    const bevinding = resultaat.bevindingen.find((b) => b.code === "rol_onbekend");
    expect(bevinding?.severity).toBe("fout");
    expect(resultaat.ok).toBe(false);
  });

  it("struikelt niet over een rolnaam uit het prototype", async () => {
    // Met een objectliteral gaf `kaart["constructor"]` een functie terug in
    // plaats van undefined, en dan viel de hele controle om met een TypeError:
    // geen bevindingen, geen oordeel, alleen een stacktrace.
    const l = await lading();
    for (const naam of ["constructor", "toString", "valueOf", "__proto__"]) {
      const resultaat = lint({ ...basis(l), commits: [commit(naam, ["jarvis/src/lint.ts"])] });
      expect(resultaat.bevindingen.some((b) => b.code === "rol_onbekend")).toBe(true);
    }
  });

  it("blokkeert het verschuiven van het startpunt", async () => {
    // Zonder deze controle kon een commit met een overtreding worden gevolgd
    // door een tweede die het startpunt op die overtreding zette; de poort
    // kleurde dan groen op precies de historie die hij moest afkeuren.
    const l = await lading();
    const verschoven = lint({
      ...basis(l),
      config: { ...CONFIG, rol_controle_vanaf: "deadbeef" },
      rolControleVanafBasis: "",
    });
    const bevinding = verschoven.bevindingen.find((b) => b.code === "startpunt_verschoven");
    expect(bevinding?.severity).toBe("fout");
    expect(verschoven.ok).toBe(false);

    const metAck = lint({
      ...basis(l),
      config: { ...CONFIG, rol_controle_vanaf: "deadbeef" },
      rolControleVanafBasis: "",
      acks: ["ROL-STARTPUNT"],
      // Zonder vertrouwde bron telt de ack niet; dat wordt apart getoetst in
      // "de ack-poort". Hier gaat het om de vraag of een geldige ack de
      // blokkade opheft.
      ackBronVertrouwd: true,
    });
    expect(metAck.bevindingen.some((b) => b.code === "startpunt_verschoven")).toBe(false);
    expect(metAck.bevindingen.some((b) => b.code === "ack_onbekend")).toBe(false);
  });

  it("laat een ongewijzigd startpunt met rust", async () => {
    const l = await lading();
    const resultaat = lint({
      ...basis(l),
      config: { ...CONFIG, rol_controle_vanaf: "deadbeef" },
      rolControleVanafBasis: "deadbeef",
    });
    expect(resultaat.bevindingen.some((b) => b.code === "startpunt_verschoven")).toBe(false);
  });

  it("weigert wanneer de commitlog niet volledig en eenduidig gelezen is", async () => {
    const l = await lading();
    const resultaat = lint({ ...basis(l), commitlogOnleesbaar: true });
    const b = resultaat.bevindingen.find((x) => x.code === "commitlog_onleesbaar");
    expect(b?.severity).toBe("fout");
    expect(resultaat.ok).toBe(false);
  });

  it("meldt het wanneer commits buiten de controle vielen", async () => {
    const l = await lading();
    const resultaat = lint({ ...basis(l), commitsAfgekapt: 7 });
    const bevinding = resultaat.bevindingen.find((b) => b.code === "commits_afgekapt");
    // Blokkerend: een waarschuwing zou de build groen laten op een branch waarvan
    // de oudste commits nooit tegen hun rolmandaat zijn gehouden.
    expect(bevinding?.severity).toBe("fout");
    expect(bevinding?.boodschap).toContain("7");
    expect(resultaat.ok).toBe(false);
  });

  it("leest de mandaatpaden uit de configuratie en niet uit de engine", async () => {
    // Een portabiliteitscontrole ving dit: met `knowledge/` en `tasks/` als
    // literal in de engine kreeg een project met andere mapnamen een
    // overtreding op volstrekt legitiem werk.
    const l = await lading();
    const anders = {
      ...CONFIG,
      knowledge_map: "kennis",
      taken_map: "taken",
      test_pad: "proeven",
      current_state: "documenten/STAND.md",
    };
    const rechten = rolSchrijfrechten(anders);
    expect(rechten.get("knowledge-manager")).toEqual(["kennis/", "taken/", "documenten/"]);
    expect(rechten.get("qa")).toEqual(["taken/"]);

    // Ligt CURRENT_STATE in de wortel, dan is er geen documentatiemap. Zonder
    // deze afhandeling werd "STAND.md/" als mapvoorvoegsel gelezen en paste die
    // rol nergens meer op.
    const inDeWortel = rolSchrijfrechten({ ...anders, current_state: "STAND.md" });
    expect(inDeWortel.get("architect")).toEqual(["taken/", "STAND.md"]);

    const resultaat = lint({
      ...basis(l),
      config: anders,
      commits: [commit("knowledge-manager", ["kennis/BESLUITEN/DEC-0002.md", "taken/T-1/opdracht.md"])],
    });
    expect(resultaat.bevindingen.some((b) => b.code === "rol_overschrijding")).toBe(false);
  });

  it("laat zich niet omzeilen met een pad dat via .. terugklimt", async () => {
    const l = await lading();
    const resultaat = lint({
      ...basis(l),
      commits: [commit("qa", ["tests/../jarvis/src/lint.ts"])],
    });
    expect(resultaat.bevindingen.some((b) => b.code === "rol_overschrijding")).toBe(true);
  });

  it("verwart een map met hetzelfde begin niet met de toegestane map", async () => {
    const l = await lading();
    const resultaat = lint({ ...basis(l), commits: [commit("orchestrator", ["tasks-oud/T-1/opdracht.md"])] });
    expect(resultaat.bevindingen.some((b) => b.code === "rol_overschrijding")).toBe(true);
  });
});

describe("de ack-poort", () => {
  // De vormcontrole op parseerAcks staat verderop, bij "de volledige
  // review-body moet uit ack-regels bestaan". Wat hier stond toetste de oude
  // opzet, waarin losse ack-regels tussen gewone tekst mochten staan.

  describe("ackBronIsVertrouwd — wie de ack plaatst", () => {
    it("vertrouwt de eigenaar", () => {
      expect(ackBronIsVertrouwd("lodewijkmaassen", "OWNER")).toBe(true);
      expect(ackBronIsVertrouwd("lodewijkmaassen", "owner")).toBe(true);
      expect(ackBronIsVertrouwd("  lodewijkmaassen  ", " Owner ")).toBe(true);
    });

    it("vertrouwt COLLABORATOR en MEMBER niet", () => {
      // Beide stonden hier eerst, onder een commentaar dat "schrijfrecht"
      // beloofde. `author_association` garandeert dat niet: COLLABORATOR geldt
      // op elk rechtenniveau, lezen en triage inbegrepen, en MEMBER zegt alleen
      // iets over de organisatie. De code deed minder dan het commentaar zei, en
      // dat is bij een beveiligingsgrens het gevaarlijkste soort fout.
      expect(ackBronIsVertrouwd("iemand", "COLLABORATOR")).toBe(false);
      expect(ackBronIsVertrouwd("iemand", "MEMBER")).toBe(false);
    });

    it("vertrouwt een vlag zonder waarde niet", () => {
      // Een CLI-vlag zonder waarde wordt de string "true". Vanuit de workflow
      // onbereikbaar, maar het hoort nooit een bevoegdheid te zijn.
      expect(ackBronIsVertrouwd("true", "true")).toBe(false);
    });

    it("vertrouwt geen bot", () => {
      // Dit is de kern: de agent opent de PR onder een botidentiteit, en mag
      // daarmee geen menselijk besluit kunnen fabriceren.
      expect(ackBronIsVertrouwd("jarvis-agent[bot]", "OWNER")).toBe(false);
      expect(ackBronIsVertrouwd("github-actions[BOT]", "MEMBER")).toBe(false);
    });

    it("vertrouwt niemand zonder aantoonbare bevoegdheid", () => {
      expect(ackBronIsVertrouwd("passant", "CONTRIBUTOR")).toBe(false);
      expect(ackBronIsVertrouwd("passant", "NONE")).toBe(false);
      expect(ackBronIsVertrouwd("passant", "")).toBe(false);
    });

    it("vertrouwt een lege actor niet", () => {
      // Zo ziet een gewone pull_request-run eruit: er is geen review, dus geen
      // auteur. Dan is er ook geen ack.
      expect(ackBronIsVertrouwd("", "OWNER")).toBe(false);
      expect(ackBronIsVertrouwd("   ", "OWNER")).toBe(false);
    });
  });

  describe("lint negeert een ack uit een onbetrouwbare bron", () => {
    it("laat een harde randvoorwaarde staan en meldt de bron", async () => {
      const l = await lading();
      const resultaat = lint({
        ...basis(l),
        tekstCorpus: "wij passen de opvolgmail aan",
        acks: ["CON-0005"],
        ackBronVertrouwd: false,
        ackBron: "de PR-tekst",
      });
      const bron = resultaat.bevindingen.find((b) => b.code === "ack_bron_onbetrouwbaar");
      expect(bron?.severity).toBe("fout");
      expect(bron?.boodschap).toContain("de PR-tekst");
      expect(resultaat.ok).toBe(false);
    });

    it("laat het startpunt geblokkeerd wanneer de ack niet van een mens komt", async () => {
      const l = await lading();
      const resultaat = lint({
        ...basis(l),
        config: { ...CONFIG, rol_controle_vanaf: "a".repeat(40) },
        rolControleVanafBasis: "",
        acks: ["ROL-STARTPUNT"],
        ackBronVertrouwd: false,
      });
      expect(resultaat.bevindingen.some((b) => b.code === "startpunt_verschoven")).toBe(true);
      expect(resultaat.ok).toBe(false);
    });

    it("laat het startpunt door wanneer de ack wél van een mens komt", async () => {
      const l = await lading();
      const resultaat = lint({
        ...basis(l),
        config: { ...CONFIG, rol_controle_vanaf: "a".repeat(40) },
        rolControleVanafBasis: "",
        acks: ["ROL-STARTPUNT"],
        ackBronVertrouwd: true,
      });
      expect(resultaat.bevindingen.some((b) => b.code === "startpunt_verschoven")).toBe(false);
      expect(resultaat.bevindingen.some((b) => b.code === "ack_bron_onbetrouwbaar")).toBe(false);
    });

    it("meldt niets over de bron wanneer er geen ack is", async () => {
      const l = await lading();
      const resultaat = lint({ ...basis(l), acks: [], ackBronVertrouwd: false });
      expect(resultaat.bevindingen.some((b) => b.code === "ack_bron_onbetrouwbaar")).toBe(false);
    });
  });
});

describe("de volledige review-body moet uit ack-regels bestaan", () => {
  const ACK = "Constraint-ack: CON-0004";
  const TWEEDE = "Constraint-ack: CON-0011";

  describe("markdown verbergt tekst zonder een enkele punthaak", () => {
    // Dit brak de vorige opzet, die alleen `<` en `>` verbood. Bij elk van deze
    // zes ziet de reviewer iets anders dan er staat — bij de eerste zelfs een
    // afwijzing terwijl de ack eronder meetelde. Ze hoeven nu niet meer herkend
    // te worden: ze zijn allemaal tekst die geen ack-regel is.
    const gevallen: [string, string][] = [
      [
        "een linkreferentie met meerregelige titel",
        ["Ik heb hier nog vragen over, dus nog even niet mergen.", "", "[x]: /y '", ACK, "'"].join("\n"),
      ],
      ["het markdown-commentaaridioom", ["Nog niet akkoord.", "", "[//]: # '", ACK, "'"].join("\n")],
      ["een linkreferentie met dubbele aanhalingstekens", ['[ref]: /pad "', ACK, '"'].join("\n")],
      ["een inline-linktitel", `[zie hier](/pad "${ACK}")`],
      ["een afbeeldingstitel", `![alt](/plaatje.png "${ACK}")`],
      ["een linkreferentie met haakjes als titel", ["[a]: /b (", ACK, ")"].join("\n")],
    ];
    for (const [naam, tekst] of gevallen) {
      it(`telt niet: ${naam}`, () => {
        expect(parseerAcks(tekst)).toEqual([]);
      });
    }
  });

  describe("HTML uit de eerdere rondes", () => {
    // Ook deze vallen nu af op dezelfde eigenschap: het is tekst die geen
    // ack-regel is. Er is geen aparte HTML-behandeling meer.
    const gevallen: [string, string][] = [
      ["een meerregelig comment", ["<!--", ACK, "-->"].join("\n")],
      ["details", ["<details>", "<summary>x</summary>", "", ACK, "", "</details>"].join("\n")],
      ["een verborgen div", ["<div hidden>", ACK, "</div>"].join("\n")],
      ["een span met display:none", ['<span style="display:none">', ACK, "</span>"].join("\n")],
      ["een losse sluittag in een details-blok", ["<details>", "</p>", ACK, "</details>"].join("\n")],
      ["een sluittag met een spatie erin", ["<details>", "</ details>", ACK].join("\n")],
      ["een sluittag zonder sluitteken", ["<details>", "</details", ACK].join("\n")],
      ["een processing instruction", ['<?xml version="1.0"?>', ACK, "?>"].join("\n")],
      ["CDATA", ["<![CDATA[", ACK, "]]>"].join("\n")],
      ["een template-tag", ["<%", ACK, "%>"].join("\n")],
    ];
    for (const [naam, tekst] of gevallen) {
      it(`telt niet: ${naam}`, () => {
        expect(parseerAcks(tekst)).toEqual([]);
      });
    }
  });

  describe("gewone toelichting eromheen", () => {
    const gevallen: [string, string][] = [
      ["tekst ervoor", ["Bekeken en akkoord.", ACK].join("\n")],
      ["tekst erna", [ACK, "Groet, Lodewijk."].join("\n")],
      ["tekst ervoor en erna", ["Akkoord.", ACK, "Groet."].join("\n")],
      ["een kop erboven", ["## Beoordeling", ACK].join("\n")],
      ["een opsomming eronder", [ACK, "- nog wel de migratie nalopen"].join("\n")],
      ["een codeblok eronder", [ACK, "```", "voorbeeld", "```"].join("\n")],
      ["een geciteerde regel eronder", [ACK, "> zoals besproken"].join("\n")],
      ["een lege review", ""],
      ["alleen toelichting", "Ziet er goed uit."],
    ];
    for (const [naam, tekst] of gevallen) {
      it(`maakt de hele body ongeldig: ${naam}`, () => {
        expect(parseerAcks(tekst)).toEqual([]);
      });
    }
  });

  describe("de vorm van de ack-regel zelf", () => {
    const gevallen: [string, string][] = [
      ["kleine letters", ACK.toLowerCase()],
      ["hoofdletters", "CONSTRAINT-ACK: CON-0004"],
      ["zonder spatie na de dubbele punt", "Constraint-ack:CON-0004"],
      ["twee spaties na de dubbele punt", "Constraint-ack:  CON-0004"],
      ["ingesprongen met spaties", `  ${ACK}`],
      ["ingesprongen met een tab", `\t${ACK}`],
      ["als lijstitem", `- ${ACK}`],
      ["geciteerd", `> ${ACK}`],
      ["met tekst erachter", `${ACK} — mits`],
      ["een onbekend ID", "Constraint-ack: CON-4"],
      ["een onbekende naam", "Constraint-ack: ROL_STARTPUNT"],
      ["twee acks op een regel", `${ACK} ${TWEEDE}`],
      ["met een harde spatie erachter", `${ACK} `],
      ["met een zero-width teken erachter", `${ACK}​`],
      ["met een losse carriage return als scheiding", `${ACK}\r${TWEEDE}`],
      ["met een unicode-regelscheider", `${ACK} ${TWEEDE}`],
    ];
    for (const [naam, tekst] of gevallen) {
      it(`telt niet: ${naam}`, () => {
        expect(parseerAcks(tekst)).toEqual([]);
      });
    }
  });

  describe("wat wél een geldige ackbron is", () => {
    it("een enkele ack-regel", () => {
      expect(parseerAcks(ACK)).toEqual(["CON-0004"]);
    });

    it("meerdere ack-regels, in leesvolgorde", () => {
      expect(parseerAcks([ACK, TWEEDE, "Constraint-ack: ROL-STARTPUNT"].join("\n"))).toEqual([
        "CON-0004",
        "CON-0011",
        "ROL-STARTPUNT",
      ]);
    });

    it("met lege regels ertussen, ervoor en erna", () => {
      // GitHub voegt zelf een regeleinde toe aan een review-body, en een
      // reviewer die twee acks onder elkaar zet laat er vaak een regel tussen.
      // Lege regels dragen geen zichtbare inhoud.
      expect(parseerAcks(["", ACK, "", TWEEDE, ""].join("\n"))).toEqual(["CON-0004", "CON-0011"]);
    });

    it("met Windows-regeleindes", () => {
      expect(parseerAcks(`${ACK}\r\n${TWEEDE}\r\n`)).toEqual(["CON-0004", "CON-0011"]);
    });

    it("met spaties of tabs achter de regel", () => {
      // Onzichtbaar, en er past niets in: de rest van de regel moet exact
      // kloppen. Redacteuren en webformulieren laten die makkelijk staan.
      expect(parseerAcks(`${ACK}   `)).toEqual(["CON-0004"]);
      expect(parseerAcks(`${ACK}\t`)).toEqual(["CON-0004"]);
    });

    it("een regel met alleen witruimte telt als leeg", () => {
      expect(parseerAcks([ACK, "   ", TWEEDE].join("\n"))).toEqual(["CON-0004", "CON-0011"]);
    });
  });
});

describe("eigenaarslijst_keuze — de poort bewaakt het formaat van een keuze", () => {
  // Deze tests draaien `lint()` zelf, niet alleen de hulpfunctie. Een eerdere
  // versie toetste uitsluitend de helper en was groen terwijl de regel op de
  // echte invoerweg nooit vuurde: `lint` krijgt de *toelichting* van een punt
  // binnen, en daar is het voorvoegsel "Stap 1:" al afgeknipt.
  it("keurt een keuze af die in de lopende tekst staat", async () => {
    const l = await lading();
    const uit = lint({
      ...basis(l),
      eigenaarsPunten: [
        { bestand: "tasks/T-1/resultaat.md", tekst: "kies tussen (a) de ene weg, of (b) de andere weg.", regels: [{ label: "Stap 1", tekst: "kies tussen (a) de ene weg, of (b) de andere weg." }] },
      ],
    });
    const b = uit.bevindingen.find((x) => x.code === "eigenaarslijst_keuze_niet_uitgesplitst");
    expect(b?.severity).toBe("fout");
    expect(b?.boodschap).toMatch(/Optie A/);
  });

  it("laat een correct uitgesplitste keuze met rust", async () => {
    const l = await lading();
    const uit = lint({
      ...basis(l),
      eigenaarsPunten: [
        { bestand: "tasks/T-1/resultaat.md", tekst: "De preview-bouw.", regels: [{ label: "Keuze", tekst: "welke weg?" }, { label: "Optie A", tekst: "dit" }, { label: "Optie B", tekst: "dat" }] },
      ],
    });
    expect(uit.bevindingen.some((x) => String(x.code).startsWith("eigenaarslijst_keuze"))).toBe(false);
  });

  it("keurt een halve keuze ook af zonder `Keuze`-regel (QA-ronde 6, B2)", async () => {
    const l = await lading();
    const uit = lint({
      ...basis(l),
      eigenaarsPunten: [
        { bestand: "tasks/T-1/resultaat.md", tekst: "De preview-bouw.", regels: [{ label: "Optie A", tekst: "dit" }, { label: "Optie A", tekst: "dat" }] },
      ],
    });
    expect(uit.bevindingen.some((x) => x.code === "eigenaarslijst_keuze_half" && x.severity === "fout")).toBe(true);
  });

  it("meldt een keuze die het vangnet net niet leest (QA-ronde 6, B3)", async () => {
    const l = await lading();
    for (const tekst of [
      "neem (a) de ene weg, of (b) de andere weg.",
      "kies tussen (a) de ene weg, of (A) de andere weg.",
      "kies tussen (a), of (b) de andere weg.",
    ]) {
      const uit = lint({
        ...basis(l),
        eigenaarsPunten: [{ bestand: "tasks/T-1/resultaat.md", tekst: "Het beslispunt.", regels: [{ label: "Stap 1", tekst }] }],
      });
      expect(uit.bevindingen.some((x) => x.code === "eigenaarslijst_keuze_bijna" && x.severity === "fout")).toBe(true);
    }
  });

  it("meldt een wachtregel naast een uitgeschreven keuze (QA-ronde 6, B1)", async () => {
    const l = await lading();
    const uit = lint({
      ...basis(l),
      eigenaarsPunten: [
        {
          bestand: "tasks/T-1/resultaat.md",
          tekst: "De preview-bouw.",
          regels: [
            { label: "Keuze", tekst: "welke weg?" },
            { label: "Optie A", tekst: "dit" },
            { label: "Optie B", tekst: "dat" },
            { label: "Wacht", tekst: "op de leverancier" },
          ],
        },
      ],
    });
    expect(uit.bevindingen.some((x) => x.code === "eigenaarslijst_wacht_en_keuze" && x.severity === "fout")).toBe(true);
  });

  it("laat een wachtregel zonder keuze met rust", async () => {
    const l = await lading();
    const uit = lint({
      ...basis(l),
      eigenaarsPunten: [{ bestand: "tasks/T-1/resultaat.md", tekst: "De preview-bouw.", regels: [{ label: "Wacht", tekst: "op de leverancier" }] }],
    });
    expect(uit.bevindingen.some((x) => x.code === "eigenaarslijst_wacht_en_keuze")).toBe(false);
  });

  it("geeft de regels van een eigenaarspunt door uit het dossier (QA-ronde 6, N5)", async () => {
    // De doorgifte van `regels` in `leesEigenaarsPunten` had geen enkele test;
    // zonder haar zwijgen alle drie de keuzeregels op elk echt dossier.
    const l = await lading();
    const zonder = lint({
      ...basis(l),
      eigenaarsPunten: [{ bestand: "tasks/T-1/resultaat.md", tekst: "De preview-bouw." }],
    });
    expect(zonder.bevindingen.some((x) => String(x.code).startsWith("eigenaarslijst_keuze"))).toBe(false);
    const met = lint({
      ...basis(l),
      eigenaarsPunten: [{ bestand: "tasks/T-1/resultaat.md", tekst: "De preview-bouw.", regels: [{ label: "Keuze", tekst: "welke weg?" }] }],
    });
    expect(met.bevindingen.some((x) => x.code === "eigenaarslijst_keuze_half")).toBe(true);
  });

  it("keurt een half geschreven keuze af", async () => {
    const l = await lading();
    const uit = lint({
      ...basis(l),
      eigenaarsPunten: [{ bestand: "tasks/T-1/resultaat.md", tekst: "De preview-bouw.", regels: [{ label: "Keuze", tekst: "welke weg?" }, { label: "Optie A", tekst: "dit" }] }],
    });
    expect(uit.bevindingen.some((x) => x.code === "eigenaarslijst_keuze_half")).toBe(true);
  });

  it("laat een handeling met twee delen met rust", async () => {
    const l = await lading();
    const uit = lint({
      ...basis(l),
      eigenaarsPunten: [{ bestand: "tasks/T-1/resultaat.md", tekst: "doe (a) het ene en (b) het andere.", regels: [] }],
    });
    expect(uit.bevindingen.some((x) => String(x.code).startsWith("eigenaarslijst_keuze"))).toBe(false);
  });
});
