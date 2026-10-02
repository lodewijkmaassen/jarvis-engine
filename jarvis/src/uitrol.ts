// Nameten of de uitgerolde pagina werkelijk de pagina is die is gebouwd.
//
// Aanleiding, gemeten op 2026-10-02: een uitrol van de interface verving de
// bestanden niet. Alle verificatie stopte bij de repositorygrens — de bron was
// in orde, de bouw was in orde, de uitrolopdracht eindigde met 0 — en het
// defect zat precies in het gat daartussen. "Klaar" was daarmee een aanname,
// en de eigenaar was de eerste die het zag.
//
// De controle hier sluit dat gat op de enige plek waar het dicht kan: de
// uitgerolde pagina zelf ophalen en het bouwmerk eruit teruglezen dat
// `bouw.mjs` erin heeft gezet. Komt dat merk niet overeen met de commit die is
// uitgerold, dan is de uitrol mislukt, hoe groen de stappen ervoor ook waren.
//
// Twee ontwerpkeuzes die hierbij horen:
//
//   - De vergelijking gaat over de pagina op haar gewone adres, zonder
//     cache-brekende parameter. Een parameter zou een ander verzoek meten dan
//     de eigenaar doet, en juist een CDN die een oude pagina blijft serveren is
//     een van de manieren waarop een uitrol stilletjes mislukt.
//   - Een ontbrekend merk is een fout en geen onbekende. Een pagina zonder merk
//     is ofwel van vóór deze controle, ofwel niet vervangen; beide betekenen
//     dat deze uitrol niet is aangetoond.

/** Wat de controle van één pagina opleverde. */
export type Bouwmerkoordeel = {
  readonly goed: boolean;
  /** Eén regel, bedoeld om zo in een log of een CI-stap te staan. */
  readonly melding: string;
  /** Het merk dat in de pagina stond, of null als er geen stond. */
  readonly gevonden: string | null;
};

const MERK = /^[0-9a-f]{7,40}$/;

/**
 * Het bouwmerk uit de HTML van een pagina.
 *
 * Met een eigen reguliere expressie en niet met een HTML-parser: de engine
 * heeft geen DOM en mag er geen afhankelijkheid bij krijgen voor één meta-tag.
 * De expressie accepteert de attributen in beide volgordes en zowel enkele als
 * dubbele aanhalingstekens, want dat is wat een minifier of een CDN ervan kan
 * maken.
 */
export function leesBouwmerk(html: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const naam = tag.match(/\bname\s*=\s*["']?jarvis-bouwmerk["']?/i);
    if (!naam) continue;
    const inhoud = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
    const waarde = inhoud?.[1] ?? inhoud?.[2] ?? inhoud?.[3];
    if (waarde !== undefined) return waarde.trim();
  }
  return null;
}

/**
 * Het oordeel over één opgehaalde pagina.
 *
 * Gescheiden van het ophalen, zodat het oordeel zelf toetsbaar is zonder
 * netwerk — en zodat de regel die het oordeel velt niet in dezelfde functie
 * staat als de regel die kan falen op een proxy.
 */
export function beoordeelBouwmerk(html: string, verwacht: string, adres: string): Bouwmerkoordeel {
  const gevonden = leesBouwmerk(html);
  if (gevonden === null) {
    return {
      goed: false,
      gevonden: null,
      melding:
        `uitrol: ${adres} draagt geen bouwmerk. Verwacht ${verwacht}. ` +
        `Of de pagina is niet vervangen, of zij is gebouwd zonder --merk; in beide gevallen is deze uitrol niet aangetoond.`,
    };
  }
  // Op het kortste van de twee vergelijken: CI geeft een volledige sha mee en
  // een eerdere bouw kan een afgekorte hebben gezet. Een voorvoegselmatch is
  // hier veilig, want beide komen uit dezelfde repository.
  const n = Math.min(gevonden.length, verwacht.length);
  if (n >= 7 && gevonden.slice(0, n) === verwacht.slice(0, n)) {
    return { goed: true, gevonden, melding: `uitrol: ${adres} draagt bouwmerk ${gevonden} — dat is de uitgerolde commit.` };
  }
  return {
    goed: false,
    gevonden,
    melding: `uitrol: ${adres} draagt bouwmerk ${gevonden}, verwacht ${verwacht}. De uitrol heeft de pagina niet vervangen.`,
  };
}

/** Haalt de pagina op. Apart, zodat een test hem kan vervangen. */
export type Ophaler = (adres: string) => Promise<{ status: number; tekst: string }>;

const standaardOphaler: Ophaler = async (adres) => {
  const antwoord = await fetch(adres, {
    redirect: "follow",
    headers: { "cache-control": "no-cache", pragma: "no-cache", accept: "text/html" },
  });
  return { status: antwoord.status, tekst: await antwoord.text() };
};

/**
 * Haalt de pagina op en velt het oordeel. Exitcode 0 bij gelijk, 1 bij elk
 * ander geval — ook bij een netwerkfout, want een controle die niet kon meten
 * heeft niets aangetoond en mag geen groen opleveren.
 */
export async function controleerUitrol(
  adres: string,
  verwacht: string,
  ophaler: Ophaler = standaardOphaler,
): Promise<{ code: number; melding: string }> {
  if (!MERK.test(verwacht)) {
    return { code: 2, melding: `uitrol: --merk verwacht een commit-sha (7 tot 40 hexadecimale tekens), kreeg ${JSON.stringify(verwacht)}.` };
  }
  let antwoord: { status: number; tekst: string };
  try {
    antwoord = await ophaler(adres);
  } catch (fout) {
    const reden = fout instanceof Error ? fout.message : String(fout);
    return { code: 1, melding: `uitrol: ${adres} is niet op te halen (${reden}). Niet gemeten is niet geslaagd.` };
  }
  if (antwoord.status !== 200) {
    return { code: 1, melding: `uitrol: ${adres} antwoordde met HTTP ${antwoord.status}. Niet gemeten is niet geslaagd.` };
  }
  const oordeel = beoordeelBouwmerk(antwoord.tekst, verwacht, adres);
  return { code: oordeel.goed ? 0 : 1, melding: oordeel.melding };
}
