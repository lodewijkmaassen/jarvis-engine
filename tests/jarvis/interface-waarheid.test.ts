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

  // Hieronder wordt de echte functie uit de pagina uitgevoerd, niet haar
  // brontekst bekeken. Een eerdere versie van deze test las alleen of de bron
  // bepaalde woorden bevatte; QA toonde met een sabotage aan dat `nulstand`
  // dan volledig uitgeschakeld kon worden zonder dat één test protesteerde.
  function uitPagina<T>(naam: string): T {
    const m = new RegExp(`(?:const WACHT_WOORD = \\{[^}]*\\};\\s*)?function ${naam}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n\\}`).exec(html);
    if (!m) throw new Error(`${naam} is niet gevonden in jarvis.html`);
    const woorden = /const WACHT_WOORD = \{[^}]*\};/.exec(html)?.[0] ?? "";
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function(`${woorden}\nreturn function ${naam}(${m[1]}) {${m[2]}\n};`)() as T;
  }

  it("geeft elke wachtsoort een eigen woord, ook in de uitvoer", () => {
    const zetTekst = uitPagina<(t: unknown) => string>("zetTekst");
    const gezien = new Set<string>();
    for (const soort of ["gebeurtenis", "uitvoerder", "taak", "pull-request"]) {
      const tekst = zetTekst({ aan_zet: "wacht", wacht_soort: soort });
      expect(tekst, `soort ${soort} heeft geen eigen woord`).not.toBe("WACHT");
      expect(gezien.has(tekst), `soort ${soort} deelt zijn woord met een andere`).toBe(false);
      gezien.add(tekst);
    }
    expect(zetTekst({ aan_zet: "jarvis" })).toBe("JARVIS AAN ZET");
    expect(zetTekst({ aan_zet: "eigenaar" })).toBe("WACHT OP JOU");
  });

  it("toont de nulstand alleen als niemand aan zet is — uitgevoerd, niet gelezen", () => {
    const nulstand = uitPagina<(o: unknown, a: unknown) => string | null>("nulstand");
    const geen = { nu: [] as unknown[] };
    const o = (taken: readonly { aan_zet: string }[]) => ({ projecten: [{ taken }] });

    // Niemand aan zet: de bevestiging verschijnt.
    expect(nulstand(o([{ aan_zet: "niemand" }]), geen)).toMatch(/^nulstand/);
    // Jarvis heeft werk: geen nulstand.
    expect(nulstand(o([{ aan_zet: "jarvis" }]), geen)).toBeNull();
    // De eigenaar heeft werk: geen nulstand.
    expect(nulstand(o([{ aan_zet: "niemand" }]), { nu: [{}] })).toBeNull();
    // Alleen wachtend werk is wel een nulstand, maar wordt genoemd.
    const w = nulstand(o([{ aan_zet: "wacht" }, { aan_zet: "wacht" }]), geen);
    expect(w).toMatch(/^nulstand/);
    expect(w).toContain("2 wachtend");
  });
});

/**
 * De criteria door de volledige keten, niet alleen door `leesTaken`. QA vond
 * dat `verbindAfhankelijkheden` ná `herverdeel` de uitkomst overschreef, en
 * dat de dedup alleen greep wanneer het dossier een bestaand project-id noemt.
 * Beide gaten zaten precies tussen de losse functie en `bouwOverzicht` in.
 */
describe("door de hele keten — bouwOverzicht, niet alleen leesTaken", () => {
  it("laat een taak die op een bestaande taak wacht niet op Jarvis staan", () => {
    const o = bouwOverzicht(
      [project("jarvis", [dossier("T-20260101-wachter", "wacht op T-20260101-doel, dat eerst af moet"), dossier("T-20260101-doel", "Bouw de knop")])],
      NU,
      "jarvis",
    );
    const wachter = o.projecten[0].taken.find((t) => t.id === "T-20260101-wachter");
    expect(wachter?.aan_zet).toBe("wacht");
    expect(wachter?.wacht_soort).toBe("taak");
    expect(wachter?.stil).toBe(false);
  });

  it("stemt ook dan overeen met de regie", () => {
    const o = bouwOverzicht(
      [project("jarvis", [dossier("T-20260101-wachter", "wacht op T-20260101-doel, dat eerst af moet"), dossier("T-20260101-doel", "Bouw de knop")])],
      NU,
      "jarvis",
    );
    const regie = bepaalRegie(o, [], NU, null, "cloud");
    for (const t of o.projecten[0].taken) {
      const rt = regie.taken.find((x) => x.id === t.id);
      expect(t.aan_zet === "jarvis", `${t.id} loopt uiteen met de regie`).toBe(rt?.uitvoerbaar === true);
    }
  });

  it("ontdubbelt ook wanneer het dossier een project noemt dat niet bestaat", () => {
    // De echte opstelling: de dossiers zeggen `project: jarvis`, maar de
    // aangesloten repository's heten anders. Per doelproject ontdubbelen
    // greep dan niet, want elke kopie bleef in haar eigen bron.
    const gespiegeld = dossier("T-gespiegeld", "Bouw de knop", "jarvis");
    const o = bouwOverzicht(
      [project("tovas-flow", [gespiegeld]), project("kasboek", [gespiegeld]), project("engine", [gespiegeld])],
      NU,
      "tovas-flow",
    );
    const alle = o.projecten.flatMap((p) => p.taken);
    expect(alle.filter((t) => t.id === "T-gespiegeld")).toHaveLength(1);
  });
});

describe("AC-5 — elke wachtsoort levert een echte reden op", () => {
  // Sabotage S7 van QA: `wachtredenTekst` mocht voor sommige soorten leeg
  // worden zonder dat iets omviel.
  const gevallen: readonly [string, string][] = [
    ["wacht op gebeurtenis: het venster verstrijkt", "gebeurtenis"],
    ["Sluitstuk. **Uitvoerder: laptop.**", "uitvoerder"],
    ["wacht op PR #196", "pull-request"],
    ["wacht op T-20260101-iets", "taak"],
  ];
  for (const [stap, soort] of gevallen) {
    it(`noemt een reden bij soort ${soort}`, () => {
      const [t] = leesTaken([dossier("T-1", stap)], "jarvis", [], [], NU);
      expect(t.wacht_soort).toBe(soort);
      expect(t.wacht_op, `soort ${soort} levert geen reden`).toBeTruthy();
      expect((t.wacht_op ?? "").length).toBeGreaterThan(5);
    });
  }
});
