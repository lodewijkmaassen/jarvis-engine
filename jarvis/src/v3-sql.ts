// De SQL-poort voor migraties binnen een V3-mandaat.
//
// Doel: een migratie die een mandaat met `migraties: true` en `destructief: false`
// hoort te volgen, mag niets doen dat het mandaat niet dekt -- en nooit iets dat
// de beveiliging van Jarvis zelf raakt.
//
// WAAROM EEN LEXER EN GEEN REGEX-STRIP
//
// Een scanner die SQL anders leest dan PostgreSQL is een deur: wat hij als
// tekstwaarde ziet maar PostgreSQL als code, wordt nooit beoordeeld. De lexer
// hieronder volgt daarom de lexicale regels van PostgreSQL en faalt GESLOTEN:
// alles wat hij niet zeker kan lezen (niet afgesloten tekst, commentaar of
// quote, `U&`-escapes, een `$` in een naam, niet-ASCII buiten tekst en
// commentaar, een E-tekst als functiebody) is zelf een afwijzing. Vier
// omzeilingen uit de onafhankelijke review zijn de regressietests:
//   (a) `name'\\'` -- de `e` is het einde van een naam, geen E-prefix;
//   (b) `x$a$` -- een `$` in een naam is geen dollar-quote;
//   (c) `U&"\\006Aarvis"` -- een unicode-escape in een naam;
//   (d) een functiebody als gewone tekst (`as '...'`) of als dollar-quote met
//       DELETE/UPDATE erin: ook een body wordt beoordeeld.
// Het blijft defense-in-depth: de migratieroute weigert bovendien te draaien met
// een rol die het schema `jarvis` kan gebruiken (zie v3-cli.ts).

export type SqlLex = {
  /** Wat NU wordt uitgevoerd: commentaar weg, tekst blank, dollar-bodies blank, aangehaalde namen als gewone namen. */
  readonly boven: string;
  /** Hetzelfde, maar dollar-bodies (en `as '...'`-bodies) staan als code in de tekst. */
  readonly alles: string;
  /** De bodies van functies/DO-blokken, elk als code, voor de beoordeling van wat ze zullen doen. */
  readonly bodies: readonly string[];
  /** Alles wat de lexer niet zeker kan lezen: elke fout is een afwijzing. */
  readonly fouten: readonly string[];
};

const IDENT_START = /[A-Za-z_\u0080-￿]/;
const IDENT_CONT = /[A-Za-z0-9_\u0080-￿]/;

function schoonNaam(naam: string): string {
  return naam.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

/**
 * Een aangehaalde naam, injectief afgebeeld: een eenvoudige naam blijft zoals hij is (PostgreSQL leest `"a_b"` en `a_b`
 * als dezelfde naam); elke andere naam (hoofdletters, spaties, leestekens) krijgt de hex van de originele tekst erachter,
 * zodat `"a b"` en `a_b`, of `"FOO"` en `foo`, nooit samenvallen. Het begin blijft leesbaar voor de verbodslijsten.
 */
function aangehaaldeNaam(naam: string): string {
  if (/^[a-z_][a-z0-9_]*$/.test(naam)) return naam;
  return `${schoonNaam(naam)}_q${Buffer.from(naam, "utf8").toString("hex")}`;
}

export function lexSql(sql: string, diepte = 0): SqlLex {
  const fouten: string[] = [];
  const bodies: string[] = [];
  let boven = "";
  let alles = "";
  const n = sql.length;
  let i = 0;
  let laatsteWoord = "";
  let voorlaatsteWoord = "";
  const zetWoord = (w: string): void => {
    voorlaatsteWoord = laatsteWoord;
    laatsteWoord = w;
  };
  const wisWoorden = (): void => {
    voorlaatsteWoord = "";
    laatsteWoord = "";
  };
  // Een tekst op deze plekken is CODE: `as '<body>'`, `do '<code>'` en `do language x '<code>'`.
  const alsCode = (): boolean => laatsteWoord === "as" || laatsteWoord === "do" || voorlaatsteWoord === "language";
  const bij = (b: string, a: string = b): void => {
    boven += b;
    alles += a;
  };
  if (diepte > 8) return { boven: " ", alles: " ", bodies, fouten: ["te diep geneste dollar-quotes"] };

  while (i < n) {
    const c = sql[i]!;
    const d = sql[i + 1];
    if (c === "\0") {
      fouten.push("een NUL-teken in de SQL");
      i += 1;
    } else if (c === "-" && d === "-") {
      while (i < n && sql[i] !== "\n" && sql[i] !== "\r") i += 1;
      bij(" ");
    } else if (c === "/" && d === "*") {
      let niveau = 1;
      i += 2;
      while (i < n && niveau > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { niveau += 1; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { niveau -= 1; i += 2; }
        else i += 1;
      }
      if (niveau > 0) fouten.push("een blokcommentaar dat niet wordt afgesloten");
      bij(" ");
    } else if (IDENT_START.test(c)) {
      // Eerst het hele woord: een `e`, `u` of `$` binnen een naam is nooit het begin van iets anders.
      let j = i;
      let heeftDollar = false;
      while (j < n && (IDENT_CONT.test(sql[j]!) || sql[j] === "$")) {
        if (sql[j] === "$") heeftDollar = true;
        j += 1;
      }
      const woord = sql.slice(i, j);
      if (/[^\u0000-\u007f]/.test(woord)) fouten.push("niet-ASCII tekens in een naam");
      if (heeftDollar) fouten.push("een dollarteken binnen een naam");
      const w = woord.toLowerCase();
      const volgende = sql[j];
      if (w === "u" && volgende === "&" && (sql[j + 1] === '"' || sql[j + 1] === "'")) {
        fouten.push("een unicode-escape (U&) is niet toegestaan");
        i = j + 1; // het volgende quote-teken wordt als gewone tekst/naam gelezen zodat de lexer niet uit de pas raakt
        bij(" u_escape ");
        wisWoorden();
        continue;
      }
      i = j;
      if (volgende === "'" && (w === "e" || w === "b" || w === "x" || w === "n")) {
        // Een tekst met voorvoegsel: `E` is een escape-tekst; B, X en N zijn gewone tekst. Elk ANDER woord direct voor
        // een quote (`as'…'`, `do'…'`, `name'…'`) is gewoon een woord: de quote wordt hieronder als tekst gelezen,
        // mét de controle of die tekst code is.
        const escape = w === "e";
        const k = leesKetting(sql, j + 1, escape);
        if (k === null) {
          fouten.push("een tekst die niet wordt afgesloten");
          i = n;
        } else {
          if (alsCode()) fouten.push(escape ? "een E-tekst als functiebody of DO-code is niet toegestaan" : "een B-, X- of N-tekst als functiebody of DO-code is niet toegestaan");
          bij(w + " '' ", w + " '' ");
          i = k.eind;
        }
        zetWoord("''");
        continue;
      }
      bij(w + " ");
      zetWoord(w);
    } else if (c >= "0" && c <= "9") {
      let j = i;
      let dollar = false;
      while (j < n && /[A-Za-z0-9_.$]/.test(sql[j]!)) {
        if (sql[j] === "$") dollar = true;
        j += 1;
      }
      if (dollar) fouten.push("een dollarteken binnen een getal");
      bij(sql.slice(i, j).replace(/\$/g, "_") + " ");
      i = j;
      wisWoorden();
    } else if (c === "'") {
      let codeTekst = false;
      const k = leesKetting(sql, i + 1, false);
      if (k === null) {
        fouten.push("een tekst die niet wordt afgesloten");
        i = n;
      } else if (alsCode()) {
        // `create function … as '<body>'`, `do '<code>'`: de tekst is code en wordt beoordeeld. Aaneengeschakelde
        // stukken (een newline ertussen) vormen samen ÉÉN tekst, ook midden in een woord (`'delet'⏎'e from …'`).
        const stuk = k.stukken.map((x) => x.replace(/''/g, "'")).join("");
        const sub = lexSql(stuk, diepte + 1);
        bij(" '' ", ` '' ${sub.alles} `);
        bodies.push(sub.alles, ...sub.bodies);
        fouten.push(...sub.fouten);
        codeTekst = true;
        i = k.eind;
      } else {
        bij(" '' ");
        i = k.eind;
      }
      // Een volgende tekst direct erna (aaneengeschakelde teksten) is hetzelfde: na code blijft de context `code`.
      if (codeTekst) zetWoord("do");
      else zetWoord("''");
    } else if (c === '"') {
      let j = i + 1;
      let naam = "";
      let dicht = false;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { naam += '"'; j += 2; continue; }
          dicht = true;
          j += 1;
          break;
        }
        naam += sql[j];
        j += 1;
      }
      if (!dicht) {
        fouten.push("een aangehaalde naam die niet wordt afgesloten");
        i = n;
      } else {
        if (/[^\u0000-\u007f]/.test(naam)) fouten.push("niet-ASCII tekens in een aangehaalde naam");
        bij(` ${aangehaaldeNaam(naam)} `);
        i = j;
        zetWoord(aangehaaldeNaam(naam));
      }
      if (!dicht) wisWoorden();
    } else if (c === "$") {
      const m = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(sql.slice(i, i + 200));
      if (m) {
        const sluit = sql.indexOf(m[0], i + m[0].length);
        if (sluit === -1) {
          fouten.push("een dollar-quote die niet wordt afgesloten");
          i = n;
        } else {
          const sub = lexSql(sql.slice(i + m[0].length, sluit), diepte + 1);
          bij(" $body$ ", ` $body$ ${sub.alles} `);
          bodies.push(sub.alles, ...sub.bodies);
          fouten.push(...sub.fouten);
          i = sluit + m[0].length;
        }
        wisWoorden();
      } else {
        bij(c);
        i += 1;
      }
    } else if (c === "&" && d === "&") {
      bij("&&");
      i += 2;
    } else if (/[^\u0000-\u007f]/.test(c)) {
      fouten.push("niet-ASCII tekens buiten tekst en commentaar");
      i += 1;
    } else {
      bij(c);
      i += 1;
      if (!/\s/.test(c)) wisWoorden();
    }
  }
  const strak = (t: string): string => t.replace(/\s+/g, " ").trim();
  return { boven: strak(boven), alles: strak(alles), bodies, fouten: [...new Set(fouten)] };
}

/**
 * Staat er direct na een tekst een aaneengeschakelde tekst? PostgreSQL voegt twee teksten samen als er alleen
 * witruimte en `--`-commentaar tussen staat, mét minstens één newline. Blokcommentaar telt niet als tussenruimte
 * (PostgreSQL voegt daar niet samen); deze lezer volgt PostgreSQL hierin exact.
 */
function volgendeAaneengeschakeldeTekst(sql: string, vanaf: number, escape: boolean): { begin: number; eind: number } | null {
  let j = vanaf;
  let newline = false;
  for (;;) {
    const t = sql[j];
    if (t === " " || t === "\t" || t === "\f" || t === "\v") j += 1;
    else if (t === "\n" || t === "\r") { newline = true; j += 1; }
    else if (t === "-" && sql[j + 1] === "-") { while (j < sql.length && sql[j] !== "\n" && sql[j] !== "\r") j += 1; }
    else break;
  }
  if (!newline || sql[j] !== "'") return null;
  return { begin: j + 1, eind: leesTekst(sql, j + 1, escape) };
}

/**
 * Een tekst met al haar aaneengeschakelde vervolgstukken. Een vervolgstuk wordt gelezen in dezelfde modus als het
 * eerste: bij een E-tekst blijven backslash-escapes ook in de vervolgstukken gelden (`E'x'⏎'\''` is bij PostgreSQL
 * één tekst; wie het vervolg als gewone tekst leest, ziet een quote te vroeg en neemt code voor tekst aan).
 * Geeft null als de tekst of een vervolgstuk niet wordt afgesloten.
 */
function leesKetting(sql: string, vanaf: number, escape: boolean): { eind: number; stukken: string[] } | null {
  const eerste = leesTekst(sql, vanaf, escape);
  if (eerste === -1) return null;
  const stukken = [sql.slice(vanaf, eerste - 1)];
  let eind = eerste;
  for (;;) {
    const v = volgendeAaneengeschakeldeTekst(sql, eind, escape);
    if (v === null) break;
    if (v.eind === -1) return null;
    stukken.push(sql.slice(v.begin, v.eind - 1));
    eind = v.eind;
  }
  return { eind, stukken };
}

/** Eerste teken NA de afsluitende quote, of -1. In een E-tekst is een backslash een escape. */
function leesTekst(sql: string, vanaf: number, escape: boolean): number {
  let j = vanaf;
  while (j < sql.length) {
    const t = sql[j]!;
    if (escape && t === "\\") { j += 2; continue; }
    if (t === "'") {
      if (sql[j + 1] === "'") { j += 2; continue; }
      return j + 1;
    }
    j += 1;
  }
  return -1;
}

/** Oudere naam voor de tekst waar een oordeel op kan: de uitvoer van de lexer. */
export function sqlTokens(sql: string, alleenBovenste = false): string {
  const l = lexSql(sql);
  return (alleenBovenste ? l.boven : l.alles).toLowerCase();
}

/**
 * Een migratie die zelf `begin; … commit;` om haar inhoud zet, wordt zonder die omhulling toegepast:
 * de migratieroute zet haar zelf in één transactie, en een eigen `commit;` zou die transactie vroegtijdig
 * afsluiten en een halve toestand achterlaten. Alleen als BEIDE er staan, en alleen aan de uiterste randen.
 * De beoordeling en de uitvoering gebruiken PRECIES dezelfde uitvoer van deze functie.
 */
export function normaliseerMigratie(sql: string): string {
  const n = sql.length;
  // Begin: spaties en commentaar overslaan, dan `begin` en `;`.
  let a = 0;
  for (;;) {
    while (a < n && /\s/.test(sql[a]!)) a += 1;
    if (sql[a] === "-" && sql[a + 1] === "-") {
      while (a < n && sql[a] !== "\n") a += 1;
    } else if (sql[a] === "/" && sql[a + 1] === "*") {
      const e = sql.indexOf("*/", a + 2);
      if (e === -1) return sql;
      a = e + 2;
    } else break;
  }
  if (sql.slice(a, a + 5).toLowerCase() !== "begin") return sql;
  let b = a + 5;
  while (b < n && /\s/.test(sql[b]!)) b += 1;
  if (sql[b] !== ";") return sql;
  const start = b + 1;
  // Einde: achterwaarts spaties en regelcommentaar overslaan, dan `;` en `commit`.
  let e = n;
  for (;;) {
    while (e > start && /\s/.test(sql[e - 1]!)) e -= 1;
    const regelStart = Math.max(sql.lastIndexOf("\n", e - 1) + 1, start);
    const regel = sql.slice(regelStart, e);
    if (regel.trimStart().startsWith("--")) {
      e = regelStart;
      if (e === start) return sql;
      continue;
    }
    // `commit; -- opmerking` op één regel: alleen als wat voor het commentaar staat op `;` eindigt.
    const c2 = regel.indexOf("--");
    if (c2 >= 0 && regel.slice(0, c2).trimEnd().endsWith(";")) e = regelStart + regel.slice(0, c2).trimEnd().length;
    break;
  }
  if (sql[e - 1] !== ";") return sql;
  let c = e - 1;
  while (c > start && /\s/.test(sql[c - 1]!)) c -= 1;
  if (c - 6 < start || sql.slice(c - 6, c).toLowerCase() !== "commit") return sql;
  if (c - 7 >= start && /[A-Za-z0-9_$]/.test(sql[c - 7]!)) return sql;
  return " " + sql.slice(start, c - 6) + " ";
}

type Regel = readonly [RegExp, string];

/** Altijd verboden, ook met `destructief: true`: dit raakt de beveiliging zelf. Getoetst op de SQL inclusief bodies. Geen enkel patroon heeft `[^;]*`: lineair. */
const ALTIJD_VERBODEN: readonly Regel[] = [
  [/\bjarvis\w*\b/, "verwijst naar Jarvis zelf (schema of rol jarvis…)"],
  [/\bv3_\w+\b/, "verwijst naar een V3-object"],
  [/\b(auth|vault|extensions|storage|pg_catalog|information_schema|pg_temp)\s*\./, "verwijst naar een beschermd schema (auth, vault, pg_catalog, …)"],
  [/\b(query_to_xml\w*|cursor_to_xml\w*|table_to_xml\w*|schema_to_xml\w*|database_to_xml\w*|ts_stat)\b/, "functies die zelf SQL uitvoeren (query_to_xml, ts_stat, …)"],
  [/\bcopy\b/, "COPY"],
  [/\balter\s+(system|database|role|user|group|default\s+privileges)\b/, "ALTER SYSTEM, DATABASE, ROLE of DEFAULT PRIVILEGES"],
  [/\bcreate\s+(role|user|group|extension|event\s+trigger|server|foreign|publication|subscription|language|operator|cast|rule|database|schema|tablespace|collation|text\s+search|transform|access\s+method)\b/, "CREATE ROLE, EXTENSION, SCHEMA of vergelijkbaar"],
  [/\bset\s+schema\b/, "SET SCHEMA"],
  [/\b(set|reset)\s+(local\s+|session\s+)?(role|session\s+authorization)\b/, "rol wisselen"],
  [/\b(session_replication_role|standard_conforming_strings|backslash_quote|escape_string_warning)\b/, "sessie-instellingen die het lezen van SQL of triggers veranderen"],
  [/\bdisable\b/, "DISABLE (triggers of beveiliging uitzetten)"],
  [/\blanguage\s+(?!(sql|plpgsql)\b)/, "een andere functietaal dan sql of plpgsql"],
  [/\b(lo_\w+|setval|nextval|currval|lastval|pg_read_file|pg_ls_dir|pg_read_binary_file|dblink|pg_terminate_backend|pg_cancel_backend|set_config|pg_sleep\w*|pg_advisory\w*|pg_notify|pg_stat_reset\w*|pg_reload_conf|pg_rotate_logfile|pg_switch_wal|pg_drop_\w+|pg_create_\w+|pg_promote|pg_wal_replay\w*|pg_truncate\w*|pg_import\w*|pg_export\w*)\b/, "bestands-, netwerk-, sessie-, large-object- of sequentiefuncties"],
];

/** Per statement (bovenste niveau) verboden beginwoorden: eigen transactiebesturing en sessie-instellingen. */
const STATEMENT_BEGIN_VERBODEN = /^(begin|commit|end|rollback|abort|savepoint|release|start|prepare|reset|discard|load|listen|notify|unlisten|checkpoint)\b/;
/** Een `set` mag alleen deze onschuldige instellingen aanraken. */
const SET_TOEGESTAAN = /^set\s+(local\s+)?(statement_timeout|lock_timeout|idle_in_transaction_session_timeout|client_min_messages|check_function_bodies|search_path)\b/;
/** De enige toegestane vorm van EXECUTE op het bovenste niveau: de triggerdefinitie (drie lineaire toetsen, precies één EXECUTE). */
function triggerExecute(st: string): boolean {
  return (
    /^create (constraint )?trigger\b/.test(st) &&
    /\bfor each (row|statement)\b/.test(st) &&
    /\bexecute (function|procedure) [a-z0-9_]+( ?\. ?[a-z0-9_]+)* ?\(/.test(st) &&
    st.split("execute").length === 2
  );
}
/** `search_path` mag niet naar een beschermd schema wijzen, in welke vorm dan ook. */
const SEARCH_PATH_BESCHERMD = /\b(auth|vault|extensions|storage|pg_catalog|information_schema|pg_temp)\b/;

/** Alleen met `destructief: true`: onomkeerbaar of toegangsrechten. Toegepast op het bovenste niveau én op de bodies. */
const DESTRUCTIEF_OVERAL: readonly Regel[] = [
  [/\bdrop\b/, "DROP"],
  [/\btruncate\b/, "TRUNCATE"],
  [/\bdelete\b/, "DELETE"],
  [/\bupdate\b/, "UPDATE"],
  [/\b(vacuum|reindex|cluster|refresh\s+materialized)\b/, "onderhoudsopdracht"],
  [/\bmerge\b/, "MERGE (kan wijzigen en verwijderen)"],
];
/** Alleen in bodies (functie, trigger, DO): statements die bestaande objecten wijzigen horen daar niet. */
const BODY_WIJZIGT_BESTAAND = /\b(alter|lock|reassign|import|security|comment|create|set|reset|discard|listen|notify|unlisten|call|refresh|analyze|do)\b/;
/** Alleen op het bovenste niveau (wat nu wordt uitgevoerd). */
const DESTRUCTIEF_BOVEN: readonly Regel[] = [
  [/\bcreate\s+or\s+replace\b/, "CREATE OR REPLACE (overschrijft bestaand gedrag)"],
  [/\b(policy|grant|revoke)\b/, "POLICY, GRANT of REVOKE (toegangsrechten)"],
  [/\bsecurity\s+definer\b/, "SECURITY DEFINER"],
];
/** Per statement: een ALTER die laat vallen, hernoemt, van eigenaar of type verandert, of triggers aanzet. */
const ALTER_DESTRUCTIEF = /\b(drop|rename|owner|type|force|detach|attach|inherit|replica|reset|validate|cluster|schema|alter\s+column|set\s+(default|not|data|without|with|logged|unlogged|tablespace|access|statistics|storage|compression|\()|enable\s+(trigger|rule|replica|always))\b/;

const TOEGESTAAN: readonly RegExp[] = [
  /^create (unlogged )?table\b/,
  /^create (unique )?index\b/,
  /^create type\b/,
  /^create sequence\b/,
  /^create view\b/,
  /^create (constraint )?trigger\b/,
  /^create function\b/,
  // `add` moet het commando zijn, direct na de tabelnaam; een naam of kolom die "add" heet telt niet.
  /^alter table (if exists )?(only )?[^\s,.]+( ?\. ?[^\s,.]+)? add\b/,
  /^alter table (if exists )?(only )?[^\s,.]+( ?\. ?[^\s,.]+)? enable row level security$/,
  /^insert into\b/,
  /^comment on\b/,
  /^set\s+(local\s+)?(statement_timeout|lock_timeout|idle_in_transaction_session_timeout|client_min_messages|check_function_bodies|search_path)\b/,
  // Onschadelijke extensies uit een vaste lijst; alles anders valt onder ALTIJD_VERBODEN.
  /^create extension (if not exists )?"?(pgcrypto|uuid-ossp|pg_trgm|citext|unaccent|btree_gist|btree_gin)"?( with schema (public|extensions))?$/,
];
const TOEGESTANE_EXTENSIE = /create extension (if not exists )?"?(pgcrypto|uuid-ossp|pg_trgm|citext|unaccent|btree_gist|btree_gin)"?( with schema (public|extensions))?/g;

/** De bekende, onschadelijke aanroepen van de aanmeldlaag in beleidsregels; geen verwijzing naar het schema zelf. */
const TOEGESTANE_AANROEPEN = /\bauth\s*\.\s*(uid|jwt|role|email)\s*\(\s*\)/g;

/**
 * Oordeel over de SQL van één migratie, na normaliseerMigratie. Leeg = geen bezwaar.
 * Zonder `destructief` moet elk statement additief zijn én mag niets destructiefs voorkomen (ook niet in
 * een functiebody of trigger); met `destructief` blijft ALTIJD_VERBODEN gelden.
 */
export function beoordeelSql(invoer: string, destructief: boolean): readonly string[] {
  const sql = normaliseerMigratie(invoer);
  const lex = lexSql(sql);
  const redenen: string[] = lex.fouten.map((f) => `SQL niet zeker te lezen: ${f}`);
  const alles = lex.alles.toLowerCase().replace(TOEGESTANE_AANROEPEN, " auth_aanroep ");
  const boven = lex.boven.toLowerCase().replace(TOEGESTANE_AANROEPEN, " auth_aanroep ");
  const zonderExtensie = alles.replace(TOEGESTANE_EXTENSIE, " ");

  for (const [r, naam] of ALTIJD_VERBODEN) if (r.test(zonderExtensie)) redenen.push(naam);

  const statements = boven.split(";").map((x) => x.trim()).filter((x) => x.length > 0);
  for (const st of statements) {
    if (STATEMENT_BEGIN_VERBODEN.test(st)) redenen.push("eigen transactiebesturing of sessiecommando");
    if (/^set\b/.test(st) && !SET_TOEGESTAAN.test(st)) redenen.push("een SET-instelling buiten de kleine toegestane lijst");
    if (st.includes("search_path") && SEARCH_PATH_BESCHERMD.test(st)) redenen.push("search_path naar een beschermd schema");
    // EXECUTE: dynamische SQL is nergens toegestaan. Op het bovenste niveau bestaat alleen de triggervorm
    // `create trigger … execute function|procedure <naam>(` en `grant execute on …`.
    if (/\bexecute\b/.test(st) && !triggerExecute(st) && !/\bexecute\s+on\b/.test(st)) redenen.push("dynamische SQL (EXECUTE)");
  }
  // In een body (functie, trigger, DO-blok) is elke EXECUTE dynamische SQL, ook `execute function;` met een variabele die zo heet.
  const bodyTeksten = lex.bodies.map((b) => b.toLowerCase().replace(TOEGESTANE_AANROEPEN, " auth_aanroep "));
  for (const b of bodyTeksten) {
    if (/\bexecute\b/.test(b)) redenen.push("dynamische SQL (EXECUTE) in een body");
    if (b.includes("search_path") && SEARCH_PATH_BESCHERMD.test(b)) redenen.push("search_path naar een beschermd schema");
  }

  if (!destructief) {
    for (const b of bodyTeksten) if (BODY_WIJZIGT_BESTAAND.test(b)) redenen.push("ALTER, LOCK of vergelijkbaar in een body vraagt destructief: true in het mandaat");
    const codeTekst = [boven, ...bodyTeksten];
    for (const t of codeTekst) {
      for (const [r, naam] of DESTRUCTIEF_OVERAL) if (r.test(t)) redenen.push(`${naam} vraagt destructief: true in het mandaat`);
      for (const [r, naam] of DESTRUCTIEF_BOVEN) if (r.test(t)) redenen.push(`${naam} vraagt destructief: true in het mandaat`);
      // Per statement (linear): DO, ALTER die laat vallen, en INSERT … ON CONFLICT DO UPDATE.
      for (const st of t.split(";").map((x) => x.trim())) {
        if (/^do\b/.test(st)) redenen.push("een DO-blok vraagt destructief: true in het mandaat");
        if (/\balter\b/.test(st) && ALTER_DESTRUCTIEF.test(st)) redenen.push("ALTER dat laat vallen, hernoemt, van eigenaar of type verandert, of triggers aanzet vraagt destructief: true in het mandaat");
        if (conflictDoUpdate(st)) redenen.push("INSERT … ON CONFLICT DO UPDATE vraagt destructief: true in het mandaat");
      }
    }
    for (const st of statements) {
      if (!TOEGESTAAN.some((r) => r.test(st))) {
        redenen.push(`statement valt buiten de additieve whitelist: "${st.slice(0, 60)}"`);
        break;
      }
    }
    redenen.push(...additieveGrammatica(statements));
  }
  return [...new Set(redenen)];
}

/** `on conflict … do update` binnen één statement, zonder terugloop: één indexOf, dan één lineaire regex. */
function conflictDoUpdate(st: string): boolean {
  const i = st.indexOf("on conflict");
  return i >= 0 && /\bdo\s+update\b/.test(st.slice(i));
}

/** Gehandhaafd als dunne laag voor oudere aanroepers en tests. */
export function destructieveSql(sql: string): readonly string[] {
  return beoordeelSql(sql, false);
}

// --- Positieve grammatica voor additieve migraties ------------------------------------------------------------
// De whitelist hierboven kijkt naar het begin van een statement. Wat daarna komt, bepaalt of het statement
// werkelijk additief is; daarom gelden hier per soort statement positieve regels, en geldt voor wijzigingen aan
// bestaande objecten (trigger, row level security, commentaar) dat ze alleen mogen op objecten die DEZE migratie
// zelf eerder heeft aangemaakt.

const NAAM = "[^\\s(),.;]+(?: ?\\. ?[^\\s(),.;]+)*";
const canoniek = (x: string): string => x.replace(/\s+/g, "");

/** Splitst op komma's op het hoogste haakjesniveau. */
function splitsOpKomma(tekst: string): string[] {
  const delen: string[] = [];
  let diepte = 0;
  let begin = 0;
  for (let i = 0; i < tekst.length; i += 1) {
    const c = tekst[i];
    if (c === "(") diepte += 1;
    else if (c === ")") diepte -= 1;
    else if (c === "," && diepte === 0) {
      delen.push(tekst.slice(begin, i).trim());
      begin = i + 1;
    }
  }
  delen.push(tekst.slice(begin).trim());
  return delen;
}

/** Positieve regels per soort statement (bovenste niveau, in volgorde). Lineair: elke regex is verankerd of heeft één vaste scheiding. */
function additieveGrammatica(statements: readonly string[]): string[] {
  const redenen: string[] = [];
  const nieuw = new Set<string>();
  const nieuweFuncties = new Set<string>();
  const handtekeningen = new Set<string>();
  // Een naam met meer dan twee delen (db.schema.object) wordt niet gevolgd: fail-closed.
  const naamCheck = (n: string): string => {
    const c = canoniek(n);
    if (c.split(".").length > 2) redenen.push("een naam met meer dan twee delen (database.schema.object) wordt niet gevolgd");
    return c;
  };
  const alsNaam = (m: RegExpMatchArray | null, groep = 1): string | null => (m?.[groep] === undefined ? null : naamCheck(m[groep]!));
  for (const st of statements) {
    if (/^set\b/.test(st) && /\bsearch_path\b/.test(st)) redenen.push("SET search_path verandert hoe namen worden gelezen en vraagt destructief: true in het mandaat");
    let m: RegExpMatchArray | null;
    if ((m = st.match(new RegExp(`^create (?:unlogged )?table (?:if not exists )?(${NAAM})`)))) {
      if (/\bpartition of\b|\binherits\b/.test(st)) redenen.push("CREATE TABLE … PARTITION OF of INHERITS verandert een bestaande tabel en vraagt destructief: true in het mandaat");
      if (!/^create (?:unlogged )?table if not exists\b/.test(st)) nieuw.add(naamCheck(m[1]!));
    } else if ((m = st.match(new RegExp(`^create (?:recursive )?view (${NAAM})`)))) nieuw.add(naamCheck(m[1]!));
    else if ((m = st.match(new RegExp(`^create (?:unique )?index (?:concurrently )?(?:if not exists )?(${NAAM}) on\\b`)))) { if (!/^create (?:unique )?index (?:concurrently )?if not exists\b/.test(st)) nieuw.add(naamCheck(m[1]!)); }
    else if ((m = st.match(new RegExp(`^create sequence (?:if not exists )?(${NAAM})`))) && /\bowned by\b/.test(st)) {
      // OWNED BY hangt de nieuwe sequentie aan een kolom; alleen aan een tabel uit deze migratie.
      const eigenaar = st.match(new RegExp(`\\bowned by (${NAAM})`));
      const tabelDeel = eigenaar === null ? null : canoniek(eigenaar[1]!).replace(/\.[^.]*$/, "");
      if (!(eigenaar !== null && canoniek(eigenaar[1]!) === "none") && (tabelDeel === null || !nieuw.has(tabelDeel))) redenen.push("OWNED BY een kolom van een bestaande tabel verandert die tabel en vraagt destructief: true in het mandaat");
      if (!/ if not exists\b/.test(st.slice(0, 40))) nieuw.add(naamCheck(m[1]!));
    } else if ((m = st.match(new RegExp(`^create (?:sequence|type) (?:if not exists )?(${NAAM})`)))) { if (!/ if not exists\b/.test(st.slice(0, 40))) nieuw.add(naamCheck(m[1]!)); }
    else if ((m = st.match(new RegExp(`^create function (${NAAM})`)))) {
      // Een nieuwe functie met dezelfde naam en een passender argumenttype overschrijft bij PostgreSQL elke bestaande
      // aanroep (create function public.lower(varchar) …). Alleen een triggerfunctie is niet aanroepbaar vanuit SQL.
      if (!/\breturns trigger\b/.test(st)) redenen.push("een functie die vanuit SQL aanroepbaar is kan een bestaande aanroep overschrijven en vraagt destructief: true in het mandaat");
      // Functies hebben in PostgreSQL een eigen naamruimte: een functie `x` maakt `x` als tabel niet nieuw.
      const naam = naamCheck(m[1]!);
      nieuweFuncties.add(naam);
      const args = st.match(new RegExp(`^create function ${NAAM} ?\\(([^)]*)\\)`));
      if (args !== null) handtekeningen.add(`${naam}(${canoniek(args[1]!)})`);
    } else if (/^create (constraint )?trigger\b/.test(st)) {
      // Vaste vorm: create [constraint] trigger NAAM before|after|instead of GEBEURTENISSEN on DOEL … — nooit "het eerste on".
      const gebeurtenis = "(?:insert|delete|truncate|update(?: of [^\\s,]+(?: ?, ?[^\\s,]+)*)?)";
      const t = st.match(new RegExp(`^create (?:constraint )?trigger ${NAAM} (?:before|after|instead of) ${gebeurtenis}(?: or ${gebeurtenis})* on (${NAAM})\\b`));
      const doel = t === null ? null : naamCheck(t[1]!);
      const fn = alsNaam(st.match(new RegExp(`\\bexecute (?:function|procedure) (${NAAM}) ?\\(`)));
      if (doel === null || !nieuw.has(doel)) redenen.push("een trigger op een bestaande tabel (of in een vorm die niet te lezen is) vraagt destructief: true in het mandaat");
      if (fn === null || !nieuweFuncties.has(fn)) redenen.push("een trigger met een functie die niet in deze migratie is aangemaakt vraagt destructief: true in het mandaat");
    } else if ((m = st.match(new RegExp(`^alter table (?:if exists )?(?:only )?(${NAAM}) (.*)$`)))) {
      const tabel = naamCheck(m[1]!);
      const acties = splitsOpKomma(m[2]!);
      for (const a of acties) {
        if (/^add\b/.test(a)) {
          if (/\busing\s+index\b/.test(a)) redenen.push("ADD CONSTRAINT … USING INDEX hernoemt een bestaande index");
        } else if (a === "enable row level security") {
          if (!nieuw.has(tabel)) redenen.push("row level security aanzetten op een bestaande tabel kan lezen blokkeren en vraagt destructief: true in het mandaat");
        } else redenen.push(`ALTER TABLE-actie buiten ADD: "${a.slice(0, 40)}"`);
      }
    } else if ((m = st.match(/^comment on (table|view|index|sequence|type|function|column) (.+?) is\b/))) {
      const volledig = canoniek(m[2]!);
      if (m[1] === "function") {
        // Naam én argumenten moeten die van een functie uit deze migratie zijn: `mijn(int)` is niet `mijn()`.
        if (!handtekeningen.has(volledig)) redenen.push("commentaar op een functie die niet (met deze argumenten) in deze migratie is aangemaakt vraagt destructief: true in het mandaat");
      } else {
        const x = volledig.replace(/\(.*$/, "");
        const doel = m[1] === "column" ? x.replace(/\.[^.]*$/, "") : x;
        if (!nieuw.has(doel)) redenen.push("commentaar op een bestaand object vraagt destructief: true in het mandaat");
      }
    } else if (/^comment on\b/.test(st)) redenen.push("commentaar op dit soort object is alleen met destructief: true toegestaan");
  }
  return redenen;
}
