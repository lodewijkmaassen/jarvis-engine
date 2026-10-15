import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { V3_AANROEP_PATROON, v3Aanroep } from "@/jarvis/src/db";
import {
  beoordeelHttpMeting,
  beoordeelV3Pr,
  destructieveSql,
  dispatchBesluit,
  globNaarRegex,
  magUitrollen,
  padMatcht,
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
    expect(globNaarRegex("app/v3-proef/**").test("app/v3-proef/a/b/c.tsx")).toBe(true);
    expect(globNaarRegex("app/*.ts").test("app/a/b.ts")).toBe(false);
    expect(globNaarRegex("app/*.ts").test("app/b.ts")).toBe(true);
    expect(padMatcht("./app/v3-proef/x.tsx", ["app/v3-proef/**"])).toBe(true);
    expect(padMatcht("app/v3-proefx/x.tsx", ["app/v3-proef/**"])).toBe(false);
    expect(padMatcht("a.b", ["a.b"])).toBe(true);
    expect(padMatcht("aXb", ["a.b"])).toBe(false);
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
      expect(r.join(), sql).toMatch(/destructieve SQL/);
    }
    const ok = beoordeelV3Pr({ ...mig, mandaat: { ...m, destructief: true }, migratieBestanden: [{ pad: "supabase/migrations/0013_x.sql", sql: "drop table a;" }] });
    expect(ok).toEqual([]);
  });
  it("weigeren een migratie waarvan de inhoud niet is aangeleverd", () => {
    expect(beoordeelV3Pr({ ...mig, mandaat: { ...mandaat, migraties: true }, migratieBestanden: [] }).join()).toMatch(/niet aangeleverd/);
  });
  it("destructieveSql negeert commentaar en herkent delete/update met where als veilig", () => {
    expect(destructieveSql("-- drop table a\ndelete from a where id = 1;")).toEqual([]);
    expect(destructieveSql("/* truncate */ update a set b = 1 where id = 2;")).toEqual([]);
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
