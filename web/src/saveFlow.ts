/**
 * 저장 안 한 글을 지키는 판정 가운데 화면(Workspace)에서 떼어 낸 것. 화면은 여기에 저장소와 저장 함수를 건네고 답만 쓴다.
 * 열린 문서 저장소의 판정(다시 읽기·서버가 쓴 내용 받기)은 openDocs.ts, 대기열 오류 분류는 offline.ts 에 있다
 */

export interface FlushSteps {
  /** 그 문서에 저장 안 한 변경이 있는가(부를 때마다 지금 저장소를 본다) */
  dirty: (path: string) => boolean;
  autosave: boolean;
  save: (path: string) => Promise<unknown>;
}

/**
 * 다른 일(이동·이름 바꾸기·순서 바꾸기·삭제·로그아웃) 전에 문서를 저장한다. 저장 안 한 것이 남았으면 false.
 * 자동 저장을 껐으면 대신 저장하지 않는다(그 사람이 끈 이유다) — 남은 것이 있다고만 답하고, 초안을 덮거나 버리는 일은 부르는 쪽이 그만둔다
 */
export async function flushDocs(paths: string[], s: FlushSteps): Promise<boolean> {
  const list = paths.filter(s.dirty);
  if (!list.length) return true;
  if (!s.autosave) return false;
  for (const p of list) await s.save(p);
  return !list.some(s.dirty);
}

/** 그 노드(노드 노트와 하위) 안의 저장 안 한 문서 하나. dirty: 저장 안 한 문서 경로. 없으면 undefined */
export function unsavedInNode(dirty: string[], node: string): string | undefined {
  return dirty.find((p) => p === `${node}.md` || p.startsWith(node + "/"));
}

/**
 * 로그아웃하면 이 기기에서 사라질 것: 저장 안 한 노트(뒤 탭 포함)·그림과, 오프라인에서 저장해 아직 서버로 못 보낸 것(queued).
 * 없으면 null — 묻지 않고 로그아웃한다
 */
export function logoutLoss(o: { dirty: string[]; files: string[]; queued: number }): { unsaved: string[]; queued: number } | null {
  const unsaved = [...o.dirty, ...o.files];
  return unsaved.length || o.queued > 0 ? { unsaved, queued: o.queued } : null;
}
