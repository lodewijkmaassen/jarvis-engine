// Een deterministische generator van SQL-tekstketens voor het differentiële bewijs tegen echte PostgreSQL:
// tekst-literals met en zonder E-prefix, aaneengeschakelde vervolgstukken (newline ertussen), backslashes en
// quotes in de stukken, commentaar dat een quote bevat, en schadelijke code ertussen. PostgreSQL leest zulke
// ketens anders dan een naïeve lexer; elk geval dat de scanner doorlaat en dat in PostgreSQL toch effect heeft,
// is een gemiste omzeiling. De generator vindt de E-keten-omzeiling (BLK-C) van de zesde review in een paar duizend gevallen.

export const KANARIE_DROP = "drop table public.klanten";
export const KANARIE_JARVIS = "insert into jarvis.v3_instellingen (sleutel, waarde) values ('qa-soep', '1')";

const CONT = ["x", "\\", "\\'", "''", "'", "\\\\", "--", "/*", "$$", "a"] as const;
const SEP = ["\n", " \n ", " -- c\n", "\r\n", " ", "\n\n"] as const;
const LOS = ["e'", "E'", "'", "'", "n'", "b'"] as const;

export function genereerTekstSoep(seed0: number, aantal: number): string[] {
  let seed = seed0 >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
  const uit: string[] = [];
  for (let i = 0; i < aantal; i += 1) {
    let s = rnd() < 0.3 ? "insert into public.t select " : "";
    const stukken = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < stukken; k += 1) {
      s += k === 0 ? pick(LOS) : "'";
      const m = Math.floor(rnd() * 4);
      for (let c = 0; c < m; c += 1) s += pick(CONT);
      s += "'";
      if (k < stukken - 1) s += pick(SEP);
    }
    const kanarie = rnd() < 0.5 ? KANARIE_DROP : KANARIE_JARVIS;
    s += pick(["", ";", "'", `;${kanarie};`, `; ${kanarie}; -- '`, `; ${kanarie}; -- `, `''; ${KANARIE_DROP}; select ''`]);
    uit.push(s);
  }
  return uit;
}
