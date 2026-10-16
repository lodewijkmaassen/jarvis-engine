// De omzeilingen van de migratiescanner uit de onafhankelijke review (BLK-1), plus de eerder gemelde.
//
// Eén lijst voor twee bewijzen:
//   1. v3.test.ts: de scanner weigert elk geval;
//   2. v3-database.test.ts: tegen ECHTE PostgreSQL. Eerst wordt aangetoond dat de SQL werkelijk doet wat de
//      aanvaller wil (`effect`, binnen een transactie die wordt teruggedraaid) -- anders meet een test niets --
//      en dan dat de scanner hem weigert.
//
// `altijd`: ook met `destructief: true` geweigerd (het raakt de beveiliging van Jarvis zelf).

type Tx = { unsafe: (sql: string) => Promise<readonly Record<string, unknown>[]> };

export type Aanval = {
  readonly naam: string;
  readonly sql: string;
  readonly altijd: boolean;
  /** Draait NA de aanval, in dezelfde (later teruggedraaide) transactie: is het beoogde effect er? */
  readonly effect?: (tx: Tx) => Promise<boolean>;
};

const weg = (tabel: string) => async (tx: Tx) => (await tx.unsafe(`select to_regclass('${tabel}') is null as weg`))[0]?.["weg"] === true;
const geleegd = async (tx: Tx) => (await tx.unsafe("select count(*)::int as n from public.klanten"))[0]?.["n"] === 0;
const leeg = async (tx: Tx) => {
  await tx.unsafe("insert into public.t (n) values ('x')");
  return (await tx.unsafe("select count(*)::int as n from public.klanten"))[0]?.["n"] === 0;
};

export const BLK1_AANVALLEN: readonly Aanval[] = [
  // --- (a) E-prefix midden in een naam: de e van `name` is geen begin van een escape-tekst
  { naam: "a: name'\\' verbergt een DROP", sql: "insert into public.t select name'\\'; drop table public.klanten; select name'\\'", altijd: false, effect: weg("public.klanten") },
  { naam: "a: dezelfde omzeiling verbergt een verwijzing naar jarvis", sql: "insert into public.t select name'\\'; insert into jarvis.v3_instellingen values ('qa-a','1'); select name'\\'", altijd: true,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from jarvis.v3_instellingen where sleutel = 'qa-a'"))[0]?.["n"] === 1 },
  // --- (b) een $tag$ binnen een naam is geen dollar-quote
  { naam: "b: x$a$ verbergt een DROP", sql: "insert into public.t select 'x'::name as x$a$; drop table public.klanten2; select 'y'::name as y$a$", altijd: false, effect: weg("public.klanten2") },
  // --- (c) unicode-escape in een naam
  { naam: "c: U&\"\\006Aarvis\" is het schema jarvis", sql: 'insert into U&"\\006Aarvis".v3_instellingen (sleutel, waarde) values (\'qa-c\', \'1\')', altijd: true,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from jarvis.v3_instellingen where sleutel = 'qa-c'"))[0]?.["n"] === 1 },
  // --- (d) functiebody als gewone tekst of dollar-quote met schadelijke inhoud, via een trigger
  { naam: "d: trigger met body als gewone tekst wist een tabel", sql: "create function public.f() returns trigger language plpgsql as 'begin delete from public.klanten; return new; end'; create trigger tr before insert on public.t for each row execute function public.f();", altijd: false, effect: leeg },
  { naam: "d: trigger met dollar-body wist een tabel", sql: "create function public.f() returns trigger language plpgsql as $$begin delete from public.klanten; return new; end$$; create trigger tr before insert on public.t for each row execute function public.f();", altijd: false, effect: leeg },
  // --- eerder gemeld
  { naam: "tekstwaarde met -- verbergt een DROP", sql: "select '--'; drop table public.klanten;", altijd: false, effect: weg("public.klanten") },
  { naam: "tekstwaarde met /* verbergt een DROP", sql: "select '/*'; drop table public.klanten; select '*/';", altijd: false, effect: weg("public.klanten") },
  { naam: "dollar-quote met -- erin verbergt een DROP", sql: "select $x$ -- $x$; drop table public.klanten;", altijd: false, effect: weg("public.klanten") },
  { naam: "DO met samengestelde EXECUTE", sql: "do $$ begin execute 'dr'||'op table public.klanten'; end $$", altijd: true, effect: weg("public.klanten") },
  { naam: "delete met where true", sql: "delete from public.klanten where true", altijd: false, effect: async (tx) => (await tx.unsafe("select count(*)::int as n from public.klanten"))[0]?.["n"] === 0 },
  { naam: "de eigenaarscheck van V3 herdefiniëren", sql: "create or replace function jarvis.v3_is_eigenaar() returns boolean language sql as $$ select true $$", altijd: true,
    effect: async (tx) => (await tx.unsafe("select jarvis.v3_is_eigenaar() as ja"))[0]?.["ja"] === true },
  { naam: "de onveranderlijkheid van het mandaat uitzetten", sql: "alter table jarvis.v3_mandaten disable trigger all", altijd: true,
    effect: async (tx) => (await tx.unsafe("select tgenabled::text as s from pg_trigger where tgname = 'v3_mandaten_vast'"))[0]?.["s"] === "D" },
  { naam: "aangehaalde schemanaam", sql: 'insert into "jarvis"."v3_instellingen" values (\'qa-q\', \'1\')', altijd: true,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from jarvis.v3_instellingen where sleutel = 'qa-q'"))[0]?.["n"] === 1 },
  { naam: "search_path naar jarvis en dan een kale naam", sql: "set search_path = jarvis, public; insert into v3_instellingen values ('qa-s', '1')", altijd: true,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from jarvis.v3_instellingen where sleutel = 'qa-s'"))[0]?.["n"] === 1 },
  { naam: "commit middenin laat een halve toestand achter", sql: "create table public.half (a int); commit; drop table public.klanten;", altijd: true },
  // --- NB-1: de beoordeling van functiebodies (derde review). Elke variant draait een schadelijke actie vanuit een body.
  { naam: "NB-1: execute function; met een variabele die function heet", sql: "create function public.f() returns int language plpgsql as $$ declare function text := 'delete from public.klanten'; begin execute function; return 1; end $$; insert into public.t select f()::text;", altijd: true, effect: geleegd },
  { naam: "NB-1: execute procedure; met een variabele die procedure heet", sql: "create function public.f() returns int language plpgsql as $$ declare procedure text := 'delete from public.klanten'; begin execute procedure; return 1; end $$; insert into public.t select f()::text;", altijd: true, effect: geleegd },
  { naam: "NB-1: grant in een body geeft anon DELETE", sql: "create function public.f() returns int language plpgsql as $$ begin grant all on public.klanten to anon; return 1; end $$; insert into public.t select f()::text;", altijd: false,
    effect: async (tx) => (await tx.unsafe("select has_table_privilege('anon', 'public.klanten', 'DELETE') as ja"))[0]?.["ja"] === true },
  { naam: "NB-1: create policy in een body", sql: "create function public.f() returns int language plpgsql as $$ begin create policy qa_pol on public.klanten using (true); return 1; end $$; insert into public.t select f()::text;", altijd: false,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from pg_policy where polname = 'qa_pol'"))[0]?.["n"] === 1 },
  { naam: "NB-1: alter table rename in een body", sql: "create function public.f() returns int language plpgsql as $$ begin alter table public.klanten rename to klanten_x; return 1; end $$; insert into public.t select f()::text;", altijd: false, effect: weg("public.klanten") },
  { naam: "NB-1: alter column type in een body", sql: "create function public.f() returns int language plpgsql as $$ begin alter table public.klanten alter column id type text; return 1; end $$; insert into public.t select f()::text;", altijd: false,
    effect: async (tx) => (await tx.unsafe("select data_type as d from information_schema.columns where table_schema = 'public' and table_name = 'klanten' and column_name = 'id'"))[0]?.["d"] === "text" },
  { naam: "NB-1: create or replace function in een body verandert het gedrag van een bestaande functie", sql: "create function public.g() returns int language sql as $$ select 1 $$; create function public.f() returns int language plpgsql as $$ begin create or replace function public.g() returns int language sql as 'select 2'; return 1; end $$; insert into public.t select f()::text;", altijd: false,
    effect: async (tx) => (await tx.unsafe("select public.g() = 2 as ja"))[0]?.["ja"] === true },
  { naam: "NB-1 met destructief: DO met execute naar het schema van Jarvis", sql: "do $$ declare function text := 'insert into jarvis.v3_instellingen values (''qa-do'', ''1'')'; begin execute function; end $$", altijd: true,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from jarvis.v3_instellingen where sleutel = 'qa-do'"))[0]?.["n"] === 1 },
  { naam: "NB-1 met destructief: do '<code als tekst>' naar het schema van Jarvis", sql: "do 'begin insert into jarvis.v3_instellingen values (''qa-do2'', ''1''); end'", altijd: true,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from jarvis.v3_instellingen where sleutel = 'qa-do2'"))[0]?.["n"] === 1 },
  { naam: "NB-1: do language plpgsql '<code als tekst>' wist een tabel", sql: "do language plpgsql 'begin delete from public.klanten; end'", altijd: false, effect: geleegd },
  // query_to_xml draait een query uit een tekst (alleen lezen): zo wordt een beschermd schema gelezen zonder dat `jarvis.` in de SQL staat.
  { naam: "NB-1: query_to_xml leest een beschermd schema via een tekst", sql: "insert into public.t select left(query_to_xml('select sleutel from jarvis.v3_instellingen', false, false, '')::text, 60)", altijd: true,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from public.t"))[0]?.["n"] === 1 },
  { naam: "NB-1: ts_stat voert zelf SQL uit", sql: "select * from ts_stat('select * from jarvis.v3_instellingen')", altijd: true },
  // --- B-2 (vierde review): een woord direct gevolgd door een quote, of een code-tekst na een aangehaalde taalnaam
  { naam: "B-2: as'<body>' zonder spatie wist een tabel", sql: "create function public.f() returns int language plpgsql as'begin delete from public.klanten; return 1; end'; insert into public.t select f()::text;", altijd: false, effect: geleegd },
  { naam: "B-2: do'<code>' zonder spatie naar het schema van Jarvis", sql: "do'begin insert into jarvis.v3_instellingen values (''qa-b2a'', ''1''); end'", altijd: true,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from jarvis.v3_instellingen where sleutel = 'qa-b2a'"))[0]?.["n"] === 1 },
  { naam: "B-2: do language plpgsql'<code>' zonder spatie", sql: "do language plpgsql'begin delete from public.klanten; end'", altijd: false, effect: geleegd },
  { naam: "B-2: do language \"plpgsql\" '<code>' (aangehaalde taalnaam) naar het schema van Jarvis", sql: "do language \"plpgsql\" 'begin insert into jarvis.v3_instellingen values (''qa-b2b'', ''1''); end'", altijd: true,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from jarvis.v3_instellingen where sleutel = 'qa-b2b'"))[0]?.["n"] === 1 },
  { naam: "B-2: do language 'plpgsql' '<code>' (taalnaam als tekst) wist een tabel", sql: "do language 'plpgsql' 'begin delete from public.klanten; end'", altijd: false, effect: geleegd },
  { naam: "B-2: code verdeeld over aaneengeschakelde teksten", sql: "do 'begin delete from public.klanten;'\n' end'", altijd: false, effect: geleegd },
];
