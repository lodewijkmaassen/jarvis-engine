-- Jarvis V3 — fundament: taakregister, mandaat, eigenaarsverzoeken, gebeurtenissen.
--
-- Eén bron van waarheid voor de taakstatus. De state machine staat in
-- `jarvis.v3_overgang`; een uitvoerder kan een onmogelijke overgang niet
-- maken, ook niet door een vergissing. Geen verwijzing naar V2-tabellen,
-- behalve het lezen van `jarvis.toetsingen` (onveranderbare QA-oordelen).
--
-- Rechten, drie identiteiten:
--   jarvis_werker  (uitvoerder, via de Edge Function) mag uitsluitend de
--                  v3_*-functies voor de uitvoerder aanroepen en de werkviews
--                  lezen; geen directe schrijfrechten op de tabellen.
--   jarvis_ci      (de V3-workflow, via een eigen verbindingsreeks die alleen
--                  als GitHub-secret bestaat) is de ENIGE die kan vastleggen
--                  dat een pull request is samengevoegd (v3_ci_samengevoegd)
--                  en dat de eindcontrole is geslaagd (v3_ci_eindcontrole).
--                  De uitvoerder kan dus nooit zelf UITROL of KLAAR bereiken.
--   authenticated  (de ingelogde eigenaar in de app) mag uitsluitend de
--                  eigenaarsfuncties aanroepen en de eigenaarsviews lezen --
--                  en alleen als v3_is_eigenaar() waar is.
--
-- BOOTSTRAP (eenmalig, door een rol met rechten; zonder deze stap is NIEMAND
-- eigenaar en weigert elke eigenaarsfunctie -- de veilige standaard):
--   insert into jarvis.v3_instellingen (sleutel, waarde) values ('eigenaar_uid', '<auth.users.id van de eigenaar>');
--   create role jarvis_ci login password '<...>';   -- alleen schema-rechten, geen eigenaar van jarvis
-- Daarna draait deze migratie opnieuw (idempotent) zodat de rechten voor
-- jarvis_ci worden toegekend.
--
-- Idempotent: opnieuw uitvoeren verandert niets.

create schema if not exists jarvis;

-- ---------------------------------------------------------------- instellingen
create table if not exists jarvis.v3_instellingen (
  sleutel text primary key,
  waarde  text not null
);

-- ------------------------------------------------------------------- mandaten
create table if not exists jarvis.v3_mandaten (
  id             uuid primary key default gen_random_uuid(),
  taak_id        text not null,
  versie         int  not null default 1,
  doel           text not null,
  acceptatie     jsonb not null,
  repos          text[] not null,
  paden_ja       text[] not null,
  paden_nee      text[] not null,
  productie      boolean not null default false,
  migraties      boolean not null default false,
  destructief    boolean not null default false,
  kosten_max_eur numeric not null default 0,
  inhoud_hash    text not null,
  gegeven_op     timestamptz not null default now(),
  unique (taak_id, versie)
);

-- ---------------------------------------------------------------------- taken
create table if not exists jarvis.v3_taken (
  id             text primary key,
  titel          text not null,
  opdracht       text not null,
  toestand       text not null default 'ONTVANGEN' check (toestand in
    ('ONTVANGEN','ANALYSE','AKKOORD_NODIG','UITVOEREN','BESLISSING_NODIG',
     'CONTROLE','UITROL','EINDCONTROLE','KLAAR','MISLUKT')),
  mandaat_id     uuid references jarvis.v3_mandaten(id),
  blokkade       text,
  poging         int not null default 0,
  lease_houder   text,
  lease_tot      timestamptz,
  bron_bericht   text,
  pr             jsonb,
  eindcontrole   jsonb,
  aangemaakt_op  timestamptz not null default now(),
  toestand_sinds timestamptz not null default now(),
  afgerond_op    timestamptz
);

create table if not exists jarvis.v3_verzoeken (
  id            uuid primary key default gen_random_uuid(),
  taak_id       text not null references jarvis.v3_taken(id),
  type          text not null check (type in ('akkoord','beslissing','handeling')),
  sleutel       text not null,
  vraag         text not null,
  opties        jsonb,
  verificatie   jsonb,
  status        text not null default 'open' check (status in ('open','gesloten','vervallen')),
  antwoord      text,
  gesloten_door text check (gesloten_door in ('eigenaar','meting')),
  geopend_op    timestamptz not null default now(),
  gesloten_op   timestamptz,
  unique (taak_id, sleutel),
  check (type <> 'handeling' or verificatie is not null)
);

create table if not exists jarvis.v3_gebeurtenissen (
  id      bigserial primary key,
  op      timestamptz not null default now(),
  taak_id text not null,
  actor   text not null,
  soort   text not null,
  data    jsonb not null default '{}'::jsonb
);

-- --------------------------------------------------------------- onveranderlijk
create or replace function jarvis.v3_onveranderlijk() returns trigger
language plpgsql as $$
begin
  raise exception 'v3: % op % is niet toegestaan (onveranderlijk)', tg_op, tg_table_name using errcode = 'P0001';
end $$;

drop trigger if exists v3_mandaten_vast on jarvis.v3_mandaten;
create trigger v3_mandaten_vast before update or delete on jarvis.v3_mandaten
  for each row execute function jarvis.v3_onveranderlijk();
drop trigger if exists v3_gebeurtenissen_vast on jarvis.v3_gebeurtenissen;
create trigger v3_gebeurtenissen_vast before update or delete on jarvis.v3_gebeurtenissen
  for each row execute function jarvis.v3_onveranderlijk();

create or replace function jarvis.v3_taak_vast() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id or new.opdracht is distinct from old.opdracht
     or new.titel is distinct from old.titel or new.aangemaakt_op is distinct from old.aangemaakt_op then
    raise exception 'v3: id, titel en opdracht van een taak zijn onveranderlijk' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists v3_taak_vast on jarvis.v3_taken;
create trigger v3_taak_vast before update on jarvis.v3_taken
  for each row execute function jarvis.v3_taak_vast();

-- Een verzoek wordt nooit heropend en nooit verwijderd.
create or replace function jarvis.v3_verzoek_vast() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'v3: een verzoek wordt niet verwijderd' using errcode = 'P0001';
  end if;
  if old.status <> 'open' and (new.status is distinct from old.status or new.antwoord is distinct from old.antwoord) then
    raise exception 'v3: een gesloten verzoek wordt niet heropend of gewijzigd' using errcode = 'P0001';
  end if;
  if new.type is distinct from old.type or new.sleutel is distinct from old.sleutel
     or new.taak_id is distinct from old.taak_id or new.vraag is distinct from old.vraag then
    raise exception 'v3: type, sleutel, taak en vraag van een verzoek zijn onveranderlijk' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists v3_verzoek_vast on jarvis.v3_verzoeken;
create trigger v3_verzoek_vast before update or delete on jarvis.v3_verzoeken
  for each row execute function jarvis.v3_verzoek_vast();

-- ------------------------------------------------------------------ hulpfuncties
create or replace function jarvis.v3_log(p_taak text, p_actor text, p_soort text, p_data jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = jarvis, pg_temp as $$
  insert into jarvis.v3_gebeurtenissen (taak_id, actor, soort, data) values (p_taak, p_actor, p_soort, coalesce(p_data, '{}'::jsonb));
$$;

-- Paden die nooit in een mandaat horen: de veiligheidsgrens van Jarvis zelf.
create or replace function jarvis.v3_verboden_pad(p text) returns boolean
language sql immutable as $$
  select p ~ '^\*' or p = '**' or p ~ '^\.github(/|$)' or p ~* '(^|/)CODEOWNERS$'
      or p ~* '(^|/)jarvis\.config\.yml$' or p ~ '^jarvis/(src|canonical|edge|migrations)(/|$)'
      or p ~ '^\.claude(/|$)'
$$;

create or replace function jarvis.v3_mandaat_check(m jsonb) returns text
language plpgsql immutable as $$
declare a jsonb; p text;
begin
  if coalesce(m->>'doel','') = '' then return 'doel ontbreekt'; end if;
  if coalesce(jsonb_typeof(m->'acceptatie'), '') <> 'array' or jsonb_array_length(m->'acceptatie') = 0 then return 'acceptatie ontbreekt'; end if;
  for a in select * from jsonb_array_elements(m->'acceptatie') loop
    if coalesce(a->>'id','') = '' or coalesce(a->>'omschrijving','') = '' then return 'elk acceptatiecriterium heeft id en omschrijving'; end if;
    if coalesce(a#>>'{meting,soort}','') not in ('http','ci','sql') then return 'elk criterium heeft een meting (http, ci of sql)'; end if;
  end loop;
  if coalesce(jsonb_typeof(m->'repos'), '') <> 'array' or jsonb_array_length(m->'repos') = 0 then return 'repos ontbreekt'; end if;
  if coalesce(jsonb_typeof(m->'paden_ja'), '') <> 'array' or jsonb_array_length(m->'paden_ja') = 0 then return 'paden_ja ontbreekt'; end if;
  for p in select jsonb_array_elements_text(m->'paden_ja') loop
    if jarvis.v3_verboden_pad(p) then return format('pad %s hoort niet in een mandaat (veiligheidsgrens)', p); end if;
  end loop;
  return null;
end $$;

-- ----------------------------------------------------- uitvoerder: taken en leases
create or replace function jarvis.v3_nieuwe_taak(p_id text, p_titel text, p_opdracht text, p_bron text default null)
returns text language plpgsql security definer set search_path = jarvis, pg_temp as $$
begin
  if p_id !~ '^V3-[0-9]{8}-[a-z0-9-]{2,40}$' then raise exception 'v3: ongeldig taak-id %', p_id; end if;
  insert into jarvis.v3_taken (id, titel, opdracht, bron_bericht) values (p_id, p_titel, p_opdracht, p_bron)
    on conflict (id) do nothing;
  perform jarvis.v3_log(p_id, 'jarvis', 'ontvangen', jsonb_build_object('bron', p_bron));
  return p_id;
end $$;

create or replace function jarvis.v3_pak(p_taak text, p_houder text, p_minuten int default 40)
returns boolean language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare n int;
begin
  update jarvis.v3_taken
     set lease_houder = p_houder, lease_tot = now() + make_interval(mins => least(greatest(p_minuten, 1), 120)),
         poging = case when lease_houder is distinct from p_houder then poging + 1 else poging end
   where id = p_taak and toestand not in ('KLAAR','MISLUKT','AKKOORD_NODIG','BESLISSING_NODIG')
     and (lease_houder is null or lease_tot < now() or lease_houder = p_houder);
  get diagnostics n = row_count;
  if n = 1 then perform jarvis.v3_log(p_taak, p_houder, 'lease', '{}'::jsonb); end if;
  return n = 1;
end $$;

create or replace function jarvis.v3_hartslag(p_taak text, p_houder text, p_minuten int default 40)
returns boolean language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare n int;
begin
  update jarvis.v3_taken set lease_tot = now() + make_interval(mins => least(greatest(p_minuten, 1), 120))
   where id = p_taak and lease_houder = p_houder and lease_tot >= now();
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function jarvis.v3_blokkade(p_taak text, p_houder text, p_tekst text)
returns void language plpgsql security definer set search_path = jarvis, pg_temp as $$
begin
  update jarvis.v3_taken set blokkade = nullif(p_tekst, '') where id = p_taak and lease_houder = p_houder;
  perform jarvis.v3_log(p_taak, p_houder, case when coalesce(p_tekst,'') = '' then 'blokkade_op' else 'blokkade' end,
                        jsonb_build_object('tekst', p_tekst));
end $$;

-- Verlopen leases vrijgeven. De dispatcher roept dit aan; geen Claude-sessie nodig.
create or replace function jarvis.v3_watchdog()
returns table (taak_id text, toestand text, reden text)
language plpgsql security definer set search_path = jarvis, pg_temp as $$
begin
  update jarvis.v3_taken u set lease_houder = null, lease_tot = null
   where u.lease_tot < now() and u.toestand not in ('KLAAR','MISLUKT');
  return query
    select t.id, t.toestand, case when t.lease_houder is null then 'uitvoerbaar, geen uitvoerder' else 'in uitvoering' end
      from jarvis.v3_taken t
     where t.toestand in ('ONTVANGEN','ANALYSE','UITVOEREN','CONTROLE','UITROL','EINDCONTROLE')
       and t.lease_houder is null;
end $$;

-- De dispatcher mag hoogstens één keer per rustperiode de routine starten.
create or replace function jarvis.v3_dispatch_claim(p_rust_min int default 20) returns boolean
language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare laatste timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('jarvis.v3_dispatch'));
  select max(op) into laatste from jarvis.v3_gebeurtenissen where taak_id = '-' and soort = 'dispatch';
  if laatste is not null and laatste > now() - make_interval(mins => greatest(p_rust_min, 1)) then return false; end if;
  insert into jarvis.v3_gebeurtenissen (taak_id, actor, soort, data) values ('-', 'dispatcher', 'dispatch', '{}'::jsonb);
  return true;
end $$;

-- ------------------------------------------------------------ uitvoerder: verzoeken
create or replace function jarvis.v3_vraag(p_taak text, p_type text, p_sleutel text, p_vraag text,
                                           p_opties jsonb default null, p_verificatie jsonb default null)
returns table (id uuid, status text)
language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare r jarvis.v3_verzoeken%rowtype;
begin
  if not exists (select 1 from jarvis.v3_taken where jarvis.v3_taken.id = p_taak) then raise exception 'v3: onbekende taak %', p_taak; end if;
  if p_type = 'akkoord' then raise exception 'v3: een akkoord opent alleen v3_vraag_akkoord'; end if;
  if p_sleutel like 'mandaat-%' then raise exception 'v3: de sleutel % is gereserveerd voor het mandaat', p_sleutel; end if;
  insert into jarvis.v3_verzoeken (taak_id, type, sleutel, vraag, opties, verificatie)
    values (p_taak, p_type, p_sleutel, p_vraag, p_opties, p_verificatie)
    on conflict (taak_id, sleutel) do nothing;
  select * into r from jarvis.v3_verzoeken v where v.taak_id = p_taak and v.sleutel = p_sleutel;
  if r.type <> p_type then raise exception 'v3: sleutel % is al in gebruik voor een ander type', p_sleutel; end if;
  perform jarvis.v3_log(p_taak, 'jarvis', 'verzoek', jsonb_build_object('type', p_type, 'sleutel', p_sleutel, 'status', r.status));
  if p_type = 'beslissing' and r.status = 'open' then
    update jarvis.v3_taken set toestand = 'BESLISSING_NODIG', toestand_sinds = now(), lease_houder = null, lease_tot = null
     where jarvis.v3_taken.id = p_taak and toestand = 'UITVOEREN';
  end if;
  return query select r.id, r.status;
end $$;

-- ANALYSE -> AKKOORD_NODIG: precies één akkoordverzoek met het mandaatvoorstel.
create or replace function jarvis.v3_vraag_akkoord(p_taak text, p_voorstel jsonb)
returns uuid language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare fout text; v uuid; t jarvis.v3_taken%rowtype;
begin
  select * into t from jarvis.v3_taken where id = p_taak for update;
  if not found or t.toestand <> 'ANALYSE' then raise exception 'v3: akkoord vragen kan alleen in ANALYSE'; end if;
  fout := jarvis.v3_mandaat_check(p_voorstel);
  if fout is not null then raise exception 'v3: mandaatvoorstel ongeldig: %', fout; end if;
  insert into jarvis.v3_verzoeken (taak_id, type, sleutel, vraag, opties)
    values (p_taak, 'akkoord', 'mandaat-1', 'Akkoord op het mandaat voor ' || t.titel, p_voorstel)
    on conflict (taak_id, sleutel) do nothing;
  select id into v from jarvis.v3_verzoeken where taak_id = p_taak and sleutel = 'mandaat-1';
  update jarvis.v3_taken set toestand = 'AKKOORD_NODIG', toestand_sinds = now(), lease_houder = null, lease_tot = null where id = p_taak;
  perform jarvis.v3_log(p_taak, 'jarvis', 'toestand', jsonb_build_object('van','ANALYSE','naar','AKKOORD_NODIG'));
  return v;
end $$;

create or replace function jarvis.v3_meet_verzoek(p_id uuid, p_uitkomst jsonb)
returns text language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare r jarvis.v3_verzoeken%rowtype;
begin
  select * into r from jarvis.v3_verzoeken where id = p_id for update;
  if not found then raise exception 'v3: onbekend verzoek'; end if;
  if r.type <> 'handeling' then raise exception 'v3: alleen een handeling sluit door meting'; end if;
  if r.status <> 'open' then return r.status; end if;
  if coalesce((p_uitkomst->>'geslaagd')::boolean, false) then
    update jarvis.v3_verzoeken set status = 'gesloten', gesloten_door = 'meting', gesloten_op = now(),
           antwoord = left(coalesce(p_uitkomst->>'bewijs',''), 2000) where id = p_id;
    perform jarvis.v3_log(r.taak_id, 'jarvis', 'verzoek_gemeten', jsonb_build_object('sleutel', r.sleutel));
    return 'gesloten';
  end if;
  return 'open';
end $$;

-- ------------------------------------------------------- uitvoerder: overgangen
-- Toegestane overgangen die de uitvoerder zelf mag maken, met hun voorwaarden.
create or replace function jarvis.v3_overgang(p_taak text, p_houder text, p_naar text, p_bewijs jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare t jarvis.v3_taken%rowtype; m jarvis.v3_mandaten%rowtype; ok boolean := false;
begin
  select * into t from jarvis.v3_taken where id = p_taak for update;
  if not found then raise exception 'v3: onbekende taak %', p_taak; end if;
  if t.lease_houder is distinct from p_houder or t.lease_tot is null or t.lease_tot < now() then
    raise exception 'v3: % heeft geen geldige lease op %', p_houder, p_taak;
  end if;
  if t.mandaat_id is not null then select * into m from jarvis.v3_mandaten where id = t.mandaat_id; end if;

  if t.toestand = 'ONTVANGEN' and p_naar = 'ANALYSE' then ok := true;
  elsif t.toestand = 'UITVOEREN' and p_naar = 'CONTROLE' then
    if coalesce(p_bewijs#>>'{pr,repo}','') = '' or coalesce(p_bewijs#>>'{pr,nummer}','') = '' or coalesce(p_bewijs#>>'{pr,sha}','') = '' then
      raise exception 'v3: CONTROLE vraagt bewijs.pr met repo, nummer en sha';
    end if;
    if not (m.repos @> array[p_bewijs#>>'{pr,repo}']) then raise exception 'v3: repo valt buiten het mandaat'; end if;
    update jarvis.v3_taken set pr = p_bewijs->'pr' where id = p_taak;
    ok := true;
  elsif t.toestand = 'CONTROLE' and p_naar = 'UITVOEREN' then ok := true;
  elsif t.toestand = 'UITROL' and p_naar = 'EINDCONTROLE' then
    if m.productie and coalesce((p_bewijs->>'gedeployed')::boolean, false) is not true then
      raise exception 'v3: bij productie=true vraagt EINDCONTROLE bewijs.gedeployed=true';
    end if;
    ok := true;
  elsif t.toestand = 'EINDCONTROLE' and p_naar = 'UITVOEREN' then ok := true;
  elsif p_naar = 'MISLUKT' and t.toestand not in ('KLAAR','MISLUKT') then
    if coalesce(p_bewijs->>'reden','') = '' then raise exception 'v3: MISLUKT vraagt bewijs.reden'; end if;
    update jarvis.v3_taken set afgerond_op = now() where id = p_taak;
    ok := true;
  end if;

  if not ok then raise exception 'v3: overgang % -> % is niet toegestaan voor de uitvoerder', t.toestand, p_naar; end if;
  update jarvis.v3_taken set toestand = p_naar, toestand_sinds = now(), blokkade = null,
         lease_houder = case when p_naar in ('KLAAR','MISLUKT') then null else lease_houder end,
         lease_tot = case when p_naar in ('KLAAR','MISLUKT') then null else lease_tot end
   where id = p_taak;
  perform jarvis.v3_log(p_taak, p_houder, 'toestand', jsonb_build_object('van', t.toestand, 'naar', p_naar) || coalesce(p_bewijs - 'eindcontrole', '{}'::jsonb));
  return p_naar;
end $$;

-- ----------------------------------------------------------------- CI-identiteit
-- Alleen jarvis_ci krijgt EXECUTE op deze functies. De uitvoerder (jarvis_werker)
-- kan "samengevoegd" en "geslaagd" dus niet zelf vastleggen: die twee feiten
-- komen uit de workflow, die GitHub en de productie zelf raadpleegt.

-- Een pull request is samengevoegd: de taak gaat naar UITROL. De pull request
-- wordt hier door de CI vastgelegd (niet door de uitvoerder), op grond van
-- trailer, mandaat en GO-toetsing die de CI zelf heeft gecontroleerd.
create or replace function jarvis.v3_ci_samengevoegd(p_taak text, p_repo text, p_nummer int, p_kop text, p_merge_sha text)
returns text language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare t jarvis.v3_taken%rowtype; m jarvis.v3_mandaten%rowtype; n int;
begin
  select * into t from jarvis.v3_taken where id = p_taak for update;
  if not found then raise exception 'v3: onbekende taak %', p_taak; end if;
  if t.toestand not in ('UITVOEREN','CONTROLE') then raise exception 'v3: % staat in %, niet in UITVOEREN of CONTROLE', p_taak, t.toestand; end if;
  select * into m from jarvis.v3_mandaten where id = t.mandaat_id;
  if not found then raise exception 'v3: % heeft geen mandaat', p_taak; end if;
  if not (m.repos @> array[p_repo]) then raise exception 'v3: repo % valt buiten het mandaat', p_repo; end if;
  select count(*) into n from jarvis.toetsingen
   where pr_repo = p_repo and pr_nummer = p_nummer and commit_sha = p_kop and oordeel = 'GO';
  if n = 0 then raise exception 'v3: geen toetsing GO op de kop %', p_kop; end if;
  if coalesce(p_merge_sha, '') !~ '^[0-9a-f]{7,40}$' then raise exception 'v3: ongeldige merge-sha'; end if;
  update jarvis.v3_taken set toestand = 'UITROL', toestand_sinds = now(), blokkade = null,
         pr = jsonb_build_object('repo', p_repo, 'nummer', p_nummer, 'sha', p_kop, 'merge_sha', p_merge_sha),
         lease_houder = null, lease_tot = null
   where id = p_taak;
  perform jarvis.v3_log(p_taak, 'ci', 'toestand', jsonb_build_object('van', t.toestand, 'naar', 'UITROL', 'pr', p_nummer, 'merge_sha', p_merge_sha));
  return 'UITROL';
end $$;

-- De eindcontrole: KLAAR alleen als elk criterium van het mandaat door de CI
-- gemeten geslaagd is; anders terug naar UITVOEREN.
create or replace function jarvis.v3_ci_eindcontrole(p_taak text, p_meting jsonb)
returns text language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare t jarvis.v3_taken%rowtype; m jarvis.v3_mandaten%rowtype; krit jsonb; gevonden boolean; alles boolean := true; naar text;
begin
  select * into t from jarvis.v3_taken where id = p_taak for update;
  if not found then raise exception 'v3: onbekende taak %', p_taak; end if;
  if t.toestand <> 'EINDCONTROLE' then raise exception 'v3: % staat in %, niet in EINDCONTROLE', p_taak, t.toestand; end if;
  if coalesce(jsonb_typeof(p_meting), '') <> 'array' then raise exception 'v3: de meting moet een lijst zijn'; end if;
  select * into m from jarvis.v3_mandaten where id = t.mandaat_id;
  for krit in select e from jarvis.v3_mandaten x, jsonb_array_elements(x.acceptatie) e where x.id = m.id loop
    select exists (select 1 from jsonb_array_elements(p_meting) e2
                    where e2->>'criterium' = krit->>'id' and e2->>'uitkomst' = 'geslaagd'
                      and coalesce(e2->>'bewijs','') <> '' and coalesce(e2->>'gemeten_op','') <> '') into gevonden;
    if not gevonden then alles := false; end if;
  end loop;
  naar := case when alles then 'KLAAR' else 'UITVOEREN' end;
  update jarvis.v3_taken set toestand = naar, toestand_sinds = now(), eindcontrole = p_meting,
         afgerond_op = case when alles then now() else null end,
         lease_houder = null, lease_tot = null
   where id = p_taak;
  perform jarvis.v3_log(p_taak, 'ci', 'eindcontrole', jsonb_build_object('naar', naar));
  return naar;
end $$;

-- --------------------------------------------------------------------- eigenaar
create or replace function jarvis.v3_is_eigenaar() returns boolean
language plpgsql stable security definer set search_path = jarvis, pg_temp as $$
declare uid text;
begin
  begin uid := (select auth.uid())::text; exception when others then uid := null; end;
  if uid is null then return false; end if;
  -- Faalt gesloten: zonder vastgelegde eigenaar is niemand eigenaar.
  return exists (select 1 from jarvis.v3_instellingen where sleutel = 'eigenaar_uid' and waarde = uid);
end $$;

create or replace function jarvis.v3_schrijf_mandaat(p_taak text, p_m jsonb, p_versie int) returns uuid
language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare fout text; id uuid; nee text[];
begin
  fout := jarvis.v3_mandaat_check(p_m);
  if fout is not null then raise exception 'v3: mandaat ongeldig: %', fout; end if;
  nee := array(select jsonb_array_elements_text(coalesce(p_m->'paden_nee','[]'::jsonb)));
  nee := nee || array['.github/**','**/CODEOWNERS','**/jarvis.config.yml','jarvis/src/**','jarvis/canonical/**','jarvis/edge/**','jarvis/migrations/**','.claude/**'];
  insert into jarvis.v3_mandaten (taak_id, versie, doel, acceptatie, repos, paden_ja, paden_nee, productie, migraties, destructief, kosten_max_eur, inhoud_hash)
  values (p_taak, p_versie, p_m->>'doel', p_m->'acceptatie',
          array(select jsonb_array_elements_text(p_m->'repos')), array(select jsonb_array_elements_text(p_m->'paden_ja')),
          (select array_agg(distinct x) from unnest(nee) x),
          coalesce((p_m->>'productie')::boolean, false), coalesce((p_m->>'migraties')::boolean, false),
          coalesce((p_m->>'destructief')::boolean, false), coalesce((p_m->>'kosten_max_eur')::numeric, 0),
          encode(sha256(convert_to(p_m::text, 'UTF8')), 'hex'))
  returning jarvis.v3_mandaten.id into id;
  return id;
end $$;

-- AKKOORD_NODIG -> UITVOEREN: de enige plek waar een mandaat ontstaat.
create or replace function jarvis.v3_geef_mandaat(p_taak text) returns uuid
language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare t jarvis.v3_taken%rowtype; v jarvis.v3_verzoeken%rowtype; mid uuid;
begin
  if not jarvis.v3_is_eigenaar() then raise exception 'v3: alleen de eigenaar mag een mandaat geven'; end if;
  select * into t from jarvis.v3_taken where id = p_taak for update;
  if not found or t.toestand <> 'AKKOORD_NODIG' then raise exception 'v3: geen akkoord openstaand voor %', p_taak; end if;
  select * into v from jarvis.v3_verzoeken where taak_id = p_taak and sleutel = 'mandaat-1' and status = 'open' for update;
  if not found then raise exception 'v3: geen open akkoordverzoek'; end if;
  mid := jarvis.v3_schrijf_mandaat(p_taak, v.opties, 1);
  update jarvis.v3_verzoeken set status = 'gesloten', gesloten_door = 'eigenaar', gesloten_op = now(), antwoord = 'akkoord' where id = v.id;
  update jarvis.v3_taken set toestand = 'UITVOEREN', toestand_sinds = now(), mandaat_id = mid where id = p_taak;
  perform jarvis.v3_log(p_taak, 'eigenaar', 'mandaat', jsonb_build_object('mandaat', mid));
  return mid;
end $$;

-- De opdracht van de eigenaar zelf: een taak in ONTVANGEN, buiten het berichtenkanaal
-- van V2 om, zodat een V2-uitvoerder haar nooit oppakt.
create or replace function jarvis.v3_nieuwe_opdracht(p_titel text, p_opdracht text) returns text
language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare slug text; nid text; n int := 1;
begin
  if not jarvis.v3_is_eigenaar() then raise exception 'v3: alleen de eigenaar geeft een opdracht'; end if;
  if coalesce(trim(p_titel), '') = '' or coalesce(trim(p_opdracht), '') = '' then raise exception 'v3: titel en opdracht zijn verplicht'; end if;
  slug := trim(both '-' from regexp_replace(lower(p_titel), '[^a-z0-9]+', '-', 'g'));
  slug := left(coalesce(nullif(slug, ''), 'opdracht'), 30);
  slug := trim(both '-' from slug);
  if length(slug) < 2 then slug := 'opdracht'; end if;
  nid := 'V3-' || to_char(now() at time zone 'utc', 'YYYYMMDD') || '-' || slug;
  while exists (select 1 from jarvis.v3_taken where jarvis.v3_taken.id = nid) loop
    n := n + 1;
    nid := 'V3-' || to_char(now() at time zone 'utc', 'YYYYMMDD') || '-' || left(slug, 36) || '-' || n;
  end loop;
  insert into jarvis.v3_taken (id, titel, opdracht) values (nid, trim(p_titel), trim(p_opdracht));
  perform jarvis.v3_log(nid, 'eigenaar', 'opdracht', '{}'::jsonb);
  return nid;
end $$;

create or replace function jarvis.v3_wijs_af(p_taak text) returns void
language plpgsql security definer set search_path = jarvis, pg_temp as $$
begin
  if not jarvis.v3_is_eigenaar() then raise exception 'v3: alleen de eigenaar'; end if;
  update jarvis.v3_verzoeken set status = 'gesloten', gesloten_door = 'eigenaar', gesloten_op = now(), antwoord = 'afgewezen'
   where taak_id = p_taak and status = 'open' and type = 'akkoord';
  update jarvis.v3_taken set toestand = 'MISLUKT', toestand_sinds = now(), afgerond_op = now()
   where id = p_taak and toestand = 'AKKOORD_NODIG';
  perform jarvis.v3_log(p_taak, 'eigenaar', 'afgewezen', '{}'::jsonb);
end $$;

-- BESLISSING_NODIG -> UITVOEREN. Een beslissing mag het mandaat verruimen via een nieuw mandaat.
create or replace function jarvis.v3_beantwoord(p_verzoek uuid, p_antwoord text, p_nieuw_mandaat jsonb default null) returns void
language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare v jarvis.v3_verzoeken%rowtype; t jarvis.v3_taken%rowtype; mid uuid; ver int;
begin
  if not jarvis.v3_is_eigenaar() then raise exception 'v3: alleen de eigenaar'; end if;
  select * into v from jarvis.v3_verzoeken where id = p_verzoek for update;
  if not found or v.type <> 'beslissing' or v.status <> 'open' then raise exception 'v3: geen open beslissing'; end if;
  select * into t from jarvis.v3_taken where id = v.taak_id for update;
  update jarvis.v3_verzoeken set status = 'gesloten', gesloten_door = 'eigenaar', gesloten_op = now(), antwoord = p_antwoord where id = p_verzoek;
  if p_nieuw_mandaat is not null then
    select coalesce(max(versie), 0) + 1 into ver from jarvis.v3_mandaten where taak_id = v.taak_id;
    mid := jarvis.v3_schrijf_mandaat(v.taak_id, p_nieuw_mandaat, ver);
    update jarvis.v3_taken set mandaat_id = mid where id = v.taak_id;
  end if;
  if t.toestand = 'BESLISSING_NODIG' and not exists (select 1 from jarvis.v3_verzoeken where taak_id = v.taak_id and type = 'beslissing' and status = 'open') then
    update jarvis.v3_taken set toestand = 'UITVOEREN', toestand_sinds = now() where id = v.taak_id;
  end if;
  perform jarvis.v3_log(v.taak_id, 'eigenaar', 'beslissing', jsonb_build_object('sleutel', v.sleutel));
end $$;

-- ----------------------------------------------------------------------- views
-- Eigenaarsviews: leeg voor iedereen die niet de vastgelegde eigenaar is.
create or replace view jarvis.v3_voor_jou as
  select v.id, v.taak_id, v.type, v.vraag, v.opties, v.geopend_op, t.titel
    from jarvis.v3_verzoeken v join jarvis.v3_taken t on t.id = v.taak_id
   where jarvis.v3_is_eigenaar() and v.status = 'open' and v.type in ('akkoord','beslissing');

create or replace view jarvis.v3_actueel as
  select t.id, t.titel, t.toestand, t.blokkade, t.poging, t.lease_houder, t.lease_tot, t.toestand_sinds, t.pr, t.eindcontrole, t.afgerond_op,
         (select count(*) from jarvis.v3_verzoeken v where v.taak_id = t.id and v.status = 'open' and v.type in ('akkoord','beslissing')) as open_verzoeken
    from jarvis.v3_taken t where jarvis.v3_is_eigenaar();

-- Werkweergave voor de uitvoerder en de CI: alle taken, zonder eigenaarsfilter.
create or replace view jarvis.v3_actueel_werk as
  select t.id, t.titel, t.toestand, t.blokkade, t.poging, t.lease_houder, t.lease_tot, t.toestand_sinds, t.pr, t.eindcontrole, t.afgerond_op,
         (select count(*) from jarvis.v3_verzoeken v where v.taak_id = t.id and v.status = 'open' and v.type in ('akkoord','beslissing')) as open_verzoeken
    from jarvis.v3_taken t;

-- Leesweg voor de uitvoerder: taak + het geldende mandaat, en alle verzoeken.
create or replace view jarvis.v3_werk as
  select t.id, t.titel, t.opdracht, t.toestand, t.blokkade, t.poging, t.lease_houder, t.lease_tot, t.pr,
         t.toestand_sinds, t.mandaat_id,
         m.versie as mandaat_versie, m.doel, m.acceptatie, m.repos, m.paden_ja, m.paden_nee,
         m.productie, m.migraties, m.destructief, m.kosten_max_eur
    from jarvis.v3_taken t left join jarvis.v3_mandaten m on m.id = t.mandaat_id;

create or replace view jarvis.v3_verzoeken_zicht as
  select id, taak_id, type, sleutel, vraag, opties, verificatie, status, antwoord, gesloten_door, geopend_op, gesloten_op
    from jarvis.v3_verzoeken;

-- ----------------------------------------------------------------------- rechten
alter table jarvis.v3_instellingen enable row level security;
alter table jarvis.v3_mandaten enable row level security;
alter table jarvis.v3_taken enable row level security;
alter table jarvis.v3_verzoeken enable row level security;
alter table jarvis.v3_gebeurtenissen enable row level security;

-- Alleen V3-objecten. Rechten op V2-tabellen blijven uitdrukkelijk ongemoeid.
do $$
declare r text; f text;
begin
  for r in select unnest(array['jarvis_werker','jarvis_ci','authenticated']) loop
    continue when not exists (select 1 from pg_roles where rolname = r);
    execute format('revoke all on jarvis.v3_instellingen, jarvis.v3_mandaten, jarvis.v3_taken, jarvis.v3_verzoeken, jarvis.v3_gebeurtenissen from %I', r);
    execute format('revoke all on jarvis.v3_voor_jou, jarvis.v3_actueel, jarvis.v3_actueel_werk, jarvis.v3_werk, jarvis.v3_verzoeken_zicht from %I', r);
    execute format('grant usage on schema jarvis to %I', r);
  end loop;
  -- Functies: standaard voor niemand, daarna per rol.
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'jarvis' and p.proname like 'v3\_%' loop
    execute format('revoke all on function %s from public', f);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'jarvis_werker') then
    grant select on jarvis.v3_actueel_werk, jarvis.v3_werk, jarvis.v3_verzoeken_zicht to jarvis_werker;
    grant execute on function
      jarvis.v3_nieuwe_taak(text,text,text,text), jarvis.v3_pak(text,text,int), jarvis.v3_hartslag(text,text,int),
      jarvis.v3_blokkade(text,text,text), jarvis.v3_watchdog(), jarvis.v3_dispatch_claim(int), jarvis.v3_vraag(text,text,text,text,jsonb,jsonb),
      jarvis.v3_vraag_akkoord(text,jsonb), jarvis.v3_meet_verzoek(uuid,jsonb), jarvis.v3_overgang(text,text,text,jsonb)
      to jarvis_werker;
  end if;
  if exists (select 1 from pg_roles where rolname = 'jarvis_ci') then
    grant select on jarvis.v3_actueel_werk, jarvis.v3_werk, jarvis.v3_verzoeken_zicht to jarvis_ci;
    grant select on jarvis.toetsingen to jarvis_ci;
    grant execute on function
      jarvis.v3_watchdog(), jarvis.v3_dispatch_claim(int),
      jarvis.v3_ci_samengevoegd(text,text,int,text,text), jarvis.v3_ci_eindcontrole(text,jsonb)
      to jarvis_ci;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on jarvis.v3_voor_jou, jarvis.v3_actueel to authenticated;
    grant execute on function
      jarvis.v3_geef_mandaat(text), jarvis.v3_wijs_af(text), jarvis.v3_beantwoord(uuid,text,jsonb), jarvis.v3_nieuwe_opdracht(text,text),
      jarvis.v3_is_eigenaar()   -- nodig voor de eigenaarsviews: functies in een view worden met de rechten van de aanroeper getoetst
      to authenticated;
  end if;
end $$;
