/**
 * Wat: toetst dat `jarvis overzicht --extern` een repository met een eigen
 * jarvis.config.yml als aangesloten project leest, en een kale repository als
 * niet-aangesloten.
 *
 * Waarom: het tweede project (Kasboek) kreeg zijn eigen configuratie, maar
 * het overzicht bleef "niet aangesloten" tonen; `--extern` las alleen de
 * git-historie. De kaart mag niet minder weten dan de repository.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { voerUit } from "@/jarvis/src/opdrachten";
import { readFile } from "node:fs/promises";

const FIXTURE = path.resolve("jarvis/fixtures/demo-project");

describe("overzicht --extern", () => {
  let kaal: string;
  let uit: string;

  beforeAll(async () => {
    kaal = await mkdtemp(path.join(tmpdir(), "jarvis-kaal-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: kaal });
    await writeFile(path.join(kaal, "README.md"), "# Kaal\n");
    uit = path.join(await mkdtemp(path.join(tmpdir(), "jarvis-uit-")), "overzicht.json");
    await mkdir(path.dirname(uit), { recursive: true });
  });

  afterAll(async () => {
    await rm(kaal, { recursive: true, force: true });
    await rm(path.dirname(uit), { recursive: true, force: true });
  });

  it("leest een repository met jarvis.config.yml als aangesloten, en een kale als niet-aangesloten", async () => {
    const code = await voerUit(["overzicht", "--extern", `${FIXTURE},${kaal}`, "--uit", uit]);
    expect(code).toBe(0);
    const overzicht = JSON.parse(await readFile(uit, "utf8")) as {
      projecten: { id: string; aangesloten: boolean; stand: unknown[] }[];
    };
    const bibliotheek = overzicht.projecten.find((p) => p.id === "bibliotheek");
    expect(bibliotheek?.aangesloten).toBe(true);
    expect((bibliotheek?.stand ?? []).length).toBeGreaterThan(0);
    const kaalProject = overzicht.projecten.find((p) => p.id === path.basename(kaal).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    expect(kaalProject?.aangesloten).toBe(false);
  });
});
