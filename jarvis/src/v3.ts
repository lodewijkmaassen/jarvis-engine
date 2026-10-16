// Jarvis V3 — de pure kant: het mandaat tegen een pull request, de
// migratieroute en de dispatcher. Geen I/O; de CLI (v3-cli.ts) leest en schrijft.
//
// Eén beginsel: wat Jarvis binnen een door de eigenaar getekend mandaat doet,
// vraagt geen nieuwe toestemming; wat erbuiten valt, komt er niet door. De
// grens is machinaal en staat hier, in code die op `main` van de engine
// staat en door een pull request niet zelf aan te passen is (de poort draait
// altijd de versie van `main`).
import { HARDE_UITZONDERINGEN } from "./attestatie";

export type Meting =
  | { readonly soort: "http"; readonly url: string; readonly bevat?: string; readonly bouwmerk?: boolean }
  | { readonly soort: "ci"; readonly check: string }
  | { readonly soort: "sql"; readonly vraag: string; readonly verwacht: unknown };

export type Criterium = { readonly id: string; readonly omschrijving: string; readonly meting: Meting };

export type Mandaat = {
  readonly taak_id?: string;
  readonly doel: string;
  readonly acceptatie: readonly Criterium[];
  readonly repos: readonly string[];
  readonly paden_ja: readonly string[];
  readonly paden_nee: readonly string[];
  readonly productie: boolean;
  readonly migraties: boolean;
  readonly destructief: boolean;
  readonly kosten_max_eur: number;
};

/** Eén padsegment tegen een patroon met `*` (alles binnen het segment); lineair-kwadratisch, zonder regex. */
function segmentMatcht(patroon: string, tekst: string): boolean {
  let rij: boolean[] = new Array<boolean>(tekst.length + 1).fill(false);
  rij[0] = true;
  for (let p = 0; p < patroon.length; p += 1) {
    const volgende: boolean[] = new Array<boolean>(tekst.length + 1).fill(false);
    if (patroon[p] === "*") {
      let ooit = false;
      for (let t = 0; t <= tekst.length; t += 1) {
        ooit = ooit || rij[t]!;
        volgende[t] = ooit;
      }
    } else {
      for (let t = 1; t <= tekst.length; t += 1) volgende[t] = rij[t - 1]! && patroon[p] === tekst[t - 1];
    }
    rij = volgende;
  }
  return rij[tekst.length]!;
}

/**
 * `**` als los segment = nul of meer mappen; `*` in een segment = alles binnen dat segment.
 * Een nieuwe regel of een ander vreemd teken in een bestandsnaam is gewoon een teken.
 * Bewust géén regex: een patroon uit een mandaat mag nooit een catastrofale terugloop kunnen veroorzaken.
 */
export function padMatchtGlob(pad: string, glob: string): boolean {
  const ps = glob.split("/");
  const ts = pad.split("/");
  const memo = new Map<number, boolean>();
  const rec = (i: number, j: number): boolean => {
    const sleutel = i * (ts.length + 1) + j;
    const bekend = memo.get(sleutel);
    if (bekend !== undefined) return bekend;
    let uit: boolean;
    if (i === ps.length) uit = j === ts.length;
    else if (ps[i] === "**") uit = rec(i + 1, j) || (j < ts.length && rec(i, j + 1));
    else uit = j < ts.length && segmentMatcht(ps[i]!, ts[j]!) && rec(i + 1, j + 1);
    memo.set(sleutel, uit);
    return uit;
  };
  return rec(0, 0);
}

export function padMatcht(pad: string, globs: readonly string[]): boolean {
  const p = pad.replace(/\\/g, "/").replace(/^\.\//, "");
  return globs.some((g) => padMatchtGlob(p, g));
}

/**
 * Alle paden die een bestandswijziging van GitHub raakt: het nieuwe pad én, bij een
 * hernoeming of kopie, het oude. `/pulls/{n}/files` geeft bij `renamed` alleen het
 * nieuwe pad in `filename`; het oude staat in `previous_filename`. Wie alleen
 * `filename` toetst, laat een bestand uit een beschermd pad naar elders verplaatsen.
 */
export function geraaktePaden(bestanden: readonly { readonly filename: string; readonly previous_filename?: string | null }[]): readonly string[] {
  const alle = new Set<string>();
  for (const b of bestanden) {
    alle.add(b.filename);
    if (typeof b.previous_filename === "string" && b.previous_filename.length > 0) alle.add(b.previous_filename);
  }
  return [...alle];
}

/** Pad waarvan het patroon een migratiebestand van het product is. */
export const MIGRATIE_PAD = /(^|\/)migrations\/[^/]+\.sql$/;

/**
 * De harde uitzonderingen die ook een mandaat nooit opheft; migraties niet, die hangen aan `mandaat.migraties`.
 * Daarbovenop de code en configuratie van de poort zelf. De sweep draait de gepinde engine uit
 * `node_modules`; wie `package.json`, het lockfile of `.npmrc` kan wijzigen, kan die poortcode
 * vervangen en zou zich dus zelf kunnen goedkeuren. Een wijziging daarvan vraagt altijd de
 * eigenaar, buiten het V3-mandaat om.
 */
export const V3_ONOPHEFBAAR: readonly { readonly patroon: RegExp; readonly waarom: string }[] = [
  ...HARDE_UITZONDERINGEN.filter((h) => !/migrations/.test(h.patroon.source)),
  { patroon: /(^|\/)jarvis\.config\.yml$/i, waarom: "governanceconfiguratie, waar ook in de boom" },
  { patroon: /^jarvis\/(src|edge|migrations|canonical|roles)\//, waarom: "de poortcode, de Edge Function en de V3-database zelf" },
  { patroon: /(^|\/)package(-lock)?\.json$/, waarom: "de pin van de poortcode (jarvis-engine) en alle afhankelijkheden" },
  { patroon: /(^|\/)\.npmrc$/, waarom: "npm-configuratie (bron van pakketten)" },
  { patroon: /(^|\/)npm-shrinkwrap\.json$/, waarom: "de pin van de poortcode" },
];

export type MigratieOordeel = { readonly pad: string; readonly redenen: readonly string[] };

/**
 * Maakt van SQL de tekst waar een oordeel op kan: commentaar weg, tekstwaarden
 * blank, dollar-gequote blokken blijven staan als CODE (een DO-blok of
 * functiebody wordt immers uitgevoerd), aangehaalde namen worden gewone
 * namen. Een scanner en geen reeks regexen: een `--` binnen een tekstwaarde
 * is geen commentaar, en `/*` binnen een tekstwaarde is geen begin ervan.
 */
export function sqlTokens(sql: string, alleenBovenste = false): string {
  let uit = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    const d = sql[i + 1];
    if (c === "-" && d === "-") {
      while (i < n && sql[i] !== "\n") i += 1;
      uit += " ";
    } else if (c === "/" && d === "*") {
      let diepte = 1;
      i += 2;
      while (i < n && diepte > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { diepte += 1; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { diepte -= 1; i += 2; }
        else i += 1;
      }
      uit += " ";
    } else if (c === "'" || ((c === "E" || c === "e") && d === "'")) {
      const escapes = c !== "'";
      i += escapes ? 2 : 1;
      while (i < n) {
        if (escapes && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i += 1;
          break;
        }
        i += 1;
      }
      uit += " '' ";
    } else if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80));
      if (m) {
        // Dollar-quote: de inhoud blijft staan als code, de markeringen verdwijnen.
        const eind = sql.indexOf(m[0], i + m[0].length);
        uit += " ";
        i += m[0].length;
        if (eind === -1) continue;
        // `alleenBovenste`: de body blijft buiten beeld (voor het splitsen in statements en voor
        // wat nú wordt uitgevoerd); anders blijft hij als code staan.
        uit += alleenBovenste ? " $body$ " : sqlTokens(sql.slice(i, eind));
        uit += " ";
        i = eind + m[0].length;
      } else {
        uit += c;
        i += 1;
      }
    } else if (c === '"') {
      i += 1;
      let naam = "";
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { naam += '"'; i += 2; continue; }
          i += 1;
          break;
        }
        naam += sql[i];
        i += 1;
      }
      uit += ` ${naam} `;
    } else {
      uit += c;
      i += 1;
    }
  }
  return uit.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Een migratie die zelf `begin; … commit;` om haar inhoud zet, wordt zonder die omhulling toegepast:
 * de migratieroute zet haar zelf in één transactie, en een eigen `commit;` zou die transactie vroegtijdig
 * afsluiten en een halve toestand achterlaten. Alleen als BEIDE er staan, en alleen aan de uiterste randen.
 */
export function normaliseerMigratie(sql: string): string {
  const begin = /^(\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*begin\s*;/i;
  const commit = /\bcommit\s*;\s*(?:--[^\n]*)?\s*$/i;
  if (!begin.test(sql) || !commit.test(sql)) return sql;
  return sql.replace(begin, " ").replace(commit, " ");
}

/** Afgewezen in iedere migratie, ook met `destructief: true`: dit raakt de beveiliging zelf. Toegepast op de SQL inclusief dollar-gequote bodies. */
const MIGRATIE_ALTIJD_VERBODEN: readonly [RegExp, string][] = [
  [/\b(jarvis|auth|vault|extensions|storage|pg_catalog|information_schema|pg_temp)\s*\./, "verwijst naar een beschermd schema (jarvis, auth, vault, pg_catalog, …)"],
  [/\bexecute\b(?!\s+(on|function|procedure)\b)/, "dynamische SQL (EXECUTE)"],
  [/\bcopy\b/, "COPY"],
  [/\balter\s+(system|database|role|user|group|default\s+privileges)\b/, "ALTER SYSTEM, DATABASE, ROLE of DEFAULT PRIVILEGES"],
  [/\bcreate\s+(role|user|group|extension|event\s+trigger|server|foreign|publication|subscription|language|operator|cast|rule|database|schema)\b/, "CREATE ROLE, EXTENSION, SCHEMA of vergelijkbaar"],
  [/\b(set|reset)\s+(local\s+|session\s+)?(role|session\s+authorization|session_replication_role)\b/, "rol wisselen"],
  [/\bsession_replication_role\b/, "triggers uitzetten via session_replication_role"],
  [/\bdisable\b/, "DISABLE (triggers of beveiliging uitzetten)"],
  [/\b(lo_import|lo_export|pg_read_file|pg_ls_dir|pg_read_binary_file|dblink|pg_terminate_backend|pg_cancel_backend|set_config)\b/, "bestands-, netwerk- of sessiefuncties"],
];

/** Afgewezen op het BOVENSTE niveau (wat nu wordt uitgevoerd): eigen transactiebesturing. Een plpgsql-`begin` in een body telt niet. */
const MIGRATIE_TRANSACTIE: readonly [RegExp, string][] = [
  [/\b(begin|commit|rollback|savepoint|release|abort|prepare\s+transaction|start\s+transaction)\b/, "eigen transactiebesturing"],
];

/** Alleen met `destructief: true` toegestaan, op het bovenste niveau: onomkeerbaar of toegangsrechten. Function-bodies worden niet nu uitgevoerd en tellen hier niet. */
const MIGRATIE_DESTRUCTIEF: readonly [RegExp, string][] = [
  [/\bdrop\b/, "DROP"],
  [/\btruncate\b/, "TRUNCATE"],
  [/\bdelete\b/, "DELETE"],
  [/\bupdate\b/, "UPDATE"],
  [/\balter\b[^;]*\b(drop|rename|owner|type|force|enable\s+(trigger|rule|replica|always))\b/, "ALTER dat laat vallen, hernoemt, van eigenaar of type verandert, of triggers aanzet"],
  [/\bcreate\s+or\s+replace\b/, "CREATE OR REPLACE (overschrijft bestaand gedrag)"],
  [/\b(policy|grant|revoke)\b/, "POLICY, GRANT of REVOKE (toegangsrechten)"],
  [/\bsecurity\s+definer\b/, "SECURITY DEFINER"],
  [/\bdo\b/, "een DO-blok"],
  [/\bon\s+conflict\b/, "INSERT … ON CONFLICT (kan bestaande rijen overschrijven)"],
  [/\b(vacuum|reindex|cluster|refresh\s+materialized)\b/, "onderhoudsopdracht"],
];

/**
 * Additieve statements die zonder `destructief` mogen. Elk statement MOET met
 * een van deze beginnen; wat hier niet in staat, is niet additief genoeg om
 * zonder oordeel van de eigenaar te draaien.
 */
const MIGRATIE_TOEGESTAAN: readonly RegExp[] = [
  /^create (unlogged )?table\b/,
  /^create (unique )?index\b/,
  /^create type\b/,
  /^create sequence\b/,
  /^create (temp(orary)? )?view\b/,
  /^create (constraint )?trigger\b/,
  /^create function\b/,
  /^alter table\b[^;]*\badd\b/,
  /^alter table\b[^;]*\benable row level security$/,
  /^insert into\b/,
  /^comment on\b/,
  // Onschadelijke extensies uit een vaste lijst; alles anders valt onder MIGRATIE_ALTIJD_VERBODEN.
  /^create extension (if not exists )?"?(pgcrypto|uuid-ossp|pg_trgm|citext|unaccent|btree_gist|btree_gin)"?( with schema \w+)?$/,
];

/** De bekende, onschadelijke aanroepen van de aanmeldlaag die in beleidsregels staan; ze zijn geen verwijzing naar het schema zelf. */
const TOEGESTANE_AANROEPEN = /\bauth\s*\.\s*(uid|jwt|role|email)\s*\(\s*\)/g;

/**
 * Oordeel over de SQL van één migratie, na normaliseerMigratie. Zonder `destructief` moet elk statement
 * additief zijn én mag geen enkel verboden element voorkomen; met `destructief` blijft MIGRATIE_ALTIJD_VERBODEN gelden.
 */
export function beoordeelSql(invoer: string, destructief: boolean): readonly string[] {
  const sql = normaliseerMigratie(invoer);
  const alles = sqlTokens(sql).replace(TOEGESTANE_AANROEPEN, " auth_aanroep ");
  const boven = sqlTokens(sql, true);
  const redenen: string[] = [];
  for (const [r, naam] of MIGRATIE_ALTIJD_VERBODEN) {
    // Een toegestane extensie is een uitzondering op het CREATE-verbod; alle statements worden hieronder nog gewhitelist.
    if (r.test(naam === "CREATE ROLE, EXTENSION, SCHEMA of vergelijkbaar" ? alles.replace(/create extension (if not exists )?"?(pgcrypto|uuid-ossp|pg_trgm|citext|unaccent|btree_gist|btree_gin)"?( with schema \w+)?/g, " ") : alles)) redenen.push(naam);
  }
  for (const [r, naam] of MIGRATIE_TRANSACTIE) if (r.test(boven)) redenen.push(naam);
  if (!destructief) {
    for (const [r, naam] of MIGRATIE_DESTRUCTIEF) if (r.test(boven)) redenen.push(`${naam} vraagt destructief: true in het mandaat`);
    const statements = boven.split(";").map((x) => x.trim()).filter((x) => x.length > 0);
    for (const st of statements) {
      if (!MIGRATIE_TOEGESTAAN.some((r) => r.test(st))) {
        redenen.push(`statement valt buiten de additieve whitelist: "${st.slice(0, 60)}"`);
        break;
      }
    }
  }
  return [...new Set(redenen)];
}

/** Gehandhaafd als dunne laag voor oudere aanroepers en tests. */
export function destructieveSql(sql: string): readonly string[] {
  return beoordeelSql(sql, false);
}

export function beoordeelMigraties(m: Mandaat, bestanden: readonly { readonly pad: string; readonly sql: string | null }[]): readonly MigratieOordeel[] {
  const uit: MigratieOordeel[] = [];
  for (const b of bestanden) {
    if (!MIGRATIE_PAD.test(b.pad.replace(/\\/g, "/"))) continue;
    const redenen: string[] = [];
    if (!m.migraties) redenen.push("het mandaat staat geen migraties toe (migraties: false)");
    if (b.sql === null) redenen.push("de inhoud van de migratie is niet te lezen");
    else redenen.push(...beoordeelSql(b.sql, m.destructief).map((r) => `migratie: ${r}`));
    if (redenen.length > 0) uit.push({ pad: b.pad, redenen });
  }
  return uit;
}

export type V3PrFeiten = {
  readonly repo: string;
  readonly nummer: number;
  readonly kop: string;
  readonly auteur: string;
  readonly botLogin: string;
  readonly taken: readonly string[];
  readonly taakRedenen: readonly string[];
  /** Alle geraakte paden, inclusief het oude pad bij hernoemen of kopiëren (zie geraaktePaden). */
  readonly bestanden: readonly string[];
  /** Projectspecifieke harde paden uit jarvis.config.yml (attestatie.extra_paden), van main. */
  readonly extraPaden?: readonly string[];
  readonly migratieBestanden: readonly { readonly pad: string; readonly sql: string | null }[];
  readonly mandaat: Mandaat | null;
  readonly taakToestand: string | null;
  readonly toetsingGoOpKop: boolean;
  readonly poortGroen: boolean;
  readonly prTekst: string;
};

/**
 * Waarom deze PR niet door het mandaat gedekt wordt. Leeg = de poort mag
 * goedkeuren (en, bij `productie`, samenvoegen).
 */
export function beoordeelV3Pr(f: V3PrFeiten): readonly string[] {
  const r: string[] = [];
  if (f.auteur.toLowerCase() !== f.botLogin.toLowerCase()) r.push(`de auteur is ${f.auteur}, niet de bot ${f.botLogin}`);
  r.push(...f.taakRedenen);
  if (f.taken.length !== 1) r.push(`een V3-pull request dient precies één taak (gevonden: ${f.taken.length})`);
  const taak = f.taken[0];
  if (taak !== undefined && !/^V3-\d{8}-[a-z0-9-]{2,40}$/.test(taak)) r.push(`${taak} is geen V3-taak`);
  if (f.mandaat === null) {
    r.push("geen mandaat voor deze taak");
    return r;
  }
  const m = f.mandaat;
  if (f.taakToestand !== null && !["UITVOEREN", "CONTROLE"].includes(f.taakToestand)) {
    r.push(`de taak staat in ${f.taakToestand}; alleen UITVOEREN of CONTROLE dekt een pull request`);
  }
  if (!m.repos.map((x) => x.toLowerCase()).includes(f.repo.toLowerCase())) r.push(`repo ${f.repo} valt buiten het mandaat`);
  if (f.bestanden.length === 0) r.push("de pull request wijzigt geen bestanden");

  for (const b of f.bestanden) {
    const pad = b.replace(/\\/g, "/");
    const onoverkomelijk = V3_ONOPHEFBAAR.find((h) => h.patroon.test(pad));
    if (onoverkomelijk) {
      r.push(`${pad} raakt de veiligheidsgrens (${onoverkomelijk.waarom}); geen mandaat dekt dat`);
      continue;
    }
    // Projectpaden uit de configuratie van main. Een migratie valt hier buiten: die hangt aan het
    // migratievlak van het mandaat (migraties/destructief) en wordt hieronder en in beoordeelMigraties getoetst.
    if (!MIGRATIE_PAD.test(pad)) {
      const extra = (f.extraPaden ?? []).find((e) => pad === e || pad.startsWith(e.endsWith("/") ? e : `${e}/`));
      if (extra !== undefined) {
        r.push(`${pad} raakt een projectregel (${extra}); geen mandaat dekt dat`);
        continue;
      }
    }
    if (padMatcht(pad, m.paden_nee)) {
      r.push(`${pad} staat in paden_nee van het mandaat`);
      continue;
    }
    if (MIGRATIE_PAD.test(pad)) {
      // Migraties vallen onder paden_ja én onder het migratievlak van het mandaat.
      if (!padMatcht(pad, m.paden_ja)) r.push(`${pad} valt buiten paden_ja`);
      continue;
    }
    if (!padMatcht(pad, m.paden_ja)) r.push(`${pad} valt buiten paden_ja van het mandaat`);
  }
  for (const o of beoordeelMigraties(m, f.migratieBestanden)) r.push(`migratie ${o.pad}: ${o.redenen.join("; ")}`);
  if (f.bestanden.some((b) => MIGRATIE_PAD.test(b.replace(/\\/g, "/"))) && f.migratieBestanden.length === 0) {
    r.push("een migratie is gewijzigd maar de inhoud is niet aangeleverd om te toetsen");
  }
  if (!f.toetsingGoOpKop) r.push(`geen onafhankelijke toetsing GO op de kop ${f.kop.slice(0, 7)}`);
  if (!f.poortGroen) r.push('de check "poort" is niet groen op de kop');
  return r;
}

/** Mag de poort na goedkeuring ook samenvoegen en uitrollen zonder verder akkoord? */
export function magUitrollen(m: Mandaat, bestanden: readonly string[]): { readonly samenvoegen: boolean; readonly reden: string } {
  if (!m.productie) return { samenvoegen: false, reden: "het mandaat heeft productie: false; de poort keurt goed, de eigenaar voegt niet automatisch samen" };
  void bestanden;
  return { samenvoegen: true, reden: "productie: true — samenvoegen en uitrollen vallen binnen het mandaat" };
}

// --------------------------------------------------------------- dispatcher

export type WerkRij = { readonly taak_id: string; readonly toestand: string; readonly reden: string };

/**
 * Moet de routine nu gestart worden? Alleen als er uitvoerbaar werk zonder
 * levende uitvoerder is, en de vorige start langer dan `rustMinuten` geleden
 * is (anders start elke cron-tik een tweede sessie bovenop een opstartende).
 */
export function dispatchBesluit(
  werk: readonly WerkRij[],
  laatsteStartIso: string | null,
  nu: Date,
  rustMinuten = 20,
): { readonly start: boolean; readonly reden: string } {
  const wacht = werk.filter((w) => w.reden.startsWith("uitvoerbaar"));
  if (wacht.length === 0) return { start: false, reden: "geen uitvoerbaar werk zonder uitvoerder" };
  if (laatsteStartIso !== null) {
    const min = (nu.getTime() - new Date(laatsteStartIso).getTime()) / 60_000;
    if (Number.isFinite(min) && min < rustMinuten) return { start: false, reden: `vorige start was ${Math.round(min)} min geleden (rust ${rustMinuten})` };
  }
  return { start: true, reden: `${wacht.length} taak/taken zonder uitvoerder: ${wacht.map((w) => w.taak_id).join(", ")}` };
}

/** Eindcontrole: de HTTP-meting van één criterium, puur beoordeeld. */
export function beoordeelHttpMeting(
  meting: Extract<Meting, { soort: "http" }>,
  antwoord: { readonly status: number; readonly tekst: string },
  verwachtBouwmerk: string | null,
): { readonly geslaagd: boolean; readonly bewijs: string } {
  if (antwoord.status !== 200) return { geslaagd: false, bewijs: `HTTP ${antwoord.status}` };
  if (meting.bevat !== undefined && !antwoord.tekst.includes(meting.bevat)) return { geslaagd: false, bewijs: `HTTP 200 maar de tekst "${meting.bevat}" ontbreekt` };
  if (meting.bouwmerk) {
    const m = /<meta\b[^>]*\bname\s*=\s*["']?jarvis-bouwmerk["']?[^>]*\bcontent\s*=\s*["']?([0-9a-f]{7,40})/i.exec(antwoord.tekst)
      ?? /<meta\b[^>]*\bcontent\s*=\s*["']?([0-9a-f]{7,40})["']?[^>]*\bname\s*=\s*["']?jarvis-bouwmerk/i.exec(antwoord.tekst);
    const gevonden = m?.[1] ?? null;
    if (gevonden === null) return { geslaagd: false, bewijs: "HTTP 200 maar geen jarvis-bouwmerk in de pagina" };
    if (verwachtBouwmerk === null || !(verwachtBouwmerk.startsWith(gevonden) || gevonden.startsWith(verwachtBouwmerk))) {
      return { geslaagd: false, bewijs: `bouwmerk ${gevonden} komt niet overeen met de uitgerolde commit ${verwachtBouwmerk ?? "?"}` };
    }
    return { geslaagd: true, bewijs: `HTTP 200, bouwmerk ${gevonden} = uitgerolde commit` };
  }
  return { geslaagd: true, bewijs: `HTTP 200${meting.bevat !== undefined ? `, bevat "${meting.bevat}"` : ""}` };
}
