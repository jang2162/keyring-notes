#!/usr/bin/env node
// 업데이트 파일의 서명(.sig)을 앱에 들어가는 공개 키로 검증한다. 릴리스 워크플로가 올리기 전에 돌린다.
//   node scripts/verify-updater-sig.mjs <파일> <파일.sig> [--pubkey <base64> | --config <tauri.conf.json>] [--version <버전>]
// 공개 키를 주지 않으면 app/src-tauri/tauri.conf.json 의 plugins.updater.pubkey 를 쓴다.
//
// 왜 따로 검사하는가: 업데이트 서명 비밀 키(CI 비밀)와 앱에 박힌 공개 키가 짝이 아니어도 빌드는 성공한다.
// 그 릴리스를 받은 기존 사용자는 서명 검증에서 업데이트가 조용히 실패한다. 형식은 minisign 이고
// 앱 쪽 검증(tauri-plugin-updater 의 verify_signature)과 같은 것을 본다: 파일 서명(ED 면 BLAKE2b-512 로 먼저 줄인다)과
// 신뢰 주석(trusted comment)을 덮는 전체 서명, 키 ID.
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg) => {
  console.error(`업데이트 서명 검증 실패: ${msg}`);
  process.exit(1);
};

/** minisign 공개 키: base64(글) → 둘째 줄 base64 → "Ed" + 키 ID 8 + 공개 키 32 */
function parsePublicKey(b64) {
  let text;
  try {
    text = Buffer.from(b64.trim(), "base64").toString("utf8");
  } catch {
    fail("공개 키가 base64 가 아니다");
  }
  const line = text.split("\n").find((l) => l.trim() && !l.startsWith("untrusted comment:"));
  const raw = line ? Buffer.from(line.trim(), "base64") : Buffer.alloc(0);
  if (raw.length !== 42 || raw.subarray(0, 2).toString() !== "Ed") {
    fail(
      "공개 키 형식이 아니다 — tauri.conf.json 의 plugins.updater.pubkey 에 `tauri signer generate` 가 만든 .pub 파일 내용을 넣는다(docs/guides/release-macos.md)",
    );
  }
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw.subarray(10)]);
  return { keyId: raw.subarray(2, 10), key: createPublicKey({ key: der, format: "der", type: "spki" }) };
}

/** minisign 서명: base64(글) → [untrusted comment, 서명, trusted comment, 전체 서명] */
function parseSignature(b64) {
  const lines = Buffer.from(b64.trim(), "base64").toString("utf8").split("\n");
  const sig = Buffer.from(lines[1] ?? "", "base64");
  const trusted = lines[2]?.startsWith("trusted comment: ") ? lines[2].slice("trusted comment: ".length) : null;
  const global = Buffer.from(lines[3] ?? "", "base64");
  if (sig.length !== 74 || trusted === null || global.length !== 64) fail("서명 파일 형식이 아니다(.sig 파일 내용 그대로여야 한다)");
  const alg = sig.subarray(0, 2).toString();
  if (alg !== "Ed" && alg !== "ED") fail(`모르는 서명 방식 ${alg}`);
  return { alg, keyId: sig.subarray(2, 10), sig: sig.subarray(10), trusted, global };
}

export function verifyUpdaterSignature(data, sigB64, pubkeyB64) {
  const pk = parsePublicKey(pubkeyB64);
  const s = parseSignature(sigB64);
  if (!pk.keyId.equals(s.keyId)) {
    fail(
      `키 ID 가 다르다 — 서명 ${Buffer.from(s.keyId).reverse().toString("hex").toUpperCase()}, 공개 키 ${Buffer.from(pk.keyId).reverse().toString("hex").toUpperCase()}. CI 의 TAURI_SIGNING_PRIVATE_KEY 와 tauri.conf.json 의 pubkey 가 짝이 아니다`,
    );
  }
  const msg = s.alg === "ED" ? createHash("blake2b512").update(data).digest() : data;
  if (!verify(null, msg, pk.key, s.sig)) fail("파일 서명이 맞지 않는다(파일이 바뀌었거나 다른 키로 서명했다)");
  if (!verify(null, Buffer.concat([s.sig, Buffer.from(s.trusted, "utf8")]), pk.key, s.global)) fail("신뢰 주석 서명이 맞지 않는다");
  return {
    trusted: s.trusted,
    version:
      s.trusted
        .split("\t")
        .find((f) => f.startsWith("version:"))
        ?.slice("version:".length) ?? null,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  let pubkey = opt("--pubkey");
  const config = opt("--config") ?? path.join(root, "app/src-tauri/tauri.conf.json");
  const version = opt("--version");
  const [file, sigFile] = args;
  if (!file || !sigFile) {
    console.error("쓰는 법: node scripts/verify-updater-sig.mjs <파일> <파일.sig> [--pubkey <base64> | --config <tauri.conf.json>] [--version <버전>]");
    process.exit(2);
  }
  pubkey ??= JSON.parse(readFileSync(config, "utf8")).plugins?.updater?.pubkey ?? "";
  const r = verifyUpdaterSignature(readFileSync(file), readFileSync(sigFile, "utf8"), pubkey);
  // 신뢰 주석의 버전은 CLI 가 적을 때만 있다(앱의 requireSignedVersion 이 이것을 본다)
  if (version && r.version !== null && r.version.replace(/^v/, "") !== version.replace(/^v/, "")) fail(`서명에 적힌 버전 ${r.version} 이 ${version} 과 다르다`);
  console.log(`서명 확인: ${path.basename(file)} (trusted comment: ${r.trusted})`);
}
