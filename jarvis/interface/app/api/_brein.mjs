// Jarvis Brein V1: geheugen, selectieve context en het kostenplafond van de sparmodus.
//
// Geen tweede agent, geen tweede database en geen vectordatabase. Het geheugen staat in de bestaande tabel
// jarvis.berichten, op dezelfde manier als de ideeën van de eigenaar: een rij van de eigenaar met status
// 'verwerkt' (de berichtenwachtrij pakt alleen 'nieuw' op) en in context het kanaal "brein". Er zijn twee soorten:
//
//   beurt   — één sparbeurt: tekst = vraag van de eigenaar, context.antwoord = het antwoord, context.gesprek,
//             context.kosten_usd (eerst de gereserveerde bovengrens, daarna het gemeten bedrag).
//   inzicht — iets wat Jarvis onthoudt: tekst = het inzicht, context.inzicht_soort (besluit | feit | aanname |
//             voorkeur | doelstelling | projectinfo), context.bron (gesprek en beurt, of het brondocument),
//             eventueel context.project, context.vervangt / context.vervallen / context.gewist. Herleidbaar via de
//             bron, corrigeerbaar via vervangen, verwijderbaar via wissen.
//
// Herstel contextintegratie (D-20261121-235241117): de eerste praktijkvraag ("een nieuwe commerciële AI-dienst naast
// ToVas Flow?") kreeg als antwoord dat Jarvis niets wist over het project of de doelstellingen van de eigenaar. Oorzaak:
// het geheugen kende alleen gespreksinzichten (en was nog leeg), projectinformatie en persoonlijke doelstellingen hadden
// geen eigen soort, en een inzicht over een project telde alleen mee als de vraag toevallig dezelfde woorden gebruikte
// als de inzichttekst. Nu: twee soorten erbij (projectinfo, doelstelling), het project van een inzicht telt mee bij de
// selectie (de vraag noemt "ToVas Flow" → de projectinformatie van tovas-flow gaat mee), doelstellingen gaan net als
// besluiten altijd mee, en elk item draagt zijn categorie, datum en bron, met een waarschuwing als het oud is of een
// aanname. Nog steeds één geheugen in dezelfde tabel; geen tweede kennissysteem.
//
// Alles is deterministisch: dezelfde vraag op hetzelfde geheugen geeft dezelfde selectie.

export const KANAAL = "brein";
export const INZICHT_SOORTEN = ["besluit", "feit", "aanname", "voorkeur", "doelstelling", "projectinfo"];
/** Hoe een soort in de context heet: het model moet projectinformatie, doelstellingen, besluiten en aannames uit elkaar houden. */
export const CATEGORIE = { besluit: "besluit", feit: "feit", aanname: "aanname", voorkeur: "voorkeur", doelstelling: "persoonlijke doelstelling", projectinfo: "projectinformatie" };
/** Soorten die altijd meegaan: ze moeten worden toegepast zonder dat de eigenaar ze herhaalt. */
const ALTIJD = new Set(["besluit", "voorkeur", "doelstelling"]);
/** Na zoveel dagen krijgt een inzicht een waarschuwing mee: niet zonder voorbehoud als actueel feit brengen. */
export const VEROUDERD_DAGEN = 180;

// Gecontroleerd op 2026-11-20: Sonnet 5.5 $2 in / $10 uit per miljoen tokens, cache lezen $0,10; Haiku 5.5 $0,10 / $0,50.
export const TARIEVEN = {
  "claude-sonnet-5-5": { in: 2, uit: 10, cacheLees: 0.1, cacheSchrijf: 2.5 },
  "claude-haiku-5-5": { in: 0.1, uit: 0.5, cacheLees: 0.01, cacheSchrijf: 0.125 },
};

/** Harde maandgrens van de sparmodus in dollars; bij bereiken geen nieuwe betaalde aanroep (besluit van de eigenaar). */
export const MAAND_LIMIET_USD = 35;

// Hoeveel geheugen er per beurt meegaat, en hoeveel rijen er hoogstens worden doorzocht.
const MAX_GEHEUGEN_TEKENS = 9000; // ≈ 2.500–3.000 tokens
const MAX_BEURTEN_DOORZOCHT = 300;
const MAX_DAGEN = 180;
const MAX_TEKST = 2000;

const STOP = new Set(("de het een en of maar dat die dit deze wat wie waar hoe waarom wanneer welke voor van met naar uit bij over onder "
  + "tegen tussen door zonder ook nog niet wel geen al als dan want omdat dus zijn is was waren wordt worden kan kunnen moet moeten "
  + "zal zullen zou zouden heb hebben heeft had ik jij je jou jouw wij we ons onze zij ze hun hem haar mijn mij u uw er hier daar "
  + "zo te om op aan in tot nu heel veel meer minder iets niets alles echter eigenlijk gewoon even jarvis").split(" "));

/** Woorden van minstens drie tekens, zonder stopwoorden, kleine letters, zonder accenten. */
export function termen(tekst) {
  const s = String(tekst ?? "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
  const uit = new Set();
  for (const w of s.split(/[^\p{L}\p{N}]+/u)) if (w.length >= 3 && !STOP.has(w)) uit.add(w.length > 6 ? w.slice(0, 6) : w);
  return uit;
}

const kort = (t, n) => { const s = String(t ?? ""); return s.length > n ? `${s.slice(0, n)}…` : s; };

/** Zet ruwe rijen om in geheugenitems; gewiste en vervallen inzichten tellen niet mee. */
export function items(rijen) {
  const uit = [];
  for (const r of Array.isArray(rijen) ? rijen : []) {
    const c = r?.context && typeof r.context === "object" ? r.context : {};
    if (c.kanaal !== KANAAL || c.gewist === true) continue;
    if (c.soort === "inzicht" && !c.vervallen && String(r.tekst ?? "").trim()) {
      uit.push({ id: String(r.id), soort: "inzicht", inzicht_soort: c.inzicht_soort, project: c.project ?? null, tekst: String(r.tekst), op: r.op, bron: c.bron ?? null });
    } else if (c.soort === "beurt" && String(r.tekst ?? "").trim() && typeof c.antwoord === "string") {
      uit.push({ id: String(r.id), soort: "beurt", gesprek: c.gesprek ?? null, tekst: String(r.tekst), antwoord: c.antwoord, op: r.op });
    }
  }
  return uit;
}

/** De woorden van een projectsleutel ("tovas-flow/offerte-opvolging" → tovas, flow, offert, opvolg). */
const projectTermen = (project) => termen(String(project ?? "").replace(/[/-]/g, " "));

/** De projecten in het geheugen die de vraag noemt: alle woorden van de projectsleutel staan in de vraag. */
export function genoemdeProjecten(geheugen, vraag) {
  const v = termen(vraag);
  const uit = new Set();
  for (const it of geheugen) {
    if (it.soort !== "inzicht" || !it.project) continue;
    const hoofd = String(it.project).split("/")[0];
    const t = projectTermen(hoofd);
    if (t.size && [...t].every((w) => v.has(w))) uit.add(hoofd);
  }
  return [...uit].sort();
}

/**
 * Selecteert het relevante geheugen voor een vraag, binnen een vaste omvang. Besluiten, voorkeuren en doelstellingen
 * gaan altijd mee (die moeten worden toegepast zonder dat de eigenaar ze herhaalt); projectinformatie, feiten,
 * aannames en eerdere beurten alleen als ze met de vraag overlappen. Het project van een inzicht telt mee als woorden:
 * noemt de vraag het project, dan gaat de projectinformatie ervan mee. Beurten die al in het meegestuurde gesprek
 * staan (`uitsluiten`: de teksten van de eigenaar daarin) gaan niet nog eens mee.
 */
export function selecteer(geheugen, vraag, { uitsluiten = [], maxTekens = MAX_GEHEUGEN_TEKENS, nu = new Date() } = {}) {
  const al = new Set([...uitsluiten].map((t) => String(t).trim().slice(0, MAX_TEKST)));
  const v = termen(vraag);
  const score = (it) => {
    const t = termen(it.soort === "beurt" ? `${it.tekst} ${it.antwoord}` : it.tekst);
    if (it.soort === "inzicht") for (const w of projectTermen(it.project)) t.add(w);
    let s = 0;
    for (const w of v) if (t.has(w)) s += 1;
    return s;
  };
  const tijd = (it) => (it.op ? Date.parse(it.op) || 0 : 0);
  const kandidaten = geheugen
    .filter((it) => !(it.soort === "beurt" && al.has(it.tekst.trim().slice(0, MAX_TEKST))))
    .map((it) => ({ it, s: score(it), vast: it.soort === "inzicht" && ALTIJD.has(it.inzicht_soort) }))
    .filter((k) => k.vast || k.s > 0)
    // Vaste inzichten eerst, dan op overlap, dan nieuwste eerst, dan id: volledig deterministisch.
    .sort((a, b) => (Number(b.vast) - Number(a.vast)) || (b.s - a.s) || (tijd(b.it) - tijd(a.it)) || a.it.id.localeCompare(b.it.id));
  const gekozen = [];
  let tekens = 0;
  for (const { it } of kandidaten) {
    const regel = it.soort === "inzicht"
      ? inzichtRegel(it, nu)
      : { id: it.id, soort: "eerder gesprek", categorie: "gespreksgeschiedenis", op: it.op, eigenaar: kort(it.tekst, 500), jarvis: kort(it.antwoord, 700) };
    const n = JSON.stringify(regel).length;
    if (tekens + n > maxTekens) continue;
    gekozen.push(regel);
    tekens += n;
  }
  return gekozen;
}

/** Eén inzicht zoals het model het ziet: categorie, datum en bron erbij, en een voorbehoud waar dat nodig is. */
function inzichtRegel(it, nu) {
  const dagen = it.op ? Math.floor((nu.getTime() - (Date.parse(it.op) || nu.getTime())) / 864e5) : null;
  const let_op = [];
  if (it.inzicht_soort === "aanname") let_op.push("aanname, geen vastgesteld feit");
  if (it.inzicht_soort === "doelstelling") let_op.push("doel of plan van de eigenaar, geen behaald resultaat");
  if (dagen !== null && dagen > VEROUDERD_DAGEN) let_op.push(`vastgelegd ${dagen} dagen geleden; controleer of dit nog geldt`);
  return {
    id: it.id,
    soort: it.inzicht_soort,
    categorie: CATEGORIE[it.inzicht_soort] ?? it.inzicht_soort,
    tekst: kort(it.tekst, 600),
    project: it.project,
    op: it.op,
    bron: it.bron,
    ...(let_op.length ? { let_op: let_op.join("; ") } : {}),
  };
}

/** Wat een sparbeurt hoogstens kan kosten, gegeven de grenzen per aanroep. Wordt vooraf gereserveerd. */
export function bovengrens(model, { maxIn, maxUit, rondes }) {
  const t = TARIEVEN[model];
  return t ? (rondes * (maxIn * t.in + maxUit * t.uit)) / 1e6 : Number.POSITIVE_INFINITY;
}

/** Kosten van één modelantwoord uit het veld usage. */
export function kostenVan(model, usage) {
  const t = TARIEVEN[model];
  const u = usage ?? {};
  if (!t) return 0;
  const n = (x) => (Number.isFinite(x) ? x : 0);
  return (n(u.input_tokens) * t.in + n(u.output_tokens) * t.uit + n(u.cache_read_input_tokens) * t.cacheLees + n(u.cache_creation_input_tokens) * t.cacheSchrijf) / 1e6;
}

const begin = (nu) => new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1)).toISOString();

/**
 * Het geheugen van de eigenaar in jarvis.berichten, met zijn eigen sessie (RLS: alleen de eigenaar leest en schrijft).
 * Elke fout bij het lezen van het kostenoverzicht laat de sparmodus dicht: liever geen antwoord dan een onbewaakte uitgave.
 */
export function berichtenGeheugen(cfg, token, fetchFn, nu = () => new Date()) {
  const kop = { apikey: cfg.key, authorization: `Bearer ${token}`, "accept-profile": "jarvis", "content-profile": "jarvis", "content-type": "application/json" };
  const basis = `${cfg.url}/rest/v1/berichten`;
  const haal = async (q) => {
    const r = await fetchFn(`${basis}?${q}`, { headers: kop });
    if (!r.ok) throw new Error(`geheugen lezen mislukt (${r.status})`);
    return r.json();
  };
  const schrijf = async (rij) => {
    const r = await fetchFn(basis, { method: "POST", headers: { ...kop, prefer: "return=representation" }, body: JSON.stringify(rij) });
    if (!r.ok) throw new Error(`geheugen schrijven mislukt (${r.status})`);
    const [uit] = await r.json();
    return uit;
  };
  const wijzig = async (id, velden) => {
    const r = await fetchFn(`${basis}?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: kop, body: JSON.stringify(velden) });
    if (!r.ok) throw new Error(`geheugen bijwerken mislukt (${r.status})`);
  };
  const rij = (tekst, context) => ({ van: "eigenaar", tekst, status: "verwerkt", verwerkt_op: nu().toISOString(), verwerking: "Geheugen van Jarvis Brein; geen opdracht.", context: { kanaal: KANAAL, ...context } });
  return {
    async lees() {
      const sinds = new Date(nu().getTime() - MAX_DAGEN * 864e5).toISOString();
      const [inzichten, beurten] = await Promise.all([
        haal(`select=id,tekst,op,context&context->>kanaal=eq.${KANAAL}&context->>soort=eq.inzicht&order=op.desc&limit=200`),
        haal(`select=id,tekst,op,context&context->>kanaal=eq.${KANAAL}&context->>soort=eq.beurt&op=gte.${encodeURIComponent(sinds)}&order=op.desc&limit=${MAX_BEURTEN_DOORZOCHT}`),
      ]);
      return items([...inzichten, ...beurten]);
    },
    async uitgegeven() {
      const rijen = await haal(`select=context&context->>kanaal=eq.${KANAAL}&context->>soort=eq.beurt&op=gte.${encodeURIComponent(begin(nu()))}&limit=20000`);
      return rijen.reduce((s, r) => s + (Number(r?.context?.kosten_usd) || 0), 0);
    },
    async reserveer({ gesprek, tekst, bedrag, model }) {
      const r = await schrijf(rij(kort(tekst, MAX_TEKST), { soort: "beurt", gesprek, model, kosten_usd: bedrag, gereserveerd: true }));
      return String(r.id);
    },
    async sluitBeurt(id, { gesprek, model, antwoord, kosten, onthouden }) {
      await wijzig(id, { context: { kanaal: KANAAL, soort: "beurt", gesprek, model, antwoord: kort(antwoord, MAX_TEKST), kosten_usd: Math.round(kosten * 1e6) / 1e6, onthouden } });
    },
    async onthoud(inzicht, bron) {
      const ctx = { soort: "inzicht", inzicht_soort: inzicht.soort, bron, ...(inzicht.project ? { project: inzicht.project } : {}), ...(inzicht.vervangt ? { vervangt: inzicht.vervangt } : {}) };
      const nieuw = await schrijf(rij(inzicht.tekst, ctx));
      if (inzicht.vervangt) {
        const [oud] = await haal(`select=id,context&id=eq.${encodeURIComponent(inzicht.vervangt)}&context->>kanaal=eq.${KANAAL}&context->>soort=eq.inzicht`);
        if (oud) await wijzig(oud.id, { context: { ...oud.context, vervallen: true, vervangen_door: String(nieuw.id) } });
      }
      return String(nieuw.id);
    },
  };
}

/**
 * Een geheugen dat alleen voor deze aanvraag bestaat, voor de acceptatiedeur: die schrijft nooit in de database. De
 * test geeft het geheugen uit een eerder gesprek mee (zoals de database het zou teruggeven) en krijgt nieuwe inzichten
 * in het antwoord terug, zodat een volgend, gescheiden gesprek erop kan voortbouwen.
 */
export function proefGeheugen(rijen) {
  const lijst = items(Array.isArray(rijen) ? rijen.slice(0, 200) : []);
  const nieuw = [];
  let teller = 0;
  return {
    nieuw,
    async lees() { return [...lijst]; },
    async uitgegeven() { return 0; },
    async reserveer() { return "proef"; },
    async sluitBeurt() {},
    async onthoud(inzicht, bron) {
      teller += 1;
      const id = `proef-${teller}`;
      const rij = { id, tekst: inzicht.tekst, op: new Date().toISOString(), context: { kanaal: KANAAL, soort: "inzicht", inzicht_soort: inzicht.soort, bron, ...(inzicht.project ? { project: inzicht.project } : {}) } };
      if (inzicht.vervangt) for (const it of lijst) if (it.id === inzicht.vervangt) lijst.splice(lijst.indexOf(it), 1);
      lijst.push(...items([rij]));
      nieuw.push(rij);
      return id;
    },
  };
}

/** Controleert een onthoud-aanroep van het model. */
export function schoonInzicht(invoer) {
  const i = invoer ?? {};
  const soort = INZICHT_SOORTEN.includes(i.soort) ? i.soort : null;
  const tekst = String(i.tekst ?? "").trim().slice(0, 600);
  if (!soort || !tekst) return null;
  const project = typeof i.project === "string" && /^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(i.project) ? i.project : null;
  const vervangt = typeof i.vervangt === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(i.vervangt) ? i.vervangt : null;
  return { soort, tekst, project, vervangt };
}
