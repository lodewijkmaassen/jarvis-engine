import { describe, expect, it } from "vitest";
import {
  antwoordTekst,
  bouwAanroep,
  bouwReviewVraag,
  combineerReviews,
  DATA_BEGIN,
  DATA_EIND,
  eigenaarstaalBezwaar,
  EIGENAARSTAAL_MAX_TEKENS,
  knipPatch,
  leverancierFout,
  parseerReview,
  REVIEW_LIMIETEN,
  rendereerReview,
  reviewDocumentId,
  technischeMarkers,
  verdeelDiff,
  type Review,
} from "../../jarvis/src/review";

const invoer = {
  repo: "lodewijkmaassen/tovas-flow",
  nummer: 12,
  kop: "0123456789abcdef0123456789abcdef01234567",
  titel: "Eén kleine wijziging",
  beschrijving: "Wat er verandert en waarom.\n\nUitzonderingen: geen",
  stukken: [{ bestand: "lib/a.ts", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" }],
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

  it("noemt van een gedeelde patch welk deel het is, en kapt niets af", () => {
    const stukken = [
      { bestand: "lib/groot.ts", status: "modified", patch: "@@ -1 +1 @@\n+een", deel: 1, delen: 2 },
      { bestand: "lib/groot.ts", status: "modified", patch: "@@ -9 +9 @@\n+twee", deel: 2, delen: 2 },
    ];
    const v = bouwReviewVraag({ ...invoer, stukken, ronde: { nummer: 2, totaal: 3 } });
    expect(v).toContain("## lib/groot.ts (modified, deel 1 van 2)");
    expect(v).toContain("## lib/groot.ts (modified, deel 2 van 2)");
    expect(v).toContain("leesronde 2 van 3");
    expect(v).not.toContain("afgekapt");
    expect(v).not.toContain("weggelaten");
  });

  it("meldt bestanden zonder tekstdiff bij naam, binnen het datablok, en zegt dat hun inhoud niet gelezen is", () => {
    const v = bouwReviewVraag({ ...invoer, zonderTekst: [{ bestand: "tasks/T-1/beeld.jpg", status: "added" }] });
    expect(v).toContain("1 bestand(en) zonder tekstdiff");
    expect(v).toContain("niet gelezen en dus niet beoordeeld");
    expect(v.indexOf("tasks/T-1/beeld.jpg")).toBeGreaterThan(v.indexOf(DATA_BEGIN));
    expect(v.indexOf("tasks/T-1/beeld.jpg")).toBeLessThan(v.lastIndexOf(DATA_EIND));
    // Precies één datablok rond wat van de bouwer komt, ook met die lijst erin.
    expect(v.split(DATA_BEGIN).length - 1).toBe(2);
    expect(v.split(DATA_EIND).length - 1).toBe(2);
  });

  it("zegt niets over delen of ronden als de wijziging in één keer past", () => {
    const v = bouwReviewVraag({ ...invoer, ronde: { nummer: 1, totaal: 1 } });
    expect(v).toContain("## lib/a.ts (modified)");
    expect(v).not.toContain("leesronde");
    expect(v).not.toContain("zonder tekstdiff");
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

describe("de hele wijziging lezen, in delen als het moet", () => {
  const patch = Array.from({ length: 40 }, (_, h) => `@@ -${h * 10},3 +${h * 10},3 @@\n-oud ${h}\n+nieuw ${h}\n`).join("");

  it("knipt een te grote patch in delen die samen precies de patch zijn, op hunkgrenzen", () => {
    const delen = knipPatch(patch, 300);
    expect(delen.length).toBeGreaterThan(1);
    expect(delen.join("")).toBe(patch);
    for (const d of delen) {
      expect(d.length).toBeLessThanOrEqual(300);
      expect(d.startsWith("@@")).toBe(true);
    }
  });

  it("knipt ook een regel die zelf groter is dan de maat, zonder één teken te verliezen", () => {
    const eenRegel = `@@ -1 +1 @@\n+${"x".repeat(1_000)}\n`;
    const delen = knipPatch(eenRegel, 100);
    expect(delen.join("")).toBe(eenRegel);
    for (const d of delen) expect(d.length).toBeLessThanOrEqual(100);
  });

  it("laat een patch die past met rust", () => {
    expect(knipPatch("@@ -1 +1 @@\n+a", 1_000)).toEqual(["@@ -1 +1 @@\n+a"]);
  });

  it("verdeelt een groot bestand in genummerde delen en laat niets weg", () => {
    const groot = `@@ -1 +1 @@\n${"+regel\n".repeat(4_000)}`;
    const v = verdeelDiff([{ bestand: "a.ts", status: "modified", patch: groot }]);
    expect(v.onvolledig).toEqual([]);
    const stukken = v.ronden.flat();
    expect(stukken.length).toBeGreaterThan(1);
    expect(stukken.map((s) => s.patch).join("")).toBe(groot);
    expect(stukken.map((s) => s.deel)).toEqual(stukken.map((_, i) => i + 1));
    expect(new Set(stukken.map((s) => s.delen))).toEqual(new Set([stukken.length]));
  });

  it("voegt de oordelen van de ronden samen: één correctie maakt het geheel een correctie", () => {
    const akkoord: Review = {
      oordeel: "akkoord",
      samenvatting: "Deel een klopt.",
      punten: [{ ernst: "laag", tekst: "naamgeving", bestand: "a.ts" }],
      conclusie_eigenaar: "Het kan door.",
    };
    const correctie: Review = {
      oordeel: "correctie",
      samenvatting: "Deel twee niet.",
      punten: [{ ernst: "hoog", tekst: "de sleutel lekt", bestand: "b.ts" }],
      conclusie_eigenaar: "Er moet eerst iets hersteld worden.",
    };
    const uit = combineerReviews([akkoord, correctie]);
    expect(uit.oordeel).toBe("correctie");
    expect(uit.punten).toHaveLength(2);
    expect(uit.samenvatting).toBe("Ronde 1: Deel een klopt. Ronde 2: Deel twee niet.");
    expect(uit.conclusie_eigenaar).toBe(correctie.conclusie_eigenaar);
    // Eén oordeel blijft zichzelf; hetzelfde punt uit twee ronden komt één keer terug.
    expect(combineerReviews([akkoord])).toBe(akkoord);
    expect(combineerReviews([akkoord, akkoord]).oordeel).toBe("akkoord");
    expect(combineerReviews([akkoord, akkoord]).punten).toHaveLength(1);
  });

  it("zonder oordeel is er niets gelezen en dus geen akkoord", () => {
    const leeg = combineerReviews([]);
    expect(leeg.oordeel).toBe("correctie");
    expect(leeg.punten[0]?.ernst).toBe("hoog");
  });
});
