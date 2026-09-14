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

/**
 * Proxy uit de omgeving. Een cloud-sessie van het platform laat al het
 * uitgaande verkeer via een HTTP-proxy lopen (HTTPS_PROXY); een verzoek dat
 * die proxy overslaat, wordt geweigerd (gezien op 2026-09-14: `jarvis db wie`
 * kreeg HTTP 403 terwijl curl doorkwam). curl volgt de variabele vanzelf,
 * Node's fetch niet. Node 24.5+ doet het met NODE_USE_ENV_PROXY (gezet in
 * bin/jarvis.mjs); voor oudere versies zet dit de dispatcher van undici.
 */
async function volgOmgevingsProxy(): Promise<void> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (!proxy) return;
  try {
    const undici = (await import("undici")) as { EnvHttpProxyAgent?: new () => unknown; setGlobalDispatcher?: (d: unknown) => void };
    if (undici.EnvHttpProxyAgent && undici.setGlobalDispatcher) undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
  } catch {
    // Geen undici beschikbaar: dan rekenen we op NODE_USE_ENV_PROXY.
  }
}

// Geen `process.exit` meer, maar `process.exitCode`: op Node 24 onder Windows
// breekt een harde exit vlak na een `fetch` af op een libuv-assertie
// (UV_HANDLE_CLOSING) en verdwijnt de exitcode. Elke opdracht sluit zijn
// eigen verbindingen, dus de lus loopt vanzelf leeg.
async function hoofd(): Promise<void> {
  await volgOmgevingsProxy();
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
