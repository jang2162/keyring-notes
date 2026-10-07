import { useEffect, useState } from "react";
import { api, type MentionsInfo, type SourcesInfo } from "./api";
import { LinkResolver } from "./markdown";
import { blockText, linkMentions, pdfAnnotations, section, type Mention } from "@keyring-notes/core";

/** [[ ]] 안에 쓸 이름: 파일 이름만으로 이 문서를 가리키면 파일 이름, 아니면 확장자 뺀 경로 */
export function mentionTarget(path: string, resolver: LinkResolver): string {
  const stem = path.split("/").pop()!.replace(/\.md$/i, "");
  return resolver.resolve(stem) === path ? stem : path.replace(/\.md$/i, "");
}

/** 문단·제목을 가리키는 출처: 그 부분의 원문을 짧게 인용해 보인다(없으면 점검 대상) */
function SourceQuote({ path, anchor }: { path: string; anchor: string }) {
  const [text, setText] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    api
      .read(path)
      .then((d) => {
        if (!alive) return;
        // PDF 주석 줄은 "3쪽 “인용” — 메모"로 보인다(링크 문법 없이)
        const pdfNote = anchor.startsWith("^pdf-") ? pdfAnnotations(d.content).find((a) => a.id === anchor.slice(1)) : undefined;
        if (pdfNote) setText(`${pdfNote.page}쪽 “${pdfNote.quote}”${pdfNote.note ? ` — ${pdfNote.note}` : ""}`);
        else if (anchor.startsWith("^")) setText(blockText(d.content, anchor.slice(1)));
        else {
          try {
            setText(section(d.content, { heading: anchor }).content);
          } catch {
            setText(null);
          }
        }
      })
      .catch(() => alive && setText(null));
    return () => {
      alive = false;
    };
  }, [path, anchor]);
  if (text === undefined) return null;
  if (text === null) return <div className="source-quote broken">가리키는 {anchor.startsWith("^") ? "블록" : "제목"}이 원본에 없습니다</div>;
  const short = text.length > 280 ? `${text.slice(0, 280)}…` : text;
  return <blockquote className="source-quote">{short}</blockquote>;
}

/**
 * 연결되지 않은 언급: 다른 문서에 이 문서 이름이 링크 없이 나온 곳. 펼칠 때 찾고(문서마다 원문을 읽으므로),
 * "링크로"를 누르면 그 문서를 읽었던 버전(hash) 기준으로 고쳐 쓴다(그 사이 바뀌었으면 충돌로 막힌다).
 */
export function UnlinkedMentions({ path, target, version, onOpen, onChanged }: { path: string; target: string; version: number; onOpen: (p: string) => void; onChanged: () => void }) {
  const [shown, setShown] = useState(false);
  const [info, setInfo] = useState<MentionsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInfo(null);
    setError(null);
    if (!shown) return;
    let alive = true;
    api
      .mentions(path)
      .then((r) => alive && setInfo(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [path, shown, version]);

  const link = async (doc: MentionsInfo["docs"][number], ms: Mention[]) => {
    setBusy(true);
    setError(null);
    try {
      const cur = await api.read(doc.path);
      if (cur.hash !== doc.hash) throw new Error(`${doc.path}이(가) 그 사이 바뀌었습니다. 다시 찾은 뒤 바꾸세요.`);
      await api.write(doc.path, linkMentions(cur.content, ms, target), doc.hash);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInfo(null);
      api.mentions(path).then(setInfo).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const total = info?.docs.reduce((n, d) => n + d.mentions.length, 0) ?? 0;
  return (
    <details className="mentions" open={shown} onToggle={(e) => setShown((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <h4>연결되지 않은 언급{info ? ` ${total}` : ""}</h4>
      </summary>
      {error && <p className="mention-error">{error}</p>}
      {!info && !error && <p className="meta">찾는 중…</p>}
      {info && info.docs.length === 0 && <p className="meta">다른 문서에서 이 이름({info.names.join(", ")})을 링크 없이 쓴 곳이 없습니다.</p>}
      {info && info.docs.length > 0 && (
        <ul>
          {info.docs.map((d) => (
            <li key={d.path}>
              <a
                href={`#/${encodeURIComponent(d.path)}`}
                onClick={(e) => {
                  e.preventDefault();
                  onOpen(d.path);
                }}
              >
                {d.title}
              </a>{" "}
              <span className="meta">{d.path}</span>{" "}
              {d.mentions.length > 1 && (
                <button className="link-btn" disabled={busy} onClick={() => void link(d, d.mentions)}>
                  모두 링크로
                </button>
              )}
              <ul className="mention-list">
                {d.mentions.map((m) => (
                  <li key={`${m.line}:${m.start}`}>
                    <span className="mention-context">
                      {m.context.slice(0, m.contextAt)}
                      <mark>{m.context.slice(m.contextAt, m.contextAt + m.text.length)}</mark>
                      {m.context.slice(m.contextAt + m.text.length)}
                    </span>{" "}
                    <button className="link-btn" disabled={busy} title={`${m.line}번째 줄의 "${m.text}"를 [[${target}]] 링크로`} onClick={() => void link(d, [m])}>
                      링크로
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** 미리보기 아래: 출처(프런트매터 sources), 이 문서를 출처로 인용한 문서, 본문 백링크. */
export function References({ refs, onOpen }: { refs: SourcesInfo; onOpen: (p: string, anchor?: string) => void }) {
  const link = (p: string, label: string, anchor?: string) => (
    <a
      href={`#/${encodeURIComponent(p)}`}
      onClick={(e) => {
        e.preventDefault();
        if (/\.(md|pdf)$/i.test(p)) onOpen(p, anchor);
        else window.open(api.rawUrl(p), "_blank", "noreferrer");
      }}
    >
      {label}
    </a>
  );
  return (
    <section className="backlinks">
      {refs.sources.length > 0 && (
        <>
          <h4>출처 {refs.sources.length}</h4>
          <ul>
            {refs.sources.map((s) => (
              <li key={`${s.target}#${s.anchor ?? ""}`}>
                {s.path ? link(s.path, s.path.split("/").pop()!.replace(/\.md$/i, "") + (s.anchor ? ` › ${s.anchor.replace(/^\^/, "¶ ")}` : ""), s.anchor) : <span className="broken">{s.target}</span>}{" "}
                <span className="meta">{s.path ?? "없거나 볼 수 없는 출처"}</span>
                {s.path && s.anchor && <SourceQuote path={s.path} anchor={s.anchor} />}
              </li>
            ))}
          </ul>
        </>
      )}
      {refs.citedBy.length > 0 && (
        <>
          <h4>이 문서를 출처로 인용한 페이지 {refs.citedBy.length}</h4>
          <ul>
            {refs.citedBy.map((b) => (
              <li key={b.path}>
                {link(b.path, b.title)} <span className="meta">{b.path}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>백링크 {refs.linkedBy.length}</h4>
      {refs.linkedBy.length === 0 ? (
        <p className="meta">이 문서를 본문에서 링크한 문서가 없습니다.</p>
      ) : (
        <ul>
          {refs.linkedBy.map((b) => (
            <li key={b.path}>
              {link(b.path, b.title)} <span className="meta">{b.path}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

