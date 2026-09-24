import { describe, expect, it } from "vitest";
import {
  antwoordTekst,
  bouwAanroep,
  bouwReviewVraag,
  eigenaarstaalBezwaar,
  EIGENAARSTAAL_MAX_TEKENS,
  leverancierFout,
  parseerReview,
  REVIEW_LIMIETEN,
  rendereerReview,
  reviewDocumentId,
  technischeMarkers,
} from "../../jarvis/src/review";

const invoer = {
  repo: "lodewijkmaassen/tovas-flow",
  nummer: 12,
  kop: "0123456789abcdef0123456789abcdef01234567",
  titel: "Eén kleine wijziging",
  beschrijving: "Wat er verandert en waarom.\n\nUitzonderingen: geen",
  diff: [{ bestand: "lib/a.ts", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" }],
  dossier: "## Acceptatiecriteria\n\n1. Het werkt.",
  context: "### DEC-0001 — Iets besloten",
};

describe("de vraag aan de reviewer", () => {
  it("bevat de opdracht, de kennis en de diff, in die volgorde", () => {
    const v = bouwReviewVraag(invoer);
    const iOpdracht = v.indexOf("# Opdracht en acceptatiecriteria");
    const iKennis = v.indexOf("# Relevante kennis");
    const iDiff = v.indexOf("# De wijziging");
    expect(iOpdracht).toBeGreaterThan(-1);
    expect(iKennis).toBeGreaterThan(iOpdracht);
    expect(iDiff).toBeGreaterThan(iKennis);
    expect(v).toContain("```diff\n@@ -1 +1 @@");
    expect(v).toContain("DEC-0001");
  });

  it("kapt een te grote patch af en laat bestanden buiten het diffbudget weg, met melding", () => {
    const groot = "x".repeat(REVIEW_LIMIETEN.patchPerBestand + 10);
    const veel = Array.from({ length: 8 }, (_, i) => ({ bestand: `b${i}.ts`, status: "modified", patch: groot }));
    const v = bouwReviewVraag({ ...invoer, diff: veel });
    expect(v).toContain("afgekapt: 10 tekens weggelaten");
    expect(v).toContain("patch weggelaten");
    expect(v.length).toBeLessThan(REVIEW_LIMIETEN.diffTekens + REVIEW_LIMIETEN.contextTekens + REVIEW_LIMIETEN.dossierTekens + 4_000);
  });

  it("slaat het dossierdeel over als er geen dossier is", () => {
    expect(bouwReviewVraag({ ...invoer, dossier: null })).not.toContain("# Opdracht en acceptatiecriteria");
  });

  it("is een chat-completions-aanroep met een systeemrol en een JSON-antwoordeis", () => {
    const a = bouwAanroep("model-x", "vraag") as { model: string; messages: { role: string }[]; response_format: { type: string } };
    expect(a.model).toBe("model-x");
    expect(a.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(a.response_format.type).toBe("json_object");
  });
});

describe("het oordeel lezen", () => {
  const goed = JSON.stringify({
    oordeel: "correctie",
    samenvatting: "Eén echt probleem.",
    punten: [
      { ernst: "hoog", tekst: "De sleutel lekt in de log.", bestand: "lib/a.ts" },
      { ernst: "laag", tekst: "Naamgeving.", bestand: null },
    ],
    conclusie_eigenaar: "Er zit één fout in die eerst hersteld wordt. Jarvis gaat daarna zelf verder.",
  });

  it("leest een JSON-oordeel, ook in code-hekken", () => {
    const r = parseerReview("```json\n" + goed + "\n```");
    expect(typeof r).toBe("object");
    if (typeof r === "string") throw new Error(r);
    expect(r.oordeel).toBe("correctie");
    expect(r.punten).toHaveLength(2);
    expect(r.punten[0]?.bestand).toBe("lib/a.ts");
  });

  it("maakt van 'correctie' zonder hoog punt 'akkoord' — smaak is geen correctieronde", () => {
    const r = parseerReview(JSON.stringify({ oordeel: "correctie", punten: [{ ernst: "laag", tekst: "Stijl." }], conclusie_eigenaar: "Prima." }));
    if (typeof r === "string") throw new Error(r);
    expect(r.oordeel).toBe("akkoord");
  });

  it("weigert een onleesbaar of onvolledig antwoord met een reden", () => {
    expect(parseerReview("geen json")).toMatch(/geen JSON/);
    expect(parseerReview(JSON.stringify({ oordeel: "misschien", conclusie_eigenaar: "x" }))).toMatch(/oordeel/);
    expect(parseerReview(JSON.stringify({ oordeel: "akkoord" }))).toMatch(/conclusie_eigenaar/);
  });

  it("haalt de tekst en de fout uit een chat-completions-lading", () => {
    expect(antwoordTekst({ choices: [{ message: { content: "{}" } }] })).toBe("{}");
    expect(antwoordTekst({ choices: [] })).toBeNull();
    expect(leverancierFout({ error: { message: "model niet gevonden" } })).toBe("model niet gevonden");
    expect(leverancierFout({})).toBeNull();
  });

  it("rendert het oordeel met de volgende stap bij correctie", () => {
    const r = parseerReview(goed);
    if (typeof r === "string") throw new Error(r);
    const tekst = rendereerReview(r, { repo: "a/b", nummer: 3, kop: invoer.kop, model: "m" });
    expect(tekst).toContain("oordeel CORRECTIE");
    expect(tekst).toContain("[hoog] De sleutel lekt in de log. (lib/a.ts)");
    expect(tekst).toContain("hoogstens één ronde");
    expect(reviewDocumentId("a/b", 3)).toBe("review/a/b#3");
  });
});

describe("eigenaarstaal", () => {
  it("laat gewone taal door", () => {
    expect(eigenaarstaalBezwaar("De wijziging is technisch goedgekeurd. Alleen jouw akkoord is nog nodig.")).toBeNull();
    expect(eigenaarstaalBezwaar("Vandaag is het woensdag 16 september 2026; om 23:30 uur ben ik klaar.")).toBeNull();
    expect(eigenaarstaalBezwaar("De installatiebranche is een lastige markt; ik ga verder.")).toBeNull();
  });

  it("weigert technische namen en zegt wat er moet gebeuren", () => {
    const b = eigenaarstaalBezwaar("PR #10 head 2a2ea92, attestatie pending.");
    expect(b).toMatch(/technische namen/);
    expect(b).toMatch(/--technisch/);
    expect(technischeMarkers("PR #10 head 2a2ea92, attestatie pending.").length).toBeGreaterThanOrEqual(3);
    expect(technischeMarkers("Zie lib/ai/profile.ts en draai npx jarvis lint.")).toEqual(expect.arrayContaining([expect.stringMatching(/bestandspad/), expect.stringMatching(/opdrachtregel/)]));
    expect(technischeMarkers("De CI is rood.")).toHaveLength(1);
  });

  it("ziet een getal zonder letters niet als commit-sha", () => {
    expect(technischeMarkers("Bel 0612345678 als het niet lukt.")).toHaveLength(0);
  });

  it("weigert een verslag in plaats van een bericht", () => {
    expect(eigenaarstaalBezwaar("Alles goed. ".repeat(EIGENAARSTAAL_MAX_TEKENS / 6))).toMatch(/hoogstens/);
  });
});
