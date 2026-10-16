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
        const eind = leesTekst(sql, j + 1, escape);
        if (eind === -1) {
          fouten.push("een tekst die niet wordt afgesloten");
          i = n;
        } else {
          if (escape) {
            const inhoud = sql.slice(j + 1, eind - 1);
            if (alsCode()) fouten.push("een E-tekst als functiebody of DO-code is niet toegestaan");
            void inhoud;
          } else if (alsCode()) {
            fouten.push("een B-, X- of N-tekst als functiebody of DO-code is niet toegestaan");
          }
          bij(w + " '' ", w + " '' ");
          i = eind;
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
      const eind = leesTekst(sql, i + 1, false);
      if (eind === -1) {
        fouten.push("een tekst die niet wordt afgesloten");
        i = n;
      } else {
        const inhoud = sql.slice(i + 1, eind - 1);
        if (alsCode()) {
          // `create function … as '<body>'`, `do '<code>'`: de tekst is code en wordt beoordeeld.
          const sub = lexSql(inhoud.replace(/''/g, "'"), diepte + 1);
          bij(" '' ", ` '' ${sub.alles} `);
          bodies.push(sub.alles, ...sub.bodies);
          fouten.push(...sub.fouten);
          codeTekst = true;
        } else {
          bij(" '' ");
        }
        i = eind;
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
        bij(` ${schoonNaam(naam)} `);
        i = j;
        zetWoord(schoonNaam(naam));
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
  [/\b(lo_import|lo_export|pg_read_file|pg_ls_dir|pg_read_binary_file|dblink|pg_terminate_backend|pg_cancel_backend|set_config|pg_sleep)\b/, "bestands-, netwerk- of sessiefuncties"],
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
    /\bexecute (function|procedure) [a-z0-9_.]+ ?\(/.test(st) &&
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
];
/** Alleen op het bovenste niveau (wat nu wordt uitgevoerd). */
const DESTRUCTIEF_BOVEN: readonly Regel[] = [
  [/\bcreate\s+or\s+replace\b/, "CREATE OR REPLACE (overschrijft bestaand gedrag)"],
  [/\b(policy|grant|revoke)\b/, "POLICY, GRANT of REVOKE (toegangsrechten)"],
  [/\bsecurity\s+definer\b/, "SECURITY DEFINER"],
];
/** Per statement: een ALTER die laat vallen, hernoemt, van eigenaar of type verandert, of triggers aanzet. */
const ALTER_DESTRUCTIEF = /\b(drop|rename|owner|type|force|enable\s+(trigger|rule|replica|always))\b/;

const TOEGESTAAN: readonly RegExp[] = [
  /^create (unlogged )?table\b/,
  /^create (unique )?index\b/,
  /^create type\b/,
  /^create sequence\b/,
  /^create (temp(orary)? )?view\b/,
  /^create (constraint )?trigger\b/,
  /^create function\b/,
  /^alter table\b.*\badd\b/,
  /^alter table\b.*\benable row level security$/,
  /^insert into\b/,
  /^comment on\b/,
  /^set\s+(local\s+)?(statement_timeout|lock_timeout|idle_in_transaction_session_timeout|client_min_messages|check_function_bodies|search_path)\b/,
  // Onschadelijke extensies uit een vaste lijst; alles anders valt onder ALTIJD_VERBODEN.
  /^create extension (if not exists )?"?(pgcrypto|uuid-ossp|pg_trgm|citext|unaccent|btree_gist|btree_gin)"?( with schema \w+)?$/,
];
const TOEGESTANE_EXTENSIE = /create extension (if not exists )?"?(pgcrypto|uuid-ossp|pg_trgm|citext|unaccent|btree_gist|btree_gin)"?( with schema \w+)?/g;

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
