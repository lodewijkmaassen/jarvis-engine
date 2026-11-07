import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KETEN_OPDRACHTEN, ketenOverslaan } from "@/jarvis/src/v3";

/**
 * Een gespiegelde ketenworkflow in een repository zonder databasecredential
 * (RSK-0030).
 *
 * De werkelijke meting: in de engine-repository faalde elke ronde van
 * `jarvis-v3`, maanden achtereen, omdat daar geen `JARVIS_CI_DB_URL` staat en
 * de engine terugviel op de Edge Function, die buiten de proxy van het
 * platform met 401 antwoordt. Permanent rood verbergt rood dat iets zegt.
 *
 * Wat hier wordt vastgelegd, is het onderscheid: GEEN credential is een
 * uitspraak over de omgeving (overslaan), een credential dat niet werkt is een
 * storing (rood).
 */
describe("de keten slaat over waar geen credential is, en nergens anders", () => {
  it("slaat elke ketenopdracht over in CI zonder JARVIS_DB_URL", () => {
    for (const opdracht of KETEN_OPDRACHTEN) {
      const reden = ketenOverslaan({ opdracht, inCi: true, dbUrl: "" });
      expect(reden, opdracht).toMatch(/geen databasecredential/);
    }
    expect(ketenOverslaan({ opdracht: "sweep", inCi: true, dbUrl: undefined })).not.toBeNull();
    expect(ketenOverslaan({ opdracht: "sweep", inCi: true, dbUrl: "   " })).not.toBeNull();
  });

  it("slaat niets over wanneer het credential er wel is: een kapotte verbinding blijft een storing", () => {
    for (const opdracht of KETEN_OPDRACHTEN) {
      expect(ketenOverslaan({ opdracht, inCi: true, dbUrl: "postgres://x@y:5432/z" }), opdracht).toBeNull();
    }
  });

  it("slaat buiten CI niets over: daar zijn het bestand en de Edge Function geldige wegen", () => {
    expect(ketenOverslaan({ opdracht: "sweep", inCi: false, dbUrl: "" })).toBeNull();
    expect(ketenOverslaan({ opdracht: "eindcontrole", inCi: false, dbUrl: undefined })).toBeNull();
  });

  it("raakt alleen de ketenopdrachten, niet de rest van de opdrachtregel", () => {
    for (const opdracht of ["status", "werk", "nieuw", "watchdog", "beoordeel-pr", "vraag", "meet"]) {
      expect(ketenOverslaan({ opdracht, inCi: true, dbUrl: "" }), opdracht).toBeNull();
    }
  });

  it("de opdrachtregel zelf: exitcode 0, een annotatie, en niets gedaan", () => {
    const map = mkdtempSync(path.join(tmpdir(), "jarvis-geen-credential-"));
    writeFileSync(path.join(map, "jarvis.config.yml"), readFileSync(path.join(process.cwd(), "jarvis.config.yml"), "utf8"));
    const r = spawnSync("node", [path.join(process.cwd(), "bin/jarvis.mjs"), "v3", "eindcontrole"], {
      cwd: map,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: map,
        USERPROFILE: map,
        JARVIS_DB_URL_BESTAND: path.join(map, "bestaat-niet"),
        GITHUB_ACTIONS: "true",
        GITHUB_TOKEN: "x",
      },
    });
    expect(`${r.stdout}${r.stderr}`).toMatch(/::warning title=keten overgeslagen::/);
    expect(`${r.stdout}${r.stderr}`).toMatch(/geen databasecredential voor de keten/);
    expect(r.status).toBe(0);
  }, 30_000);
});
