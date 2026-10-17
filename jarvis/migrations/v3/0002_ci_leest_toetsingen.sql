-- Jarvis V3 — de CI-rol leest de toetsingen.
--
-- 0001 geeft jarvis_ci `select` op jarvis.toetsingen, zodat de V3-poort (sweep) kan zien of er een
-- onafhankelijke toetsing GO op de kop van een pull request staat. Die tabel staat onder geforceerde
-- RLS (V2) met alleen policies voor de eigenaar en jarvis_werker. Zonder policy ziet jarvis_ci nul
-- rijen: de sweep meldde bij elke V3-pull request "geen onafhankelijke toetsing GO op de kop", en geen
-- enkele V3-pull request kon worden samengevoegd (gemeten 2026-10-17 bij acceptatietest H, #276).
--
-- Alleen lezen. Schrijven blijft voorbehouden aan jarvis_werker (werker_schrijft_toetsingen); de
-- tabel is onveranderbaar. Idempotent.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'jarvis_ci')
     and not exists (select 1 from pg_policy where polrelid = 'jarvis.toetsingen'::regclass and polname = 'ci_leest_toetsingen') then
    create policy ci_leest_toetsingen on jarvis.toetsingen for select to jarvis_ci using (true);
  end if;
end $$;
