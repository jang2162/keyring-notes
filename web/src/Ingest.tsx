import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Modal, useCloseGuard } from "./Modal";
import { api, type IngestResult, type Topic } from "./api";
import { errorText } from "./toast";
import { alertDialog, promptDialog } from "./dialog";
import { t } from "./i18n";
import { Paperclip } from "lucide-react";
import { tipProps } from "./Tooltip";

/**
 * 위키 토픽 고르기 + 새 토픽 만들기. 토픽은 워크스페이스 바로 아래 노드(<워크스페이스>/<이름>/SCHEMA.md).
 * workspace: 지금 워크스페이스(그 토픽을 먼저 보이고, 새 토픽을 그 안에 만든다)
 */
function TopicPicker({ value, onChange, workspace }: { value: string; onChange: (t: string) => void; workspace?: string }) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = () =>
    api
      .topics()
      .then((ts) => {
        const wikis = ts.filter((x) => x.wiki).sort((a, b) => Number(!(workspace && a.name.startsWith(workspace + "/"))) - Number(!(workspace && b.name.startsWith(workspace + "/"))));
        setTopics(wikis);
        if (!value && wikis[0]) onChange(wikis[0].name);
      })
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    const name = await promptDialog(t("ingest.newTopicPrompt", { ws: workspace || "-" }), "", t("common.create"));
    if (!name?.trim()) return;
    const full = name.includes("/") || !workspace ? name.trim() : `${workspace}/${name.trim()}`;
    try {
      const r = await api.createTopic(full);
      await reload();
      onChange(r.topic);
      await alertDialog(t("ingest.topicCreated", { topic: r.topic, schema: r.schema }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="topic-picker">
      <label>
        {t("ingest.topic")}{" "}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {topics.length === 0 && <option value="">{t("ingest.noTopic")}</option>}
          {topics.map((x) => (
            <option key={x.name} value={x.name}>
              {t("ingest.topicOption", { name: x.name, pages: x.pages, raw: x.raw })}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={create}>
        {t("ingest.newTopic")}
      </button>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

function bookmarklet(origin: string): string {
  // 현재 페이지 HTML(로그인이 필요한 페이지도)과 선택 영역을 클리퍼 창으로 보낸다.
  const code = `(()=>{const o=${JSON.stringify(origin)};const w=window.open(o+'/#/clip','keyring-clip','width=560,height=680');const s=getSelection();let h='';if(s&&s.rangeCount&&!s.isCollapsed){const d=document.createElement('div');for(let i=0;i<s.rangeCount;i++)d.appendChild(s.getRangeAt(i).cloneContents());h=d.innerHTML}const m={type:'keyring-clip',url:location.href,title:document.title,html:document.documentElement.outerHTML,selectionHtml:h};const f=e=>{if(e.origin===o&&e.data==='keyring-clip-ready'){w.postMessage(m,o);removeEventListener('message',f)}};addEventListener('message',f)})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

type Tab = "file" | "url" | "text";

/** 올리는 중에는 닫지 않고, 넣다 만 글이 있으면 묻는다 */
function IngestGuard({ busy, unsaved }: { busy: boolean; unsaved: boolean }) {
  useCloseGuard(busy ? { kind: "block", reason: t("ingest.guardBusy") } : unsaved ? { kind: "confirm", reason: t("ingest.guardUnsaved") } : null);
  return null;
}

/** 원본 수집. 처음에는 URL 칸에 포커스를 둔다(바로 붙여넣을 수 있게) */
export function IngestDialog({ workspace, onClose, onDone }: { workspace?: string; onClose: () => void; onDone: (results: IngestResult[], openPath?: string) => void }) {
  const [topic, setTopic] = useState("");
  const [tab, setTab] = useState<Tab>("url");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ ok: boolean; text: string; path?: string }[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bm = useRef<HTMLAnchorElement>(null);

  // React는 javascript: href를 막으므로 직접 넣는다.
  useEffect(() => {
    bm.current?.setAttribute("href", bookmarklet(location.origin));
  }, [tab]);

  const run = async (jobs: { label: string; fn: () => Promise<IngestResult> }[]) => {
    if (!topic) return setLog([{ ok: false, text: t("ingest.pickTopic") }]);
    setBusy(true);
    const done: IngestResult[] = [];
    for (const j of jobs) {
      try {
        const r = await j.fn();
        done.push(r);
        setLog((l) => [...l, { ok: true, text: `${j.label} → ${r.path}`, path: r.path }]);
      } catch (e) {
        setLog((l) => [...l, { ok: false, text: `${j.label}: ${errorText(e)}` }]);
      }
    }
    setBusy(false);
    if (done.length === jobs.length) {
      setText("");
      setUrl("");
      setTitle("");
    }
    if (done.length) onDone(done, jobs.length === 1 ? done[0].path : undefined);
  };

  const files = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    void run(Array.from(list).map((f) => ({ label: f.name, fn: () => api.uploadFile(topic, f) })));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    files(e.dataTransfer.files);
  };

  const submitUrl = (e: FormEvent) => {
    e.preventDefault();
    const urls = url.split(/\s+/).filter(Boolean);
    void run(urls.map((u) => ({ label: u, fn: () => api.ingest({ kind: "url", topic, url: u, title: urls.length === 1 ? title || undefined : undefined }) })));
  };

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    void run([{ label: title || t("ingest.pasteLabel"), fn: () => api.ingest({ kind: "text", topic, title: title || t("ingest.pasteTitle"), text }) }]);
  };

  return (
    <Modal title={t("tool.ingest")} size="md" onClose={onClose}>
      <IngestGuard busy={busy} unsaved={(tab === "text" && !!text.trim()) || (tab === "url" && !!url.trim())} />
      <p className="meta">{t("ingest.hint")}</p>
      <TopicPicker value={topic} onChange={setTopic} workspace={workspace} />
      <div className="tabs" role="tablist">
        {(["url", "file", "text"] as const).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? "on" : ""} onClick={() => setTab(x)}>
            {t(`ingest.tab.${x}`)}
          </button>
        ))}
      </div>
      {tab === "file" && (
        <div
          className={`dropzone${drag ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => fileInput.current?.click()}
        >
          {t("ingest.drop")}
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => files(e.target.files)} />
        </div>
      )}
      {tab === "url" && (
        <form onSubmit={submitUrl} className="ingest-form">
          <textarea rows={3} data-autofocus placeholder={t("ingest.urlPlaceholder")} aria-label="URL" value={url} onChange={(e) => setUrl(e.target.value)} required />
          <input placeholder={t("ingest.urlTitle")} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="submit" disabled={busy}>
            {t("ingest.fetch")}
          </button>
          <div className="bookmarklet">
            <p className="meta">{t("ingest.bookmarkletHint")}</p>
            <a ref={bm} className="bookmarklet-link" onClick={(e) => e.preventDefault()}>
              <Paperclip size={15} strokeWidth={1.75} aria-hidden />
              <span className="sr-only">📎 </span>
              {t("ingest.bookmarklet")}
            </a>
          </div>
        </form>
      )}
      {tab === "text" && (
        <form onSubmit={submitText} className="ingest-form">
          <input placeholder={t("ingest.title")} value={title} onChange={(e) => setTitle(e.target.value)} required />
          <textarea rows={10} placeholder={t("ingest.textPlaceholder")} value={text} onChange={(e) => setText(e.target.value)} required />
          <button type="submit" disabled={busy}>
            {t("common.save")}
          </button>
        </form>
      )}
      {busy && <p className="meta">{t("ingest.working")}</p>}
      {log.length > 0 && (
        <ul className="ingest-log">
          {log.map((l, i) => (
            <li key={i} className={l.ok ? "ok" : "fail"}>
              {l.ok ? "✓" : "✗"} {l.text}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** 북마클릿이 여는 창(#/clip). 원래 페이지가 보낸 HTML을 받아 저장한다. */
export function ClipPage() {
  const [clip, setClip] = useState<{ url: string; title: string; html: string; selectionHtml: string } | null>(null);
  const [topic, setTopic] = useState("");
  const [title, setTitle] = useState("");
  const [onlySelection, setOnlySelection] = useState(true);
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: IngestResult }>({});

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.opener || !e.data || e.data.type !== "keyring-clip") return;
      const d = e.data as { url: unknown; title: unknown; html: unknown; selectionHtml: unknown };
      if (typeof d.html !== "string" || typeof d.url !== "string") return;
      setClip({ url: d.url, title: String(d.title ?? ""), html: d.html, selectionHtml: typeof d.selectionHtml === "string" ? d.selectionHtml : "" });
      setTitle(String(d.title ?? ""));
    };
    window.addEventListener("message", onMessage);
    // 보내는 쪽은 이 창의 출처만 확인하므로, 준비 신호에는 민감한 내용이 없다.
    window.opener?.postMessage("keyring-clip-ready", "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const save = async (byUrl: boolean) => {
    if (!clip || !topic) return;
    setState({ busy: true });
    try {
      const done = byUrl
        ? await api.ingest({ kind: "url", topic, url: clip.url, title: title || undefined })
        : await api.ingest({
            kind: "html",
            topic,
            html: clip.html,
            url: clip.url,
            selectionHtml: onlySelection && clip.selectionHtml ? clip.selectionHtml : undefined,
            title: title || undefined,
          });
      setState({ done });
    } catch (e) {
      setState({ error: errorText(e) });
    }
  };

  return (
    <div className="clip-page">
      <h1>{t("clip.title")}</h1>
      {!clip ? (
        <p className="meta">{window.opener ? t("clip.waiting") : t("clip.needBookmarklet")}</p>
      ) : state.done ? (
        <div>
          <p>✓ {t("clip.saved", { path: state.done.path })}</p>
          <a href={`/#/${encodeURIComponent(state.done.path)}`} target="_blank" rel="noreferrer">
            {t("common.open")}
          </a>{" "}
          <button onClick={() => window.close()}>{t("clip.closeWindow")}</button>
        </div>
      ) : (
        <>
          <p className="meta clip-url">{clip.url}</p>
          <TopicPicker value={topic} onChange={setTopic} />
          <label className="clip-field">
            {t("ingest.title")} <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {clip.selectionHtml && (
            <label className="clip-field">
              <input type="checkbox" checked={onlySelection} onChange={(e) => setOnlySelection(e.target.checked)} /> {t("clip.onlySelection")}
            </label>
          )}
          <div className="clip-actions">
            <button className="on" disabled={state.busy || !topic} onClick={() => save(false)}>
              {t("common.save")}
            </button>
            <button disabled={state.busy || !topic} onClick={() => save(true)} {...tipProps({ label: t("clip.byUrlTip") })}>
              {t("clip.byUrl")}
            </button>
          </div>
          {state.busy && <p className="meta">{t("clip.converting")}</p>}
          {state.error && <p className="form-error">{state.error}</p>}
        </>
      )}
    </div>
  );
}
