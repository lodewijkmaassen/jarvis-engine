// D-20261121-105625624 — de taakwerkruimte van V3.
//
// Een doel klapte uit tot een lange kaart met de volledige opdracht en uitkomst; de eigenaar moest scrollen om te
// lezen of te reageren, een gewone reactie op een afgerond doel startte altijd een nieuwe uitvoering, en lange
// uitkomsten waren bij het opslaan al afgekapt. Deze tests bewaken de drie delen van het herstel:
//   1. de opslag kapt niet meer stil af (begrens, en geen vaste grenzen van 500–1800 tekens meer);
//   2. de pagina haalt opdracht en uitkomst correct uit elkaar (pure functies uit v3.html);
//   3. de gebruikersstromen in een echte browser: openen, tabbladen, reageren, opnieuw uitvoeren en terugkeren,
//      op bureaublad en telefoon. Die test draait waar Playwright met Chromium beschikbaar is en slaat anders over.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { begrens, MAX_LOGREGEL_TEKENS, MAX_UITKOMST_TEKENS } from "../../jarvis/src/doelen";
import { eindoordeel, parseerBeoordeling } from "../../jarvis/src/acceptatie";

const WORTEL = process.cwd();
const HTML = readFileSync(path.join(WORTEL, "jarvis/interface/v3.html"), "utf8");
const bron = /\/\/ werkruimte:begin\n([\s\S]*?)\n  \/\/ werkruimte:einde/.exec(HTML)?.[1] ?? "";
const { splitsOpdracht, leesUitkomst } = new Function(`${bron}; return { splitsOpdracht, leesUitkomst };`)() as {
  splitsOpdracht: (t: string) => { basis: string; reacties: { op: string; tekst: string; vorige: string | null }[] };
  leesUitkomst: (t: string | null) => null | { conclusie: string; staat: string; punten: { titel: string | null; staat: string; label: string | null; reden: string }[]; volledig: string; keten: string | null; rapport: string | null };
};

describe("lange uitkomsten gaan volledig de opslag in", () => {
  it("begrens laat een gewone lange tekst heel en zegt het als er toch iets wegvalt", () => {
    const lang = "x".repeat(5000);
    expect(begrens(lang)).toBe(lang);
    const absurd = "y".repeat(MAX_UITKOMST_TEKENS + 500);
    const kort = begrens(absurd);
    expect(kort.length).toBe(MAX_UITKOMST_TEKENS);
    expect(kort).toContain(`[afgekapt na ${MAX_UITKOMST_TEKENS} van ${absurd.length} tekens]`);
    expect(begrens("z".repeat(MAX_LOGREGEL_TEKENS + 1), MAX_LOGREGEL_TEKENS)).toContain("[afgekapt na");
  });
  it("de reden van een acceptatietest en het eindoordeel worden niet meer afgekapt", () => {
    const reden = "r".repeat(2500);
    expect(parseerBeoordeling(JSON.stringify({ geslaagd: true, reden })).reden).toBe(reden);
    const e = eindoordeel([{ id: "a", staat: "geslaagd", reden } as never, { id: "b", staat: "geslaagd", reden } as never]);
    expect(e.samenvatting.length).toBeGreaterThan(5000);
  });
  it("de eindcontrole schrijft geen vaste grenzen van 1500/1700 tekens meer in de uitkomst", () => {
    const cli = readFileSync(path.join(WORTEL, "jarvis/src/doelen-cli.ts"), "utf8");
    expect(cli).not.toMatch(/slice\(0, 1[57]00\)/);
    expect(cli).not.toMatch(/`Status \$\{van\}[^\n]*\.slice\(0, 500\)/);
    expect(readFileSync(path.join(WORTEL, "jarvis/src/doel-acceptatie.ts"), "utf8")).not.toContain("tekst.slice(0, 500)");
  });
});

describe("opdracht en uitkomst uit elkaar halen", () => {
  it("scheidt de oorspronkelijke opdracht van latere reacties en vorige uitkomsten", () => {
    const t = "Project: a/b\nBouw iets.\nMet regels.\n\nReactie van de eigenaar (2026-11-20 10:00):\nDoe het blauw.\n\n(Vorige uitkomst: acceptatietests geslaagd — x)\n\nReactie van de eigenaar (2026-11-21 09:30):\nNog een vraag.";
    const o = splitsOpdracht(t);
    expect(o.basis).toBe("Bouw iets.\nMet regels.");
    expect(o.reacties).toEqual([
      { op: "2026-11-20 10:00", tekst: "Doe het blauw.", vorige: "acceptatietests geslaagd — x" },
      { op: "2026-11-21 09:30", tekst: "Nog een vraag.", vorige: null },
    ]);
  });
  it("leest een acceptatie-uitkomst als conclusie met losse resultaten en hun staat", () => {
    const u = leesUitkomst("acceptatietests niet geslaagd (ronde 1 van 3) — t1: geslaagd — alles goed | t2: niet-geslaagd — knop ontbreekt [keten abc1234]");
    expect(u?.conclusie).toBe("acceptatietests niet geslaagd (ronde 1 van 3)");
    expect(u?.staat).toBe("fout");
    expect(u?.keten).toBe("abc1234");
    expect(u?.punten).toEqual([
      { titel: "t1", staat: "goed", label: "geslaagd", reden: "alles goed" },
      { titel: "t2", staat: "fout", label: "niet-geslaagd", reden: "knop ontbreekt" },
    ]);
  });
  it("leest een reviewblok als conclusie en houdt het rapport volledig", () => {
    const rapport = "jarvis review: o/r#1 op abc1234 — oordeel AKKOORD.\n" + "punt ".repeat(800);
    const u = leesUitkomst(`Review GO op abc1234 (2026-11-21 11:37):\n${rapport}\n\n— Eerdere uitkomst —\noud`);
    expect(u?.conclusie).toBe("Review GO op abc1234 (2026-11-21 11:37)");
    expect(u?.staat).toBe("goed");
    expect(u?.rapport).toBe(rapport.trim());
  });
  it("verzint niets: geen uitkomst is geen resultaat, en een vrije tekst wordt alleen samengevat", () => {
    expect(leesUitkomst(null)).toBeNull();
    expect(leesUitkomst("   ")).toBeNull();
    const u = leesUitkomst("productie gemeten: HTTP 200. Verder niets.");
    expect(u?.conclusie).toBe("productie gemeten: HTTP 200.");
    expect(u?.punten).toEqual([]);
    expect(u?.volledig).toBe("productie gemeten: HTTP 200. Verder niets.");
  });
});

describe("de werkruimte in de pagina", () => {
  it("opent een doel via een eigen route in plaats van uit te klappen, met de vier tabbladen", () => {
    expect(HTML).toContain('href="#/doel/${esc(d.id)}" data-doel="${esc(d.id)}"');
    expect(HTML).not.toContain("geopend.add");
    for (const tab of ['["overzicht", "Overzicht"]', '["bewijs", "Bewijs & tests"]', '["opdracht", "Opdracht"]', '["historie", "Historie"]']) expect(HTML).toContain(tab);
  });
  it("houdt het reactieveld onderaan in beeld, ook boven het toetsenbord van een telefoon", () => {
    expect(HTML).toMatch(/\.reactiebalk \{ position:sticky; bottom:0;/);
    expect(HTML).toContain("interactive-widget=resizes-content");
  });
  it("een gewone reactie is een verwerkt bericht en roept doel_reageer niet aan", () => {
    const blok = /addEventListener\("submit"[\s\S]*?\n  \}\);/.exec(HTML)?.[0] ?? "";
    expect(blok).toContain('status: "verwerkt"');
    expect(blok).toContain("doel_reactie: { doel: id, tekst }");
    expect(blok).not.toContain("doel_reageer");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// De gebruikersstromen in een echte browser.
const eis = createRequire(import.meta.url);
// Geen afhankelijkheid van het pakket: waar Playwright niet geïnstalleerd is, slaat dit blok over.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let playwright: any = null;
try { playwright = eis("playwright"); } catch { playwright = null; }

const LANGE_REDEN = "Het bewijs toont " + "een gemeten stap, ".repeat(120) + "en dat is het einde van de reden.";
function nepData() {
  const nu = Date.now();
  const t = (min: number) => new Date(nu - min * 60_000).toISOString();
  const doelen = [
    { id: "D-1", titel: "Afgerond doel met lange uitkomst", status: "klaar", opdracht: "Bouw de rekenmodule.\n\nReactie van de eigenaar (2026-11-20 10:00):\nMaak hem sneller.\n\n(Vorige uitkomst: eerdere meting)", acceptatie_url: null,
      uitkomst: `acceptatietests geslaagd — eindresultaat: geslaagd — ${LANGE_REDEN} [keten abc1234]`, pr: { repo: "o/r", nummer: 7, kop: "abc", merge_sha: "def" }, pogingen: 0, aangemaakt: t(600), bijgewerkt: t(30) },
    { id: "D-2", titel: "Doel in review", status: "review", opdracht: "Voeg een knop toe.", acceptatie_url: null, uitkomst: null, pr: { repo: "o/r", nummer: 8 }, pogingen: 0, aangemaakt: t(120), bijgewerkt: t(5) },
  ];
  for (let i = 3; i <= 30; i++) doelen.push({ id: `D-${i}`, titel: `Ouder doel ${i}`, status: "klaar", opdracht: "Iets.", acceptatie_url: null, uitkomst: "samengevoegd", pr: null as never, pogingen: 0, aangemaakt: t(1000 + i), bijgewerkt: t(900 + i) });
  return {
    doelen,
    activiteit: [
      { op: t(31), uitvoerder: "ci", rol: "qa", taak: "D-1", project: null, soort: "acceptatie", tekst: `test eindresultaat: geslaagd — ${LANGE_REDEN}`, verwijzing: null },
      { op: t(40), uitvoerder: "cloud", rol: "developer", taak: "D-1", project: null, soort: "pr", tekst: "Status bezig → review", verwijzing: "r#7" },
    ],
    toetsingen: [{ pr_repo: "o/r", pr_nummer: 7, commit_sha: "abc1234ffff", oordeel: "GO", rapport: "Volledig reviewrapport.", door: "ci-review", op: t(45) }],
    berichten: [], autorisaties: [],
  };
}

describe.skipIf(playwright === null)("de werkruimte in een echte browser (Chromium)", () => {
  async function open(viewport: { width: number; height: number }) {
    const browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport });
    const fouten: string[] = [];
    page.on("pageerror", (e: Error) => fouten.push(e.message));
    await page.route("**/*", async (route: { request: () => { url: () => string }; fulfill: (r: object) => Promise<void> }) => {
      const url = new URL(route.request().url());
      if (url.hostname === "cdn.jsdelivr.net") return route.fulfill({ contentType: "application/javascript", body: readFileSync(path.join(WORTEL, "tests/jarvis/fixtures/v3-nepdatabase.js"), "utf8") });
      if (url.pathname === "/config.js") return route.fulfill({ contentType: "application/javascript", body: `window.JARVIS_SUPABASE = { url: "https://nep.test", key: "nep" }; window.__nepData = ${JSON.stringify(nepData())};` });
      if (url.pathname === "/v3/") return route.fulfill({ contentType: "text/html", body: HTML });
      return route.fulfill({ status: 404, body: "" });
    });
    await page.goto("http://jarvis.test/v3/");
    await page.waitForSelector('a.kop[data-doel="D-2"]');
    return { browser, page, fouten };
  }

  it("bureaublad: openen, tabbladen, reageren zonder herstart, opnieuw uitvoeren en terug naar dezelfde plek", async () => {
    const { browser, page, fouten } = await open({ width: 1366, height: 820 });
    try {
      await page.click('button[data-actie="vouw"][data-blok="cc:klaar"]');
      // Playwright scrolt een link zelf in beeld vóór een klik; de hoogte telt vanaf dat moment.
      await page.locator('a.kop[data-doel="D-1"]').scrollIntoViewIfNeeded();
      const hoogte = await page.evaluate(() => window.scrollY);
      expect(hoogte).toBeGreaterThan(200);
      await page.click('a.kop[data-doel="D-1"]');
      await page.waitForSelector("article.taak");
      expect(page.url()).toContain("#/doel/D-1");
      // Bureaublad: navigatie, takenlijst en taak naast elkaar.
      expect(await page.isVisible(".zijbalk")).toBe(true);
      expect(await page.isVisible(".werklijst")).toBe(true);
      expect(await page.textContent(".resultaat p")).toBe("acceptatietests geslaagd");
      // Een lang resultaat is volledig aanwezig (niet afgekapt), compact getoond met een uitklapdeel.
      expect(await page.textContent(".punten details .tekstblok")).toBe(LANGE_REDEN);
      // Het reactieveld staat in beeld zonder te scrollen, en blijft er na scrollen.
      const balk = async () => page.$eval(".reactiebalk", (e: Element) => { const r = e.getBoundingClientRect(); return r.bottom <= window.innerHeight + 1 && r.top >= 0; });
      expect(await balk()).toBe(true);
      await page.click('button[data-tab="bewijs"]');
      expect(await page.textContent("#tabpaneel")).toContain("Review GO op abc1234");
      await page.click('button[data-tab="opdracht"]');
      expect((await page.textContent("#tabpaneel"))?.trim().startsWith("Oorspronkelijke opdrachtBouw de rekenmodule.")).toBe(true);
      await page.click('button[data-tab="historie"]');
      const historie = await page.textContent("#tabpaneel");
      expect(historie).toContain("Maak hem sneller.");
      expect(historie).toContain("Status bezig → review");
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      expect(await balk()).toBe(true);
      // Gewone reactie op een afgerond doel: bewaard, geen doel_reageer, status blijft klaar.
      await page.fill(".reactiebalk textarea", "Mooi gedaan, alleen een opmerking.");
      await page.click('button[data-actie="notitie"]');
      await page.waitForFunction(() => (window as unknown as { __nep: { inserts: unknown[] } }).__nep.inserts.length === 1);
      const na = await page.evaluate(() => {
        const w = window as unknown as { __nep: { rpcs: unknown[] }; __nepData: { doelen: { id: string; status: string }[] } };
        return { rpcs: w.__nep.rpcs.length, status: w.__nepData.doelen.find((d) => d.id === "D-1")?.status };
      });
      expect(na).toEqual({ rpcs: 0, status: "klaar" });
      await page.waitForFunction(() => document.querySelector("#tabpaneel")?.textContent?.includes("startte niets"));
      // Opnieuw uitvoeren is een aparte, bevestigde keuze.
      page.once("dialog", (d: { accept: () => Promise<void> }) => d.accept());
      await page.fill(".reactiebalk textarea", "Doe het opnieuw met de nieuwe regels.");
      await page.click('button[data-actie="reageer"]');
      await page.waitForFunction(() => (window as unknown as { __nep: { rpcs: unknown[] } }).__nep.rpcs.length === 1);
      await page.waitForFunction(() => document.querySelector(".taakkop .badge")?.textContent === "nieuw");
      // Navigeren via de takenlijst en daarna terug naar het overzicht, op de oude hoogte.
      await page.click('.werklijst a[data-doel="D-2"]');
      await page.waitForFunction(() => document.querySelector(".taakkop h1")?.textContent === "Doel in review");
      expect(await page.textContent(".resultaat p")).toBe("Nog geen resultaat vastgelegd.");
      expect(await page.textContent(".reactiebalk button[data-actie=reageer]")).toBe("Meegeven als instructie");
      await page.click('button[data-actie="terug"]');
      await page.waitForSelector(".bovenrij");

      await page.waitForFunction((y: number) => Math.abs(window.scrollY - y) < 5, hoogte);
      expect(fouten).toEqual([]);
    } finally { await browser.close(); }
  }, 60_000);

  it("telefoon (360×640): schermvullend zonder zijbalk, geen horizontaal scrollen, reactieveld in beeld", async () => {
    const { browser, page, fouten } = await open({ width: 360, height: 640 });
    try {
      await page.click('button[data-actie="vouw"][data-blok="cc:klaar"]');
      await page.click('a.kop[data-doel="D-1"]');
      await page.waitForSelector("article.taak");
      expect(await page.isVisible(".zijbalk")).toBe(false);
      expect(await page.isVisible(".werklijst")).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const inBeeld = () => page.$eval(".reactiebalk", (e: Element) => { const r = e.getBoundingClientRect(); return r.bottom <= window.innerHeight + 1 && r.top > 0; });
      expect(await inBeeld()).toBe(true);
      await page.click('button[data-tab="historie"]');
      await page.evaluate(() => window.scrollTo(0, 2000));
      expect(await inBeeld()).toBe(true);
      await page.click('button[data-actie="terug"]');
      await page.waitForSelector(".bovenrij");
      expect(await page.isVisible(".zijbalk")).toBe(true);
      expect(fouten).toEqual([]);
    } finally { await browser.close(); }
  }, 60_000);

  // De meting die de eerste acceptatieronde miste: op elk gangbaar schermformaat en in elk tabblad geen
  // horizontaal scrollen, geen element buiten het scherm, geen overlappende blokken of knoppen, en de volgorde
  // taakidentiteit → resultaat → belangrijkste resultaten → tabbladen, met het resultaat direct in beeld.
  const SCHERMEN = [
    { naam: "kleine telefoon", width: 320, height: 568 },
    { naam: "Android", width: 360, height: 640 },
    { naam: "iPhone SE", width: 375, height: 667 },
    { naam: "iPhone 14", width: 390, height: 844 },
    { naam: "grote Android", width: 412, height: 915 },
    { naam: "tablet", width: 768, height: 1024 },
    { naam: "bureaublad", width: 1366, height: 820 },
  ];
  for (const scherm of SCHERMEN) {
    it(`${scherm.naam} (${scherm.width}×${scherm.height}): volgorde, resultaat direct in beeld, niets overlapt of steekt uit, in alle vier tabbladen`, async () => {
      const { browser, page, fouten } = await open({ width: scherm.width, height: scherm.height });
      try {
        await page.click('button[data-actie="vouw"][data-blok="cc:klaar"]');
        await page.click('a.kop[data-doel="D-1"]');
        await page.waitForSelector("article.taak");
        await page.evaluate(() => window.scrollTo(0, 0));
        const meet = () => page.evaluate(() => {
          const box = (s: string) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
          const vw = document.documentElement.clientWidth;
          const uitsteken = Array.from(document.querySelectorAll("article.taak *"))
            .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.right > vw + 0.5 || r.left < -0.5); })
            .map((e) => `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className)} "${(e.textContent ?? "").trim().slice(0, 40)}" ${Math.round(e.getBoundingClientRect().left)}-${Math.round(e.getBoundingClientRect().right)}`);
          const knoppen = Array.from(document.querySelectorAll(".reactiebalk .knoppen button")).map((e) => e.getBoundingClientRect());
          const knoppenOverlap = knoppen.some((a, i) => knoppen.some((b, j) => i < j && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5));
          return {
            horizontaal: document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth,
            uitsteken, knoppenOverlap, hoogte: window.innerHeight,
            kop: box(".taakkop"), resultaat: box(".resultaat"), punten: box(".punten"), tabs: box(".tabs"), paneel: box("#tabpaneel"), balk: box(".reactiebalk"),
          };
        });
        const m = await meet();
        // Volgorde zonder overlap: kop boven resultaat boven belangrijkste resultaten boven tabbladen boven paneel.
        expect(m.kop!.bottom).toBeLessThanOrEqual(m.resultaat!.top + 0.5);
        expect(m.resultaat!.bottom).toBeLessThanOrEqual(m.punten!.top + 0.5);
        expect(m.punten!.bottom).toBeLessThanOrEqual(m.tabs!.top + 0.5);
        expect(m.tabs!.bottom).toBeLessThanOrEqual(m.paneel!.top + 0.5);
        // Het resultaat staat direct bij openen volledig in beeld, boven het reactieveld, zonder te scrollen.
        expect(m.resultaat!.top).toBeGreaterThanOrEqual(0);
        expect(m.resultaat!.bottom).toBeLessThanOrEqual(m.balk!.top + 0.5);
        expect(m.balk!.bottom).toBeLessThanOrEqual(m.hoogte + 1);
        // Met SCHERMAFDRUK=<map> legt de test vast wat hij meet, als bewijs bij de pull request.
        if (process.env["SCHERMAFDRUK"]) await page.screenshot({ path: path.join(process.env["SCHERMAFDRUK"], `werkruimte-${scherm.width}x${scherm.height}.jpg`), quality: 70 });
        for (const tab of ["overzicht", "bewijs", "opdracht", "historie"]) {
          await page.click(`button[data-tab="${tab}"]`);
          await page.waitForSelector(`button[data-tab="${tab}"][aria-selected="true"]`);
          for (const y of [0, 100_000]) {
            await page.evaluate((s: number) => window.scrollTo(0, s), y);
            const t = await meet();
            expect({ tab, y, horizontaal: t.horizontaal, uitsteken: t.uitsteken, knoppenOverlap: t.knoppenOverlap })
              .toEqual({ tab, y, horizontaal: false, uitsteken: [], knoppenOverlap: false });
            // Het reactieveld blijft onderaan in beeld, wat er ook gescrold is.
            expect(t.balk!.top).toBeGreaterThan(0);
            expect(t.balk!.bottom).toBeLessThanOrEqual(t.hoogte + 1);
          }
        }
        expect(fouten).toEqual([]);
      } finally { await browser.close(); }
    }, 60_000);
  }
});
