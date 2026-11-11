import { checkWidgetMessages, KeyedError, MANIFEST_FILE, PACKAGE_ID_RE, parseManifest, type LockEntry, type PackageManifest } from "@keyring-notes/core";
import type { InstalledPackage, MarketState } from "../market/state";
import {
  notifyWidgetsChanged as notifyDefault,
  setMarketWidgets as setDefault,
  setMissingWidgetResolver as resolverDefault,
  type FrameWidgetEntry,
  type MissingWidget,
  type WidgetMessageTable,
} from "./registry";

/**
 * 마켓 위젯 적용자: 받은 위젯 패키지를 레지스트리의 iframe 위젯(builtIn: false)으로. 잠금이 원천이다 —
 * 패키지마다 그 순간의 잠금 항목을 붙잡아 그것으로 매니페스트·메시지를 읽고, frame() 도 같은 항목으로 읽는다(잠금이 바뀌었으면 market_stale).
 * 정본은 docs/superpowers/plans/2026-11-10-marketplace-phase3.md 「받은 위젯이 레지스트리에 들어오는 순간」.
 */

type Failure = { code: string; params: Record<string, string | number> };

/** 같은 객체로 둘 판정 키: id@판 + 정렬한 path=sha(같은 판인데 sha 가 바뀐 잠금이면 다른 키) */
export function entryPkgKey(id: string, entry: LockEntry): string {
  const sha = Object.keys(entry.sha256)
    .sort()
    .map((p) => `${p}=${entry.sha256[p]}`)
    .join(",");
  return `${id}@${entry.version}#${sha}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** 순수: 매니페스트·메시지 → 레지스트리 항목. read 는 붙잡은 잠금 항목으로 글을 읽는 함수 */
export function widgetEntryFromPackage(
  manifest: PackageManifest,
  messages: WidgetMessageTable,
  read: (path: string) => Promise<string>,
  hasCss: boolean,
  pkgKey: string,
): FrameWidgetEntry {
  const w = manifest.widget!;
  const initial = w.dataFile?.initial;
  return {
    def: {
      id: manifest.id,
      version: w.stateVersion,
      isolation: "frame",
      display: w.display,
      title: { ...manifest.name },
      // file 은 앱의 예약 키 — 데이터 파일 위젯은 insertDataFileWidget 이 넣고, 그 밖의 위젯은 블록에 첨부 링크가 생기지 않게 뺀다
      defaultState: () => {
        const c = structuredClone(w.defaultState);
        if (isRecord(c)) delete c.file;
        return c;
      },
      ...(w.dataFile && {
        dataFile: {
          ext: `.${w.dataFile.ext}`,
          initial: () => new TextEncoder().encode(initial!),
          ...(w.dataFile.name && { name: w.dataFile.name }),
        },
      }),
    },
    builtIn: false,
    messages,
    pkgKey,
    frame: async () => {
      const js = await read("frame.js");
      return hasCss ? { kind: "text", js, css: await read("frame.css") } : { kind: "text", js };
    },
  };
}

/** 등록되지 않은 id 의 까닭(계획 「등록되지 않은 id 의 판정」 순서) */
export function missingWidget(
  id: string,
  m: Pick<MarketState, "installedPackages" | "ready">,
  s: { applying: boolean; failures: ReadonlyMap<string, Failure> },
): MissingWidget {
  // 내장 꼴 — 받을 수 있는 것이 아니다(새 앱 판의 내장일 수 있다)
  if (!PACKAGE_ID_RE.test(id)) return { kind: "notFound", install: false };
  if (!m.ready()) return { kind: "pending" };
  const p = m.installedPackages().find((x) => x.id === id);
  if (!p) return { kind: "notFound", install: true };
  if (p.type !== null && p.type !== "widget") return { kind: "notFound", install: false };
  switch (p.status) {
    case "incompatible":
      return { kind: "incompatible" };
    case "error":
      return { kind: "failed", error: p.error ?? { code: "market_fetch_failed", params: {} } };
    case "fetching":
      return { kind: "pending" };
    case "ready": {
      const f = s.failures.get(id);
      // 적용 중이거나 있어서는 안 되는 틈 — 「설치」 를 잠깐 보이지 않게 준비 중으로
      return f && !s.applying ? { kind: "failed", error: f } : { kind: "pending" };
    }
  }
}

function failureOf(e: unknown): Failure {
  if (e instanceof KeyedError) return { code: e.code, params: e.params as Record<string, string | number> };
  const c = (e as { code?: unknown } | null)?.code;
  if (typeof c === "string") return { code: c, params: ((e as { params?: unknown }).params as Record<string, string | number>) ?? {} };
  return { code: "market_manifest_invalid", params: { reason: "read" } };
}

export function registerWidgetKind(
  m: MarketState,
  deps: {
    setMarketWidgets(list: FrameWidgetEntry[]): void;
    setMissingWidgetResolver(fn: ((id: string) => MissingWidget) | null): void;
    notifyWidgetsChanged(): void;
  } = { setMarketWidgets: setDefault, setMissingWidgetResolver: resolverDefault, notifyWidgetsChanged: notifyDefault },
): () => void {
  let applying = false;
  let failures = new Map<string, Failure>();
  let last = new Map<string, FrameWidgetEntry>();
  let gen = 0;
  deps.setMissingWidgetResolver((id) => missingWidget(id, m, { applying, failures }));

  const build = async (p: InstalledPackage): Promise<FrameWidgetEntry> => {
    const entry = m.lockEntry(p.id);
    if (!entry) throw new KeyedError("market_not_found", { id: p.id });
    const key = entryPkgKey(p.id, entry);
    const reuse = last.get(key);
    if (reuse) return reuse;
    const read = (path: string) => m.readPackageTextAt(p.id, entry, path);
    let manifest: PackageManifest;
    try {
      manifest = parseManifest(JSON.parse(await read(MANIFEST_FILE)));
    } catch (e) {
      if (e instanceof SyntaxError) throw new KeyedError("market_manifest_invalid", { reason: "json" });
      throw e;
    }
    if (manifest.type !== "widget" || !manifest.widget) throw new KeyedError("market_manifest_invalid", { reason: "type" });
    if (manifest.id !== p.id) throw new KeyedError("market_manifest_invalid", { reason: "id" });
    const messages: WidgetMessageTable = {};
    for (const path of Object.keys(entry.sha256)) {
      const lang = /^messages\/(.+)\.json$/.exec(path)?.[1];
      if (!lang) continue;
      try {
        const r = checkWidgetMessages(JSON.parse(await read(path)));
        // 객체가 아닌 파일은 그 언어만 뺀다
        if (r) messages[lang] = r.messages;
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
      }
    }
    return widgetEntryFromPackage(manifest, messages, read, "frame.css" in entry.sha256, key);
  };

  const offKind = m.registerPackageKind("widget", {
    async apply(pkgs) {
      // 첫 맞추기 전 — 판정기가 pending 으로 답한다
      if (!m.ready()) return;
      const my = ++gen;
      applying = true;
      deps.notifyWidgetsChanged();
      const list: FrameWidgetEntry[] = [];
      const nextFailures = new Map<string, Failure>();
      for (const p of pkgs) {
        try {
          list.push(await build(p));
        } catch (e) {
          nextFailures.set(p.id, failureOf(e));
        }
      }
      // 겹친 apply 는 마지막 것만 결과를 쓴다
      if (my !== gen) return;
      failures = nextFailures;
      last = new Map(list.map((e) => [e.pkgKey!, e]));
      try {
        deps.setMarketWidgets(list);
      } catch (e) {
        console.warn("market widgets:", e);
      }
      applying = false;
      deps.notifyWidgetsChanged();
    },
  });
  // 상태만 바뀐 것(error·incompatible)도 그려진 블록이 다시 판정하게
  const offChange = m.onPackagesChange(() => deps.notifyWidgetsChanged());
  return () => {
    offKind();
    offChange();
    deps.setMissingWidgetResolver(null);
  };
}
