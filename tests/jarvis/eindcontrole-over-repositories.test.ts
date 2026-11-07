import { describe, expect, it } from "vitest";
import { maaktDezeKetenAf } from "@/jarvis/src/doelen";

/**
 * Welke keten een samengevoegd doel afmaakt (RSK-0042).
 *
 * Een doel raakt vaak de engine én de app. De vorige regel keek naar de naam
 * van de repository: stond de samenvoeging elders, dan deed deze keten niets.
 * Gemeten op 2026-11-07 aan D-20261021-161119608: de keten van de app legde
 * zelf de samenvoeging in de engine-repository vast, weigerde daarna haar eigen vastlegging te
 * beoordelen, en de keten van de engine wordt met opzet niet gewekt. Het doel
 * stond 79 minuten stil in samengevoegd.
 */
const EIGEN = "org/app";

describe("de keten die de samenvoeging kan lezen, maakt het doel af", () => {
  it("maakt een doel van de eigen repository af, zonder leesproef", () => {
    const uit = maaktDezeKetenAf({ eigen: EIGEN, repo: EIGEN, leesbaar: false });
    expect(uit.maakAf).toBe(true);
    expect(uit.reden).toContain("repository van deze run");
  });

  it("let niet op hoofdletters in de naam van de repository", () => {
    expect(maaktDezeKetenAf({ eigen: EIGEN, repo: EIGEN.toUpperCase(), leesbaar: false }).maakAf).toBe(true);
  });

  it("maakt een doel van een andere repository af zodra zij die samenvoeging kan lezen", () => {
    const uit = maaktDezeKetenAf({ eigen: EIGEN, repo: "org/engine", leesbaar: true });
    expect(uit.maakAf).toBe(true);
    expect(uit.reden).toContain("org/engine");
    expect(uit.reden).toContain("te lezen");
  });

  it("laat een doel met rust wanneer de samenvoeging hier niet te lezen is", () => {
    const uit = maaktDezeKetenAf({ eigen: EIGEN, repo: "org/ander-besloten", leesbaar: false });
    expect(uit.maakAf).toBe(false);
    expect(uit.reden).toContain("niet te lezen");
  });

  it("maakt een doel zonder vastgelegde samenvoeging af; de eindcontrole oordeelt daar zelf over", () => {
    expect(maaktDezeKetenAf({ eigen: EIGEN, repo: "", leesbaar: false }).maakAf).toBe(true);
    expect(maaktDezeKetenAf({ eigen: EIGEN, repo: "   ", leesbaar: false }).maakAf).toBe(true);
  });

  it("maakt het doel af wanneer de run niet weet in welke repository zij draait", () => {
    // Lokaal, zonder GITHUB_REPOSITORY: de oude regel sloeg dan niets over en dat blijft zo.
    expect(maaktDezeKetenAf({ eigen: "", repo: "org/engine", leesbaar: false }).maakAf).toBe(true);
  });
});
