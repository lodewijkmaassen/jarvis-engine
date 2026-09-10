// YAML-front-matter voor kennisrecords — bewust een strikte, kleine subset.
//
// Waarom geen YAML-bibliotheek: de Jarvis-kern moet zonder extra afhankelijk-
// heden in elk project kunnen draaien, en volledige YAML is een bron van
// verrassingen (Noorse-vlagprobleem, ankers, impliciete types). De vorm van
// front-matter staat volledig onder onze eigen controle, dus een strikte
// parser die HARD faalt op alles buiten de subset is hier veiliger dan een
// tolerante parser die stilzwijgend iets anders begrijpt dan er staat.
//
// Ondersteunde subset:
//   sleutel: scalar
//   sleutel: [a, b, "c d"]          inline lijst
//   sleutel:                        bloklijst
//     - a
//     - b
//   sleutel:                        één niveau nesting (bv. triggers)
//     subsleutel: scalar
//     subsleutel: [a, b]
//
// Alles wat daarbuiten valt (tabs, ankers, meerregelige scalars, diepere
// nesting) levert een gestructureerde fout op, nooit een gok.

export type FrontMatterScalar = string | number | boolean | null;
export type FrontMatterValue =
  | FrontMatterScalar
  | readonly FrontMatterScalar[]
  | { readonly [key: string]: FrontMatterScalar | readonly FrontMatterScalar[] };
export type FrontMatter = { readonly [key: string]: FrontMatterValue };

export type FrontMatterFout = {
  readonly regel: number;
  readonly boodschap: string;
};

export type ParseResultaat =
  | { readonly ok: true; readonly data: FrontMatter; readonly body: string }
  | { readonly ok: false; readonly fouten: readonly FrontMatterFout[] };

const SLEUTEL = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Splitst op regeleinden, ongeacht CRLF/LF. */
function splitRegels(tekst: string): string[] {
  return tekst.replace(/\r\n/g, "\n").split("\n");
}

/**
 * Interpreteert één scalar. Getallen en booleans worden alleen herkend als
 * ze ONGEQUOTE zijn; `"true"` blijft dus een string. Dat is precies het
 * verschil dat je bij id's en versienummers wilt bewaren.
 */
function leesScalar(ruw: string): FrontMatterScalar {
  const waarde = ruw.trim();
  if (waarde.length === 0) return "";
  const eerste = waarde[0];
  if ((eerste === '"' || eerste === "'") && waarde.length >= 2 && waarde.endsWith(eerste)) {
    const binnen = waarde.slice(1, -1);
    return eerste === '"' ? binnen.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : binnen;
  }
  if (waarde === "null" || waarde === "~") return null;
  if (waarde === "true") return true;
  if (waarde === "false") return false;
  if (/^-?\d+$/.test(waarde)) return Number.parseInt(waarde, 10);
  if (/^-?\d+\.\d+$/.test(waarde)) return Number.parseFloat(waarde);
  return waarde;
}

/** Verwijdert een commentaarstaart, maar niet binnen quotes. */
function stripCommentaar(ruw: string): string {
  let inQuote: string | null = null;
  for (let i = 0; i < ruw.length; i += 1) {
    const teken = ruw[i];
    if (inQuote) {
      if (teken === inQuote && ruw[i - 1] !== "\\") inQuote = null;
      continue;
    }
    if (teken === '"' || teken === "'") {
      inQuote = teken;
      continue;
    }
    if (teken === "#" && (i === 0 || /\s/.test(ruw[i - 1]))) {
      return ruw.slice(0, i);
    }
  }
  return ruw;
}

/** Splitst `[a, b, "c, d"]` op komma's buiten quotes. */
function leesInlineLijst(ruw: string): readonly FrontMatterScalar[] {
  const binnen = ruw.trim().slice(1, -1).trim();
  if (binnen.length === 0) return [];
  const delen: string[] = [];
  let huidig = "";
  let inQuote: string | null = null;
  for (let i = 0; i < binnen.length; i += 1) {
    const teken = binnen[i];
    if (inQuote) {
      huidig += teken;
      if (teken === inQuote && binnen[i - 1] !== "\\") inQuote = null;
      continue;
    }
    if (teken === '"' || teken === "'") {
      inQuote = teken;
      huidig += teken;
      continue;
    }
    if (teken === ",") {
      delen.push(huidig);
      huidig = "";
      continue;
    }
    huidig += teken;
  }
  delen.push(huidig);
  return delen.map((d) => leesScalar(d));
}

function isInlineLijst(ruw: string): boolean {
  const t = ruw.trim();
  return t.startsWith("[") && t.endsWith("]");
}

function inspringing(regel: string): number {
  const match = /^ */.exec(regel);
  return match ? match[0].length : 0;
}

/**
 * Parseert een markdownbestand met front-matter.
 *
 * Een bestand zonder `---`-blok aan het begin is geen fout maar levert lege
 * front-matter met de volledige tekst als body: zo kunnen gewone documenten
 * door dezelfde loader zonder speciale gevallen.
 */
export function parseFrontMatter(tekst: string): ParseResultaat {
  const regels = splitRegels(tekst);
  if (regels[0]?.trim() !== "---") {
    return { ok: true, data: {}, body: tekst };
  }

  let eind = -1;
  for (let i = 1; i < regels.length; i += 1) {
    if (regels[i].trim() === "---") {
      eind = i;
      break;
    }
  }
  if (eind === -1) {
    return { ok: false, fouten: [{ regel: 1, boodschap: "front-matter is niet afgesloten met ---" }] };
  }

  const fouten: FrontMatterFout[] = [];
  const data: Record<string, FrontMatterValue> = {};
  let i = 1;

  while (i < eind) {
    const ruweRegel = regels[i];
    const regelNr = i + 1;
    if (ruweRegel.includes("\t")) {
      fouten.push({ regel: regelNr, boodschap: "tabs zijn niet toegestaan in front-matter" });
      i += 1;
      continue;
    }
    const regel = stripCommentaar(ruweRegel);
    if (regel.trim().length === 0) {
      i += 1;
      continue;
    }
    if (inspringing(regel) !== 0) {
      fouten.push({ regel: regelNr, boodschap: "onverwachte inspringing op topniveau" });
      i += 1;
      continue;
    }

    const scheiding = regel.indexOf(":");
    if (scheiding === -1) {
      fouten.push({ regel: regelNr, boodschap: `verwacht "sleutel: waarde", kreeg "${regel.trim()}"` });
      i += 1;
      continue;
    }
    const sleutel = regel.slice(0, scheiding).trim();
    if (!SLEUTEL.test(sleutel)) {
      fouten.push({ regel: regelNr, boodschap: `ongeldige sleutel "${sleutel}"` });
      i += 1;
      continue;
    }
    if (sleutel in data) {
      fouten.push({ regel: regelNr, boodschap: `sleutel "${sleutel}" komt meer dan één keer voor` });
    }
    const rest = regel.slice(scheiding + 1).trim();

    if (rest.length > 0) {
      data[sleutel] = isInlineLijst(rest) ? leesInlineLijst(rest) : leesScalar(rest);
      i += 1;
      continue;
    }

    // Lege waarde: bloklijst of genest blok op de volgende regels.
    const blok: string[] = [];
    let j = i + 1;
    while (j < eind) {
      const kandidaat = stripCommentaar(regels[j]);
      if (kandidaat.trim().length === 0) {
        j += 1;
        continue;
      }
      if (inspringing(kandidaat) === 0) break;
      blok.push(kandidaat);
      j += 1;
    }

    if (blok.length === 0) {
      data[sleutel] = null;
      i = j;
      continue;
    }

    const isLijst = blok.every((r) => r.trim().startsWith("- "));
    if (isLijst) {
      data[sleutel] = blok.map((r) => leesScalar(r.trim().slice(2)));
      i = j;
      continue;
    }

    const genest: Record<string, FrontMatterScalar | readonly FrontMatterScalar[]> = {};
    for (let k = 0; k < blok.length; k += 1) {
      const sub = blok[k];
      const subRegelNr = i + 2 + k;
      const subScheiding = sub.indexOf(":");
      if (subScheiding === -1) {
        fouten.push({ regel: subRegelNr, boodschap: `verwacht "sleutel: waarde" binnen ${sleutel}` });
        continue;
      }
      const subSleutel = sub.slice(0, subScheiding).trim();
      if (!SLEUTEL.test(subSleutel)) {
        fouten.push({ regel: subRegelNr, boodschap: `ongeldige sleutel "${subSleutel}" binnen ${sleutel}` });
        continue;
      }
      const subRest = sub.slice(subScheiding + 1).trim();
      if (subRest.length === 0) {
        // Bloklijst binnen een genest blok.
        const subBlok: string[] = [];
        let m = k + 1;
        while (m < blok.length && blok[m].trim().startsWith("- ")) {
          subBlok.push(blok[m].trim().slice(2));
          m += 1;
        }
        if (subBlok.length === 0) {
          fouten.push({ regel: subRegelNr, boodschap: `lege waarde voor ${sleutel}.${subSleutel}` });
        } else {
          genest[subSleutel] = subBlok.map((s) => leesScalar(s));
        }
        k = m - 1;
        continue;
      }
      genest[subSleutel] = isInlineLijst(subRest) ? leesInlineLijst(subRest) : leesScalar(subRest);
    }
    data[sleutel] = genest;
    i = j;
  }

  if (fouten.length > 0) return { ok: false, fouten };
  return { ok: true, data, body: regels.slice(eind + 1).join("\n").replace(/^\n+/, "") };
}

/** Quote alleen wanneer nodig, zodat handgeschreven records leesbaar blijven. */
function schrijfScalar(waarde: FrontMatterScalar): string {
  if (waarde === null) return "null";
  if (typeof waarde === "boolean") return waarde ? "true" : "false";
  if (typeof waarde === "number") return String(waarde);
  const moetQuoten =
    waarde.length === 0 ||
    /^[\s]|[\s]$/.test(waarde) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(waarde) ||
    waarde.includes(": ") ||
    waarde.includes(" #") ||
    waarde === "null" ||
    waarde === "true" ||
    waarde === "false" ||
    /^-?\d+(\.\d+)?$/.test(waarde);
  return moetQuoten ? `"${waarde.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : waarde;
}

/**
 * Serialiseert front-matter terug naar tekst. Sleutels in de meegegeven
 * volgorde (niet gesorteerd): een record hoort er voor een mens hetzelfde
 * uit te zien als toen het geschreven werd.
 */
export function schrijfFrontMatter(data: FrontMatter): string {
  const regels: string[] = ["---"];
  for (const [sleutel, waarde] of Object.entries(data)) {
    if (waarde === undefined) continue;
    if (Array.isArray(waarde)) {
      const lijst = waarde as readonly FrontMatterScalar[];
      if (lijst.length === 0) {
        regels.push(`${sleutel}: []`);
      } else {
        regels.push(`${sleutel}:`);
        for (const item of lijst) regels.push(`  - ${schrijfScalar(item)}`);
      }
      continue;
    }
    if (waarde !== null && typeof waarde === "object") {
      regels.push(`${sleutel}:`);
      for (const [sub, subWaarde] of Object.entries(waarde)) {
        if (Array.isArray(subWaarde)) {
          const lijst = subWaarde as readonly FrontMatterScalar[];
          if (lijst.length === 0) {
            regels.push(`  ${sub}: []`);
          } else {
            regels.push(`  ${sub}:`);
            for (const item of lijst) regels.push(`    - ${schrijfScalar(item)}`);
          }
          continue;
        }
        regels.push(`  ${sub}: ${schrijfScalar(subWaarde as FrontMatterScalar)}`);
      }
      continue;
    }
    regels.push(`${sleutel}: ${schrijfScalar(waarde as FrontMatterScalar)}`);
  }
  regels.push("---");
  return regels.join("\n");
}

/** Volledig markdownbestand: front-matter + body. */
export function schrijfDocument(data: FrontMatter, body: string): string {
  const schoon = body.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\s+$/, "");
  return `${schrijfFrontMatter(data)}\n\n${schoon}\n`;
}
