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
  "ack_bron_onbetrouwbaar",
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
  /** Aantal nieuwe DEC-records in deze wijziging. */
  readonly nieuweDecs?: number;
  /** Commits op deze branch, met hun rol-trailer en gewijzigde bestanden. */
  readonly commits?: readonly CommitOverzicht[];
  /** Waarde van `rol_controle_vanaf` op de basisbranch, om verschuiving te zien. */
  readonly rolControleVanafBasis?: string;
  /** Aantal commits dat buiten de rolcontrole viel doordat de lijst is afgekapt. */
  readonly commitsAfgekapt?: number;
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
  const tests = map(config.test_pad);
  // De map waarin CURRENT_STATE staat. Ligt dat bestand in de wortel, dan is er
  // geen documentatiemap en krijgt de rol alleen dat ene bestand - anders zou
  // "STAND.md/" als mapvoorvoegsel worden gelezen en nergens op passen.
  const statusPad = config.current_state.replace(/\\/g, "/");
  const docs = statusPad.includes("/") ? `${statusPad.slice(0, statusPad.lastIndexOf("/"))}/` : statusPad;
  return new Map<string, readonly string[]>([
    ["qa", [tests, taken]],
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
 * Hoofdlettergevoelig en zonder speelruimte. De losse variant hiervoor was
 * hoofdletterongevoelig en kende geen regelanker, waardoor een onafhankelijke
 * QA vier manieren aantoonde om er per ongeluk of expres een te plaatsen:
 * kleine letters, zonder spatie na de dubbele punt, binnen een codeblok dat als
 * "slechts documentatie" was gelabeld, en geciteerd als
 * `> Reviewer zei: Constraint-ack: ... (nog niet akkoord)`. Zie parseerAcks
 * voor de tweede regel die daarnaast geldt.
 */
export const ACK_REGEL = /^Constraint-ack: (CON-\d{4}|ROL-STARTPUNT)$/;

const FENCE = /^ {0,3}(```|~~~)/;

/**
 * Leest acks uit een reviewtekst.
 *
 * Twee regels, en meer niet.
 *
 * EEN. Staat er ergens in de tekst een `<` of een `>`, dan levert die review
 * geen enkele ack. Niet "de regel telt niet", maar de hele tekst.
 *
 * Dat is bewust bot. De vorige drie pogingen probeerden te bepalen welke HTML
 * iets verbergt, en elke poging werd gebroken: eerst telden `<details>` en
 * `<!-- -->` niet mee maar `<?xml ?>` wel, toen sloot een losse `</p>` het blok
 * weer, daarna sloot `</ details>` met een spatie iets wat in HTML juist
 * openblijft. Dat is geen reeks slordigheden maar een structureel verlies: wie
 * HTML-semantiek naprogrammeert met reguliere expressies, verliest van iemand
 * die de specificatie beter kent. Er is één manier om die wedstrijd niet te
 * spelen, en dat is niet meedoen.
 *
 * De prijs is zichtbaar en klein: een reviewer die toevallig een `<` in zijn
 * tekst heeft, plaatst de ack opnieuw zonder. De winst is dat er niets meer te
 * omzeilen valt — er is geen verbergtechniek die zonder puntige haken werkt.
 *
 * TWEE. Binnen die tekst telt alleen een exacte, losse regel: hoofdletter-
 * gevoelig, niet ingesprongen, niet in een codeblok.
 *
 * Geciteerde regels vallen automatisch af, want die beginnen met `>`.
 *
 * De codeblokherkenning draagt hier geen beveiligingsgewicht meer. Wijkt zij af
 * van die van GitHub, dan is het ergste geval dat een ack in monospace staat in
 * plaats van in gewone tekst — de reviewer ziet hem hoe dan ook. Verbergen kan
 * niet meer: dat vraagt HTML, en HTML is er niet.
 */
export function parseerAcks(tekst: string): readonly string[] {
  if (BEVAT_PUNTIGE_HAAK.test(tekst)) return [];

  const gevonden: string[] = [];
  let blok: string | null = null;
  for (const regel of tekst.split(/\r?\n/)) {
    const fence = FENCE.exec(regel);
    if (fence !== null) {
      if (blok === null) blok = fence[1];
      else if (fence[1] === blok) blok = null;
      continue;
    }
    if (blok !== null) continue;

    const match = ACK_REGEL.exec(regel.replace(/[ \t]+$/, ""));
    if (match) gevonden.push(match[1]);
  }
  return gevonden;
}

const BEVAT_PUNTIGE_HAAK = /[<>]/;

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
export function lint(invoer: LintInvoer): LintResultaat {
  const { config, lading } = invoer;
  const bevindingen: LintBevinding[] = [];

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
  if (raaktStatus && !statusBijgewerkt && !invoer.statusImpactVerklaard) {
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
