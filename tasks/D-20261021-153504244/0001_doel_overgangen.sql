-- Doel D-20261021-153504244 — AI Core: historie van doelen reconstrueren, incl. vastlopen en heropening.
--
-- Een statusovergang van een doel werd nergens bewaard: 'doelen' houdt alleen de huidige status, en bij heropenen
-- worden vast_door en uitkomst overschreven. Daardoor kon de AI Core een vastgelopen en hervat doel (#106) niet vinden.
-- Geen tweede historiesysteem: de overgangen komen in de bestaande logtabel jarvis.activiteit (soort 'status'), die de
-- AI Core al raadpleegt. Elke statuswijziging schrijft één regel: "<oud> → <nieuw>" met de reden (uitkomst) en wie.
--
-- Bewaard als dossierbestand, net als 0001_reageren_op_elk_doel.sql, en na de samenvoeging op de database van
-- Jarvis toegepast.

create or replace function jarvis.doel_overgang()
returns trigger language plpgsql security definer set search_path = jarvis, pg_temp as $$
begin
  if new.status is distinct from old.status then
    insert into jarvis.activiteit (uitvoerder, rol, taak, soort, tekst, verwijzing)
    values ('systeem', 'systeem', new.id, 'status',
            old.status || ' → ' || new.status
              || case when new.status in ('vast', 'gesloten', 'klaar') and coalesce(trim(new.uitkomst), '') <> ''
                      then ': ' || left(trim(new.uitkomst), 600) else '' end
              || case when new.vast_door is not null and new.status = 'vast' then ' (vast_door: ' || new.vast_door || ')' else '' end
              || case when old.status in ('vast', 'klaar', 'gesloten') and new.status = 'open' then ' [heropend]' else '' end,
            case when new.pr is not null and new.pr ? 'nummer' then (new.pr->>'repo') || '#' || (new.pr->>'nummer') end);
  end if;
  return new;
end $$;

revoke all on function jarvis.doel_overgang() from public, anon, authenticated;

drop trigger if exists doel_overgang on jarvis.doelen;
create trigger doel_overgang
  after update of status on jarvis.doelen
  for each row execute function jarvis.doel_overgang();

-- Eenmalig aanvullen uit wat er al is: reviewoordelen (toetsingen) en heropening (doelen.heropend_op).
-- Gemarkeerd als afgeleid; de reden van een eerder vastlopen is niet bewaard en wordt niet verzonnen.
insert into jarvis.activiteit (op, uitvoerder, rol, taak, soort, tekst, verwijzing)
select t.op, 'systeem', 'systeem', d.id, 'status',
       '(afgeleid uit toetsingen) review ' || t.oordeel || ' op ' || left(t.commit_sha, 7), t.pr_repo || '#' || t.pr_nummer
  from jarvis.toetsingen t
  join jarvis.doelen d on d.pr->>'repo' = t.pr_repo and (d.pr->>'nummer')::int = t.pr_nummer
 where not exists (select 1 from jarvis.activiteit a
                    where a.taak = d.id and a.soort = 'status' and a.op = t.op);

insert into jarvis.activiteit (op, uitvoerder, rol, taak, soort, tekst, verwijzing)
select d.heropend_op, 'systeem', 'systeem', d.id, 'status',
       '(afgeleid uit heropend_op) vast → open [heropend]; de reden van het vastlopen is niet bewaard', null
  from jarvis.doelen d
 where d.heropend_op is not null
   and not exists (select 1 from jarvis.activiteit a
                    where a.taak = d.id and a.soort = 'status' and a.op = d.heropend_op);
