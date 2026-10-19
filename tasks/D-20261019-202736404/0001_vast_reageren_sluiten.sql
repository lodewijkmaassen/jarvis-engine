-- Doel D-20261019-202736404 — "Vastgelopen taken sluiten of reageren".
--
-- De eigenaar wil bij elk vastgelopen doel vanuit V3:
--   1. reageren met aanvullende informatie/instructie, waarna Jarvis het bestaande doel weer oppakt;
--   2. het doel sluiten, waarna het niet meer onder VASTGELOPEN staat.
--
-- Zelfde opzet als doel_nieuw: twee functies alleen voor de eigenaar (v3_is_eigenaar), en een nieuwe eindstatus
-- 'gesloten' (niet 'klaar': een gesloten doel is niet bereikt). Geen enkele bestaande overgang verandert; de
-- uitvoerder en de CI kennen 'gesloten' niet en kunnen er dus ook niets mee (doel_werk/doel_ci staan geen
-- overgang vanuit 'gesloten' toe; de dispatcher kijkt alleen naar open/bezig/review).
--
-- Bewaard als dossierbestand, net als de migraties van T-20261017-jarvis-vereenvoudigen, en na de samenvoeging
-- op de database van Jarvis toegepast.

alter table jarvis.doelen drop constraint if exists doelen_status_check;
alter table jarvis.doelen add constraint doelen_status_check
  check (status in ('open', 'bezig', 'review', 'samengevoegd', 'klaar', 'vast', 'gesloten'));

-- Reageren: de reactie (met de eerdere blokkade als context) komt onder de opdracht, en het doel gaat terug naar
-- 'open'. De uitvoerder pakt het daar gewoon op (open -> bezig), met de reactie in de opdracht die hij leest.
create or replace function jarvis.doel_reageer(p_id text, p_reactie text)
returns text language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare d jarvis.doelen%rowtype;
begin
  if not jarvis.v3_is_eigenaar() then raise exception 'doel: alleen de eigenaar reageert op een doel'; end if;
  if coalesce(trim(p_reactie), '') = '' then raise exception 'doel: schrijf een reactie'; end if;
  select * into d from jarvis.doelen where id = p_id for update;
  if not found then raise exception 'doel: onbekend doel %', p_id; end if;
  if d.status <> 'vast' then raise exception 'doel: alleen op een vastgelopen doel kun je reageren (nu %)', d.status; end if;
  update jarvis.doelen
     set status = 'open',
         vast_door = null,
         opdracht = d.opdracht
           || E'\n\nReactie van de eigenaar (' || to_char(now() at time zone 'Europe/Amsterdam', 'YYYY-MM-DD HH24:MI') || E'):\n'
           || trim(p_reactie)
           || case when coalesce(trim(d.uitkomst), '') <> '' then E'\n\n(Waar het eerder vastliep: ' || trim(d.uitkomst) || ')' else '' end,
         uitkomst = 'Heropend door de eigenaar met een reactie.',
         bijgewerkt = now()
   where id = p_id;
  return 'open';
end $$;

-- Sluiten: het doel is af voor de eigenaar zonder dat het bereikt is. Het verdwijnt uit de actieve lijsten.
create or replace function jarvis.doel_sluit(p_id text)
returns text language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare d jarvis.doelen%rowtype;
begin
  if not jarvis.v3_is_eigenaar() then raise exception 'doel: alleen de eigenaar sluit een doel'; end if;
  select * into d from jarvis.doelen where id = p_id for update;
  if not found then raise exception 'doel: onbekend doel %', p_id; end if;
  if d.status <> 'vast' then raise exception 'doel: alleen een vastgelopen doel kun je sluiten (nu %)', d.status; end if;
  update jarvis.doelen
     set status = 'gesloten',
         uitkomst = 'Gesloten door de eigenaar.'
           || case when coalesce(trim(d.uitkomst), '') <> '' then ' Waar het vastliep: ' || trim(d.uitkomst) else '' end,
         bijgewerkt = now()
   where id = p_id;
  return 'gesloten';
end $$;

revoke all on function jarvis.doel_reageer(text, text) from public, anon;
revoke all on function jarvis.doel_sluit(text) from public, anon;
grant execute on function jarvis.doel_reageer(text, text) to authenticated;
grant execute on function jarvis.doel_sluit(text) to authenticated;

-- Een heropend doel start meteen, net als een nieuw doel (dezelfde startfunctie als de trigger doel_start).
drop trigger if exists doel_heropend on jarvis.doelen;
create trigger doel_heropend
  after update of status on jarvis.doelen
  for each row when (old.status = 'vast' and new.status = 'open')
  execute function jarvis.doel_start();
