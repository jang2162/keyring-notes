import {
  EDITED_FIELD,
  parseFrontmatter,
  planReorder,
  RANK_FIELD,
  seedRanks,
  setFrontmatterField,
  SORT_FIELD,
  sortChildren,
  type ChildSort,
  type VaultNode,
} from "@keyring-notes/core";

/** 앱이 적는 속성(정렬·순서·수정 시각). 속성 패널과 속성 개수에서 빼 사람이 고치는 속성만 보인다 */
const APP_FIELDS = new Set([SORT_FIELD, RANK_FIELD, EDITED_FIELD]);
export const isAppField = (key: string) => APP_FIELDS.has(key);

/**
 * 앱이 적는 속성만 있고 본문이 빈 노트(앱으로 막 만든 노트는 `edited` 프런트매터가 있다)를 템플릿으로 채운 내용.
 * 그런 노트가 아니면 null — 부르는 쪽은 커서 자리에 넣는다. 정렬·순서(sort·rank)는 템플릿 프런트매터에 옮겨 남기고,
 * 수정 시각은 저장할 때 쓰기 계층이 다시 적으므로 버린다. 예전에는 새 노트가 빈 내용이라 템플릿 프런트매터가 곧 노트의 것이었다
 */
export function fillBlankNote(current: string, text: string): string | null {
  const fm = parseFrontmatter(current);
  if (!fm.data || Object.keys(fm.data).some((k) => !isAppField(k))) return null;
  if (current.split("\n").slice(fm.lines).join("\n").trim()) return null;
  let out = text;
  for (const key of [SORT_FIELD, RANK_FIELD])
    if (fm.data[key] !== undefined)
      try {
        out = setFrontmatterField(out, key, fm.data[key]);
      } catch {
        return null;
      }
  return out;
}

/**
 * 트리에 보일 하위 노드 순서. 부모의 정렬(sort)을 따르고, 정하지 않았을 때만 데일리 폴더의 이름 내림차순(prefs.dailySortDesc)을 쓴다.
 * 처음 커스텀으로 바꿀 때 rank 를 이 순서대로 매기므로(seedRanks) 트리와 같은 함수를 쓴다
 */
export function shownChildren(
  nodes: VaultNode[],
  sort: ChildSort | null,
  descending: boolean,
  viewedAt: (notePath: string) => number | undefined,
): VaultNode[] {
  if (sort === null && descending) return [...nodes].sort((a, b) => b.name.localeCompare(a.name, "ko"));
  return sortChildren(nodes, sort, viewedAt);
}

/** 지금 읽은 노트(없으면 null) */
export type NoteState = { content: string; hash: string } | null;

export interface NoteWrite {
  path: string;
  content: string;
  baseHash: string | null;
}

/**
 * 하위 노트 정렬을 적을 쓰기 목록. 부모 노트의 sort 를 바꾸고(이름순이면 지운다), 노트가 없으면 만든다(이름순이면 만들지 않는다).
 * seeds: 처음 커스텀으로 바꿀 때 하위 노트에 적을 rank(seedRanks). 내용이 그대로인 노트는 넣지 않는다.
 * 부모의 프런트매터가 깨졌으면 던진다(고를 수 없다고 알린다). 하위 노트의 프런트매터가 깨졌으면 그 노트만 건너뛴다 —
 * rank 없는 노트로 남아 rank 있는 노트 뒤에 이름순으로 보인다
 */
export function childSortWrites(
  parentNote: string,
  parent: NoteState,
  sort: ChildSort,
  seeds: { note: string; rank: string }[],
  read: (note: string) => NoteState,
): NoteWrite[] {
  const out: NoteWrite[] = [];
  const value = sort === "name" ? null : sort;
  if (parent || value !== null) {
    const content = setFrontmatterField(parent?.content ?? "", SORT_FIELD, value);
    if (!parent || content !== parent.content) out.push({ path: parentNote, content, baseHash: parent?.hash ?? null });
  }
  for (const s of seeds) {
    const cur = read(s.note);
    if (!cur) continue;
    let content: string;
    try {
      content = setFrontmatterField(cur.content, RANK_FIELD, s.rank);
    } catch {
      continue;
    }
    if (content !== cur.content) out.push({ path: s.note, content, baseHash: cur.hash });
  }
  return out;
}

/**
 * 커스텀 순서 바꾸기(planReorder 결과)를 적을 쓰기 목록. 보통은 옮긴 노트 하나다.
 * 노트 없는 폴더 노드(note null)는 그 노드의 노트를 rank 만 든 새 노트로 만든다. 프런트매터가 깨진 노트가 있으면 던진다
 */
export function rankWrites(plan: { note: string | null; node: string; rank: string }[], read: (note: string) => NoteState): NoteWrite[] {
  return plan.map((p) => {
    const path = p.note ?? `${p.node}.md`;
    const cur = p.note === null ? null : read(path);
    return { path, content: setFrontmatterField(cur?.content ?? "", RANK_FIELD, p.rank), baseHash: cur?.hash ?? null };
  });
}

/** 같은 부모 안에서 한 칸 위(-1)·아래(1)로 옮길 때 넣을 자리(그 앞에 둘 노드, null 이면 맨 뒤). 끝이라 못 옮기면 undefined */
export function siblingTarget(siblings: VaultNode[], path: string, dir: -1 | 1): string | null | undefined {
  const i = siblings.findIndex((n) => n.path === path);
  if (i < 0 || i + dir < 0 || i + dir >= siblings.length) return undefined;
  return dir < 0 ? siblings[i - 1].path : (siblings[i + 2]?.path ?? null);
}

/** 자동 생성 노트(위키 주제의 wiki/index·log). 서버·앱이 쓰기를 거부하므로 트리에서 읽기 전용이고 rank 도 적지 않는다 */
export const isGeneratedNote = (notePath: string) => /\/wiki\/(index|log)\.md$/.test(notePath);

/**
 * rank 를 적을 수 있는 하위(읽기 전용 노트를 뺀다). 뺀 노트는 rank 가 없으므로 정렬에서는 rank 없는 노트로 맨 뒤에 이름순으로 남는다.
 * 넣으면 처음 커스텀·순서 바꾸기의 일괄 쓰기가 통째로 거부된다(generated_readonly)
 */
export function writableSiblings(siblings: VaultNode[], readOnly: (notePath: string) => boolean): VaultNode[] {
  return siblings.filter((n) => n.note === null || !readOnly(n.note));
}

/** 처음 커스텀으로 바꿀 때 적을 rank(보이는 순서, 읽기 전용 노트 빼고) */
export function seedWritable(shown: VaultNode[], readOnly: (notePath: string) => boolean): { note: string; rank: string }[] {
  return seedRanks(writableSiblings(shown, readOnly));
}

/**
 * 커스텀 순서 바꾸기 계획(planReorder)을 읽기 전용 노트 없이 세운다. beforePath 가 읽기 전용 노트면
 * 보이는 순서에서 그 뒤의 첫 쓸 수 있는 노드 앞으로(없으면 맨 뒤) 친다
 */
export function planWritable(shown: VaultNode[], readOnly: (notePath: string) => boolean, moving: string, beforePath: string | null) {
  const ok = writableSiblings(shown, readOnly);
  let before = beforePath;
  for (let i = shown.findIndex((n) => n.path === before); before !== null && i >= 0 && !ok.some((n) => n.path === before); i++)
    before = shown[i + 1]?.path ?? null;
  return planReorder(ok, moving, before);
}

/**
 * 커스텀 부모 아래 노드 행에 끌고 있을 때. y: 행 안의 세로 위치(0 위 ~ 1 아래).
 * 위·아래 가장자리(30%씩)면 같은 부모의 노드는 그 행 앞·뒤에 삽입선(line), 다른 부모의 노드는 그 부모 안으로(parent — 가운데 놓기와 같은 강조).
 * 가운데이거나 부모가 커스텀이 아니면 null(지금처럼 그 노드 안으로). 펼친 노드의 아래 가장자리도 가운데로 친다 —
 * 삽입선은 그 행 바로 밑(첫 하위 위)에 그려지는데 결과는 하위 전체 뒤라 자리가 어긋난다
 */
export type EdgeDrop = { kind: "line"; side: "before" | "after" } | { kind: "parent" } | null;
export function edgeDrop(y: number, o: { custom: boolean; sameParent: boolean; parentOk: boolean; expanded: boolean }): EdgeDrop {
  if (!o.custom) return null;
  const side = y < 0.3 ? "before" : y > 0.7 && !o.expanded ? "after" : null;
  if (!side) return null;
  if (!o.sameParent) return o.parentOk ? { kind: "parent" } : null;
  return { kind: "line", side };
}

/** 부모가 커스텀이 아니라 순서를 못 바꿀 때 안내 글의 키. 워크스페이스 맨 위 노트의 정렬은 「더 보기 → 노트 정렬」 에서 고른다 */
export const reorderHintKey = (parentPath: string) => (parentPath.includes("/") ? "tree.reorderNeedsCustom" : "tree.reorderNeedsCustomRoot");
