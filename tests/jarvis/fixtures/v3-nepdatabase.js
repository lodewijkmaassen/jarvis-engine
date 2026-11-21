// Een nagebootste Supabase-client voor de browsertest van V3 (D-20261121-105625624). Alleen wat de pagina gebruikt:
// from(tabel).select().eq().or().order().limit() en insert(), rpc(naam, args) en auth. Alles leeft in het geheugen
// van de pagina; window.__nep laat de test zien wat er is geschreven en aangeroepen.
(() => {
  const data = window.__nepData;
  const log = { inserts: [], rpcs: [] };
  window.__nep = log;
  function bouwer(tabel) {
    const filters = [];
    let max = null;
    const q = {
      select() { return q; },
      eq(k, v) { filters.push((r) => {
        const pad = k.split("->>");
        let w = r[pad[0]];
        if (pad.length > 1) { w = w && typeof w === "object" ? w[pad[1]] : undefined; }
        return String(w) === String(v);
      }); return q; },
      or() { return q; },
      order() { return q; },
      limit(n) { max = n; return q; },
      insert(rij) {
        const nieuw = { id: "b-" + Math.random().toString(36).slice(2), op: new Date().toISOString(), ...rij };
        (data[tabel] = data[tabel] ?? []).push(nieuw);
        log.inserts.push({ tabel, rij: nieuw });
        return Promise.resolve({ data: null, error: null });
      },
      then(ok, nee) {
        let rijen = (data[tabel] ?? []).filter((r) => filters.every((f) => f(r)));
        if (max !== null) rijen = rijen.slice(0, max);
        return Promise.resolve({ data: rijen, error: null }).then(ok, nee);
      },
    };
    return q;
  }
  const client = {
    from: bouwer,
    rpc(naam, args) {
      log.rpcs.push({ naam, args });
      if (naam === "doel_reageer") {
        const d = data.doelen.find((x) => x.id === args.p_id);
        d.opdracht += `\n\nReactie van de eigenaar (2026-11-21 12:00):\n${args.p_reactie}`;
        if (["klaar", "vast", "gesloten"].includes(d.status)) { d.status = "open"; d.uitkomst = "Heropend door de eigenaar met een reactie."; }
      }
      return Promise.resolve({ data: "ok", error: null });
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: "eigenaar" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
  window.supabase = { createClient: () => client };
})();
