// De opdrachten van de Jarvis-CLI.
//
// Deze module voert NIETS uit bij het importeren en beeindigt het proces nooit.
// Het entrypoint staat in cli.ts; daar en nergens anders staat `process.exit`.
// Dat onderscheid is niet cosmetisch: zolang deze code bij het importeren de
// CLI startte, kon er geen enkele test bij, en had de duplicaatweigering nul
// dekking terwijl hij wel een beveiligingsgrens is.
//
// Alles hieronder is een dunne schil. De logica zit in de modules ernaast en
// is puur; hier gebeuren de drie dingen die niet puur kunnen zijn: argumenten
// lezen, de schijf aanraken en git bevragen.
//
// Gebruik: npx tsx jarvis/src/cli.ts <opdracht> [opties]
import { execFile } from "node:child_process";
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { bouwContextPakket, rendereerPakket } from "./context";
import { leesArgumenten } from "./args";
import { parseFrontMatter } from "./frontmatter";
import { laadConfig, leesStartpuntUitConfig, parseConfigTekst, vindWortel, type JarvisConfig, type TaakKlasse } from "./config";
import { ackBronIsVertrouwd, formatteerLint, lint, parseerAcks } from "./lint";
import { analyseerPlan, parseerPlanTabel, rendereerPlan } from "./plan";
import { RECORD_TYPES, type RecordType } from "./records";
import { createFileReader } from "./sources";
import {
  blokIsActueel,
  genereerFeitenblok,
  leesFeitenblok,
  nieuwStateDocument,
  vervangFeitenblok,
  type StateFeiten,
} from "./state";
import { ALLOWLIST_BESTANDSNAAM, LEGE_ALLOWLIST, laadAllowlist, scanTekst, type Allowlist } from "./sanitize";
import {
  RECENT_DAGEN,
  bouwOverzicht,
  leesItemsOnder,
  type Overzicht,
  type GitRegel,
  type ProjectInvoer,
  type ProjectOverzicht,
  type TaakDossier,
} from "./overzicht";
import { genereerAfgeleiden, leesRolcontract, vindDrift, type Rolcontract } from "./rollen";
import { ROLLEN, bepaalRegie, type Activiteit, type Rol } from "./regie";
import { laadKennis, type KennisLading } from "./store";
import {
  ACTIEVE_ATTESTATIE,
  ACTIEVE_WORKFLOW,
  canoniekeAttestatiePad,
  canoniekeWorkflowPad,
  VERPLICHTE_GOVERNANCE_TESTS,
  WORKFLOW_MAP,
  controleerGovernance,
  type BestandsFeiten,
} from "./workflow";
import {
  attestatieInhoud,
  attestatieTekst,
  beoordeelAttestatie,
  leesAttestatie,
  scopeHash,
  takenUitCommits,
  verifieerAttestatie,
  type AttestatieFeiten,
  type Autorisatie,
  type TaakFeiten,
  type Toetsing,
} from "./attestatie";
import { bepaalModus, beoordeelEngine, ENGINE_MAP, leesEngineStand, type HoofdbranchVergelijking } from "./engine";
import {
  AUTORISATIE_ID_SQL,
  AUTORISATIE_PR_SQL,
  AUTORISATIE_TAAK_SQL,
  AUTORISATIES_SINDS_SQL,
  AUTORISATIES_SQL,
  berichtId,
  ACTIVITEIT_RECENT_SQL,
  ACTIVITEIT_SQL,
  BERICHT_VAN_JARVIS_SQL,
  claimSql,
  DOCUMENT_SQL,
  isOordeel,
  isTabel,
  NIEUWE_ANTWOORDEN_SQL,
  NIEUWE_BERICHTEN_SQL,
  restPadAutorisatiePr,
  restPadAutorisatieTaak,
  restPadToetsingKop,
  TOETSING_ID_SQL,
  TOETSING_KOP_SQL,
  TOETSING_SQL,
  verbindingsBron,
  verwerktSql,
  WIE_SQL,
} from "./db";
import { randomBytes } from "node:crypto";
import { ATTESTATIE_GEBRUIKER, beoordeelOpenen, beoordeelSamenvoegen, eigenaarVan, SAMENVOEGMETHODE, VERPLICHTE_CHECK, type PullRequestFeiten } from "./pr";
import { homedir } from "node:os";

const uitvoeren = promisify(execFile);

/** Git-aanroep die nooit gooit: een lege repo of ontbrekende ref is geen crash. */
async function git(wortel: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await uitvoeren("git", [...args], { cwd: wortel, maxBuffer: 32 * 1024 * 1024 });
    return stdout.trim();
  } catch {
    return "";
  }
}

// Formaat voor één `git log` over de hele branch: recordscheiding (0x1e) per
// commit, veldscheiding (0x1f) tussen hash, onderwerp en volledig bericht; de
// gewijzigde bestanden volgen door `--name-only` als losse regels.
const COMMIT_LOG_FORMAAT = "--format=%x1e%H%x1f%s%x1f%B%x1f";

export interface GelezenCommit {
  readonly hash: string;
  readonly onderwerp: string;
  readonly bericht: string;
  readonly bestanden: readonly string[];
}

export type CommitLog = {
  readonly commits: readonly GelezenCommit[];
  /**
   * Records die niet de verwachte vorm hadden: geen hash op de eerste plaats,
   * of niet precies vier velden. Een commitbericht dat zelf een record- of
   * veldscheidingsteken bevat, verstoort het parsen; dat mag nooit stil een
   * commit uit de rolcontrole laten vallen, dus het wordt geteld en de poort
   * weigert (fail-closed).
   */
  readonly ongeldig: number;
};

export function leesCommitLog(uitvoer: string): CommitLog {
  const commits: GelezenCommit[] = [];
  let ongeldig = 0;
  for (const record of uitvoer.split("\u001e")) {
    if (record.trim().length === 0) continue;
    const velden = record.split("\u001f");
    if (velden.length !== 4 || !/^[0-9a-f]{40}$/.test(velden[0].trim())) {
      ongeldig += 1;
      continue;
    }
    const [hash, onderwerp, bericht, bestanden] = velden;
    commits.push({
      hash: hash.trim(),
      onderwerp: onderwerp.trim(),
      bericht: bericht.trim(),
      bestanden: bestanden
        .split("\n")
        .map((r) => r.trim())
        .filter((r) => r.length > 0),
    });
  }
  return { commits, ongeldig };
}

async function gewijzigdeBestanden(wortel: string, basis: string): Promise<readonly string[]> {
  const samengevoegd = await git(wortel, ["merge-base", basis, "HEAD"]);
  const punt = samengevoegd.length > 0 ? samengevoegd : basis;
  const uit = await git(wortel, ["diff", "--name-only", `${punt}..HEAD`]);
  const ongecommit = await git(wortel, ["status", "--porcelain"]);
  const uitDiff = uit.split("\n").filter((r) => r.trim().length > 0);
  const uitStatus = ongecommit
    .split("\n")
    .map((r) => r.slice(3).trim())
    .filter((r) => r.length > 0);
  return [...new Set([...uitDiff, ...uitStatus])].sort();
}

/**
 * Afbreken met een exitcode, zonder process.exit buiten het entrypoint.
 *
 * `process.exit` in een hulpfunctie maakt die hulpfunctie onbruikbaar in een
 * test: de test stopt dan zelf. Alleen `hoofd()` beeindigt het proces.
 */
export class AfbrekenFout extends Error {
  constructor(
    readonly code: number,
    boodschap: string,
  ) {
    super(boodschap);
    this.name = "AfbrekenFout";
  }
}

async function laadAlles(): Promise<{
  readonly wortel: string;
  readonly config: JarvisConfig;
  readonly lading: KennisLading;
}> {
  const wortel = await vindWortel(process.cwd());
  if (!wortel) {
    throw new AfbrekenFout(2, "jarvis: geen jarvis.config.yml gevonden vanaf de huidige map.");
  }
  const configResultaat = await laadConfig(wortel);
  if (!configResultaat.ok) {
    throw new AfbrekenFout(2, configResultaat.fouten.map((f) => `jarvis: ${f}`).join("\n"));
  }
  const config = configResultaat.config;
  if (!config.enabled) {
    throw new AfbrekenFout(
      3,
      "jarvis: uitgeschakeld via `enabled: false` in jarvis.config.yml. Geen enkele opdracht draait.",
    );
  }
  const lading = await laadKennis(wortel, config.knowledge_map);
  return { wortel, config, lading };
}

/**
 * Verzamelt de feiten over een governancebestand, met de hardening erbij.
 *
 * `lstat` op ELK paddeel, niet alleen op het bestand: een link halverwege het
 * pad verzet het doelwit net zo goed als een link op het bestand zelf.
 */
async function feitenOver(wortelEchtPad: string, relatiefPad: string): Promise<BestandsFeiten> {
  const delen = relatiefPad.split("/");
  let viaSymlink = false;
  for (let i = 0; i < delen.length; i += 1) {
    const deel = path.join(wortelEchtPad, ...delen.slice(0, i + 1));
    try {
      if ((await lstat(deel)).isSymbolicLink()) viaSymlink = true;
    } catch {
      // Bestaat niet; dat merkt de lezer hieronder.
    }
  }
  let echtPad: string | null = null;
  try {
    echtPad = await realpath(path.join(wortelEchtPad, relatiefPad));
  } catch {
    echtPad = null;
  }
  let bytes: Uint8Array | null = null;
  try {
    bytes = await readFile(path.join(wortelEchtPad, relatiefPad));
  } catch {
    bytes = null;
  }
  return { bytes, viaSymlink, echtPad };
}

/**
 * De governancecontrole, met echte schijftoegang.
 *
 * Draait als eerste stap van de poort. De paden komen uit `workflow.ts` en zijn
 * niet instelbaar: een controle die haar scope uit configuratie haalt,
 * controleert wat die configuratie zegt in plaats van wat er is.
 */
export async function controleerWorkflow(wortel: string): Promise<number> {
  let wortelEchtPad = wortel;
  try {
    wortelEchtPad = await realpath(wortel);
  } catch {
    wortelEchtPad = wortel;
  }
  const modus = bepaalModus(
    await leesOfNull(path.join(wortelEchtPad, "package.json")),
    await engineMapIsWortel(wortelEchtPad),
  );
  const canoniekPad = canoniekeWorkflowPad(modus);
  let workflowMapInhoud: readonly string[] | null = null;
  try {
    workflowMapInhoud = (await readdir(path.join(wortelEchtPad, WORKFLOW_MAP))).sort();
  } catch {
    workflowMapInhoud = null;
  }

  const testGroottes = new Map<string, number | null>();
  for (const testpad of VERPLICHTE_GOVERNANCE_TESTS) {
    try {
      testGroottes.set(testpad, (await stat(path.join(wortelEchtPad, testpad))).size);
    } catch {
      testGroottes.set(testpad, null);
    }
  }

  const redenen = controleerGovernance({
    wortelEchtPad,
    modus,
    actief: await feitenOver(wortelEchtPad, ACTIEVE_WORKFLOW),
    canoniek: await feitenOver(wortelEchtPad, canoniekPad),
    attestatie: {
      actief: await feitenOver(wortelEchtPad, ACTIEVE_ATTESTATIE),
      canoniek: await feitenOver(wortelEchtPad, canoniekeAttestatiePad(modus)),
    },
    workflowMapInhoud,
    testGroottes,
  });

  if (redenen.length === 0) {
    console.log(
      `jarvis workflow: ${ACTIEVE_WORKFLOW} is byte-identiek aan ${canoniekPad} op deze commit, ` +
        `en ${WORKFLOW_MAP} bevat geen onbekende workflows.`,
    );
    return 0;
  }
  for (const reden of redenen) console.error(`jarvis workflow: ${reden}`);
  console.error(
    `jarvis workflow: de canonieke bron is ${canoniekPad}. Wil je de poort wijzigen, wijzig dan die ` +
      `bron in de engine-repository en laat de wijziging door een mens beoordelen; CODEOWNERS eist dat.`,
  );
  return 1;
}

/** Lost `node_modules/jarvis-engine` op naar de repositorywortel zelf? (de `file:.`-koppeling) */
async function engineMapIsWortel(wortel: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([realpath(path.join(wortel, ENGINE_MAP)), realpath(wortel)]);
    return a === b;
  } catch {
    return false;
  }
}

async function leesOfNull(pad: string): Promise<string | null> {
  try {
    return await readFile(pad, "utf8");
  } catch {
    return null;
  }
}

/**
 * Vraagt GitHub hoe een commit zich verhoudt tot de hoofdbranch van de
 * engine-repository. Publieke API, geen token; bij een privé repository of
 * zonder netwerk is het antwoord null en oordeelt de poort streng.
 */
async function vergelijkMetHoofdbranch(slug: string, sha: string): Promise<HoofdbranchVergelijking> {
  try {
    const antwoord = await fetch(`https://api.github.com/repos/${slug}/compare/main...${sha}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "jarvis-poort" },
    });
    if (!antwoord.ok) return null;
    const lading = (await antwoord.json()) as { status?: unknown };
    const status = lading.status;
    return status === "identical" || status === "behind" || status === "ahead" || status === "diverged"
      ? status
      : null;
  } catch {
    return null;
  }
}

/**
 * De enginecontrole: is de engine die deze poort draait de vastgepinde, en
 * staat die pin op de hoofdbranch van de engine-repository? Zie engine.ts.
 */
export async function controleerEngine(wortel: string): Promise<number> {
  const configResultaat = await laadConfig(wortel);
  const verwachteSlug = configResultaat.ok ? configResultaat.config.engine_repository : "";
  const stand = leesEngineStand(
    await leesOfNull(path.join(wortel, "package.json")),
    await leesOfNull(path.join(wortel, "package-lock.json")),
    await leesOfNull(path.join(wortel, "node_modules", ".package-lock.json")),
    await engineMapIsWortel(wortel),
  );
  if (stand.modus === "engine") {
    console.log("jarvis engine: deze repository is de engine zelf; er is niets te pinnen.");
    return 0;
  }
  // De vergelijking loopt tegen de repository uit de configuratie, nooit
  // tegen wat de lockfile toevallig noemt.
  const vergelijking =
    stand.shaLock !== null && verwachteSlug.trim().length > 0
      ? await vergelijkMetHoofdbranch(verwachteSlug.trim(), stand.shaLock)
      : null;
  const redenen = beoordeelEngine(stand, vergelijking, verwachteSlug);
  if (redenen.length === 0) {
    console.log(
      `jarvis engine: ${stand.slug} op ${stand.shaLock?.slice(0, 7)}, geïnstalleerd en op de hoofdbranch.`,
    );
    return 0;
  }
  for (const reden of redenen) console.error(`jarvis engine: ${reden}`);
  return 1;
}

async function leesBestandOfLeeg(wortel: string, pad: string | undefined, wat: string): Promise<string> {
  if (!pad) return "";
  try {
    return await readFile(path.resolve(wortel, pad), "utf8");
  } catch {
    console.error(`jarvis: kon ${wat} ${pad} niet lezen.`);
    return "";
  }
}

/** `jarvis lint` — de poort met de waarden uit vlaggen. Voor lokaal gebruik. */
async function opdrachtLint(vlaggen: ReadonlyMap<string, string>): Promise<number> {
  const wortel = (await vindWortel(process.cwd())) ?? process.cwd();
  const tekstUitVlag = vlaggen.get("tekst") ?? "";
  const tekstUitBestand = await leesBestandOfLeeg(wortel, vlaggen.get("tekst-bestand"), "tekstbestand");
  return voerPoortUit({
    basis: vlaggen.get("basis") ?? "origin/main",
    tekst: `${tekstUitVlag}
${tekstUitBestand}`,
    ackTekst: await leesBestandOfLeeg(wortel, vlaggen.get("ack-bestand"), "ackbestand"),
    ackActor: vlaggen.get("ack-actor") ?? "",
    ackRelatie: vlaggen.get("ack-relatie") ?? "",
  });
}

/**
 * `jarvis poort` — de enige aanroep die CI doet.
 *
 * Alles komt uit de omgeving, er zijn geen argumenten, en er valt niets aan te
 * sturen. Daarvoor stond in de workflow een shellscript met zes variabelen en
 * een reeks vlaggen, en dat oppervlak bleek niet te bewaken: een onafhankelijke
 * QA schreef `--ack-relatie "${REVIEW_RELATIE:-OWNER}"` en `REVIEW_BODY="$PR_BODY"`
 * langs elke controle heen. Een lijst verboden schrijfwijzen verliest van een
 * taal; een vaste aanroep zonder argumenten heeft geen schrijfwijzen.
 *
 * De workflow is hiermee een adapter: hij zet zes GitHub-waarden in de omgeving
 * en roept dit aan. Wat de exitcode wordt, bepaalt deze functie.
 */
export type PoortStap = {
  readonly naam: string;
  readonly draai: () => Promise<number>;
};

/**
 * De stappen van de poort, in vaste volgorde, als lijst in plaats van als reeks
 * aanroepen.
 *
 * Dat is geen stijlkeuze. De workflowcontrole was ingebouwd als één regel in een
 * reeks `await`-aanroepen, en een onafhankelijke QA toonde aan dat het schrappen
 * van die regel de hele suite groen liet: de controle zelf was goed getest, dat
 * hij werd aangeroepen niet. Als lijst is de samenstelling zelf te toetsen.
 */
export function poortStappen(wortel: string, waarden: PoortInvoer): readonly PoortStap[] {
  return [
    // Eerst, en met opzet: als de poort zelf gewijzigd is, zegt de rest niets.
    { naam: "workflow", draai: () => controleerWorkflow(wortel) },
    // Dan: is de engine die dit draait de vastgepinde, door een mens
    // samengevoegde engine? Zo niet, dan zegt ook de rest niets.
    { naam: "engine", draai: () => controleerEngine(wortel) },
    // Direct daarna: een rolcontract waarvan de afgeleide drift, stuurt elke
    // agent in deze omgeving met een ander contract op pad dan de bron zegt.
    { naam: "rollen", draai: () => opdrachtRollen(new Map()) },
    { naam: "index", draai: () => opdrachtIndex(false) },
    { naam: "state", draai: () => opdrachtState(new Map([["controleer", "true"]])) },
    { naam: "sanitize", draai: () => opdrachtSanitize(new Map()) },
    { naam: "lint", draai: () => voerPoortUit(waarden) },
  ];
}

/**
 * Draait alle stappen en geeft de eerste fout terug.
 *
 * Alle stappen draaien, ook na een fout: een run die bij de eerste stopt
 * verbergt de rest, en dan kost elke reparatie een nieuwe run. Een fout wint
 * altijd van een succes.
 */
export async function poortUitkomst(stappen: readonly PoortStap[]): Promise<number> {
  let eersteFout = 0;
  for (const stap of stappen) {
    const code = await stap.draai();
    if (code !== 0 && eersteFout === 0) eersteFout = code;
  }
  return eersteFout;
}

/**
 * De volledige poort.
 *
 * `bouwStappen` bestaat alleen voor tests, en met een reden. Een eerdere poging
 * gaf deze functie een wortelparameter mee; die bereikte alleen de workflowstap,
 * terwijl index, state, sanitize en lint via `process.cwd()` tegen de echte
 * repository bleven draaien. De test die daarop leunde was groen om de verkeerde
 * reden: hij slaagde ook met de workflowcontrole hardgezet op nul, omdat de
 * lintstap in deze repository sowieso faalt.
 *
 * Met een injecteerbare stappenbouwer is wél te toetsen wat deze functie doet:
 * de stappen draaien en hun uitkomst teruggeven. Dat de echte lijst met de
 * workflowcontrole begint, wordt apart op `poortStappen` getoetst.
 */
export async function opdrachtPoort(bouwStappen: typeof poortStappen = poortStappen): Promise<number> {
  const lees = (naam: string) => process.env[naam] ?? "";
  const wortel = (await vindWortel(process.cwd())) ?? process.cwd();
  return poortUitkomst(
    bouwStappen(wortel, {
      basis: `origin/${lees("PR_BASIS") || "main"}`,
      tekst: `${lees("PR_TITEL")}

${lees("PR_BODY")}`,
      ackTekst: lees("REVIEW_BODY"),
      ackActor: lees("REVIEW_ACTOR"),
      ackRelatie: lees("REVIEW_RELATIE"),
    }),
  );
}

/**
 * De allowlist van schijf, of een lege lijst als die er niet is.
 *
 * Gedeeld door sanitize en overzicht: allebei laten ze tekst de repository
 * verlaten, en allebei horen ze dezelfde uitzonderingen te kennen. Een
 * onleesbare allowlist is een fout, geen stille terugval - een lege lijst is
 * strenger, maar een lijst met een tikfout hoort niet ongemerkt te blijven.
 */
async function laadAllowlistVanSchijf(wortel: string): Promise<Allowlist> {
  const pad = path.join(wortel, "jarvis", ALLOWLIST_BESTANDSNAAM);
  let ruw: string;
  try {
    ruw = await readFile(pad, "utf8");
  } catch {
    return LEGE_ALLOWLIST;
  }
  const geladen = laadAllowlist(ruw);
  if (!geladen.ok) throw new AfbrekenFout(1, geladen.fouten.map((f) => `jarvis: allowlist: ${f}`).join("\n"));
  return geladen.allowlist;
}

// ---------------------------------------------------------------------------
// jarvis overzicht
// ---------------------------------------------------------------------------

/** `git log` van de laatste twee weken, uit elkaar gehaald per commit. */
async function leesGitLog(wortel: string, paden: readonly string[] = []): Promise<readonly GitRegel[]> {
  // Recordscheider \x1e tussen commits, veldscheider \x1f binnen een commit.
  // Een commitbericht kan elke gewone tekst bevatten; deze twee tekens niet.
  // Met paden: alleen commits die een van die paden raken.
  const ruw = await git(wortel, [
    "log",
    `--since=${RECENT_DAGEN}.days`,
    "--date=iso-strict",
    "--format=%h%x1f%cI%x1f%s%x1f%b%x1e",
    ...(paden.length > 0 ? ["--", ...paden] : []),
  ]);
  return ruw
    .split("\x1e")
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((r) => {
      const [hash = "", datum = "", onderwerp = "", body = ""] = r.split("\x1f");
      return { hash, datum, onderwerp, body };
    });
}

async function leesHoofdbranch(wortel: string): Promise<ProjectOverzicht["hoofdbranch"]> {
  const naam = "main";
  const commit = await git(wortel, ["rev-parse", "--short", `origin/${naam}`]);
  if (!commit) return null;
  const datum = await git(wortel, ["log", "-1", "--format=%cs", `origin/${naam}`]);
  return { naam, commit, datum };
}

/** Front-matter van een taakdossier als platte sleutel-waarde-paren. */
async function leesTaakDossiers(wortel: string, takenMap: string): Promise<readonly TaakDossier[]> {
  let mappen: string[] = [];
  try {
    mappen = (await readdir(path.join(wortel, takenMap), { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
  const dossiers: TaakDossier[] = [];
  for (const id of mappen) {
    // Geen opdracht.md, geen taak: een map met alleen een QA-proef of een
    // losse notitie hoort niet in het overzicht, en verdient ook geen melding.
    let opdracht: string;
    try {
      opdracht = await readFile(path.join(wortel, takenMap, id, "opdracht.md"), "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontMatter(opdracht.replace(/\r\n/g, "\n"));
    const platte: Record<string, string> = {};
    if (fm.ok) {
      for (const [k, v] of Object.entries(fm.data)) if (typeof v === "string") platte[k] = v;
    }
    let resultaat: string | null = null;
    try {
      resultaat = await readFile(path.join(wortel, takenMap, id, "resultaat.md"), "utf8");
    } catch {
      resultaat = null;
    }
    dossiers.push({ id, opdracht: platte, tekst: opdracht, resultaat });
  }
  return dossiers;
}

/**
 * De naam waaronder een project in het overzicht verschijnt: de titel van de
 * README, zonder een eventuele toelichting achter een gedachtestreepje. Valt
 * terug op de technische naam wanneer er geen README is.
 */
async function leesWeergavenaam(wortel: string, terugval: string): Promise<string> {
  const readme = await leesBestandOfLeeg(wortel, "README.md", "README");
  const kop = /^#\s+(.+)$/m.exec(readme.replace(/\r\n/g, "\n"))?.[1]?.trim();
  if (!kop) return terugval;
  return kop.split(/\s+[—–-]\s+/)[0].trim() || terugval;
}

/**
 * Een repository die niet op Jarvis is aangesloten. Jarvis ziet dan alleen de
 * git-historie en een naam. Dat is bewust mager: het overzicht mag niets
 * suggereren wat er niet is.
 */
async function leesExternProject(pad: string): Promise<ProjectInvoer> {
  const wortel = path.resolve(pad);
  const mapnaam = path.basename(wortel);
  // Draagt de repository een eigen jarvis.config.yml, dan is ze aangesloten:
  // dan lezen we haar zoals de eigen repository, met haar eigen statusdocument,
  // records en taakdossiers. Een onleesbare of uitgeschakelde configuratie
  // telt als niet aangesloten; het overzicht suggereert dan niets.
  const configResultaat = await laadConfig(wortel);
  if (configResultaat.ok && configResultaat.config.enabled) {
    const config = configResultaat.config;
    const lading = await laadKennis(wortel, config.knowledge_map);
    return {
      id: config.project.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      naam: await leesWeergavenaam(wortel, config.project),
      aangesloten: true,
      hoofdbranch: await leesHoofdbranch(wortel),
      statusDocument: (await leesBestandOfLeeg(wortel, config.current_state, "statusdocument")) || null,
      records: lading.records,
      taken: await leesTaakDossiers(wortel, config.taken_map),
      gitLog: await leesGitLog(wortel),
    };
  }
  const naam = await leesWeergavenaam(wortel, mapnaam);
  return {
    id: mapnaam.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    naam,
    aangesloten: false,
    hoofdbranch: await leesHoofdbranch(wortel),
    statusDocument: null,
    records: [],
    taken: [],
    gitLog: await leesGitLog(wortel),
  };
}

/**
 * `jarvis rollen [--schrijf]`
 *
 * Genereert de providerafgeleiden van de rolcontracten, of controleert zonder
 * `--schrijf` dat wat op schijf staat exact is wat de bron oplevert. Een
 * afgeleide die met de hand is bijgewerkt drift; dat was bij de eerste QA van
 * v1 al zo, en de poort ziet het nu.
 */
async function opdrachtRollen(vlaggen: ReadonlyMap<string, string>): Promise<number> {
  const { wortel, config } = await laadAlles();
  const schrijf = vlaggen.has("schrijf");
  const rollenMap = config.rollen_map;
  let namen: string[] = [];
  try {
    namen = (await readdir(path.join(wortel, rollenMap))).filter((n) => /\.md$/i.test(n)).sort();
  } catch {
    console.error(`jarvis rollen: rollenmap ${rollenMap} niet gevonden.`);
    return 1;
  }
  const contracten: Rolcontract[] = [];
  for (const naam of namen) {
    const gelezen = leesRolcontract(naam, await readFile(path.join(wortel, rollenMap, naam), "utf8"));
    if (!gelezen.ok) {
      console.error(`jarvis rollen: ${gelezen.fout}`);
      return 1;
    }
    contracten.push(gelezen.contract);
  }
  const afgeleidenConfig = {
    map: config.rol_afgeleiden_map,
    voorvoegsel: config.rol_afgeleiden_voorvoegsel,
    overzicht: config.rol_overzicht,
    manifest: config.rol_manifest,
    gereedschap: config.rol_gereedschap,
  };
  const bestaandOverzicht = config.rol_overzicht ? (await leesBestandOfLeeg(wortel, config.rol_overzicht, "instapdocument")) || null : null;
  const afgeleiden = genereerAfgeleiden(contracten, afgeleidenConfig, rollenMap, bestaandOverzicht);
  if (afgeleiden.length === 0) {
    console.log(`jarvis rollen: ${contracten.length} contract(en), geen afgeleiden geconfigureerd.`);
    return 0;
  }
  if (schrijf) {
    for (const a of afgeleiden) {
      await mkdir(path.dirname(path.join(wortel, a.pad)), { recursive: true });
      await writeFile(path.join(wortel, a.pad), a.inhoud, "utf8");
    }
    console.log(`jarvis rollen: ${afgeleiden.length} afgeleide(n) geschreven uit ${contracten.length} contract(en).`);
    return 0;
  }
  const opSchijf = new Map<string, string | null>();
  for (const a of afgeleiden) {
    try {
      opSchijf.set(a.pad, await readFile(path.join(wortel, a.pad), "utf8"));
    } catch {
      opSchijf.set(a.pad, null);
    }
  }
  const drift = vindDrift(afgeleiden, opSchijf);
  if (drift.length === 0) {
    console.log(`jarvis rollen: ${afgeleiden.length} afgeleide(n) gelijk aan de bron (${contracten.length} contracten).`);
    return 0;
  }
  for (const d of drift) console.error(`jarvis rollen: ${d.pad} ${d.reden}.`);
  console.error("jarvis rollen: afgeleiden wijken af van de rolcontracten. Draai `jarvis rollen --schrijf`; wijzig nooit een afgeleide met de hand.");
  return 1;
}

/**
 * `jarvis overzicht [--extern <pad,pad>] [--uit <bestand>]`
 *
 * Bouwt het overzicht dat de interface toont: deze repository als aangesloten
 * project, plus eventuele andere repositories als niet-aangesloten. De uitvoer
 * gaat door de sanitizer voordat hij ergens terechtkomt. Dit is persistente
 * Jarvis-data die de repository verlaat, en daar geldt CON-0008 dubbel.
 */
/** Het overzicht zoals `jarvis overzicht` het bouwt, voor hergebruik door `jarvis regie`. */
async function bouwOverzichtVanuit(vlaggen: ReadonlyMap<string, string>): Promise<{ wortel: string; overzicht: Overzicht }> {
  const { wortel, config, lading } = await laadAlles();
  const nu = new Date();

  const kernId = config.overzicht_kern_id || null;
  const tagProjecten = kernId && config.overzicht_kern_tag ? { [config.overzicht_kern_tag]: kernId } : undefined;
  const eigen: ProjectInvoer = {
    id: config.project.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    naam: await leesWeergavenaam(wortel, config.project),
    aangesloten: true,
    hoofdbranch: await leesHoofdbranch(wortel),
    statusDocument: (await leesBestandOfLeeg(wortel, config.current_state, "statusdocument")) || null,
    records: lading.records,
    taken: await leesTaakDossiers(wortel, config.taken_map),
    gitLog: await leesGitLog(wortel),
    tagProjecten,
  };

  // Jarvis zelf als project: geen eigen statusdocument of records (die staan
  // in de repository die hem draagt en verhuizen via tag en `project:`), wel
  // eigen beweging uit de kernpaden.
  const kern: ProjectInvoer[] = kernId
    ? [
        {
          id: kernId,
          naam: config.overzicht_kern_naam || kernId,
          aangesloten: true,
          hoofdbranch: eigen.hoofdbranch,
          statusDocument: null,
          records: [],
          taken: [],
          gitLog: await leesGitLog(wortel, config.overzicht_kern_paden),
        },
      ]
    : [];

  const externen: ProjectInvoer[] = [];
  const externPaden = (vlaggen.get("extern") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  for (const pad of externPaden) {
    const extern = await leesExternProject(pad);
    // Loopt er in deze repository al een taak over dat project (front-matter
    // `project:`), dan is "aansluiten" geen open vraag meer maar werk in uitvoering.
    const loopt = eigen.taken.some((t) => t.opdracht["project"] === extern.id && t.opdracht["status"] !== "afgerond");
    externen.push({ ...extern, aansluitingLoopt: loopt });
  }

  return { wortel, overzicht: bouwOverzicht([...kern, eigen, ...externen], nu, kernId) };
}

async function opdrachtOverzicht(vlaggen: ReadonlyMap<string, string>): Promise<number> {
  const { wortel, overzicht } = await bouwOverzichtVanuit(vlaggen);
  const json = `${JSON.stringify(overzicht, null, 2)}\n`;

  // De poort voor alles wat de repository verlaat. Geen uitzonderingen: een
  // overzicht met een tenant-UUID of een adres erin is erger dan geen overzicht.
  const allowlist = await laadAllowlistVanSchijf(wortel);
  const bevindingen = scanTekst(json, allowlist, "overzicht.json");
  if (bevindingen.length > 0) {
    console.error(`jarvis overzicht: ${bevindingen.length} bevinding(en) in de uitvoer; niets geschreven.`);
    for (const b of bevindingen) console.error(`  ${b.severity.toUpperCase()} regel ${b.regel} [${b.patroon}] ${b.fragment}`);
    return 1;
  }

  const uit = vlaggen.get("uit");
  if (uit) {
    await mkdir(path.dirname(path.resolve(wortel, uit)), { recursive: true });
    await writeFile(path.resolve(wortel, uit), json, "utf8");
    const n = overzicht.voor_jou.length;
    console.log(
      `jarvis overzicht: ${overzicht.projecten.length} project(en), ${n} item(s) voor de eigenaar, geschreven naar ${uit}`,
    );
    return 0;
  }
  process.stdout.write(json);
  return 0;
}

/** knowledge/INDEX.json — zodat een agent kan selecteren zonder de CLI te draaien. */
async function opdrachtIndex(schrijf: boolean): Promise<number> {
  const { wortel, config, lading } = await laadAlles();
  const index = {
    gegenereerdDoor: "jarvis index",
    project: config.project,
    aantal: lading.records.length,
    records: lading.records.map((r) => ({
      id: r.id,
      type: r.type,
      titel: r.titel,
      datum: r.datum,
      tags: [...r.tags],
      bestand: lading.herkomst.get(r.id) ?? null,
      bronnen: [...r.bronnen],
    })),
  };
  const doel = path.join(wortel, config.knowledge_map, "INDEX.json");
  const inhoud = `${JSON.stringify(index, null, 2)}\n`;

  if (schrijf) {
    await mkdir(path.dirname(doel), { recursive: true });
    await writeFile(doel, inhoud, "utf8");
    console.log(`jarvis index: ${lading.records.length} records geschreven naar ${config.knowledge_map}/INDEX.json`);
    return 0;
  }

  let bestaand = "";
  try {
    bestaand = await readFile(doel, "utf8");
  } catch {
    bestaand = "";
  }
  if (bestaand !== inhoud) {
    console.error("jarvis index: INDEX.json loopt achter op de kennisbasis. Draai `jarvis index --schrijf`.");
    return 1;
  }
  console.log(`jarvis index: actueel (${lading.records.length} records).`);
  return 0;
}

type PoortInvoer = {
  readonly basis: string;
  readonly tekst: string;
  readonly ackTekst: string;
  readonly ackActor: string;
  readonly ackRelatie: string;
};

/**
 * De deterministische poort, met de waarden al opgelost.
 *
 * Zowel `jarvis lint` (waarden uit vlaggen) als `jarvis poort` (waarden uit de
 * omgeving) komen hier uit. De bron verschilt; wat ermee gebeurt niet.
 */
async function voerPoortUit(invoer: PoortInvoer): Promise<number> {
  const { wortel, config, lading } = await laadAlles();
  const { basis, tekst, ackTekst, ackActor, ackRelatie } = invoer;
  const bestanden = await gewijzigdeBestanden(wortel, basis);


  // Acks komen UITSLUITEND uit een aparte bron, nooit uit `tekst`.
  //
  // `tekst` is de PR-titel en -body, en die schrijft de agent die de PR opent.
  // Een ack die daaruit gelezen wordt, is een agent die zichzelf toestemming
  // geeft. Het ack-kanaal is daarom structureel gescheiden: een review op de
  // pull request, met de auteur en diens relatie tot de repository erbij.
  const acks = parseerAcks(ackTekst);
  const ackBronVertrouwd = ackBronIsVertrouwd(ackActor, ackRelatie);
  const ackBron = ackActor
    ? `een review van ${ackActor} (${ackRelatie || "relatie onbekend"})`
    : "een bron zonder aanwijsbare menselijke auteur";
  const statusImpact = /Current-State-Impact:\s*(none|geen)/i.test(tekst);
  // Mapnamen komen uit de configuratie en de indeling eronder is vrij; tel dus
  // op de bestandsnaam, niet op een vast pad.
  const decPatroon = new RegExp(`^${config.knowledge_map}/.*DEC-\\d{4}\\.md$`);
  const nieuweDecs = bestanden.filter((b) => decPatroon.test(b.replace(/\\/g, "/"))).length;

  const statusCommits = await git(wortel, [
    "rev-list",
    "--count",
    `${basis}..HEAD`,
    "--",
    ...config.status_paden,
  ]);

  // Commits met hun rol-trailer en gewijzigde bestanden, zodat de poort kan
  // toetsen of elke rol binnen zijn mandaat schreef. Eén git-aanroep voor de
  // hele branch; de leeslimiet is een vangnet tegen een ontspoorde vergelijking
  // (verkeerde basis, honderden commits), geen prestatiegrens. Wat erbuiten
  // valt wordt geteld en gemeld: stil afkappen ziet eruit als een volledige
  // toets.
  const COMMIT_LEESLIMIET = 500;
  const log = leesCommitLog(await git(wortel, ["log", COMMIT_LOG_FORMAAT, "--name-only", `${basis}..HEAD`]));
  const alleCommits = log.commits;
  const gelezen = alleCommits.slice(0, COMMIT_LEESLIMIET);
  // De lijst uit `rev-list` is de maat: elke commit die daar staat moet ook
  // leesbaar uit de log zijn gekomen, in dezelfde volgorde. Elk verschil is
  // een commit die de rolcontrole zou missen.
  const verwacht = (await git(wortel, ["rev-list", `${basis}..HEAD`]))
    .split("\n")
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  const gelezenHashes = alleCommits.map((c) => c.hash);
  const commitlogOnleesbaar =
    log.ongeldig > 0 ||
    verwacht.length !== gelezenHashes.length ||
    verwacht.some((h, i) => h !== gelezenHashes[i]);
  // Commits van vóór het startpunt vallen buiten de rolcontrole. Zie
  // `rol_controle_vanaf` in jarvis.config.yml voor waarom dat startpunt bestaat.
  const voorStartpunt = config.rol_controle_vanaf
    ? new Set(
        (await git(wortel, ["rev-list", `${basis}..${config.rol_controle_vanaf}`]))
          .split("\n")
          .map((h) => h.trim())
          .filter((h) => h.length > 0),
      )
    : new Set<string>();
  // De waarde van het startpunt zoals hij op de basisbranch staat. Verschilt
  // hij van de huidige, dan verschuift iemand de vrijstelling; dat hoort de
  // poort te zien.
  const basisConfigTekst = await git(wortel, ["show", `${basis}:jarvis.config.yml`]);
  // Geen leesbare basisconfiguratie telt als "daar stond geen vrijstelling".
  // Dat is bewust de strenge kant: op de branch die `rol_controle_vanaf` voor
  // het eerst invoert is er niets om mee te vergelijken, en juist dan wordt de
  // vrijstelling in het leven geroepen. Terugvallen op de huidige waarde zou de
  // controle precies op dat moment laten zwijgen.
  const basisStartpunt = leesStartpuntUitConfig(basisConfigTekst) ?? "";

  const commits = gelezen.map((c) => ({
    hash: c.hash.slice(0, 7),
    onderwerp: c.onderwerp,
    rol: /^Jarvis-Role:\s*(\S+)\s*$/im.exec(c.bericht)?.[1] ?? null,
    taak: /^Jarvis-Task:\s*(\S+)\s*$/im.exec(c.bericht)?.[1] ?? null,
    bestanden: c.bestanden,
    voorStartpunt: voorStartpunt.has(c.hash),
  }));

  const eigenaarsPunten = await leesEigenaarsPunten(wortel, config, bestanden);

  const resultaat = lint({
    config,
    lading,
    gewijzigdeBestanden: bestanden,
    tekstCorpus: tekst,
    acks,
    commits,
    eigenaarsPunten,
    statusCommitsSinds: Number.parseInt(statusCommits || "0", 10) || 0,
    statusImpactVerklaard: statusImpact,
    nieuweDecs,
    rolControleVanafBasis: basisStartpunt,
    commitsAfgekapt: alleCommits.length - gelezen.length,
    commitlogOnleesbaar,
    ackBronVertrouwd,
    ackBron,
  });

  console.log(formatteerLint(resultaat));
  return resultaat.ok ? 0 : 1;
}

async function opdrachtContext(vlaggen: ReadonlyMap<string, string>): Promise<number> {
  const { wortel, config, lading } = await laadAlles();
  const taak = vlaggen.get("taak");
  if (!taak || taak === "true") {
    console.error('jarvis context: --taak "<omschrijving>" is verplicht.');
    return 2;
  }
  const klasseRuw = (vlaggen.get("klasse") ?? "M").toUpperCase();
  if (klasseRuw !== "S" && klasseRuw !== "M" && klasseRuw !== "L") {
    console.error("jarvis context: --klasse moet S, M of L zijn.");
    return 2;
  }
  const bestanden = (vlaggen.get("bestanden") ?? "")
    .split(",")
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const pakket = await bouwContextPakket({
    taak,
    klasse: klasseRuw as TaakKlasse,
    config,
    records: lading.records,
    bestanden,
    readSource: createFileReader(wortel),
    gegenereerdOp: vlaggen.get("op") ?? new Date().toISOString(),
  });

  const uitMap = vlaggen.get("uit");
  const markdown = rendereerPakket(pakket);
  if (uitMap && uitMap !== "true") {
    const doel = path.resolve(wortel, uitMap);
    await mkdir(doel, { recursive: true });
    await writeFile(path.join(doel, "context-pack.md"), markdown, "utf8");
    await writeFile(path.join(doel, "context-pack.json"), `${JSON.stringify(pakket, null, 2)}\n`, "utf8");
    console.log(`jarvis context: pakket geschreven naar ${uitMap} (${pakket.gebruikt}/${pakket.budget} tokens).`);
    return 0;
  }
  console.log(markdown);
  return 0;
}

/**
 * De punten onder "Wat de eigenaar nog moet doen" van elk taakdossier dat deze
 * wijziging raakt (resultaat.md in de takenmap), voor de poortregel
 * eigenaarslijst_administratief (CON-0016).
 */
async function leesEigenaarsPunten(
  wortel: string,
  config: JarvisConfig,
  bestanden: readonly string[],
): Promise<readonly { bestand: string; tekst: string }[]> {
  const takenMap = normaliseerPadTekst(config.taken_map).replace(/\/+$/, "");
  const uit: { bestand: string; tekst: string }[] = [];
  for (const b of bestanden) {
    const pad = normaliseerPadTekst(b);
    if (!pad.startsWith(`${takenMap}/`) || !/\/resultaat\.md$/.test(pad)) continue;
    let inhoud: string;
    try {
      inhoud = await readFile(path.join(wortel, pad), "utf8");
    } catch {
      continue; // verwijderd in deze wijziging
    }
    for (const item of leesItemsOnder(inhoud, KOP_EIGENAAR_LIJST)) uit.push({ bestand: pad, tekst: item.toelichting });
  }
  return uit;
}
const KOP_EIGENAAR_LIJST = /^## Wat de eigenaar nog moet doen\s*$/m;
function normaliseerPadTekst(p: string): string {
  return p.replace(/\\/g, "/");
}

async function verzamelFeiten(
  wortel: string,
  config: JarvisConfig,
  lading: KennisLading,
): Promise<StateFeiten> {
  const hoofdbranch = "main";
  // De hoofdbranch zoals dit werk hem kent: het gemeenschappelijke punt van
  // HEAD en origin/main. Op main zelf is dat de kop; op een branch blijft het
  // stabiel zolang de branch niet wordt herbaseerd. Met de kop van origin/main
  // werd het feitenblok van elke open pull request rood zodra een andere was
  // samengevoegd (gemeten 2026-09-14 na engine #12), wat een keten van merges
  // onmogelijk maakte zonder een verversingscommit per PR per merge.
  const basis = (await git(wortel, ["merge-base", "HEAD", `origin/${hoofdbranch}`])) || `origin/${hoofdbranch}`;
  const commit = await git(wortel, ["rev-parse", "--short", basis]);
  const datum = await git(wortel, ["log", "-1", "--format=%ad", "--date=short", basis]);
  const migraties = config.migratie_pad ? await git(wortel, ["ls-files", config.migratie_pad]) : "";
  const hoogste =
    migraties
      .split("\n")
      .map((m) => path.basename(m))
      .filter((m) => /^\d/.test(m))
      .sort()
      .pop() ?? null;
  const testbestanden = await git(wortel, ["ls-files", "tests"]);
  const branches = await git(wortel, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"]);

  const tellingen: Partial<Record<RecordType, number>> = {};
  for (const type of RECORD_TYPES) {
    tellingen[type] = lading.records.filter((r) => r.type === type).length;
  }

  return {
    gegenereerdOp: new Date().toISOString().slice(0, 10),
    hoofdbranch,
    hoofdbranchCommit: commit || "onbekend",
    hoofdbranchDatum: datum || "onbekend",
    hoogsteMigratie: hoogste,
    aantalTestbestanden: testbestanden.split("\n").filter((t) => t.endsWith(".test.ts")).length || null,
    recordTellingen: tellingen,
    openConflicten: lading.records
      .filter((r) => r.type === "CFL" && r.status === "open")
      .map((r) => r.id)
      .sort(),
    openTaken: [],
    actieveBranches: branches
      .split("\n")
      .map((b) => b.replace(/^origin\//, ""))
      .filter((b) => b.length > 0 && b !== "HEAD" && b !== "main")
      .sort()
      .slice(0, 12),
  };
}

async function opdrachtState(vlaggen: ReadonlyMap<string, string>): Promise<number> {
  const { wortel, config, lading } = await laadAlles();
  const feiten = await verzamelFeiten(wortel, config, lading);
  const blok = genereerFeitenblok(feiten);
  const doel = path.resolve(wortel, config.current_state);

  let bestaand: string | null = null;
  try {
    bestaand = await readFile(doel, "utf8");
  } catch {
    bestaand = null;
  }

  const controleren = vlaggen.has("controleer");
  if (bestaand === null) {
    if (controleren) {
      console.error(`jarvis state: ${config.current_state} bestaat niet. Draai \`jarvis state --schrijf\`.`);
      return 1;
    }
    await mkdir(path.dirname(doel), { recursive: true });
    await writeFile(doel, nieuwStateDocument(config.project, blok), "utf8");
    console.log(`jarvis state: ${config.current_state} aangemaakt.`);
    return 0;
  }

  if (controleren) {
    const huidig = leesFeitenblok(bestaand);
    if (huidig === null) {
      console.error(`jarvis state: feitenblok ontbreekt in ${config.current_state}.`);
      return 1;
    }
    if (!blokIsActueel(huidig, blok)) {
      console.error(
        `jarvis state: het feitenblok in ${config.current_state} komt niet overeen met de repository. ` +
          "Draai `jarvis state --schrijf`.",
      );
      return 1;
    }
    console.log("jarvis state: feitenblok is actueel.");
    return 0;
  }

  const vervangen = vervangFeitenblok(bestaand, blok);
  if (!vervangen.ok) {
    console.error(`jarvis state: ${vervangen.boodschap}`);
    return 1;
  }
  await writeFile(doel, vervangen.tekst, "utf8");
  console.log(
    vervangen.gewijzigd
      ? `jarvis state: feitenblok bijgewerkt in ${config.current_state}.`
      : "jarvis state: feitenblok was al actueel.",
  );
  return 0;
}

async function opdrachtAudit(losse: readonly string[], vlaggen: ReadonlyMap<string, string>): Promise<number> {
  const { wortel, config, lading } = await laadAlles();
  const { bouwAuditRapport, rendereerAudit, leesTrailers, DOSSIER_BESTANDEN } = await import("./audit");

  const taakId = losse[0];
  if (!taakId) {
    console.error("jarvis audit: geef een taak-id, bijvoorbeeld T-20260910-iets.");
    return 2;
  }

  const dossierMap = path.join(wortel, config.taken_map, taakId);
  const dossier = new Map<string, string>();
  for (const { bestand } of DOSSIER_BESTANDEN) {
    try {
      dossier.set(bestand, await readFile(path.join(dossierMap, bestand), "utf8"));
    } catch {
      // Ontbrekend bestand is een bevinding in het rapport, geen fout hier.
    }
  }
  let manifestJson: string | null = null;
  try {
    manifestJson = await readFile(path.join(dossierMap, "context-pack.json"), "utf8");
  } catch {
    manifestJson = null;
  }

  // Commits worden gevonden op de trailer, niet op de branchnaam: een taak kan
  // over meerdere branches lopen en een branch kan meerdere taken bevatten.
  const VELD = String.fromCharCode(31);
  const RECORD = String.fromCharCode(30);
  const ruweLog = await git(wortel, [
    "log",
    "--all",
    `--grep=Jarvis-Task:\\s*${taakId}`,
    "--extended-regexp",
    `--format=%h${VELD}%an${VELD}%ad${VELD}%s${VELD}%B${RECORD}`,
    "--date=short",
  ]);
  const commits = ruweLog
    .split(RECORD)
    .map((blok) => blok.trim())
    .filter((blok) => blok.length > 0)
    .map((blok) => {
      const [hash = "", auteur = "", datum = "", onderwerp = "", bericht = ""] = blok.split(VELD);
      const { taak, rol } = leesTrailers(bericht);
      return { hash, auteur, datum, onderwerp, taak, rol };
    });

  const basis = vlaggen.get("basis") ?? "origin/main";
  const diffStat = commits.length > 0 ? await git(wortel, ["diff", "--stat", `${basis}...HEAD`]) : null;

  const rapport = await bouwAuditRapport({
    taakId,
    dossier,
    manifestJson,
    commits,
    diffStat: diffStat && diffStat.length > 0 ? diffStat : null,
    records: lading.records,
    readSource: createFileReader(wortel),
  });

  console.log(rendereerAudit(rapport));
  // Ook "Reconstructie volledig: nee" is een rode uitkomst. Dat afdrukken en
  // dan exitcode 0 teruggeven maakt de opdracht onbruikbaar in CI: het rapport
  // zegt dan dat de taak niet te reconstrueren is terwijl de stap groen kleurt.
  const rood = rapport.bevindingen.some((b) => b.severity === "fout") || !rapport.volledig;
  return rood ? 1 : 0;
}

/** Klapt `sanitize_paden` (mappen of bestanden) uit tot concrete tekstbestanden. */
async function verzamelTekstbestanden(wortel: string, ingang: string): Promise<readonly string[]> {
  const { stat, readdir } = await import("node:fs/promises");
  const absoluut = path.resolve(wortel, ingang);
  let info;
  try {
    info = await stat(absoluut);
  } catch {
    return [];
  }
  // html: de interfacepagina onder jarvis/interface is persistente Jarvis-data
  // die de repository verlaat, en valt dus onder dezelfde scan.
  const isTekst = (naam: string) => /\.(md|json|ya?ml|txt|html)$/i.test(naam);
  if (info.isFile()) return isTekst(absoluut) ? [ingang] : [];

  const gevonden: string[] = [];
  const items = await readdir(absoluut, { withFileTypes: true });
  for (const item of items.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const kind = `${ingang}/${item.name}`;
    if (item.isDirectory()) gevonden.push(...(await verzamelTekstbestanden(wortel, kind)));
    else if (item.isFile() && isTekst(item.name)) gevonden.push(kind);
  }
  return gevonden;
}

async function opdrachtSanitize(vlaggen: ReadonlyMap<string, string>): Promise<number> {
  const { wortel, config } = await laadAlles();
  const { laadAllowlist, sanitizeBestanden, ALLOWLIST_BESTANDSNAAM, LEGE_ALLOWLIST } = await import("./sanitize");

  let allowlist = LEGE_ALLOWLIST;
  const allowlistPad = path.join(wortel, "jarvis", ALLOWLIST_BESTANDSNAAM);
  try {
    const ruw = await readFile(allowlistPad, "utf8");
    const geladen = laadAllowlist(ruw);
    if (!geladen.ok) {
      for (const fout of geladen.fouten) console.error(`jarvis sanitize: allowlist: ${fout}`);
      return 1;
    }
    allowlist = geladen.allowlist;
  } catch {
    console.error(`jarvis sanitize: geen allowlist gevonden op jarvis/${ALLOWLIST_BESTANDSNAAM}; verder met lege lijst.`);
  }

  const paden: string[] = [];
  for (const ingang of config.sanitize_paden) {
    paden.push(...(await verzamelTekstbestanden(wortel, ingang)));
  }
  if (paden.length === 0) {
    console.log("jarvis sanitize: geen bestanden binnen sanitize_paden.");
    return 0;
  }

  // Zonder --schrijf wordt er niets aangepast: de poort mag in CI draaien
  // zonder de werkboom te muteren.
  const schrijven = vlaggen.has("schrijf");
  const resultaat = await sanitizeBestanden(
    paden,
    async (pad) => {
      try {
        return await readFile(path.resolve(wortel, pad), "utf8");
      } catch {
        return null;
      }
    },
    async (pad, inhoud) => {
      if (!schrijven) return;
      await writeFile(path.resolve(wortel, pad), inhoud, "utf8");
    },
    allowlist,
  );

  if (schrijven && resultaat.gewijzigd.length > 0) {
    console.log(`jarvis sanitize: ${resultaat.gewijzigd.length} bestand(en) geredigeerd:`);
    for (const pad of resultaat.gewijzigd) console.log(`  - ${pad}`);
  }
  if (resultaat.bevindingen.length === 0) {
    console.log(`jarvis sanitize: ${paden.length} bestand(en) gescand, niets gevonden.`);
    return 0;
  }
  console.error(`jarvis sanitize: ${resultaat.bevindingen.length} bevinding(en) na de onafhankelijke rescan:`);
  for (const b of resultaat.bevindingen) {
    console.error(`  ${b.severity.toUpperCase()} ${b.bestand}:${b.regel} [${b.patroon}] ${b.fragment}`);
  }
  return resultaat.ok ? 0 : 1;
}

async function opdrachtPlan(losse: readonly string[]): Promise<number> {
  const wortel = (await vindWortel(process.cwd())) ?? process.cwd();
  const bron = losse[0];
  if (!bron) {
    console.error("jarvis plan: geef het pad naar een markdownbestand met een plantabel.");
    return 2;
  }
  let markdown: string;
  try {
    markdown = await readFile(path.resolve(wortel, bron), "utf8");
  } catch {
    console.error(`jarvis plan: kon ${bron} niet lezen.`);
    return 2;
  }
  const { taken, fouten } = parseerPlanTabel(markdown);
  if (fouten.length > 0) {
    for (const f of fouten) console.error(`jarvis plan: ${f.onderwerp}: ${f.boodschap}`);
    if (taken.length === 0) return 1;
  }
  const analyse = analyseerPlan(taken);
  console.log(rendereerPlan(taken, analyse));
  return analyse.ok ? 0 : 1;
}

function help(): number {
  console.log(
    [
      "jarvis — provider-onafhankelijke projectkennis en contextassemblage",
      "",
      "Gebruik: npx jarvis <opdracht> [opties]",
      "",
      "  index    [--schrijf]              Bouwt knowledge/INDEX.json; zonder --schrijf alleen controle",
      "  poort    De volledige poort, zoals CI hem draait. Geen argumenten:",
      "           alles komt uit de omgeving (PR_BASIS, PR_TITEL, PR_BODY,",
      "           REVIEW_BODY, REVIEW_ACTOR, REVIEW_RELATIE).",
      "  lint     [--basis <ref>] [--tekst <s>] [--tekst-bestand <pad>]",
      "           [--ack-bestand <pad>] [--ack-actor <naam>] [--ack-relatie <relatie>]",
      "           Acks komen alleen uit --ack-bestand, en alleen wanneer de actor",
      "           een mens is met schrijfrecht. Niet uit --tekst: die schrijft de agent.",
      "                                    Deterministische poort: kennis, randvoorwaarden, status",
      '  context  --taak "<tekst>" [--klasse S|M|L] [--bestanden a,b] [--uit <map>]',
      "                                    Stelt een begrensd, herleidbaar contextpakket samen",
      "  sanitize [--schrijf]              Redigeert PII/secrets uit persistente Jarvis-data en herscant",
      "  state    [--controleer]           Genereert of controleert het feitenblok in CURRENT_STATE",
      "  plan     <bestand.md>             Kritiek pad en execution waves uit een plantabel",
      "  audit    <taak-id>                Reconstrueert een afgeronde taak uit de repository",
      "  rollen   [--schrijf]              Genereert de providerafgeleiden van de rolcontracten;",
      "                                    zonder --schrijf een driftcontrole (zit in de poort)",
      "  db <nieuw|wachten|claim|verwerkt|bericht|document|toetsing|autorisaties|wie> [opties]",
      "                                    De eigen database van Jarvis (schema jarvis): nieuwe",
      "                                    antwoorden en berichten lezen, claimen, verwerken, documenten zetten,",
      "                                    een QA-toetsing vastleggen, akkoorden van de eigenaar lezen.",
      "  pr <wie|openen|status|attesteren|mergen|uitnodigingen> [opties]",
      "                                    Pull requests als de bot: openen, volgen, de attestatie starten",
      "                                    en samenvoegen na akkoord van de eigenaar (DEC-0043).",
      "  attestatie --pr <nummer>          In de attestatieworkflow: verifieert akkoord, scope, toetsing,",
      "                                    uitzonderingen en poort, en geeft dan de goedkeurende review af.",
      "  overzicht [--extern <pad,pad>] [--uit <bestand>]",
      "                                    Bouwt het overzicht voor de interface: stand, beweging en",
      "                                    wat bij de eigenaar ligt, per project; gaat door de sanitizer",
      "",
      "Exitcodes: 0 ok · 1 bevindingen · 2 gebruiksfout · 3 uitgeschakeld",
    ].join("\n"),
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Pull requests als de bot. Zie pr.ts voor wie wat doet en waarom.
// ---------------------------------------------------------------------------

const BOT_TOKEN_BESTAND = process.env.JARVIS_BOT_TOKEN_BESTAND ?? path.join(homedir(), ".jarvis-bot-token");

/**
 * Leest het token van de bot. Drie bronnen, in deze volgorde: de
 * omgevingsvariabele JARVIS_BOT_TOKEN (cloud-omgevingen), het tokenbestand
 * op de laptop, en als laatste de GitHub-CLI (`gh auth token`) wanneer die
 * als de bot is aangemeld — zo werkt `jarvis pr` in een cloud-sessie zonder
 * dat het token ergens anders hoeft te staan. Het komt nergens in uitvoer,
 * logs of fouten.
 */
async function leesBotToken(): Promise<string | null> {
  const uitOmgeving = (process.env.JARVIS_BOT_TOKEN ?? "").trim();
  if (uitOmgeving.length > 0) return uitOmgeving;
  try {
    const inhoud = (await readFile(BOT_TOKEN_BESTAND, "utf8")).trim();
    if (inhoud.length > 0) return inhoud;
  } catch {
    // Geen bestand; verder met de plaatshouder of de CLI.
  }
  // In een cloud-sessie van het platform staat er soms een plaatshouder in
  // GH_TOKEN/GITHUB_TOKEN die de GitHub-proxy buiten de VM vervangt door de
  // echte identiteit; die is per definitie geen geheim en werkt alleen daar.
  // Ná het bestand: op de laptop mag een persoonlijke GH_TOKEN de bot niet
  // verdringen (QA-bevinding 2).
  const plaatshouder = (process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "").trim();
  if (plaatshouder.length > 0) return plaatshouder;
  try {
    const { stdout } = await uitvoeren("gh", ["auth", "token"], { maxBuffer: 1024 * 1024 });
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

type GitHubAntwoord = { readonly status: number; readonly lading: unknown; readonly koppen: Headers };

async function github(token: string, methode: string, pad: string, body?: unknown): Promise<GitHubAntwoord> {
  const antwoord = await fetch(`https://api.github.com${pad}`, {
    method: methode,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "jarvis-pr",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let lading: unknown = null;
  try {
    lading = await antwoord.json();
  } catch {
    lading = null;
  }
  return { status: antwoord.status, lading, koppen: antwoord.headers };
}

function foutTekst(a: GitHubAntwoord): string {
  const l = a.lading as { message?: unknown } | null;
  return typeof l?.message === "string" ? `${a.status}: ${l.message}` : `HTTP ${a.status}`;
}

async function slugUitOrigin(wortel: string): Promise<string | null> {
  const url = await git(wortel, ["remote", "get-url", "origin"]);
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function leesPullRequest(token: string, slug: string, nummer: number): Promise<PullRequestFeiten | string> {
  const pr = await github(token, "GET", `/repos/${slug}/pulls/${nummer}`);
  if (pr.status !== 200) return `pull request niet te lezen (${foutTekst(pr)})`;
  const p = pr.lading as {
    user: { login: string };
    head: { sha: string };
    base: { ref: string };
    state: string;
    draft: boolean;
    mergeable: boolean | null;
    mergeable_state: string;
  };
  const reviews = await github(token, "GET", `/repos/${slug}/pulls/${nummer}/reviews?per_page=100`);
  if (reviews.status !== 200) return `reviews niet te lezen (${foutTekst(reviews)})`;
  const checks = await github(token, "GET", `/repos/${slug}/commits/${p.head.sha}/check-runs?per_page=100`);
  if (checks.status !== 200) return `checks niet te lezen (${foutTekst(checks)})`;
  const lijst = (reviews.lading as { user: { login: string }; state: string; commit_id: string; body: string | null }[]).map(
    (r) => ({
      gebruiker: r.user.login,
      staat: r.state,
      commit: r.commit_id,
      tekst: r.body ?? "",
    }),
  );
  const runs = (checks.lading as { check_runs: { name: string; status: string; conclusion: string | null; started_at?: string | null }[] }).check_runs;
  return {
    nummer,
    auteur: p.user.login,
    kop: p.head.sha,
    basis: p.base.ref,
    open: p.state === "open",
    concept: p.draft,
    samenvoegbaar: p.mergeable,
    samenvoegStaat: p.mergeable_state,
    reviews: lijst,
    checks: runs.map((r) => ({ naam: r.name, status: r.status, conclusie: r.conclusion, gestart: r.started_at ?? null })),
  };
}

/**
 * `jarvis pr <wie|openen|status|mergen|uitnodigingen> [opties]`
 *
 *   wie                              Wie is de bot, en wanneer verloopt het token.
 *   openen --branch <b> --titel <t> --body <bestand> [--repo <slug>] [--basis main]
 *   status <nummer> [--repo <slug>]
 *   mergen <nummer> [--repo <slug>]  Alleen na goedkeuring van de eigenaar op de huidige kop.
 *   uitnodigingen                    Accepteert openstaande repository-uitnodigingen voor de bot.
 */
async function opdrachtPr(losse: readonly string[], vlaggen: ReadonlyMap<string, string>): Promise<number> {
  const wat = losse[0] ?? "";
  const token = await leesBotToken();
  if (token === null) {
    console.error(`jarvis pr: geen bottoken: niet in JARVIS_BOT_TOKEN, niet in ${BOT_TOKEN_BESTAND}, en de GitHub-CLI is niet aangemeld.`);
    return 1;
  }
  const wortel = (await vindWortel(process.cwd())) ?? process.cwd();
  const slug = vlaggen.get("repo") ?? (await slugUitOrigin(wortel));

  const ik = await github(token, "GET", "/user");
  if (ik.status !== 200) {
    console.error(`jarvis pr: het token werkt niet (${foutTekst(ik)}); is het verlopen of ingetrokken?`);
    return 1;
  }
  const botLogin = (ik.lading as { login: string }).login;
  const verloopt = ik.koppen.get("github-authentication-token-expiration");
  // Noemt de configuratie de bot, dan werkt jarvis pr alleen als die bot:
  // een token van iemand anders (de eigenaar, een persoonlijke GH_TOKEN)
  // opent of merget hier niets. `wie` mag het wel melden.
  const configResultaat = await laadConfig(wortel);
  const verwachteBot = configResultaat.ok ? configResultaat.config.attestatie.bot : "";
  if (wat !== "wie" && verwachteBot && botLogin.toLowerCase() !== verwachteBot.toLowerCase()) {
    console.error(`jarvis pr: het token hoort bij ${botLogin}, maar jarvis.config.yml noemt ${verwachteBot} als bot; onder een andere identiteit doet jarvis pr niets.`);
    return 1;
  }

  if (wat === "wie") {
    console.log(`jarvis pr: bot ${botLogin}; token verloopt ${verloopt ?? "onbekend"}.`);
    // Een fijnmazig token bereikt alleen repositories van zijn eigen
    // resource owner; repositories van de eigenaar waar de bot collaborator
    // is, ziet het niet (404). Daarvoor is een klassiek token nodig.
    if (token.startsWith("github_pat_")) {
      console.error(
        "jarvis pr: dit is een fijnmazig token; dat bereikt geen repositories van een ander account. " +
          "Gebruik een klassiek token (scopes repo en workflow).",
      );
    }
    if (slug !== null) {
      const repo = await github(token, "GET", `/repos/${slug}`);
      const rechten = (repo.lading as { permissions?: { push?: boolean; admin?: boolean } } | null)?.permissions;
      if (repo.status !== 200) console.error(`jarvis pr: ${slug} is met dit token niet bereikbaar (${foutTekst(repo)}).`);
      // Het token van een GitHub-App-installatie (de proxy van de cloud) krijgt geen
      // permissions-veld terug, terwijl het wél kan schrijven (gemeten 2026-09-14:
      // PR #17 en een branch vanuit de cloud). Dan is het recht onbekend, niet afwezig.
      else if (rechten === undefined) console.log(`jarvis pr: ${slug} is leesbaar; het token meldt zijn rechten niet (app-installatie) — schrijfrecht onbekend, probeer gewoon.`);
      else if (!rechten.push) console.error(`jarvis pr: ${slug} is leesbaar maar de bot heeft er geen schrijfrecht; nodig hem uit.`);
      else console.log(`jarvis pr: ${slug}: schrijfrecht ${rechten.admin ? "en admin (te veel!)" : "zonder admin"}.`);
    }
    return 0;
  }

  if (wat === "uitnodigingen") {
    const lijst = await github(token, "GET", "/user/repository_invitations");
    if (lijst.status !== 200) {
      console.error(`jarvis pr: uitnodigingen niet te lezen (${foutTekst(lijst)})`);
      return 1;
    }
    const items = lijst.lading as { id: number; repository: { full_name: string } }[];
    for (const u of items) {
      const a = await github(token, "PATCH", `/user/repository_invitations/${u.id}`);
      console.log(`jarvis pr: uitnodiging voor ${u.repository.full_name} ${a.status === 204 ? "geaccepteerd" : `niet geaccepteerd (${foutTekst(a)})`}.`);
    }
    if (items.length === 0) console.log("jarvis pr: geen openstaande uitnodigingen.");
    return 0;
  }

  if (slug === null) {
    console.error("jarvis pr: geen repository bekend; geef --repo <eigenaar/naam>.");
    return 1;
  }

  if (wat === "openen") {
    const branch = vlaggen.get("branch") ?? "";
    const titel = vlaggen.get("titel") ?? "";
    const bodyBestand = vlaggen.get("body") ?? "";
    const basis = vlaggen.get("basis") ?? "main";
    if (!branch || !titel || !bodyBestand) {
      console.error("jarvis pr openen: --branch, --titel en --body <bestand> zijn verplicht.");
      return 2;
    }
    const body = await leesOfNull(path.resolve(wortel, bodyBestand));
    if (body === null) {
      console.error(`jarvis pr openen: kon ${bodyBestand} niet lezen.`);
      return 1;
    }
    const open = await github(token, "GET", `/repos/${slug}/pulls?state=open&per_page=100`);
    if (open.status !== 200) {
      console.error(`jarvis pr openen: open pull requests niet te lezen (${foutTekst(open)})`);
      return 1;
    }
    const koppen = (open.lading as { head: { ref: string } }[]).map((p) => p.head.ref);
    const redenen = beoordeelOpenen(botLogin, slug, koppen, branch);
    if (redenen.length > 0) {
      for (const r of redenen) console.error(`jarvis pr openen: ${r}`);
      return 1;
    }
    const nieuw = await github(token, "POST", `/repos/${slug}/pulls`, { title: titel, head: branch, base: basis, body });
    if (nieuw.status !== 201) {
      console.error(`jarvis pr openen: aanmaken mislukt (${foutTekst(nieuw)})`);
      return 1;
    }
    const pr = nieuw.lading as { number: number; html_url: string };
    console.log(`jarvis pr: #${pr.number} geopend door ${botLogin}: ${pr.html_url}`);
    await schrijfActiviteit({ uitvoerder: dezeUitvoerder(), rol: "developer", taak: null, project: null, soort: "pr", tekst: `pull request #${pr.number} geopend: ${titel}`, verwijzing: `${slug}#${pr.number}` });
    return 0;
  }

  const nummer = Number.parseInt(losse[1] ?? "", 10);
  if (!Number.isInteger(nummer) || nummer <= 0) {
    console.error(`jarvis pr ${wat || "?"}: geef het nummer van de pull request.`);
    return 2;
  }
  const feiten = await leesPullRequest(token, slug, nummer);
  if (typeof feiten === "string") {
    console.error(`jarvis pr: ${feiten}`);
    return 1;
  }
  const eigenaar = eigenaarVan(slug);

  if (wat === "attesteren") {
    // Start de attestatieworkflow op main; die beoordeelt zelf en keurt goed
    // of niet. De bot kan hier niets afdwingen: hij vraagt alleen om de toets.
    const start = await github(token, "POST", `/repos/${slug}/actions/workflows/jarvis-attestatie.yml/dispatches`, {
      ref: "main",
      inputs: { pr: String(nummer) },
    });
    if (start.status !== 204) {
      console.error(`jarvis pr attesteren: workflow niet gestart (${foutTekst(start)}); staat jarvis-attestatie.yml op main?`);
      return 1;
    }
    console.log(`jarvis pr: attestatie gevraagd voor #${nummer} op ${feiten.kop.slice(0, 7)}; de workflow beoordeelt en geeft bij een schone uitkomst de review af (zie Actions → jarvis-attestatie).`);
    return 0;
  }

  const attestaties = await geverifieerdeAttestaties(token, slug, feiten);
  for (const o of attestaties.opmerkingen) console.error(`jarvis pr: ${o}`);
  const redenen = beoordeelSamenvoegen(feiten, eigenaar, attestaties.koppen);

  if (wat === "status") {
    console.log(`jarvis pr: #${nummer} van ${feiten.auteur} naar ${feiten.basis}, kop ${feiten.kop.slice(0, 7)}, ${feiten.open ? "open" : "gesloten"}.`);
    for (const c of feiten.checks) console.log(`  check ${c.naam}: ${c.status}${c.conclusie ? ` / ${c.conclusie}` : ""}`);
    for (const r of feiten.reviews) console.log(`  review ${r.gebruiker}: ${r.staat} op ${r.commit.slice(0, 7)}`);
    console.log(redenen.length === 0 ? "  klaar om samen te voegen." : `  nog niet samen te voegen: ${redenen.join("; ")}`);
    return 0;
  }

  if (wat === "mergen") {
    if (redenen.length > 0) {
      for (const r of redenen) console.error(`jarvis pr mergen: ${r}`);
      return 1;
    }
    const samen = await github(token, "PUT", `/repos/${slug}/pulls/${nummer}/merge`, {
      merge_method: SAMENVOEGMETHODE,
      sha: feiten.kop,
    });
    if (samen.status !== 200) {
      console.error(`jarvis pr mergen: samenvoegen mislukt (${foutTekst(samen)})`);
      return 1;
    }
    const uit = samen.lading as { sha: string };
    const grond = attestaties.koppen.includes(feiten.kop) ? "een geverifieerde attestatie van de poort" : `goedkeuring van ${eigenaar}`;
    console.log(`jarvis pr: #${nummer} samengevoegd in ${feiten.basis} als ${uit.sha.slice(0, 7)} (mergecommit), op grond van ${grond}.`);
    // De regie ziet hieraan dat een "wacht op PR #n"-stap niet langer wacht.
    await schrijfActiviteit({ uitvoerder: dezeUitvoerder(), rol: "orchestrator", taak: null, project: null, soort: "merge",
      tekst: `pull request #${nummer} samengevoegd in ${feiten.basis} als ${uit.sha.slice(0, 7)}`, verwijzing: `${slug}#${nummer}` });
    return 0;
  }

  console.error(`jarvis pr: onbekende deelopdracht "${wat}". Gebruik wie, openen, status, attesteren, mergen of uitnodigingen.`);
  return 2;
}

// ---------------------------------------------------------------------------
// De eigen database van Jarvis (schema jarvis). Zie db.ts.
// ---------------------------------------------------------------------------

const DB_URL_BESTAND = process.env.JARVIS_DB_URL_BESTAND ?? path.join(homedir(), ".jarvis-db-url");

async function leesDbUrl(): Promise<string | null> {
  const uitOmgeving = (process.env.JARVIS_DB_URL ?? "").trim();
  if (uitOmgeving.length > 0) return uitOmgeving;
  try {
    const inhoud = (await readFile(DB_URL_BESTAND, "utf8")).trim();
    return inhoud.length > 0 ? inhoud : null;
  } catch {
    return null;
  }
}

/** De kleinste gemene deler van een postgres-verbinding en de HTTPS-client. */
type DbClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
  end: (o: { timeout: number }) => Promise<void>;
};

/**
 * De eigen database over HTTPS, voor een omgeving zonder Postgres-bereik (de
 * cloud, gemeten 2026-09-13): elk statement gaat als POST naar de Edge
 * Function `jarvis-db`. De aanroep draagt zelf GEEN token: de proxy van het
 * platform voegt de Authorization-header toe voor de host van de functie
 * (API credential); het geheim komt deze code nooit in. Buiten zo'n proxy
 * antwoordt de functie 401 en meldt de engine dat.
 */
function apiClient(url: string): DbClient {
  return {
    async unsafe(sql, params = []) {
      let antwoord: Response;
      try {
        antwoord = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "jarvis-db", Connection: "close" },
          body: JSON.stringify({ sql, params }),
        });
      } catch (fout) {
        throw new Error(`jarvis-db niet bereikbaar: ${fout instanceof Error ? fout.message : String(fout)}`);
      }
      const lading = (await antwoord.json().catch(() => ({}))) as { rows?: unknown; fout?: unknown };
      if (!antwoord.ok) {
        throw new Error(
          antwoord.status === 401
            ? "jarvis-db weigert (401): geen API credential voor deze host in deze omgeving"
            : `jarvis-db: HTTP ${antwoord.status}${typeof lading.fout === "string" ? ` — ${lading.fout}` : ""}`,
        );
      }
      return Array.isArray(lading.rows) ? (lading.rows as Record<string, unknown>[]) : [];
    },
    async end() {
      /* niets open */
    },
  };
}

/**
 * Verbindt met de eigen database langs de eerste weg die er is:
 *   1. een verbindingsreeks (JARVIS_DB_URL of het bestand) — de laptop;
 *   2. de Edge Function jarvis-db (JARVIS_DB_API, of afgeleid van
 *      attestatie.url in jarvis.config.yml) — de cloud.
 * Geen van beide: null.
 */
async function verbindDb(): Promise<{ readonly sql: DbClient; readonly bron: string } | null> {
  const url = await leesDbUrl();
  if (url !== null) {
    const { default: postgres } = await import("postgres");
    const bron = verbindingsBron(process.env.JARVIS_DB_URL, true) ?? "bestand";
    return { sql: postgres(url, { prepare: false, max: 1, connect_timeout: 15 }) as unknown as DbClient, bron };
  }
  let api = (process.env.JARVIS_DB_API ?? "").trim();
  if (!api) {
    const wortel = (await vindWortel(process.cwd())) ?? process.cwd();
    const config = await laadConfig(wortel);
    const basis = config.ok ? config.config.attestatie.url.replace(/\/$/, "") : "";
    if (basis) api = `${basis}/functions/v1/jarvis-db`;
  }
  if (!api) return null;
  return { sql: apiClient(api), bron: "api (Edge Function jarvis-db, header via de proxy van het platform)" };
}

/**
 * `jarvis db <nieuw|claim|verwerkt|bericht|document|wie> …`
 *
 *   nieuw                                  Nieuwe antwoorden en berichten van de eigenaar, als JSON.
 *   claim <tabel> <id> --door <naam>       Zet een item op "in behandeling"; slaagt alleen als het nog nieuw was.
 *   verwerkt <tabel> <id> --verwerking <t> Zet een item op "verwerkt" met de toelichting.
 *   bericht --tekst <t> [--context <json>] Schrijft een bericht van Jarvis.
 *   document <id> --bestand <json>         Zet een document (overzicht/huidig, jarvis/status).
 *   wachten [--max <seconden>]             Wacht tot er een nieuw antwoord, bericht of akkoord is; geeft dat als JSON.
 *   wie                                    Toont waar de verbinding vandaan komt en of ze werkt; nooit de reeks zelf.
 */
/**
 * Schrijft één activiteitsregel van het digitale team. Zonder database (of
 * zonder de tabel) faalt de opdracht die het aanroept niet: activiteit is
 * zichtbaarheid, geen voorwaarde.
 */
export async function schrijfActiviteit(a: {
  readonly uitvoerder: string;
  readonly rol: Rol;
  readonly taak: string | null;
  readonly project: string | null;
  readonly soort: string;
  readonly tekst: string;
  readonly verwijzing?: string | null;
}): Promise<boolean> {
  const verbinding = await verbindDb();
  if (verbinding === null) return false;
  try {
    await verbinding.sql.unsafe(ACTIVITEIT_SQL, [a.uitvoerder, a.rol, a.taak, a.project, a.soort, a.tekst.slice(0, 500), a.verwijzing ?? null]);
    return true;
  } catch (fout) {
    const tekst = fout instanceof Error ? fout.message : String(fout);
    console.error(`jarvis: activiteit niet geschreven: ${tekst.replace(/postgres(ql)?:\/\/\S+/gi, "<verbindingsreeks>").slice(0, 160)}`);
    return false;
  } finally {
    await verbinding.sql.end({ timeout: 2 });
  }
}

/** Welke uitvoerder dit is: de cloud (proxy van het platform) of de laptop. */
function dezeUitvoerder(): string {
  return process.env.JARVIS_UITVOERDER ?? (process.env.HTTPS_PROXY || process.env.https_proxy ? "cloud" : "laptop");
}

/**
 * `jarvis werk <claim|stap|heartbeat|fout|klaar|vrijgave> <taak> [--rol r] [--project p] [--tekst t] [--verwijzing v]`
 * De uitvoerder meldt wat een rol aan een taak doet. Een claim maakt de taak
 * RUNNING voor `jarvis regie`; stappen en heartbeats houden hem levend; fout
 * blokkeert; klaar of vrijgave beëindigt de uitvoering.
 */
async function opdrachtWerk(losse: readonly string[], vlaggen: ReadonlyMap<string, string>): Promise<number> {
  const soort = losse[0] ?? "";
  const taak = losse[1] ?? "";
  const soorten = ["claim", "stap", "heartbeat", "fout", "klaar", "vrijgave"];
  if (!soorten.includes(soort) || !/^T-\d{8}-[a-z0-9-]+$/i.test(taak)) {
    console.error(`jarvis werk: gebruik: jarvis werk <${soorten.join("|")}> <taak-id> [--rol <rol>] [--project <id>] [--tekst "<wat>"] [--verwijzing <pr/commit>]`);
    return 2;
  }
  const rol = (vlaggen.get("rol") ?? "developer") as Rol;
  if (!(ROLLEN as readonly string[]).includes(rol)) {
    console.error(`jarvis werk: onbekende rol "${rol}"; kies uit ${ROLLEN.join(", ")}.`);
    return 2;
  }
  const standaard: Record<string, string> = { claim: "opgepakt", stap: "stap gezet", heartbeat: "nog bezig", fout: "fout", klaar: "klaar", vrijgave: "losgelaten" };
  const ok = await schrijfActiviteit({
    uitvoerder: vlaggen.get("door") ?? dezeUitvoerder(),
    rol,
    taak,
    project: vlaggen.get("project") ?? null,
    soort,
    tekst: vlaggen.get("tekst") ?? standaard[soort],
    verwijzing: vlaggen.get("verwijzing") ?? null,
  });
  if (!ok) {
    console.error("jarvis werk: geen database bereikbaar; niets geschreven.");
    return 1;
  }
  console.log(`jarvis werk: ${soort} op ${taak} door ${rol} (${vlaggen.get("door") ?? dezeUitvoerder()}) vastgelegd.`);
  return 0;
}

/**
 * `jarvis regie [--extern <pad,pad>] [--uit <bestand>] [--schrijf] [--json]`
 * De Task Controller: per open taak de toestand, de verantwoordelijke rol,
 * waarom, laatste activiteit, volgende stap en wie die uitvoert; per rol wat
 * hij doet; en het uitvoerbare werk in prioriteitsvolgorde. Met --schrijf
 * gaat het als document regie/huidig naar de database en meldt de controller
 * zijn ronde als activiteit.
 */
async function opdrachtRegie(vlaggen: ReadonlyMap<string, string>): Promise<number> {
  const { wortel, overzicht } = await bouwOverzichtVanuit(vlaggen);
  let activiteit: Activiteit[] = [];
  const verbinding = await verbindDb();
  if (verbinding !== null) {
    try {
      const rijen = await verbinding.sql.unsafe(ACTIVITEIT_RECENT_SQL);
      activiteit = rijen.map((r) => ({
        op: new Date(String(r.op)).toISOString(),
        uitvoerder: String(r.uitvoerder),
        rol: String(r.rol),
        taak: r.taak === null ? null : String(r.taak),
        project: r.project === null ? null : String(r.project),
        soort: String(r.soort),
        tekst: String(r.tekst),
        verwijzing: r.verwijzing === null || r.verwijzing === undefined ? null : String(r.verwijzing),
      }));
    } catch (fout) {
      const tekst = fout instanceof Error ? fout.message : String(fout);
      console.error(`jarvis regie: activiteit niet te lezen (${tekst.slice(0, 120)}); toestand zonder heartbeat.`);
    } finally {
      await verbinding.sql.end({ timeout: 2 });
    }
  }
  const regie = bepaalRegie(overzicht, activiteit, new Date());
  const json = `${JSON.stringify(regie, null, 2)}\n`;

  const allowlist = await laadAllowlistVanSchijf(wortel);
  const bevindingen = scanTekst(json, allowlist, "regie.json");
  if (bevindingen.length > 0) {
    console.error(`jarvis regie: ${bevindingen.length} bevinding(en) in de uitvoer; niets geschreven.`);
    return 1;
  }

  const uit = vlaggen.get("uit");
  if (uit) {
    await mkdir(path.dirname(path.resolve(wortel, uit)), { recursive: true });
    await writeFile(path.resolve(wortel, uit), json, "utf8");
  }
  if (vlaggen.has("schrijf")) {
    const v2 = await verbindDb();
    if (v2 === null) {
      console.error("jarvis regie: geen database bereikbaar; regie/huidig niet geschreven.");
      return 1;
    }
    try {
      await v2.sql.unsafe(DOCUMENT_SQL, ["regie/huidig", json]);
    } finally {
      await v2.sql.end({ timeout: 2 });
    }
    await schrijfActiviteit({
      uitvoerder: dezeUitvoerder(),
      rol: "task-controller",
      taak: null,
      project: null,
      soort: "regie",
      tekst: `ronde: ${regie.taken.length} open, ${regie.uitvoerbaar.length} uitvoerbaar, ${regie.afwijkingen.length} afwijking(en)`,
    });
  }
  if (vlaggen.has("json") || (!uit && !vlaggen.has("schrijf"))) {
    process.stdout.write(json);
    return 0;
  }
  for (const t of regie.taken) {
    console.log(`${t.toestand.padEnd(22)} ${t.id.padEnd(36)} ${t.verantwoordelijke.padEnd(18)} ${t.waarom}`);
  }
  console.log(`jarvis regie: ${regie.taken.length} open taak/taken, ${regie.uitvoerbaar.length} uitvoerbaar, ${regie.afwijkingen.length} afwijking(en)${uit ? `, geschreven naar ${uit}` : ""}${vlaggen.has("schrijf") ? ", regie/huidig gezet" : ""}.`);
  return 0;
}

async function opdrachtDb(losse: readonly string[], vlaggen: ReadonlyMap<string, string>): Promise<number> {
  const wat = losse[0] ?? "";
  const verbinding = await verbindDb();
  if (verbinding === null) {
    console.error(
      `jarvis db: geen weg naar de database: geen verbindingsreeks (JARVIS_DB_URL, ${DB_URL_BESTAND}) en geen ` +
        "Edge Function (JARVIS_DB_API of attestatie.url in jarvis.config.yml).",
    );
    return 1;
  }
  const { sql, bron } = verbinding;
  try {
    if (wat === "wie") {
      const rij = await sql.unsafe(WIE_SQL);
      console.log(`jarvis db: verbonden als ${rij[0]?.gebruiker} (bron: ${bron}; PostgreSQL ${rij[0]?.versie}).`);
      return 0;
    }
    if (wat === "nieuw") {
      const antwoorden = await sql.unsafe(NIEUWE_ANTWOORDEN_SQL);
      const berichten = await sql.unsafe(NIEUWE_BERICHTEN_SQL);
      console.log(JSON.stringify({ antwoorden, berichten }, null, 2));
      return 0;
    }
    if (wat === "wachten") {
      // De wekker van een uitvoerder: peilt elke twintig seconden en stopt
      // zodra er iets nieuws is (of na --max seconden, exitcode 3). Zo hangt
      // een laptopsessie niet meer aan een claude.ai-melding (DEC-0044).
      const gevraagd = Number.parseInt(vlaggen.get("max") ?? "", 10);
      const max = Number.isInteger(gevraagd) && gevraagd > 0 ? gevraagd : 3600;
      const sinds = new Date().toISOString();
      const start = Date.now();
      let storingen = 0;
      while (Date.now() - start < max * 1000) {
        try {
          const antwoorden = await sql.unsafe(NIEUWE_ANTWOORDEN_SQL);
          const berichten = await sql.unsafe(NIEUWE_BERICHTEN_SQL);
          const autorisaties = await sql.unsafe(AUTORISATIES_SINDS_SQL, [sinds]);
          if (antwoorden.length + berichten.length + autorisaties.length > 0) {
            console.log(JSON.stringify({ antwoorden, berichten, autorisaties }, null, 2));
            return 0;
          }
          storingen = 0;
        } catch (fout) {
          // Een haperende verbinding is geen reden om de wacht op te geven;
          // pas na tien peilingen op rij zonder antwoord stoppen we met fout.
          storingen += 1;
          const tekst = fout instanceof Error ? fout.message : String(fout);
          console.error(`jarvis db wachten: peiling mislukt (${storingen}/10): ${tekst.replace(/postgres(ql)?:\/\/\S+/gi, "<verbindingsreeks>")}`);
          if (storingen >= 10) return 1;
        }
        await new Promise((klaar) => setTimeout(klaar, 20_000));
      }
      console.log(`jarvis db: niets nieuws in ${max} seconden.`);
      return 3;
    }
    if (wat === "claim" || wat === "verwerkt") {
      const tabel = losse[1] ?? "";
      const id = losse[2] ?? "";
      if (!isTabel(tabel) || !id) {
        console.error(`jarvis db ${wat}: gebruik: jarvis db ${wat} <antwoorden|berichten> <id> ${wat === "claim" ? "--door <naam>" : "--verwerking <tekst>"}`);
        return 2;
      }
      if (wat === "claim") {
        const door = vlaggen.get("door") ?? "";
        if (!door) {
          console.error("jarvis db claim: --door <naam> is verplicht (laptop, cloud, …).");
          return 2;
        }
        const rijen = await sql.unsafe(claimSql(tabel), [id, door]);
        if (rijen.length === 0) {
          console.log(`jarvis db: ${tabel}/${id} is al in behandeling of verwerkt; overgeslagen.`);
          return 3;
        }
        console.log(`jarvis db: ${tabel}/${id} geclaimd door ${door}.`);
        return 0;
      }
      const verwerking = vlaggen.get("verwerking") ?? "";
      if (!verwerking) {
        console.error("jarvis db verwerkt: --verwerking <tekst> is verplicht.");
        return 2;
      }
      const rijen = await sql.unsafe(verwerktSql(tabel), [id, verwerking]);
      console.log(rijen.length === 0 ? `jarvis db: ${tabel}/${id} niet gevonden.` : `jarvis db: ${tabel}/${id} verwerkt.`);
      return rijen.length === 0 ? 1 : 0;
    }
    if (wat === "bericht") {
      const tekst = vlaggen.get("tekst") ?? "";
      if (!tekst) {
        console.error("jarvis db bericht: --tekst <tekst> is verplicht.");
        return 2;
      }
      const context = vlaggen.get("context") ?? "{}";
      JSON.parse(context);
      const id = berichtId(new Date(), randomBytes(4).toString("hex"));
      await sql.unsafe(BERICHT_VAN_JARVIS_SQL, [id, tekst, context]);
      console.log(`jarvis db: bericht ${id} geschreven.`);
      return 0;
    }
    if (wat === "toetsing") {
      // jarvis db toetsing <repo> <nummer> <sha> <GO|NO-GO> --door <naam> [--rapport <bestand>]
      const repo = losse[1] ?? "";
      const nummer = Number.parseInt(losse[2] ?? "", 10);
      const sha = losse[3] ?? "";
      const oordeel = losse[4] ?? "";
      const rapportPad = vlaggen.get("rapport") ?? "";
      const door = vlaggen.get("door") ?? "";
      if (!/^[^/\s]+\/[^/\s]+$/.test(repo) || !Number.isInteger(nummer) || !/^[0-9a-f]{40}$/.test(sha) || !isOordeel(oordeel) || !door) {
        console.error("jarvis db toetsing: gebruik: jarvis db toetsing <eigenaar/naam> <nummer> <volledige sha> <GO|NO-GO> --door <naam> [--rapport <bestand>]");
        return 2;
      }
      const rapport = rapportPad ? await readFile(path.resolve(rapportPad), "utf8") : null;
      const rijen = await sql.unsafe(TOETSING_SQL, [repo, nummer, sha, oordeel, rapport, door]);
      console.log(`jarvis db: toetsing ${String(rijen[0]?.["id"])} vastgelegd: ${repo}#${nummer} op ${sha.slice(0, 7)} ${oordeel}.`);
      await schrijfActiviteit({ uitvoerder: door, rol: "qa", taak: null, project: null, soort: "toetsing", tekst: `toetsing ${oordeel} op ${repo}#${nummer} (${sha.slice(0, 7)})`, verwijzing: `${repo}#${nummer}` });
      return 0;
    }
    if (wat === "autorisaties") {
      const taak = vlaggen.get("taak") ?? "";
      const rijen = taak ? await sql.unsafe(AUTORISATIE_TAAK_SQL, [taak]) : await sql.unsafe(AUTORISATIES_SQL);
      console.log(JSON.stringify(rijen, null, 2));
      return 0;
    }
    if (wat === "document") {
      const id = losse[1] ?? "";
      const bestand = vlaggen.get("bestand") ?? "";
      if (!id || !bestand) {
        console.error("jarvis db document: gebruik: jarvis db document <id> --bestand <json-bestand>");
        return 2;
      }
      const inhoud = await readFile(path.resolve(bestand), "utf8");
      JSON.parse(inhoud);
      await sql.unsafe(DOCUMENT_SQL, [id, inhoud]);
      console.log(`jarvis db: document ${id} gezet.`);
      return 0;
    }
    console.error(`jarvis db: onbekende deelopdracht "${wat}". Gebruik nieuw, claim, verwerkt, bericht, document, toetsing, autorisaties of wie.`);
    return 2;
  } catch (fout) {
    // Nooit de verbindingsreeks of het wachtwoord in een foutmelding.
    const tekst = fout instanceof Error ? fout.message : String(fout);
    console.error(`jarvis db: mislukt: ${tekst.replace(/postgres(ql)?:\/\/\S+/gi, "<verbindingsreeks>")}`);
    return 1;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

// ---------------------------------------------------------------------------
// Attestatie (DEC-0043): de poort geeft de goedkeurende review af. Zie
// attestatie.ts voor de regels; hier alleen de I/O.
//
// Twee lezers, één oordeel. De workflow (`jarvis attestatie`) leest akkoord
// en toetsing via de leesbeelden met de publieke sleutel; `jarvis pr mergen`
// leest ze via de rol jarvis_werker. Beide verzamelen dezelfde feiten van
// GitHub en laten dezelfde pure beoordeling lopen. Een review van
// github-actions[bot] is daardoor alleen een technische grendel op GitHub:
// wie samenvoegt, beoordeelt zelf opnieuw — een review die niet uit de
// attestatieworkflow komt (een andere workflow met schrijfrecht, een run van
// een andere ref) haalt het daarmee niet.
// ---------------------------------------------------------------------------

type PgClient = DbClient;

/** Waar akkoorden en toetsingen vandaan komen: de leesbeelden (REST) of de rol (SQL). */
type AttestatieBron = {
  readonly taak: (taak: string) => Promise<Autorisatie | null>;
  readonly pr: (repo: string, nummer: number, kop: string) => Promise<Autorisatie | null>;
  readonly toetsing: (repo: string, nummer: number, kop: string) => Promise<Toetsing | null>;
  readonly opId: (autorisaties: readonly string[], toetsing: string) => Promise<{ autorisaties: ReadonlyMap<string, Autorisatie | null>; toetsing: Toetsing | null }>;
};

/** Rij → Autorisatie, met pr_nummer als getal (PostgREST en postgres geven soms een string). */
function alsAutorisatie(rij: Record<string, unknown> | undefined): Autorisatie | null {
  if (!rij) return null;
  return {
    id: String(rij["id"]),
    soort: rij["soort"] === "pr" ? "pr" : "taak",
    project: rij["project"] == null ? null : String(rij["project"]),
    taak: rij["taak"] == null ? null : String(rij["taak"]),
    scope_hash: rij["scope_hash"] == null ? null : String(rij["scope_hash"]),
    pr_repo: rij["pr_repo"] == null ? null : String(rij["pr_repo"]),
    pr_nummer: rij["pr_nummer"] == null ? null : Number(rij["pr_nummer"]),
    commit_sha: rij["commit_sha"] == null ? null : String(rij["commit_sha"]),
    op: String(rij["op"]),
  };
}

function alsToetsing(rij: Record<string, unknown> | undefined): Toetsing | null {
  if (!rij) return null;
  return {
    id: String(rij["id"]),
    pr_repo: String(rij["pr_repo"]),
    pr_nummer: Number(rij["pr_nummer"]),
    commit_sha: String(rij["commit_sha"]),
    oordeel: String(rij["oordeel"]),
    rapport: rij["rapport"] == null ? null : String(rij["rapport"]),
    door: String(rij["door"]),
    op: String(rij["op"]),
  };
}

/**
 * Leest één leesbeeld via PostgREST met de publieke sleutel. Het schema
 * `jarvis` moet in de API zichtbaar zijn; de leesbeelden geven geen
 * eigenaarsgegevens prijs. Fouten zijn fouten: geen stille lege lijst.
 */
async function leesViaRest(url: string, sleutel: string, pad: string): Promise<readonly Record<string, unknown>[]> {
  const antwoord = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${pad}`, {
    headers: {
      apikey: sleutel,
      Authorization: `Bearer ${sleutel}`,
      "Accept-Profile": "jarvis",
      Accept: "application/json",
      "User-Agent": "jarvis-attestatie",
    },
  });
  if (!antwoord.ok) throw new Error(`database niet te lezen via REST (HTTP ${antwoord.status}) op ${pad.split("?")[0]}`);
  const lading: unknown = await antwoord.json();
  return Array.isArray(lading) ? (lading as Record<string, unknown>[]) : [];
}

function restBron(url: string, sleutel: string): AttestatieBron {
  return {
    taak: async (taak) => alsAutorisatie((await leesViaRest(url, sleutel, restPadAutorisatieTaak(taak)))[0]),
    pr: async (repo, nummer, kop) => alsAutorisatie((await leesViaRest(url, sleutel, restPadAutorisatiePr(repo, nummer, kop)))[0]),
    toetsing: async (repo, nummer, kop) => alsToetsing((await leesViaRest(url, sleutel, restPadToetsingKop(repo, nummer, kop)))[0]),
    opId: async () => ({ autorisaties: new Map(), toetsing: null }),
  };
}

function sqlBron(sql: PgClient): AttestatieBron {
  return {
    taak: async (taak) => alsAutorisatie((await sql.unsafe(AUTORISATIE_TAAK_SQL, [taak]))[0]),
    pr: async (repo, nummer, kop) => alsAutorisatie((await sql.unsafe(AUTORISATIE_PR_SQL, [repo, nummer, kop]))[0]),
    toetsing: async (repo, nummer, kop) => alsToetsing((await sql.unsafe(TOETSING_KOP_SQL, [repo, nummer, kop]))[0]),
    opId: async (ids, t) => {
      const autorisaties = new Map<string, Autorisatie | null>();
      for (const id of ids) autorisaties.set(id, alsAutorisatie((await sql.unsafe(AUTORISATIE_ID_SQL, [id]))[0]));
      return { autorisaties, toetsing: t === "-" ? null : alsToetsing((await sql.unsafe(TOETSING_ID_SQL, [t]))[0]) };
    },
  };
}

/** Alle pagina's van een GitHub-lijst; weigert boven het plafond (fail closed). */
async function leesAllePaginas<T>(token: string, pad: string, plafond: number): Promise<readonly T[] | string> {
  const alles: T[] = [];
  for (let pagina = 1; pagina <= plafond; pagina += 1) {
    const a = await github(token, "GET", `${pad}${pad.includes("?") ? "&" : "?"}per_page=100&page=${pagina}`);
    if (a.status !== 200) return `${pad.split("?")[0]} niet te lezen (${foutTekst(a)})`;
    const lijst = a.lading as T[];
    alles.push(...lijst);
    if (lijst.length < 100) return alles;
  }
  return `${pad.split("?")[0]}: meer dan ${plafond * 100} regels; zo'n pull request wordt niet geattesteerd`;
}

/**
 * De configuratie van de repository waar de PR in staat, van main. Niet uit
 * de werkmap: `jarvis pr mergen 5 --repo x/y` kan vanuit een ander project
 * draaien, en de PR-branch mag zijn eigen configuratie niet meebrengen.
 */
async function leesConfigVanRepo(token: string, slug: string): Promise<JarvisConfig | string> {
  const a = await github(token, "GET", `/repos/${slug}/contents/jarvis.config.yml?ref=main`);
  if (a.status !== 200) return `jarvis.config.yml op main van ${slug} niet te lezen (${foutTekst(a)})`;
  const d = a.lading as { content?: string; encoding?: string };
  if (d.encoding !== "base64" || typeof d.content !== "string") return `jarvis.config.yml van ${slug} heeft een onverwachte vorm`;
  const uit = parseConfigTekst(Buffer.from(d.content, "base64").toString("utf8"));
  return uit.ok ? uit.config : uit.fouten.join("; ");
}

/**
 * De paden die in deze repository administratief zijn (DEC-0044): dossiers,
 * kennisrecords behalve de randvoorwaarden, de kennisindex en het
 * feitenblok. Afgeleid van de configuratie, niet instelbaar op zichzelf.
 */
function administratievePatronen(config: JarvisConfig): readonly RegExp[] {
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\/$/, "");
  return [
    new RegExp(`^${esc(config.taken_map)}/`),
    new RegExp(`^${esc(config.knowledge_map)}/(?!CONSTRAINTS/)`),
    new RegExp(`^${esc(config.current_state)}$`),
  ];
}

/**
 * Verzamelt alles wat de beoordeling nodig heeft: de PR-feiten van GitHub
 * (commits, bestanden, dossier op de kop, checks) en de rijen uit de bron.
 */
async function verzamelAttestatieFeiten(
  token: string,
  slug: string,
  nummer: number,
  feiten: PullRequestFeiten,
  config: JarvisConfig,
  bron: AttestatieBron,
): Promise<AttestatieFeiten | string> {
  const pr = await github(token, "GET", `/repos/${slug}/pulls/${nummer}`);
  if (pr.status !== 200) return `pull request niet te lezen (${foutTekst(pr)})`;
  const prLading = pr.lading as { body?: string | null; commits?: number; changed_files?: number };
  const prTekst = String(prLading.body ?? "");
  const commitsRuw = await leesAllePaginas<{ sha: string; commit: { message: string } }>(token, `/repos/${slug}/pulls/${nummer}/commits`, 10);
  if (typeof commitsRuw === "string") return commitsRuw;
  const commits = commitsRuw.map((c) => ({ sha: c.sha, boodschap: c.commit.message }));
  const bestandenRuw = await leesAllePaginas<{ filename: string }>(token, `/repos/${slug}/pulls/${nummer}/files`, 10);
  if (typeof bestandenRuw === "string") return bestandenRuw;
  const bestanden = bestandenRuw.map((f) => f.filename);
  // Het commits-eindpunt geeft hoogstens 250 commits en de lijsten kunnen
  // afwijken van wat GitHub over de PR zegt; dan is er iets ongelezen, en
  // ongelezen is ongecontroleerd (QA-bevinding 14).
  if (typeof prLading.commits === "number" && prLading.commits !== commits.length) {
    return `de pull request telt ${prLading.commits} commits maar er zijn er ${commits.length} gelezen; zo'n pull request wordt niet geattesteerd`;
  }
  if (typeof prLading.changed_files === "number" && prLading.changed_files !== bestanden.length) {
    return `de pull request telt ${prLading.changed_files} bestanden maar er zijn er ${bestanden.length} gelezen; zo'n pull request wordt niet geattesteerd`;
  }

  const { taken: taakIds, redenen: taakRedenen } = takenUitCommits(commits);
  const taken: TaakFeiten[] = [];
  for (const taak of taakIds) {
    let scopeHashKop: string | null = null;
    const dossier = await github(
      token,
      "GET",
      `/repos/${slug}/contents/${encodeURIComponent(config.taken_map)}/${encodeURIComponent(taak)}/opdracht.md?ref=${feiten.kop}`,
    );
    if (dossier.status === 200) {
      const d = dossier.lading as { content?: string; encoding?: string };
      if (d.encoding === "base64" && typeof d.content === "string") {
        scopeHashKop = scopeHash(Buffer.from(d.content, "base64").toString("utf8"));
      }
    }
    taken.push({ taak, autorisatie: await bron.taak(taak), scopeHashKop });
  }
  return {
    nummer,
    auteur: feiten.auteur,
    botLogin: config.attestatie.bot,
    uitvoerders: config.attestatie.uitvoerders,
    kop: feiten.kop,
    repo: slug,
    taken,
    taakRedenen,
    toetsing: await bron.toetsing(slug, nummer, feiten.kop),
    gewijzigdeBestanden: bestanden,
    extraPaden: config.attestatie.extra_paden,
    administratiefPaden: administratievePatronen(config),
    prTekst,
    autorisatiePr: await bron.pr(slug, nummer, feiten.kop),
    checks: feiten.checks,
    verplichteCheck: VERPLICHTE_CHECK,
  };
}

/**
 * Welke goedkeuringen van github-actions[bot] op deze PR een geldige
 * attestatie dragen. Twee lagen: de tekst moet kloppen met de rijen in de
 * eigen database (rol jarvis_werker), én de volledige beoordeling moet met
 * eigen feiten opnieuw schoon zijn. Zonder databaseverbinding is er niets te
 * verifiëren: dan telt geen enkele attestatie en blijft alleen een review van
 * de eigenaar over. Fouten worden gemeld zonder verbindingsreeks.
 */
async function geverifieerdeAttestaties(
  token: string,
  slug: string,
  feiten: PullRequestFeiten,
): Promise<{ koppen: readonly string[]; opmerkingen: readonly string[] }> {
  const kandidaten = feiten.reviews.filter(
    (r) => r.staat === "APPROVED" && r.gebruiker.toLowerCase() === ATTESTATIE_GEBRUIKER && leesAttestatie(r.tekst ?? "") !== null,
  );
  if (kandidaten.length === 0) return { koppen: [], opmerkingen: [] };
  const verbinding = await verbindDb();
  if (verbinding === null) {
    return { koppen: [], opmerkingen: [`${kandidaten.length} attestatie(s) gevonden maar geen databaseverbinding om ze te verifiëren`] };
  }
  const opmerkingen: string[] = [];
  const koppen: string[] = [];
  const config = await leesConfigVanRepo(token, slug);
  if (typeof config === "string") return { koppen, opmerkingen: [config] };
  const sql = verbinding.sql;
  try {
    const bron = sqlBron(sql);
    for (const r of kandidaten) {
      if (r.commit !== feiten.kop) {
        opmerkingen.push(`attestatie op ${r.commit.slice(0, 7)} overgeslagen: niet de huidige kop`);
        continue;
      }
      const inhoud = leesAttestatie(r.tekst ?? "")!;
      const ids = inhoud.autorisaties === "-" ? [] : inhoud.autorisaties.split("+");
      const rijen = await bron.opId(ids, inhoud.toetsing);
      const redenen = [...verifieerAttestatie(inhoud, r.commit, rijen.autorisaties, rijen.toetsing)];
      if (redenen.length === 0) {
        const f = await verzamelAttestatieFeiten(token, slug, feiten.nummer, feiten, config, bron);
        if (typeof f === "string") redenen.push(f);
        else {
          redenen.push(...beoordeelAttestatie(f));
          // De tekst moet precies zeggen wat de feiten nu ook zeggen.
          const nu = attestatieInhoud(f);
          if (nu.taken !== inhoud.taken || nu.autorisaties !== inhoud.autorisaties || nu.scope !== inhoud.scope || nu.toetsing !== inhoud.toetsing) {
            redenen.push("de attestatie noemt andere taken, autorisaties, scopes of toetsing dan de huidige feiten");
          }
        }
      }
      if (redenen.length === 0) koppen.push(r.commit);
      else opmerkingen.push(`attestatie op ${r.commit.slice(0, 7)} afgewezen: ${redenen.join("; ")}`);
    }
  } catch (fout) {
    const tekst = fout instanceof Error ? fout.message : String(fout);
    opmerkingen.push(`attestatie niet te verifiëren: ${tekst.replace(/postgres(ql)?:\/\/\S+/gi, "<verbindingsreeks>")}`);
  } finally {
    await sql.end({ timeout: 2 });
  }
  return { koppen, opmerkingen };
}

/**
 * `jarvis attestatie --pr <nummer> [--repo <slug>]`
 *
 * Draait in de workflow `jarvis-attestatie.yml` met GITHUB_TOKEN. Verzamelt
 * de feiten, leest het akkoord en de toetsing uit de eigen database via de
 * leesbeelden, en geeft bij een schone uitkomst de goedkeurende review af.
 * Elke andere uitkomst: exitcode 1 met de redenen, en niets op de PR.
 */
async function opdrachtAttestatie(vlaggen: ReadonlyMap<string, string>): Promise<number> {
  const token = (process.env.GITHUB_TOKEN ?? "").trim();
  if (!token) {
    console.error("jarvis attestatie: geen GITHUB_TOKEN; deze opdracht draait alleen in de attestatieworkflow.");
    return 1;
  }
  const nummer = Number.parseInt(vlaggen.get("pr") ?? "", 10);
  if (!Number.isInteger(nummer) || nummer <= 0) {
    console.error("jarvis attestatie: --pr <nummer> is verplicht.");
    return 2;
  }
  const wortel = (await vindWortel(process.cwd())) ?? process.cwd();
  const slug = vlaggen.get("repo") || (process.env.GITHUB_REPOSITORY ?? "").trim() || (await slugUitOrigin(wortel));
  if (!slug) {
    console.error("jarvis attestatie: geen repository bekend; geef --repo <eigenaar/naam>.");
    return 1;
  }
  // De configuratie van de uitgecheckte main, niet van de PR.
  const configResultaat = await laadConfig(wortel);
  if (!configResultaat.ok) {
    for (const f of configResultaat.fouten) console.error(`jarvis attestatie: ${f}`);
    return 1;
  }
  const config = configResultaat.config;
  const bron = config.attestatie;
  if (!bron.url || !bron.sleutel || !bron.bot) {
    console.error("jarvis attestatie: jarvis.config.yml mist attestatie.url, attestatie.sleutel of attestatie.bot; zonder bron geen attestatie.");
    return 1;
  }

  const feiten = await leesPullRequest(token, slug, nummer);
  if (typeof feiten === "string") {
    console.error(`jarvis attestatie: ${feiten}`);
    return 1;
  }
  let f: AttestatieFeiten | string;
  try {
    f = await verzamelAttestatieFeiten(token, slug, nummer, feiten, config, restBron(bron.url, bron.sleutel));
  } catch (fout) {
    f = fout instanceof Error ? fout.message : String(fout);
  }
  if (typeof f === "string") {
    console.error(`jarvis attestatie: ${f}`);
    return 1;
  }
  const uitkomst = beoordeelAttestatie(f);
  if (uitkomst.length > 0) {
    for (const r of uitkomst) console.error(`jarvis attestatie: ${r}`);
    console.error(`jarvis attestatie: #${nummer} op ${feiten.kop.slice(0, 7)} niet geattesteerd.`);
    return 1;
  }
  const tekst = attestatieTekst(attestatieInhoud(f));
  const alBestaand = feiten.reviews.some(
    (r) => r.staat === "APPROVED" && r.gebruiker.toLowerCase() === ATTESTATIE_GEBRUIKER && r.commit === feiten.kop && r.tekst === tekst,
  );
  if (alBestaand) {
    console.log(`jarvis attestatie: #${nummer} is op ${feiten.kop.slice(0, 7)} al geattesteerd; niets te doen.`);
    return 0;
  }
  const review = await github(token, "POST", `/repos/${slug}/pulls/${nummer}/reviews`, {
    commit_id: feiten.kop,
    event: "APPROVE",
    body: tekst,
  });
  if (review.status !== 200) {
    console.error(`jarvis attestatie: review afgeven mislukt (${foutTekst(review)})`);
    return 1;
  }
  console.log(`jarvis attestatie: #${nummer} geattesteerd op ${feiten.kop.slice(0, 7)}: ${tekst}`);
  return 0;
}

export async function voerUit(argv: readonly string[]): Promise<number> {
  const { opdracht, vlaggen, losse, dubbel } = leesArgumenten(argv);
  if (dubbel.length > 0) {
    // Voor elke opdracht, niet alleen voor lint. Een dubbele vlag is altijd een
    // vergissing of een poging; in geen van beide gevallen hoort de CLI te raden
    // welke van de twee bedoeld was.
    throw new AfbrekenFout(
      2,
      dubbel
        .map((naam) => `jarvis: de vlag --${naam} is meer dan een keer meegegeven. Geef hem precies een keer.`)
        .join("\n"),
    );
  }
  let code = 0;
  switch (opdracht) {
    case "index":
      code = await opdrachtIndex(vlaggen.has("schrijf"));
      break;
    case "lint":
      code = await opdrachtLint(vlaggen);
      break;
    case "poort":
      code = await opdrachtPoort();
      break;
    case "overzicht":
      code = await opdrachtOverzicht(vlaggen);
      break;
    case "regie":
      code = await opdrachtRegie(vlaggen);
      break;
    case "werk":
      code = await opdrachtWerk(losse, vlaggen);
      break;
    case "rollen":
      code = await opdrachtRollen(vlaggen);
      break;
    case "context":
      code = await opdrachtContext(vlaggen);
      break;
    case "state":
      code = await opdrachtState(vlaggen);
      break;
    case "audit":
      code = await opdrachtAudit(losse, vlaggen);
      break;
    case "sanitize":
      code = await opdrachtSanitize(vlaggen);
      break;
    case "plan":
      code = await opdrachtPlan(losse);
      break;
    case "pr":
      code = await opdrachtPr(losse, vlaggen);
      break;
    case "db":
      code = await opdrachtDb(losse, vlaggen);
      break;
    case "attestatie":
      code = await opdrachtAttestatie(vlaggen);
      break;
    case "help":
    case "--help":
    case "-h":
      code = help();
      break;
    default:
      console.error(`jarvis: onbekende opdracht "${opdracht}".`);
      code = help() === 0 ? 2 : 2;
  }
  return code;
}

