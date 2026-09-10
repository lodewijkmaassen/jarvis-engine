// Het lezen van de opdrachtregel.
//
// Bewust een eigen module, zonder enige neveneffect. `cli.ts` eindigt op
// `void hoofd()`, dus wie daaruit importeert start de CLI: een test die de
// argumentparser wilde aanroepen kreeg het helpscherm en werd door
// `process.exit` afgekapt vóór zijn eerste assertie. De duplicaatweigering
// hieronder had daardoor geen enkele test, terwijl hij wél een beveiligingsgrens
// is. Hier valt niets te starten, dus valt er wel te toetsen.

export type Argumenten = {
  readonly opdracht: string;
  readonly vlaggen: ReadonlyMap<string, string>;
  readonly losse: readonly string[];
  /** Vlaggen die meer dan een keer zijn meegegeven, in volgorde van voorkomen. */
  readonly dubbel: readonly string[];
};

/**
 * Leest de argumenten. Een vlag die twee keer voorkomt is een FOUT.
 *
 * Niet de eerste laten winnen en niet de laatste: allebei geeft een verschil
 * tussen wat een lezer denkt dat er staat en wat er gebeurt. De workflow schreef
 * `--ack-relatie "$REVIEW_RELATIE"`, en wie daar een tweede `--ack-relatie
 * OWNER` achter zette kreeg een controle die het eerste voorkomen las en een CLI
 * die het tweede gebruikte. Elke review werd daarmee een OWNER-review.
 *
 * Dat geldt voor alle vlaggen, niet alleen voor de gevoelige. Een lijst
 * bijhouden van welke vlaggen "gevoelig" zijn is een lijst die iemand vergeet
 * bij te werken, en er is geen enkele vlag waarvoor twee keer meegeven zinnig
 * is.
 *
 * Deze functie oordeelt niet en stopt niets: ze meldt wat ze zag. Wat er met een
 * duplicaat gebeurt, beslist de aanroeper.
 */
export function leesArgumenten(argv: readonly string[]): Argumenten {
  const [opdracht = "help", ...rest] = argv;
  const vlaggen = new Map<string, string>();
  const losse: string[] = [];
  const dubbel: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      losse.push(arg);
      continue;
    }
    const naam = arg.slice(2);
    const volgende = rest[i + 1];
    const heeftWaarde = volgende !== undefined && !volgende.startsWith("--");
    if (heeftWaarde) i += 1;
    if (vlaggen.has(naam) && !dubbel.includes(naam)) dubbel.push(naam);
    vlaggen.set(naam, heeftWaarde ? volgende : "true");
  }

  return { opdracht, vlaggen, losse, dubbel };
}
