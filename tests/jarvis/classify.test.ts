// Jarvis-kern — bestandsclassificatie en budgetbeheersing.
//
// De aanleiding is concreet: lib/db/types.ts in deze repo is 1.306 regels
// gegenereerde Supabase-output. Zonder classificatie zou dat ene bestand het
// hele S-budget opeten. Deze tests borgen dat het niet kan.
import { describe, expect, it } from "vitest";
import {
  classificeer,
  fragment,
  globNaarRegex,
  matchtGlob,
  normaliseerPad,
  renderVoorKlasse,
  schatTokens,
  symbolen,
} from "@/jarvis/src/classify";

const CONFIG = { nooit: ["package-lock.json", "**/*.tsbuildinfo"], symbolen: ["lib/db/types.ts"], fragmentRegels: 40 };

describe("globNaarRegex", () => {
  it("matcht * binnen één segment maar niet over een slash heen", () => {
    expect(globNaarRegex("app/*.ts").test("app/x.ts")).toBe(true);
    expect(globNaarRegex("app/*.ts").test("app/diep/x.ts")).toBe(false);
  });

  it("matcht ** over meerdere segmenten, inclusief nul segmenten", () => {
    expect(globNaarRegex("**/*.ts").test("x.ts")).toBe(true);
    expect(globNaarRegex("**/*.ts").test("a/b/x.ts")).toBe(true);
    expect(globNaarRegex("app/**").test("app/a/b/c.ts")).toBe(true);
  });

  it("behandelt punten als letterlijk", () => {
    expect(globNaarRegex("a.ts").test("axts")).toBe(false);
  });

  it("matcht ? op precies één teken", () => {
    expect(globNaarRegex("a?.ts").test("ab.ts")).toBe(true);
    expect(globNaarRegex("a?.ts").test("abc.ts")).toBe(false);
  });
});

describe("normaliseerPad", () => {
  it("lost . en .. op, zodat een voorvoegselcontrole niet te omzeilen is", () => {
    // Zonder deze stap begint "tests/../jarvis/src/lint.ts" met "tests/" en
    // glipt een enginewijziging langs een rolgrens die alleen tests toestaat.
    expect(normaliseerPad("tests/../jarvis/src/lint.ts")).toBe("jarvis/src/lint.ts");
    expect(normaliseerPad("./docs/./STAND.md")).toBe("docs/STAND.md");
    expect(normaliseerPad("a/b/../../c.ts")).toBe("c.ts");
    // Een pad dat boven de wortel uitkomt hoort nergens bij en blijft staan.
    expect(normaliseerPad("../buiten.ts")).toBe("../buiten.ts");
  });

  it("maakt Windows-scheidingstekens gelijk aan forward slashes", () => {
    expect(normaliseerPad("lib\\db\\types.ts")).toBe("lib/db/types.ts");
    expect(normaliseerPad("./a/b.ts")).toBe("a/b.ts");
  });

  it("laat globmatching over Windows-paden werken", () => {
    expect(matchtGlob("lib\\db\\types.ts", ["lib/db/*.ts"])).toBe(true);
  });
});

describe("schatTokens", () => {
  it("schat ongeveer vier tekens per token en is deterministisch", () => {
    expect(schatTokens("")).toBe(0);
    expect(schatTokens("abcd")).toBe(1);
    expect(schatTokens("a".repeat(4001))).toBe(1001);
    expect(schatTokens("herhaal")).toBe(schatTokens("herhaal"));
  });
});

describe("classificeer", () => {
  it("sluit uit wat op de nooit-lijst staat", () => {
    expect(classificeer("package-lock.json", "{}", CONFIG).klasse).toBe("nooit");
    expect(classificeer("app/x.tsbuildinfo", "{}", CONFIG).klasse).toBe("nooit");
  });

  it("symboliseert wat expliciet als gegenereerd is geconfigureerd", () => {
    const uitkomst = classificeer("lib/db/types.ts", "export type A = 1;", CONFIG);
    expect(uitkomst.klasse).toBe("symbolen");
    expect(uitkomst.reden).toContain("context_symbolen");
  });

  it("herkent een bestand dat zichzelf als gegenereerd aankondigt", () => {
    const inhoud = "// Gegenereerde types — dit bestand is een build-output\nexport type A = 1;\n";
    expect(classificeer("lib/iets.ts", inhoud, CONFIG).klasse).toBe("symbolen");
  });

  it("kijkt alleen naar de kop, niet naar willekeurige code verderop", () => {
    const inhoud = `${"const x = 1;\n".repeat(30)}// dit is gegenereerd\n`;
    expect(classificeer("lib/iets.ts", inhoud, CONFIG).klasse).not.toBe("symbolen");
  });

  it("fragmenteert grote handgeschreven bestanden", () => {
    const uitkomst = classificeer("lib/groot.ts", "regel\n".repeat(100), CONFIG);
    expect(uitkomst.klasse).toBe("fragment");
    expect(uitkomst.reden).toContain("boven de drempel");
  });

  it("neemt kleine bestanden voluit mee", () => {
    expect(classificeer("lib/klein.ts", "regel\n".repeat(5), CONFIG).klasse).toBe("volledig");
  });
});

describe("symbolen", () => {
  const gegenereerd = [
    "export type Database = {",
    "  public: {",
    "    Tables: {",
    "      leads: {",
    "        Row: {",
    "          id: string",
    "          telefoon: string | null",
    "        }",
    "      }",
    "    }",
    "  }",
    "}",
    "function intern() {",
    "  const weg = 1;",
    "  return weg;",
    "}",
  ].join("\n");

  it("houdt declaraties en ondiepe sleutels over, en gooit de rest weg", () => {
    const uit = symbolen(gegenereerd);
    expect(uit).toContain("export type Database");
    expect(uit).toContain("leads:");
    expect(uit).not.toContain("const weg = 1");
  });

  it("vermeldt hoeveel er is weggelaten", () => {
    expect(symbolen(gegenereerd)).toContain("symbolenskelet");
  });

  it("respecteert het maximum aantal regels", () => {
    const groot = Array.from({ length: 500 }, (_, i) => `export const x${i} = ${i};`).join("\n");
    const uit = symbolen(groot, 10);
    expect(uit.split("\n").filter((r) => r.startsWith("export const")).length).toBe(10);
    expect(uit).toContain("verdere regels weggelaten");
  });

  it("brengt een groot gegenereerd bestand fors terug", () => {
    const groot = Array.from({ length: 1300 }, (_, i) => `          veld${i}: string`).join("\n");
    const voor = schatTokens(groot);
    const na = schatTokens(symbolen(groot));
    expect(na).toBeLessThan(voor / 2);
  });
});

describe("fragment", () => {
  const bestand = Array.from({ length: 200 }, (_, i) => (i === 100 ? "const doelwit = 1;" : `const r${i} = ${i};`)).join(
    "\n",
  );

  it("houdt de regels rond een treffer over", () => {
    const uit = fragment(bestand, ["doelwit"], 3);
    expect(uit).toContain("doelwit");
    expect(uit).toContain("101|");
    expect(uit).not.toContain("const r10 = 10;");
  });

  it("markeert weggelaten stukken expliciet", () => {
    const met = Array.from({ length: 200 }, (_, i) =>
      i === 10 || i === 150 ? "const doelwit = 1;" : `const r${i} = ${i};`,
    ).join("\n");
    expect(fragment(met, ["doelwit"], 2)).toContain("weggelaten");
  });

  it("valt terug op het symbolenskelet als niets matcht", () => {
    expect(fragment(bestand, ["bestaatniet"], 3)).toContain("symbolenskelet");
  });

  it("valt terug op het symbolenskelet zonder zoektermen", () => {
    expect(fragment(bestand, [], 3)).toContain("symbolenskelet");
  });
});

describe("renderVoorKlasse", () => {
  it("levert niets voor de klasse nooit", () => {
    expect(renderVoorKlasse("nooit", "inhoud", [], 40)).toBeNull();
  });

  it("levert de volledige inhoud voor de klasse volledig", () => {
    expect(renderVoorKlasse("volledig", "inhoud", [], 40)).toBe("inhoud");
  });

  it("is deterministisch", () => {
    const inhoud = "export const a = 1;\nconst b = 2;\n";
    expect(renderVoorKlasse("symbolen", inhoud, ["a"], 40)).toBe(renderVoorKlasse("symbolen", inhoud, ["a"], 40));
  });
});
