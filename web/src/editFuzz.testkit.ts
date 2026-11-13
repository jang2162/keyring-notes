import { undo, redo } from "@codemirror/commands";
import type { EditorState, Transaction, TransactionSpec } from "@codemirror/state";

/**
 * 편집기 증분 갱신 시험(liveBlocks·foldGutterClass)이 함께 쓰는 무작위 문서·편집. 시험 파일이 아니라 시험이 부르는 도구다.
 * 씨앗이 같으면 같은 문서·편집이 나온다 — 실패하면 시험이 씨앗을 이름에 남긴다.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 블록 판정이 갈리는 줄들 — 펜스·HTML·인용·목록 안 블록·수식·주석·임베드·제목·표·프런트매터 */
const LINES = [
  "글",
  "",
  "",
  "# 제목",
  "## 둘",
  "##### 다섯",
  "#### 넷",
  "제목 밑줄",
  "===",
  "---",
  "```",
  "```js",
  "```mermaid",
  "```keyring-widget",
  '{"widget": "keyring/dday@1"}',
  "~~~",
  "graph TD",
  "<div>",
  "</div>",
  "<!-- 주석 -->",
  "> [!note] 콜아웃",
  "> 인용",
  "> $$",
  "- 목록",
  "  ```py",
  "  %% 안",
  "  ```",
  "1. 번호",
  "    들여쓴 코드",
  "$$",
  "$$ a $$",
  "x $$ y",
  "%%",
  "%% 한 줄 %%",
  "끝 %%",
  "![[그림.png]]",
  "![[문서]]",
  "![](a.png)",
  "| a | b |",
  "|---|---|",
  "- [ ] 할 일",
];

const CHARS = ["$", "$$", "%", "%%", "`", "```", "\n", "\n\n", "#", "# ", ">", "> ", "-", " ", "~~~", "<", "!", "[", "]", "x", "가"];

export function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}

/** 드문 문서에 섞는 줄: 수식·주석의 여닫는 줄과, 그 사이를 가르는 코드·콜아웃 */
const SPARSE = ["%%", "끝 %%", "$$", "x $$ y", "```", "> [!note] 콜아웃", "- 목록", "  ```py", "# 제목"];

/** sparse: 대부분 글 줄 — $$·%% 의 짝이 수백 줄 떨어지게(줄 루프가 멀리 내다보는 경우) */
export function randomLines(r: () => number, n: number, sparse = false): string {
  const out: string[] = [];
  if (r() < 0.1) out.push("---", "title: t", "---");
  for (let i = 0; i < n; i++) out.push(!sparse ? pick(r, LINES) : r() < 0.98 ? "글" : pick(r, SPARSE));
  return out.join("\n");
}

/**
 * 무작위 편집 하나. 줄 단위 넣기·지우기·붙여넣기(여러 줄)·글자 넣기·글자 지우기·바꾸기, 실행 취소·다시 실행.
 * 실행 취소는 history() 가 든 상태에서만 돈다(없으면 다른 편집으로 바꾼다)
 */
export function randomEdit(r: () => number, state: EditorState, sparse = false): Transaction | null {
  const k = r();
  if (k < 0.12) {
    let done: Transaction | null = null;
    (k < 0.08 ? undo : redo)({ state, dispatch: (tr) => (done = tr) });
    if (done) return done;
  }
  const spec = randomChange(r, state, k, sparse);
  return spec && state.update(spec);
}

function randomChange(r: () => number, state: EditorState, k: number, sparse: boolean): TransactionSpec | null {
  const len = state.doc.length;
  const pos = () => Math.floor(r() * (len + 1));
  if (k < 0.35) {
    const p = pos();
    return { changes: { from: p, insert: pick(r, CHARS) }, selection: { anchor: p } };
  }
  if (k < 0.5) {
    const line = state.doc.line(1 + Math.floor(r() * state.doc.lines));
    return { changes: { from: line.from, insert: pick(r, LINES) + "\n" } };
  }
  if (k < 0.62) {
    if (len === 0) return null;
    const a = pos();
    const b = Math.min(len, a + 1 + Math.floor(r() * 3));
    return { changes: { from: a, to: b } };
  }
  if (k < 0.72) {
    // 여러 줄 지우기(블록 경계를 넘는다)
    const a = state.doc.line(1 + Math.floor(r() * state.doc.lines));
    const b = state.doc.line(Math.min(state.doc.lines, a.number + Math.floor(r() * 30)));
    return { changes: { from: a.from, to: Math.min(len, b.to + 1) } };
  }
  if (k < 0.85) {
    // 큰 붙여넣기
    const p = pos();
    return { changes: { from: p, insert: "\n" + randomLines(r, 5 + Math.floor(r() * 120), sparse) + "\n" } };
  }
  if (k < 0.95) {
    // 바꾸기
    const a = pos();
    const b = Math.min(len, a + Math.floor(r() * 40));
    return { changes: { from: a, to: b, insert: pick(r, CHARS) + pick(r, LINES) } };
  }
  // 여러 곳을 한 번에(멀리 떨어진 두 자리)
  const a = Math.floor(r() * (len + 1) * 0.3);
  const b = Math.max(a, Math.floor(len * 0.7 + r() * len * 0.3));
  return {
    changes: [
      { from: a, insert: pick(r, CHARS) },
      { from: b, insert: pick(r, CHARS) },
    ],
  };
}
