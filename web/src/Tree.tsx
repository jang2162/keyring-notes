import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight, File, FileImage, FileText, FileType, Paperclip, Plus } from "lucide-react";
import { tipProps } from "./Tooltip";
import { stripMd, type VaultNode } from "@keyring-notes/core";
import type { Prefs } from "./prefs";
import { Menu, type MenuEntry } from "./ui";
import { t } from "./i18n";

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/** 노드·파일 이름으로 못 쓰는 글자. 이유(없으면 null) */
export function invalidNameReason(name: string): string | null {
  const n = name.trim();
  if (!n) return t("name.empty");
  const bad = /[\\/:*?"<>|]/.exec(n);
  if (bad) return t("name.badChar", { char: bad[0] });
  if (n.startsWith(".")) return t("name.dotStart");
  if (/[#^[\]]/.test(n)) return t("name.linkChar");
  return null;
}

export const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const stemOf = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "");

export interface TreeActions {
  /** 노드 열기(노트가 없으면 빈 노드로 연다) */
  open: (node: VaultNode, opts?: { newTab?: boolean }) => void;
  /** 노드 안의 첨부 열기 */
  openAttachment: (path: string) => void;
  /** 첨부를 문서로 끌어 놓을 때 넣을 글(embed 링크). 없으면 경로 */
  embedText?: (path: string) => string;
  /** 하위 노트 만들기(parent ""면 맨 위 = 지금 워크스페이스) */
  newChild: (parent: string) => void;
  /** 노드 이름 바꾸기(노트와 하위를 한 번에) 또는 첨부 이름 바꾸기 */
  rename: (path: string, kind: "node" | "file", name: string) => Promise<boolean>;
  /** 끌어 놓기: target 노드의 하위로(""면 맨 위) */
  move: (path: string, kind: "node" | "file", target: string) => void;
  /** 노드 고르기 창으로 옮기기 */
  moveTo: (path: string, kind: "node" | "file") => void;
  duplicate: (node: VaultNode) => void;
  remove: (path: string, kind: "node" | "file") => void;
  copyPath: (path: string) => void;
  copyLink: (path: string) => void;
  openOther: (path: string) => void;
  /** 아이콘 고르기(노드 노트의 icon 속성. 노트가 없으면 그때 만든다) */
  pickIcon: (node: VaultNode, at: { x: number; y: number }) => void;
  /** 고정했는지·고정 바꾸기(워크스페이스 노드는 고정하지 않는다) */
  pinned: (node: string) => boolean;
  togglePin: (node: string) => void;
}

/** 트리 표시를 바꾸는 것들(모두 선택) */
export interface TreeDecor {
  /** 이름 대신 보일 것(데일리 노트: 날짜 흐리게·제목 진하게) */
  label?: (node: VaultNode) => ReactNode;
  /** 노드 아이콘(이모지) */
  icon?: (node: VaultNode) => string | null;
  /** 이 노드의 하위는 이름 내림차순(데일리 폴더: 최신이 위로) */
  descending?: (node: string) => boolean;
}

export interface TreeHandle {
  /** 지금 문서가 보이게 상위 노드를 펴고 그 줄로 */
  reveal: () => void;
  collapseAll: () => void;
  focus: () => void;
  /** 그 노드를 이름 바꾸기 상태로 */
  startRename: (path: string) => void;
}

type Row =
  | { kind: "node"; node: VaultNode; depth: number }
  | { kind: "attachments"; node: VaultNode; depth: number }
  | { kind: "file"; path: string; owner: VaultNode; depth: number };

const rowKey = (r: Row) => (r.kind === "node" ? r.node.path : r.kind === "attachments" ? `${r.node.path}/\u0000att` : r.path);

function loadOpen(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function FileIcon({ path }: { path: string }) {
  const props = { size: 15, strokeWidth: 1.75, "aria-hidden": true, className: "tree-icon" } as const;
  if (IMAGE.test(path)) return <FileImage {...props} />;
  if (/\.pdf$/i.test(path)) return <FileType {...props} />;
  return <File {...props} />;
}

export const Tree = forwardRef<
  TreeHandle,
  {
    nodes: VaultNode[];
    /** 맨 위 노드 경로(워크스페이스, 모든 워크스페이스면 "") */
    root: string;
    current: string | null;
    prefs: Prefs;
    actions: TreeActions;
    readOnly?: (path: string) => boolean;
    decor?: TreeDecor;
    /** 펼친 노드를 기억할 localStorage 키(워크스페이스마다) */
    storageKey: string;
  }
>(function Tree({ nodes, root, current, prefs, actions, readOnly = () => false, decor = {}, storageKey }, ref) {
  const currentNode = current ? stripMd(current) : null;
  const [open, setOpen] = useState(() => loadOpen(storageKey));
  const [focused, setFocused] = useState<string | null>(currentNode);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; row: Row | null } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragging = useRef<{ path: string; kind: "node" | "file" } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const loadedKey = useRef(storageKey);

  // 워크스페이스를 바꾸면 그 워크스페이스의 펼침을 읽는다
  useEffect(() => {
    if (loadedKey.current === storageKey) return;
    loadedKey.current = storageKey;
    setOpen(loadOpen(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (loadedKey.current !== storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...open].slice(0, 500)));
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
  }, [open, storageKey]);

  const ancestors = (p: string) => {
    const parts = p.split("/");
    const out: string[] = [];
    for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
    return out;
  };

  // 지금 문서의 상위 노드는 편다
  useEffect(() => {
    if (!currentNode) return;
    setFocused(currentNode);
    setOpen((o) => {
      const add = ancestors(currentNode).filter((p) => !o.has(p));
      return add.length ? new Set([...o, ...add]) : o;
    });
  }, [currentNode]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (ns: VaultNode[], depth: number, parent: string) => {
      const list = decor.descending?.(parent) ? [...ns].sort((a, b) => b.name.localeCompare(a.name, "ko")) : ns;
      for (const n of list) {
        out.push({ kind: "node", node: n, depth });
        if (!open.has(n.path)) continue;
        walk(n.children, depth + 1, n.path);
        if (prefs.treeAttachments !== "hide" && n.attachments.length) {
          out.push({ kind: "attachments", node: n, depth: depth + 1 });
          if (open.has(`${n.path}/\u0000att`)) for (const a of n.attachments) out.push({ kind: "file", path: a, owner: n, depth: depth + 2 });
        }
      }
    };
    walk(nodes, 0, root);
    return out;
  }, [nodes, open, prefs.treeAttachments, decor, root]);

  const scrollTo = (key: string) => {
    requestAnimationFrame(() => box.current?.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" }));
  };

  useImperativeHandle(ref, () => ({
    reveal() {
      if (!currentNode) return;
      setOpen((o) => new Set([...o, ...ancestors(currentNode)]));
      setFocused(currentNode);
      scrollTo(currentNode);
      box.current?.focus();
    },
    collapseAll() {
      setOpen(new Set());
    },
    focus() {
      box.current?.focus();
    },
    startRename(path) {
      setRenaming(stripMd(path));
      scrollTo(stripMd(path));
    },
  }));

  const toggle = (key: string, to?: boolean) =>
    setOpen((o) => {
      const next = new Set(o);
      if (to ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });

  const expandable = (n: VaultNode) => n.children.length > 0 || (prefs.treeAttachments !== "hide" && n.attachments.length > 0);

  /**
   * 노트는 새 탭에 연다(이미 열린 노트면 Workspace 가 그 탭으로 간다). 워크스페이스 행(모든 워크스페이스 보기의 맨 위)은
   * 그 노트를 열지 않으므로(workspaceNote.ts) 펴고 접기만 한다
   */
  const activate = (r: Row) => {
    setFocused(rowKey(r));
    if (r.kind === "node" && !r.node.path.includes("/")) toggle(r.node.path);
    else if (r.kind === "node") actions.open(r.node, { newTab: true });
    else if (r.kind === "attachments") toggle(rowKey(r));
    else actions.openAttachment(r.path);
  };

  /** 메뉴를 연 자리(아이콘 고르기 창을 그 근처에) */
  const menuAt = () => ({ x: menu?.x ?? 40, y: menu?.y ?? 40 });

  const menuFor = (r: Row | null): MenuEntry[] => {
    if (!r) return root ? [{ label: t("tree.newNote"), run: () => actions.newChild("") }] : [];
    if (r.kind === "attachments") return [];
    if (r.kind === "file")
      return [
        { label: t("common.open"), run: () => actions.openAttachment(r.path) },
        "-",
        { label: t("common.rename"), keys: "F2", run: () => setRenaming(r.path) },
        { label: t("tree.moveTo"), run: () => actions.moveTo(r.path, "file") },
        "-",
        { label: t("tree.copyPath"), run: () => actions.copyPath(r.path) },
        { label: t("tree.copyLink"), run: () => actions.copyLink(r.path) },
        "-",
        { label: t("common.delete"), danger: true, run: () => actions.remove(r.path, "file") },
      ];
    const n = r.node;
    const ro = n.note !== null && readOnly(n.note);
    const isWs = !n.path.includes("/");
    return [
      ...(isWs
        ? []
        : ([
            { label: t("tree.openHere"), run: () => actions.open(n) },
            { label: t("tree.openNewTab"), keys: "Mod+Enter", run: () => actions.open(n, { newTab: true }) },
            ...(n.note ? [{ label: t("doc.openOther"), run: () => actions.openOther(n.note!) }] : []),
            "-",
          ] satisfies MenuEntry[])),
      { label: t("tree.newChild"), run: () => actions.newChild(n.path) },
      "-",
      { label: t("common.rename"), keys: "F2", disabled: ro || isWs, run: () => setRenaming(n.path) },
      { label: t("tree.moveTo"), disabled: ro || isWs, run: () => actions.moveTo(n.path, "node") },
      ...(n.note && !isWs ? [{ label: t("tree.duplicate"), run: () => actions.duplicate(n) }] : []),
      { label: t("tree.changeIcon"), disabled: ro, run: () => actions.pickIcon(n, menuAt()) },
      ...(isWs ? [] : [{ label: actions.pinned(n.path) ? t("tree.unpin") : t("tree.pin"), run: () => actions.togglePin(n.path) }]),
      "-",
      { label: t("tree.copyPath"), run: () => actions.copyPath(n.note ?? n.path) },
      ...(n.note ? [{ label: t("tree.copyLink"), run: () => actions.copyLink(n.note!) }] : []),
      "-",
      { label: t("tree.deleteNode"), keys: "Delete", danger: true, disabled: ro || isWs, run: () => actions.remove(n.path, "node") },
    ];
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (renaming || (e.target as HTMLElement).tagName === "INPUT") return;
    const i = rows.findIndex((r) => rowKey(r) === focused);
    const row = rows[i];
    const go = (j: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
      if (!r) return;
      setFocused(rowKey(r));
      scrollTo(rowKey(r));
    };
    const isOpen = (r: Row) => open.has(rowKey(r));
    const canOpen = (r: Row) => (r.kind === "node" ? expandable(r.node) : r.kind === "attachments");
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
        if (canOpen(row)) {
          if (!isOpen(row)) toggle(rowKey(row), true);
          else go(i + 1);
        }
        break;
      case "ArrowLeft": {
        if (!row) return;
        e.preventDefault();
        if (canOpen(row) && isOpen(row)) toggle(rowKey(row), false);
        else {
          const parentDepth = row.depth - 1;
          for (let j = i - 1; j >= 0; j--) {
            if (rows[j].depth === parentDepth) {
              go(j);
              break;
            }
          }
        }
        break;
      }
      case "Enter":
        if (!row) return;
        e.preventDefault();
        activate(row);
        break;
      case "F2":
        if (!row || row.kind === "attachments") return;
        if (row.kind === "node" && ((row.node.note && readOnly(row.node.note)) || !row.node.path.includes("/"))) return;
        e.preventDefault();
        setRenaming(row.kind === "node" ? row.node.path : row.path);
        break;
      case "Delete":
        if (!row || row.kind === "attachments") return;
        if (row.kind === "node" && ((row.node.note && readOnly(row.node.note)) || !row.node.path.includes("/"))) return;
        e.preventDefault();
        actions.remove(row.kind === "node" ? row.node.path : row.path, row.kind === "node" ? "node" : "file");
        break;
      case "ContextMenu": {
        if (!row) return;
        e.preventDefault();
        const r = box.current?.querySelector(`[data-key="${CSS.escape(rowKey(row))}"]`)?.getBoundingClientRect();
        setMenu({ x: (r?.left ?? 0) + 24, y: r?.bottom ?? 0, row });
        break;
      }
    }
  };

  // ── 끌어 옮기기: 노드를 다른 노드 위에 놓으면 그 노드의 하위가 된다(빈 곳 = 맨 위)
  const parentOfKey = (p: string, kind: "node" | "file") => (kind === "node" ? parentOf(p) : parentOf(p));
  const canDrop = (target: string) => {
    const d = dragging.current;
    if (!d) return false;
    if (parentOfKey(d.path, d.kind) === target) return false;
    if (d.kind === "node" && (target === d.path || target.startsWith(d.path + "/"))) return false;
    // 맨 위(모든 워크스페이스 보기)에는 놓을 수 없다: 루트에 일반 노트를 두지 않는다
    if (target === "") return false;
    return true;
  };
  const dragOver = (e: DragEvent, target: string, node?: VaultNode) => {
    if (!dragging.current || !canDrop(target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== target) {
      setDropTarget(target);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      // 닫힌 노드 위에 잠시 머무르면 편다
      if (node && expandable(node) && !open.has(node.path)) hoverTimer.current = setTimeout(() => toggle(node.path, true), 650);
    }
  };
  const drop = (e: DragEvent, target: string) => {
    const d = dragging.current;
    if (!d || !canDrop(target)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    dragging.current = null;
    actions.move(d.path, d.kind, target);
  };
  const dragEnd = () => {
    dragging.current = null;
    setDropTarget(null);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  };

  const inCurrent = (node: string) => !!currentNode && currentNode.startsWith(node + "/");

  return (
    <div
      ref={box}
      className={`tree${dropTarget === root && root ? " drop-root" : ""}`}
      role="tree"
      aria-label={t("tree.label")}
      tabIndex={0}
      aria-activedescendant={focused ? `tree-${encodeURIComponent(focused)}` : undefined}
      onKeyDown={onKey}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, row: null });
      }}
      onDragOver={(e) => dragOver(e, root)}
      onDragLeave={(e) => e.target === e.currentTarget && setDropTarget(null)}
      onDrop={(e) => drop(e, root)}
    >
      {rows.map((r) => {
        const key = rowKey(r);
        const guides = Array.from({ length: r.depth }, (_, i) => <span key={i} className="tree-guide" style={{ left: 13 + i * 14 }} aria-hidden />);
        if (r.kind === "attachments") {
          const isOpen = open.has(key);
          return (
            <div
              key={key}
              id={`tree-${encodeURIComponent(key)}`}
              data-key={key}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={isOpen}
              className={`tree-row attachments-row${key === focused ? " focused" : ""}`}
              style={{ paddingLeft: 6 + r.depth * 14 }}
              onClick={() => activate(r)}
            >
              {guides}
              <span className={`tree-chevron${isOpen ? " open" : ""}`} aria-hidden>
                <ChevronRight size={14} strokeWidth={2} />
              </span>
              <Paperclip size={14} strokeWidth={1.75} aria-hidden className="tree-icon" />
              <span className="tree-name meta">{t("tree.attachments", { count: r.node.attachments.length })}</span>
            </div>
          );
        }
        if (r.kind === "file") {
          const cls = ["tree-row", "file", "attachment", key === focused ? "focused" : ""].filter(Boolean).join(" ");
          return (
            <div
              key={key}
              id={`tree-${encodeURIComponent(key)}`}
              data-key={key}
              role="treeitem"
              aria-level={r.depth + 1}
              className={cls}
              style={{ paddingLeft: 6 + r.depth * 14 }}
              draggable={renaming !== key}
              onDragStart={(e) => {
                dragging.current = { path: r.path, kind: "file" };
                // 트리 안에서는 옮기기, 문서(에디터)에 놓으면 embed 링크가 들어간다
                e.dataTransfer.effectAllowed = "copyMove";
                e.dataTransfer.setData("text/plain", actions.embedText?.(r.path) ?? r.path);
              }}
              onDragEnd={dragEnd}
              onClick={() => renaming !== key && activate(r)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setFocused(key);
                setMenu({ x: e.clientX, y: e.clientY, row: r });
              }}
            >
              {guides}
              <span className="tree-chevron" aria-hidden />
              <FileIcon path={r.path} />
              {renaming === key ? (
                <RenameInput
                  initial={r.path.split("/").pop()!}
                  onDone={async (name) => {
                    if (name === null || (await actions.rename(r.path, "file", name))) {
                      setRenaming(null);
                      box.current?.focus();
                    }
                  }}
                />
              ) : (
                <span className="tree-name">{r.path.split("/").pop()}</span>
              )}
            </div>
          );
        }
        const n = r.node;
        const isOpen = open.has(n.path);
        const canExpand = expandable(n);
        const emoji = decor.icon?.(n);
        const cls = [
          "tree-row",
          "node",
          n.note ? "" : "empty-node",
          n.path === currentNode ? "current" : "",
          inCurrent(n.path) ? "ancestor" : "",
          key === focused ? "focused" : "",
          dropTarget === n.path ? "drop" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const ro = n.note !== null && readOnly(n.note);
        return (
          <div
            key={key}
            id={`tree-${encodeURIComponent(key)}`}
            data-key={key}
            role="treeitem"
            aria-level={r.depth + 1}
            aria-expanded={canExpand ? isOpen : undefined}
            aria-selected={n.path === currentNode}
            className={cls}
            style={{ paddingLeft: 6 + r.depth * 14 }}
            draggable={renaming !== n.path && !ro && n.path.includes("/")}
            onDragStart={(e) => {
              dragging.current = { path: n.path, kind: "node" };
              e.dataTransfer.effectAllowed = "move";
              // 에디터에 놓으면 링크가 들어가게
              e.dataTransfer.setData("text/plain", `[[${n.name}]]`);
            }}
            onDragEnd={dragEnd}
            onDragOver={(e) => dragOver(e, n.path, n)}
            onDrop={(e) => drop(e, n.path)}
            onClick={(e) => {
              if (renaming === n.path) return;
              // 화살표를 누르면 펴기·접기만, 이름을 누르면 노트를 연다
              if ((e.target as HTMLElement).closest(".tree-chevron")) {
                if (canExpand) toggle(n.path);
                return;
              }
              activate(r);
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              if (n.path.includes("/")) actions.open(n, { newTab: true });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setFocused(key);
              setMenu({ x: e.clientX, y: e.clientY, row: r });
            }}
          >
            {guides}
            <span className={`tree-chevron${isOpen ? " open" : ""}${canExpand ? " can" : ""}`} aria-hidden>
              {canExpand && <ChevronRight size={14} strokeWidth={2} />}
            </span>
            {emoji ? (
              <span className="doc-icon tree-emoji" aria-hidden>
                {emoji}
              </span>
            ) : (
              <FileText size={15} strokeWidth={1.75} aria-hidden className="tree-icon" />
            )}
            {renaming === n.path ? (
              <RenameInput
                initial={n.name}
                onDone={async (name) => {
                  if (name === null || (await actions.rename(n.path, "node", name))) {
                    setRenaming(null);
                    box.current?.focus();
                  }
                }}
              />
            ) : (
              <span className="tree-name">{decor.label?.(n) ?? n.name}</span>
            )}
            {renaming !== n.path && (
              // 마우스를 올리면 보이는 "하위 노트 추가"(메뉴의 같은 항목). 행 클릭·끌기와 따로 논다
              <button
                type="button"
                className="tree-add"
                tabIndex={-1}
                draggable={false}
                {...tipProps({ label: t("tree.newChild"), side: "right" })}
                aria-label={t("tree.newChildOf", { name: n.name })}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.newChild(n.path);
                }}
              >
                <Plus size={14} strokeWidth={2} aria-hidden />
              </button>
            )}
          </div>
        );
      })}
      {rows.length === 0 &&
        (root ? (
          <div className="tree-empty">
            <button type="button" onClick={() => actions.newChild("")}>
              <Plus size={14} strokeWidth={1.75} aria-hidden /> {t("tree.newNote")}
            </button>
          </div>
        ) : (
          <p className="meta tree-empty">{t("tree.emptyAll")}</p>
        ))}
      {menu && menuFor(menu.row).length > 0 && <Menu at={menu} items={menuFor(menu.row)} onClose={() => setMenu(null)} />}
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
        aria-label={t("tree.newName")}
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
      {err && (
        <span className="tree-rename-error" role="alert">
          {err}
        </span>
      )}
    </span>
  );
}
