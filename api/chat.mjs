// Vercel Function op /api/chat. Vercel draait alleen bestanden in api/ in de projectwortel als functie;
// de uitvoermap public/ (van jarvis/interface/app/bouw.mjs) is statisch. De chat zelf staat in
// jarvis/interface/app/api/; dit bestand maakt hem alleen bereikbaar.
export { POST } from "../jarvis/interface/app/api/chat.mjs";
