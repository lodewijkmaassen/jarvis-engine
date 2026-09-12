# Jarvis als eigen app

Dezelfde pagina als `../jarvis.html`, maar op een eigen adres met de eigen
database van Jarvis als bron (DEC-0042). Bouwen = kopiëren:

```
cp ../jarvis.html index.html
```

en daarnaast een `config.js` met de publieke sleutel van het Supabase-project
(de publishable key is bedoeld voor de browser; RLS bewaakt de toegang):

```js
window.JARVIS_SUPABASE = { url: "https://<ref>.supabase.co", key: "sb_publishable_…" };
```

`config.js` staat niet in de repository. Uitrollen als statische site op Vercel
(`npx vercel --prod` vanuit deze map). Zonder `config.js` valt de pagina terug op
de artifact-database van claude.ai.
