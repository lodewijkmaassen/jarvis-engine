import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { V3_AANROEP_PATROON, v3Aanroep } from "@/jarvis/src/db";
import { BLK1_AANVALLEN } from "./fixtures/v3-aanvallen";
import {
  lexSql,
  beoordeelHttpMeting,
  beoordeelV3Pr,
  destructieveSql,
  dispatchBesluit,
  beoordeelSql,
  normaliseerMigratie,
  geraaktePaden,
  magUitrollen,
  padMatcht,
  padMatchtGlob,
  sqlTokens,
  type Mandaat,
  type V3PrFeiten,
} from "@/jarvis/src/v3";

const mandaat: Mandaat = {
  doel: "pagina",
  acceptatie: [{ id: "A1", omschrijving: "200", meting: { soort: "http", url: "https://x.invalid/v3-proef" } }],
  repos: ["lodewijkmaassen/tovas-flow"],
  paden_ja: ["app/v3-proef/**", "tests/v3-proef*", "supabase/migrations/*.sql"],
  paden_nee: [".github/**"],
  productie: true,
  migraties: false,
  destructief: false,
  kosten_max_eur: 0,
};

const basis: V3PrFeiten = {
  repo: "lodewijkmaassen/tovas-flow",
  nummer: 7,
  kop: "deadbeefcafe",
  basis: "main",
  auteur: "tovas-jarvis-bot",
  botLogin: "tovas-jarvis-bot",
  taken: ["V3-20261015-proef"],
  taakRedenen: [],
  bestanden: ["app/v3-proef/page.tsx", "tests/v3-proef.test.ts"],
  migratieBestanden: [],
  mandaat,
  taakToestand: "UITVOEREN",
  toetsingGoOpKop: true,
  poortGroen: true,
  prTekst: "Uitzonderingen: geen",
};

describe("globs", () => {
  it("** loopt over mappen, * blijft binnen een segment", () => {
    expect(padMatchtGlob("app/v3-proef/a/b/c.tsx", "app/v3-proef/**")).toBe(true);
    expect(padMatchtGlob("app/a/b.ts", "app/*.ts")).toBe(false);
    expect(padMatchtGlob("app/b.ts", "app/*.ts")).toBe(true);
    expect(padMatcht("./app/v3-proef/x.tsx", ["app/v3-proef/**"])).toBe(true);
    expect(padMatcht("app/v3-proefx/x.tsx", ["app/v3-proef/**"])).toBe(false);
    expect(padMatchtGlob("a.b", "a.b")).toBe(true);
    expect(padMatchtGlob("aXb", "a.b")).toBe(false);
    expect(padMatchtGlob("x/y/package.json", "**/package.json")).toBe(true);
    expect(padMatchtGlob("package.json", "**/package.json")).toBe(true);
  });
  it("kent geen terugloop: pathologische patronen blijven razendsnel", () => {
    const patroon = "**/".repeat(40) + "x";
    const pad = "a/".repeat(60) + "y";
    const t = Date.now();
    expect(padMatchtGlob(pad, patroon)).toBe(false);
    expect(padMatchtGlob("a".repeat(300) + "b", "*a".repeat(30) + "c")).toBe(false);
    expect(Date.now() - t).toBeLessThan(1500);
  });
  it("behandelt een nieuwe regel of een vreemd teken in een bestandsnaam als gewoon teken (geen ontsnapping aan jarvis/src/**)", () => {
    expect(padMatchtGlob("jarvis/src/x\n.ts", "jarvis/src/**")).toBe(true);
    expect(padMatchtGlob("jarvis/src/a\nb/c.ts", "jarvis/src/**")).toBe(true);
  });
});

describe("B2: geraaktePaden neemt bij hernoemen en kopiëren het oude pad mee", () => {
  it("geeft nieuw én oud pad, ontdubbeld", () => {
    expect([...geraaktePaden([{ filename: "app/a.txt", previous_filename: ".github/workflows/x.yml" }, { filename: "app/b.txt" }, { filename: "app/a.txt" }])].sort())
      .toEqual([".github/workflows/x.yml", "app/a.txt", "app/b.txt"]);
    expect(geraaktePaden([{ filename: "a", previous_filename: null }, { filename: "b", previous_filename: "" }])).toEqual(["a", "b"]);
  });
  it("beoordeelV3Pr weigert zodra een van die paden beschermd is", () => {
    const r = beoordeelV3Pr({ ...basis, bestanden: geraaktePaden([{ filename: "app/v3-proef/x.txt", previous_filename: "jarvis/src/attestatie.ts" }]) });
    expect(r.join()).toMatch(/veiligheidsgrens/);
  });
});

describe("B4: de poortcode en haar pin zijn voor ieder mandaat gesloten", () => {
  const breed: Mandaat = { ...mandaat, paden_ja: ["**"], paden_nee: [] };
  it("weigert jarvis/src, edge, migrations, canonical, roles, package.json, het lockfile, .npmrc en elke jarvis.config.yml", () => {
    const dicht = [
      "jarvis/src/v3.ts", "jarvis/edge/jarvis-db/index.ts", "jarvis/migrations/v3/0002_x.sql", "jarvis/migrations/0002_x.sql", "jarvis/canonical/jarvis-v3.yml", "jarvis/roles/qa.md",
      "tsconfig.json", "tsconfig.build.json", "sub/tsconfig.base.json", "bin/jarvis.mjs", "bin/x",
      "package.json", "package-lock.json", "npm-shrinkwrap.json", ".npmrc", "sub/package.json", "sub/package-lock.json", "sub/.npmrc", "jarvis.config.yml", "sub/jarvis.config.yml",
      ".github/workflows/x.yml", "CODEOWNERS", "docs/CODEOWNERS", ".claude/settings.json", "jarvis/allowlist.yml", ".env.local",
    ];
    for (const pad of dicht) expect(beoordeelV3Pr({ ...basis, mandaat: breed, bestanden: [pad] }).join(), pad).toMatch(/veiligheidsgrens/);
  });
  it("past attestatie.extra_paden toe, maar laat migraties aan het migratievlak van het mandaat", () => {
    const f = { ...basis, mandaat: breed, extraPaden: [".github", "supabase"] };
    expect(beoordeelV3Pr({ ...f, bestanden: ["supabase/config.toml"] }).join()).toMatch(/projectregel/);
    expect(beoordeelV3Pr({ ...f, bestanden: ["supabase/migrations/0013_x.sql"], migratieBestanden: [{ pad: "supabase/migrations/0013_x.sql", sql: "create table a(id int);" }], mandaat: { ...breed, migraties: true } })).toEqual([]);
  });
  it("laat gewoon productwerk wel door", () => {
    expect(beoordeelV3Pr({ ...basis, mandaat: breed, extraPaden: [".github", "supabase"], bestanden: ["app/v3-proef/page.tsx", "lib/x.ts", "tests/x.test.ts"] })).toEqual([]);
  });
});

describe("B5: de migratiecontrole is een scanner met whitelist, geen regex-strip", () => {
  const aanvallen: [string, string][] = [
    ["-- binnen een tekstwaarde", "select '--'; drop table klanten;"],
    ["/* binnen een tekstwaarde", "select '/*'; drop table klanten; select '*/';"],
    ["dollar-quote met drop", "select $x$ -- $x$; drop table klanten;"],
    ["DO met samengestelde EXECUTE", "do $$ begin execute 'dr'||'op table x'; end $$"],
    ["DO-blok", "do $$ begin perform 1; end $$"],
    ["drop sequence", "drop sequence s"],
    ["drop materialized view", "drop materialized view v"],
    ["drop owned", "drop owned by x"],
    ["drop aggregate", "drop aggregate f(int)"],
    ["delete met where true", "delete from t where true"],
    ["update met subselect-where", "update t set a = (select 1 where true)"],
    ["create policy using true", "create policy p on t using (true)"],
    ["grant aan anon", "grant select on t to anon"],
    ["triggers van het mandaat uitzetten", "alter table jarvis.v3_mandaten disable trigger all"],
    ["trigger-functie herdefiniëren", "create or replace function jarvis.v3_onveranderlijk() returns trigger language plpgsql as $$ begin return new; end $$"],
    ["eigenaarscheck herdefiniëren", "create or replace function jarvis.v3_is_eigenaar() returns boolean language sql as $$ select true $$"],
    ["aangehaalde schemanaam", 'select 1 from "jarvis"."v3_taken"'],
    ["copy to program", "copy t to program 'sh'"],
    ["alter system", "alter system set x = 1"],
    ["eigen transactiebesturing", "create table a(id int); commit; drop table b;"],
    ["rol aanmaken", "create role x superuser"],
    ["extensie", "create extension dblink"],
    ["set role", "set role postgres"],
    ["security definer", "create function f() returns int language sql security definer as 'select 1'"],
    ["insert on conflict do update", "insert into t values (1) on conflict (id) do update set a = 2"],
    ["alter column type", "alter table t alter column a type text"],
    ["alter table drop column", "alter table t drop column a"],
    ["rename", "alter table t rename to u"],
    ["truncate", "truncate t"],
    ["onbekend statement", "vacuum full t"],
  ];
  it.each(aanvallen)("weigert zonder destructief-mandaat: %s", (_naam, sql) => {
    expect(beoordeelSql(sql, false).length, sql).toBeGreaterThan(0);
  });
  it("weigert met destructief-mandaat nog steeds alles wat de beveiliging zelf raakt", () => {
    for (const sql of [
      "alter table jarvis.v3_mandaten disable trigger all", "create or replace function jarvis.v3_is_eigenaar() returns boolean language sql as $$ select true $$",
      'select 1 from "jarvis"."v3_taken"', "do $$ begin execute 'x'; end $$", "copy t to program 'sh'", "alter system set x = 1", "create table a(id int); commit; drop table b;",
      "create role x superuser", "set role postgres", "delete from auth.users",
    ]) expect(beoordeelSql(sql, true).length, sql).toBeGreaterThan(0);
  });
  it("laat met destructief-mandaat wél gewone verwijderende productmigraties toe", () => {
    expect(beoordeelSql("alter table t drop column a; update t set b = 1 where id = 2; drop index i;", true)).toEqual([]);
  });
  it("laat additieve migraties zonder destructief-mandaat toe, ook met tekst die verdachte woorden bevat", () => {
    const ok = [
      "create table nieuw (id int primary key, naam text default 'drop table; -- niet echt');",
      "create index i on t (a); create unique index u on t (b);",
      "alter table t add column c text; alter table t add constraint k check (c <> '');",
      "-- drop table t;\ncreate table x (a int); /* delete from y */",
      "create type kleur as enum ('rood','groen'); insert into kleur_tabel values (1);",
    ];
    for (const sql of ok) expect(beoordeelSql(sql, false), sql).toEqual([]);
  });
  it("een migratie met eigen begin/commit-omhulling wordt zonder die omhulling beoordeeld en toegepast; een commit middenin blijft verboden", () => {
    expect(normaliseerMigratie("-- kop\nbegin;\ncreate table a (id int);\ncommit;\n")).not.toMatch(/begin|commit/);
    expect(beoordeelSql("begin;\ncreate table a (id int);\ncommit;", false)).toEqual([]);
    expect(beoordeelSql("begin; create table a (id int); commit; drop table b; commit;", true).join()).toMatch(/transactiebesturing/);
    expect(beoordeelSql("create table a (id int); commit; drop table b;", true).join()).toMatch(/transactiebesturing/);
    expect(beoordeelSql("begin; create table a (id int);", true).join()).toMatch(/transactiebesturing/);
  });
  it("een plpgsql-begin in een functiebody is geen transactiebesturing, maar wat de body DOET telt wel: update/delete/drop erin vraagt een destructief-mandaat", () => {
    const veilig = "create function f() returns trigger language plpgsql as $$ begin new.b := 1; return new; end $$;";
    expect(beoordeelSql(veilig, false)).toEqual([]);
    const schadelijk = "create function f() returns void language plpgsql as $$ begin update t set a = 1 where id = 2; delete from u where id = 3; end $$;";
    expect(beoordeelSql(schadelijk, false).join()).toMatch(/UPDATE|DELETE/);
    expect(beoordeelSql(schadelijk, true)).toEqual([]);
    expect(beoordeelSql("do $$ begin perform 1; end $$;", false).length).toBeGreaterThan(0);
  });
  it("auth.uid() in een beleidsregel is geen verwijzing naar het schema; auth.users wel", () => {
    expect(beoordeelSql("create policy p on t using (user_id = auth.uid())", true)).toEqual([]);
    expect(beoordeelSql("create policy p on t using (exists (select 1 from auth.users))", true).length).toBeGreaterThan(0);
    expect(beoordeelSql("create table t (u uuid references auth.users (id))", true).length).toBeGreaterThan(0);
  });
  it("sqlTokens haalt commentaar en tekstwaarden weg en laat dollar-gequote code staan", () => {
    expect(sqlTokens("select 'a--b' -- c\n, 2 /* x */")).toBe("select '' , 2");
    expect(sqlTokens("do $f$ begin drop table x; end $f$")).toContain("drop table x");
    expect(sqlTokens('select "Jarvis"."T"')).toContain("jarvis");
  });
});

describe("het mandaat tegen een pull request (test 4: de grens houdt)", () => {
  it("laat werk binnen het mandaat door", () => {
    expect(beoordeelV3Pr(basis)).toEqual([]);
  });

  it("weigert elk pad op de veiligheidsgrens, ook als het mandaat het zou noemen", () => {
    const gevaarlijk = [".github/workflows/x.yml", "jarvis.config.yml", "CODEOWNERS", "jarvis/canonical/jarvis-lint.yml", ".claude/settings.json", "jarvis/allowlist.yml", ".env.local"];
    for (const pad of gevaarlijk) {
      const ruim: Mandaat = { ...mandaat, paden_ja: ["**"], paden_nee: [] };
      const r = beoordeelV3Pr({ ...basis, mandaat: ruim, bestanden: ["app/v3-proef/page.tsx", pad] });
      expect(r.join("\n"), pad).toMatch(/veiligheidsgrens/);
    }
  });

  it("weigert paden buiten paden_ja en binnen paden_nee", () => {
    expect(beoordeelV3Pr({ ...basis, bestanden: ["app/andere/page.tsx"] }).join()).toMatch(/buiten paden_ja/);
    expect(beoordeelV3Pr({ ...basis, mandaat: { ...mandaat, paden_ja: ["**"], paden_nee: ["app/geheim/**"] }, bestanden: ["app/geheim/a.ts"] }).join()).toMatch(/paden_nee/);
  });

  it("weigert zonder mandaat, zonder GO, met rode poort, in de verkeerde repo of verkeerde toestand", () => {
    expect(beoordeelV3Pr({ ...basis, mandaat: null }).join()).toMatch(/geen mandaat/);
    expect(beoordeelV3Pr({ ...basis, toetsingGoOpKop: false }).join()).toMatch(/toetsing GO/);
    expect(beoordeelV3Pr({ ...basis, poortGroen: false }).join()).toMatch(/poort/);
    expect(beoordeelV3Pr({ ...basis, repo: "ander/repo" }).join()).toMatch(/buiten het mandaat/);
    expect(beoordeelV3Pr({ ...basis, taakToestand: "AKKOORD_NODIG" }).join()).toMatch(/AKKOORD_NODIG/);
    expect(beoordeelV3Pr({ ...basis, taken: ["T-20260101-v2"] }).join()).toMatch(/geen V3-taak/);
    expect(beoordeelV3Pr({ ...basis, taken: ["V3-20261015-a", "V3-20261015-b"] }).join()).toMatch(/precies één taak/);
    expect(beoordeelV3Pr({ ...basis, auteur: "iemand" }).join()).toMatch(/niet de bot/);
  });
});

describe("migraties binnen het mandaat", () => {
  const mig = { ...basis, bestanden: ["supabase/migrations/0013_x.sql"] };
  it("zijn uit zolang het mandaat ze niet toestaat", () => {
    const r = beoordeelV3Pr({ ...mig, migratieBestanden: [{ pad: "supabase/migrations/0013_x.sql", sql: "create table a(id int);" }] });
    expect(r.join()).toMatch(/migraties: false/);
  });
  it("laten additieve SQL door met migraties: true", () => {
    const m = { ...mandaat, migraties: true };
    const r = beoordeelV3Pr({ ...mig, mandaat: m, migratieBestanden: [{ pad: "supabase/migrations/0013_x.sql", sql: "create table a(id int); alter table a add column b text; create index i on a(b);" }] });
    expect(r).toEqual([]);
  });
  it("weigeren destructieve SQL zonder destructief-mandaat", () => {
    const m = { ...mandaat, migraties: true };
    for (const sql of ["drop table a;", "truncate a;", "delete from a;", "update a set b = 1;", "alter table a drop column b;", "alter table a disable row level security;"]) {
      const r = beoordeelV3Pr({ ...mig, mandaat: m, migratieBestanden: [{ pad: "supabase/migrations/0013_x.sql", sql }] });
      expect(r.join(), sql).toMatch(/destructief: true|whitelist/);
    }
    const ok = beoordeelV3Pr({ ...mig, mandaat: { ...m, destructief: true }, migratieBestanden: [{ pad: "supabase/migrations/0013_x.sql", sql: "drop table a;" }] });
    expect(ok).toEqual([]);
  });
  it("weigeren een migratie waarvan de inhoud niet is aangeleverd", () => {
    expect(beoordeelV3Pr({ ...mig, mandaat: { ...mandaat, migraties: true }, migratieBestanden: [] }).join()).toMatch(/niet aangeleverd/);
  });
  it("beoordeelSql negeert commentaar, maar update/delete (ook met where) vraagt een destructief-mandaat", () => {
    expect(beoordeelSql("-- drop table a\ncreate table b (id int);", false)).toEqual([]);
    expect(beoordeelSql("update a set b = 1 where id = 2;", false).join()).toMatch(/destructief/);
    expect(beoordeelSql("update a set b = 1 where id = 2;", true)).toEqual([]);
  });
});

describe("uitrollen binnen het mandaat", () => {
  it("productie: true dekt samenvoegen en uitrollen zonder apart akkoord; productie: false niet", () => {
    expect(magUitrollen(mandaat, []).samenvoegen).toBe(true);
    expect(magUitrollen({ ...mandaat, productie: false }, []).samenvoegen).toBe(false);
  });
});

describe("de dispatcher", () => {
  const nu = new Date("2026-10-15T12:00:00Z");
  const rij = { taak_id: "V3-20261015-a", toestand: "UITVOEREN", reden: "uitvoerbaar, geen uitvoerder" };
  it("start niet zonder werk en niet binnen de rusttijd, wel bij verweesd werk", () => {
    expect(dispatchBesluit([], null, nu).start).toBe(false);
    expect(dispatchBesluit([{ ...rij, reden: "in uitvoering" }], null, nu).start).toBe(false);
    expect(dispatchBesluit([rij], "2026-10-15T11:55:00Z", nu).start).toBe(false);
    expect(dispatchBesluit([rij], "2026-10-15T11:00:00Z", nu).start).toBe(true);
    expect(dispatchBesluit([rij], null, nu).start).toBe(true);
  });
});

describe("de eindcontrole van een http-criterium", () => {
  const m = { soort: "http", url: "https://x.invalid", bevat: "V3 werkt", bouwmerk: true } as const;
  const pagina = (merk: string) => `<html><meta name="jarvis-bouwmerk" content="${merk}"><body>V3 werkt</body></html>`;
  it("is pas geslaagd bij 200, de tekst en een bouwmerk dat de uitgerolde commit is", () => {
    expect(beoordeelHttpMeting(m, { status: 200, tekst: pagina("deadbee") }, "deadbeefcafe").geslaagd).toBe(true);
    expect(beoordeelHttpMeting(m, { status: 404, tekst: "" }, "deadbeefcafe").geslaagd).toBe(false);
    expect(beoordeelHttpMeting(m, { status: 200, tekst: "<html></html>" }, "deadbeefcafe").bewijs).toMatch(/V3 werkt" ontbreekt/);
    expect(beoordeelHttpMeting(m, { status: 200, tekst: "<p>V3 werkt</p>" }, "deadbeefcafe").bewijs).toMatch(/geen jarvis-bouwmerk/);
    expect(beoordeelHttpMeting(m, { status: 200, tekst: pagina("1234567") }, "deadbeefcafe").geslaagd).toBe(false);
  });
});

describe("de Edge Function en de V3-aanroepen", () => {
  const edge = readFileSync(path.join(process.cwd(), "jarvis/edge/jarvis-db/index.ts"), "utf8");
  it("heeft exact hetzelfde aanroeppatroon als de engine", () => {
    const m = /const V3_AANROEP_PATROON =\s*(\/.+\/);/.exec(edge);
    expect(m?.[1]).toBe(String(V3_AANROEP_PATROON));
  });
  it("laat functie-aanroepen door en niets anders", () => {
    for (const ok of [
      v3Aanroep("pak", ["text", "text", "int"], "ok"),
      v3Aanroep("overgang", ["text", "text", "text", "json"], "naar"),
      v3Aanroep("watchdog", []),
      "select * from jarvis.v3_vraag($1, $2, $3, $4, $5::text::jsonb, $6::text::jsonb)",
    ]) expect(V3_AANROEP_PATROON.test(ok), ok).toBe(true);
    for (const fout of [
      "select jarvis.v3_pak($1); drop table jarvis.v3_taken",
      "select * from jarvis.v3_pak($1) union select * from jarvis.antwoorden",
      "select public.v3_pak($1)",
      "select jarvis.v3_pak((select 1))",
      "select jarvis.v3_pak($9)",
      "delete from jarvis.v3_taken",
      "select jarvis.antwoorden_x($1)",
    ]) expect(V3_AANROEP_PATROON.test(fout), fout).toBe(false);
  });
});

describe("mandaatUitRij en het ledger", () => {
  it("zet een rij van v3_werk om in een mandaat, en geeft null zonder mandaat", async () => {
    const { mandaatUitRij, ledgerVersie } = await import("@/jarvis/src/v3-cli");
    expect(mandaatUitRij(undefined)).toBeNull();
    expect(mandaatUitRij({ id: "V3-20261015-x", mandaat_id: null })).toBeNull();
    const m = mandaatUitRij({
      id: "V3-20261015-x", mandaat_id: "u", doel: "d", acceptatie: [{ id: "A1", omschrijving: "o", meting: { soort: "ci", check: "poort" } }],
      repos: ["a/b"], paden_ja: ["x/**"], paden_nee: [".github/**"], productie: true, migraties: false, destructief: false, kosten_max_eur: "0",
    });
    expect(m).toMatchObject({ productie: true, migraties: false, repos: ["a/b"], kosten_max_eur: 0 });
    expect(ledgerVersie(new Date("2026-10-15T20:30:45Z"))).toBe("20261015203045");
  });
});

describe("B3: de noodstop (enabled: false) stopt ook elke V3-opdracht", () => {
  const BIN = path.join(process.cwd(), "bin/jarvis.mjs");
  const config = readFileSync(path.join(process.cwd(), "jarvis.config.yml"), "utf8");

  function draai(tekst: string, args: string[]) {
    const map = mkdtempSync(path.join(tmpdir(), "jarvis-noodstop-"));
    writeFileSync(path.join(map, "jarvis.config.yml"), tekst);
    // Een bereikbare "database" en "GitHub" zijn bewust niet ingesteld: de noodstop moet vóór elk netwerk of database komen.
    const r = spawnSync("node", [BIN, "v3", ...args], { cwd: map, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: map, GITHUB_TOKEN: "x" } });
    return { code: r.status, uit: `${r.stdout}${r.stderr}` };
  }

  it("weigert sweep, beoordeel-pr, dispatch, migreer, eindcontrole, nieuw en status wanneer enabled: false", () => {
    const uit = config.replace(/^enabled:.*$/m, "enabled: false");
    expect(uit).toContain("enabled: false");
    for (const args of [["sweep", "--repo", "a/b"], ["beoordeel-pr", "5", "--repo", "a/b", "--samenvoegen"], ["dispatch"], ["migreer", "--repo", "a/b", "--basis", "a", "--kop", "b"], ["eindcontrole"], ["status"], ["nieuw", "--id", "V3-20261015-x", "--titel", "t", "--opdracht", "o"]]) {
      const r = draai(uit, args);
      expect(r.code, args.join(" ")).toBe(1);
      expect(r.uit, args.join(" ")).toMatch(/enabled: false \(de noodstop\)/);
    }
  }, 60_000);
  it("faalt gesloten als de configuratie ontbreekt of kapot is", () => {
    const r = draai("dit is geen geldige configuratie: [", ["status"]);
    expect(r.code).toBe(1);
    expect(r.uit).toMatch(/niet te lezen|gesloten/);
  });
  it("laat de opdracht met enabled: true wél tot de volgende stap komen (hier: geen database)", () => {
    const r = draai(config, ["status"]);
    expect(r.uit).not.toMatch(/noodstop/);
    expect(r.uit).toMatch(/geen weg naar de database|jarvis v3 status/);
  });
});

describe("BLK-2/R-2: tsconfig is poortcode; alleen samenvoegen in main; geen onnormale paden", () => {
  it("tsconfig.json (en varianten) is voor ieder mandaat gesloten", () => {
    const breed: Mandaat = { ...mandaat, paden_ja: ["**"], paden_nee: [] };
    for (const pad of ["tsconfig.json", "tsconfig.build.json", "packages/x/tsconfig.base.json"]) {
      expect(beoordeelV3Pr({ ...basis, mandaat: breed, bestanden: [pad] }).join(), pad).toMatch(/veiligheidsgrens/);
    }
  });
  it("R-2: een pull request naar een andere branch dan main wordt niet gedekt", () => {
    for (const b of ["jarvis/andere", "develop", ""]) expect(beoordeelV3Pr({ ...basis, basis: b }).join(), b).toMatch(/niet naar main/);
    expect(beoordeelV3Pr(basis)).toEqual([]);
  });
  it("een pad met .., ., een leeg segment of een stuurteken wordt geweigerd, ook binnen paden_ja", () => {
    for (const pad of ["app/../.github/x.yml", "app/./x.ts", "app//x.ts", "./app/x.ts", "app/v3-proef/x\u0001.ts"]) {
      expect(beoordeelV3Pr({ ...basis, bestanden: [pad] }).join(), pad).toMatch(/geen normaal pad/);
    }
  });
});

describe("R-3: het bouwmerk mag een nazaat van de samenvoegcommit zijn", () => {
  const m = { soort: "http", url: "https://x.invalid", bevat: "V3 werkt", bouwmerk: true } as const;
  const pagina = (merk: string) => `<meta name="jarvis-bouwmerk" content="${merk}"><p>V3 werkt</p>`;
  it("slaagt bij gelijk merk, bij een nazaat, en faalt bij een vreemd merk", () => {
    expect(beoordeelHttpMeting(m, { status: 200, tekst: pagina("abcdef1") }, "abcdef1234567").geslaagd).toBe(true);
    expect(beoordeelHttpMeting(m, { status: 200, tekst: pagina("9999999") }, "abcdef1234567").geslaagd).toBe(false);
    const nazaat = beoordeelHttpMeting(m, { status: 200, tekst: pagina("9999999") }, "abcdef1234567", (g) => g === "9999999");
    expect(nazaat.geslaagd).toBe(true);
    expect(nazaat.bewijs).toMatch(/volgt op de samenvoegcommit/);
    expect(beoordeelHttpMeting(m, { status: 200, tekst: pagina("9999999") }, null, () => true).geslaagd).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------
// BLK-1: de omzeilingen uit de onafhankelijke review. Elk geval wordt hier geweigerd door de scanner;
// dat PostgreSQL de SQL werkelijk zo uitvoert, bewijzen de tests tegen echte PostgreSQL in
// v3-database.test.ts (dezelfde lijst, `BLK1_AANVALLEN`).
describe("BLK-1: de lexer leest SQL zoals PostgreSQL en faalt gesloten", () => {
  it.each(BLK1_AANVALLEN.map((a) => [a.naam, a.sql] as const))("weigert zonder destructief-mandaat: %s", (_naam, sql) => {
    expect(beoordeelSql(sql, false).length, "zonder destructief").toBeGreaterThan(0);
  });
  it("weigert ook met destructief: true alles wat de beveiliging of de lexer zelf raakt", () => {
    for (const a of BLK1_AANVALLEN.filter((x) => x.altijd)) expect(beoordeelSql(a.sql, true).length, a.naam).toBeGreaterThan(0);
  });
  it("een e/E aan het einde van een naam is geen E-prefix (variant a)", () => {
    const l = lexSql("select name'\\'; drop table klanten; select name'\\'");
    expect(l.boven).toMatch(/drop table klanten/);
    expect(l.fouten).toEqual([]);
  });
  it("een $ in een naam of getal en een U&-escape zijn lexer-fouten (varianten b en c)", () => {
    expect(lexSql("select 1 as x$a$").fouten.join()).toMatch(/dollarteken/);
    expect(lexSql("select 1$a$").fouten.join()).toMatch(/dollarteken/);
    expect(lexSql('select * from U&"\\006Aarvis".t').fouten.join()).toMatch(/unicode-escape/);
    expect(lexSql("select U&'\\0041'").fouten.join()).toMatch(/unicode-escape/);
  });
  it("een functiebody als gewone tekst of dollar-quote wordt als code beoordeeld (variant d)", () => {
    const l = lexSql("create function f() returns trigger language plpgsql as 'begin delete from klanten; return new; end'");
    expect(l.bodies.join(" ")).toMatch(/delete from klanten/);
    const l2 = lexSql("create function f() returns trigger language plpgsql as $q$begin delete from klanten; return new; end$q$");
    expect(l2.bodies.join(" ")).toMatch(/delete from klanten/);
  });
  it("niet afgesloten tekst, commentaar, quotes en dollar-quotes zijn fouten", () => {
    for (const sql of ["select 'abc", "select /* x", 'select "abc', "select $$abc", "select e'abc\\'"]) {
      expect(lexSql(sql).fouten.length, sql).toBeGreaterThan(0);
      expect(beoordeelSql(sql, true).length, sql).toBeGreaterThan(0);
    }
  });
  it("laat gewone, additieve SQL met lastige maar geldige tekens door", () => {
    const ok = [
      "create table t (a text default 'it''s', b text default E'a\\'b', c int);",
      "create table t2 (a int); -- opmerking met 'quote en $$ erin\ncreate index i on t2 (a);",
      "create table t3 (naam text default $q$a 'b' -- c$q$);",
      "create function f() returns trigger language plpgsql as $$ begin new.a := 1; return new; end $$;",
      "create table t4 (a int);\r\ncreate index i4 on t4 (a);",
    ];
    for (const sql of ok) expect(beoordeelSql(sql, false), sql).toEqual([]);
  });
  it("is lineair: een groot bestand zonder puntkomma kost geen minuten (geen kwadratische regex)", () => {
    const groot = "alter table t add column a int ".repeat(40000);
    const t = Date.now();
    beoordeelSql(groot, false);
    expect(Date.now() - t).toBeLessThan(3000);
  });
  it("search_path naar een beschermd schema, een andere functietaal en V3/Jarvis-namen zijn altijd verboden", () => {
    for (const sql of [
      "set search_path = auth, public", "set local search_path to pg_catalog",
      "create function f() returns int language c as '$libdir/x', 'f'", "create function f() returns int language 'c' as 'x'",
      "select * from v3_taken", "select 1 from jarvis", "set standard_conforming_strings = off", "set backslash_quote = on",
    ]) expect(beoordeelSql(sql, true).length, sql).toBeGreaterThan(0);
    expect(beoordeelSql("set search_path = public, extensions_pg;", true).length).toBe(0);
  });
});

describe("NB-2: bin/ is de ingang van de poortcode", () => {
  it("is voor ieder mandaat gesloten, ook bij een patroon dat het niet noemt", () => {
    const breed: Mandaat = { ...mandaat, paden_ja: ["b*/**", "bin/**"], paden_nee: [] };
    for (const pad of ["bin/jarvis.mjs", "bin/x/y.mjs"]) expect(beoordeelV3Pr({ ...basis, mandaat: breed, bestanden: [pad] }).join(), pad).toMatch(/veiligheidsgrens/);
  });
});

describe("lineaire patronen: grote invoer kost geen minuten", () => {
  const meet = (f: () => unknown): number => { const t = Date.now(); f(); return Date.now() - t; };
  it("on conflict, 1 MB zonder puntkomma", () => {
    expect(meet(() => beoordeelSql("insert into t values (1) on conflict ".repeat(30000), false))).toBeLessThan(3000);
  });
  it("normaliseerMigratie met veel witruimte en commentaar na een begin; … commit;", () => {
    const veel = "begin; select 1; commit;" + " ".repeat(200000) + "x";
    expect(meet(() => normaliseerMigratie(veel))).toBeLessThan(1000);
    const commentaar = "/* x */ ".repeat(50000) + "begin; select 1;";
    expect(meet(() => normaliseerMigratie(commentaar))).toBeLessThan(1000);
    const regels = "begin;\nselect 1;\ncommit;\n" + "-- opmerking\n".repeat(50000);
    expect(meet(() => normaliseerMigratie(regels))).toBeLessThan(2000);
  });
  it("normaliseerMigratie verwerkt een afsluitend commentaar en laat een commit in een naam met rust", () => {
    expect(normaliseerMigratie("begin;\ncreate table a (id int);\ncommit; -- einde\n")).not.toMatch(/begin|commit/);
    expect(normaliseerMigratie("begin; create table recommit (id int); recommit;")).toMatch(/begin/);
  });
  it("elk patroon van de scanner blijft snel op 1 MB aan lastige tekens", () => {
    for (const stuk of ["'", "$", "/*", '"', "e'", "$a$", " alter ", " do ", " execute ", " create trigger "]) {
      expect(meet(() => beoordeelSql(stuk.repeat(Math.ceil(1_000_000 / stuk.length)), false)), JSON.stringify(stuk)).toBeLessThan(4000);
    }
  });
});

describe("de V3-workflow start de migratiejob ook na een automatische merge (zonder push-event)", () => {
  const yml = readFileSync(path.join(process.cwd(), "jarvis/canonical/jarvis-v3.yml"), "utf8");
  const blok = (naam: string) => yml.slice(yml.indexOf(`\n  ${naam}:`), (yml.indexOf("\n  ", yml.indexOf(`\n  ${naam}:`) + 5) > 0 ? undefined : undefined));
  it("heeft geen push-trigger en geen afhankelijkheid van before/after van een push", () => {
    expect(yml).not.toMatch(/^\s{2}push:/m);
    expect(yml).not.toMatch(/github\.event\.before|github\.event\.after|--basis|--kop/);
  });
  it("laat de migratiejob direct na de sweep lopen, ook als de sweep niets deed, en alleen als de eigenaar migraties heeft aangezet", () => {
    const m = yml.slice(yml.indexOf("\n  migreren:"));
    expect(m).toMatch(/needs: sweep/);
    expect(m).toMatch(/always\(\)/);
    expect(m).toMatch(/vars\.JARVIS_MIGRATIES == 'aan'/);
    expect(m).toMatch(/environment: jarvis-migraties/);
    expect(m).toMatch(/v3 migreer\s*$/m);
    expect(m).toMatch(/ref: main/);
    void blok;
  });
  it("draait ook op het rooster, zodat een gemiste ronde de volgende keer wordt ingehaald", () => {
    expect(yml).toMatch(/schedule:\s*\n\s*- cron: "\*\/10/);
  });
  it("de actieve kopie is byte-identiek aan de canonieke", () => {
    expect(readFileSync(path.join(process.cwd(), ".github/workflows/jarvis-v3.yml"), "utf8")).toBe(yml);
  });
});

describe("BLK-A: aaneengeschakelde teksten worden eerst samengevoegd en dan als code gelezen", () => {
  it("lexSql ziet delete in 'delet'⏎'e from klanten' en de verwijzing naar jarvis in drie stukken", () => {
    const l = lexSql("create function f() returns int language plpgsql as 'begin delet'\n'e from klanten; end'");
    expect(l.bodies.join(" ")).toMatch(/delete from klanten/);
    const d = lexSql("do 'begin insert into jarv'\n'is.v'\n'3_x values (1); end'");
    expect(d.alles).toMatch(/jarvis\s*\.\s*v3_x/);
  });
  it("neemt commentaar en lege regels tussen de teksten mee, en een tekst zonder newline ertussen niet", () => {
    expect(lexSql("do 'begin delet' -- c\n\n'e from t; end'").bodies.join(" ")).toMatch(/delete from t/);
    // BLK-D: blokcommentaar is bij PostgreSQL géén tussenruimte voor aaneenschakeling; geen samenvoeging
    expect(lexSql("do 'begin delet' /* c */\n'e from t; end'").bodies.join(" ")).not.toMatch(/delete from t/);
  });
  it("een niet-afgesloten vervolgtekst is een fout", () => {
    expect(lexSql("do 'begin x' \n'e from t; end").fouten.join()).toMatch(/niet wordt afgesloten/);
  });
});

describe("BLK-B: een bestandspad in een GitHub-URL wordt per segment gecodeerd", () => {
  it("laat ? # & = % niet door", async () => {
    const { padNaarUrl } = await import("@/jarvis/src/v3-cli");
    expect(padNaarUrl("supabase/migrations/0101_qa?ref=benign&x=.sql")).toBe("supabase/migrations/0101_qa%3Fref%3Dbenign%26x%3D.sql");
    expect(padNaarUrl("a b/c#d/e%f.sql")).toBe("a%20b/c%23d/e%25f.sql");
    expect(padNaarUrl("gewoon/pad.sql")).toBe("gewoon/pad.sql");
  });
});

describe("BLK-C: een E-tekst met aaneengeschakelde vervolgstukken blijft een E-tekst", () => {
  it("ziet de DROP die het vervolgstuk `'\\''` niet verbergt", () => {
    const l = lexSql("select e'x'\n'\\''; drop table klanten; -- '");
    expect(l.boven).toMatch(/drop table klanten/);
  });
  it("leest een gewone tekst-keten ongewijzigd (zonder escapes)", () => {
    const l = lexSql("select 'x'\n'\\'; drop table klanten; select 'a'");
    expect(l.boven).toMatch(/drop table klanten/); // standaardtekst: de backslash is een gewoon teken, de tekst sluit bij de tweede quote
    expect(lexSql("select 'a' \n 'b'; select 1").fouten).toEqual([]);
  });
  it("een E-keten die niet wordt afgesloten is een fout", () => {
    expect(lexSql("select e'x'\n'\\'").fouten.join()).toMatch(/niet wordt afgesloten/);
  });
});


describe("BLK-D: een goedaardige additieve migratie blijft doorgelaten; secrets alleen in een omgeving", () => {
  it("laat gewone additieve migraties door", () => {
    expect(beoordeelSql("create table public.a (id serial primary key, n int default 5); alter table public.a add column b text default 'x'; alter table only public.a enable row level security;", false)).toEqual([]);
  });
  it("blijft doorlaten: trigger, row level security en commentaar op objecten uit dezelfde migratie, add-acties, extensie in public", () => {
    const goed = [
      "create table public.a (id int); create function public.f() returns trigger language plpgsql as $$ begin return new; end $$; create trigger tg before insert on public.a for each row execute function public.f();",
      "create table public.a (id int); alter table public.a enable row level security; comment on table public.a is 'x'; comment on column public.a.id is 'y';",
      "create table public.a (id int); alter table public.a add column b int, add constraint c check (b > 0), add column d text default 'a,b';",
      "create extension if not exists pgcrypto with schema extensions;",
    ];
    for (const g of goed) expect(beoordeelSql(g, false), g).toEqual([]);
  });
  it("de CI-jobs die het CI-geheim gebruiken draaien in de omgeving jarvis-ci", () => {
    const yml = readFileSync(path.join(process.cwd(), ".github/workflows/jarvis-v3.yml"), "utf8");
    for (const j of ["sweep", "eindcontrole", "dispatch"]) {
      const i = yml.indexOf(`\n  ${j}:`);
      expect(yml.slice(i, i + 300), j).toMatch(/environment: jarvis-ci/);
    }
  });
});
