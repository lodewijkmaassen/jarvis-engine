// De eigen migratielane: SQL die bij een doel hoort, na samenvoegen toegepast.
//
// WAAROM DIT BESTAAT
//
// De uitvoerder levert bij een doel soms SQL op (`tasks/<doel>/0001_….sql`).
// Die werd na samenvoegen nooit toegepast, en het doel ging toch op klaar —
// gemeten op 2026-11-06: twee samengevoegde migraties stonden sinds oktober
// niet op de database, terwijl de code die erop leunde al live was. Daarmee
// betekende "klaar" niets.
//
// De bestaande migratieroute van V3 (`jarvis v3 migreer`) kan dit niet doen en
// moet dat ook niet kunnen: die is voor het PRODUCT en weigert met opzet elke
// databaserol die bij het schema `jarvis` kan. De rol die producttabellen
// migreert mag nooit bij de administratie kunnen waarin staat wie wat heeft
// goedgekeurd.
//
// Daarom een tweede, smalle lane voor het eigen schema, met de grens in de
// database zelf: `jarvis.pas_migratie_toe` (SECURITY DEFINER, alleen
// uitvoerbaar door `jarvis_ci`) weigert alles wat destructief is of rechten
// verhoogt, en schrijft één ledger. Dit bestand is de kant van de engine: het
// pad herkennen, de naam bepalen, en dezelfde grens hier al toetsen zodat de
// uitvoerder een leesbare reden krijgt in plaats van een databasefout. De
// database blijft de autoriteit; dit is de voorportaal-controle.
//
// Geen tweede ledger, geen tweede uitvoeringssysteem: één tabel
// (`jarvis.migraties`), één deur, en de bestaande keten eromheen (poort,
// reviewer, attestatie, samenvoegen) blijft precies zoals hij was.

import { createHash } from "node:crypto";
import { lexSql, normaliseerMigratie } from "./v3-sql";

/** SQL die bij een doel hoort: `tasks/<doel-id>/<naam>.sql` in een van de Jarvis-repositories. */
export const DOEL_SQL_PAD = /(?:^|\/)tasks\/(D-\d{8}-\d{6,9})\/([^/]+)\.sql$/;

/** Het doel en de bestandsnaam uit een pad, of null als dit geen doel-SQL is. */
export function doelVanMigratie(pad: string): { readonly doel: string; readonly bestand: string } | null {
  const m = DOEL_SQL_PAD.exec(pad.replace(/\\/g, "/"));
  return m === null ? null : { doel: m[1]!, bestand: m[2]! };
}

/**
 * De naam in het ledger. Het doel staat erin, zodat twee doelen met een
 * `0001_…`-bestand niet op dezelfde naam uitkomen en één blik op het ledger
 * zegt waar een migratie bij hoort.
 */
export function migratieNaam(doel: string, bestand: string): string {
  return `${doel}__${bestand}`.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
}

/** De vingerafdruk van de inhoud: dezelfde naam met andere inhoud is een fout, geen tweede poging. */
export function hashSql(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/** Wat deze lane nooit doet. Dezelfde lijst als in `jarvis.migratie_bezwaar`; die blijft de autoriteit. */
const VERBODEN: readonly (readonly [RegExp, string])[] = [
  [/\bdrop\s+(table|schema|database|role|user|owned|policy|publication|subscription|extension|type|domain|sequence|view|materialized|index|rule|cast|operator|server|tablespace)\b/, "iets laten vallen"],
  [/\btruncate\b/, "leegmaken (TRUNCATE)"],
  [/\bdelete\s+from\b/, "gegevens verwijderen (DELETE)"],
  [/\brename\s+to\b/, "hernoemen"],
  [/\bowner\s+to\b/, "van eigenaar veranderen"],
  [/\balter\s+(role|user|database|system|default\s+privileges|publication|subscription|extension|type|schema|large)\b/, "een rol, database of systeeminstelling wijzigen"],
  [/\bcreate\s+(role|user|publication|subscription|extension|server|foreign|tablespace|cast|operator|language|event\s+trigger)\b/, "een rol, extensie of serverobject aanmaken"],
  [/\b(grant|revoke)\b/, "rechten uitdelen of intrekken"],
  [/\brow\s+level\s+security\b/, "rij-niveaubeveiliging aan- of uitzetten"],
  [/\b(create|alter)\s+policy\b/, "een beveiligingspolicy"],
  [/\bsecurity\s+(definer|label)\b/, "SECURITY DEFINER of SECURITY LABEL"],
  [/\b(set|reset)\s+role\b/, "van rol wisselen"],
  [/\b(execute|format|quote_ident|quote_literal|dblink|lo_import|lo_export|pg_read_file|pg_read_binary_file|pg_ls_dir|copy)\s*\(/, "dynamische SQL of bestands-/netwerktoegang"],
  [/\bexecute\s+(immediate|format|'|\$)/, "dynamische SQL (EXECUTE)"],
  // Eigen transactiebesturing hoort hier niet, maar de controle staat bij de statementvorm en niet in deze lijst:
  // een plpgsql-body begint met `begin` en eindigt met `end`, en dat is geen transactie maar een blok.
  // De schema's van het platform en van Postgres zelf, los van hun merknaam: alles buiten `jarvis.` hoort hier niet.
  [/\b(auth|vault|storage|extensions|net|cron|pgsodium|realtime|graphql|information_schema|pg_catalog|supa\w*)\s*\./, "een ander schema dan jarvis"],
  [/\bpublic\s*\./, "het productschema public"],
  [/\bpg_(sleep|terminate_backend|cancel_backend|reload_conf|logical|replication|stat_file)\b/, "een beheersfunctie van de server"],
  [
    /\bjarvis\s*\.\s*(autorisaties|toetsingen|v3_mandaten|instellingen|v3_instellingen|migraties|migratie_bezwaar|pas_migratie_toe|is_eigenaar|eigenaar_uid|v3_is_eigenaar|v3_geef_mandaat|v3_schrijf_mandaat|v3_mandaat_check|doel_nieuw|v3_nieuwe_opdracht|verstuur_gebeurtenis|vraag_review|lees_review|acceptatie_sleutel)\b/,
    "de administratie of de functies waarin autorisatie leeft",
  ],
  [/\bdefault\s+privileges\b/, "standaardrechten"],
  [/\\x/, "een escape die tekens kan verbergen"],
  [/\bu&'/, "een escape die tekens kan verbergen"],
];

/** De vormen die wél door de lane gaan. Alles daarbuiten is geen fout van de database maar van de opdracht. */
const TOEGESTANE_VORMEN: readonly RegExp[] = [
  /^create table if not exists jarvis\s*\./,
  /^create (unique )?index (concurrently )?(if not exists )?/,
  /^create (or replace )?view jarvis\s*\./,
  /^create sequence (if not exists )?jarvis\s*\./,
  /^create (or replace )?function jarvis\s*\./,
  /^create trigger /,
  /^drop trigger if exists /,
  /^alter table (if exists )?jarvis\s*\.[a-z0-9_"]+ add (column|constraint)\b/,
  /^alter table (if exists )?jarvis\s*\.[a-z0-9_"]+ drop constraint if exists\b/,
  /^alter table (if exists )?jarvis\s*\.[a-z0-9_"]+ validate constraint\b/,
  /^alter table (if exists )?jarvis\s*\.[a-z0-9_"]+ alter column [a-z0-9_"]+ set default\b/,
  /^comment on /,
  /^insert into jarvis\s*\./,
  /^update jarvis\s*\./,
  /^analyze jarvis\s*\./,
  /^select /,
  /^with /,
];

/**
 * Welke bezwaren er tegen deze SQL zijn; een lege lijst betekent: deze lane
 * kan hem toepassen. Dezelfde regels als in de database, hier alleen om ze
 * eerder en leesbaarder te melden. Bij twijfel een bezwaar: niet kunnen lezen
 * is zelf een reden om niets toe te passen.
 */
export function beoordeelEigenSql(invoer: string): readonly string[] {
  const sql = normaliseerMigratie(invoer);
  if (sql.trim() === "") return ["leeg"];
  if (sql.length > 200_000) return ["groter dan 200.000 tekens"];
  const lex = lexSql(sql);
  const bezwaren: string[] = lex.fouten.map((f) => `SQL niet zeker te lezen: ${f}`);
  const alles = lex.alles.toLowerCase();
  for (const [patroon, reden] of VERBODEN) {
    if (patroon.test(alles)) bezwaren.push(`${reden} hoort niet in de eigen migratielane`);
  }
  const statements = lex.boven
    .toLowerCase()
    .split(";")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length > 0);
  for (const st of statements) {
    if (!TOEGESTANE_VORMEN.some((r) => r.test(st))) bezwaren.push(`statement valt buiten de lane: "${st.slice(0, 70)}"`);
    if (/^update jarvis\s*\./.test(st) && !/\bwhere\b/.test(st)) bezwaren.push("UPDATE zonder WHERE");
    const weg = /^drop trigger if exists ([a-z0-9_"]+)/.exec(st);
    if (weg !== null && !new RegExp(`create trigger ${weg[1]}\\b`).test(statements.join("; "))) {
      bezwaren.push("DROP TRIGGER zonder dezelfde trigger opnieuw aan te maken");
    }
  }
  return [...new Set(bezwaren)];
}

/**
 * Welke redenen uit de lijst hierboven een grens zijn die alleen met de rechten
 * van de eigenaar van het schema te nemen is. De overige bezwaren (een vorm die
 * de lane niet kent, dynamische SQL, een UPDATE zonder WHERE) kan de uitvoerder
 * zelf anders schrijven.
 *
 * Een vaste lijst en geen woordenzoeker in de meldingstekst: waar een doel heen
 * gaat — terug naar de uitvoerder of met één concrete handeling naar de
 * eigenaar — mag niet afhangen van hoe een reden is geformuleerd.
 */
const BEVOEGDHEID_REDENEN: ReadonlySet<string> = new Set([
  "iets laten vallen",
  "leegmaken (TRUNCATE)",
  "gegevens verwijderen (DELETE)",
  "hernoemen",
  "van eigenaar veranderen",
  "een rol, database of systeeminstelling wijzigen",
  "een rol, extensie of serverobject aanmaken",
  "rechten uitdelen of intrekken",
  "rij-niveaubeveiliging aan- of uitzetten",
  "een beveiligingspolicy",
  "SECURITY DEFINER of SECURITY LABEL",
  "een ander schema dan jarvis",
  "het productschema public",
  "een beheersfunctie van de server",
  "de administratie of de functies waarin autorisatie leeft",
  "standaardrechten",
]);

/**
 * Hoort een van deze bezwaren bij een grens die alleen met de rechten van de
 * eigenaar te nemen is? Dat onderscheid bepaalt waar het doel heen gaat.
 * Ze verwarren is precies wat de keten eerder stillegde.
 */
export function bezwaarIsBevoegdheid(bezwaren: readonly string[]): boolean {
  return bezwaren.some((b) => [...BEVOEGDHEID_REDENEN].some((r) => b.startsWith(r)));
}
