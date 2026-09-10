// De canonieke governance-workflow.
//
// De actieve workflow moet BYTE VOOR BYTE gelijk zijn aan een canoniek bestand
// in de repository. Meer is het niet, en dat is het punt.
//
// Hiervoor stond hier een controle die het workflowbestand las en beoordeelde:
// een eigen YAML-lezer, een lijst verboden shellvormen, regexen op de vlaggen.
// Zes QA-rondes lang vond een onafhankelijke beoordelaar er telkens een gat in,
// en elke keer een laag naar buiten. De laatste twee waren de duidelijkste:
//
//   - Mijn lezer knipte commentaar af op JavaScript's `\s`, dat U+00A0 en vijf
//     andere tekens omvat; YAML kent alleen spatie en tab. Een regel met een
//     harde spatie voor het hekje voldeed daardoor letterlijk aan de
//     gelijkheidstoets en draaide in bash iets anders.
//   - De controle keek naar de stap die Jarvis aanroept. Elke ANDERE stap was
//     vrij, dus een stap ervoor kon met één `sed` de engine aanpassen waarna de
//     poort netjes groen werd.
//
// Beide hadden dezelfde oorzaak: om te oordelen of het bestand veilig is,
// interpreteerde ik het. Daarmee is mijn interpretatie het aanvalsoppervlak, en
// een interpretatie van een taal is nooit af.
//
// Bytes vergelijken interpreteert niets. Er is geen witruimtesemantiek, geen
// stapfilter, geen lijst verboden constructies. Elke wijziging - een spatie, een
// comment, een extra stap, een tweede job - is een verschil, en dus een fout.
//
// De canonieke workflow zelf valt onder de gewone menselijke review: hij staat
// in de repository en CODEOWNERS dekt hem af. Deze controle bewijst alleen dat
// wat er draait gelijk is aan wat er is goedgekeurd.

export type WorkflowVergelijking =
  | { readonly gelijk: true }
  | { readonly gelijk: false; readonly reden: string };

/** Regelnummer en kolom van een byte-offset, om een verschil aanwijsbaar te maken. */
function plaatsVan(bytes: Uint8Array, offset: number): string {
  let regel = 1;
  let kolom = 1;
  for (let i = 0; i < offset && i < bytes.length; i += 1) {
    if (bytes[i] === 0x0a) {
      regel += 1;
      kolom = 1;
    } else {
      kolom += 1;
    }
  }
  return `regel ${regel}, teken ${kolom}`;
}

function alsHex(byte: number | undefined): string {
  return byte === undefined ? "einde van het bestand" : `0x${byte.toString(16).padStart(2, "0")}`;
}

/**
 * Zijn de twee bestanden byte voor byte gelijk?
 *
 * Geen enkele normalisatie: geen trim, geen regeleindes gelijktrekken, geen
 * unicode-normalisatie. Elke vorm van "eigenlijk hetzelfde" is een oordeel, en
 * juist die oordelen bleken het gat.
 */
export function vergelijkWorkflow(actief: Uint8Array | null, canoniek: Uint8Array | null): WorkflowVergelijking {
  if (canoniek === null) return { gelijk: false, reden: "het canonieke workflowbestand ontbreekt" };
  if (actief === null) return { gelijk: false, reden: "het actieve workflowbestand ontbreekt" };

  const kortste = Math.min(actief.length, canoniek.length);
  for (let i = 0; i < kortste; i += 1) {
    if (actief[i] !== canoniek[i]) {
      return {
        gelijk: false,
        reden:
          `wijkt af op ${plaatsVan(canoniek, i)}: het actieve bestand heeft ${alsHex(actief[i])}, ` +
          `het canonieke ${alsHex(canoniek[i])}`,
      };
    }
  }
  if (actief.length !== canoniek.length) {
    const langer = actief.length > canoniek.length ? "actieve" : "canonieke";
    return {
      gelijk: false,
      reden:
        `is even lang tot ${plaatsVan(canoniek, kortste)}, maar het ${langer} bestand gaat daarna verder ` +
        `(${actief.length} tegen ${canoniek.length} bytes)`,
    };
  }
  return { gelijk: true };
}
