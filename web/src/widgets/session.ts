import type { WidgetContext } from "./types";

/**
 * 위젯 하나의 「상태가 바뀌는 길」(DOM 없음). 정본은 docs/superpowers/specs/2026-11-09-keyring-widget-design.md
 * 「상태가 바뀌는 길」 — 보기 모드 상호작용은 곧바로 한 번 쓰고, 수정 모드는 초안만 바꾸다 적용·버림·사라짐으로 끝난다.
 */
export interface SessionHost {
  /** 블록을 한 번 다시 쓴다(위젯 판으로). 못 쓰면 false */
  write(state: unknown): boolean;
  /** widgetEditField 효과 */
  startEdit(draft: unknown): void;
  setDraft(draft: unknown): void;
  endEdit(): void;
  /** onUpdate 로 보낼 때 */
  changed(ctx: Pick<WidgetContext, "state" | "editing">): void;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
// 값 비교는 직렬화 글로 — 상태는 JSON 으로 파일에 남는 값이라 그 글이 같으면 파일도 같다
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class WidgetSession {
  private base: unknown;
  private draft: unknown = undefined;
  private isEditing = false;
  private editable: boolean;
  private readonly readOnly: boolean;

  constructor(
    init: { state: unknown; editable: boolean; readOnly: boolean; resumeDraft?: unknown },
    private readonly host: SessionHost,
  ) {
    this.base = init.state;
    this.editable = init.editable;
    this.readOnly = init.readOnly;
    // 이어받기: 초안은 이미 편집기 필드에 있으므로 startEdit 을 다시 부르지 않는다
    if (init.resumeDraft !== undefined && this.canChange()) {
      this.isEditing = true;
      this.draft = init.resumeDraft;
    }
  }

  get state(): unknown {
    return this.isEditing ? this.draft : this.base;
  }

  get editing(): boolean {
    return this.isEditing;
  }

  private canChange() {
    return this.editable && !this.readOnly;
  }

  private notify() {
    this.host.changed({ state: this.state, editing: this.isEditing });
  }

  setState(patch: object): void {
    if (!this.canChange()) return;
    // 스프레드를 쓴다: Object.assign 은 "__proto__" 를 setter 로 받아 own 키로 남기지 않는다
    const next = { ...(isRecord(this.state) ? this.state : {}), ...patch };
    if (this.isEditing) {
      this.draft = next;
      this.host.setDraft(next);
    } else {
      if (!this.host.write(next)) return;
      this.base = next;
    }
    this.notify();
  }

  requestEdit(): void {
    if (!this.canChange() || this.isEditing) return;
    this.isEditing = true;
    this.draft = this.base;
    this.host.startEdit(this.draft);
    this.notify();
  }

  exitEdit(apply: boolean): void {
    if (!this.isEditing) return;
    const draft = this.draft;
    this.isEditing = false;
    this.draft = undefined;
    // 바꾼 것이 없으면 쓰지 않는다 — 누르거나 포커스가 오가기만 해서는 파일이 바뀌면 안 된다
    if (apply && !same(draft, this.base) && this.host.write(draft)) this.base = draft;
    this.host.endEdit();
    this.notify();
  }

  /** = exitEdit(true) */
  focusOut(): void {
    this.exitEdit(true);
  }

  /** 수정 중이었으면 초안을 버리고 true */
  escape(): boolean {
    if (!this.isEditing) return false;
    this.exitEdit(false);
    return true;
  }

  /** 바깥에서 블록이 바뀜. 수정 중이면 초안은 지키고(적용 때 바깥 변경 위에 쓴다), 비교 기준만 옮긴다 */
  external(state: unknown, editable: boolean): void {
    this.base = state;
    this.editable = editable;
    if (this.isEditing && !this.canChange()) {
      this.isEditing = false;
      this.draft = undefined;
      this.host.endEdit();
    }
    this.notify();
  }

  /** 블록이 사라짐: 초안 버림, 쓰지 않음 */
  gone(): void {
    if (!this.isEditing) return;
    this.isEditing = false;
    this.draft = undefined;
    this.host.endEdit();
    this.notify();
  }
}

/** 위젯 뿌리에서 받은 키를 세션 동작으로. 조합 중이면 늘 null — Safari 는 조합을 끝내는 키를 isComposing false·keyCode 229 로 보낸다 */
export function widgetKeyAction(e: { key: string; isComposing: boolean; keyCode: number }): "escape" | null {
  if (e.isComposing || e.keyCode === 229) return null;
  return e.key === "Escape" ? "escape" : null;
}

/**
 * 뿌리의 focusout 을 어떻게 볼까. 뿌리가 DOM 에서 빠지는 중(미리보기 다시 그리기, 편집기가 위젯을 치움)에 나는 blur 로는 적용하지 않는다 —
 * 호스트는 이 판정을 focusout 핸들러 안이 아니라 queueMicrotask 뒤에 부른다(제거 처리 중에는 isConnected 가 아직 true 일 수 있다).
 */
export function focusOutAction(e: { rootConnected: boolean; relatedInside: boolean }): "apply" | "ignore" {
  return e.rootConnected && !e.relatedInside ? "apply" : "ignore";
}
