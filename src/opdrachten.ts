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
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { bouwContextPakket, rendereerPakket } from "./context";
import { leesArgumenten } from "./args";
import { laadConfig, leesStartpuntUitConfig, vindWortel, type JarvisConfig, type TaakKlasse } from "./config";
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
import { laadKennis, type KennisLading } from "./store";
import {
  ACTIEVE_WORKFLOW,
  CANONIEKE_WORKFLOW,
  WORKFLOW_MAP,
  controleerGovernance,
  type BestandsFeiten,
} from "./workflow";

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
async function controleerWorkflow(wortel: string): Promise<number> {
  let wortelEchtPad = wortel;
  try {
    wortelEchtPad = await realpath(wortel);
  } catch {
    wortelEchtPad = wortel;
  }
  let workflowMapInhoud: readonly string[] | null = null;
  try {
    workflowMapInhoud = (await readdir(path.join(wortelEchtPad, WORKFLOW_MAP))).sort();
  } catch {
    workflowMapInhoud = null;
  }

  const redenen = controleerGovernance({
    wortelEchtPad,
    actief: await feitenOver(wortelEchtPad, ACTIEVE_WORKFLOW),
    canoniek: await feitenOver(wortelEchtPad, CANONIEKE_WORKFLOW),
    workflowMapInhoud,
  });

  if (redenen.length === 0) {
    console.log(
      `jarvis workflow: ${ACTIEVE_WORKFLOW} is byte-identiek aan ${CANONIEKE_WORKFLOW} op deze commit, ` +
        `en ${WORKFLOW_MAP} bevat geen onbekende workflows.`,
    );
    return 0;
  }
  for (const reden of redenen) console.error(`jarvis workflow: ${reden}`);
  console.error(
    `jarvis workflow: de canonieke bron is ${CANONIEKE_WORKFLOW}. Wil je de poort wijzigen, wijzig dan die ` +
      `bron en laat de wijziging door een mens beoordelen; CODEOWNERS eist dat.`,
  );
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

async function opdrachtPoort(): Promise<number> {
  const lees = (naam: string) => process.env[naam] ?? "";
  const wortel = (await vindWortel(process.cwd())) ?? process.cwd();
  return poortUitkomst(
    poortStappen(wortel, {
      basis: `origin/${lees("PR_BASIS") || "main"}`,
      tekst: `${lees("PR_TITEL")}

${lees("PR_BODY")}`,
      ackTekst: lees("REVIEW_BODY"),
      ackActor: lees("REVIEW_ACTOR"),
      ackRelatie: lees("REVIEW_RELATIE"),
    }),
  );
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
  // toetsen of elke rol binnen zijn mandaat schreef.
  const alleHashes = (await git(wortel, ["rev-list", `${basis}..HEAD`]))
    .split("\n")
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  // Een leeslimiet is nodig (elke commit kost drie git-aanroepen), maar wat
  // erbuiten valt wordt geteld en gemeld. Stil afkappen ziet eruit als een
  // volledige toets.
  const COMMIT_LEESLIMIET = 50;
  const hashes = alleHashes.slice(0, COMMIT_LEESLIMIET);
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

  const commits = [];
  for (const hash of hashes) {
    const bericht = await git(wortel, ["show", "-s", "--format=%B", hash]);
    const onderwerp = await git(wortel, ["show", "-s", "--format=%s", hash]);
    const gewijzigd = await git(wortel, ["show", "--name-only", "--format=", hash]);
    const rol = /^Jarvis-Role:\s*(\S+)\s*$/im.exec(bericht)?.[1] ?? null;
    const taak = /^Jarvis-Task:\s*(\S+)\s*$/im.exec(bericht)?.[1] ?? null;
    commits.push({
      hash: hash.slice(0, 7),
      onderwerp,
      rol,
      taak,
      bestanden: gewijzigd.split("\n").map((r) => r.trim()).filter((r) => r.length > 0),
      voorStartpunt: voorStartpunt.has(hash),
    });
  }

  const resultaat = lint({
    config,
    lading,
    gewijzigdeBestanden: bestanden,
    tekstCorpus: tekst,
    acks,
    commits,
    statusCommitsSinds: Number.parseInt(statusCommits || "0", 10) || 0,
    statusImpactVerklaard: statusImpact,
    nieuweDecs,
    rolControleVanafBasis: basisStartpunt,
    commitsAfgekapt: alleHashes.length - hashes.length,
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

async function verzamelFeiten(
  wortel: string,
  config: JarvisConfig,
  lading: KennisLading,
): Promise<StateFeiten> {
  const hoofdbranch = "main";
  const commit = await git(wortel, ["rev-parse", "--short", `origin/${hoofdbranch}`]);
  const datum = await git(wortel, ["log", "-1", "--format=%ad", "--date=short", `origin/${hoofdbranch}`]);
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
  const isTekst = (naam: string) => /\.(md|json|ya?ml|txt)$/i.test(naam);
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
      "Gebruik: npx tsx jarvis/src/cli.ts <opdracht> [opties]",
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
      "",
      "Exitcodes: 0 ok · 1 bevindingen · 2 gebruiksfout · 3 uitgeschakeld",
    ].join("\n"),
  );
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

