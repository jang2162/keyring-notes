import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Modal, useCloseGuard } from "./Modal";
import { api, type IngestResult, type Topic } from "./api";

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** 위키 토픽 고르기 + 새 토픽 만들기. */
function TopicPicker({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = () =>
    api
      .topics()
      .then((ts) => {
        const wikis = ts.filter((t) => t.wiki);
        setTopics(wikis);
        if (!value && wikis[0]) onChange(wikis[0].name);
      })
      .catch((e) => setError(message(e)));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    const name = prompt("새 위키 토픽 이름(최상위 폴더). 기존 폴더 이름을 쓰면 그 폴더가 위키 토픽이 됩니다.");
    if (!name) return;
    try {
      const r = await api.createTopic(name);
      await reload();
      onChange(r.topic);
      alert(
        `"${r.topic}" 위키 토픽을 만들었습니다.\n\n${r.schema}에서 목적과 규칙을 채우세요.\n\n에이전트 권한(권장):\n` +
          `npm run keyring -- agent grant <이름> ${r.topic}/raw append\n` +
          `npm run keyring -- agent grant <이름> ${r.topic}/wiki delete\n` +
          `npm run keyring -- agent grant <이름> ${r.topic}/SCHEMA.md read`,
      );
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <div className="topic-picker">
      <label>
        위키 토픽{" "}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {topics.length === 0 && <option value="">(위키 토픽 없음)</option>}
          {topics.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name} — 페이지 {t.pages} · 원본 {t.raw}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={create}>
        새 위키 토픽
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
  useCloseGuard(busy ? { kind: "block", reason: "수집(업로드·변환)하는 중입니다." } : unsaved ? { kind: "confirm", reason: "입력한 내용을 아직 수집하지 않았습니다." } : null);
  return null;
}

export function IngestDialog({ onClose, onDone }: { onClose: () => void; onDone: (results: IngestResult[], openPath?: string) => void }) {
  const [topic, setTopic] = useState("");
  const [tab, setTab] = useState<Tab>("file");
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
    if (!topic) return setLog([{ ok: false, text: "위키 토픽을 먼저 고르거나 만드세요." }]);
    setBusy(true);
    const done: IngestResult[] = [];
    for (const j of jobs) {
      try {
        const r = await j.fn();
        done.push(r);
        setLog((l) => [...l, { ok: true, text: `${j.label} → ${r.path}`, path: r.path }]);
      } catch (e) {
        setLog((l) => [...l, { ok: false, text: `${j.label}: ${message(e)}` }]);
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
    void run([{ label: title || "붙여넣기", fn: () => api.ingest({ kind: "text", topic, title: title || "붙여넣은 메모", text }) }]);
  };

  return (
    <Modal title="원본 수집" size="md" onClose={onClose}>
        <IngestGuard busy={busy} unsaved={(tab === "text" && !!text.trim()) || (tab === "url" && !!url.trim())} />
        <p className="meta">수집한 자료는 &lt;토픽&gt;/raw/ 에 마크다운으로 저장되고, 원본 파일(PDF·이미지)은 raw/assets/ 에 함께 남습니다.</p>
        <TopicPicker value={topic} onChange={setTopic} />
        <div className="tabs">
          {(["file", "url", "text"] as const).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {{ file: "파일", url: "URL", text: "붙여넣기" }[t]}
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
            PDF·이미지·HTML·마크다운·텍스트 파일을 끌어다 놓거나 눌러서 고르세요(여러 개 가능, 파일당 50MB까지).
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => files(e.target.files)} />
          </div>
        )}
        {tab === "url" && (
          <form onSubmit={submitUrl} className="ingest-form">
            <textarea rows={3} placeholder="https://… (여러 개면 줄을 바꿔서)" value={url} onChange={(e) => setUrl(e.target.value)} required />
            <input placeholder="제목(선택, URL 하나일 때)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <button type="submit" disabled={busy}>
              가져오기
            </button>
            <div className="bookmarklet">
              <p className="meta">
                로그인이 필요한 페이지나 선택한 부분만 저장하려면 이 링크를 북마크바로 끌어다 놓고, 저장할 페이지에서 누르세요:
              </p>
              <a ref={bm} className="bookmarklet-link" onClick={(e) => e.preventDefault()}>
                📎 Keyring 클립
              </a>
            </div>
          </form>
        )}
        {tab === "text" && (
          <form onSubmit={submitText} className="ingest-form">
            <input placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} required />
            <textarea rows={10} placeholder="마크다운 또는 텍스트" value={text} onChange={(e) => setText(e.target.value)} required />
            <button type="submit" disabled={busy}>
              저장
            </button>
          </form>
        )}
        {busy && <p className="meta">처리 중…</p>}
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
      setState({ error: message(e) });
    }
  };

  return (
    <div className="clip-page">
      <h1>웹 클립</h1>
      {!clip ? (
        <p className="meta">
          {window.opener ? "원래 페이지에서 내용을 받는 중…" : "이 창은 북마클릿(📎 Keyring 클립)으로 열어야 합니다. 수집 창의 URL 탭에서 북마클릿을 설치하세요."}
        </p>
      ) : state.done ? (
        <div>
          <p>✓ 저장했습니다: {state.done.path}</p>
          <a href={`/#/${encodeURIComponent(state.done.path)}`} target="_blank" rel="noreferrer">
            열기
          </a>{" "}
          <button onClick={() => window.close()}>창 닫기</button>
        </div>
      ) : (
        <>
          <p className="meta clip-url">{clip.url}</p>
          <TopicPicker value={topic} onChange={setTopic} />
          <label className="clip-field">
            제목 <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {clip.selectionHtml && (
            <label className="clip-field">
              <input type="checkbox" checked={onlySelection} onChange={(e) => setOnlySelection(e.target.checked)} /> 선택한 부분만 저장
            </label>
          )}
          <div className="clip-actions">
            <button className="on" disabled={state.busy || !topic} onClick={() => save(false)}>
              저장
            </button>
            <button disabled={state.busy || !topic} onClick={() => save(true)} title="서버가 URL을 직접 가져옵니다(공개 페이지만)">
              URL로 다시 가져오기
            </button>
          </div>
          {state.busy && <p className="meta">변환하는 중…</p>}
          {state.error && <p className="form-error">{state.error}</p>}
        </>
      )}
    </div>
  );
}
