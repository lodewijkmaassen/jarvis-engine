/**
 * De interface moet de werkelijke toestand tonen. Drie defecten maakten dat
 * onmogelijk, en deze tests leggen elk ervan vast.
 *
 * 1. `aan_zet` kende alleen `jarvis` en `eigenaar`, dus wachtend werk las als
 *    "Jarvis aan zet" — de kaart toonde werk dat niemand kon doen.
 * 2. `stil` volgde uit `aan_zet === "jarvis"` en sloeg daardoor aan op bewust
 *    geparkeerd werk, wat als storing leest in plaats van als keuze.
 * 3. Een dossier dat in twee repository's staat, leverde twee taakregels.
 *
 * AC-2 vraagt bovendien dat overzicht en regie dezelfde stap hetzelfde noemen;
 * de laatste test vergelijkt beide beelden rechtstreeks.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bouwOverzicht,
  leesTaken,
  wachtredenVanStap,
  type ProjectInvoer,
  type TaakDossier,
} from "../../jarvis/src/overzicht";
import { bepaalRegie } from "../../jarvis/src/regie";

const NU = new Date("2026-09-24T22:00:00Z");

/** Een dossier met één open stap, zodat `volgendeStap` die stap is. */
function dossier(id: string, stap: string, project = "jarvis"): TaakDossier {
  return {
    id,
    opdracht: { status: "actief", titel: id, project, klasse: "S" },
    resultaat: `# Resultaat\n\n## Voortgang\n\n- [x] Begonnen\n- [ ] ${stap}\n`,
    tekst: `---\nid: ${id}\n---\n\nscope\n`,
  } as unknown as TaakDossier;
}

function project(id: string, taken: readonly TaakDossier[]): ProjectInvoer {
  return {
    id,
    naam: id,
    aangesloten: true,
    hoofdbranch: { naam: "main", commit: "abc1234", datum: "2026-09-24" },
    statusDocument: "# CURRENT_STATE\n\n## Waar staan we\n\nIets.\n",
    records: [],
    taken,
    gitLog: [],
  };
}

describe("AC-1 — wachtend werk staat niet op Jarvis", () => {
  const gevallen: readonly [string, string, string][] = [
    ["een gebeurtenis", "wacht op gebeurtenis: de eigenaar geeft dit werk vrij", "gebeurtenis"],
    ["een andere uitvoerder", "Sluitstuk. **Uitvoerder: laptop.** De cloud kan dit niet.", "uitvoerder"],
    ["een pull request", "wacht op PR #196 — de pin samenvoegen", "pull-request"],
    ["een andere taak", "wacht op T-20260101-iets, dat eerst af moet", "taak"],
  ];
  for (const [wat, stap, soort] of gevallen) {
    it(`herkent wachten op ${wat}`, () => {
      const [t] = leesTaken([dossier("T-1", stap)], "jarvis", [], [], NU);
      expect(t.aan_zet).toBe("wacht");
      expect(t.wacht_soort).toBe(soort);
    });
  }

  it("laat gewoon werk op Jarvis staan", () => {
    const [t] = leesTaken([dossier("T-1", "Bouw de knop")], "jarvis", [], [], NU);
    expect(t.aan_zet).toBe("jarvis");
    expect(t.wacht_soort).toBeNull();
  });

  it("laat het akkoord van de eigenaar voorgaan op een wachtreden", () => {
    const [t] = leesTaken(
      [dossier("T-1", "Akkoord van de eigenaar op deze taak. **Uitvoerder: laptop.**")],
      "jarvis",
      [],
      [],
      NU,
    );
    expect(t.aan_zet).toBe("eigenaar");
  });
});

describe("AC-4 — wachtend werk is nooit stil", () => {
  it("meldt een taak zonder beweging die wacht niet als stil", () => {
    const [t] = leesTaken([dossier("T-1", "wacht op gebeurtenis: het venster verstrijkt")], "jarvis", [], [], NU);
    expect(t.stil).toBe(false);
  });
});

describe("AC-5 — wacht_op is kort en leesbaar", () => {
  it("vat een alinea van honderden tekens samen tot één regel", () => {
    const lang = `wacht op gebeurtenis: ${"een zeer lange toelichting ".repeat(30)}`;
    const [t] = leesTaken([dossier("T-1", lang)], "jarvis", [], [], NU);
    expect(t.wacht_op).not.toBeNull();
    expect((t.wacht_op ?? "").length).toBeLessThanOrEqual(140);
    expect(t.wacht_op).toMatch(/^wacht op: /);
  });

  it("kort ook een gewone volgende stap af", () => {
    const [t] = leesTaken([dossier("T-1", "Bouw ".repeat(100))], "jarvis", [], [], NU);
    expect((t.wacht_op ?? "").length).toBeLessThanOrEqual(170);
  });
});

describe("AC-3 — één taakregel per dossier", () => {
  it("toont een dossier dat in twee repository's staat precies één keer", () => {
    const gespiegeld = dossier("T-gedeeld", "Bouw de knop");
    const o = bouwOverzicht(
      [project("jarvis", [gespiegeld, dossier("T-eigen", "Iets anders")]), project("kasboek", [gespiegeld])],
      NU,
      "jarvis",
    );
    const jarvis = o.projecten.find((p) => p.id === "jarvis");
    const ids = (jarvis?.taken ?? []).map((t) => t.id);
    expect(ids.filter((id) => id === "T-gedeeld")).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("AC-2 — overzicht en regie noemen dezelfde stap hetzelfde", () => {
  const gevallen = [
    "wacht op gebeurtenis: iets buiten Jarvis",
    "Sluitstuk. **Uitvoerder: laptop.**",
    "wacht op PR #196",
    "Bouw de knop",
  ];
  for (const stap of gevallen) {
    it(`is het eens over "${stap.slice(0, 40)}"`, () => {
      const o = bouwOverzicht([project("jarvis", [dossier("T-1", stap)])], NU, "jarvis");
      const taak = o.projecten[0].taken[0];
      const regie = bepaalRegie(o, [], NU, null, "cloud");
      const rt = regie.taken.find((t) => t.id === "T-1");
      expect(rt).toBeDefined();
      // Wacht het overzicht, dan is de taak voor de regie niet uitvoerbaar —
      // en omgekeerd. Dat is precies de koppeling die eerder ontbrak.
      expect(taak.aan_zet === "wacht").toBe(rt?.uitvoerbaar === false);
    });
  }

  it("gebruikt dezelfde patronen als de regie, niet een eigen kopie", () => {
    // Een stap die de regie als wachtend leest, moet het overzicht ook zo
    // lezen. Zou een van beide een eigen regex houden, dan loopt dit stuk.
    expect(wachtredenVanStap("wacht op gebeurtenis: x")?.soort).toBe("gebeurtenis");
    expect(wachtredenVanStap("**Uitvoerder: laptop.**")?.soort).toBe("uitvoerder");
    expect(wachtredenVanStap("wacht op pull request owner/repo#12")?.soort).toBe("pull-request");
    expect(wachtredenVanStap("wacht op T-20260101-iets")?.soort).toBe("taak");
    expect(wachtredenVanStap("gewoon werk")).toBeNull();
    expect(wachtredenVanStap(null)).toBeNull();
  });
});

describe("AC-6 — de interface kent elke waarde van aan_zet", () => {
  // Dezelfde klasse fout als in interface-toestanden.test.ts, maar op de
  // andere as: `aan_zet` in overzicht.ts en de weergave in jarvis.html zijn
  // twee lijsten die hetzelfde moeten weten. Toen `wacht` erbij kwam, viel
  // het zonder deze wacht stil terug op de lege tekst.
  const bron = readFileSync(path.join(process.cwd(), "jarvis/src/overzicht.ts"), "utf8");
  const html = readFileSync(path.join(process.cwd(), "jarvis/interface/jarvis.html"), "utf8");

  function aanZetWaarden(): readonly string[] {
    const m = /readonly aan_zet:\s*([^;]+);/.exec(bron);
    if (!m) throw new Error("het type van aan_zet is niet gevonden in overzicht.ts");
    return [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
  }

  it("noemt elke waarde in zetTekst en zetKort", () => {
    const waarden = aanZetWaarden();
    expect(waarden).toContain("wacht");
    const zetTekst = /function zetTekst\(t\) \{([\s\S]*?)\n\}/.exec(html)?.[1] ?? "";
    const zetKort = /function zetKort\(t\) \{([\s\S]*?)\n\}/.exec(html)?.[1] ?? "";
    expect(zetTekst).not.toBe("");
    expect(zetKort).not.toBe("");
    for (const w of waarden) {
      if (w === "niemand") continue; // de terugval, die geen eigen tak heeft
      expect(zetTekst, `zetTekst kent "${w}" niet`).toContain(`"${w}"`);
      expect(zetKort, `zetKort kent "${w}" niet`).toContain(`"${w}"`);
    }
  });

  it("kent elke soort wachtreden een eigen woord toe", () => {
    const soorten = [...(/readonly wacht_soort:\s*([^;]+);/.exec(bron)?.[1] ?? "").matchAll(/"([a-z-]+)"/g)].map((x) => x[1]);
    expect(soorten.length).toBeGreaterThan(0);
    const woorden = /const WACHT_WOORD = \{([^}]*)\}/.exec(html)?.[1] ?? "";
    for (const s of soorten) {
      expect(woorden, `WACHT_WOORD kent "${s}" niet`).toMatch(new RegExp(`["']?${s}["']?\\s*:`));
    }
  });

  it("toont de nulstand pas als niemand aan zet is", () => {
    const fn = /function nulstand\(o, acties\) \{([\s\S]*?)\n\}/.exec(html)?.[1] ?? "";
    expect(fn).not.toBe("");
    // De twee voorwaarden moeten allebei in de wacht staan.
    expect(fn).toContain("acties.nu.length");
    expect(fn).toContain('"jarvis"');
  });
});
