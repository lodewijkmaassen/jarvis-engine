import { describe, expect, it } from "vitest";
import {
  beoordeelEigenSql,
  bezwaarIsBevoegdheid,
  doelVanMigratie,
  hashSql,
  migratieNaam,
} from "../../jarvis/src/eigen-migratie";
import {
  bouwBeoordelingsVraag,
  eindoordeel,
  leesAcceptatieTests,
  parseerBeoordeling,
  volatielBezwaar,
} from "../../jarvis/src/acceptatie";
import { classificeerBlokkade, rendereerBlokkade } from "../../jarvis/src/blokkade";

describe("de eigen migratielane — welk bestand bij welk doel hoort", () => {
  it("herkent SQL in een doeldossier en laat de rest met rust", () => {
    expect(doelVanMigratie("tasks/D-20261021-153504244/0001_doel_overgangen.sql")).toEqual({
      doel: "D-20261021-153504244",
      bestand: "0001_doel_overgangen",
    });
    expect(doelVanMigratie("jarvis-engine/tasks/D-20261019-202736404/0002_x.sql")?.doel).toBe("D-20261019-202736404");
    expect(doelVanMigratie("supabase/migrations/0012_onboarding.sql")).toBeNull();
    expect(doelVanMigratie("tasks/T-20261001-onboarding/plan.md")).toBeNull();
    expect(doelVanMigratie("tasks/D-20261021-153504244/opdracht.md")).toBeNull();
  });

  it("zet het doel in de naam, zodat twee doelen met 0001 niet botsen", () => {
    expect(migratieNaam("D-20261021-153504244", "0001_doel_overgangen")).toBe("D-20261021-153504244__0001_doel_overgangen");
    expect(migratieNaam("D-1", "a b/c")).toBe("D-1__a_b_c");
    expect(hashSql("select 1")).toBe(hashSql("select 1"));
    expect(hashSql("select 1")).not.toBe(hashSql("select 2"));
  });
});

describe("de eigen migratielane — de grens", () => {
  it("laat een additieve wijziging in het eigen schema door", () => {
    const sql = `
      create table if not exists jarvis.doel_meting (
        id bigserial primary key,
        doel text not null,
        op timestamptz not null default now()
      );
      create index if not exists doel_meting_doel on jarvis.doel_meting (doel);
      alter table jarvis.doelen add column if not exists laatste_meting timestamptz;
      comment on table jarvis.doel_meting is 'metingen per doel';
      insert into jarvis.doel_meting (doel) select id from jarvis.doelen where status = 'klaar';
      update jarvis.doelen set laatste_meting = now() where status = 'klaar';
    `;
    expect(beoordeelEigenSql(sql)).toEqual([]);
  });

  it("laat een logtrigger met een eigen functie door, zonder definer", () => {
    const sql = `
      create or replace function jarvis.doel_overgang() returns trigger language plpgsql as $$
      begin
        if new.status is distinct from old.status then
          insert into jarvis.activiteit (uitvoerder, rol, taak, soort, tekst)
          values ('systeem', 'systeem', new.id, 'status', old.status || ' -> ' || new.status);
        end if;
        return new;
      end $$;
      drop trigger if exists doel_overgang on jarvis.doelen;
      create trigger doel_overgang after update of status on jarvis.doelen for each row execute function jarvis.doel_overgang();
    `;
    expect(beoordeelEigenSql(sql)).toEqual([]);
  });

  it.each([
    ["SECURITY DEFINER", "create or replace function jarvis.x() returns int language sql security definer as $$ select 1 $$;"],
    ["rechten", "grant execute on function jarvis.x() to authenticated;"],
    ["laten vallen", "drop table jarvis.doel_meting;"],
    ["verwijderen", "delete from jarvis.doelen where status = 'klaar';"],
    ["leegmaken", "truncate jarvis.activiteit;"],
    ["hernoemen", "alter table jarvis.doelen rename to doelen_oud;"],
    ["ander schema", "insert into auth.users (id) values (gen_random_uuid());"],
    ["productschema", "update public.businesses set naam = 'x' where id = 1;"],
    ["autorisatie", "insert into jarvis.autorisaties (soort, taak) values ('taak', 'T-1');"],
    ["eigenaarsfunctie", "create or replace function jarvis.v3_is_eigenaar() returns boolean language sql as $$ select true $$;"],
    ["dynamische SQL", "create or replace function jarvis.x() returns void language plpgsql as $$ begin execute 'drop table jarvis.doelen'; end $$;"],
    ["eigen transactiebesturing", "create table if not exists jarvis.y (id int); savepoint s1; rollback to s1;"],
    ["policy", "create policy y on jarvis.doelen for select to anon using (true);"],
    ["rol", "create role jarvis_migratie nologin;"],
  ])("weigert %s", (_wat, sql) => {
    expect(beoordeelEigenSql(sql).length).toBeGreaterThan(0);
  });

  it("weigert een statement dat de lane niet kent, en een UPDATE zonder WHERE", () => {
    expect(beoordeelEigenSql("alter table jarvis.doelen alter column status type text;").join(" ")).toMatch(/buiten de lane|laten vallen|hernoemen/);
    expect(beoordeelEigenSql("update jarvis.doelen set status = 'klaar';").join(" ")).toContain("UPDATE zonder WHERE");
    expect(beoordeelEigenSql("")).toEqual(["leeg"]);
  });

  it("scheidt een ontbrekende bevoegdheid van een fout in de opdracht", () => {
    // Rechten, definer, een ander schema: alleen met de rechten van de eigenaar te nemen.
    expect(bezwaarIsBevoegdheid(beoordeelEigenSql("grant execute on function jarvis.x() to authenticated;"))).toBe(true);
    expect(bezwaarIsBevoegdheid(beoordeelEigenSql("drop table jarvis.y;"))).toBe(true);
    // Een vorm die de lane niet kent, kan de uitvoerder zelf anders schrijven.
    expect(bezwaarIsBevoegdheid(["statement valt buiten de lane: \"create materialized view jarvis.x as select 1\""])).toBe(false);
    expect(bezwaarIsBevoegdheid(["UPDATE zonder WHERE"])).toBe(false);
  });
});

const OPDRACHT_MET_TESTS = `Verbeter de autonome doelenketen zodat een doel pas KLAAR wordt wanneer alles echt is gedaan.

Acceptatietests voor deze opdracht:

A. Controleer dat de eerder ontbrekende SQL daadwerkelijk op de database is toegepast en dat de historische gegevens voor #106 beschikbaar zijn.

B. Stel daarna daadwerkelijk aan de live AI Core:
"Welke taak is het meest recent vastgelopen geweest, waarom liep die vast en hoe is dat uiteindelijk opgelost?"

De AI Core moet #106 herkennen en uitleggen hoe het is opgelost.

C. Bewijs met een gecontroleerde test dat een doel met een falende expliciete acceptatietest niet KLAAR wordt gezet.

Markeer deze opdracht pas KLAAR wanneer A, B en C daadwerkelijk zijn uitgevoerd en geslaagd.
`;

describe("de acceptatietest uit de opdracht", () => {
  it("leest de drie tests, met hun soort", () => {
    const tests = leesAcceptatieTests(OPDRACHT_MET_TESTS);
    expect(tests.map((t) => t.id)).toEqual(["A", "B", "C"]);
    expect(tests[0]!.soort).toBe("sql");
    expect(tests[1]!.soort).toBe("aivraag");
    expect(tests[1]!.vraag).toMatch(/^Welke taak is het meest recent vastgelopen/);
    expect(tests[2]!.soort).toBe("bewijs");
    // De afsluitende regel hoort niet bij test C.
    expect(tests[2]!.tekst).not.toMatch(/Markeer deze opdracht/);
  });

  it("merkt een test die van het toeval afhangt, en laat een vastgezette test met rust", () => {
    const tests = leesAcceptatieTests(OPDRACHT_MET_TESTS);
    // A en B noemen #106: ze gaan over een vastgelegd onderwerp en meten morgen hetzelfde.
    expect(tests[0]!.onderwerp).toBe("#106");
    expect(tests[0]!.volatiel).toBe(false);
    expect(tests[1]!.onderwerp).toBe("#106");
    expect(tests[1]!.volatiel).toBe(false);
    // Dezelfde vraag zonder onderwerp hangt af van wat er toevallig het laatst gebeurde.
    const los = leesAcceptatieTests('Acceptatietests:\n\nA. Vraag aan de AI Core: "Welke taak is het meest recent vastgelopen?"\n');
    expect(los[0]!.volatiel).toBe(true);
    expect(volatielBezwaar(los[0]!)).toMatch(/niet te herhalen/);
    const vast = leesAcceptatieTests('Acceptatietests:\n\nA. Vraag aan de AI Core: "Waarom liep D-20261021-161119608 het laatst vast?"\n');
    expect(vast[0]!.volatiel).toBe(false);
    expect(vast[0]!.onderwerp).toBe("D-20261021-161119608");
  });

  it("vindt niets in een opdracht zonder expliciete sectie", () => {
    expect(leesAcceptatieTests("Bouw iets en test het goed. A. niet dit.")).toEqual([]);
  });

  it("zet de test en het bewijs in de vraag aan de beoordelaar", () => {
    const tests = leesAcceptatieTests(OPDRACHT_MET_TESTS);
    const vraag = bouwBeoordelingsVraag(tests[0]!, "ledger: 2 regels toegepast");
    expect(vraag).toContain("# Acceptatietest A");
    expect(vraag).toContain("ledger: 2 regels toegepast");
    expect(bouwBeoordelingsVraag(tests[0]!, "x".repeat(40_000))).toContain("[afgekapt]");
  });

  it("leest het oordeel, en noemt een onleesbaar oordeel niet geslaagd", () => {
    expect(parseerBeoordeling('{"geslaagd": true, "reden": "alles staat erin"}')).toEqual({ geslaagd: true, reden: "alles staat erin" });
    expect(parseerBeoordeling('```json\n{"geslaagd": false, "reden": "mist #106"}\n```').geslaagd).toBe(false);
    expect(parseerBeoordeling("Ja hoor, geslaagd!").geslaagd).toBe(false);
    expect(parseerBeoordeling('{"geslaagd": "ja"}').geslaagd).toBe(false);
  });

  it("laat één mislukte test het doel tegenhouden", () => {
    const goed = [{ id: "A", staat: "geslaagd" as const, bewijs: "", reden: "ok" }];
    const gemengd = [...goed, { id: "B", staat: "niet-geslaagd" as const, bewijs: "", reden: "mist #106" }];
    expect(eindoordeel(goed).klaar).toBe(true);
    expect(eindoordeel(gemengd).klaar).toBe(false);
    expect(eindoordeel(gemengd).samenvatting).toContain("B: niet-geslaagd");
    expect(eindoordeel([]).klaar).toBe(true);
  });

  it("scheidt niet gemeten van gezakt: beide houden tegen, maar niet op dezelfde manier", () => {
    const onmeetbaar = [
      { id: "A", staat: "geslaagd" as const, bewijs: "", reden: "ok" },
      { id: "B", staat: "niet-meetbaar" as const, bewijs: "", reden: "de acceptatiedeur ontbreekt — ontbrekende bevoegdheid" },
    ];
    const gezakt = [{ id: "B", staat: "niet-geslaagd" as const, bewijs: "", reden: "mist #106" }];
    expect(eindoordeel(onmeetbaar).klaar).toBe(false);
    expect(eindoordeel(onmeetbaar).onmeetbaar).toBe(true);
    expect(eindoordeel(gezakt).klaar).toBe(false);
    expect(eindoordeel(gezakt).onmeetbaar).toBe(false);
    expect(eindoordeel([]).onmeetbaar).toBe(false);
  });
});

describe("vier soorten stilstand", () => {
  it("noemt een ontbrekend recht een bevoegdheid en niet een besluit", () => {
    for (const tekst of [
      "geen schrijfrecht op de repository",
      "jarvis-db: HTTP 400 — statement niet toegestaan",
      "het doel vraagt beschermde paden en nieuwe bevoegdheden die ik niet mag aanmaken",
      "de migratieroute weigert elke rol die het schema jarvis kan gebruiken; er is een credential nodig",
      "permission denied for table doelen",
    ]) {
      const b = classificeerBlokkade(tekst);
      expect(b.soort).toBe("bevoegdheid");
      expect(b.naarEigenaar).toBe(false);
    }
  });

  it("laat een echte keuze wel naar de eigenaar gaan", () => {
    const b = classificeerBlokkade("er zijn twee opties en de keuze kost geld: welke wil je?");
    expect(b.soort).toBe("besluit");
    expect(b.naarEigenaar).toBe(true);
  });

  it("zet een beveiligingsgrens boven alles", () => {
    const b = classificeerBlokkade("dit vraagt een destructieve migratie en de keuze is aan jou");
    expect(b.soort).toBe("beveiliging");
    expect(b.naarEigenaar).toBe(false);
  });

  it("noemt de rest een fout, met herstel als vervolg", () => {
    const b = classificeerBlokkade("de test faalde op een time-out van de database");
    expect(b.soort).toBe("fout");
    expect(b.vervolg).toMatch(/herstel/);
    expect(rendereerBlokkade("de test faalde op een time-out")).toMatch(/^\[fout\]/);
  });
});
