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
  "routine_prompt_kopie",
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
  readonly eigenaarsPunten?: readonly { readonly bestand: string; readonly tekst: string }[];
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
  /**
   * De routinetekst en het promptveld van de uitvoerder die deze poort draait,
   * om een terugkerende kopie te betrappen. Beide komen van buiten: de engine
   * bevraagt de platformlaag niet en kent geen tokens. Ontbreekt een van de
   * twee, dan vuurt de regel niet — zij kan niets beweren over wat zij niet
   * heeft gezien.
   */
  readonly routine?: { readonly tekst: string; readonly prompt: string; readonly verwijzing?: string };
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
/** Regels die in beide teksten zo letterlijk voorkomen dat het een kopie is. */
export const PROMPT_KOPIE_MINIMUM = 40;

/**
 * Staat de routinetekst opnieuw in het promptveld van de uitvoerder?
 *
 * Deze kopie is er twee keer geweest. Zij is het soort fout dat niemand opmerkt:
 * de routine wordt bijgewerkt in de repository, het promptveld houdt een oude
 * versie, en de uitvoerder draait maanden op instructies die niemand meer leest.
 * De koppeling is inmiddels één verwijzing naar `docs/ROUTINE_CLOUD.md`, en deze
 * regel bewaakt dat zij dat blijft.
 *
 * Gemeten op overlap van hele regels, niet op woorden: een prompt die naar de
 * routine *verwijst* deelt losse woorden met haar, maar geen hele zinnen. De
 * drempel van 40 tekens houdt koppen, opsommingstekens en losse termen erbuiten.
 *
 * Wat teruggegeven wordt is de ingekorte regel, nooit de hele prompt: die kan
 * instellingen of namen bevatten en hoort niet in een bevinding terecht te komen.
 */
export function promptKopieRegels(routine: string, prompt: string): readonly string[] {
  const normaliseer = (t: string) =>
    t
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((r) => r.replace(/^[\s>*\-#\d.)]+/, "").replace(/\s+/g, " ").trim())
      .filter((r) => r.length >= PROMPT_KOPIE_MINIMUM);
  const inPrompt = new Set(normaliseer(prompt));
  const uit: string[] = [];
  for (const regel of normaliseer(routine)) {
    if (!inPrompt.has(regel) || uit.includes(regel)) continue;
    uit.push(regel);
  }
  return uit;
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

  // Staat de routinetekst opnieuw in het promptveld? Die kopie is er twee keer
  // geweest, en zij valt niemand op: de repository verandert, het promptveld
  // houdt een oude versie, en de uitvoerder draait op instructies die niemand
  // meer leest. De regel vuurt alleen wanneer beide teksten zijn meegegeven.
  if (invoer.routine !== undefined && invoer.routine.tekst.trim() !== "" && invoer.routine.prompt.trim() !== "") {
    const kopie = promptKopieRegels(invoer.routine.tekst, invoer.routine.prompt);
    if (kopie.length > 0) {
      const waar = invoer.routine.verwijzing ?? "de routine van deze uitvoerder";
      bevindingen.push(
        bevinding(
          "routine_prompt_kopie",
          "fout",
          "docs/ROUTINE_CLOUD.md",
          `het promptveld van ${waar} bevat ${kopie.length} regel(s) die letterlijk in de routinetekst staan; ` +
            `de koppeling hoort één verwijzing naar dat bestand te zijn, anders draait de uitvoerder op een kopie ` +
            `die niet meeverandert. Eerste regel: "${kopie[0].slice(0, 90)}${kopie[0].length > 90 ? "…" : ""}".`,
        ),
      );
    }
  }

  // Wat bij de eigenaar ligt leest hij op zijn telefoon: kort en zonder
  // technische namen (DEC-0046). Een technisch punt blijft staan — het kan
  // een echte handeling zijn — maar de poort zegt dat het herschreven hoort.
  for (const punt of invoer.eigenaarsPunten ?? []) {
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
