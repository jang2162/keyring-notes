import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight, File, FileImage, FileText, FileType, Folder, FolderOpen } from "lucide-react";
import type { TreeNode } from "./api";
import type { Prefs } from "./prefs";
import { Menu, type MenuEntry } from "./ui";

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const isMd = (p: string) => /\.md$/i.test(p);

/** 파일·폴더 이름으로 못 쓰는 글자. 이유(없으면 null) */
export function invalidNameReason(name: string): string | null {
  const n = name.trim();
  if (!n) return "이름을 입력하세요.";
  const bad = /[\\/:*?"<>|]/.exec(n);
  if (bad) return `이름에 "${bad[0]}" 글자는 쓸 수 없습니다.`;
  if (n.startsWith(".")) return "이름을 점(.)으로 시작할 수 없습니다(숨김 파일이 됩니다).";
  if (/[#^[\]]/.test(n)) return "#, ^, [, ] 글자는 링크와 겹쳐 쓸 수 없습니다.";
  return null;
}

export const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const stemOf = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "");

export interface TreeActions {
  open: (path: string, opts?: { newTab?: boolean }) => void;
  /** 마크다운이 아닌 파일(첨부) 열기 */
  openAttachment: (path: string) => void;
  newDoc: (folder: string) => void;
  newFolder: (parent: string) => void;
  /** 문서 이름 바꾸기(새 이름: 확장자 없이) 또는 폴더 이름 바꾸기 */
  rename: (path: string, kind: "dir" | "file", name: string) => Promise<boolean>;
  /** 끌어 놓기·이동: folder("" = 맨 위)로 */
  move: (path: string, kind: "dir" | "file", folder: string) => void;
  /** 폴더 고르기 창으로 이동 */
  moveTo: (path: string, kind: "dir" | "file") => void;
  duplicate: (path: string) => void;
  remove: (path: string) => void;
  copyPath: (path: string) => void;
  copyLink: (path: string) => void;
  openAside: (path: string) => void;
  /** 아이콘 고르기(문서: 프런트매터 icon, 폴더: 공통 설정) */
  pickIcon: (path: string, kind: "dir" | "file", at: { x: number; y: number }) => void;
}

/** 트리 표시를 바꾸는 것들(모두 선택) */
export interface TreeDecor {
  /** 이름 대신 보일 것(데일리 노트: 날짜 흐리게·제목 진하게) */
  label?: (path: string) => ReactNode;
  /** 문서·폴더 아이콘(이모지) */
  icon?: (node: TreeNode) => string | null;
  /** 트리에서 숨길 파일(공통 설정 파일) */
  hidden?: (path: string) => boolean;
  /** 이 폴더 안은 이름 내림차순(데일리 폴더: 최신이 위로) */
  descending?: (dir: string) => boolean;
}

export interface TreeHandle {
  /** 지금 문서가 보이게 상위 폴더를 펴고 그 줄로 */
  reveal: () => void;
  collapseAll: () => void;
  focus: () => void;
  /** 그 경로를 이름 바꾸기 상태로 */
  startRename: (path: string) => void;
}

interface Row {
  node: TreeNode;
  depth: number;
}

const OPEN_KEY = "keyring:tree-open";

function loadOpen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** 트리 표시 옵션을 적용한 자식 순서: 폴더 → 문서 → (아래로 모으기면) 첨부 */
function visibleChildren(nodes: TreeNode[], prefs: Pick<Prefs, "treeAttachments" | "treeHideAttachmentFolders">, decor: TreeDecor, dir: string): TreeNode[] {
  let out = nodes.filter((n) => !(n.type === "dir" && prefs.treeHideAttachmentFolders && n.name.toLowerCase() === "attachments") && !(n.type === "file" && decor.hidden?.(n.path)));
  if (decor.descending?.(dir)) out = [...out].sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : b.name.localeCompare(a.name, "ko")));
  if (prefs.treeAttachments === "hide") out = out.filter((n) => n.type === "dir" || isMd(n.path));
  if (prefs.treeAttachments === "bottom") {
    const rank = (n: TreeNode) => (n.type === "dir" ? 0 : isMd(n.path) ? 1 : 2);
    out = [...out].sort((a, b) => rank(a) - rank(b));
  }
  return out;
}

function NodeIcon({ node, open, emoji }: { node: TreeNode; open: boolean; emoji?: string | null }) {
  if (emoji) return <span className="doc-icon tree-emoji" aria-hidden>{emoji}</span>;
  const props = { size: 16, strokeWidth: 1.75, "aria-hidden": true, className: "tree-icon" } as const;
  if (node.type === "dir") return open ? <FolderOpen {...props} /> : <Folder {...props} />;
  if (isMd(node.path)) return <FileText {...props} />;
  if (IMAGE.test(node.path)) return <FileImage {...props} />;
  if (/\.pdf$/i.test(node.path)) return <FileType {...props} />;
  return <File {...props} />;
}

export const Tree = forwardRef<TreeHandle, { nodes: TreeNode[]; current: string | null; prefs: Prefs; actions: TreeActions; readOnly?: (path: string) => boolean; decor?: TreeDecor }>(function Tree(
  { nodes, current, prefs, actions, readOnly = () => false, decor = {} },
  ref,
) {
  const [open, setOpen] = useState(loadOpen);
  const [focused, setFocused] = useState<string | null>(current);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragging = useRef<TreeNode | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...open].slice(0, 500)));
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
  }, [open]);

  // 지금 문서의 상위 폴더는 편다
  useEffect(() => {
    if (!current) return;
    setFocused(current);
    const parts = current.split("/").slice(0, -1);
    if (parts.length === 0) return;
    setOpen((o) => {
      const next = new Set(o);
      let changed = false;
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join("/");
        if (!next.has(p)) {
          next.add(p);
          changed = true;
        }
      }
      return changed ? next : o;
    });
  }, [current]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (ns: TreeNode[], depth: number, dir: string) => {
      for (const n of visibleChildren(ns, prefs, decor, dir)) {
        out.push({ node: n, depth });
        if (n.type === "dir" && open.has(n.path)) walk(n.children ?? [], depth + 1, n.path);
      }
    };
    walk(nodes, 0, "");
    return out;
  }, [nodes, open, prefs, decor]);

  const scrollTo = (path: string) => {
    requestAnimationFrame(() => box.current?.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "nearest" }));
  };

  useImperativeHandle(ref, () => ({
    reveal() {
      if (!current) return;
      const parts = current.split("/").slice(0, -1);
      setOpen((o) => new Set([...o, ...parts.map((_, i) => parts.slice(0, i + 1).join("/"))]));
      setFocused(current);
      scrollTo(current);
      box.current?.focus();
    },
    collapseAll() {
      setOpen(new Set());
    },
    focus() {
      box.current?.focus();
    },
    startRename(path) {
      setRenaming(path);
      scrollTo(path);
    },
  }));

  const toggle = (path: string, to?: boolean) =>
    setOpen((o) => {
      const next = new Set(o);
      if (to ?? !next.has(path)) next.add(path);
      else next.delete(path);
      return next;
    });

  const activate = (n: TreeNode, newTab = false) => {
    setFocused(n.path);
    if (n.type === "dir") toggle(n.path);
    else if (isMd(n.path)) actions.open(n.path, { newTab });
    else actions.openAttachment(n.path);
  };

  /** 메뉴를 연 자리(아이콘 고르기 창을 그 근처에) */
  const menuAt = () => ({ x: menu?.x ?? 40, y: menu?.y ?? 40 });

  const menuFor = (n: TreeNode | null): MenuEntry[] => {
    if (!n) return [
      { label: "새 문서", run: () => actions.newDoc("") },
      { label: "새 폴더", run: () => actions.newFolder("") },
    ];
    if (n.type === "dir")
      return [
        { label: "새 문서", run: () => actions.newDoc(n.path) },
        { label: "새 폴더", run: () => actions.newFolder(n.path) },
        "-",
        { label: "이름 바꾸기", keys: "F2", run: () => setRenaming(n.path) },
        { label: "다른 폴더로 옮기기…", run: () => actions.moveTo(n.path, "dir") },
        { label: "아이콘 바꾸기…", run: () => actions.pickIcon(n.path, "dir", menuAt()) },
        "-",
        { label: "경로 복사", run: () => actions.copyPath(n.path) },
      ];
    if (!isMd(n.path))
      return [
        { label: "열기", run: () => actions.openAttachment(n.path) },
        "-",
        { label: "이름 바꾸기", keys: "F2", run: () => setRenaming(n.path) },
        { label: "다른 폴더로 옮기기…", run: () => actions.moveTo(n.path, "file") },
        "-",
        { label: "경로 복사", run: () => actions.copyPath(n.path) },
        { label: "링크 복사", run: () => actions.copyLink(n.path) },
      ];
    const ro = readOnly(n.path);
    return [
      { label: "열기", run: () => actions.open(n.path) },
      { label: "새 탭에서 열기", keys: "Mod+Enter", run: () => actions.open(n.path, { newTab: true }) },
      { label: "옆에 미리보기로 열기", run: () => actions.openAside(n.path) },
      "-",
      { label: "이름 바꾸기", keys: "F2", disabled: ro, run: () => setRenaming(n.path) },
      { label: "다른 폴더로 옮기기…", disabled: ro, run: () => actions.moveTo(n.path, "file") },
      { label: "복제", run: () => actions.duplicate(n.path) },
      { label: "아이콘 바꾸기…", disabled: ro, run: () => actions.pickIcon(n.path, "file", menuAt()) },
      "-",
      { label: "경로 복사", run: () => actions.copyPath(n.path) },
      { label: "링크 복사", run: () => actions.copyLink(n.path) },
      "-",
      { label: "삭제", keys: "Delete", danger: true, disabled: ro, run: () => actions.remove(n.path) },
    ];
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (renaming || (e.target as HTMLElement).tagName === "INPUT") return;
    const i = rows.findIndex((r) => r.node.path === focused);
    const row = rows[i];
    const go = (j: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
      if (!r) return;
      setFocused(r.node.path);
      scrollTo(r.node.path);
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        go(i + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        go(i < 0 ? 0 : i - 1);
        break;
      case "Home":
        e.preventDefault();
        go(0);
        break;
      case "End":
        e.preventDefault();
        go(rows.length - 1);
        break;
      case "ArrowRight":
        if (!row) return;
        e.preventDefault();
        if (row.node.type === "dir") {
          if (!open.has(row.node.path)) toggle(row.node.path, true);
          else go(i + 1);
        }
        break;
      case "ArrowLeft": {
        if (!row) return;
        e.preventDefault();
        if (row.node.type === "dir" && open.has(row.node.path)) toggle(row.node.path, false);
        else {
          const parent = parentOf(row.node.path);
          if (parent) {
            setFocused(parent);
            scrollTo(parent);
          }
        }
        break;
      }
      case "Enter":
        if (!row) return;
        e.preventDefault();
        activate(row.node, e.ctrlKey || e.metaKey);
        break;
      case "F2":
        if (!row || (row.node.type === "file" && readOnly(row.node.path))) return;
        e.preventDefault();
        setRenaming(row.node.path);
        break;
      case "Delete":
        if (!row || row.node.type !== "file" || !isMd(row.node.path) || readOnly(row.node.path)) return;
        e.preventDefault();
        actions.remove(row.node.path);
        break;
      case "ContextMenu": {
        if (!row) return;
        e.preventDefault();
        const r = box.current?.querySelector(`[data-path="${CSS.escape(row.node.path)}"]`)?.getBoundingClientRect();
        setMenu({ x: (r?.left ?? 0) + 24, y: r?.bottom ?? 0, node: row.node });
        break;
      }
    }
  };

  // ── 끌어 옮기기: 문서·폴더를 폴더(또는 빈 곳 = 맨 위)에 놓는다
  const canDrop = (target: string) => {
    const d = dragging.current;
    if (!d) return false;
    if (parentOf(d.path) === target) return false;
    if (d.type === "dir" && (target === d.path || target.startsWith(d.path + "/"))) return false;
    return true;
  };
  const dragOver = (e: DragEvent, target: string, node?: TreeNode) => {
    if (!dragging.current || !canDrop(target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== target) {
      setDropTarget(target);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      // 닫힌 폴더 위에 잠시 머무르면 편다
      if (node && node.type === "dir" && !open.has(node.path)) hoverTimer.current = setTimeout(() => toggle(node.path, true), 650);
    }
  };
  const drop = (e: DragEvent, target: string) => {
    const d = dragging.current;
    if (!d || !canDrop(target)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    dragging.current = null;
    actions.move(d.path, d.type, target);
  };
  const dragEnd = () => {
    dragging.current = null;
    setDropTarget(null);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  };

  const inCurrent = (dir: string) => !!current && current.startsWith(dir + "/");

  return (
    <div
      ref={box}
      className={`tree${dropTarget === "" ? " drop-root" : ""}`}
      role="tree"
      aria-label="파일"
      tabIndex={0}
      aria-activedescendant={focused ? `tree-${encodeURIComponent(focused)}` : undefined}
      onKeyDown={onKey}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, node: null });
      }}
      onDragOver={(e) => dragOver(e, "")}
      onDragLeave={(e) => e.target === e.currentTarget && setDropTarget(null)}
      onDrop={(e) => drop(e, "")}
    >
      {rows.map(({ node: n, depth }) => {
        const isOpen = n.type === "dir" && open.has(n.path);
        const md = n.type === "file" && isMd(n.path);
        const cls = [
          "tree-row",
          n.type,
          !md && n.type === "file" ? "attachment" : "",
          n.path === current ? "current" : "",
          n.type === "dir" && inCurrent(n.path) ? "ancestor" : "",
          n.path === focused ? "focused" : "",
          dropTarget === n.path ? "drop" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div
            key={n.path}
            id={`tree-${encodeURIComponent(n.path)}`}
            data-path={n.path}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={n.type === "dir" ? isOpen : undefined}
            aria-selected={n.path === current}
            className={cls}
            style={{ paddingLeft: 6 + depth * 14 }}
            draggable={renaming !== n.path && (n.type === "dir" || !readOnly(n.path))}
            onDragStart={(e) => {
              dragging.current = n;
              e.dataTransfer.effectAllowed = "move";
              // 에디터에 놓으면 링크가 들어가게
              e.dataTransfer.setData("text/plain", md ? `[[${stemOf(n.path)}]]` : n.path);
            }}
            onDragEnd={dragEnd}
            onDragOver={(e) => (n.type === "dir" ? dragOver(e, n.path, n) : dragOver(e, parentOf(n.path)))}
            onDrop={(e) => drop(e, n.type === "dir" ? n.path : parentOf(n.path))}
            onClick={(e) => {
              if (renaming === n.path) return;
              activate(n, e.ctrlKey || e.metaKey);
            }}
            onAuxClick={(e) => {
              if (e.button !== 1 || !md) return;
              e.preventDefault();
              actions.open(n.path, { newTab: true });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setFocused(n.path);
              setMenu({ x: e.clientX, y: e.clientY, node: n });
            }}
          >
            {Array.from({ length: depth }, (_, i) => (
              <span key={i} className="tree-guide" style={{ left: 13 + i * 14 }} aria-hidden />
            ))}
            <span className={`tree-chevron${isOpen ? " open" : ""}`} aria-hidden>
              {n.type === "dir" && <ChevronRight size={14} strokeWidth={2} />}
            </span>
            <NodeIcon node={n} open={isOpen} emoji={decor.icon?.(n)} />
            {renaming === n.path ? (
              <RenameInput
                initial={n.type === "dir" ? n.name : md ? stemOf(n.path) : n.name}
                onDone={async (name) => {
                  if (name === null) {
                    setRenaming(null);
                    box.current?.focus();
                    return;
                  }
                  const ok = await actions.rename(n.path, n.type, name);
                  if (ok) {
                    setRenaming(null);
                    box.current?.focus();
                  }
                }}
              />
            ) : (
              <span className="tree-name">{md ? (decor.label?.(n.path) ?? stemOf(n.path)) : n.name}</span>
            )}
          </div>
        );
      })}
      {rows.length === 0 && <p className="meta tree-empty">문서가 없습니다. 오른쪽 클릭이나 위의 ＋로 새 문서를 만드세요.</p>}
      {menu && <Menu at={menu} items={menuFor(menu.node)} onClose={() => setMenu(null)} />}
    </div>
  );
});

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => Promise<void> | void }) {
  const [v, setV] = useState(initial);
  const err = v.trim() === initial ? null : invalidNameReason(v);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    const n = name?.trim() ?? null;
    if (n !== null && n !== initial && invalidNameReason(n)) return; // 고칠 때까지 그대로
    done.current = true;
    // Enter 뒤 칸이 사라지며 생기는 blur로 두 번 부르지 않는다. 실패해서 칸이 남으면 다시 고칠 수 있게 푼다
    void Promise.resolve(onDone(n === null || n === initial ? null : n)).finally(() => (done.current = false));
  };
  return (
    <span className="tree-rename">
      <input
        autoFocus
        value={v}
        aria-label="새 이름"
        aria-invalid={!!err}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setV(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            finish(v);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(null);
          }
        }}
        onBlur={() => finish(err ? null : v)}
      />
      {err && <span className="tree-rename-error" role="alert">{err}</span>}
    </span>
  );
}
