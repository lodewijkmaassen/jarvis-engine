// Jarvis-kern — canonieke JSON + hashing.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  gitBlobHash,
  gitBlobHashOfValue,
  sha256,
  shortHash,
} from "@/jarvis/src/hash";

const FIXTURES = path.join(process.cwd(), "tests/jarvis/fixtures");

describe("canonicalJson", () => {
  it("sorteert objectsleutels, zodat volgorde van opbouw niet uitmaakt", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
  });

  it("sorteert ook genest", () => {
    expect(canonicalJson({ z: { y: 1, x: 2 }, a: [3, 1] })).toBe(
      '{"a":[3,1],"z":{"x":2,"y":1}}',
    );
  });

  it("laat arrayvolgorde met rust (die is betekenisvol)", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 1, 2]));
  });

  it("verwerkt de primitieven en null", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(12.5)).toBe("12.5");
    expect(canonicalJson('tekst met "quote"')).toBe('"tekst met \\"quote\\""');
  });
});

describe("gitBlobHash", () => {
  // Beide constanten zijn algemeen bekende Git-blob-hashes; als onze
  // implementatie ooit afwijkt van `git hash-object`, valt dat hier om.
  it("komt overeen met de bekende hash van een lege blob", () => {
    expect(gitBlobHash("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  it("komt overeen met de bekende hash van \"hello\\n\"", () => {
    expect(gitBlobHash("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("telt bytes en niet tekens (meerbyte-tekens)", () => {
    // "é" is 2 bytes in UTF-8; een implementatie die .length gebruikt zou
    // hier een andere header schrijven en dus een andere hash geven.
    const viaBuffer = gitBlobHash(Buffer.from("é", "utf8"));
    expect(gitBlobHash("é")).toBe(viaBuffer);
  });

  it("geeft voor elk fixturebronbestand hetzelfde als `git hash-object`", () => {
    for (const bestand of ["architectuur.md", "telefonie.md", "notificaties.md"]) {
      const pad = path.join(FIXTURES, "sources", bestand);
      const viaGit = execFileSync("git", ["hash-object", pad], { encoding: "utf8" }).trim();
      const inhoud = readFileSync(pad, "utf8");
      expect(gitBlobHash(inhoud)).toBe(viaGit);
    }
  });
});

describe("gitBlobHashOfValue", () => {
  it("is onafhankelijk van sleutelvolgorde", () => {
    expect(gitBlobHashOfValue({ a: 1, b: 2 })).toBe(gitBlobHashOfValue({ b: 2, a: 1 }));
  });

  it("verandert wél bij een inhoudelijke wijziging", () => {
    expect(gitBlobHashOfValue({ a: 1 })).not.toBe(gitBlobHashOfValue({ a: 2 }));
  });
});

describe("sha256 en shortHash", () => {
  it("sha256 geeft de bekende hash van de lege string", () => {
    expect(sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("shortHash kort af op 12 tekens", () => {
    expect(shortHash("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391")).toBe("e69de29bb2d1");
  });
});
