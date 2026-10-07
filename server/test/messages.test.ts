import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baseKey, OFFICIAL_MESSAGES } from "@keyring-notes/core";
import { describe, expect, it } from "vitest";

// 메시지 묶음(core/messages)과 코드가 맞는지: 웹 t(), 서버 serverText(), core·서버 오류 코드
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "node_modules" || name === "dist") continue;
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const en = OFFICIAL_MESSAGES.en;

describe("메시지 키", () => {
  it("코드가 쓰는 키가 모두 있다(웹 t(), 서버 serverText(), 오류 코드)", () => {
    const have = new Set(Object.keys(en).map(baseKey));
    const missing = new Set<string>();
    const need = (k: string, where: string) => {
      if (!have.has(k)) missing.add(`${k} (${where})`);
    };
    for (const f of files(path.join(root, "web/src"))) {
      const s = readFileSync(f, "utf8");
      const rel = path.relative(root, f);
      for (const m of s.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) need(m[1], rel);
      // 메시지 키를 값으로 넘기는 곳(설정 줄 이름·설명, 묶음 이름)
      for (const m of s.matchAll(/\b(?:label|hint|keywords)[=:]\s*"([a-z][A-Za-z]*\.[A-Za-z0-9_.]+)"/g)) need(m[1], rel);
    }
    for (const dir of ["server/src", "packages/core/src"]) {
      for (const f of files(path.join(root, dir))) {
        const s = readFileSync(f, "utf8");
        const rel = path.relative(root, f);
        for (const m of s.matchAll(/\bserverText\(\s*"([A-Za-z0-9_.]+)"/g)) need(m[1], rel);
        for (const m of s.matchAll(/new (?:PathError|NotFoundError|KeyedError)\(\s*"([A-Za-z0-9_.]+)"/g)) need(`error.${m[1]}`, rel);
        for (const m of s.matchAll(/new (?:ForbiddenError|UnauthorizedError)\(\s*"([A-Za-z0-9_.]+)"/g)) need(`error.${m[1]}`, rel);
        for (const m of s.matchAll(/new ConflictError\([^,()]+(?:\([^)]*\))?[^,()]*,\s*"([A-Za-z0-9_.]+)"/g)) need(`error.${m[1]}`, rel);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
