import type { WidgetContext } from "./types";

/**
 * 위젯 하나의 「상태가 바뀌는 길」(DOM 없음). 정본은 docs/superpowers/specs/2026-11-09-keyring-widget-design.md
 * 「상태가 바뀌는 길」 — 보기 모드 상호작용은 곧바로 한 번 쓰고, 수정 모드는 초안만 바꾸다 적용·버림·사라짐으로 끝난다.
 */
export interface SessionHost {
  /** 블록을 한 번 다시 쓴다(위젯 판으로). 못 쓰면 false */
  write(state: unknown): boolean;
  /** widgetEditField 효과 — 편집기 필드가 초안의 판을 같이 든다 */
  startEdit(draft: unknown, from: number): void;
  /** base 는 수정 중 올림(adoptMigrated)이 시작 상태를 올린 상태로 바꿀 때만 — 필드의 base 도 같이 바꾼다 */
  setDraft(draft: unknown, from: number, base?: unknown): void;
  endEdit(): void;
  /** onUpdate 로 보낼 때 */
  changed(ctx: Pick<WidgetContext, "state" | "editing">): void;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
// 값 비교는 직렬화 글로 — 상태는 JSON 으로 파일에 남는 값이라 그 글이 같으면 파일도 같다
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 받은 위젯에서 오는 상태의 file 을 블록 값으로 고정한다(없으면 키를 뺀다) — state.file 은 앱만 바꾼다.
 * 객체가 아니면 그대로(받은 위젯이 정하는 모양)
 */
export function pinFile(state: unknown, blockFile: string | undefined): unknown {
  if (!isRecord(state)) return state;
  const { file: _drop, ...rest } = state;
  return blockFile === undefined ? rest : { ...rest, file: blockFile };
}

export class WidgetSession {
  private base: unknown;
  private draft: unknown = undefined;
  /** 수정을 시작한 때(또는 이어받은 때)의 상태 — 「바뀌었는가」의 기준. base 는 바깥 변경을 따라가므로 기준이 될 수 없다 */
  private editStart: unknown = undefined;
  private isEditing = false;
  private isEditable: boolean;
  private readonly readOnly: boolean;
  /** 위젯 판, 기준 상태의 판, 초안의 판. 초안의 판은 수정을 시작할 때 한 번 정하고 바깥 변경으로 바뀌지 않는다 */
  readonly version: number;
  private baseFrom: number;
  private draftFrom: number;
  private readonly pin: (state: unknown) => unknown;

  constructor(
    init: {
      state: unknown;
      editable: boolean;
      readOnly: boolean;
      resumeDraft?: unknown;
      resumeBase?: unknown;
      /** 위젯 판(없으면 1) */
      version?: number;
      /** 기준 상태의 판(없으면 위젯 판) */
      from?: number;
      /** 이어받는 초안의 판(없으면 위젯 판) */
      resumeFrom?: number;
      /** 받은 위젯 — setState·adoptMigrated 의 상태를 지난다(state.file 고정) */
      pinFile?: (state: unknown) => unknown;
    },
    private readonly host: SessionHost,
  ) {
    this.base = init.state;
    this.isEditable = init.editable;
    this.readOnly = init.readOnly;
    this.version = init.version ?? 1;
    this.baseFrom = init.from ?? this.version;
    this.draftFrom = this.version;
    this.pin = init.pinFile ?? ((s) => s);
    // 이어받기: 초안은 이미 편집기 필드에 있으므로 startEdit 을 다시 부르지 않는다
    if (init.resumeDraft !== undefined && this.canChange()) {
      this.isEditing = true;
      this.draft = init.resumeDraft;
      this.draftFrom = init.resumeFrom ?? this.version;
      // 시작 상태는 처음 수정을 시작한 때의 것(편집기 필드의 base). 없으면 지금 상태로 본다
      this.editStart = init.resumeBase !== undefined ? init.resumeBase : init.state;
    } else if (init.resumeDraft !== undefined) {
      // 고칠 수 없게 된 블록(editable false·읽기 전용)은 이어받지 않는다 — 필드에 수정 상태가 남으면 원문으로 고칠 길이 막힌다
      this.host.endEdit();
    }
  }

  get state(): unknown {
    return this.isEditing ? this.draft : this.base;
  }

  get editing(): boolean {
    return this.isEditing;
  }

  /** 지금 상태(state)의 판 — 수정 중이면 초안의 판, 아니면 기준의 판. iframe 에 보내는 from */
  get stateFrom(): number {
    return this.isEditing ? this.draftFrom : this.baseFrom;
  }

  /** 수정을 시작한 때 상태(수정 중이 아니면 undefined) — 다시 그릴 때 새 세션에 넘긴다 */
  get editBase(): unknown {
    return this.isEditing ? this.editStart : undefined;
  }

  /** 블록의 editable(바깥 변경을 따라간다) */
  get editable(): boolean {
    return this.isEditable;
  }

  private canChange() {
    return this.isEditable && !this.readOnly;
  }

  private notify() {
    this.host.changed({ state: this.state, editing: this.isEditing });
  }

  setState(patch: object): void {
    if (!this.canChange()) return;
    // 스프레드를 쓴다: Object.assign 은 "__proto__" 를 setter 로 받아 own 키로 남기지 않는다
    const next = this.pin({ ...(isRecord(this.state) ? this.state : {}), ...patch });
    if (this.isEditing) {
      this.draft = next;
      this.host.setDraft(next, this.draftFrom);
    } else {
      if (!this.host.write(next)) return;
      this.base = next;
      this.baseFrom = this.version;
    }
    this.notify();
  }

  requestEdit(): void {
    if (!this.canChange() || this.isEditing) return;
    this.isEditing = true;
    this.draft = this.base;
    this.editStart = this.base;
    this.draftFrom = this.baseFrom;
    this.host.startEdit(this.draft, this.draftFrom);
    this.notify();
  }

  /**
   * iframe 이 올린 상태(파일은 쓰지 않는다, 알리지 않는다 — iframe 은 이미 올린 상태로 그렸다).
   * 수정 중이면 초안을 바꾸고, 바꾸지 않은 초안이었으면 시작 상태도 올린 것으로(필드 base 도) — 끝낼 때 여전히 「같음」 이라 쓰지 않는다
   */
  adoptMigrated(state: unknown): void {
    const s = this.pin(state);
    if (!this.isEditing) {
      this.base = s;
      this.baseFrom = this.version;
      return;
    }
    const untouched = same(this.draft, this.editStart);
    this.draft = s;
    this.draftFrom = this.version;
    if (untouched) {
      this.editStart = s;
      this.host.setDraft(s, this.version, s);
    } else this.host.setDraft(s, this.version);
  }

  exitEdit(apply: boolean): void {
    if (!this.isEditing) return;
    const draft = this.draft;
    this.isEditing = false;
    this.draft = undefined;
    // 시작 때와 같은 초안은 쓰지 않는다 — 누르거나 포커스가 오가기만 해서는 파일이 바뀌면 안 되고,
    // 그사이 바깥 변경이 들어왔다면 옛 상태를 써서 그것을 되돌리게 된다. 바꾼 초안은 바깥 변경 위에 쓴다(블록이 원자 단위)
    if (apply && !same(draft, this.editStart) && this.host.write(draft)) {
      this.base = draft;
      this.baseFrom = this.version;
    }
    this.editStart = undefined;
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
  external(state: unknown, editable: boolean, from: number = this.version): void {
    this.base = state;
    this.baseFrom = from;
    this.isEditable = editable;
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
