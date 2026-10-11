import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addPdfAnnotation,
  cleanPdfQuote,
  newPdfAnnotationId,
  parseFrontmatter,
  pdfAnnotations,
  pdfCompanionPath,
  removePdfAnnotation,
  resolveLink,
  setFrontmatterField,
  translate,
  type PdfAnnotation,
} from "@keyring-notes/core";
import { api, ApiError } from "./api";
import { t } from "./i18n";
import type { LinkResolver } from "./markdown";
import { errorText } from "./toast";
import { vaultLang } from "./vaultSettings";
import { tipProps } from "./Tooltip";
import type { PDFDocumentProxy } from "./render/pdf";

/**
 * PDF 보기와 주석. 글을 고르고 "주석 남기기"를 누르면 이 PDF의 짝 노트(마크다운)에 한 줄을 더한다.
 * 짝 노트: 수집한 원본 노트(…/raw/x.md ↔ …/raw/assets/x.pdf), 없으면 PDF를 연 문서, 그것도 없으면 PDF 옆에 새로 만든다.
 * 남긴 주석은 블록 ID가 있어 위키 페이지의 sources에 `[[짝 노트#^id]]`로 넣으면 그 부분을 출처로 가리킨다.
 */

export interface OpenDocRef {
  path: string;
  draft: string;
}

interface Props {
  path: string;
  page?: number;
  /** PDF를 연 문서(지금 편집 중인 것) */
  from: OpenDocRef | null;
  resolver: LinkResolver;
  onClose: () => void;
  /** 열린 문서의 초안을 바꾼다(저장은 사람이) */
  onEditOpenDoc: (next: string) => void;
  /** 다른 문서를 고쳐 저장했을 때 */
  onSaved: (path: string) => void;
  onOpenDoc: (path: string, block?: string) => void;
}

let pdfMod: Promise<typeof import("./render/pdf")> | null = null;
const loadPdf = () => (pdfMod ??= import("./render/pdf"));

const stem = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "");

export function PdfViewer({ path, page, from, resolver, onClose, onEditOpenDoc, onSaved, onOpenDoc }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(() => (window.innerWidth < 800 ? 0.8 : 1.3));
  const [base, setBase] = useState<{ width: number; height: number } | null>(null);
  const [current, setCurrent] = useState(page ?? 1);
  // 짝 노트: 경로와 (열린 문서가 아니면) 마지막으로 읽은 내용
  const [companion, setCompanion] = useState<{ path: string; content: string | null; hash: string | null } | null>(null);
  const [pick, setPick] = useState<{ page: number; text: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const rendered = useRef(new Map<number, number>()); // 쪽 → 그린 배율

  // PDF 읽기
  useEffect(() => {
    let alive = true;
    setPdf(null);
    setError(null);
    Promise.all([loadPdf(), api.readBytes(path)])
      .then(async ([m, data]) => {
        const doc = await m.openPdf(data);
        if (!alive) return void doc.destroy();
        setBase(await m.pageSize(doc, 1, 1));
        setPdf(doc);
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [path]);
  useEffect(() => () => void pdf?.destroy(), [pdf]);

  // 짝 노트 찾기
  const findCompanion = useCallback(async () => {
    const guess = pdfCompanionPath(path);
    if (from && from.path === guess) return setCompanion({ path: guess, content: null, hash: null });
    try {
      const d = await api.read(guess);
      return setCompanion({ path: guess, content: d.content, hash: d.hash });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
    if (from) return setCompanion({ path: from.path, content: null, hash: null });
    setCompanion({ path: guess, content: null, hash: null }); // 첫 주석을 남길 때 만든다
  }, [path, from?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    findCompanion().catch((e) => setError(errorText(e)));
  }, [findCompanion]);

  const companionIsOpen = companion !== null && from?.path === companion.path;
  const companionText = companionIsOpen ? from!.draft : (companion?.content ?? "");
  const resolve = useCallback(
    (x: string) => resolver.resolve(x, companion?.path ?? from?.path) ?? resolveLink(x, [path]),
    [resolver, path, companion?.path, from?.path],
  );
  const notes = useMemo(() => pdfAnnotations(companionText, resolve, path), [companionText, resolve, path]);

  // 보이는 쪽만 그린다
  useEffect(() => {
    const root = pagesRef.current;
    if (!pdf || !root) return;
    rendered.current.clear();
    let alive = true;
    const draw = (el: HTMLElement) => {
      const n = Number(el.dataset.page);
      if (rendered.current.get(n) === scale) return;
      rendered.current.set(n, scale);
      void loadPdf()
        .then((m) => m.renderPage(pdf, n, el.querySelector<HTMLElement>(".pdf-page-inner")!, scale))
        .then(() => alive && el.dispatchEvent(new Event("pdf-rendered")))
        .catch(() => rendered.current.delete(n));
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) draw(e.target as HTMLElement);
        // 지금 쪽: 화면 위쪽에 가장 가까운 보이는 쪽
        const top = root.getBoundingClientRect().top;
        let best: { n: number; d: number } | null = null;
        for (const el of root.querySelectorAll<HTMLElement>(".pdf-page")) {
          const r = el.getBoundingClientRect();
          if (r.bottom < top + 40) continue;
          const d = Math.abs(r.top - top);
          if (!best || d < best.d) best = { n: Number(el.dataset.page), d };
          if (r.top > top + root.clientHeight) break;
        }
        if (best) setCurrent(best.n);
      },
      { root, rootMargin: "600px 0px" },
    );
    for (const el of root.querySelectorAll<HTMLElement>(".pdf-page")) io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [pdf, scale]);

  // 처음 연 쪽으로
  useEffect(() => {
    if (!pdf || !page) return;
    requestAnimationFrame(() => pagesRef.current?.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: "start" }));
  }, [pdf, page]);

  // 남긴 주석을 글자 층에 표시
  const paint = useCallback(
    (el: HTMLElement) => {
      const n = Number(el.dataset.page);
      const spans = [...el.querySelectorAll<HTMLElement>(".textLayer span:not(.markedContent)")];
      for (const s of spans) s.classList.remove("pdf-hl");
      const quotes = notes.filter((a) => a.page === n).map((a) => a.quote.replace(/\s+/g, ""));
      if (!quotes.length || !spans.length) return;
      let joined = "";
      const owner: number[] = [];
      spans.forEach((s, i) => {
        const txt = (s.textContent ?? "").replace(/\s+/g, "").replace(/[“”]/g, '"');
        joined += txt;
        for (let k = 0; k < txt.length; k++) owner.push(i);
      });
      for (const q of quotes) {
        const at = q ? joined.indexOf(q) : -1;
        if (at < 0) continue;
        for (let k = at; k < at + q.length; k++) spans[owner[k]]?.classList.add("pdf-hl");
      }
    },
    [notes],
  );
  useEffect(() => {
    const root = pagesRef.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLElement>(".pdf-page")) paint(el);
    const on = (e: Event) => paint(e.target as HTMLElement);
    root.addEventListener("pdf-rendered", on, true);
    return () => root.removeEventListener("pdf-rendered", on, true);
  }, [paint, pdf]);

  // 고른 글
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !pagesRef.current) return;
      const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
      const pageEl = node?.closest<HTMLElement>(".pdf-page");
      if (!pageEl || !pagesRef.current.contains(pageEl)) return;
      const text = cleanPdfQuote(sel.toString());
      if (text) setPick({ page: Number(pageEl.dataset.page), text });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const goto = (n: number) => {
    if (!pdf) return;
    const p = Math.min(Math.max(1, n), pdf.numPages);
    pagesRef.current?.querySelector(`[data-page="${p}"]`)?.scrollIntoView({ block: "start" });
  };

  /** 짝 노트를 고친다: 열린 문서면 초안을, 아니면 읽었던 버전 기준으로 저장한다 */
  const editCompanion = async (fn: (content: string) => string) => {
    if (!companion) return;
    if (companionIsOpen) {
      onEditOpenDoc(fn(from!.draft));
      return;
    }
    let { content, hash } = companion;
    if (content === null) {
      content = `---\ntitle: ${JSON.stringify(stem(path).replace(/\.pdf$/i, ""))}\noriginal: '[[${path}]]'\n---\n# ${stem(path).replace(/\.pdf$/i, "")}\n\n> ${translate(vaultLang(), "pdf.companionSource")}: [[${path}]]\n`;
      hash = null;
    }
    const next = fn(content);
    const saved = await api.write(companion.path, next, hash);
    setCompanion({ path: companion.path, content: next, hash: saved.hash });
    onSaved(companion.path);
  };

  const target = companion
    ? resolver.resolve(stem(companion.path), from?.path) === companion.path || !resolver.resolve(stem(companion.path), from?.path)
      ? stem(companion.path)
      : companion.path.replace(/\.md$/i, "")
    : "";
  const pdfTarget = resolver.resolve(path.split("/").pop()!, companion?.path) === path ? path.split("/").pop()! : path;

  const save = async () => {
    if (!pick || !companion) return;
    setBusy(true);
    setMessage(null);
    try {
      const id = newPdfAnnotationId(companionText, pick.page);
      await editCompanion((c) => addPdfAnnotation(c, { pdf: pdfTarget, page: pick.page, quote: pick.text, note, id }, vaultLang()));
      setPick(null);
      setNote("");
      window.getSelection()?.removeAllRanges();
      setMessage(companionIsOpen ? t("pdf.addedToDraft") : t("pdf.savedTo", { path: companion.path }));
    } catch (e) {
      setMessage(errorText(e));
      if (e instanceof ApiError && e.status === 409) void findCompanion();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: PdfAnnotation) => {
    setBusy(true);
    try {
      await editCompanion((c) => removePdfAnnotation(c, a.id));
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const sourceLink = (a: PdfAnnotation) => `[[${target}#^${a.id}]]`;
  // 연 문서가 짝 노트가 아니면(위키 페이지 등) 그 문서 sources에 바로 더할 수 있다
  const canCite = from !== null && companion !== null && from.path !== companion.path;
  const fromSources = useMemo(() => {
    if (!from) return [] as string[];
    const s = parseFrontmatter(from.draft).data?.sources;
    return Array.isArray(s) ? s.map(String) : typeof s === "string" ? [s] : [];
  }, [from]);
  const cite = (a: PdfAnnotation) => {
    if (!from) return;
    const link = sourceLink(a);
    if (fromSources.includes(link)) return;
    try {
      onEditOpenDoc(setFrontmatterField(from.draft, "sources", [...fromSources, link]));
      setMessage(t("pdf.citedIn", { path: from.path }));
    } catch (e) {
      setMessage(errorText(e));
    }
  };

  const pages = pdf ? Array.from({ length: pdf.numPages }, (_, i) => i + 1) : [];
  const w = base ? Math.floor(base.width * scale) : 0;
  const h = base ? Math.floor(base.height * scale) : 0;

  return (
    <div className="pdf-viewer" role="dialog" aria-label={t("pdf.viewerLabel", { path })} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <header className="pdf-bar">
        <strong className="pdf-title" title={path}>
          {path.split("/").pop()}
        </strong>
        {pdf && (
          <span className="pdf-nav">
            <button onClick={() => goto(current - 1)} aria-label={t("pdf.prevPage")} {...tipProps({ label: t("pdf.prevPage") })}>
              ‹
            </button>
            <input
              key={current}
              defaultValue={current}
              aria-label={t("pdf.page")}
              inputMode="numeric"
              onKeyDown={(e) => e.key === "Enter" && goto(Number((e.target as HTMLInputElement).value))}
            />
            <span className="meta">/ {pdf.numPages}</span>
            <button onClick={() => goto(current + 1)} aria-label={t("pdf.nextPage")} {...tipProps({ label: t("pdf.nextPage") })}>
              ›
            </button>
            <button
              onClick={() => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(1)))}
              aria-label={t("pdf.zoomOut")}
              {...tipProps({ label: t("pdf.zoomOut") })}
            >
              −
            </button>
            <button onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(1)))} aria-label={t("pdf.zoomIn")} {...tipProps({ label: t("pdf.zoomIn") })}>
              ＋
            </button>
          </span>
        )}
        <a className="pdf-raw" href={api.rawUrl(path)} target="_blank" rel="noreferrer">
          {t("pdf.original")}
        </a>
        <button onClick={onClose}>{t("common.close")}</button>
      </header>
      <div className="pdf-body">
        <div className="pdf-pages" ref={pagesRef}>
          {error && <p className="prop-error">{error}</p>}
          {!pdf && !error && <p className="meta">{t("pdf.opening")}</p>}
          {pages.map((n) => (
            <div key={n} className="pdf-page" data-page={n} style={{ width: w, minHeight: h }}>
              <div className="pdf-page-inner" style={{ width: w, height: h }} />
            </div>
          ))}
        </div>
        <aside className="pdf-notes">
          <h4>{t("pdf.annotations", { count: notes.length })}</h4>
          {companion && (
            <p className="meta">
              {t("pdf.savesTo", {
                target: companionIsOpen ? t("pdf.thisNote") : companion.content === null ? t("pdf.createdOnFirst", { path: companion.path }) : companion.path,
              })}
            </p>
          )}
          {notes.length === 0 && <p className="meta">{t("pdf.empty")}</p>}
          <ul>
            {notes.map((a) => (
              <li key={a.id}>
                <button className="link-btn pdf-page-btn" onClick={() => goto(a.page)}>
                  {t("pdf.pageShort", { page: a.page })}
                </button>{" "}
                <span className="pdf-quote">“{a.quote}”</span>
                {a.note && <div className="pdf-note">{a.note}</div>}
                <div className="pdf-actions">
                  {canCite && (
                    <button
                      className="link-btn"
                      disabled={fromSources.includes(sourceLink(a))}
                      onClick={() => cite(a)}
                      title={t("pdf.citeTip", { path: from!.path, link: sourceLink(a) })}
                    >
                      {fromSources.includes(sourceLink(a)) ? t("pdf.cited") : t("pdf.cite")}
                    </button>
                  )}
                  <button
                    className="link-btn"
                    onClick={() => void navigator.clipboard?.writeText(sourceLink(a)).then(() => setMessage(t("pdf.copied", { link: sourceLink(a) })))}
                  >
                    {t("pdf.copyLink")}
                  </button>
                  {!companionIsOpen && (
                    <button className="link-btn" onClick={() => onOpenDoc(companion!.path, a.id)}>
                      {t("pdf.showInNote")}
                    </button>
                  )}
                  <button className="link-btn" disabled={busy} onClick={() => void remove(a)}>
                    {t("common.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
      {(pick || message) && (
        <div className="pdf-pick">
          {pick && (
            <>
              <span className="pdf-pick-quote">
                {t("pdf.pageShort", { page: pick.page })} “{pick.text.length > 80 ? `${pick.text.slice(0, 80)}…` : pick.text}”
              </span>
              <input
                placeholder={t("pdf.notePlaceholder")}
                aria-label={t("pdf.noteLabel")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void save()}
              />
              <button className="primary" disabled={busy || !companion} onClick={() => void save()}>
                {t("pdf.annotate")}
              </button>
              <button onClick={() => setPick(null)}>{t("common.cancel")}</button>
            </>
          )}
          {!pick && message && (
            <>
              <span className="meta">{message}</span>
              <button onClick={() => setMessage(null)}>{t("common.close")}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
