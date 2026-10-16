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
  // --- BLK-A (vijfde review): aaneengeschakelde teksten die MIDDEN in een woord of woordgroep zijn gesplitst
  { naam: "BLK-A: delet|e midden in een woord, over twee teksten", sql: "create function public.f() returns int language plpgsql as 'begin delet'\n'e from public.klanten; return 1; end'; insert into public.t select f()::text;", altijd: false, effect: geleegd },
  { naam: "BLK-A: gr|ant all … to anon, over twee teksten", sql: "create function public.f() returns int language plpgsql as 'begin gr'\n'ant all on public.klanten to anon; return 1; end'; insert into public.t select f()::text;", altijd: false,
    effect: async (tx) => (await tx.unsafe("select has_table_privilege('anon', 'public.klanten', 'DELETE') as ja"))[0]?.["ja"] === true },
  { naam: "BLK-A: met commentaar tussen de teksten", sql: "create function public.f() returns int language plpgsql as 'begin delet' -- opmerking\n'e from public.klanten; return 1; end'; insert into public.t select f()::text;", altijd: false, effect: geleegd },
  { naam: "BLK-A: jarv|is.v|3_instellingen over drie teksten, met destructief", sql: "do 'begin insert into jarv'\n'is.v'\n'3_instellingen values (''qa-blka'', ''1''); end'", altijd: true,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from jarvis.v3_instellingen where sleutel = 'qa-blka'"))[0]?.["n"] === 1 },
  // --- BLK-C (zesde review): een E-tekst met een aaneengeschakeld vervolgstuk; het vervolgstuk blijft een E-tekst
  { naam: "BLK-C: E-keten met \\' in het vervolgstuk verbergt een DROP (commentaar sluit de tekst voor de lexer af)", sql: "insert into public.t select e'x'\n'\\''; drop table public.klanten; -- '", altijd: false, effect: weg("public.klanten") },
  { naam: "BLK-C: dezelfde keten verbergt een verwijzing naar jarvis", sql: "insert into public.t select e'x'\n'\\''; insert into jarvis.v3_instellingen values ('qa-blkc', '1'); -- '", altijd: true,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from jarvis.v3_instellingen where sleutel = 'qa-blkc'"))[0]?.["n"] === 1 },
  { naam: "BLK-C: E-keten met drie stukken", sql: "insert into public.t select e'x'\n'y'\n'\\''; delete from public.klanten; -- '", altijd: false, effect: geleegd },
  // --- BLK-D (achtste review): sequentie- en large-object-functies, bodies, en de alter-whitelist
  { naam: "D1: setval op een sequentie via een tekstnaam", sql: "create sequence public.qaseq; insert into public.t select setval('public.qaseq', 500)::text;", altijd: false,
    effect: async (tx) => Number((await tx.unsafe("select last_value::int as n from public.qaseq"))[0]?.["n"]) === 500 },
  { naam: "D1: nextval op een sequentie via een tekstnaam", sql: "create sequence public.qaseq; insert into public.t select nextval('public.qaseq')::text;", altijd: false,
    effect: async (tx) => Number((await tx.unsafe("select last_value::int as n from public.qaseq"))[0]?.["n"]) === 1 },
  { naam: "D2: alter sequence … restart in een triggerbody", sql: "create sequence public.qaseq; create function public.f() returns trigger language plpgsql as $$ begin alter sequence public.qaseq restart with 900; return new; end $$; create trigger tr before insert on public.t for each row execute function public.f(); insert into public.t values ('x');", altijd: false,
    effect: async (tx) => Number((await tx.unsafe("select last_value::int as n from public.qaseq"))[0]?.["n"]) === 900 },
  { naam: "D2: lo_unlink van een large object", sql: "insert into public.t select lo_create(4242)::text; insert into public.t select lo_unlink(4242)::text;", altijd: false,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from pg_largeobject_metadata where oid = 4242"))[0]?.["n"] === 0 },
  { naam: "D2: merge in een triggerbody wist rijen", sql: "create function public.f() returns trigger language plpgsql as $$ begin merge into public.klanten k using (select 1) x on true when matched then delete; return new; end $$; create trigger tr before insert on public.t for each row execute function public.f(); insert into public.t values ('x');", altijd: false, effect: geleegd },
  { naam: "D3: detach partition met een partitie die \"add\" heet", sql: 'create table public.pp(a int) partition by list(a); create table public."add" partition of public.pp for values in (1); insert into public.pp values (1); alter table public.pp detach partition public."add";', altijd: false,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from public.pp"))[0]?.["n"] === 0 },
  { naam: "D3: set default naast enable row level security", sql: "create table public.pr(c int default 1); alter table public.pr alter column c set default 7, enable row level security;", altijd: false,
    effect: async (tx) => (await tx.unsafe("select column_default as d from information_schema.columns where table_schema = 'public' and table_name = 'pr'"))[0]?.["d"] === "7" },
  // --- BLK-G (negende review): ALTER TABLE-acties na `add`, partition of / inherits, extension in jarvis, trigger/RLS/commentaar op bestaande objecten
  { naam: "G1: alter id restart na add column", sql: "create table public.ex(id int generated by default as identity primary key); insert into public.ex values (default),(default); alter table public.ex add column x int, alter id restart with 1;", altijd: false,
    effect: async (tx) => (await tx.unsafe("select last_value is null as n from pg_sequences where sequencename like 'ex_id%'"))[0]?.["n"] === true },
  { naam: "G1: alter id set increment by", sql: "create table public.ex(id int generated by default as identity primary key); alter table public.ex add column x int, alter id set increment by 5;", altijd: false,
    effect: async (tx) => Number((await tx.unsafe("select increment_by::int as n from pg_sequences where sequencename like 'ex_id%'"))[0]?.["n"]) === 5 },
  { naam: "G1: alter constraint deferrable", sql: "create table public.pk(a int primary key); create table public.fk(a int constraint fk_a references public.pk(a)); alter table public.fk add column x int, alter constraint fk_a deferrable initially deferred;", altijd: false,
    effect: async (tx) => (await tx.unsafe("select condeferrable as d from pg_constraint where conname = 'fk_a'"))[0]?.["d"] === true },
  { naam: "G2: create table … partition of", sql: "create table public.pp(a int) partition by list(a); create table public.pc partition of public.pp for values in (1);", altijd: false,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from pg_inherits where inhparent = 'public.pp'::regclass"))[0]?.["n"] === 1 },
  { naam: "G2: create table … inherits", sql: "create table public.pa(a int); create table public.pb() inherits (public.pa);", altijd: false,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from pg_inherits where inhparent = 'public.pa'::regclass"))[0]?.["n"] === 1 },
  { naam: "G3: create extension … with schema jarvis", sql: "create extension if not exists pgcrypto with schema jarvis;", altijd: true,
    effect: async (tx) => ((await tx.unsafe("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'jarvis' and p.proname = 'gen_salt'"))[0]?.["n"] as number) > 0 },
  { naam: "G4: trigger op een bestaande tabel slikt schrijfacties in", sql: "create function public.fg() returns trigger language plpgsql as $$ begin return null; end $$; create trigger g before insert on public.t for each row execute function public.fg(); insert into public.t values ('qa-g4');", altijd: false,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from public.t where n = 'qa-g4'"))[0]?.["n"] === 0 },
  { naam: "G5: row level security aanzetten op een bestaande tabel", sql: "alter table public.t enable row level security;", altijd: false,
    effect: async (tx) => (await tx.unsafe("select relrowsecurity as r from pg_class where oid = 'public.t'::regclass"))[0]?.["r"] === true },
  { naam: "G6: commentaar op een bestaand schema", sql: "comment on schema public is 'hacked-qa';", altijd: false,
    effect: async (tx) => (await tx.unsafe("select obj_description('public'::regnamespace, 'pg_namespace') as c"))[0]?.["c"] === "hacked-qa" },
  // --- BLK-H (tiende review): IF NOT EXISTS registreert een bestaand object als nieuw; aangehaalde namen die samenvallen
  { naam: "H1: create table if not exists + row level security op een bestaande tabel", sql: "create table if not exists public.t (n text); alter table public.t enable row level security;", altijd: false,
    effect: async (tx) => (await tx.unsafe("select relrowsecurity as r from pg_class where oid = 'public.t'::regclass"))[0]?.["r"] === true },
  { naam: "H1: create table if not exists + trigger op een bestaande tabel", sql: "create table if not exists public.t (n text); create function public.fh() returns trigger language plpgsql as $$ begin return null; end $$; create trigger h before insert on public.t for each row execute function public.fh(); insert into public.t values ('qa-h1');", altijd: false,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from public.t where n = 'qa-h1'"))[0]?.["n"] === 0 },
  { naam: "H1: create table if not exists + commentaar op een bestaande tabel", sql: "create table if not exists public.t (n text); comment on table public.t is 'hacked-h1';", altijd: false,
    effect: async (tx) => (await tx.unsafe("select obj_description('public.t'::regclass) as c"))[0]?.["c"] === "hacked-h1" },
  { naam: "H2: public.\"T\" en public.t vallen niet samen (trigger op de bestaande t)", sql: 'create table public."T" (x int); create function public.fh() returns trigger language plpgsql as $$ begin return null; end $$; create trigger h before insert on public.t for each row execute function public.fh(); insert into public.t values (\'qa-h2\');', altijd: false,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from public.t where n = 'qa-h2'"))[0]?.["n"] === 0 },
  // --- BLK-J (elfde review): een naam met drie delen (database.schema.object)
  { naam: "J: trigger op public.t via de naam met drie delen", sql: "create table qa_dbnaam.public.zz(i int); create function public.fj() returns trigger language plpgsql as $$ begin return null; end $$; create trigger j before insert on qa_dbnaam.public.t for each row execute function public.fj(); insert into public.t values ('qa-j');", altijd: false,
    effect: async (tx) => (await tx.unsafe("select count(*)::int as n from public.t where n = 'qa-j'"))[0]?.["n"] === 0 },
];
