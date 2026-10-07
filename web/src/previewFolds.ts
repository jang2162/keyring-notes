import { anchorsOf, CODE_FOLD_MIN_LINES, getFolds, resolveFolds, setFolds } from "./folds";
import { t } from "./i18n";

/**
 * 미리보기 접기: 에디터와 같은 규칙(제목 아래 내용, 하위 목록, 콜아웃, 긴 코드 블록, 표)을 같은 기억(folds.ts)으로.
 * 블록의 첫 줄 번호는 markdown.ts가 data-line으로 붙인다. 임베드한 문서 안(.note-embed)은 건드리지 않는다.
 */
type Kind = "heading" | "item" | "callout" | "code" | "table";

interface Target {
  el: HTMLElement;
  line: number;
  kind: Kind;
  level?: number;
}

function targets(root: HTMLElement): Target[] {
  const out: Target[] = [];
  const own = (el: Element) => !el.closest(".note-embed");
  for (const el of root.querySelectorAll<HTMLElement>(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6")) {
    const line = Number(el.dataset.line);
    if (line) out.push({ el, line, kind: "heading", level: Number(el.tagName[1]) });
  }
  for (const el of root.querySelectorAll<HTMLElement>("li[data-line]")) {
    if (own(el) && el.querySelector(":scope > ul, :scope > ol")) out.push({ el, line: Number(el.dataset.line), kind: "item" });
  }
  for (const el of root.querySelectorAll<HTMLElement>("div.callout[data-line]")) if (own(el)) out.push({ el, line: Number(el.dataset.line), kind: "callout" });
  for (const code of root.querySelectorAll<HTMLElement>("pre > code[data-line]")) {
    const pre = code.parentElement!;
    if (own(pre) && code.textContent!.split("\n").length - 1 + 2 >= CODE_FOLD_MIN_LINES) out.push({ el: pre, line: Number(code.dataset.line), kind: "code" });
  }
  for (const el of root.querySelectorAll<HTMLElement>("table[data-line]")) if (own(el)) out.push({ el, line: Number(el.dataset.line), kind: "table" });
  return out;
}

/** 접기 단추를 달고(이미 있으면 그대로) 기억한 대로 접는다 */
export function applyPreviewFolds(root: HTMLElement, path: string, content: string) {
  const lines = content.split("\n");
  const folded = resolveFolds(lines, getFolds(path));
  for (const el of root.querySelectorAll<HTMLElement>(".fold-hidden")) {
    el.classList.remove("fold-hidden");
    delete el.dataset.foldBy;
  }
  const list = targets(root);
  for (const tg of list) {
    let btn = tg.el.querySelector<HTMLButtonElement>(":scope > .pv-fold");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = `pv-fold pv-fold-${tg.kind}`;
      btn.dataset.foldLine = String(tg.line);
      tg.el.classList.add("pv-foldable");
      if (tg.kind === "callout") tg.el.querySelector(".callout-title")?.prepend(btn);
      else tg.el.prepend(btn);
    }
    const on = folded.has(tg.line);
    btn.textContent = on ? "▸" : "▾";
    btn.title = on ? t("fold.unfold") : t("fold.fold");
    btn.setAttribute("aria-expanded", String(!on));
    tg.el.classList.toggle("pv-folded", on);
  }
  // 접힌 제목: 다음 같은 수준 이상 제목 전까지 형제 블록을 숨긴다
  for (const t of list) {
    if (t.kind !== "heading" || !folded.has(t.line)) continue;
    for (let el = t.el.nextElementSibling as HTMLElement | null; el; el = el.nextElementSibling as HTMLElement | null) {
      const h = /^H([1-6])$/.exec(el.tagName);
      if (h && Number(h[1]) <= t.level!) break;
      if (!el.classList.contains("fold-hidden")) {
        el.classList.add("fold-hidden");
        el.dataset.foldBy = String(t.line);
      }
    }
  }
}

/** 단추 하나: 그 줄의 접기를 바꿔 기억한다(에디터·개요도 따라간다) */
export function togglePreviewFold(path: string, content: string, line: number) {
  const lines = content.split("\n");
  const set = resolveFolds(lines, getFolds(path));
  if (set.has(line)) set.delete(line);
  else set.add(line);
  setFolds(path, anchorsOf(lines, set), "preview");
}

/** 그 요소가 접혀 보이지 않으면 감싼 접기를 편다(링크·검색으로 그 자리에 갈 때) */
export function revealInPreview(el: HTMLElement, path: string, content: string) {
  const lines = content.split("\n");
  const set = resolveFolds(lines, getFolds(path));
  let changed = false;
  for (let cur: HTMLElement | null = el; cur && !cur.classList.contains("markdown-body"); cur = cur.parentElement) {
    if (cur.dataset.foldBy && set.delete(Number(cur.dataset.foldBy))) changed = true;
    if (cur !== el && cur.classList.contains("pv-folded")) {
      const line = Number(cur.querySelector<HTMLElement>(":scope > .pv-fold, :scope > .callout-title > .pv-fold")?.dataset.foldLine);
      if (line && set.delete(line)) changed = true;
    }
  }
  if (changed) setFolds(path, anchorsOf(lines, set), "preview");
  return changed;
}
