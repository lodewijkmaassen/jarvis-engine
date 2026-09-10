// De Jarvis-CLI: het enige uitvoerbare oppervlak van de engine.
//
// Alles hieronder is een dunne schil. De logica zit in de modules ernaast en
// is puur; hier gebeuren de drie dingen die niet puur kunnen zijn: argumenten
// lezen, de schijf aanraken en git bevragen.
//
// Gebruik: npx tsx jarvis/src/cli.ts <opdracht> [opties]
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { bouwContextPakket, rendereerPakket } from "./context";
import { laadConfig, vindWortel, type JarvisConfig, type TaakKlasse } from "./config";
import { formatteerLint, lint } from "./lint";
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

const uitvoeren = promisify(execFile);

type Argumenten = {
  readonly opdracht: string;
  readonly vlaggen: ReadonlyMap<string, string>;
  readonly losse: readonly string[];
};

function leesArgumenten(argv: readonly string[]): Argumenten {
  const [opdracht = "help", ...rest] = argv;
  const vlaggen = new Map<string, string>();
  const losse: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      losse.push(arg);
      continue;
    }
    const naam = arg.slice(2);
    const volgende = rest[i + 1];
    if (volgende === undefined || volgende.startsWith("--")) {
      vlaggen.set(naam, "true");
      continue;
    }
    vlaggen.set(naam, volgende);
    i += 1;
  }
  return { opdracht, vlaggen, losse };
}

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

async function laadAlles(): Promise<{
  readonly wortel: string;
  readonly config: JarvisConfig;
  readonly lading: KennisLading;
}> {
  const wortel = await vindWortel(process.cwd());
  if (!wortel) {
    console.error("jarvis: geen jarvis.config.yml gevonden vanaf de huidige map.");
    process.exit(2);
  }
  const configResultaat = await laadConfig(wortel);
  if (!configResultaat.ok) {
    for (const fout of configResultaat.fouten) console.error(`jarvis: ${fout}`);
    process.exit(2);
  }
  const config = configResultaat.config;
  if (!config.enabled) {
    console.error("jarvis: uitgeschakeld via `enabled: false` in jarvis.config.yml. Geen enkele opdracht draait.");
    process.exit(3);
  }
  const lading = await laadKennis(wortel, config.knowledge_map);
  return { wortel, config, lading };
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

async function opdrachtLint(vlaggen: ReadonlyMap<string, string>): Promise<number> {
  const { wortel, config, lading } = await laadAlles();
  const basis = vlaggen.get("basis") ?? "origin/main";
  const bestanden = await gewijzigdeBestanden(wortel, basis);

  let tekst = vlaggen.get("tekst") ?? "";
  const tekstBestand = vlaggen.get("tekst-bestand");
  if (tekstBestand) {
    try {
      tekst = `${tekst}\n${await readFile(path.resolve(wortel, tekstBestand), "utf8")}`;
    } catch {
      console.error(`jarvis lint: kon ${tekstBestand} niet lezen.`);
    }
  }

  const acks = [...tekst.matchAll(/Constraint-ack:\s*(CON-\d{4})/gi)].map((m) => m[1]);
  const statusImpact = /Current-State-Impact:\s*(none|geen)/i.test(tekst);
  const nieuweDecs = bestanden.filter((b) => /knowledge\/DEC\/DEC-\d{4}\.md$/.test(b)).length;

  const statusCommits = await git(wortel, [
    "rev-list",
    "--count",
    `${basis}..HEAD`,
    "--",
    ...config.status_paden,
  ]);

  const resultaat = lint({
    config,
    lading,
    gewijzigdeBestanden: bestanden,
    tekstCorpus: tekst,
    acks,
    statusCommitsSinds: Number.parseInt(statusCommits || "0", 10) || 0,
    statusImpactVerklaard: statusImpact,
    nieuweDecs,
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
  const migraties = await git(wortel, ["ls-files", "supabase/migrations"]);
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
  return rapport.bevindingen.some((b) => b.severity === "fout") ? 1 : 0;
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
      "  lint     [--basis <ref>] [--tekst <s>] [--tekst-bestand <pad>]",
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

async function hoofd(): Promise<void> {
  const { opdracht, vlaggen, losse } = leesArgumenten(process.argv.slice(2));
  let code = 0;
  switch (opdracht) {
    case "index":
      code = await opdrachtIndex(vlaggen.has("schrijf"));
      break;
    case "lint":
      code = await opdrachtLint(vlaggen);
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
  process.exit(code);
}

void hoofd();
