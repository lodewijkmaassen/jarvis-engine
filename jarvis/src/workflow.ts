// De governancebestanden van Jarvis.
//
// WAT DEZE CONTROLE IS, EN WAT NIET
//
// Dit is defense-in-depth, geen trust anchor. De workflow, de configuratie en
// de code die haar valideert leven alle drie in dezelfde repository en kunnen
// dus samen gewijzigd worden. Een controle die in die repository woont, kan
// daarom nooit bewijzen dat de repository te vertrouwen is.
//
// De echte beveiligingsgrens ligt buiten deze code:
//   - branch protection op de hoofdbranch;
//   - verplichte menselijke review;
//   - CODEOWNERS op elk governancekritiek pad;
//   - geen bypass voor de bot of de agent;
//   - productiecredentials buiten agentbranches.
//
// Wat deze controle wél oplevert: een wijziging aan de poort valt op vóórdat
// een mens ernaar kijkt, en kan niet stilzwijgend meeliften. Dat is nuttig, en
// het is minder dan bewijs.
//
// WAT DE BYTE-VERGELIJKING PRECIES ZEGT
//
// "De repositoryversie van de actieve governanceworkflow is byte-identiek aan
// de canonieke bron, op de geteste commit." Niet meer.
//
// Het zegt NIET dat de workflow die GitHub heeft uitgevoerd dat bestand was:
// bij `pull_request` laadt GitHub de definitie van de merge-ref en bij
// `pull_request_review` die van de standaardbranch, terwijl de checkout de
// head-sha uitcheckt. Die semantiek valt buiten wat hier te controleren is.
//
// WAAROM DE PADEN HIER STAAN EN NIET IN DE CONFIGURATIE
//
// Ze stonden in `jarvis.config.yml`. Een onafhankelijke QA zette beide paden op
// hetzelfde bestand, committeerde dat netjes, en haalde een groene poort boven
// een workflow met `run: echo pwned` - inclusief de melding dat alles gelijk
// was. Een controle die haar eigen scope uit configuratiedata haalt, controleert
// wat die data zegt, niet wat er is.

import path from "node:path";

/** Het bestand dat GitHub draait. Niet instelbaar. */
export const ACTIEVE_WORKFLOW = ".github/workflows/jarvis-lint.yml";

/**
 * De goedgekeurde bron ervan. Niet instelbaar.
 *
 * In de engine-repository zelf staat hij in de repository; bij een consumer
 * komt hij mee met de geïnstalleerde engine. Welke van de twee geldt, volgt
 * uit de modus (zie engine.ts), niet uit configuratie.
 */
export const CANONIEKE_WORKFLOW = "jarvis/canonical/jarvis-lint.yml";
export const CANONIEKE_WORKFLOW_CONSUMER = "node_modules/jarvis-engine/jarvis/canonical/jarvis-lint.yml";

export function canoniekeWorkflowPad(modus: "engine" | "consumer"): string {
  return modus === "engine" ? CANONIEKE_WORKFLOW : CANONIEKE_WORKFLOW_CONSUMER;
}

/** De governanceconfiguratie zelf. Niet instelbaar. */
export const GOVERNANCE_CONFIG = "jarvis.config.yml";

/** De map waarin workflows staan. */
export const WORKFLOW_MAP = ".github/workflows";

/**
 * De workflows die in deze repository horen te staan.
 *
 * Een tweede workflowbestand is een tweede ingang. QA voegde er een toe met
 * dezelfde naam en job als de poort, op dezelfde events, met schrijfrechten:
 * de poort bleef groen omdat er maar naar één pad werd gekeken.
 *
 * Dit is bewust een korte, harde lijst en geen patroon. Wie een workflow
 * toevoegt, wijzigt deze lijst, en dat is een wijziging in `jarvis/src/` die
 * onder CODEOWNERS valt.
 */
export const TOEGESTANE_WORKFLOWS: readonly string[] = [
  // De governance-poort zelf.
  "jarvis-lint.yml",
  // Bestaande workflows van voor Jarvis. Ze staan hier omdat ze er zijn, niet
  // omdat ze beoordeeld zijn: alleen `jarvis-lint.yml` heeft een canonieke
  // bron. Wat deze lijst wel doet is een NIEUWE workflow tegenhouden.
  "ci.yml",
  "db-backup.yml",
  "jobs-cron.yml",
];

/**
 * De testbestanden die de governancegrens dekken.
 *
 * Een onafhankelijke QA verwijderde `tests/jarvis/workflow.test.ts` en de suite
 * bleef groen op vierenzeventig bestanden; een `exclude` in de testconfiguratie
 * deed hetzelfde. De dekking die een gat moet melden, was zelf zonder review weg
 * te nemen.
 *
 * De poort controleert daarom dat deze bestanden bestaan en inhoud hebben. Dat
 * is bewust het minimum: het vangt weghalen en leegmaken, niet elke manier om
 * een test krachteloos te maken. Voor dat laatste is CODEOWNERS op `tests/` en
 * op de testconfiguratie de maatregel; deze guard zorgt dat de eenvoudigste
 * route niet stilzwijgend groen wordt.
 */
export const VERPLICHTE_GOVERNANCE_TESTS: readonly string[] = [
  "tests/jarvis/workflow.test.ts",
  "tests/jarvis/args.test.ts",
  "tests/jarvis/lint.test.ts",
  "tests/jarvis/sanitize.test.ts",
  "tests/jarvis/startpunt.test.ts",
];

export type BestandsFeiten = {
  /** Ruwe inhoud, of null wanneer het bestand niet te lezen is. */
  readonly bytes: Uint8Array | null;
  /** Is het pad zelf, of een map erboven, een symbolische link? */
  readonly viaSymlink: boolean;
  /** Het pad na het volgen van links, of null. */
  readonly echtPad: string | null;
};

export type GovernanceInvoer = {
  /** Absoluut pad van de repositorywortel, al opgelost. */
  readonly wortelEchtPad: string;
  /**
   * "engine" in de engine-repository zelf, "consumer" in een project dat de
   * engine als afhankelijkheid heeft. Bepaalt waar de canonieke bron staat en
   * of de verplichte governance-tests hier horen te staan (alleen in de
   * engine: een consumer heeft die tests niet, de engine draait ze zelf).
   * Ontbreekt: "engine", zodat bestaande toetsen hun betekenis houden.
   */
  readonly modus?: "engine" | "consumer";
  readonly actief: BestandsFeiten;
  readonly canoniek: BestandsFeiten;
  /** Bestandsnamen in de workflowmap, of null wanneer die niet te lezen is. */
  readonly workflowMapInhoud: readonly string[] | null;
  /** Per verplicht governance-testbestand: het aantal bytes, of null als het ontbreekt. */
  readonly testGroottes: ReadonlyMap<string, number | null>;
};

/** Regelnummer en kolom van een byte-offset, om een verschil aanwijsbaar te maken. */
function plaatsVan(bytes: Uint8Array, offset: number): string {
  let regel = 1;
  let kolom = 1;
  for (let i = 0; i < offset && i < bytes.length; i += 1) {
    if (bytes[i] === 0x0a) {
      regel += 1;
      kolom = 1;
    } else {
      kolom += 1;
    }
  }
  return `regel ${regel}, teken ${kolom}`;
}

function alsHex(byte: number | undefined): string {
  return byte === undefined ? "einde van het bestand" : `0x${byte.toString(16).padStart(2, "0")}`;
}

export type WorkflowVergelijking =
  | { readonly gelijk: true }
  | { readonly gelijk: false; readonly reden: string };

/**
 * Zijn de twee bestanden byte voor byte gelijk?
 *
 * Geen enkele normalisatie: geen trim, geen regeleindes gelijktrekken, geen
 * unicode-normalisatie. Elke vorm van "eigenlijk hetzelfde" is een oordeel, en
 * juist die oordelen bleken telkens het gat.
 */
export function vergelijkWorkflow(actief: Uint8Array | null, canoniek: Uint8Array | null): WorkflowVergelijking {
  if (canoniek === null) return { gelijk: false, reden: "de canonieke bron ontbreekt of is niet te lezen" };
  if (actief === null) return { gelijk: false, reden: "het actieve bestand ontbreekt of is niet te lezen" };

  const kortste = Math.min(actief.length, canoniek.length);
  for (let i = 0; i < kortste; i += 1) {
    if (actief[i] !== canoniek[i]) {
      return {
        gelijk: false,
        reden:
          `wijkt af op ${plaatsVan(canoniek, i)}: het actieve bestand heeft ${alsHex(actief[i])}, ` +
          `de canonieke bron ${alsHex(canoniek[i])}`,
      };
    }
  }
  if (actief.length !== canoniek.length) {
    const langer = actief.length > canoniek.length ? "actieve bestand" : "canonieke bron";
    return {
      gelijk: false,
      reden:
        `is gelijk tot ${plaatsVan(canoniek, kortste)}, maar het ${langer} gaat daarna verder ` +
        `(${actief.length} tegen ${canoniek.length} bytes)`,
    };
  }
  return { gelijk: true };
}

/** Ligt dit opgeloste pad binnen de repository? */
function binnenRepo(wortelEchtPad: string, echtPad: string): boolean {
  const relatief = path.relative(wortelEchtPad, echtPad);
  return relatief.length > 0 && !relatief.startsWith("..") && !path.isAbsolute(relatief);
}

/**
 * Alle governancecontroles over de al verzamelde feiten.
 *
 * Puur: de I/O gebeurt bij de aanroeper, zodat elk geval hier met een verzonnen
 * situatie te toetsen is - een symlink, een ontbrekend bestand, een tweede
 * workflow - zonder die situatie op schijf te hoeven maken.
 *
 * Geeft de redenen terug waarom het niet in orde is. Leeg betekent in orde.
 */
export function controleerGovernance(invoer: GovernanceInvoer): readonly string[] {
  const redenen: string[] = [];
  const { wortelEchtPad, actief, canoniek } = invoer;
  const modus = invoer.modus ?? "engine";
  const canoniekPad = canoniekeWorkflowPad(modus);

  // Symlinks eerst: een link maakt elk oordeel over "welk bestand is dit"
  // onbetrouwbaar. QA liet `jarvis/canonical` naar `.github/workflows` wijzen,
  // waarna het bestand met zichzelf werd vergeleken en alles klopte.
  if (actief.viaSymlink) redenen.push(`${ACTIEVE_WORKFLOW} is een symbolische link of ligt achter een link`);
  if (canoniek.viaSymlink) redenen.push(`${canoniekPad} is een symbolische link of ligt achter een link`);

  for (const [naam, feiten] of [
    [ACTIEVE_WORKFLOW, actief],
    [canoniekPad, canoniek],
  ] as const) {
    if (feiten.echtPad !== null && !binnenRepo(wortelEchtPad, feiten.echtPad)) {
      redenen.push(`${naam} wijst na het volgen van links buiten de repository`);
    }
  }

  // Twee paden die hetzelfde bestand zijn, vergelijken niets.
  if (actief.echtPad !== null && canoniek.echtPad === actief.echtPad) {
    redenen.push(`${ACTIEVE_WORKFLOW} en ${canoniekPad} zijn hetzelfde bestand`);
  }

  if (redenen.length === 0) {
    const uitkomst = vergelijkWorkflow(actief.bytes, canoniek.bytes);
    if (!uitkomst.gelijk) redenen.push(`${ACTIEVE_WORKFLOW} ${uitkomst.reden}`);
  }

  if (invoer.workflowMapInhoud === null) {
    redenen.push(`${WORKFLOW_MAP} is niet te lezen`);
  } else {
    const onbekend = invoer.workflowMapInhoud.filter((naam) => !TOEGESTANE_WORKFLOWS.includes(naam)).sort();
    if (onbekend.length > 0) {
      redenen.push(
        `${WORKFLOW_MAP} bevat ${onbekend.length} workflow(s) die hier niet horen: ${onbekend.join(", ")}. ` +
          `Een tweede workflow is een tweede ingang; voeg hem toe aan TOEGESTANE_WORKFLOWS als hij er hoort ` +
          `te zijn, en laat die wijziging beoordelen.`,
      );
    }
  }

  // Alleen in de engine-repository: een consumer draagt deze tests niet, de
  // engine draait ze in zijn eigen CI vóór een commit ooit op main komt.
  for (const testpad of modus === "engine" ? VERPLICHTE_GOVERNANCE_TESTS : []) {
    const grootte = invoer.testGroottes.get(testpad) ?? null;
    if (grootte === null) {
      redenen.push(`${testpad} ontbreekt; dat is een verplichte governance-test`);
    } else if (grootte === 0) {
      redenen.push(`${testpad} is leeg; dat is een verplichte governance-test`);
    }
  }

  return redenen;
}
