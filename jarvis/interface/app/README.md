# Jarvis als eigen app

Dezelfde pagina als `../jarvis.html`, op een eigen adres met de eigen database
van Jarvis als bron (DEC-0042, DEC-0044) en installeerbaar als PWA op de
telefoon (manifest, service worker, iconen). Bouwen:

```
node bouw.mjs [doelmap]
```

Dat kopieert `../jarvis.html` als `index.html` naar de doelmap, met
`manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png` en
`vercel.json`. In de doelmap hoort daarnaast een `config.js` met de publieke
sleutel van het Supabase-project (de publishable key is bedoeld voor de
browser; RLS bewaakt de toegang):

```js
window.JARVIS_SUPABASE = { url: "https://<ref>.supabase.co", key: "sb_publishable_…" };
```

`config.js` en `index.html` staan niet in de repository. Uitrollen als
statische site op Vercel (`npx vercel --prod` vanuit de doelmap). Zonder
`config.js` valt de pagina terug op de artifact-database van claude.ai; met
`window.JARVIS_PROEF = {overzicht, status, berichten, antwoorden, autorisaties}`
vóór het script toont ze vaste gegevens (alleen lezen), om te kijken en te
testen zonder in te loggen.

Iconen opnieuw maken: zie `icoon.py` in de geschiedenis van dit dossier —
een donkere schijf met de cyaan ring en kern van de kaart, 192 en 512 px.
