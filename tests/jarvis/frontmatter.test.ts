// Jarvis-kern — strikte front-matterparser.
//
// De parser is bewust klein. Deze tests leggen vooral vast WAT hij weigert:
// een tolerante parser die iets anders begrijpt dan er staat is gevaarlijker
// dan een strenge die klaagt.
import { describe, expect, it } from "vitest";
import {
  parseFrontMatter,
  schrijfDocument,
  schrijfFrontMatter,
  type FrontMatter,
} from "@/jarvis/src/frontmatter";

function moetLukken(tekst: string) {
  const resultaat = parseFrontMatter(tekst);
  if (!resultaat.ok) throw new Error(`verwachtte succes, kreeg: ${JSON.stringify(resultaat.fouten)}`);
  return resultaat;
}

describe("parseFrontMatter", () => {
  it("leest scalars met de juiste typen", () => {
    const { data } = moetLukken(
      ["---", "naam: iets", "aantal: 42", "ratio: 1.5", "aan: true", "leeg: null", "---", "body"].join("\n"),
    );
    expect(data).toEqual({ naam: "iets", aantal: 42, ratio: 1.5, aan: true, leeg: null });
  });

  it("houdt gequote waarden als string, ook als ze op een getal of boolean lijken", () => {
    const { data } = moetLukken(['---', 'versie: "42"', "vlag: 'true'", "---", ""].join("\n"));
    expect(data.versie).toBe("42");
    expect(data.vlag).toBe("true");
  });

  it("leest inline lijsten en respecteert komma's binnen quotes", () => {
    const { data } = moetLukken(['---', 'tags: [a, b, "c, d"]', "---", ""].join("\n"));
    expect(data.tags).toEqual(["a", "b", "c, d"]);
  });

  it("leest bloklijsten", () => {
    const { data } = moetLukken(["---", "bronnen:", "  - een.md", "  - twee.md", "---", ""].join("\n"));
    expect(data.bronnen).toEqual(["een.md", "twee.md"]);
  });

  it("leest één niveau nesting met zowel inline als bloklijsten", () => {
    const { data } = moetLukken(
      ["---", "triggers:", "  woorden: [webhook, sid]", "  paden:", "    - app/**", "---", ""].join("\n"),
    );
    expect(data.triggers).toEqual({ woorden: ["webhook", "sid"], paden: ["app/**"] });
  });

  it("negeert commentaar maar niet binnen quotes", () => {
    const { data } = moetLukken(["---", "a: waarde # uitleg", 'b: "waarde # geen commentaar"', "---", ""].join("\n"));
    expect(data.a).toBe("waarde");
    expect(data.b).toBe("waarde # geen commentaar");
  });

  it("geeft de body terug zonder het front-matterblok", () => {
    const { body } = moetLukken(["---", "a: 1", "---", "", "# Kop", "tekst"].join("\n"));
    expect(body).toBe("# Kop\ntekst");
  });

  it("behandelt een bestand zonder front-matter als pure body", () => {
    const resultaat = moetLukken("# Alleen markdown\n");
    expect(resultaat.data).toEqual({});
    expect(resultaat.body).toBe("# Alleen markdown\n");
  });

  it("weigert een niet-afgesloten blok", () => {
    const resultaat = parseFrontMatter("---\na: 1\nb: 2\n");
    expect(resultaat.ok).toBe(false);
  });

  it("weigert tabs", () => {
    const resultaat = parseFrontMatter("---\n\ta: 1\n---\n");
    expect(resultaat.ok).toBe(false);
    if (!resultaat.ok) expect(resultaat.fouten[0].boodschap).toContain("tabs");
  });

  it("weigert een dubbele sleutel", () => {
    const resultaat = parseFrontMatter("---\na: 1\na: 2\n---\n");
    expect(resultaat.ok).toBe(false);
    if (!resultaat.ok) expect(resultaat.fouten[0].boodschap).toContain("meer dan één keer");
  });

  it("weigert een regel zonder dubbele punt", () => {
    const resultaat = parseFrontMatter("---\nzomaar tekst\n---\n");
    expect(resultaat.ok).toBe(false);
  });

  it("meldt het regelnummer van de fout", () => {
    const resultaat = parseFrontMatter("---\na: 1\n\tb: 2\n---\n");
    expect(resultaat.ok).toBe(false);
    if (!resultaat.ok) expect(resultaat.fouten[0].regel).toBe(3);
  });
});

describe("schrijfFrontMatter", () => {
  it("is rondreisbaar: schrijven en opnieuw lezen geeft dezelfde data", () => {
    const data: FrontMatter = {
      id: "CON-0001",
      titel: "Een titel met: dubbele punt",
      aantal: 3,
      aan: false,
      tags: ["a", "b"],
      leeg: [],
      triggers: { woorden: ["webhook"], paden: ["app/**"] },
    };
    const tekst = `${schrijfFrontMatter(data)}\n`;
    const opnieuw = moetLukken(tekst);
    expect(opnieuw.data).toEqual(data);
  });

  it("quote waarden die anders als getal of boolean zouden inlezen", () => {
    const tekst = schrijfFrontMatter({ versie: "42", vlag: "true" });
    expect(tekst).toContain('versie: "42"');
    expect(tekst).toContain('vlag: "true"');
  });

  it("is deterministisch", () => {
    const data: FrontMatter = { b: 1, a: 2, lijst: ["x", "y"] };
    expect(schrijfFrontMatter(data)).toBe(schrijfFrontMatter(data));
  });

  it("schrijft een volledig document met body", () => {
    const document = schrijfDocument({ id: "DEC-0001" }, "\n\n## Besluit\ntekst\n\n\n");
    expect(document).toBe("---\nid: DEC-0001\n---\n\n## Besluit\ntekst\n");
  });
});
