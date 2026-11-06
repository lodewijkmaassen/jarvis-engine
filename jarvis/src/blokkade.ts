// Vier soorten stilstand, en waarom het verschil telt.
//
// WAAROM DIT BESTAAT
//
// Als de uitvoerder niet verder kon, kwam dat op één hoop terecht: "vast, de
// eigenaar moet iets beslissen". Daardoor kreeg de eigenaar beslissingen
// voorgelegd die hij al had genomen, en bleef echt werk liggen dat niemand
// hoefde te beslissen. Gemeten op 2026-11-06 aan D-20261021-161119608: het
// doel vroeg drie keer een "besluit" dat er twee keer al was; wat er werkelijk
// ontbrak was een technische bevoegdheid (een rol, een deur in de database) en
// die hoort Jarvis zelf in te richten.
//
// Het onderscheid:
//
//   besluit      Alleen de eigenaar kan dit willen: een inhoudelijke keuze,
//                scope, kosten, een afweging tussen opties. Jarvis vraagt het,
//                in gewone taal, en doet ondertussen al het andere.
//   bevoegdheid  Een recht, rol, credential of deur die er niet is. Dat is
//                werk voor Jarvis (CON-0015), geen nieuw besluit. Kan Jarvis
//                het aantoonbaar niet zelf verstrekken, dan is het één
//                concrete handeling van de eigenaar — met de exacte plek en
//                waarom het niet zelf kan, en nooit als "mag ik dit?".
//   fout         Iets werkt niet. Onderzoeken, herstellen, opnieuw proberen;
//                de eigenaar hoort hier niets van tenzij het blijft hangen.
//   beveiliging  De grens zelf houdt dit tegen (destructief, onomkeerbaar,
//                een secret lezen, een controle omzeilen). Dan niet doorgaan
//                en niet omheen bouwen: melden met de grens die het tegenhoudt.
//
// Alleen `besluit` mag bij de eigenaar als beslissing landen. De andere drie
// zijn werk, en een doel dat erop wacht blokkeert nooit een ander doel.

export const BLOKKADE_SOORTEN = ["besluit", "bevoegdheid", "fout", "beveiliging"] as const;
export type BlokkadeSoort = (typeof BLOKKADE_SOORTEN)[number];

export type Blokkade = {
  readonly soort: BlokkadeSoort;
  /** Wat de keten hiermee doet. */
  readonly vervolg: string;
  /** Komt dit bij de eigenaar als beslissing? Alleen bij een echt besluit. */
  readonly naarEigenaar: boolean;
};

const BEVEILIGING =
  /\b(destructie\w*|onomkeerbaar\w*|omzeil\w*|uitschakel\w*|force[- ]push|secret\s+(lezen|tonen)|productiegegevens\s+(verwijder\w*|wissen)|drop\s+(table|schema|database)|truncate)\b/i;
const BEVOEGDHEID =
  /\b(geen schrijfrecht|schrijfrecht\s+(ontbreekt|nodig)|403|401|forbidden|unauthorized|geen rechten|rechten\s+(ontbreken|nodig)|rol\b|credential\w*|token\s+(ontbreekt|nodig)|secret\s+(ontbreekt|nodig)|bevoegdhe\w+|mag\s+(ik\s+)?niet|niet\s+mag|niet toegestaan door de routine|beschermd\w*\s+pad\w*|statement niet toegestaan|permission denied|niet uitvoerbaar door)\b/i;
const BESLUIT = /\b(keuze|kiezen|kies|beslissing|beslis\w*|afweging|scope\w*|kosten|betaalde dienst|abonnement|prioriteit|welke van de|voorkeur)\b/i;

/**
 * De soort stilstand uit de tekst waarmee een uitvoerder of een controle
 * stopte. De volgorde is de voorrang: een beveiligingsgrens overstemt een
 * bevoegdheid, en een bevoegdheid overstemt een besluit — precies om te
 * voorkomen dat "ik mag dit niet" als "beslis dit voor mij" bij de eigenaar
 * belandt.
 */
export function classificeerBlokkade(tekst: string): Blokkade {
  const t = (tekst ?? "").replace(/\s+/g, " ");
  if (BEVEILIGING.test(t)) {
    return {
      soort: "beveiliging",
      vervolg: "niet uitvoeren en niet omheen bouwen: de grens die dit tegenhoudt wordt gemeld, met wat er wel kan.",
      naarEigenaar: false,
    };
  }
  if (BEVOEGDHEID.test(t)) {
    return {
      soort: "bevoegdheid",
      vervolg: "Jarvis richt de ontbrekende bevoegdheid zelf in; kan dat aantoonbaar niet, dan volgt één concrete handeling van de eigenaar met plek en reden.",
      naarEigenaar: false,
    };
  }
  if (BESLUIT.test(t)) {
    return { soort: "besluit", vervolg: "de vraag gaat in gewone taal naar de eigenaar; al het werk dat er niet van afhangt gaat door.", naarEigenaar: true };
  }
  return { soort: "fout", vervolg: "onderzoeken, herstellen en opnieuw proberen in de bestaande herstelketen.", naarEigenaar: false };
}

/** Eén regel voor het ledger en de uitkomst van een doel: wat het is, en wat er nu gebeurt. */
export function rendereerBlokkade(tekst: string, blokkade: Blokkade = classificeerBlokkade(tekst)): string {
  return `[${blokkade.soort}] ${tekst.trim()} → ${blokkade.vervolg}`;
}

/**
 * Mag dit een beslissing van de eigenaar worden? Alleen een echt besluit. Een
 * bevoegdheid die werkelijk alleen de eigenaar kan verstrekken, komt als
 * handeling (met instructie), niet als vraag om goedkeuring — hij heeft het
 * "wat" al bepaald toen hij het doel gaf.
 */
export function mag_naar_eigenaar(tekst: string): boolean {
  return classificeerBlokkade(tekst).naarEigenaar;
}
