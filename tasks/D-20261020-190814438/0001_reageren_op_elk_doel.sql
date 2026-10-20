-- Doel D-20261020-190814438 — "Verbeter de taakweergave in Jarvis V3".
--
-- De eigenaar wil bij elk doel (lopend, klaar, gesloten, vastgelopen) vanuit V3 kunnen reageren. De reactie wordt
-- bij dat doel bewaard (onder de opdracht). Staat het doel stil (klaar, gesloten, vast), dan gaat het terug naar
-- 'open' en pakt de uitvoerder het via de bestaande keten weer op. Loopt het nog (open, bezig, review,
-- samengevoegd), dan blijft de status staan; de uitvoerder leest de reactie bij zijn volgende lezing van de opdracht.
-- Sluiten blijft alleen voor een vastgelopen doel (doel_sluit is niet gewijzigd).
--
-- Bewaard als dossierbestand, net als 0001_vast_reageren_sluiten.sql, en na de samenvoeging op de database van
-- Jarvis toegepast.

create or replace function jarvis.doel_reageer(p_id text, p_reactie text)
returns text language plpgsql security definer set search_path = jarvis, pg_temp as $$
declare d jarvis.doelen%rowtype; nieuw text;
begin
  if not jarvis.v3_is_eigenaar() then raise exception 'doel: alleen de eigenaar reageert op een doel'; end if;
  if coalesce(trim(p_reactie), '') = '' then raise exception 'doel: schrijf een reactie'; end if;
  select * into d from jarvis.doelen where id = p_id for update;
  if not found then raise exception 'doel: onbekend doel %', p_id; end if;
  nieuw := d.opdracht
    || E'\n\nReactie van de eigenaar (' || to_char(now() at time zone 'Europe/Amsterdam', 'YYYY-MM-DD HH24:MI') || E'):\n'
    || trim(p_reactie);
  if d.status in ('vast', 'klaar', 'gesloten') then
    update jarvis.doelen
       set status = 'open',
           vast_door = null,
           opdracht = nieuw
             || case when coalesce(trim(d.uitkomst), '') <> '' then E'\n\n(Vorige uitkomst: ' || trim(d.uitkomst) || ')' else '' end,
           uitkomst = 'Heropend door de eigenaar met een reactie.',
           bijgewerkt = now()
     where id = p_id;
    return 'open';
  end if;
  update jarvis.doelen set opdracht = nieuw, bijgewerkt = now() where id = p_id;
  return d.status;
end $$;

revoke all on function jarvis.doel_reageer(text, text) from public, anon;
grant execute on function jarvis.doel_reageer(text, text) to authenticated;

-- Een heropend doel start meteen, ook vanuit 'klaar' en 'gesloten' (dezelfde startfunctie als de trigger doel_start).
drop trigger if exists doel_heropend on jarvis.doelen;
create trigger doel_heropend
  after update of status on jarvis.doelen
  for each row when (old.status in ('vast', 'klaar', 'gesloten') and new.status = 'open')
  execute function jarvis.doel_start();
