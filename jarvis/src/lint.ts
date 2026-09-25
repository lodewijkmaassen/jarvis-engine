// De deterministische poort.
//
// Dit is bewust de laag die GEEN model gebruikt. Een semantische controle door
// een agent is waardevol maar niet herhaalbaar; deze controle draait in CI,
// kost niets, en geeft bij dezelfde invoer altijd hetzelfde oordeel. Als een
// voorstel botst met een harde randvoorwaarde, hoort dat hier te stranden —
// niet pas als iemand het toevallig opmerkt.
//
// Twee soorten bevindingen:
//   fout          — blokkeert; de build faalt
//   waarschuwing  — zichtbaar, blokkeert niet
import { matchtGlob, normaliseerPad } from "./classify";
import { technischeMarkers } from "./review";
import { alternatiefRegels, isExplicietAlternatief, leesAlternatieven, leesIngebedeKeuze, lijktOpKeuze } from "./overzicht";
import type { JarvisConfig } from "./config";
import { isActiefRecord, type KnowledgeRecord } from "./records";
import { formatteerBevinding, formatteerLaadFout, type KennisLading } from "./store";

export const LINT_CODES = [
  "kennis_ongeldig",
  "kennis_signaal",
  "laadfout",
  "randvoorwaarde_geraakt",
  "randvoorwaarde_signaal",
  "ack_onbekend",
  "status_verouderd",
  "status_impact_ontbreekt",
  "workflow_gewijzigd",
  "dec_quotum",
  "rol_ontbreekt",
  "rol_overschrijding",
  "rol_onbekend",
  "startpunt_verschoven",
  "commits_afgekapt",
  "commitlog_onleesbaar",
  "ack_bron_onbetrouwbaar",
  "eigenaarslijst_administratief",
  "eigenaarslijst_technisch",
  "eigenaarslijst_keuze_niet_uitgesplitst",
  "eigenaarslijst_keuze_half",
  "eigenaarslijst_keuze_bijna",
  "eigenaarslijst_wacht_en_keuze",
  "eigenaarslijst_akkoord_en_keuze",
  "eigenaarslijst_handeling_en_keuze",
] as const;
export type LintCode = (typeof LINT_CODES)[number];

export type LintBevinding = {
  readonly code: LintCode;
  readonly severity: "fout" | "waarschuwing";
  readonly onderwerp: string;
  readonly boodschap: string;
};

export type LintInvoer = {
  readonly config: JarvisConfig;
  readonly lading: KennisLading;
  /** Repo-relatieve paden die in deze wijziging zijn geraakt. */
  readonly gewijzigdeBestanden: readonly string[];
  /** Vrije tekst waarin triggerwoorden gezocht worden: taakomschrijving + PR-tekst. */
  readonly tekstCorpus: string;
  /** Expliciet afgevinkte randvoorwaarden ("Constraint-ack: CON-0004"). */
  readonly acks: readonly string[];
  /** Hoeveel status-dragende commits sinds CURRENT_STATE voor het laatst wijzigde. */
  readonly statusCommitsSinds?: number;
  /** Staat er een expliciete "Current-State-Impact"-verklaring in de PR-tekst? */
  readonly statusImpactVerklaard?: boolean;
  /**
   * Is er een pull-requestcontext waarin die verklaring überhaupt te lezen is?
   *
   * Bij een `push`-gebeurtenis bestaat `github.event.pull_request` niet, dus
   * `PR_TITEL` en `PR_BODY` zijn leeg en de verklaring is daar principieel
   * onvindbaar — ook als de pull request hem wél draagt. De statusdrift-controle
   * hieronder meet dan niets en zou elke push op een status-dragend pad rood
   * maken. Zonder context slaat zij daarom over; op `pull_request` en
   * `pull_request_review`, waar de tekst er wél is, geldt zij onverkort.
   *
   * Niet meegegeven betekent "context aanwezig", zodat bestaande aanroepers
   * ongewijzigd blijven werken.
   */
  readonly prContext?: boolean;
  /** Aantal nieuwe DEC-records in deze wijziging. */
  readonly nieuweDecs?: number;
  /** Commits op deze branch, met hun rol-trailer en gewijzigde bestanden. */
  readonly commits?: readonly CommitOverzicht[];
  /** Waarde van `rol_controle_vanaf` op de basisbranch, om verschuiving te zien. */
  readonly rolControleVanafBasis?: string;
  /** Aantal commits dat buiten de rolcontrole viel doordat de lijst is afgekapt. */
  readonly commitsAfgekapt?: number;
  /**
   * De punten onder "Wat de eigenaar nog moet doen" van de taakdossiers die
   * deze wijziging raakt: bestand en de tekst per punt.
   */
  readonly eigenaarsPunten?: readonly {
    readonly bestand: string;
    readonly tekst: string;
    /**
     * De regels onder dit punt, met hun tekst. De tekst is dragend: een
     * `- Optie B:` zonder gevolg telt niet als alternatief, en zonder die
     * tekst kon de poort dat niet zien.
     */
    readonly regels?: readonly { readonly label: string; readonly tekst: string }[];
    /** Staat dit punt onder een governancecontext die een autorisatie vraagt? */
    readonly akkoordContext?: boolean;
    /** De vette tussenkop waaronder dit punt staat; de kaart toont haar, dus leest de poort haar ook. */
    readonly context?: string;
    /** Is het punt afgevinkt, of vraagt het het akkoord op de taak? Dan toont de kaart het niet en beoordeelt de poort het niet. */
    readonly buitenDeKaart?: boolean;
  }[];
  /**
   * De commitlog was niet volledig en eenduidig te lezen (een record zonder
   * geldige vorm, of een verschil met de lijst uit rev-list). Blokkerend: een
   * commit die niet gelezen is, is een commit die de rolcontrole niet zag.
   */
  readonly commitlogOnleesbaar?: boolean;
  /** Komen de acks uit een bron met een aanwijsbare menselijke auteur? */
  readonly ackBronVertrouwd?: boolean;
  /** Omschrijving van die bron, voor de foutmelding. */
  readonly ackBron?: string;
};

export type CommitOverzicht = {
  readonly hash: string;
  readonly onderwerp: string;
  readonly rol: string | null;
  readonly taak: string | null;
  readonly bestanden: readonly string[];
  /** Commit dateert van vóór het ingevoerde startpunt van de rolcontrole. */
  readonly voorStartpunt?: boolean;
};

/**
 * Wat een rol mag aanraken.
 *
 * Dit is het bevoegdheidsmodel, machinecontroleerbaar in plaats van als proza
 * in een rolcontract. Aanleiding: een onafhankelijke QA vond een commit met
 * rol-trailer `qa` die vijf engine-modules wijzigde — precies wat het
 * QA-contract verbiedt. Een regel die alleen in een document staat, bindt de
 * agent die hem las niet aantoonbaar.
 *
 * De lijst is gesloten. Een rol die er niet in staat kent geen mandaat en zou
 * dus alles mogen; daarom is een onbekende rolnaam een fout en geen signaal.
 * `developer` staat er wel in maar krijgt geen padbeperking: die rol wordt door
 * de andere poorten begrensd, niet door een mappenlijst.
 */
export const BEKENDE_ROLLEN = ["qa", "knowledge-manager", "architect", "orchestrator", "developer"] as const;

/**
 * Bouwt de rechtenkaart uit de configuratie.
 *
 * De mapnamen mogen hier NIET hardgecodeerd staan: `knowledge_map` en
 * `taken_map` zijn per project instelbaar, en een engine die `knowledge/`
 * aanneemt valt om zodra hij in een ander project draait. Dat is precies de
 * regressie die een portabiliteitscontrole ving nadat deze kaart als literal
 * werd toegevoegd.
 *
 * De kaart heeft geen prototype. Met een gewoon objectliteral levert
 * `kaart["constructor"]` een functie op in plaats van `undefined`, en dan
 * verandert een rol met die naam de controle in een TypeError.
 */
export function rolSchrijfrechten(config: JarvisConfig): ReadonlyMap<string, readonly string[]> {
  const map = (waarde: string) => `${waarde.replace(/\/+$/, "")}/`;
  const kennis = map(config.knowledge_map);
  const taken = map(config.taken_map);
  // De map waarin CURRENT_STATE staat. Ligt dat bestand in de wortel, dan is er
  // geen documentatiemap en krijgt de rol alleen dat ene bestand - anders zou
  // "STAND.md/" als mapvoorvoegsel worden gelezen en nergens op passen.
  const statusPad = config.current_state.replace(/\\/g, "/");
  const docs = statusPad.includes("/") ? `${statusPad.slice(0, statusPad.lastIndexOf("/"))}/` : statusPad;
  return new Map<string, readonly string[]>([
    // QA schrijft verslagen, geen tests: het rolcontract verbiedt QA om tests
    // te wijzigen, en wie de tests schrijft beoordeelt zijn eigen dekking.
    // Tests zijn van de bouwende rol (DEC-0040 in het eerste project).
    ["qa", [taken]],
    ["knowledge-manager", [kennis, taken, docs]],
    ["architect", [taken, docs]],
    ["orchestrator", [taken]],
  ]);
}

export type LintResultaat = {
  readonly ok: boolean;
  readonly bevindingen: readonly LintBevinding[];
};

function bevinding(
  code: LintCode,
  severity: "fout" | "waarschuwing",
  onderwerp: string,
  boodschap: string,
): LintBevinding {
  return { code, severity, onderwerp, boodschap };
}

/**
 * Zoekt een triggerwoord in vrije tekst.
 *
 * Woordgrenzen, hoofdletterongevoelig, meervouds-s toegestaan. Verder geen
 * fuzziness: stemming levert vals-positieven op, en die zijn hier duurder dan
 * een gemiste treffer — de semantische laag vangt de rest.
 *
 * Het streepje is bewust een GRENS en geen woordteken. Anders mist "webhook"
 * de zin "de klant vult zijn webhook-URL in", wat precies het geval is dat deze
 * controle moet vangen. Een meerdelige term als "API-key" bevat het streepje
 * zelf en matcht daardoor nog steeds letterlijk. De prijs is dat "webhook" ook
 * binnen "mijn-webhook-helper" aanslaat; dat is hier de juiste kant om op te
 * falen.
 */
export function bevatTriggerwoord(tekst: string, woord: string): boolean {
  const genormaliseerd = tekst.toLowerCase();
  const doel = woord.toLowerCase().trim();
  if (doel.length === 0) return false;
  const ontsnapt = doel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_])${ontsnapt}s?([^a-z0-9_]|$)`, "i").test(genormaliseerd);
}

/**
 * De enige vorm die als ack telt: een hele regel, precies zo geschreven.
 *
 * Hoofdlettergevoelig, precies één spatie na de dubbele punt, geen inspringing
 * en niets erachter.
 */
export const ACK_REGEL = /^Constraint-ack: (CON-\d{4}|ROL-STARTPUNT)$/;

/**
 * Leest acks uit een reviewtekst.
 *
 * EEN REGEL: de volledige review-body moet uitsluitend uit ack-regels bestaan.
 * Staat er ook maar één andere niet-lege regel in, dan levert de hele review
 * geen enkele ack.
 *
 * Dit is de vierde opzet, en de eerste die niet naar een verbergtechniek zoekt.
 * De drie ervoor probeerden te bepalen wat een lezer wél of niet ziet, en werden
 * alle drie gebroken: eerst HTML-tags, toen een elementenstack, toen een verbod
 * op puntige haken. Die laatste sneuvelde op markdown, dat tekst verbergt zonder
 * één punthaak — een linkreferentie met meerregelige titel toont de lezer alleen
 * een afwijzing terwijl de ack eronder meetelde.
 *
 * De fout zat niet in de filters maar in de vraag. Een review-body is vrije
 * tekst in een taal die verbergen ondersteunt; welk filter je er ook op zet, de
 * volgende manier is altijd nog niet bedacht. Deze opzet stelt de vraag niet
 * meer: is er niets omheen, dan valt er niets in te verbergen. Wat de parser
 * verwerkt is exact de volledige zichtbare inhoud van de review.
 *
 * WITRUIMTE, expliciet:
 *   - lege regels mogen overal — voor, tussen en na de ack-regels. Ze dragen
 *     geen zichtbare inhoud en GitHub voegt er zelf een toe aan het eind.
 *   - inspringing mag niet: een ingesprongen regel is in markdown een codeblok.
 *   - spaties en tabs ACHTER de ack mogen; die zijn onzichtbaar en er past niets
 *     in. Al het andere erachter niet.
 *   - de scheiding tussen regels is `\n` of `\r\n`. Een losse `\r`, een
 *     regelscheider uit unicode of een harde spatie blijft in de regel staan,
 *     matcht dus niet, en maakt de hele body ongeldig.
 *
 * Een reviewer die iets wil toelichten doet dat in een tweede review of een
 * comment. Die zijn geen ackbron, en dat is de bedoeling.
 */
export function parseerAcks(tekst: string): readonly string[] {
  const gevonden: string[] = [];
  for (const regel of tekst.split(/\r?\n/)) {
    if (regel.length === 0) continue;
    const zonderStaart = regel.replace(/[ \t]+$/, "");
    if (zonderStaart.length === 0) continue;
    const match = ACK_REGEL.exec(zonderStaart);
    // Eén afwijkende regel maakt de hele body ongeldig. Niet alleen die regel:
    // juist de tekst eromheen is de plek waar iets verstopt kan worden.
    if (match === null) return [];
    gevonden.push(match[1]);
  }
  return gevonden;
}

/**
 * Mag een ack uit deze bron meetellen?
 *
 * Een ack is een menselijk besluit. De PR-tekst schrijft de agent die de PR
 * opent, dus een ack die daaruit komt is een agent die zichzelf toestemming
 * geeft. Daarom telt alleen een bron met een aanwijsbare menselijke auteur.
 *
 * ALLEEN `OWNER`. Dat is de enige waarde van `author_association` waarvan
 * GitHub werkelijk garandeert dat de actor bevoegd is. `COLLABORATOR` zegt
 * uitsluitend dat iemand is uitgenodigd, op welk rechtenniveau dan ook - lezen
 * en triage inbegrepen - en `MEMBER` zegt alleen dat iemand in de organisatie
 * zit, niet dat hij op deze repository iets mag. Beide stonden hier eerst,
 * onder een commentaar dat "schrijfrecht" beloofde. De code deed toen minder
 * dan er stond, en dat is bij een beveiligingsgrens het gevaarlijkste soort
 * fout: hij is niet zichtbaar tot iemand hem gebruikt.
 *
 * Krijgt de repository later meerdere mensen met schrijfrecht, dan is de juiste
 * uitbreiding NIET er relaties bij zetten maar het recht zelf opvragen bij de
 * GitHub-API. Dat vraagt een token en is daarmee een aparte afweging.
 *
 * Dit is de deterministische helft. CODEOWNERS en branch protection blijven
 * ernaast staan als organisatorische controle; die twee vervangen elkaar niet.
 */
export const ACK_RELATIES = ["OWNER"] as const;

export function ackBronIsVertrouwd(actor: string, relatie: string): boolean {
  const naam = actor.trim();
  if (naam.length === 0) return false;
  if (naam.toLowerCase().endsWith("[bot]")) return false;
  return (ACK_RELATIES as readonly string[]).includes(relatie.trim().toUpperCase());
}

/**
 * Controleert de harde en zachte randvoorwaarden tegen deze wijziging.
 *
 * Een randvoorwaarde wordt "geraakt" wanneer de wijziging een van haar paden
 * aanraakt OF de tekst een van haar triggerwoorden noemt. Bij een HARDE
 * randvoorwaarde is dat blokkerend tenzij er een expliciete ack is; die ack
 * hoort van een mens te komen, niet van de agent zelf.
 */
export function toetsRandvoorwaarden(
  records: readonly KnowledgeRecord[],
  gewijzigdeBestanden: readonly string[],
  tekstCorpus: string,
  acks: readonly string[],
): readonly LintBevinding[] {
  const bevindingen: LintBevinding[] = [];
  const paden = gewijzigdeBestanden.map(normaliseerPad);
  const ackSet = new Set(acks.map((a) => a.trim().toUpperCase()));

  const constraints = records
    .filter((r): r is Extract<KnowledgeRecord, { type: "CON" }> => r.type === "CON")
    .filter((r) => isActiefRecord(r))
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  for (const con of constraints) {
    const triggers = con.triggers;
    if (!triggers) continue;

    const geraaktePaden = triggers.paden.length > 0 ? paden.filter((p) => matchtGlob(p, triggers.paden)) : [];
    const geraakteWoorden = triggers.woorden.filter((w) => bevatTriggerwoord(tekstCorpus, w));
    if (geraaktePaden.length === 0 && geraakteWoorden.length === 0) continue;

    const aanleiding = [
      geraaktePaden.length > 0 ? `paden: ${geraaktePaden.slice(0, 5).join(", ")}` : null,
      geraakteWoorden.length > 0 ? `woorden: ${geraakteWoorden.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    if (con.hardheid === "zacht") {
      bevindingen.push(
        bevinding(
          "randvoorwaarde_signaal",
          "waarschuwing",
          con.id,
          `zachte randvoorwaarde geraakt (${aanleiding}). Regel: ${con.regel}`,
        ),
      );
      continue;
    }

    if (ackSet.has(con.id.toUpperCase())) continue;

    bevindingen.push(
      bevinding(
        "randvoorwaarde_geraakt",
        "fout",
        con.id,
        `harde randvoorwaarde geraakt zonder "Constraint-ack: ${con.id}" (${aanleiding}). ` +
          `Regel: ${con.regel} — los dit op of laat een mens de afweging vastleggen.`,
      ),
    );
  }

  // Een ack naar een niet-bestaande of niet-getriggerde randvoorwaarde wijst op
  // kopieerwerk; die moet opvallen, anders wordt "ack" een ritueel.
  const geldig = new Set(constraints.map((c) => c.id.toUpperCase()));
  for (const ack of ackSet) {
    if (ack === "ROL-STARTPUNT") continue;
    if (!geldig.has(ack)) {
      bevindingen.push(
        bevinding("ack_onbekend", "waarschuwing", ack, `ack verwijst naar onbekende of vervallen randvoorwaarde`),
      );
    }
  }

  return bevindingen;
}

/** Alle controles samen. Volgorde is vast, zodat uitvoer vergelijkbaar blijft. */
/**
 * Is dit punt op de eigenaarslijst een administratieve bevestiging? Het lezen,
 * valideren of bevestigen van documentatie, een feitenblok, een status, een
 * dossier of een narratief is werk van de kennisbeheerder of QA, nooit van de
 * eigenaar (CON-0016; de eigenaar, 2026-09-14). Een punt dat daarnaast een
 * echte eigenaarshandeling noemt — inloggen, een credential, een instelling,
 * een betaling, een akkoord of beslissing — blijft staan.
 */
/**
 * Staat er een keuze verstopt in een stapregel?
 *
 * Een keuzepunt hoort zijn alternatieven als eigen optieregels te schrijven.
 * Gebeurt dat niet, dan valt de kaart terug op de standaardknoppen van het
 * soort en bereiken de alternatieven de eigenaar nooit — gemeten: een punt met
 * "kies tussen (a) … of (b) …" in een `Stap 1`-regel kwam bij de eigenaar aan
 * als één knop "Gedaan". De engine herkent zo'n regel nog wel (het vangnet),
 * maar dit is de norm en de poort bewaakt hem.
 */
/**
 * Alle tekst waarin een keuze kan schuilen: de vette tussenkop, de tekst van het
 * punt zelf, en élke labelregel.
 *
 * Dit was drie rondes lang een opsomming van labels, en dat is precies waarom er
 * elke ronde een volgend label overbleef. Ronde 7 vond een keuze in `- Extern:`,
 * ronde 8 in `- Voorwaarde:` en in de vette tussenkop. De motivering om
 * `- Let op:` en `- Controle:` uit te sluiten ("een waarschuwing hoort geen kaart
 * met knoppen te worden") is meetbaar onjuist: de kaart krijgt haar knoppen uit
 * het soort, niet uit deze lijst, dus uitsluiten verhindert geen knoppen — alleen
 * dat de poort de tegenspraak meldt.
 *
 * De omkering kost niets. Gemeten over de volledige historie van de drie
 * projecten, 140 unieke eigenaarspunten: acht bevindingen met de oude
 * labellijst, acht met deze — **nul** nieuwe treffers. Wat de kaart als tekst
 * toont, leest de poort.
 */
export function keuzeBronnen(
  tekst: string,
  regels: readonly { readonly label: string; readonly tekst: string }[],
  context = "",
): readonly string[] {
  return [context, tekst, ...regels.map((r) => r.tekst)].filter((t) => t.trim().length > 0);
}

export function keuzeNietUitgesplitst(punt: {
  readonly tekst: string;
  readonly context?: string;
  readonly regels?: readonly { readonly label: string; readonly tekst: string }[];
}): boolean {
  const regels = punt.regels ?? [];
  // Al netjes uitgesplitst: dan valt er niets te melden.
  if (leesAlternatieven(regels).length >= 2) return false;
  // Dezelfde herkenning als de engine gebruikt, niet een tweede kopie ervan:
  // wat het vangnet als keuze leest, hoort de poort als niet-uitgesplitst af
  // te keuren — en uit dezelfde bronnen. Twee eerdere versies vuurden daarom
  // nooit op de vorm waarvoor de regel is geschreven: eerst ankerde zij op
  // "Stap N:" in de toelichting, en daarna keek zij alleen naar de toelichting
  // terwijl de stapregels van een LRN-0014-punt in `regels` zitten en de
  // toelichting alleen de vette kop draagt (QA-ronde 5, N3).
  return keuzeBronnen(punt.tekst, regels, punt.context).some((t) => leesIngebedeKeuze(t).length >= 2);
}

/**
 * Een `Keuze`-regel zonder minstens twee brúíkbare alternatieven is een half
 * geschreven norm. Bruikbaar betekent: een eigen label én een gevolg. Een
 * eerdere versie telde alleen labels, waardoor `- Optie B:` zonder tekst en
 * twee keer `- Optie A:` allebei groen door de poort gingen terwijl de kaart
 * de eigenaar geen antwoord liet geven.
 */
export function keuzeZonderAlternatieven(regels: readonly { label: string; tekst: string }[]): boolean {
  const heeftKeuze = regels.some((r) => r.label.trim().toLowerCase() === "keuze");
  // Ook zonder `- Keuze:`-regel. Een punt met twee optieregels waarvan er te
  // weinig bruikbaar zijn — hetzelfde label tweemaal, of een optie zonder
  // gevolg — viel stil terug op `bevestiging` en kreeg "Gedaan" onder een
  // beslissing die nooit is genomen (QA-ronde 6, B2). Wie alternatieven
  // aandraagt, draagt er twee bruikbare aan of de poort zegt het.
  //
  // Maar "aandraagt" is precies wat de kaart eronder verstaat, niet minder. Deze
  // regel vuurde al bij één niet-annotatielabel terwijl de kaart er twee eist, en
  // keurde daarmee vijf echte historische dossierpunten af die niets met een keuze
  // te maken hadden — een punt met alleen `- Rotatie/intrekking: …` of alleen
  // `- Volgorde: …` naast zijn stappen. De boodschap sprak daarbij over een
  // `Keuze`-regel die er niet was. Dat is dezelfde asymmetrie tussen kaart en poort
  // die deze taak wegneemt, gespiegeld (QA-ronde 9, bevinding 1).
  const expliciet = regels.some((r) => isExplicietAlternatief(r.label));
  if (!heeftKeuze && !expliciet && alternatiefRegels(regels).length < 2) return false;
  // Letterlijk de functie van de engine, niet een tweede telling ernaast: zolang
  // de lint op `label.trim().toLowerCase()` ontdubbelde en de engine op
  // `sleutelVan`, ging `- Optie A:` naast `- Optie-A:` groen door de poort
  // terwijl de kaart de eigenaar alleen "Later" gaf (QA-ronde 5, B1).
  // Een keuze die haar alternatieven in de `Keuze`-regel zelf schrijft, leest
  // het vangnet wel; die vorm meldt `eigenaarslijst_keuze_niet_uitgesplitst`.
  if (leesIngebedeKeuze(regels.find((r) => r.label.trim().toLowerCase() === "keuze")?.tekst ?? "").length >= 2) return false;
  return leesAlternatieven(regels).length < 2;
}

/**
 * Een `- Wacht:`-regel naast een uitgeschreven keuze: het dossier zegt twee
 * dingen tegelijk. De kaart kiest sinds QA-ronde 6 voor de keuze — een vraag
 * blijft beantwoordbaar terwijl er op iets anders gewacht wordt — maar wélke
 * van de twee het is, hoort in het dossier te staan en niet uit een volgorde in
 * de code te volgen. Daarvóór wiste de wachtregel álle knoppen: de vraag stond
 * als kaarttitel en "Later" was het enige antwoord.
 */
export function wachtNaastKeuze(regels: readonly { label: string; tekst: string }[]): boolean {
  if (!regels.some((r) => r.label.trim().toLowerCase() === "wacht")) return false;
  const heeftKeuze = regels.some((r) => r.label.trim().toLowerCase() === "keuze");
  return heeftKeuze || leesAlternatieven(regels).length >= 2;
}

export function isAdministratieveBevestiging(tekst: string): boolean {
  const t = tekst.replace(/`/g, "").replace(/\s+/g, " ");
  const werkwoord = /\b(bevestig\w*|valideer\w*|controleer\w*|lees|nalezen|doorlezen|nakijken|kijk\w* na|goedkeur\w* (?:de|het) (?:tekst|documentatie))\b/i;
  const onderwerp = /\b(narratief|documentatie|feitenblok|CURRENT_STATE|statusdocument|dossier|INDEX\.json|kennisrecord|LRN-\d+|DEC-\d+ (?:tekst|record))\b/i;
  const echtEigenaar = /\b(inlog\w*|authentic\w*|credential\w*|wachtwoord|token|secret|instelling\w*|GitHub-instelling|betaal\w*|betaling|abonnement|factuur|akkoord|beslis\w*|keuze|kies|toestemming|uitnodig\w*|account)\b/i;
  return werkwoord.test(t) && onderwerp.test(t) && !echtEigenaar.test(t);
}

export function lint(invoer: LintInvoer): LintResultaat {
  const { config, lading } = invoer;
  const bevindingen: LintBevinding[] = [];

  // De eigenaarslijst bevat alleen wat werkelijk alleen de eigenaar kan of mag
  // doen (CON-0016). Een documentatie- of statusbevestiging die daar belandt,
  // komt als actie op zijn telefoon; de poort houdt dat tegen.
  for (const punt of invoer.eigenaarsPunten ?? []) {
    if (punt.buitenDeKaart) continue;
    if (!isAdministratieveBevestiging(punt.tekst)) continue;
    bevindingen.push(
      bevinding(
        "eigenaarslijst_administratief",
        "fout",
        punt.bestand,
        `"${punt.tekst.slice(0, 90)}${punt.tekst.length > 90 ? "…" : ""}" is een documentatie- of statusbevestiging; ` +
          `die doet Jarvis zelf (kennisbeheer of QA) en hoort niet in "Wat de eigenaar nog moet doen" (CON-0016).`,
      ),
    );
  }

  // Een keuze hoort haar alternatieven als eigen optieregels te schrijven; in
  // een stapregel verstopt bereiken ze de knoppen niet.
  for (const punt of invoer.eigenaarsPunten ?? []) {
    if (punt.buitenDeKaart) continue;
    if (!keuzeNietUitgesplitst(punt)) continue;
    bevindingen.push(
      bevinding(
        "eigenaarslijst_keuze_niet_uitgesplitst",
        "fout",
        punt.bestand,
        `"${punt.tekst.slice(0, 70)}${punt.tekst.length > 70 ? "…" : ""}" zet de alternatieven van een keuze in de lopende tekst; ` +
          `schrijf de vraag als "- Keuze: <vraag>" met daaronder "- Optie A: <gevolg>" en "- Optie B: <gevolg>", ` +
          `anders hangt de kaart van het vangnet af in plaats van van het formaat.`,
      ),
    );
  }

  // Een half geschreven keuze levert stil een onbruikbare kaart: de vraag staat
  // er, de alternatieven niet, en het punt valt terug op "Later".
  for (const punt of invoer.eigenaarsPunten ?? []) {
    if (punt.buitenDeKaart) continue;
    if (!keuzeZonderAlternatieven(punt.regels ?? [])) continue;
    bevindingen.push(
      bevinding(
        "eigenaarslijst_keuze_half",
        "fout",
        punt.bestand,
        `"${punt.tekst.slice(0, 70)}${punt.tekst.length > 70 ? "…" : ""}" kondigt alternatieven aan maar draagt er ` +
          `minder dan twee bruikbare: elk alternatief heeft een eigen label én een gevolg nodig, en twee labels die na ` +
          `normalisatie hetzelfde zijn tellen als één. Zonder die twee kan de eigenaar de vraag niet beantwoorden.`,
      ),
    );
  }

  // Een tekst die eruitziet als een keuze maar het formaat net niet haalt:
  // cijfers in plaats van letters, geen keuzewoord, twee keer hetzelfde merk,
  // of een leeg alternatief. De kaart kan die niet lezen, dus moet de poort hem
  // afdwingen — anders krijgt de eigenaar "Gedaan" onder een open vraag zonder
  // dat iets dat meldt (QA-ronde 6, B3).
  for (const punt of invoer.eigenaarsPunten ?? []) {
    if (punt.buitenDeKaart) continue;
    const regels = punt.regels ?? [];
    if (leesAlternatieven(regels).length >= 2) continue;
    if (!keuzeBronnen(punt.tekst, regels, punt.context ?? "").some((t) => lijktOpKeuze(t))) continue;
    bevindingen.push(
      bevinding(
        "eigenaarslijst_keuze_bijna",
        "fout",
        punt.bestand,
        `"${punt.tekst.slice(0, 70)}${punt.tekst.length > 70 ? "…" : ""}" leest als een keuze — twee of meer ` +
          `alternatieven door "of" gescheiden — maar het vangnet kan hem niet uitpakken (een ontbrekend keuzewoord, ` +
          `tweemaal hetzelfde merk, of een leeg alternatief). Schrijf hem als "- Keuze: <vraag>" met ` +
          `"- Optie A: <gevolg>" en "- Optie B: <gevolg>".`,
      ),
    );
  }

  // Een wachtregel naast een uitgeschreven keuze: het dossier zegt twee dingen
  // tegelijk, en de code hoort dat niet stil voor de eigenaar te beslissen.
  for (const punt of invoer.eigenaarsPunten ?? []) {
    if (punt.buitenDeKaart) continue;
    if (!wachtNaastKeuze(punt.regels ?? [])) continue;
    bevindingen.push(
      bevinding(
        "eigenaarslijst_wacht_en_keuze",
        "fout",
        punt.bestand,
        `"${punt.tekst.slice(0, 70)}${punt.tekst.length > 70 ? "…" : ""}" heeft zowel een "Wacht"-regel als een ` +
          `keuze. Beide kunnen niet waar zijn voor de eigenaar: of hij kan nu kiezen, of er valt te wachten. ` +
          `Haal de wachtregel weg, of maak er een apart punt van.`,
      ),
    );
  }

  // Optieregels onder een akkoordcontext, zonder `- Keuze:`-regel: de kaart geeft
  // dan "Akkoord"/"Niet akkoord" over een inhoudelijke keuze. Dat is de
  // gedocumenteerde uitkomst — een akkoord blijft een akkoord — maar het dossier
  // zegt daarmee twee dingen tegelijk, net als bij een wachtregel. Symmetrisch
  // met `eigenaarslijst_wacht_en_keuze` (QA-ronde 7, bevinding 6).
  for (const punt of invoer.eigenaarsPunten ?? []) {
    if (punt.buitenDeKaart) continue;
    const regels = punt.regels ?? [];
    if (!punt.akkoordContext) continue;
    if (regels.some((r) => r.label.trim().toLowerCase() === "keuze")) continue;
    if (leesAlternatieven(regels).length < 2) continue;
    bevindingen.push(
      bevinding(
        "eigenaarslijst_akkoord_en_keuze",
        "fout",
        punt.bestand,
        `"${punt.tekst.slice(0, 70)}${punt.tekst.length > 70 ? "…" : ""}" staat in een akkoordcontext en draagt ` +
          `tegelijk twee alternatieven. De kaart geeft dan "Akkoord"/"Niet akkoord" over een inhoudelijke keuze; ` +
          `schrijf de vraag als een eigen punt met "- Keuze: <vraag>", of haal de optieregels weg.`,
      ),
    );
  }

  // Een `- Extern:`- of `- Bevestig:`-regel naast een uitgeschreven keuze: de
  // keuze wint, en daarmee verliest de eigenaar de "Gedaan" waarmee hij een
  // handeling die hij wél heeft verricht zou melden. `wacht_en_keuze` en
  // `akkoord_en_keuze` bestonden al; dit is de derde van dezelfde soort, en hij
  // ontbrak nog (QA-ronde 8, bevinding 7).
  for (const punt of invoer.eigenaarsPunten ?? []) {
    if (punt.buitenDeKaart) continue;
    const regels = punt.regels ?? [];
    const soort = regels.find((r) => /^(extern|bevestig)$/i.test(r.label.trim()));
    if (soort === undefined) continue;
    if (leesAlternatieven(regels).length < 2) continue;
    bevindingen.push(
      bevinding(
        "eigenaarslijst_handeling_en_keuze",
        "fout",
        punt.bestand,
        `"${punt.tekst.slice(0, 70)}${punt.tekst.length > 70 ? "…" : ""}" heeft een "${soort.label.trim()}"-regel en ` +
          `tegelijk twee alternatieven. De keuze wint, en daarmee verdwijnt de knop waarmee je de handeling zou ` +
          `melden; maak er twee punten van.`,
      ),
    );
  }

  // Wat bij de eigenaar ligt leest hij op zijn telefoon: kort en zonder
  // technische namen (DEC-0046). Een technisch punt blijft staan — het kan
  // een echte handeling zijn — maar de poort zegt dat het herschreven hoort.
  for (const punt of invoer.eigenaarsPunten ?? []) {
    if (punt.buitenDeKaart) continue;
    const markers = technischeMarkers(punt.tekst);
    if (markers.length === 0) continue;
    bevindingen.push(
      bevinding(
        "eigenaarslijst_technisch",
        "waarschuwing",
        punt.bestand,
        `"${punt.tekst.slice(0, 70)}${punt.tekst.length > 70 ? "…" : ""}" bevat technische namen (${markers.slice(0, 3).join(", ")}); ` +
          `schrijf voor de eigenaar wat hij moet doen en waarom in gewone taal, en houd de techniek voor het team (DEC-0046).`,
      ),
    );
  }

  // Een ack uit een onbetrouwbare bron telt niet, en verdwijnt niet stilzwijgend.
  // Zonder deze stap kan de agent die de PR opent zichzelf toestemming geven voor
  // precies de afweging waarvoor een mens is aangewezen.
  const ackBronVertrouwd = invoer.ackBronVertrouwd ?? false;
  const acks = ackBronVertrouwd ? invoer.acks : [];
  if (!ackBronVertrouwd && invoer.acks.length > 0) {
    bevindingen.push(
      bevinding(
        "ack_bron_onbetrouwbaar",
        "fout",
        invoer.acks.join(", "),
        `deze ack komt uit ${invoer.ackBron ?? "een bron zonder aanwijsbare menselijke auteur"} en telt niet. ` +
          `Een ack is een menselijk besluit; een agent mag er geen voor zichzelf schrijven. ` +
          `Laat iemand met schrijfrecht de regel plaatsen in een review op de pull request.`,
      ),
    );
  }

  for (const fout of lading.laadFouten) {
    bevindingen.push(bevinding("laadfout", "fout", fout.bestand, formatteerLaadFout(fout)));
  }
  for (const issue of lading.validatie.issues) {
    bevindingen.push(
      bevinding(
        issue.severity === "fout" ? "kennis_ongeldig" : "kennis_signaal",
        issue.severity,
        issue.recordId ?? "(set)",
        formatteerBevinding(issue, lading.herkomst),
      ),
    );
  }

  bevindingen.push(
    ...toetsRandvoorwaarden(lading.records, invoer.gewijzigdeBestanden, invoer.tekstCorpus, acks),
  );

  // Statusdrift. Alleen relevant wanneer de wijziging status-dragende paden
  // raakt: een testrefactor of een UI-tekst hoort geen documentatieplicht te
  // veroorzaken, anders wordt de verklaring een betekenisloos ritueel.
  const raaktStatus = invoer.gewijzigdeBestanden.some((p) =>
    config.status_paden.some((s) => normaliseerPad(p).startsWith(normaliseerPad(s))),
  );
  const statusBijgewerkt = invoer.gewijzigdeBestanden.some(
    (p) => normaliseerPad(p) === normaliseerPad(config.current_state),
  );
  if (raaktStatus && !statusBijgewerkt && invoer.prContext !== false && !invoer.statusImpactVerklaard) {
    bevindingen.push(
      bevinding(
        "status_impact_ontbreekt",
        "fout",
        config.current_state,
        `deze wijziging raakt status-dragende paden; werk ${config.current_state} bij of ` +
          `verklaar "Current-State-Impact: none" met een motivatie`,
      ),
    );
  }

  const drempel = 10;
  if ((invoer.statusCommitsSinds ?? 0) > drempel) {
    bevindingen.push(
      bevinding(
        "status_verouderd",
        "waarschuwing",
        config.current_state,
        `${invoer.statusCommitsSinds} status-dragende commits sinds de laatste wijziging van ${config.current_state}`,
      ),
    );
  }

  const workflows = invoer.gewijzigdeBestanden
    .map(normaliseerPad)
    .filter((p) => p.startsWith(".github/workflows/"));
  if (workflows.length > 0) {
    bevindingen.push(
      bevinding(
        "workflow_gewijzigd",
        "waarschuwing",
        workflows.join(", "),
        `wijziging in workflows raakt de beveiligingsgrens rond productiesecrets; ` +
          `vereist review door de code-eigenaar`,
      ),
    );
  }

  // Het startpunt van de rolcontrole mag alleen naar ACHTEREN. Verschuift het
  // vooruit, dan wordt elke commit ertussen met terugwerkende kracht
  // vrijgesteld — en dan is de vrijstelling geen historische uitzondering meer
  // maar een knop waarmee een agent zijn eigen overtreding wegpoetst. De
  // configuratie zelf kent die richting niet, dus wordt hier ELKE wijziging van
  // de waarde geblokkeerd; een mens die hem bewust verzet, zet de ack.
  const startpuntGewijzigd =
    invoer.rolControleVanafBasis !== undefined &&
    invoer.rolControleVanafBasis !== config.rol_controle_vanaf;
  if (startpuntGewijzigd && !acks.some((a) => a === "ROL-STARTPUNT")) {
    bevindingen.push(
      bevinding(
        "startpunt_verschoven",
        "fout",
        "rol_controle_vanaf",
        `het startpunt van de rolcontrole wijzigt van "${invoer.rolControleVanafBasis || "(leeg)"}" naar ` +
          `"${config.rol_controle_vanaf || "(leeg)"}". Elke commit tussen die twee punten wordt daarmee ` +
          `vrijgesteld van de rolcontrole. Een agent mag dit niet zelf doen; laat een mens ` +
          `"Constraint-ack: ROL-STARTPUNT" zetten met de reden erbij.`,
      ),
    );
  }

  // Bevoegdheidscontrole per commit. Een rol die buiten zijn mandaat schrijft
  // is geen stijlkwestie: het is het verschil tussen "QA keurde onafhankelijk"
  // en "QA repareerde wat hij zelf beoordeelde".
  if (invoer.commitlogOnleesbaar) {
    bevindingen.push(
      bevinding(
        "commitlog_onleesbaar",
        "fout",
        "rolcontrole",
        "de commitlog van deze branch was niet volledig en eenduidig te lezen (een commitbericht met een " +
          "record- of veldscheidingsteken, of een verschil met rev-list); zonder volledige lezing is er geen " +
          "rolcontrole, dus de poort weigert. Herschrijf het bericht van die commit op een nieuwe commit.",
      ),
    );
  }
  if ((invoer.commitsAfgekapt ?? 0) > 0) {
    // Blokkerend, niet signalerend. Een waarschuwing die de build groen laat is
    // op dit punt hetzelfde als stil afkappen: het resultaat ziet eruit als een
    // volledige toets terwijl de oudste commits nooit zijn bekeken.
    bevindingen.push(
      bevinding(
        "commits_afgekapt",
        "fout",
        "rolcontrole",
        `${invoer.commitsAfgekapt} commit(s) vielen buiten de rolcontrole omdat de branch langer is dan ` +
          `de leeslimiet. Splits de branch of voeg hem eerder samen.`,
      ),
    );
  }

  const rechten = rolSchrijfrechten(config);
  for (const commit of invoer.commits ?? []) {
    if (commit.voorStartpunt) continue;
    if (commit.rol === null) {
      bevindingen.push(
        bevinding(
          "rol_ontbreekt",
          "waarschuwing",
          commit.hash,
          `commit "${commit.onderwerp}" heeft geen Jarvis-Role-trailer; niet herleidbaar wie wat deed`,
        ),
      );
      continue;
    }
    // Kleine letters: `Jarvis-Role: QA` hoort dezelfde grens te krijgen als
    // `qa`. Zonder deze stap is een hoofdletter genoeg om de controle over te
    // slaan, en dat is geen grens maar een suggestie.
    const rol = commit.rol.trim().toLowerCase();
    if (!BEKENDE_ROLLEN.includes(rol as (typeof BEKENDE_ROLLEN)[number])) {
      bevindingen.push(
        bevinding(
          "rol_onbekend",
          "fout",
          commit.hash,
          `commit draagt rol "${commit.rol}", die niet bestaat. Bekende rollen: ${BEKENDE_ROLLEN.join(", ")}. ` +
            `Een onbekende rol kent geen mandaat en zou dus alles mogen — daarom is dit een fout, geen signaal.`,
        ),
      );
      continue;
    }
    const toegestaan = rechten.get(rol);
    if (!toegestaan) continue;
    const buiten = commit.bestanden
      .map(normaliseerPad)
      .filter((p) => !toegestaan.some((voorvoegsel) => p.startsWith(voorvoegsel)));
    if (buiten.length === 0) continue;
    bevindingen.push(
      bevinding(
        "rol_overschrijding",
        "fout",
        commit.hash,
        `rol "${rol}" mag alleen schrijven in ${toegestaan.join(", ")}, maar deze commit raakt ` +
          `${buiten.slice(0, 4).join(", ")}${buiten.length > 4 ? ` en ${buiten.length - 4} meer` : ""}`,
      ),
    );
  }

  const decs = invoer.nieuweDecs ?? 0;
  if (decs > config.limieten.nieuwe_dec_per_taak) {
    bevindingen.push(
      bevinding(
        "dec_quotum",
        "waarschuwing",
        "knowledge/DECISIONS",
        `${decs} nieuwe besluiten in één taak (drempel ${config.limieten.nieuwe_dec_per_taak}) — ` +
          `meestal een teken van te fijnmazig registreren`,
      ),
    );
  }

  return { ok: !bevindingen.some((b) => b.severity === "fout"), bevindingen };
}

/** Eén regel per bevinding, geschikt voor CI-uitvoer. */
export function formatteerLint(resultaat: LintResultaat): string {
  if (resultaat.bevindingen.length === 0) return "jarvis lint: geen bevindingen.";
  const regels = resultaat.bevindingen.map(
    (b) => `${b.severity === "fout" ? "FOUT " : "WAARSCHUWING "} [${b.code}] ${b.onderwerp}: ${b.boodschap}`,
  );
  const fouten = resultaat.bevindingen.filter((b) => b.severity === "fout").length;
  const waarschuwingen = resultaat.bevindingen.length - fouten;
  regels.push("", `${fouten} fout(en), ${waarschuwingen} waarschuwing(en).`);
  return regels.join("\n");
}
