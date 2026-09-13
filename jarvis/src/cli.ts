// Het entrypoint van de Jarvis-CLI.
//
// Dit bestand is met opzet drie regels logica. Alles wat iets doet staat in
// opdrachten.ts, dat bij het importeren niets uitvoert; hier staat alleen de
// vertaling van een exitcode naar `process.exitCode`.
//
// De scheiding bestaat omdat ze eerst ontbrak. Toen het entrypoint onderin de
// opdrachtenmodule stond, startte elke import de CLI en werd elke test afgekapt
// voordat hij iets kon nakijken. De duplicaatweigering had daardoor geen enkele
// test, terwijl juist die een beveiligingsgrens is.
//
// Gebruik: npx tsx jarvis/src/cli.ts <opdracht> [opties]
import { AfbrekenFout, voerUit } from "./opdrachten";

// Geen `process.exit` meer, maar `process.exitCode`: op Node 24 onder Windows
// breekt een harde exit vlak na een `fetch` af op een libuv-assertie
// (UV_HANDLE_CLOSING) en verdwijnt de exitcode. Elke opdracht sluit zijn
// eigen verbindingen, dus de lus loopt vanzelf leeg.
async function hoofd(): Promise<void> {
  try {
    process.exitCode = await voerUit(process.argv.slice(2));
  } catch (fout) {
    if (fout instanceof AfbrekenFout) {
      console.error(fout.message);
      process.exitCode = fout.code;
      return;
    }
    throw fout;
  }
}

void hoofd();
