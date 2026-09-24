import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toegestaneSql, WIE_SQL, claimSql, TOETSING_SQL } from "@/jarvis/src/db";

describe("de allowlist van de Edge Function jarvis-db", () => {
  const bestand = JSON.parse(readFileSync(path.join(process.cwd(), "jarvis/edge/jarvis-db/toegestaan.json"), "utf8")) as string[];

  it("is precies wat de engine op de database uitvoert (anders: npx tsx jarvis/scripts/toegestane-sql.ts)", () => {
    expect(bestand).toEqual([...toegestaneSql()]);
  });

  it("bevat alleen statements op het schema jarvis, plus de wie-vraag", () => {
    for (const sql of bestand) {
      if (sql === WIE_SQL) continue;
      expect(sql).toMatch(/\bjarvis\.(antwoorden|berichten|documenten|autorisaties|toetsingen|activiteit|vraag_review|lees_review)\b/);
      expect(sql).not.toMatch(/\b(drop|truncate|alter|grant|revoke|delete)\b/i);
    }
  });

  it("kent geen dubbele en geen lege statements", () => {
    expect(new Set(bestand).size).toBe(bestand.length);
    expect(bestand.every((s) => s.trim().length > 20)).toBe(true);
    expect(bestand).toContain(claimSql("antwoorden"));
    expect(bestand).toContain(TOETSING_SQL);
  });
});
