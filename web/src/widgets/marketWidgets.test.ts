import { parseManifest, parseMarketplace, type LockEntry, type MarketplaceSettings, type RepoIndexResult } from "@keyring-notes/core";
import { describe, expect, it, vi } from "vitest";
import { memoryPackageCache } from "../market/cache";
import type { PackageSource } from "../market/source";
import { createMarketState, type InstalledPackage, type MarketState } from "../market/state";
import { entryPkgKey, missingWidget, registerWidgetKind, widgetEntryFromPackage } from "./marketWidgets";
import type { FrameWidgetEntry, MissingWidget } from "./registry";

const raw = import.meta.glob("../../../server/test/fixtures/market/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const PREFIX = "../../../server/test/fixtures/market/";
const index = JSON.parse(raw[`${PREFIX}index.json`]!);
const REPO = "https://repo.test/m/";
const enc = (s: string) => new TextEncoder().encode(s);
const file = (id: string, v: string, p: string) => raw[`${PREFIX}packages/${id.slice(1)}/${v}/${p}`]!;

function lockOf(id: string, version: string): LockEntry {
  const files = index.packages[id].versions[version].files as { path: string; sha256: string }[];
  return { version, repo: REPO, sha256: Object.fromEntries(files.map((f) => [f.path, f.sha256])) };
}

/** 픽스처를 내주는 받는 쪽. over 로 파일 하나를 바꿔 낸다(sha 가 어긋나게) */
function source(over: Record<string, string> = {}): PackageSource {
  return {
    index: async (repo) => ({ repo, index, ignored: [] }) as RepoIndexResult,
    fetch: async (id, entry) => new Map(Object.keys(entry.sha256).map((p) => [p, enc(over[`${id}@${entry.version}/${p}`] ?? file(id, entry.version, p))])),
  };
}

function setup(packages: Record<string, unknown>, opts: { source?: PackageSource; appVersion?: string } = {}) {
  let settings: MarketplaceSettings | null = parseMarketplace({ repos: [REPO], packages });
  const listeners = new Set<() => void>();
  const state = createMarketState({
    source: () => opts.source ?? source(),
    cache: memoryPackageCache(),
    settings: () => settings,
    onSettings: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    writeLock: async () => {},
    appVersion: opts.appVersion ?? "0.12.0",
  });
  const lists: FrameWidgetEntry[][] = [];
  let resolver: ((id: string) => MissingWidget) | null = null;
  const notified = vi.fn();
  const deps = {
    setMarketWidgets: (l: FrameWidgetEntry[]) => void lists.push(l),
    setMissingWidgetResolver: (fn: ((id: string) => MissingWidget) | null) => void (resolver = fn),
    notifyWidgetsChanged: notified,
  };
  return {
    state,
    deps,
    lists,
    notified,
    missing: (id: string) => resolver!(id),
    setLock: (p: Record<string, unknown>) => {
      settings = parseMarketplace({ repos: [REPO], packages: p });
      for (const l of listeners) l();
    },
  };
}

const settle = async (m: MarketState) => {
  await m.reconcile();
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("widgetEntryFromPackage", () => {
  const read = (id: string, v: string) => async (p: string) => file(id, v, p);

  it("받은 위젯 항목: frame 고정, 상태 판, 코드는 처음 쓸 때 읽음", async () => {
    const man = parseManifest(JSON.parse(file("@me/counter", "2.0.0", "keyring-package.json")));
    const e = widgetEntryFromPackage(man, { en: { plus: "+1" } }, read("@me/counter", "2.0.0"), false, "K");
    expect(e.def).toMatchObject({ id: "@me/counter", version: 2, isolation: "frame", display: "block" });
    expect(e.builtIn).toBe(false);
    expect(e.pkgKey).toBe("K");
    expect(await e.frame()).toEqual({ kind: "text", js: file("@me/counter", "2.0.0", "frame.js") });
    const a = e.def.defaultState();
    expect(a).toEqual({ count: 0 });
    expect(e.def.defaultState()).not.toBe(a);
  });

  it("데이터 파일: 확장자 앞에 점, initial 은 UTF-8 바이트, frame.css 가 있으면 css", async () => {
    const man = parseManifest(JSON.parse(file("@me/sketch", "1.0.0", "keyring-package.json")));
    const e = widgetEntryFromPackage(man, {}, async (p) => (p === "frame.css" ? "x{}" : "js"), true, "K");
    expect(e.def.dataFile!.ext).toBe(".sketch");
    expect(new TextDecoder().decode(e.def.dataFile!.initial())).toBe('{"lines":[]}');
    expect(e.def.dataFile!.name).toEqual({ en: "sketch", ko: "스케치" });
    expect(await e.frame()).toEqual({ kind: "text", js: "js", css: "x{}" });
  });

  it("defaultState 의 file 키는 뺀다, 이름은 글자 그대로", () => {
    const man = parseManifest({
      ...JSON.parse(file("@me/counter", "2.0.0", "keyring-package.json")),
      name: { en: "<b>C</b>" },
      widget: { stateVersion: 1, display: "block", defaultState: { count: 0, file: "x/y.json" } },
    });
    const e = widgetEntryFromPackage(man, {}, async () => "", false, "K");
    expect(e.def.defaultState()).toEqual({ count: 0 });
    expect(e.def.title.en).toBe("<b>C</b>");
  });
});

describe("registerWidgetKind", () => {
  it("ready 거짓이면 등록하지 않고, 첫 맞추기 뒤 레지스트리에", async () => {
    const t = setup({ "@me/counter": lockOf("@me/counter", "2.0.0") });
    registerWidgetKind(t.state, t.deps);
    await Promise.resolve();
    expect(t.lists).toEqual([]);
    expect(t.missing("@me/counter")).toEqual({ kind: "pending" });
    await settle(t.state);
    expect(t.lists.at(-1)!.map((e) => e.def.id)).toEqual(["@me/counter"]);
    expect(t.lists.at(-1)![0]!.messages).toMatchObject({ en: { plus: "+1" }, ko: { plus: "+1" } });
  });

  it("같은 잠금이면 같은 객체, 판이 바뀌면 새 객체, 옛 항목의 frame() 은 market_stale", async () => {
    const t = setup({ "@me/counter": lockOf("@me/counter", "1.0.0") });
    registerWidgetKind(t.state, t.deps);
    await settle(t.state);
    const first = t.lists.at(-1)![0]!;
    await settle(t.state);
    expect(t.lists.at(-1)![0]).toBe(first);
    t.setLock({ "@me/counter": lockOf("@me/counter", "2.0.0") });
    await settle(t.state);
    const second = t.lists.at(-1)![0]!;
    expect(second).not.toBe(first);
    expect(second.def.version).toBe(2);
    await expect(first.frame()).rejects.toMatchObject({ code: "market_stale" });
    expect((await second.frame()).js).toContain("migrate");
  });

  it("같은 판인데 sha 가 바뀌면 새 객체", () => {
    const a = lockOf("@me/counter", "1.0.0");
    const b = { ...a, sha256: { ...a.sha256, "frame.js": "0".repeat(64) } };
    expect(entryPkgKey("@me/counter", a)).not.toBe(entryPkgKey("@me/counter", b));
    expect(entryPkgKey("@me/counter", a)).toBe(entryPkgKey("@me/counter", { ...a, sha256: Object.fromEntries(Object.entries(a.sha256).reverse()) }));
    expect(entryPkgKey("@me/counter", a).startsWith("@me/counter@1.0.0#")).toBe(true);
  });

  it("상한 sha·매니페스트 id 다름·종류가 테마·파싱 실패 → 빠지고 failed 와 그 코드", async () => {
    const counter = JSON.parse(file("@me/counter", "1.0.0", "keyring-package.json"));
    const variants: [string, Record<string, string>, string][] = [
      ["id", { "@me/counter@1.0.0/keyring-package.json": JSON.stringify({ ...counter, id: "@me/other" }) }, "market_manifest_invalid"],
      ["parse", { "@me/counter@1.0.0/keyring-package.json": "{" }, "market_manifest_invalid"],
    ];
    for (const [label, over, code] of variants) {
      // 받은 바이트가 index 의 sha 와 다르면 1단계가 받지 않으므로, 잠금의 sha 를 그 바이트로 맞춘다
      const entry = lockOf("@me/counter", "1.0.0");
      const bytes = enc(over["@me/counter@1.0.0/keyring-package.json"]!);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
      const t = setup({ "@me/counter": { ...entry, sha256: { ...entry.sha256, "keyring-package.json": digest } } }, { source: source(over) });
      registerWidgetKind(t.state, t.deps);
      await settle(t.state);
      expect(t.lists.at(-1) ?? [], label).toEqual([]);
      const m = t.missing("@me/counter");
      // 매니페스트를 읽지 못한 판은 1단계가 이미 오류로 둔다 — 어느 쪽이든 「받지 못함」 과 그 코드
      expect(m, label).toMatchObject({ kind: "failed", error: { code } });
    }
  });

  it("캐시가 상하면(market_hash_mismatch) 1단계가 error 로 바꾸고 failed", async () => {
    const t = setup({ "@me/counter": lockOf("@me/counter", "1.0.0") });
    const real = t.state.readPackageTextAt.bind(t.state);
    const m = {
      ...t.state,
      readPackageTextAt: async (id: string, e: LockEntry, p: string) => {
        if (p === "keyring-package.json") throw Object.assign(new Error("x"), { code: "market_hash_mismatch", params: { path: p } });
        return real(id, e, p);
      },
    } as MarketState;
    registerWidgetKind(m, t.deps);
    await settle(t.state);
    expect(t.lists.at(-1)).toEqual([]);
    expect(t.missing("@me/counter")).toMatchObject({ kind: "failed", error: { code: "market_hash_mismatch" } });
  });

  it("메시지 파일 하나가 객체가 아니면 그 언어만 빠진다", async () => {
    const t = setup({ "@me/counter": lockOf("@me/counter", "1.0.0") });
    const real = t.state.readPackageTextAt.bind(t.state);
    const m = {
      ...t.state,
      readPackageTextAt: async (id: string, e: LockEntry, p: string) => (p === "messages/ko.json" ? "[1]" : real(id, e, p)),
    } as MarketState;
    registerWidgetKind(m, t.deps);
    await settle(t.state);
    expect(Object.keys(t.lists.at(-1)![0]!.messages)).toEqual(["en"]);
  });

  it("읽는 동안은 pending(「설치」 가 아님), 겹친 apply 는 뒤 것만 쓴다", async () => {
    const t = setup({ "@me/counter": lockOf("@me/counter", "1.0.0") });
    await t.state.reconcile();
    const real = t.state.readPackageTextAt.bind(t.state);
    let release!: () => void;
    let gate = new Promise<void>((r) => (release = r));
    let applier!: { apply(p: InstalledPackage[]): void | Promise<void> };
    const m = {
      ...t.state,
      registerPackageKind: (_t: string, a: typeof applier) => ((applier = a), () => {}),
      readPackageTextAt: async (id: string, e: LockEntry, p: string) => (await gate, real(id, e, p)),
    } as MarketState;
    registerWidgetKind(m, t.deps);
    const pkgs = t.state.installedPackages();
    const one = applier.apply(pkgs);
    expect(t.missing("@me/counter")).toEqual({ kind: "pending" });
    const two = applier.apply(pkgs);
    release();
    await Promise.all([one, two]);
    expect(t.lists).toHaveLength(1);
    expect(t.lists[0]!.map((e) => e.def.id)).toEqual(["@me/counter"]);
    gate = Promise.resolve();
  });
});

describe("missingWidget", () => {
  const pkg = (o: Partial<InstalledPackage>): InstalledPackage => ({
    id: "@me/x",
    type: "widget",
    version: "1.0.0",
    repo: REPO,
    manifest: null,
    status: "ready",
    ...o,
  });
  const m = (ready: boolean, list: InstalledPackage[]) => ({ ready: () => ready, installedPackages: () => list });
  const s = { applying: false, failures: new Map<string, { code: string; params: Record<string, string | number> }>() };

  it("판정 순서", () => {
    expect(missingWidget("keyring/x", m(true, []), s)).toEqual({ kind: "notFound", install: false });
    expect(missingWidget("@me/x", m(false, []), s)).toEqual({ kind: "pending" });
    expect(missingWidget("@me/x", m(true, [pkg({ status: "incompatible" })]), s)).toEqual({ kind: "incompatible" });
    expect(
      missingWidget("@me/x", m(true, [pkg({ status: "error", type: null, error: { code: "market_scope_reserved", params: { id: "@me/x" } } })]), s),
    ).toEqual({
      kind: "failed",
      error: { code: "market_scope_reserved", params: { id: "@me/x" } },
    });
    expect(missingWidget("@me/x", m(true, []), s)).toEqual({ kind: "notFound", install: true });
    expect(missingWidget("@me/x", m(true, [pkg({ type: "theme" })]), s)).toEqual({ kind: "notFound", install: false });
    expect(missingWidget("@me/x", m(true, [pkg({ status: "fetching" })]), s)).toEqual({ kind: "pending" });
    expect(missingWidget("@me/x", m(true, [pkg({})]), { applying: true, failures: s.failures })).toEqual({ kind: "pending" });
    expect(missingWidget("@me/x", m(true, [pkg({})]), { applying: false, failures: new Map([["@me/x", { code: "market_stale", params: {} }]]) })).toEqual({
      kind: "failed",
      error: { code: "market_stale", params: {} },
    });
    expect(missingWidget("@me/x", m(true, [pkg({})]), s)).toEqual({ kind: "pending" });
  });

  it("engines 가 안 맞는 잠금은 incompatible(실물 상태)", async () => {
    const t = setup({ "@me/counter": lockOf("@me/counter", "1.0.0") }, { appVersion: "0.0.1" });
    registerWidgetKind(t.state, t.deps);
    await settle(t.state);
    expect(t.missing("@me/counter")).toEqual({ kind: "incompatible" });
  });
});
