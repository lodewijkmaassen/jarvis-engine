/**
 * Wat: toetst het runregister — de regel die elke run aan het begin
 * wegschrijft en aan het eind aanvult, zodat achteraf te meten is waardoor
 * een run startte.
 *
 * Waarom: zonder dat spoor is de starttrigger alleen indirect af te leiden.
 * `list_triggers` bewaart per routine één `last_run` en door een trigger
 * gestarte runs komen niet in `list_sessions` (gemeten 2026-09-18), dus een
 * run die niets te doen had laat anders niets achter — juist het geval
 * waarin je wilt weten of het vangnet draaide.
 */
import { describe, expect, it } from "vitest";

import {
  DOCUMENT_SQL,
  isRunOorzaak,
  isRunRegel,
  runDocumentId,
  runKlaarRegel,
  runStandBestand,
  runStartRegel,
  toegestaneSql,
} from "@/jarvis/src/db";

describe("runregister", () => {
  it("kent alleen de vier startoorzaken die de routine onderscheidt", () => {
    expect(isRunOorzaak("rooster")).toBe(true);
    expect(isRunOorzaak("signaal")).toBe(true);
    expect(isRunOorzaak("vervolgbeurt")).toBe(true);
    expect(isRunOorzaak("handmatig")).toBe(true);
    expect(isRunOorzaak("push")).toBe(false);
    expect(isRunOorzaak("")).toBe(false);
  });

  it("sleutelt een run op zijn startmoment, onder de eigen map runs/", () => {
    expect(runDocumentId(new Date("2026-09-19T22:16:04.123Z"))).toBe("runs/2026-09-19T22:16:04.123Z");
  });

  it("schrijft de startregel met oorzaak en uitvoerder, en nog zonder uitkomst", () => {
    const regel = runStartRegel(new Date("2026-09-19T22:16:04.123Z"), "signaal", "cloud", "gebeurtenis 134");
    expect(regel.id).toBe("runs/2026-09-19T22:16:04.123Z");
    expect(regel.begonnen).toBe("2026-09-19T22:16:04.123Z");
    expect(regel.oorzaak).toBe("signaal");
    expect(regel.uitvoerder).toBe("cloud");
    expect(regel.aanleiding).toBe("gebeurtenis 134");
    expect(regel.geeindigd).toBeNull();
    expect(regel.uitkomst).toBeNull();
  });

  it("laat een lege aanleiding niet als lege tekst achter", () => {
    expect(runStartRegel(new Date(), "rooster", "cloud", "   ").aanleiding).toBeNull();
    expect(runStartRegel(new Date(), "rooster", "cloud", null).aanleiding).toBeNull();
  });

  it("herschrijft bij het afronden nooit waardoor de run begon", () => {
    const begin = runStartRegel(new Date("2026-09-19T22:16:04.123Z"), "vervolgbeurt", "cloud", null);
    const eind = runKlaarRegel(begin, new Date("2026-09-19T22:41:00.000Z"), "één bericht verwerkt, PR #184");
    expect(eind.id).toBe(begin.id);
    expect(eind.begonnen).toBe(begin.begonnen);
    expect(eind.oorzaak).toBe("vervolgbeurt");
    expect(eind.geeindigd).toBe("2026-09-19T22:41:00.000Z");
    expect(eind.uitkomst).toBe("één bericht verwerkt, PR #184");
  });

  it("accepteert bij het afronden alleen een echte startregel", () => {
    expect(isRunRegel(runStartRegel(new Date(), "rooster", "cloud", null))).toBe(true);
    expect(isRunRegel(null)).toBe(false);
    expect(isRunRegel({ id: "overzicht/huidig", begonnen: "x", oorzaak: "rooster", uitvoerder: "cloud" })).toBe(false);
    expect(isRunRegel({ id: "runs/x", begonnen: "x", oorzaak: "push", uitvoerder: "cloud" })).toBe(false);
    expect(isRunRegel({ id: "runs/x", begonnen: "x", oorzaak: "rooster" })).toBe(false);
  });

  it("bewaart de lopende regel buiten elke repository, en laat de omgeving voorgaan", () => {
    expect(runStandBestand(undefined, "/tmp")).toBe("/tmp/jarvis-run.json");
    expect(runStandBestand("", "/tmp/")).toBe("/tmp/jarvis-run.json");
    expect(runStandBestand("/var/eigen/run.json", "/tmp")).toBe("/var/eigen/run.json");
  });

  it("vraagt geen migratie en geen nieuwe Edge Function: het register loopt over DOCUMENT_SQL", () => {
    // De Edge Function voert uitsluitend de teksten uit `toegestaneSql()`
    // uit. Zou het register een eigen statement nodig hebben, dan vroeg deze
    // stap een uitrol — en een migratie is een harde uitzondering.
    expect(toegestaneSql()).toContain(DOCUMENT_SQL);
    expect(toegestaneSql().some((s) => /jarvis\.runs/.test(s))).toBe(false);
  });
});
