// Het startpunt van de rolcontrole.
//
// Deze twee stukjes logica zaten in de laag zonder testdekking, en een
// onafhankelijke QA vond er allebei een gat in. Het eerste liet een branchnaam
// toe als startpunt, waarmee de vrijstelling verschuift zonder dat er ook maar
// een bestand wijzigt. Het tweede las de basisconfiguratie met een regex en
// meldde daardoor verschuivingen die er niet waren.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { laadConfig, leesStartpuntUitConfig } from "@/jarvis/src/config";

const HASH = "006c65588d5264f42fe523ddd4a0167955c6f5d1";

describe("leesStartpuntUitConfig", () => {
  it("leest een kale waarde", () => {
    expect(leesStartpuntUitConfig(`project: x\nrol_controle_vanaf: ${HASH}\n`)).toBe(HASH);
  });

  it("leest een waarde tussen aanhalingstekens hetzelfde als een kale", () => {
    // Een regex las hier de aanhalingstekens mee, waardoor de vergelijking met
    // de huidige waarde altijd verschil zag: een blijvende, valse blokkade.
    expect(leesStartpuntUitConfig(`rol_controle_vanaf: "${HASH}"\n`)).toBe(HASH);
    expect(leesStartpuntUitConfig(`rol_controle_vanaf: '${HASH}'\n`)).toBe(HASH);
  });

  it("negeert commentaar achter de waarde", () => {
    expect(leesStartpuntUitConfig(`rol_controle_vanaf: ${HASH}  # gezet bij invoering\n`)).toBe(HASH);
  });

  it("geeft een lege string wanneer de sleutel ontbreekt", () => {
    expect(leesStartpuntUitConfig("project: x\n")).toBe("");
  });

  it("geeft null wanneer er niets te lezen valt", () => {
    // null betekent "onbekend" en is iets anders dan "leeg". Alleen zo kan de
    // poort stil blijven wanneer er geen basisconfiguratie is om mee te
    // vergelijken, in plaats van een verschuiving te melden.
    expect(leesStartpuntUitConfig("")).toBeNull();
    expect(leesStartpuntUitConfig("   \n")).toBeNull();
    expect(leesStartpuntUitConfig("\tkapot: [\n")).toBeNull();
  });
});

describe("rol_controle_vanaf accepteert alleen een commit-hash", () => {
  async function laadMet(waarde: string) {
    const wortel = await mkdtemp(path.join(tmpdir(), "jarvis-startpunt-"));
    const sjabloon = await readFile(path.join(process.cwd(), "jarvis.config.yml"), "utf8");
    const inhoud = sjabloon.replace(/^rol_controle_vanaf:.*$/m, `rol_controle_vanaf: ${waarde}`);
    await writeFile(path.join(wortel, "jarvis.config.yml"), inhoud, "utf8");
    return laadConfig(wortel);
  }

  it("neemt een volledige hash aan", async () => {
    const uitkomst = await laadMet(HASH);
    expect(uitkomst.ok).toBe(true);
  });

  it("weigert een branchnaam", async () => {
    // Met een ref als startpunt verschuift `git branch -f startpunt HEAD` de
    // vrijstelling zonder dat er een bestand wijzigt. De controle die de
    // verschuiving moet zien vergelijkt dan twee identieke strings, en de
    // overtreding verdwijnt geruisloos.
    const uitkomst = await laadMet("jarvis/v1-bootstrap");
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) return;
    expect(uitkomst.fouten.join(" ")).toContain("commit-hash");
  });

  it("weigert een afgekorte hash", async () => {
    const uitkomst = await laadMet(HASH.slice(0, 7));
    expect(uitkomst.ok).toBe(false);
  });

  it("staat leeg toe: dat betekent gewoon geen vrijstelling", async () => {
    const uitkomst = await laadMet('""');
    expect(uitkomst.ok).toBe(true);
  });
});
