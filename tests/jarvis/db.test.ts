/**
 * Wat: toetst de zuivere delen van de eigen database van Jarvis: de SQL die
 * claimen en verwerken bepaalt, de bronvolgorde van de verbindingsreeks en de
 * vorm van bericht-id's.
 *
 * Waarom: twee uitvoerders (laptop en cloud) mogen nooit hetzelfde item
 * verwerken; die regel zit in één SQL-tekst en moet daar aantoonbaar staan.
 */
import { describe, expect, it } from "vitest";

import { berichtId, claimSql, isTabel, NIEUWE_ANTWOORDEN_SQL, NIEUWE_BERICHTEN_SQL, verbindingsBron, verwerktSql } from "@/jarvis/src/db";

describe("claimen en verwerken", () => {
  it("claimt alleen een item dat nog nieuw is, en alleen in het schema jarvis", () => {
    const sql = claimSql("antwoorden");
    expect(sql).toContain("update jarvis.antwoorden");
    expect(sql).toContain("where id = $1 and status = 'nieuw'");
    expect(sql).toContain("status = 'in behandeling'");
    expect(sql).toContain("returning id");
  });

  it("zet verwerkt met tijdstip en toelichting", () => {
    const sql = verwerktSql("berichten");
    expect(sql).toContain("update jarvis.berichten");
    expect(sql).toContain("status = 'verwerkt'");
    expect(sql).toContain("verwerkt_op = now()");
    expect(sql).toContain("verwerking = $2");
  });

  it("kent alleen de twee tabellen met werk van de eigenaar", () => {
    expect(isTabel("antwoorden")).toBe(true);
    expect(isTabel("berichten")).toBe(true);
    expect(isTabel("documenten")).toBe(false);
    expect(isTabel("public.accounts")).toBe(false);
  });

  it("leest nieuw werk uitsluitend uit het schema jarvis en alleen van de eigenaar", () => {
    expect(NIEUWE_ANTWOORDEN_SQL).toMatch(/from jarvis\.antwoorden where status = 'nieuw'/);
    expect(NIEUWE_BERICHTEN_SQL).toMatch(/from jarvis\.berichten where van = 'eigenaar' and status = 'nieuw'/);
  });
});

describe("verbinding", () => {
  it("kiest de omgeving boven het bestand, en niets als geen van beide er is", () => {
    expect(verbindingsBron("postgresql://x", true)).toBe("omgeving");
    expect(verbindingsBron("", true)).toBe("bestand");
    expect(verbindingsBron(undefined, false)).toBeNull();
  });

  it("maakt een leesbaar, niet-botsend bericht-id", () => {
    const id = berichtId(new Date("2026-09-13T06:05:09.000Z"), "abcdef0123");
    expect(id).toBe("j-20260913T060509-abcdef");
  });
});
