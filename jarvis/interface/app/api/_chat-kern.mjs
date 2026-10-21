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
// Een opdracht van de eigenaar kan lang zijn; ze gaat letterlijk het doel in, dus niet halverwege afkappen.
const MAX_TEKENS = 12000;
const MAX_OPDRACHT = 20000;
// Ruimte voor het antwoord plus een gereedschapsaanroep; een afgekapte aanroep leverde een doel zonder velden op.
const MAX_UIT = 2000;
const MAX_RONDES = 4;
const MAX_DOELEN = 25;
// Een Vercel Function accepteert hoogstens 4,5 MB per aanvraag; de browser verkleint de afbeelding vooraf.
const MAX_AFBEELDING = 2_500_000;
const MAX_TOTAAL_AFBEELDING = 3_500_000;
const MAX_AFBEELDINGEN = 2;
const BEELDTYPEN = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const SYSTEEM = `Je bent Jarvis, de assistent van de eigenaar in het Command Center. Antwoord in het Nederlands, kort en feitelijk.
Is het bericht alleen een vraag of gesprek: antwoord gewoon, zonder maak_doel. Bevat het bericht naast een vraag ook een concrete opdracht: beantwoord de vraag en maak voor de opdracht een doel aan.
Vragen over Jarvis zelf (welke taken lopen, status, wat er vandaag klaar is, wat er vastzit, waarom een taak ergens staat, wat er bij een taak gebeurde): haal de gegevens zelf op met het gereedschap raadpleeg_doelen en vraag de eigenaar nooit om gegevens die al in Jarvis staan. Een informatievraag maakt nooit een doel aan. Stel nooit voor een taak opnieuw aan te maken voordat je met raadpleeg_doelen hebt gecontroleerd of die al bestaat; bestaat hij, verwijs dan naar het bestaande doel.
De keten van een doel: open (nieuw, wacht tot de uitvoerder het oppakt) → bezig (de uitvoerder bouwt) → review (pull request open, wacht op de reviewjob in CI) → samengevoegd (wordt uitgerold, daarna meet CI productie) → klaar. Vast = vastgelopen (veld vast_door zegt wie: uitvoerder, ci of eigenaar; de uitkomst geeft de reden), gesloten = door de eigenaar afgesloten. Leg bij een vraag uit in welke stap het doel zit en wat er dan gebeurt.
Vragen over de historie van een taak (wat is er gebeurd, waarom liep hij vast, welke NO-GO-feedback, wat is daarna aangepast, is hij hervat, hoe is het opgelost, welke pull requests): roep raadpleeg_doelen aan met het id van het doel; dat geeft de activiteit (stappen, fouten, herstel, pull requests, merge) en de reviewoordelen met rapport per kop van de pull request. Zonder id (bijvoorbeeld "welke taak liep het laatst vast") gebruik je historie: true, dat geeft de recentste vastgelopen doelen, fouten en NO-GO's; haal daarna het gevonden doel met id op. Geef alleen wat daar staat; ontbreekt een gebeurtenis in de administratie, zeg dat dan. De uitvoerder draait periodiek; een doel op open kan dus even wachten.
Is het een concrete opdracht om iets te bouwen of te wijzigen: roep het gereedschap maak_doel aan met een korte titel, en kies het project als het duidelijk is. De letterlijke tekst van de eigenaar gaat automatisch het doel in; herhaal die niet. Geef in toelichting alleen wat daar niet in staat: waar de eigenaar naar eerdere berichten verwijst, of wat er op een meegestuurde afbeelding staat.
Projecten: tovas-flow (ToVas Flow: gemiste oproepen, offertes, reviews, inlogpagina), kasboek (Kasboek). Subprojecten van tovas-flow: gemiste-oproepen, offerte-opvolging, reviews-verzamelen.
Bij een bericht kan een afbeelding zitten die de eigenaar ter toelichting meestuurt: kijk ernaar en gebruik wat erop staat. Neem bij een opdracht de relevante inhoud van de afbeelding in woorden op in de toelichting.
Verzin geen resultaten en beloof niets over de uitkomst; de keten bouwt, beoordeelt en rolt uit.`;

const GEREEDSCHAP = [{
  name: "raadpleeg_doelen",
  description: "Haal doelen (taken) uit de Jarvis-administratie op, met status, pull request en uitkomst. Alleen lezen. Geef id voor één doel met zijn recente activiteit; anders een lijst, nieuwste eerst, eventueel gefilterd.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Doel-id, bijvoorbeeld D-20261020-210018902" },
      zoek: { type: "string", description: "Woord in titel of opdracht" },
      status: { type: "string", enum: ["open", "bezig", "review", "samengevoegd", "klaar", "vast", "gesloten", "lopend"], description: "lopend = open, bezig, review of samengevoegd" },
      sinds: { type: "string", description: "ISO-datum of -tijd: alleen doelen die sindsdien zijn bijgewerkt" },
      aantal: { type: "integer", description: "Hoeveel doelen, standaard 10, hoogstens 25" },
      historie: { type: "boolean", description: "Zonder id: geef de recentste vastgelopen doelen, fouten, herstelacties en NO-GO-oordelen over alle doelen" },
    },
  },
}, {
  name: "maak_doel",
  description: "Maak een doel aan voor een concrete ontwikkelopdracht. Alleen voor opdrachten, nooit voor vragen.",
  input_schema: {
    type: "object",
    properties: {
      titel: { type: "string", description: "Korte titel, hoogstens 80 tekens" },
      toelichting: { type: "string", description: "Optioneel en kort: context die niet in de tekst van de eigenaar staat (verwijzing naar eerdere berichten, inhoud van een afbeelding). De tekst van de eigenaar zelf wordt automatisch toegevoegd." },
      project: { type: "string", description: "Optioneel: tovas-flow, kasboek of tovas-flow/<subproject>", pattern: "^[a-z0-9-]+(/[a-z0-9-]+)?$" },
    },
    required: ["titel"],
  },
}];

const DOEL_KOLOMMEN = "id,titel,opdracht,status,pr,uitkomst,pogingen,aangemaakt,bijgewerkt,vast_door";
const kort = (t, n) => (typeof t === "string" && t.length > n ? `${t.slice(0, n)}…` : t);

/** Leest uit de bestaande doelen-administratie met de sessie van de ingelogde eigenaar; er komt geen tweede administratie bij. */
export async function raadpleeg(cfg, token, invoer, fetchFn) {
  const kop = { apikey: cfg.key, authorization: `Bearer ${token}`, "accept-profile": "jarvis" };
  const haal = async (pad) => {
    const r = await fetchFn(`${cfg.url}/rest/v1/${pad}`, { headers: kop });
    if (!r.ok) throw new Error(`raadplegen mislukt (${r.status})`);
    return r.json();
  };
  const i = invoer ?? {};
  const schoon = (d) => ({ ...d, opdracht: kort(d.opdracht, 600), uitkomst: kort(d.uitkomst, 1200) });
  if (typeof i.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(i.id)) {
    const [doel] = await haal(`doelen?select=${DOEL_KOLOMMEN}&id=eq.${i.id}`);
    if (!doel) return { gevonden: false, id: i.id };
    // Activiteit en reviewoordelen zijn een aanvulling; ontbreken van leesrecht mag het antwoord niet breken.
    const aanvulling = (pad) => haal(pad).catch((e) => ({ fout: /\((401|403)\)/.test(String(e?.message)) ? "geen leesrecht" : "ophalen mislukt" }));
    const activiteit = await aanvulling(`activiteit?select=op,rol,soort,tekst,verwijzing&taak=eq.${i.id}&order=op.desc&limit=40`);
    const pr = doel.pr && typeof doel.pr === "object" ? doel.pr : null;
    const reviews = pr && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(pr.repo)) && Number.isInteger(pr.nummer)
      ? await aanvulling(`toetsingen?select=op,commit_sha,oordeel,door,rapport&pr_repo=eq.${pr.repo}&pr_nummer=eq.${pr.nummer}&order=op.desc&limit=6`)
      : [];
    const lijst = (x, f) => (Array.isArray(x) ? x.map(f) : `niet leesbaar (${x.fout})`);
    return {
      gevonden: true,
      doel: schoon(doel),
      activiteit: lijst(activiteit, (a) => ({ ...a, tekst: kort(a.tekst, 400) })),
      reviewoordelen: lijst(reviews, (r) => ({ ...r, rapport: kort(r.rapport, 1500) })),
    };
  }
  if (i.historie === true) {
    const aanvulling = (pad) => haal(pad).catch(() => "niet leesbaar");
    const [vast, activiteit, nogo] = await Promise.all([
      aanvulling(`doelen?select=${DOEL_KOLOMMEN}&status=eq.vast&order=bijgewerkt.desc&limit=5`),
      aanvulling("activiteit?select=op,taak,rol,soort,tekst,verwijzing&taak=like.D-*&soort=in.(fout,herstel,klaar,merge,pr)&order=op.desc&limit=20"),
      aanvulling("toetsingen?select=op,pr_repo,pr_nummer,commit_sha,oordeel,rapport&oordeel=eq.NO-GO&order=op.desc&limit=5"),
    ]);
    return {
      vastgelopen: Array.isArray(vast) ? vast.map(schoon) : vast,
      recente_gebeurtenissen: Array.isArray(activiteit) ? activiteit.map((a) => ({ ...a, tekst: kort(a.tekst, 300) })) : activiteit,
      recente_no_go: Array.isArray(nogo) ? nogo.map((r) => ({ ...r, rapport: kort(r.rapport, 600) })) : nogo,
    };
  }
  const q = [`select=${DOEL_KOLOMMEN}`, "order=bijgewerkt.desc"];
  const aantal = Math.min(Math.max(Number.parseInt(i.aantal, 10) || 10, 1), MAX_DOELEN);
  q.push(`limit=${aantal}`);
  if (i.status === "lopend") q.push("status=in.(open,bezig,review,samengevoegd)");
  else if (["open", "bezig", "review", "samengevoegd", "klaar", "vast", "gesloten"].includes(i.status)) q.push(`status=eq.${i.status}`);
  const sinds = typeof i.sinds === "string" ? new Date(i.sinds) : null;
  if (sinds && !Number.isNaN(sinds.getTime())) q.push(`bijgewerkt=gte.${encodeURIComponent(sinds.toISOString())}`);
  const zoek = typeof i.zoek === "string" ? i.zoek.replace(/[^\p{L}\p{N} -]/gu, "").trim().slice(0, 60) : "";
  if (zoek) q.push(`or=(${encodeURIComponent(`titel.ilike.*${zoek}*`)},${encodeURIComponent(`opdracht.ilike.*${zoek}*`)})`);
  const doelen = await haal(`doelen?${q.join("&")}`);
  return { aantal: doelen.length, doelen: doelen.map(schoon) };
}

/** De enige plek die de aanbieder kent. Geeft { tekst, doel } terug; doel is null of { titel, opdracht, project }.
 *  Leesgereedschap (raadpleeg_doelen) wordt via `lees` uitgevoerd en het resultaat teruggegeven aan het model. */
export async function vraagModel(berichten, { sleutel, fetchFn, lees = null }) {
  const nu = new Date().toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "full", timeStyle: "short" });
  const gesprek = [...berichten];
  for (let ronde = 0; ronde < MAX_RONDES; ronde += 1) {
    const r = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": sleutel, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_UIT, system: `${SYSTEEM}\nHet is nu ${nu} (Nederlandse tijd).`, tools: GEREEDSCHAP, messages: gesprek }),
    });
    if (!r.ok) throw new Error(`taalmodel gaf ${r.status}`);
    const uit = await r.json();
    const blokken = Array.isArray(uit.content) ? uit.content : [];
    const tekst = blokken.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    const maak = blokken.find((b) => b.type === "tool_use" && b.name === "maak_doel");
    if (maak) return { tekst, doel: maak.input };
    const leesVerzoeken = blokken.filter((b) => b.type === "tool_use" && b.name === "raadpleeg_doelen");
    if (!leesVerzoeken.length || !lees) return { tekst, doel: null };
    gesprek.push({ role: "assistant", content: blokken });
    const resultaten = [];
    for (const v of leesVerzoeken) {
      let inhoud;
      try { inhoud = JSON.stringify(await lees(v.input)); } catch { inhoud = JSON.stringify({ fout: "De administratie was nu niet te lezen." }); }
      resultaten.push({ type: "tool_result", tool_use_id: v.id, content: inhoud });
    }
    gesprek.push({ role: "user", content: resultaten });
  }
  return { tekst: "Ik kon dit niet in een paar stappen uitzoeken; stel de vraag iets gerichter.", doel: null };
}

function schoonAfbeelding(a) {
  if (!a || typeof a.data !== "string" || !BEELDTYPEN.includes(a.media) || !a.data || a.data.length > MAX_AFBEELDING) return null;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(a.data) ? { media: a.media, data: a.data } : null;
}

/** Geeft de berichten voor het model, of null; of { fout } als een afbeelding niet deugt. */
function schoon(gesprek) {
  if (!Array.isArray(gesprek) || gesprek.length === 0) return null;
  let totaal = 0;
  let aantal = 0;
  const rest = [];
  // Van achteren naar voren, zodat de nieuwste afbeeldingen voorrang krijgen binnen het totaal.
  for (const b of gesprek.slice(-MAX_BERICHTEN).reverse()) {
    const tekst = String(b?.tekst ?? "").slice(0, MAX_TEKENS);
    const role = b?.rol === "jarvis" ? "assistant" : "user";
    let afb = null;
    if (role === "user" && b?.afbeelding) {
      afb = schoonAfbeelding(b.afbeelding);
      if (!afb) return { fout: "De afbeelding is ongeldig of te groot." };
      if (aantal >= MAX_AFBEELDINGEN || totaal + afb.data.length > MAX_TOTAAL_AFBEELDING) afb = null;
      else { aantal += 1; totaal += afb.data.length; }
    }
    if (!tekst.trim() && !afb) continue;
    const content = afb
      ? [{ type: "image", source: { type: "base64", media_type: afb.media, data: afb.data } }, ...(tekst.trim() ? [{ type: "text", text: tekst }] : [])]
      : tekst;
    rest.push({ role, content });
  }
  rest.reverse();
  // Het gesprek moet met de eigenaar beginnen en eindigen.
  while (rest.length && rest[0].role !== "user") rest.shift();
  return rest.length && rest[rest.length - 1].role === "user" ? rest : null;
}

/** Controleert de sessie bij Supabase en geeft de gebruiker terug, of null. */
async function gebruiker(cfg, token, fetchFn) {
  const r = await fetchFn(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.key, authorization: `Bearer ${token}` } });
  return r.ok ? await r.json() : null;
}

/** De tekst van het laatste bericht van de eigenaar (zonder afbeelding). */
export function laatsteTekst(berichten) {
  const laatste = [...berichten].reverse().find((b) => b.role === "user");
  if (!laatste) return "";
  if (typeof laatste.content === "string") return laatste.content.trim();
  return laatste.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
}

/**
 * Zet een gereedschapsaanroep om in de velden van een doel. De letterlijke tekst van de eigenaar gaat altijd mee,
 * zodat niets van de opdracht verloren gaat; de titel valt terug op de eerste regel van die tekst. Zo mislukt een
 * doel niet meer doordat het model een veld leeg liet of de aanroep werd afgekapt.
 */
export function doelVelden(doel, origineel) {
  const tekst = String(origineel ?? "").trim();
  const eerste = tekst.split("\n").map((r) => r.trim()).find(Boolean) ?? "";
  const titel = (String(doel?.titel ?? "").trim() || (eerste.length > 80 ? `${eerste.slice(0, 77)}…` : eerste)).slice(0, 120);
  // Oudere aanroepen gebruiken nog het veld opdracht; dat telt als toelichting.
  const toelichting = String(doel?.toelichting ?? doel?.opdracht ?? "").trim();
  const delen = [];
  if (toelichting && toelichting !== tekst) delen.push(toelichting);
  if (tekst) delen.push(delen.length ? `Oorspronkelijke opdracht van de eigenaar:\n${tekst}` : tekst);
  return { titel, opdracht: delen.join("\n\n").slice(0, MAX_OPDRACHT) };
}

async function maakDoel(cfg, token, doel, fetchFn, origineel = "") {
  let { titel, opdracht } = doelVelden(doel, origineel);
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
  if (!Array.isArray(berichten)) return { status: 400, lading: { fout: berichten.fout } };
  try {
    if (!(await gebruiker(cfg, token, fetchFn))) return { status: 401, lading: { fout: "Sessie ongeldig; log opnieuw in." } };
    const { tekst, doel } = await vraagModel(berichten, { sleutel, fetchFn, lees: (invoer) => raadpleeg(cfg, token, invoer, fetchFn) });
    if (doel) {
      const nieuw = await maakDoel(cfg, token, doel, fetchFn, laatsteTekst(berichten));
      return { status: 200, lading: { antwoord: tekst || `Doel gestart: ${nieuw.titel}`, doel: nieuw } };
    }
    return { status: 200, lading: { antwoord: tekst || "Ik heb daar geen antwoord op." } };
  } catch (e) {
    // Geen details van de aanbieder of de sleutel naar de browser.
    return { status: 502, lading: { fout: e instanceof Error && /^doel/.test(e.message) ? e.message : "Jarvis kon nu niet antwoorden." } };
  }
}
