/**
 * De echte functies uit `jarvis/interface/jarvis.html`, uitgevoerd.
 *
 * Waarom dit bestand bestaat: de pagina is één `<script>` dat bij het laden
 * meteen de DOM aanspreekt en `start()` aanroept, dus zij valt niet als geheel
 * te importeren. Tests lazen daarom haar brontekst, en QA heeft twee keer
 * aangetoond dat dat te weinig is — een gedragstest op een losse pure functie
 * zegt niets over de bedrading, en juist in de bedrading zat het defect dat de
 * eigenaar meldde. Hier worden de declaraties letterlijk uit de pagina geknipt
 * met haakjestelling en in één scope uitgevoerd, zodat ze elkaar aanroepen
 * zoals in de browser.
 *
 * `staat` wordt niet uit de pagina geknipt maar door de test gegeven: dat is
 * precies de plaats waar een test de wereld binnenbrengt (overzicht, regie,
 * autorisaties, antwoorden).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const PAGINA = readFileSync(path.join(process.cwd(), "jarvis/interface/jarvis.html"), "utf8");

/**
 * De volledige declaratie van één functie of constante op het hoogste niveau.
 *
 * Een functie wordt met haakjestelling afgebakend. De teller kent geen strings
 * of commentaar, dus een losse `{` of `}` daarbinnen zou de grens verleggen —
 * maar dat faalt luid en niet stil: een verkeerd afgebakende functie is bijna
 * altijd ongeldige JavaScript, en `new Function` ontleedt de hele tekst vooraf.
 * In de huidige pagina gaan alle 71 declaraties goed; QA heeft dat nagemeten.
 *
 * Een constante loopt tot het einde van haar regel. Dat is hier juist, want ze
 * zijn alle eenregelig, maar het is wél het ene geval dat stil kan afkappen:
 * een meerregelige `const` waarvan de eerste regel op zichzelf geldig is,
 * levert de verkeerde waarde zonder te klagen. Wie er een toevoegt, moet dit
 * weten.
 */
export function paginaStuk(naam: string, html: string = PAGINA): string {
  const functie = new RegExp(`\\nfunction ${naam}\\s*\\(`).exec(html);
  if (functie !== null) {
    const haakje = html.indexOf("{", functie.index + functie[0].length);
    let diepte = 0;
    for (let i = haakje; i < html.length; i += 1) {
      const c = html[i];
      if (c === "{") diepte += 1;
      else if (c === "}") {
        diepte -= 1;
        if (diepte === 0) return html.slice(functie.index + 1, i + 1);
      }
    }
    throw new Error(`de functie ${naam} is niet afgesloten in jarvis.html`);
  }
  const constante = new RegExp(`\\nconst ${naam}\\s*=`).exec(html);
  if (constante === null) throw new Error(`${naam} is niet gevonden in jarvis.html`);
  const eind = html.indexOf("\n", constante.index + 1);
  const regel = html.slice(constante.index + 1, eind);
  // Het ene geval dat anders stil fout gaat: een meerregelige constante. Een
  // afgekapte declaratie zonder puntkomma is het signaal.
  if (!regel.trimEnd().endsWith(";")) {
    throw new Error(`de constante ${naam} loopt over meer dan één regel; paginaStuk knipt haar verkeerd af`);
  }
  return regel;
}

/**
 * Voert de genoemde declaraties samen uit en geeft ze terug. `staat` is het
 * enige dat van buiten komt; alles daarbinnen is de pagina zelf.
 */
export function uitPagina(namen: readonly string[], staat: unknown, html: string = PAGINA): Record<string, Function> {
  const bron = namen.map((n) => paginaStuk(n, html)).join("\n");
  const teruggave = `return { ${namen.join(", ")} };`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function("staat", `${bron}\n${teruggave}`)(staat) as Record<string, Function>;
}
