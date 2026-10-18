#!/usr/bin/env node
// 제품 버전 맞추기. 원천은 루트 package.json 의 version(서버가 읽는다 — server/src/version.ts).
//   node scripts/version.mjs set 0.8.0   다섯 곳을 그 버전으로 쓴다
//   node scripts/version.mjs check [v0.8.0]   다섯 곳이 같은지(태그를 주면 태그와도) 본다. 다르면 exit 1
// 릴리스 절차: docs/guides/release-macos.md
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** 버전이 적힌 곳: 읽기(get)와 바꿔 쓰기(put). 정규식이 못 찾으면 null — 파일 모양이 바뀐 것이다 */
const PLACES = [
  {
    file: "package.json",
    get: (s) => JSON.parse(s).version ?? null,
    put: (s, v) => s.replace(/^(  "version": ")[^"]*(")/m, `$1${v}$2`),
  },
  {
    file: "app/src-tauri/tauri.conf.json",
    get: (s) => JSON.parse(s).version ?? null,
    put: (s, v) => s.replace(/^(  "version": ")[^"]*(")/m, `$1${v}$2`),
  },
  {
    // [package] 표의 version 만(의존성 버전과 섞이지 않게 첫 표 안에서 찾는다)
    file: "app/src-tauri/Cargo.toml",
    get: (s) => /^\[package\][^[]*?^version = "([^"]*)"/ms.exec(s)?.[1] ?? null,
    put: (s, v) => s.replace(/^(\[package\][^[]*?^version = ")[^"]*(")/ms, `$1${v}$2`),
  },
  {
    // cargo build --locked 가 Cargo.toml 과 어긋난 lock 을 거절하므로 함께 맞춘다
    file: "app/src-tauri/Cargo.lock",
    get: (s) => /^name = "keyring-notes"\nversion = "([^"]*)"/m.exec(s)?.[1] ?? null,
    put: (s, v) => s.replace(/^(name = "keyring-notes"\nversion = ")[^"]*(")/m, `$1${v}$2`),
  },
  {
    file: "packages/core/src/i18n.ts",
    get: (s) => /^export const APP_VERSION = "([^"]*)";/m.exec(s)?.[1] ?? null,
    put: (s, v) => s.replace(/^(export const APP_VERSION = ")[^"]*(";)/m, `$1${v}$2`),
  },
];

const read = (f) => readFileSync(path.join(root, f), "utf8");

export function versions() {
  return PLACES.map((p) => ({ file: p.file, version: p.get(read(p.file)) }));
}

function check(tag) {
  const list = versions();
  const want = list[0].version;
  const problems = [];
  if (!want || !SEMVER.test(want)) problems.push(`package.json 의 version 이 SemVer 가 아니다: ${want}`);
  for (const { file, version } of list.slice(1)) {
    if (version !== want) problems.push(`${file}: ${version ?? "(찾지 못함)"} — package.json 은 ${want}`);
  }
  if (tag !== undefined && tag.replace(/^refs\/tags\//, "") !== `v${want}`) problems.push(`태그 ${tag} 가 버전 v${want} 와 다르다`);
  for (const { file, version } of list) console.log(`${version ?? "(없음)"}\t${file}`);
  if (problems.length) {
    console.error(`\n버전이 맞지 않는다:\n- ${problems.join("\n- ")}\n고치려면: pnpm version:set <버전>`);
    process.exit(1);
  }
  console.log(`\n모두 ${want}${tag !== undefined ? `, 태그 ${tag} 와 같다` : ""}`);
}

function set(v) {
  if (!v || !SEMVER.test(v)) {
    console.error(`SemVer 버전을 준다(앞에 v 없이): ${v ?? ""}`);
    process.exit(1);
  }
  for (const p of PLACES) {
    const before = read(p.file);
    const after = p.put(before, v);
    if (p.get(after) !== v) {
      console.error(`${p.file} 에서 버전 자리를 찾지 못했다 — scripts/version.mjs 의 정규식을 파일 모양에 맞춘다`);
      process.exit(1);
    }
    if (after !== before) writeFileSync(path.join(root, p.file), after);
  }
  check();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "check") check(arg);
  else if (cmd === "set") set(arg);
  else {
    console.error("쓰는 법: node scripts/version.mjs set <버전> | check [태그]");
    process.exit(2);
  }
}
