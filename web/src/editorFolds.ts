import { ensureSyntaxTree, foldable, foldAll, foldEffect, foldedRanges, syntaxTree, unfoldAll, unfoldEffect } from "@codemirror/language";
import { Annotation, type EditorState, type StateEffect } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { anchorsOf, getFolds, resolveFolds, setFolds } from "./folds";

/**
 * 예산 안에서 문서 끝까지 파싱하고 view 의 상태가 그 트리를 받게 한다. 끝까지 갔으면 true.
 *
 * `ensureSyntaxTree` 만으로는 안 된다 — 상태 사이에 공유되는 파싱 문맥만 진행하고 `syntaxTree(view.state)` 는
 * 상태가 만들어질 때 받은 트리(첫 파싱: 앞 3,000 자)를 그대로 돌려준다. 그러면 `foldable`·`foldAll` 이 그 뒤 줄에서
 * 조용히 아무것도 못 찾는다. 빈 트랜잭션을 한 번 주면 새 상태가 문맥의 트리를 받는다 — 배경 파싱이 곧 보낼 것과 같은
 * 트랜잭션을 앞당길 뿐이라 더하는 일은 없다. 시험 쪽 같은 도우미는 `parsedState.testkit.ts` 의 `parsed()`.
 */
export function parseView(view: EditorView, budget: number): boolean {
  const tree = ensureSyntaxTree(view.state, view.state.doc.length, budget);
  if (tree && tree !== syntaxTree(view.state)) view.dispatch({});
  return tree !== null;
}

/** 블록의 접힌 줄들(접힌 범위가 시작하는 줄) */
export function foldedLineNumbers(state: EditorState): number[] {
  const out: number[] = [];
  foldedRanges(state).between(0, state.doc.length, (from) => {
    out.push(state.doc.lineAt(from).number);
  });
  return out;
}

/** 그 줄에서 시작하는 접힌 범위를 펴거나, 접을 수 있으면 접는다 */
export function toggleLine(view: EditorView, lineNo: number): boolean {
  if (lineNo < 1 || lineNo > view.state.doc.lines) return false;
  parseView(view, 300);
  const line = view.state.doc.line(lineNo);
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(line.from, line.to, (from, to) => {
    if (view.state.doc.lineAt(from).number === lineNo) effects.push(unfoldEffect.of({ from, to }));
  });
  if (!effects.length) {
    const r = foldable(view.state, line.from, line.to);
    if (r) effects.push(foldEffect.of(r));
  }
  if (effects.length) view.dispatch({ effects });
  return effects.length > 0;
}

/** 이 수준 제목만 보기: 커서가 든 섹션의 제목 수준과 같은 제목을 모두 접는다 */
export function foldLevel(view: EditorView) {
  parseView(view, 300);
  const { state } = view;
  const head = state.selection.main.head;
  let level = 0;
  const heads: { level: number; line: number }[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      const m = /^(?:ATX|Setext)Heading(\d)$/.exec(n.name);
      if (!m) return;
      heads.push({ level: Number(m[1]), line: state.doc.lineAt(n.from).number });
      if (n.from <= head) level = Number(m[1]);
      return false;
    },
  });
  if (!level) level = Math.min(...heads.map((h) => h.level), 6);
  const effects: StateEffect<unknown>[] = [];
  for (const h of heads) {
    if (h.level !== level) continue;
    const line = state.doc.line(h.line);
    const r = foldable(state, line.from, line.to);
    if (r) effects.push(foldEffect.of(r));
  }
  if (effects.length) view.dispatch({ effects });
}

/** 모두 접기 */
export function foldAllParsed(view: EditorView) {
  parseView(view, 300);
  foldAll(view);
}

/** 저장해 둔 접기를 되살리는 트랜잭션 — 사용자가 접은 것이 아니므로 저장으로 보내지 않는다 */
const restoring = Annotation.define<true>();

/** 열 때 파싱 예산(ms). 이 안에 문서 끝까지 못 가면 못 되살린 것은 배경 파싱이 따라오는 대로 되살린다 */
const RESTORE_BUDGET = 500;

export interface FoldMemory {
  /** 저장값을 이 뷰에 되살린다. 열 때, 그리고 다른 쪽(미리보기·개요·다른 칸)이 저장값을 바꿨을 때 */
  restore(view: EditorView): void;
  /** updateListener 에서 매번: 사용자가 접거나 폈거나, 접힌 곳이 있는 채 내용이 바뀌었으면 저장한다 */
  update(u: ViewUpdate): void;
  /** 「모두 펴기」: 아직 못 되살린 것까지 잊는다 */
  unfoldAll(view: EditorView): void;
  /** 뷰를 없앨 때(미뤄 둔 되살리기를 막는다) */
  dispose(): void;
}

/**
 * 접은 곳을 이 기기에 기억하고 되살린다(저장은 `folds.ts`).
 *
 * 되살리기가 저장값을 줄이면 안 된다 — 되살린 몇 개로 저장값을 덮으면 나머지는 다음에 열 때 영영 없다. 그래서 되살리는
 * 트랜잭션은 저장하지 않고, 파싱이 아직 닿지 않아 못 접은 것(아주 큰 문서)은 `pending` 에 두었다가 ① 트리가 자랄 때마다
 * 다시 접어 보고 ② 그사이 사용자가 접거나 편 것을 저장할 때 함께 적는다. 문서에 더는 없는 줄(같은 글의 줄이 없음)은
 * 되살리지 않되, 되살리기가 저장값에서 지우지도 않는다(사용자가 다음에 접기를 바꾸거나 접힌 채 내용을 고치면 그때의
 * 접힌 곳으로 저장된다 — 고치기 전과 같다).
 */
export function foldMemory(getKey: () => string | null | undefined): FoldMemory {
  /** 못 되살린 것: 그 줄의 시작 위치(편집을 따라 옮긴다)와 글 */
  let pending: { pos: number; text: string }[] = [];
  let retryQueued = false;
  let disposed = false;

  function save(view: EditorView, state: EditorState) {
    const key = getKey();
    if (!key) return;
    const lines = new Set(foldedLineNumbers(state));
    for (const p of pending) lines.add(state.doc.lineAt(p.pos).number);
    setFolds(key, anchorsOf(state.doc.toString().split("\n"), lines), view);
  }

  /** pending 중 이제 접을 수 있는 것을 접는다. 트리가 문서 끝까지 왔는데도 못 접는 것은 버린다 */
  function retry(view: EditorView) {
    retryQueued = false;
    if (disposed || !pending.length) return;
    const { state } = view;
    const complete = syntaxTree(state).length >= state.doc.length;
    const folded = new Set(foldedLineNumbers(state));
    const effects: StateEffect<unknown>[] = [];
    pending = pending.filter((p) => {
      const line = state.doc.lineAt(p.pos);
      if (folded.has(line.number)) return false;
      const r = foldable(state, line.from, line.to);
      if (r) effects.push(foldEffect.of(r));
      return !r && !complete;
    });
    if (effects.length) view.dispatch({ effects, annotations: restoring.of(true) });
  }

  return {
    restore(view) {
      pending = [];
      const key = getKey();
      if (!key) return;
      const stored = getFolds(key);
      if (!stored.length && !foldedRanges(view.state).size) {
        // 되살릴 것이 없으면 빈 트랜잭션을 주지 않는다(여는 시간에 더하지 않게). 파싱만 앞당겨 두는 것은 고치기 전과 같다
        ensureSyntaxTree(view.state, view.state.doc.length, RESTORE_BUDGET);
        return;
      }
      const complete = parseView(view, RESTORE_BUDGET);
      const { state } = view;
      const want = resolveFolds(state.doc.toString().split("\n"), stored);
      const have = new Set(foldedLineNumbers(state));
      const effects: StateEffect<unknown>[] = [];
      foldedRanges(state).between(0, state.doc.length, (from, to) => {
        if (!want.has(state.doc.lineAt(from).number)) effects.push(unfoldEffect.of({ from, to }));
      });
      for (const n of want) {
        if (have.has(n)) continue;
        const line = state.doc.line(n);
        const r = foldable(state, line.from, line.to);
        if (r) effects.push(foldEffect.of(r));
        else if (!complete) pending.push({ pos: line.from, text: line.text.trim() });
      }
      if (effects.length) view.dispatch({ effects, annotations: restoring.of(true) });
    },

    update(u) {
      if (pending.length && u.docChanged) {
        // 그 줄을 고쳤거나 지웠으면(시작 위치·글이 안 맞으면) 버린다
        pending = pending.flatMap((p) => {
          const pos = u.changes.mapPos(p.pos, -1);
          const line = u.state.doc.lineAt(pos);
          return line.from === pos && line.text.trim() === p.text ? [{ pos, text: p.text }] : [];
        });
      }
      const userFold = u.transactions.some((t) => !t.annotation(restoring) && t.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)));
      if (userFold || (u.docChanged && (foldedRanges(u.state).size || pending.length))) save(u.view, u.state);
      if (pending.length && !retryQueued && syntaxTree(u.state) !== syntaxTree(u.startState)) {
        retryQueued = true;
        // 업데이트 안에서는 dispatch 하지 않는다
        queueMicrotask(() => retry(u.view));
      }
    },

    unfoldAll(view) {
      pending = [];
      if (!unfoldAll(view)) save(view, view.state);
    },

    dispose() {
      disposed = true;
    },
  };
}
