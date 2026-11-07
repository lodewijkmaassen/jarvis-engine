import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verbindDb } from "@/jarvis/src/opdrachten";

/**
 * Welke weg naar de database `verbindDb` kiest, en — vooral — WANNEER hij dat
 * bepaalt.
 *
 * Het pad van het bestand met de verbindingsreeks werd eenmaal bij het laden
 * van de module vastgelegd. Een test die `JARVIS_DB_URL_BESTAND` in zijn
 * `beforeEach` zette, kwam daarmee te laat: de engine las alsnog
 * `~/.jarvis-db-url` van de werkplek. Op deze machine stond dat bestand er, en
 * vijf tests faalden; op een machine zonder dat bestand slaagden dezelfde vijf
 * (RSK-0031). De test hieronder houdt die lek dicht zonder een echte database
 * aan te spreken: de postgres-client van `postgres` verbindt pas bij het
 * eerste statement, en dat doet deze test niet.
 */
describe("verbindDb kiest zijn weg bij elke aanroep opnieuw", () => {
  const bewaard = { url: process.env.JARVIS_DB_URL, bestand: process.env.JARVIS_DB_URL_BESTAND, api: process.env.JARVIS_DB_API };
  let map = "";

  beforeEach(() => {
    map = mkdtempSync(path.join(tmpdir(), "jarvis-verbinding-"));
    delete process.env.JARVIS_DB_URL;
  });

  afterEach(() => {
    for (const [naam, waarde] of [
      ["JARVIS_DB_URL", bewaard.url],
      ["JARVIS_DB_URL_BESTAND", bewaard.bestand],
      ["JARVIS_DB_API", bewaard.api],
    ] as const) {
      if (waarde === undefined) delete process.env[naam];
      else process.env[naam] = waarde;
    }
  });

  it("leest het bestand dat JARVIS_DB_URL_BESTAND op dat moment aanwijst", async () => {
    const bestand = path.join(map, "reeks");
    writeFileSync(bestand, "postgres://gebruiker:geheim@127.0.0.1:1/testdb\n");
    process.env.JARVIS_DB_URL_BESTAND = bestand;
    const v = await verbindDb();
    expect(v).not.toBeNull();
    expect(v?.bron).toBe("bestand");
    await v?.sql.end({ timeout: 1 });
  });

  it("valt in dezelfde sessie terug op de Edge Function als dat pad niet bestaat", async () => {
    process.env.JARVIS_DB_URL_BESTAND = path.join(map, "bestaat-niet");
    process.env.JARVIS_DB_API = "https://db.voorbeeld.test/functions/v1/jarvis-db";
    const v = await verbindDb();
    expect(v?.bron).toMatch(/^api/);
  });
});
