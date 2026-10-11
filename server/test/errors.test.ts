import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import { parseCron } from "../src/automation.js";
import { serverLanguage, setServerLanguage } from "../src/lang.js";
import { PathError } from "../src/paths.js";
import { openVault, tempDir } from "./helpers.js";

const json = { "content-type": "application/json" };

let cleanup: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let cookie = "";
const initialLang = serverLanguage();

beforeEach(async () => {
  const t = await tempDir("keyring-errors-");
  cleanup = t.cleanup;
  const { vault, index, wiki, ingestor } = await openVault(path.join(t.dir, "vault"));
  const config = new ConfigStore(path.join(t.dir, "config", "keyring.json"));
  config.setPassword("correct horse");
  app = createApp({
    vault,
    index,
    config,
    wiki,
    ingestor,
    admin: { backups: new BackupService(vault, config, path.join(vault.root, ".keyring", "backups"), () => wiki.resync()) },
  });
  const res = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse" }) });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
});

afterEach(async () => {
  setServerLanguage(initialLang);
  await cleanup();
});

describe("오류 응답: code·params", () => {
  it("틀린 비밀번호는 401 unauthorized와 wrong_password 코드", async () => {
    const res = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password: "nope" }) });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized", code: "wrong_password", params: {} });
  });

  it("없는 문서는 404 not_found와 doc_missing·path", async () => {
    const res = await app.request(`/api/file?path=${encodeURIComponent("없음.md")}`, { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found", code: "doc_missing", params: { path: "없음.md" } });
  });

  it("잘못된 요청은 400 bad_request와 코드", async () => {
    const res = await app.request("/api/file", { method: "PUT", headers: { ...json, cookie }, body: JSON.stringify({ path: "a.md", baseHash: null }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "bad_request", code: "field_required", params: { field: "content" } });
  });

  it("JSON이 아닌 변경 요청은 415 json_required", async () => {
    const res = await app.request("/api/file", { method: "PUT", headers: { cookie, "content-type": "text/plain" }, body: "x" });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: "bad_request", code: "json_required" });
  });

  it("message는 서버 언어를 따른다", async () => {
    const get = () => app.request(`/api/file?path=${encodeURIComponent("없음.md")}`, { headers: { cookie } });
    setServerLanguage("en");
    expect((await (await get()).json()).message).toBe("No such note: 없음.md");
    setServerLanguage("ko");
    expect((await (await get()).json()).message).toBe("문서가 없습니다: 없음.md");
    setServerLanguage("en");
    const login = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password: "nope" }) });
    expect((await login.json()).message).toBe("Wrong password");
  });

  it("던진 오류도 코드와 서버 언어의 글을 가진다", () => {
    setServerLanguage("en");
    expect(() => parseCron("* * * *")).toThrow(PathError);
    let err: unknown;
    try {
      parseCron("61 * * * *");
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: "cron_range", params: { position: 1, min: 0, max: 59, part: "61" } });
    expect((err as Error).message).toBe("Cron field 1 must be within 0–59: 61");
  });
});
