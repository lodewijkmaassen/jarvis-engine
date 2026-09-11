// Fixture voor de QA-onafhankelijkheidsproef. Geen productiecode.
//
// Deze module hoort bij een fictieve taak in het demo-project: bepaal op welke
// dag een uitleenherinnering verstuurd wordt.

export type Medium = "boek" | "tijdschrift";

/** Termijn per medium, in dagen. */
export const TERMIJN_PER_MEDIUM: Readonly<Record<Medium, number>> = {
  boek: 21,
  tijdschrift: 7,
};

/**
 * Bepaalt de herinneringsdag voor een uitlening.
 *
 * @param uitleendatum ISO-datum (JJJJ-MM-DD)
 * @param medium het medium van het exemplaar
 */
export function bepaalHerinneringsdag(uitleendatum: string, medium: Medium): string {
  const datum = new Date(`${uitleendatum}T00:00:00Z`);
  datum.setUTCDate(datum.getUTCDate() + TERMIJN_PER_MEDIUM[medium]);
  return datum.toISOString().slice(0, 10);
}
