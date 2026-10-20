// Kern van de Jarvis AI Core-chat: één bericht in, één antwoord of één nieuw doel uit.
//
// De chat is alleen een voordeur. Een uitvoerbare opdracht wordt via de bestaande
// databasefunctie `doel_nieuw` een gewoon doel (met de rechten van de ingelogde
// eigenaar); de bestaande keten doet de rest. Deze code merget of rolt niets uit.
//
// Het taalmodel zit achter één functie, `vraagModel`, zodat de aanbieder te
// vervangen is zonder de rest aan te raken. De sleutel komt uitsluitend uit de
// serveromgeving (ANTHROPIC_API_KEY) en gaat nooit naar de browser. Het harde
// kostenplafond is de maandlimiet van het Anthropic-account; hier begrenzen
// we alleen de grootte van elke aanroep.

export const MODEL = "claude-haiku-5-5";
const MAX_BERICHTEN = 20;
const MAX_TEKENS = 4000;
const MAX_UIT = 700;

const SYSTEEM = `Je bent Jarvis, de assistent van de eigenaar in het Command Center. Antwoord in het Nederlands, kort en feitelijk.
Is het bericht een vraag of gesprek: antwoord gewoon, zonder gereedschap.
Is het een concrete opdracht om iets te bouwen of te wijzigen: roep het gereedschap maak_doel aan met een korte titel en een volledige opdracht in gewone taal, en kies het project als het duidelijk is.
Projecten: tovas-flow (ToVas Flow: gemiste oproepen, offertes, reviews, inlogpagina), kasboek (Kasboek). Subprojecten van tovas-flow: gemiste-oproepen, offerte-opvolging, reviews-verzamelen.
Verzin geen resultaten en beloof niets over de uitkomst; de keten bouwt, beoordeelt en rolt uit.`;

const GEREEDSCHAP = [{
  name: "maak_doel",
  description: "Maak een doel aan voor een concrete ontwikkelopdracht. Alleen voor opdrachten, nooit voor vragen.",
  input_schema: {
    type: "object",
    properties: {
      titel: { type: "string", description: "Korte titel, hoogstens 80 tekens" },
      opdracht: { type: "string", description: "Wat bereikt moet worden, in gewone taal" },
      project: { type: "string", description: "Optioneel: tovas-flow, kasboek of tovas-flow/<subproject>", pattern: "^[a-z0-9-]+(/[a-z0-9-]+)?$" },
    },
    required: ["titel", "opdracht"],
  },
}];

/** De enige plek die de aanbieder kent. Geeft { tekst, doel } terug; doel is null of { titel, opdracht, project }. */
export async function vraagModel(berichten, { sleutel, fetchFn }) {
  const r = await fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": sleutel, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_UIT, system: SYSTEEM, tools: GEREEDSCHAP, messages: berichten }),
  });
  if (!r.ok) throw new Error(`taalmodel gaf ${r.status}`);
  const uit = await r.json();
  const blokken = Array.isArray(uit.content) ? uit.content : [];
  const tekst = blokken.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  const gebruik = blokken.find((b) => b.type === "tool_use" && b.name === "maak_doel");
  return { tekst, doel: gebruik ? gebruik.input : null };
}

function schoon(gesprek) {
  if (!Array.isArray(gesprek) || gesprek.length === 0) return null;
  const rest = gesprek.slice(-MAX_BERICHTEN).map((b) => ({
    role: b?.rol === "jarvis" ? "assistant" : "user",
    content: String(b?.tekst ?? "").slice(0, MAX_TEKENS),
  })).filter((b) => b.content.trim());
  // Het gesprek moet met de eigenaar beginnen en eindigen.
  while (rest.length && rest[0].role !== "user") rest.shift();
  return rest.length && rest[rest.length - 1].role === "user" ? rest : null;
}

/** Controleert de sessie bij Supabase en geeft de gebruiker terug, of null. */
async function gebruiker(cfg, token, fetchFn) {
  const r = await fetchFn(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.key, authorization: `Bearer ${token}` } });
  return r.ok ? await r.json() : null;
}

async function maakDoel(cfg, token, doel, fetchFn) {
  const titel = String(doel.titel ?? "").trim().slice(0, 120);
  let opdracht = String(doel.opdracht ?? "").trim().slice(0, MAX_TEKENS);
  if (!titel || !opdracht) throw new Error("doel mist titel of opdracht");
  const project = typeof doel.project === "string" && /^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(doel.project) ? doel.project : null;
  if (project) opdracht = `Project: ${project}\n\n${opdracht}`;
  const r = await fetchFn(`${cfg.url}/rest/v1/rpc/doel_nieuw`, {
    method: "POST",
    headers: { apikey: cfg.key, authorization: `Bearer ${token}`, "content-type": "application/json", "content-profile": "jarvis" },
    body: JSON.stringify({ p_titel: titel, p_opdracht: opdracht, p_acceptatie_url: null }),
  });
  if (!r.ok) throw new Error(`doel aanmaken mislukt (${r.status})`);
  return { id: await r.json(), titel };
}

/** @returns {Promise<{status:number, lading:object}>} */
export async function verwerk({ token, body, cfg, sleutel, fetchFn = fetch }) {
  if (!sleutel) return { status: 503, lading: { fout: "De chat is nog niet ingericht (ANTHROPIC_API_KEY ontbreekt op de server)." } };
  if (!cfg?.url || !cfg?.key) return { status: 503, lading: { fout: "De chat is niet ingericht: Supabase-configuratie ontbreekt." } };
  if (!token) return { status: 401, lading: { fout: "Niet ingelogd." } };
  const berichten = schoon(body?.gesprek);
  if (!berichten) return { status: 400, lading: { fout: "Geen bericht." } };
  try {
    if (!(await gebruiker(cfg, token, fetchFn))) return { status: 401, lading: { fout: "Sessie ongeldig; log opnieuw in." } };
    const { tekst, doel } = await vraagModel(berichten, { sleutel, fetchFn });
    if (doel) {
      const nieuw = await maakDoel(cfg, token, doel, fetchFn);
      return { status: 200, lading: { antwoord: tekst || `Doel gestart: ${nieuw.titel}`, doel: nieuw } };
    }
    return { status: 200, lading: { antwoord: tekst || "Ik heb daar geen antwoord op." } };
  } catch (e) {
    // Geen details van de aanbieder of de sleutel naar de browser.
    return { status: 502, lading: { fout: e instanceof Error && /^doel/.test(e.message) ? e.message : "Jarvis kon nu niet antwoorden." } };
  }
}
