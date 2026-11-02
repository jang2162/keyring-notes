/**
 * 문서 머리 제목 칸의 「확정하지 않은 입력」(docs/ops/ux.md 「비어 있는 새 노트를 닫으면 지운다」).
 * 칸은 blur·Enter 에서 이름을 바꾸는데, 키보드로 탭을 닫거나 같은 칸에서 다른 문서로 갈아 끼우면 blur 없이 칸이 사라지거나
 * 다른 문서를 보이게 된다. 그래서 칸이 사라지기 전에 Workspace 가 확정을 부르고 끝나기를 기다린다(settleTitles).
 * 여기 있는 것은 판정과 순서뿐 — 칸의 글·포커스는 DocPane.tsx 의 InlineTitle, 이름 바꾸기는 Workspace.tsx 의 renameNode.
 */

/** 제목 칸에서 고친 글: 고친 때의 노트 경로와 그 글이 뜻하는 노드 이름 */
export interface TitleEdit {
  path: string;
  name: string;
}

/** 확정의 결과. renamed·none 의 path 는 확정 뒤 그 노트의 경로(이름을 바꿨으면 새 경로) */
export type TitleOutcome =
  /** 확정할 것이 없다(고치지 않았거나 원래 이름 그대로) */
  | { kind: "none"; path: string | null }
  /** 보이는 노트의 이름이 잘못됐다 — 칸에 오류가 떠 있고 입력은 그대로 남는다 */
  | { kind: "invalid"; path: string }
  /** 이미 다른 노트로 넘어간 칸에 남은 잘못된 이름 — 보여 줄 곳이 없으니 버린다 */
  | { kind: "dropped"; path: string }
  | { kind: "renamed"; path: string; from: string }
  /**
   * 이름 바꾸기가 실패했다(같은 이름이 있음 등 — 알림은 이름 바꾸기가 띄운다). 보이는 노트의 입력이면 invalid 처럼 확정 대기로 남아
   * 사람이 이름을 고치거나 Esc 를 누를 때까지 닫기·갈아 끼우기가 다시 확정한다
   */
  | { kind: "failed"; path: string };

const stem = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "");

/** 노트 경로(…/A.md)를 같은 부모 아래 name 으로 바꾼 경로. Workspace 의 renameNode 가 옮기는 자리와 같다 */
export function renamedPath(notePath: string, name: string): string {
  const node = notePath.replace(/\.md$/i, "");
  const parent = node.includes("/") ? node.slice(0, node.lastIndexOf("/")) : "";
  return `${parent ? `${parent}/` : ""}${name}.md`;
}

/**
 * 한 제목 칸의 확정 안 한 입력과 진행 중인 확정. 칸이 blur 로 확정하는 중에 닫기가 확정을 부르면(탭 메뉴를 열면 blur 가 먼저 난다 — ✕ 와 가운데 버튼은 포커스를 옮기지 않는다)
 * 이름 바꾸기를 두 번 하지 않고 같은 결과를 기다린다
 */
export class TitleDraft {
  private edit: TitleEdit | null = null;
  private running: { from: string; done: Promise<TitleOutcome> } | null = null;

  /** 칸의 글을 고쳤다 */
  typed(edit: TitleEdit): void {
    this.edit = edit;
  }

  /** Esc: 확정하지 않는다 */
  cancel(): void {
    this.edit = null;
  }

  /** 확정을 기다려야 하는 노트의 경로(이름 바꾸는 중이거나, 원래와 다른 이름을 입력해 두었다). 없으면 null */
  pending(): string | null {
    if (this.running) return this.running.from;
    if (this.edit && this.edit.name !== stem(this.edit.path)) return this.edit.path;
    return null;
  }

  /**
   * 확정한다. shown 은 칸이 지금 보이는 노트(입력한 노트와 다를 수 있다 — 같은 칸에서 다른 노트로 바뀐 뒤의 blur).
   * 보이는 노트의 잘못된 이름과 실패한 이름 바꾸기는 입력을 남기고(invalid·failed), 이름 바꾸기가 끝날 때까지는 같은 결과를 돌려준다.
   * 실패를 남기는 까닭: 탭 메뉴를 열면 blur 확정이 먼저 끝나는데, 입력을 비우면 뒤따르는 닫기가 기다릴 것이 없다고 보고 닫는다
   */
  commit(shown: string, opts: { invalid: (name: string) => string | null; rename: (path: string, name: string) => Promise<boolean> }): Promise<TitleOutcome> {
    if (this.running) return this.running.done;
    const target = this.edit;
    if (!target || target.name === stem(target.path)) {
      this.edit = null;
      return Promise.resolve({ kind: "none", path: target?.path ?? null });
    }
    if (opts.invalid(target.name)) {
      if (target.path === shown) return Promise.resolve({ kind: "invalid", path: target.path });
      this.edit = null;
      return Promise.resolve({ kind: "dropped", path: target.path });
    }
    this.edit = null;
    const done = opts
      .rename(target.path, target.name)
      .catch(() => false)
      .then((ok): TitleOutcome => {
        if (ok) return { kind: "renamed", path: renamedPath(target.path, target.name), from: target.path };
        // 그 사이 새로 입력했으면 그것을 둔다. 다른 노트로 넘어간 칸의 입력은 보여 줄 곳이 없으니 버린다(dropped 와 같다)
        if (!this.edit && target.path === shown) this.edit = target;
        return { kind: "failed", path: target.path };
      })
      .finally(() => {
        this.running = null;
      });
    this.running = { from: target.path, done };
    return done;
  }
}

/** 칸이 밖(Workspace)에 내주는 제목 확정 */
export interface TitleHandle {
  /** 확정을 기다려야 하는 노트(TitleDraft.pending) */
  titlePending(): string | null;
  /** 그 노트의 확정 안 한 제목을 확정한다 */
  commitTitle(path: string): Promise<TitleOutcome>;
}

/**
 * 제목 칸이 사라지거나 다른 노트를 보이게 되기 전에(탭 닫기·갈아 끼우기·새 창으로 떼어 내기) path 의 확정 안 한 제목을 확정한다.
 * 확정 뒤 그 노트의 경로(이름을 바꿨으면 새 경로)를 돌려주고, 확정하지 못했으면(잘못된 이름·이름 바꾸기 실패) null —
 * 부른 쪽은 닫지 않는다. 입력한 칸이 없으면 기다리지 않고 path 그대로다
 */
export async function settleTitles(handles: Iterable<TitleHandle | null | undefined>, path: string): Promise<string | null> {
  let cur = path;
  for (const h of handles) {
    if (!h || h.titlePending() !== cur) continue;
    const r = await h.commitTitle(cur);
    if (r.kind === "invalid" || r.kind === "failed") return null;
    if (r.kind === "renamed" && r.from === cur) cur = r.path;
  }
  return cur;
}

/** 확정을 기다려야 하는 칸이 있는가(없으면 부른 쪽은 기다리지 않고 바로 진행한다) */
export function titlePendingIn(handles: Iterable<TitleHandle | null | undefined>, path: string): boolean {
  for (const h of handles) if (h?.titlePending() === path) return true;
  return false;
}
