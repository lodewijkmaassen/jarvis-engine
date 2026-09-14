// De kennisopslag: markdownbestanden in knowledge/ -> gevalideerde records.
//
// Waarom markdown en niet JSON/YAML-only: een kennisrecord moet door een mens
// in een pull request te beoordelen zijn. Korte, gestructureerde velden staan
// daarom in de front-matter; de langere teksten staan als gewone markdown-
// secties in de body, met de kop als veldnaam. Dat leest als een document en
// laadt als data.
//
// Voorbeeld (een DEC-record in de kennismap):
//
//   ---
//   id: DEC-0018
//   type: DEC
//   titel: Berichtsjablonen per klant in de configuratie
//   samenvatting: De koppeling naam -> sjabloon staat per klant in de config.
//   datum: 2026-08-30
//   status: besloten
//   onderwerp: berichtsjabloon-resolutie
//   tags: [berichten, configuratie]
//   bronnen:
//     - docs/BESLUITEN.md
//   ---
//
//   ## Besluit
//   ...
//
//   ## Motivatie
//   ...
//
// De koppen per type staan in SECTIEVELDEN. Een onbekende kop is GEEN fout —
// die blijft gewoon leesbare toelichting — maar een ontbrekende verplichte
// kop wel, want dan mist het record inhoud waarop later wordt gestuurd.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontMatter, type FrontMatter, type FrontMatterValue } from "./frontmatter";
import {
  RECORD_TYPES,
  hoortInMap,
  validateRecordSet,
  type KnowledgeRecord,
  type RecordSetValidation,
  type RecordType,
  type ValidationIssue,
} from "./records";

/** Kop in de body -> veldnaam, en of de sectie een lijst of vrije tekst is. */
type SectieVeld = { readonly kop: string; readonly veld: string; readonly lijst: boolean };

const SECTIEVELDEN: Readonly<Record<RecordType, readonly SectieVeld[]>> = {
  DEC: [
    { kop: "besluit", veld: "besluit", lijst: false },
    { kop: "motivatie", veld: "motivatie", lijst: false },
    { kop: "alternatieven", veld: "alternatieven", lijst: true },
    { kop: "gevolgen", veld: "gevolgen", lijst: true },
  ],
  CON: [{ kop: "regel", veld: "regel", lijst: false }],
  LRN: [
    { kop: "observatie", veld: "observatie", lijst: false },
    { kop: "les", veld: "les", lijst: false },
    { kop: "bewijs", veld: "bewijs", lijst: true },
  ],
  RSK: [
    { kop: "beschrijving", veld: "beschrijving", lijst: false },
    { kop: "mitigatie", veld: "mitigatie", lijst: false },
    { kop: "opties", veld: "opties", lijst: false },
  ],
  CFL: [
    { kop: "beschrijving", veld: "beschrijving", lijst: false },
    { kop: "opties", veld: "opties", lijst: false },
  ],
};

export type GeladenRecord = {
  readonly record: KnowledgeRecord;
  /** Repo-relatief pad, met forward slashes — ook op Windows. */
  readonly bestand: string;
};

export type LaadFout = {
  readonly bestand: string;
  readonly regel: number | null;
  readonly boodschap: string;
};

export type KennisLading = {
  readonly ok: boolean;
  readonly records: readonly KnowledgeRecord[];
  /** Alleen voor records die de schemavalidatie doorstonden. */
  readonly herkomst: ReadonlyMap<string, string>;
  readonly validatie: RecordSetValidation;
  readonly laadFouten: readonly LaadFout[];
};

function normaliseerPad(p: string): string {
  return p.split(path.sep).join("/");
}

/** Splitst de body in secties op `## Kop`. Tekst vóór de eerste kop vervalt. */
function leesSecties(body: string): ReadonlyMap<string, string> {
  const secties = new Map<string, string>();
  const regels = body.replace(/\r\n/g, "\n").split("\n");
  let huidigeKop: string | null = null;
  let buffer: string[] = [];

  const sluit = () => {
    if (huidigeKop === null) return;
    secties.set(huidigeKop, buffer.join("\n").trim());
    buffer = [];
  };

  for (const regel of regels) {
    const kop = /^#{2,3}\s+(.+?)\s*$/.exec(regel);
    if (kop) {
      sluit();
      huidigeKop = kop[1].trim().toLowerCase();
      continue;
    }
    if (huidigeKop !== null) buffer.push(regel);
  }
  sluit();
  return secties;
}

/** `- item` regels uit een sectie; lege sectie levert een lege lijst. */
function leesLijst(tekst: string): readonly string[] {
  return tekst
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r.startsWith("- "))
    .map((r) => r.slice(2).trim())
    .filter((r) => r.length > 0);
}

/**
 * Bouwt het ruwe recordobject uit front-matter + secties.
 *
 * Front-matter wint nooit van een sectie en andersom: een veld hoort op
 * precies één plek te staan. Staat het op beide, dan is dat een fout, want
 * anders bepaalt de laadvolgorde stilzwijgend welke tekst geldt.
 */
function bouwRuwRecord(
  data: FrontMatter,
  secties: ReadonlyMap<string, string>,
  type: RecordType,
  bestand: string,
  fouten: LaadFout[],
): Record<string, unknown> {
  const ruw: Record<string, unknown> = {};
  for (const [sleutel, waarde] of Object.entries(data)) {
    ruw[sleutel] = waarde as FrontMatterValue;
  }
  for (const { kop, veld, lijst } of SECTIEVELDEN[type]) {
    const tekst = secties.get(kop);
    if (tekst === undefined) continue;
    if (veld in ruw) {
      fouten.push({
        bestand,
        regel: null,
        boodschap: `veld "${veld}" staat zowel in de front-matter als in sectie "## ${kop}"`,
      });
      continue;
    }
    ruw[veld] = lijst ? leesLijst(tekst) : tekst;
  }
  return ruw;
}

/** Leest één kennisbestand. Geeft `null` terug als het onbruikbaar is. */
export async function laadRecordBestand(
  absoluutPad: string,
  repoRelatiefPad: string,
  fouten: LaadFout[],
): Promise<unknown | null> {
  let inhoud: string;
  try {
    inhoud = await readFile(absoluutPad, "utf8");
  } catch {
    fouten.push({ bestand: repoRelatiefPad, regel: null, boodschap: "bestand kon niet gelezen worden" });
    return null;
  }

  const geparsed = parseFrontMatter(inhoud);
  if (!geparsed.ok) {
    for (const f of geparsed.fouten) {
      fouten.push({ bestand: repoRelatiefPad, regel: f.regel, boodschap: f.boodschap });
    }
    return null;
  }
  if (Object.keys(geparsed.data).length === 0) {
    fouten.push({ bestand: repoRelatiefPad, regel: 1, boodschap: "bestand heeft geen front-matter" });
    return null;
  }

  const type = geparsed.data.type;
  if (typeof type !== "string" || !(RECORD_TYPES as readonly string[]).includes(type)) {
    fouten.push({
      bestand: repoRelatiefPad,
      regel: null,
      boodschap: `onbekend of ontbrekend type "${String(type)}"`,
    });
    return null;
  }

  const plaats = hoortInMap(type as RecordType, String(geparsed.data.id ?? ""), repoRelatiefPad);
  if (plaats !== null) {
    fouten.push({ bestand: repoRelatiefPad, regel: null, boodschap: plaats });
    return null;
  }

  const secties = leesSecties(geparsed.body);
  return bouwRuwRecord(geparsed.data, secties, type as RecordType, repoRelatiefPad, fouten);
}

/** Alle `.md`-bestanden onder een map, gesorteerd, zonder recursie-verrassingen. */
async function verzamelBestanden(wortel: string, relatief: string): Promise<readonly string[]> {
  let inhoud;
  try {
    inhoud = await readdir(path.join(wortel, relatief), { withFileTypes: true });
  } catch {
    return [];
  }
  const gevonden: string[] = [];
  for (const item of inhoud.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const kind = `${relatief}/${item.name}`;
    if (item.isDirectory()) {
      gevonden.push(...(await verzamelBestanden(wortel, kind)));
      continue;
    }
    if (item.isFile() && item.name.endsWith(".md")) gevonden.push(kind);
  }
  return gevonden;
}

/**
 * Laadt de volledige kennisbasis.
 *
 * `ok` is alleen true als er geen laadfouten zijn EN de setvalidatie geen
 * fouten oplevert. Waarschuwingen (open conflict, vervangen-maar-actief)
 * blokkeren niet: die horen zichtbaar te blijven, niet de boel stil te zetten.
 */
export async function laadKennis(wortel: string, kennisMap = "knowledge"): Promise<KennisLading> {
  const laadFouten: LaadFout[] = [];
  const bestanden = await verzamelBestanden(wortel, kennisMap);
  const ruweRecords: unknown[] = [];
  const herkomstPerId = new Map<string, string>();

  for (const relatief of bestanden) {
    const genormaliseerd = normaliseerPad(relatief);
    const ruw = await laadRecordBestand(path.join(wortel, relatief), genormaliseerd, laadFouten);
    if (ruw === null) continue;
    ruweRecords.push(ruw);
    const id = (ruw as { id?: unknown }).id;
    if (typeof id === "string") {
      const eerder = herkomstPerId.get(id);
      if (eerder) {
        laadFouten.push({
          bestand: genormaliseerd,
          regel: null,
          boodschap: `id ${id} staat ook in ${eerder}`,
        });
      } else {
        herkomstPerId.set(id, genormaliseerd);
      }
    }
  }

  const validatie = validateRecordSet(ruweRecords);
  return {
    ok: laadFouten.length === 0 && validatie.ok,
    records: validatie.records,
    herkomst: herkomstPerId,
    validatie,
    laadFouten,
  };
}

/** Compacte, deterministische regel per bevinding — voor CLI-uitvoer. */
export function formatteerBevinding(issue: ValidationIssue, herkomst: ReadonlyMap<string, string>): string {
  const bestand = issue.recordId ? (herkomst.get(issue.recordId) ?? "(onbekend bestand)") : "(set)";
  const merk = issue.severity === "fout" ? "FOUT" : "WAARSCHUWING";
  return `${merk} ${bestand} [${issue.code}] ${issue.pad}: ${issue.boodschap}`;
}

export function formatteerLaadFout(fout: LaadFout): string {
  const plek = fout.regel === null ? fout.bestand : `${fout.bestand}:${fout.regel}`;
  return `FOUT ${plek} [laadfout]: ${fout.boodschap}`;
}
