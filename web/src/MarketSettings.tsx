import {
  APP_VERSION,
  CONTRAST_MIN,
  contrastLabel,
  displayText,
  isOfficialRepo,
  KeyedError,
  OFFICIAL_REPO_URL,
  themeContrast,
  type PackageType,
  type RepoIndexResult,
} from "@keyring-notes/core";
import { useEffect, useRef, useState } from "react";
import { askUninstallPackage } from "./askFirst";
import { languages, marketLanguageConflicts, marketPackReport, t, useLang } from "./i18n";
import { localContext } from "./local/boot";
import { readDeviceMarketSettings, writeDeviceMarketSettings } from "./market/source";
import { market } from "./market/start";
import type { InstalledPackage } from "./market/state";
import { browseRows, MARKET_KINDS, repoAdd, repoMove, repoRemove, type BrowseRow } from "./market/view";
import { clearRemovedChoice } from "./prefs";
import { themePackages, useThemePackages } from "./theme/apply";
import { themeModes, type ThemePackage } from "./theme/resolve";
import { errorText } from "./toast";
import { marketplaceSettings, updateVaultSetting, useVaultSettings } from "./vaultSettings";

/**
 * 설정 → 마켓플레이스. 설계 docs/superpowers/specs/2026-11-10-marketplace-design.md 「설치·제거·업데이트 화면」.
 * 종류는 MARKET_KINDS 로만 가른다(이 파일에 종류별 갈래를 두지 않는다 — 3단계가 위젯 줄만 바꾸면 된다).
 * 모든 조작은 단추·입력·확인란이다(끌기 없음 — 키보드·화면 읽기 프로그램).
 */

/** 3단계 진입점: openMarket(id) 가 이 값을 두고 마켓 묶음을 연다 — 둘러보기를 그 id 로 걸러 보인다 */
let focusId: string | null = null;
export function setMarketFocus(id: string | null) {
  focusId = id;
}

type Kind = "all" | PackageType;

function codeError(code: string, params: Record<string, string | number> = {}): string {
  return errorText(new KeyedError(code, params));
}

function useInstalled(): InstalledPackage[] {
  const [, bump] = useState(0);
  useEffect(() => market().onPackagesChange(() => bump((n) => n + 1)), []);
  return market().installedPackages();
}

/** 테마가 그리는 모드마다 대비 경고(낮거나 잴 수 없음) */
function contrastNotes(colors: ThemePackage["colors"] | undefined): string[] {
  if (!colors) return [];
  const p: ThemePackage = { id: "@x/x", version: "0.0.0", name: {}, colors };
  return themeModes(p).flatMap((mode) => {
    const r = themeContrast(colors, mode);
    if (r === null) return [`${t(`theme.${mode}`)}: ${t("theme.contrastUnknown")}`];
    return r < CONTRAST_MIN ? [`${t(`theme.${mode}`)}: ${t("theme.contrastLow", { ratio: contrastLabel(r) })}`] : [];
  });
}

export function MarketSettings() {
  const lang = useLang();
  useVaultSettings();
  const installed = useInstalled();
  useThemePackages();
  const settings = marketplaceSettings();
  const repos = settings?.repos ?? [];
  const lock = settings?.packages ?? {};
  const available = market().marketAvailability() === "ok";
  const [indexes, setIndexes] = useState<RepoIndexResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<Kind>("all");
  const [only, setOnly] = useState<string | null>(focusId);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [rowNote, setRowNote] = useState<Record<string, { text: string; error: boolean }[]>>({});
  const [live, setLive] = useState("");
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [device, setDevice] = useState(readDeviceMarketSettings);
  const buttons = useRef(new Map<string, HTMLButtonElement | HTMLInputElement | null>());
  const pendingFocus = useRef<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setIndexes(await market().repoIndexes({ fresh: true }));
    } finally {
      setLoading(false);
    }
  };
  // 묶음을 열 때 한 번(그리고 저장소 목록이 바뀔 때) 새로 받는다
  const reposKey = repos.join("\n");
  useEffect(() => {
    focusId = null;
    void refresh();
  }, [reposKey]);
  useEffect(() => {
    if (!pendingFocus.current) return;
    const el = buttons.current.get(pendingFocus.current);
    pendingFocus.current = null;
    el?.focus();
  });

  const rows = indexes ? browseRows(indexes, lock, APP_VERSION, lang) : [];
  const rowOf = (id: string) => rows.find((r) => r.id === id) ?? null;
  const nameOf = (p: InstalledPackage) => (p.manifest ? displayText(p.manifest.name, lang) : null) ?? p.id;
  const say = (text: string) => setLive(text);
  const note = (id: string, notes: { text: string; error: boolean }[]) => setRowNote((m) => ({ ...m, [id]: notes }));
  const run = async (id: string, label: string, fn: () => Promise<void>) => {
    setBusy((b) => ({ ...b, [id]: label }));
    try {
      await fn();
    } catch (e) {
      note(id, [{ text: errorText(e), error: true }]);
      say(errorText(e));
    } finally {
      setBusy((b) => {
        const n = { ...b };
        delete n[id];
        return n;
      });
    }
  };

  const install = (row: BrowseRow, version?: string) =>
    run(row.id, t("market.installing"), async () => {
      const p = await market().installPackage(row.id, version ? { version, repo: row.repo } : { repo: row.repo });
      const name = row.info.name ?? row.id;
      const notes = contrastNotes(p.manifest?.colors).map((text) => ({ text, error: false }));
      note(row.id, [{ text: t("market.done.installed", { name, version: p.version }), error: false }, ...notes]);
      say([t("market.done.installed", { name, version: p.version }), ...notes.map((n) => n.text)].join(" "));
    });

  const uninstall = async (p: InstalledPackage) => {
    const name = nameOf(p);
    if (!(await askUninstallPackage(name))) return;
    // 언어 패키지가 주던 언어 id(이 기기 언어팩이 가린 경우 포함) — 지운 뒤 다른 층이 주지 않으면 고르기 값을 되돌린다
    const langId = languages().find((l) => l.pkgId === p.id || l.shadows === p.id)?.id ?? null;
    await run(p.id, t("market.uninstall"), async () => {
      await market().uninstallPackage(p.id);
      if (p.type === "theme") clearRemovedChoice("theme", p.id);
      if (langId && !languages().some((l) => l.id === langId)) clearRemovedChoice("language", langId);
      say(t("market.done.uninstalled", { name }));
    });
  };

  const saveRepos = async (next: string[]) => {
    await updateVaultSetting(
      ["marketplace", "repos"],
      next.map((url) => ({ url })),
    );
  };
  const addRepo = () => {
    const r = repoAdd(repos, input);
    if ("error" in r) return setInputError(codeError(r.error, { url: input.trim() }));
    setInputError(null);
    setInput("");
    void saveRepos(r.repos).catch((e: unknown) => setInputError(errorText(e)));
  };
  const move = (i: number, delta: -1 | 1) => {
    const next = repoMove(repos, i, delta);
    const to = i + delta;
    // 초점은 옮긴 줄의 같은 단추에 — 끝에 닿아 꺼지면 반대 단추로
    const edge = (delta < 0 && to === 0) || (delta > 0 && to === repos.length - 1);
    pendingFocus.current = `repo:${repos[i]}:${edge ? (delta < 0 ? "down" : "up") : delta < 0 ? "up" : "down"}`;
    void saveRepos(next);
  };
  const remove = (i: number) => {
    const nextUrl = repos[i + 1] ?? repos[i - 1];
    pendingFocus.current = nextUrl && repos.length > 1 ? `repo:${nextUrl}:remove` : "repo-input";
    void saveRepos(repoRemove(repos, i));
  };
  const setDeviceOpt = (k: "allowHttp" | "allowPrivate", v: boolean) => {
    const next = { ...device, [k]: v };
    setDevice(next);
    writeDeviceMarketSettings(next);
    void market().reconcile();
  };

  const errorOfRepo = (url: string) => indexes?.find((r) => r.repo === url)?.error ?? null;
  const shownRows = rows.filter((r) => (kind === "all" || r.type === kind) && (!only || r.id === only));
  const kinds: Kind[] = ["all", "theme", "language", "widget"];
  const isApp = localContext?.kind === "app";

  return (
    <div className="market">
      <div className="sr-only" aria-live="polite">
        {live}
      </div>
      {!available && (
        <p className="note-ok market-unavailable" role="status">
          {t("market.unavailable")}
        </p>
      )}

      <section className="market-section" aria-labelledby="market-installed">
        <h3 id="market-installed">{t("market.installedHeading")}</h3>
        {installed.length === 0 && <p className="setting-hint">{t("market.none")}</p>}
        {installed.map((p) => {
          const name = nameOf(p);
          const row = rowOf(p.id);
          const verified = themePackages().find((x) => x.id === p.id);
          const notes: { text: string; warn?: boolean }[] = [];
          if (p.status === "error" && p.error) notes.push({ text: codeError(p.error.code, p.error.params), warn: true });
          else notes.push({ text: t(`market.status.${p.status}`), warn: p.status !== "ready" });
          for (const text of contrastNotes(verified?.colors)) notes.push({ text, warn: true });
          const report = marketPackReport(p.id);
          if (report)
            notes.push({
              text: t("market.langReport", {
                missing: report.missing.length,
                dropped: report.unknown.length + report.placeholderMismatch.length + report.notString.length,
              }),
            });
          for (const c of marketLanguageConflicts())
            if (c.ignored.includes(p.id)) notes.push({ text: t("market.langConflict", { lang: c.lang, used: c.used }), warn: true });
          for (const n of rowNote[p.id] ?? []) notes.push({ text: n.text, warn: n.error });
          return (
            <div key={p.id} className="market-row">
              <div className="market-text">
                <div className="market-name">
                  {name} <code>{p.id}</code> <span className="market-version">{p.version}</span>
                  {p.type && <span className="badge-device">{t(MARKET_KINDS[p.type].label)}</span>}
                  {row?.update && <span className="badge warn">{t("market.updateAvailable")}</span>}
                </div>
                <div className="setting-hint market-repo">{p.repo}</div>
                {notes.map((n) => (
                  <div key={n.text} className={n.warn ? "market-note warn" : "market-note"}>
                    {n.text}
                  </div>
                ))}
              </div>
              <div className="market-actions">
                {row?.update && (
                  <button
                    type="button"
                    disabled={!available || !!busy[p.id]}
                    aria-label={`${t("market.update", { version: row.update })} — ${name}`}
                    onClick={() => void install(row, row.update!)}
                  >
                    {busy[p.id] ?? t("market.update", { version: row.update })}
                  </button>
                )}
                <button type="button" disabled={!!busy[p.id]} aria-label={`${t("market.uninstall")} — ${name}`} onClick={() => void uninstall(p)}>
                  {t("market.uninstall")}
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <section className="market-section" aria-labelledby="market-browse">
        <h3 id="market-browse">{t("market.browse")}</h3>
        <div className="market-toolbar">
          <select aria-label={t("market.kind.label")} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k === "all" ? t("market.kind.all") : t(MARKET_KINDS[k].label)}
              </option>
            ))}
          </select>
          {only && (
            <button type="button" onClick={() => setOnly(null)}>
              {t("market.showAll")}
            </button>
          )}
          <button type="button" disabled={loading} onClick={() => void refresh()}>
            {loading ? t("market.loading") : t("market.refresh")}
          </button>
        </div>
        {indexes && shownRows.length === 0 && <p className="setting-hint">{t("market.noneFound")}</p>}
        {shownRows.map((r) => {
          const name = r.info.name ?? r.id;
          const kindInfo = MARKET_KINDS[r.type];
          return (
            <div key={r.id} className="market-row">
              <div className="market-text">
                <div className="market-name">
                  {name} <code>{r.id}</code> {r.version && <span className="market-version">{r.version}</span>}
                  <span className="badge-device">{t(kindInfo.label)}</span>
                </div>
                {r.info.description && <div className="market-desc">{r.info.description}</div>}
                <div className="setting-hint">
                  {(r.info.author || r.info.license) && <>{t("market.by", { author: r.info.author ?? "-", license: r.info.license ?? "-" })} · </>}
                  <span className="market-repo">{r.repoName}</span>
                </div>
                {r.alsoIn.length > 0 && <div className="market-note">{t("market.alsoIn", { repos: r.alsoIn.join(", ") })}</div>}
                {r.incompatible && <div className="market-note warn">{t("market.incompatible", { range: r.incompatible.range })}</div>}
                {!kindInfo.installable && <div className="market-note">{t("market.widgetLater")}</div>}
                {!r.installed &&
                  (rowNote[r.id] ?? []).map((n) => (
                    <div key={n.text} className={n.error ? "market-note warn" : "market-note"}>
                      {n.text}
                    </div>
                  ))}
              </div>
              <div className="market-actions">
                {r.installed ? (
                  <button type="button" disabled>
                    {t("market.installed")}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!available || !kindInfo.installable || !r.version || !!busy[r.id]}
                    aria-label={`${t("market.install")} — ${name} (${r.repoName})`}
                    onClick={() => void install(r)}
                  >
                    {busy[r.id] ?? t("market.install")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section className="market-section" aria-labelledby="market-repos">
        <h3 id="market-repos">{t("market.repos")}</h3>
        {repos.map((url, i) => {
          const err = errorOfRepo(url);
          return (
            <div key={url} className="market-row">
              <div className="market-text">
                <div className="market-url">
                  {url}
                  {isOfficialRepo(url) && <span className="badge-shared">{t("market.repoOfficial")}</span>}
                </div>
                {err && <div className="market-note warn">{t("market.repoError", { error: codeError(err.code, err.params) })}</div>}
              </div>
              <div className="market-actions">
                <button
                  type="button"
                  ref={(el) => void buttons.current.set(`repo:${url}:up`, el)}
                  disabled={i === 0}
                  aria-label={`${t("market.repoUp")} — ${url}`}
                  onClick={() => move(i, -1)}
                >
                  {t("market.repoUp")}
                </button>
                <button
                  type="button"
                  ref={(el) => void buttons.current.set(`repo:${url}:down`, el)}
                  disabled={i === repos.length - 1}
                  aria-label={`${t("market.repoDown")} — ${url}`}
                  onClick={() => move(i, 1)}
                >
                  {t("market.repoDown")}
                </button>
                <button
                  type="button"
                  ref={(el) => void buttons.current.set(`repo:${url}:remove`, el)}
                  aria-label={`${t("market.repoRemove")} — ${url}`}
                  onClick={() => remove(i)}
                >
                  {t("market.repoRemove")}
                </button>
              </div>
            </div>
          );
        })}
        <form
          className="market-add"
          onSubmit={(e) => {
            e.preventDefault();
            addRepo();
          }}
        >
          <input
            ref={(el) => void buttons.current.set("repo-input", el)}
            aria-label={t("market.repoAdd")}
            placeholder="https://…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-invalid={!!inputError}
            aria-describedby={inputError ? "market-repo-error" : undefined}
          />
          <button type="submit">{t("market.repoAddRun")}</button>
        </form>
        {inputError && (
          <p id="market-repo-error" className="market-note warn" role="alert">
            {inputError}
          </p>
        )}
        {!repos.some((r) => r === OFFICIAL_REPO_URL) && (
          <button type="button" onClick={() => void saveRepos([OFFICIAL_REPO_URL, ...repos])}>
            {t("market.repoReaddOfficial")}
          </button>
        )}
      </section>

      {isApp && (
        <section className="market-section" aria-labelledby="market-device">
          <h3 id="market-device">{t("market.device")}</h3>
          <label className="market-check">
            <input type="checkbox" checked={device.allowHttp} onChange={(e) => setDeviceOpt("allowHttp", e.target.checked)} />
            {t("market.deviceAllowHttp")}
          </label>
          <label className="market-check">
            <input type="checkbox" checked={device.allowPrivate} onChange={(e) => setDeviceOpt("allowPrivate", e.target.checked)} />
            {t("market.deviceAllowPrivate")}
          </label>
        </section>
      )}
    </div>
  );
}
