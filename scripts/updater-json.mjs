#!/usr/bin/env node
// 앱 업데이터가 읽는 정보 파일(latest.json)을 만든다. 릴리스 워크플로가 universal 빌드 하나로 부른다.
//   node scripts/updater-json.mjs --version 0.8.0 --url <.app.tar.gz 주소> --sig <.app.tar.gz.sig> [--notes <글>] [--pub-date <RFC 3339>] --out latest.json
//
// 형식: https://v2.tauri.app/plugin/updater/ 「Static JSON File」. 앱은 실행 중인 기계의 `darwin-aarch64` 또는
// `darwin-x86_64` 키를 찾으므로(tauri-plugin-updater 의 get_urls) universal 파일 하나를 두 키에 같이 적는다.
// 플러그인은 버전 비교 전에 파일 전체를 검사하므로 항목마다 url·signature 가 다 있어야 한다.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PLATFORMS = ["darwin-aarch64", "darwin-x86_64"];

export function updaterJson({ version, url, signature, notes = "", pubDate = new Date().toISOString() }) {
  if (!SEMVER.test(version)) throw new Error(`버전이 SemVer 가 아니다: ${version}`);
  if (!/^https:\/\//.test(url)) throw new Error(`주소는 https 여야 한다(배포 빌드는 TLS 를 강제한다): ${url}`);
  if (!signature.trim()) throw new Error("서명이 비었다");
  if (Number.isNaN(Date.parse(pubDate))) throw new Error(`pub_date 가 날짜가 아니다: ${pubDate}`);
  const entry = { signature: signature.trim(), url };
  return {
    version: version.replace(/^v/, ""),
    notes,
    pub_date: pubDate,
    platforms: Object.fromEntries(PLATFORMS.map((p) => [p, entry])),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const version = opt("--version");
  const url = opt("--url");
  const sig = opt("--sig");
  const out = opt("--out");
  if (!version || !url || !sig || !out) {
    console.error("쓰는 법: node scripts/updater-json.mjs --version <버전> --url <주소> --sig <.sig 파일> [--notes <글>] [--pub-date <날짜>] --out <파일>");
    process.exit(2);
  }
  try {
    const json = updaterJson({ version, url, signature: readFileSync(sig, "utf8"), notes: opt("--notes"), pubDate: opt("--pub-date") });
    writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`${out}: ${json.version} → ${Object.keys(json.platforms).join(", ")}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
