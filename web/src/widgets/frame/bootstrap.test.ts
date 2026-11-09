import { WIDGET_FRAME_SCRIPT_HASH } from "@keyring-notes/core";
import { describe, expect, it } from "vitest";
import conf from "../../../../app/src-tauri/tauri.conf.json?raw";
import { FRAME_BOOTSTRAP, FRAME_META_CSP, frameSrcdoc } from "./bootstrap";

async function hashOf(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return `'sha256-${btoa(String.fromCharCode(...digest))}'`;
}

function directives(csp: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of csp.split(";")) {
    const [name, ...rest] = part.trim().split(/\s+/);
    if (name) out.set(name, rest.join(" "));
  }
  return out;
}

describe("iframe 부트스트랩과 CSP 해시", () => {
  it("부트스트랩 글의 해시가 core 상수와 같다", async () => {
    const actual = await hashOf(FRAME_BOOTSTRAP);
    expect(WIDGET_FRAME_SCRIPT_HASH, `부트스트랩이 바뀌었다 — 새 해시를 core widgetFrame.ts 와 tauri.conf.json 에 넣는다: ${actual}`).toBe(actual);
  });

  it("데스크톱 앱 CSP 의 script-src 에 'self'·해시·blob:, 다른 지시어는 그대로", () => {
    const d = directives(JSON.parse(conf).app.security.csp);
    const script = d.get("script-src")!.split(" ");
    expect(script).toContain("'self'");
    expect(script).toContain(WIDGET_FRAME_SCRIPT_HASH);
    expect(script).toContain("blob:");
    d.delete("script-src");
    expect(Object.fromEntries(d)).toEqual({
      "default-src": "'self' ipc: http://ipc.localhost",
      "style-src": "'self' 'unsafe-inline'",
      "img-src": "'self' asset: http://asset.localhost data: blob: https:",
      "connect-src": "'self' ipc: http://ipc.localhost",
      "font-src": "'self' data:",
      "object-src": "'none'",
      "base-uri": "'none'",
    });
  });

  it("srcdoc 은 meta CSP 와 부트스트랩 스크립트 하나만", () => {
    expect(FRAME_META_CSP).toBe(
      `default-src 'none'; script-src ${WIDGET_FRAME_SCRIPT_HASH} blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`,
    );
    const doc = frameSrcdoc();
    expect(doc).toBe(
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${FRAME_META_CSP}"><script>${FRAME_BOOTSTRAP}</script></head><body></body></html>`,
    );
    expect(doc.match(/<script/g)).toHaveLength(1);
  });

  it("부트스트랩은 즉시 실행 함수이고 최상위 창에서는 아무것도 하지 않는다", () => {
    expect(FRAME_BOOTSTRAP.startsWith("(function")).toBe(true);
    expect(FRAME_BOOTSTRAP).toContain("window.parent === window");
    // srcdoc 안 <script> 를 끝내거나 meta 속성을 깨는 글자가 없어야 해시 그대로 실린다
    expect(FRAME_BOOTSTRAP).not.toMatch(/<\/script/i);
  });
});
