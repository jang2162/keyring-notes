import { mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { analyze, resolveLink, type DocMeta, type TaskRow } from "@keyring-notes/core";
import { hashContent } from "./vault.js";

const SCHEMA_VERSION = 3;

export type { DocMeta, TaskRow } from "@keyring-notes/core";

export interface IndexSource {
  root: string;
  markdownPaths(): Promise<string[]>;
}

/** 검색어를 FTS 조건과 LIKE 조건으로 나눈다. trigram 토크나이저는 3글자 미만을 찾지 못한다. */
function splitTerms(query: string) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ""))
    .filter(Boolean);
  return { long: terms.filter((t) => [...t].length >= 3), short: terms.filter((t) => [...t].length < 3), all: terms };
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

/**
 * 검색·백링크·태그·위젯 쿼리용 SQLite 인덱스. 원본은 언제나 볼트 파일이며,
 * 이 파일은 지워도 다음 시작 때 다시 만들어지는 캐시다. 권한 필터는 여기서 하지 않고 ScopedVault가 한다.
 */
export class NoteIndex {
  readonly db: DatabaseSync;
  /** 색인하지 않을 경로(서버가 만드는 위키 index·log 등). 사용자별로 다르게 보이는 문서라 검색·백링크에서 뺀다. */
  skip: (rel: string) => boolean = () => false;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    const version = (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version !== SCHEMA_VERSION) this.reset();
  }

  private reset() {
    this.db.exec(`
      DROP TABLE IF EXISTS docs; DROP TABLE IF EXISTS tags; DROP TABLE IF EXISTS links;
      DROP TABLE IF EXISTS tasks; DROP TABLE IF EXISTS fts;
      CREATE TABLE docs (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL,
        hash TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL, fm TEXT);
      CREATE TABLE tags (path TEXT NOT NULL, tag TEXT NOT NULL);
      CREATE INDEX tags_tag ON tags(tag); CREATE INDEX tags_path ON tags(path);
      CREATE TABLE links (src TEXT NOT NULL, target TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'link');
      CREATE INDEX links_name ON links(name); CREATE INDEX links_src ON links(src);
      CREATE TABLE tasks (path TEXT NOT NULL, line INTEGER NOT NULL, done INTEGER NOT NULL, text TEXT NOT NULL);
      CREATE INDEX tasks_path ON tasks(path);
      CREATE VIRTUAL TABLE fts USING fts5(path, title, body, tokenize = 'trigram');
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
  }

  close() {
    this.db.close();
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private removeRow(rel: string) {
    const row = this.db.prepare("SELECT id FROM docs WHERE path = ?").get(rel) as { id: number } | undefined;
    if (!row) return;
    this.db.prepare("DELETE FROM fts WHERE rowid = ?").run(row.id);
    this.db.prepare("DELETE FROM docs WHERE id = ?").run(row.id);
    for (const t of ["tags", "tasks"]) this.db.prepare(`DELETE FROM ${t} WHERE path = ?`).run(rel);
    this.db.prepare("DELETE FROM links WHERE src = ?").run(rel);
  }

  private putRow(rel: string, content: string, mtime: number, size: number) {
    const a = analyze(rel, content);
    this.removeRow(rel);
    const res = this.db
      .prepare("INSERT INTO docs (path, title, summary, hash, mtime, size, fm) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(rel, a.title, a.summary, hashContent(content), mtime, size, a.frontmatter ? JSON.stringify(a.frontmatter) : null);
    this.db.prepare("INSERT INTO fts (rowid, path, title, body) VALUES (?, ?, ?, ?)").run(res.lastInsertRowid, rel, a.title, content);
    const tag = this.db.prepare("INSERT INTO tags (path, tag) VALUES (?, ?)");
    for (const t of a.tags) tag.run(rel, t);
    const link = this.db.prepare("INSERT INTO links (src, target, name, kind) VALUES (?, ?, ?, ?)");
    for (const t of a.links) link.run(rel, t, linkName(t), "link");
    for (const t of a.sources) link.run(rel, t, linkName(t), "source");
    const task = this.db.prepare("INSERT INTO tasks (path, line, done, text) VALUES (?, ?, ?, ?)");
    for (const t of a.tasks) task.run(rel, t.line, t.done ? 1 : 0, t.text);
  }

  /** 볼트 전체와 맞춘다: 바뀐(mtime·크기) 문서만 다시 읽고, 사라진 문서는 지운다. */
  async sync(source: IndexSource): Promise<{ updated: number; removed: number }> {
    const paths = (await source.markdownPaths()).filter((p) => !this.skip(p));
    const known = new Map(
      (this.db.prepare("SELECT path, mtime, size FROM docs").all() as { path: string; mtime: number; size: number }[]).map((r) => [r.path, r]),
    );
    const changed: { rel: string; content: string; mtime: number; size: number }[] = [];
    for (const rel of paths) {
      const abs = path.join(source.root, rel);
      const st = await stat(abs).catch(() => null);
      if (!st) continue;
      const k = known.get(rel);
      known.delete(rel);
      if (k && k.mtime === st.mtimeMs && k.size === st.size) continue;
      changed.push({ rel, content: await readFile(abs, "utf8"), mtime: st.mtimeMs, size: st.size });
    }
    this.tx(() => {
      for (const rel of known.keys()) this.removeRow(rel);
      for (const c of changed) this.putRow(c.rel, c.content, c.mtime, c.size);
    });
    return { updated: changed.length, removed: known.size };
  }

  /** 서버를 통한 변경 직후 해당 문서만 갱신한다. */
  async refresh(root: string, rels: string[]): Promise<void> {
    const rows: { rel: string; content: string | null; mtime: number; size: number }[] = [];
    for (const rel of rels) {
      if (!rel.toLowerCase().endsWith(".md")) continue;
      if (this.skip(rel)) {
        rows.push({ rel, content: null, mtime: 0, size: 0 });
        continue;
      }
      const abs = path.join(root, rel);
      const st = await stat(abs).catch(() => null);
      rows.push(st ? { rel, content: await readFile(abs, "utf8"), mtime: st.mtimeMs, size: st.size } : { rel, content: null, mtime: 0, size: 0 });
    }
    this.tx(() => {
      for (const r of rows) {
        if (r.content === null) this.removeRow(r.rel);
        else this.putRow(r.rel, r.content, r.mtime, r.size);
      }
    });
  }

  allPaths(): string[] {
    return (this.db.prepare("SELECT path FROM docs ORDER BY path").all() as { path: string }[]).map((r) => r.path);
  }

  /**
   * 모든 단어를 포함한 문서(본문·제목·경로). 3글자 이상은 FTS, 짧은 단어는 LIKE로 거른다.
   * 결과는 관련도 순이며, 호출하는 쪽에서 권한으로 거른 뒤 자른다.
   */
  search(query: string): { path: string; title: string; body: string }[] {
    const { long, short } = splitTerms(query);
    if (long.length === 0 && short.length === 0) return [];
    const where: string[] = [];
    const params: string[] = [];
    if (long.length > 0) {
      where.push("fts MATCH ?");
      params.push(long.map((t) => `"${t}"`).join(" "));
    }
    for (const t of short) {
      where.push("(lower(body) LIKE ? ESCAPE '\\' OR lower(title) LIKE ? ESCAPE '\\' OR lower(path) LIKE ? ESCAPE '\\')");
      const p = `%${escapeLike(t)}%`;
      params.push(p, p, p);
    }
    const order = long.length > 0 ? "ORDER BY bm25(fts, 5.0, 10.0, 1.0)" : "ORDER BY path";
    return this.db.prepare(`SELECT path, title, body FROM fts WHERE ${where.join(" AND ")} ${order}`).all(...params) as {
      path: string;
      title: string;
      body: string;
    }[];
  }

  /** target 문서를 가리키는 링크가 있는 문서들. 링크 해석은 볼트 전체 기준(Obsidian 최단 경로 규칙). */
  /** kind를 주면 그 종류만: "link"(본문 위키링크), "source"(프런트매터 출처). 없으면 둘 다. */
  backlinks(target: string, kind?: "link" | "source"): string[] {
    const name = linkName(target);
    const rows = (kind
      ? this.db.prepare("SELECT DISTINCT src, target FROM links WHERE name = ? AND kind = ?").all(name, kind)
      : this.db.prepare("SELECT DISTINCT src, target FROM links WHERE name = ?").all(name)) as { src: string; target: string }[];
    if (rows.length === 0) return [];
    const all = this.allPaths();
    const out = new Set<string>();
    for (const r of rows) if (r.src !== target && resolveLink(r.target, all) === target) out.add(r.src);
    return [...out].sort();
  }

  tagRows(): { path: string; tag: string }[] {
    return this.db.prepare("SELECT path, tag FROM tags").all() as { path: string; tag: string }[];
  }

  docs(): DocMeta[] {
    const tagMap = new Map<string, string[]>();
    for (const r of this.tagRows()) tagMap.set(r.path, [...(tagMap.get(r.path) ?? []), r.tag]);
    return (this.db.prepare("SELECT path, title, summary, hash, mtime, size, fm FROM docs ORDER BY path").all() as {
      path: string;
      title: string;
      summary: string;
      hash: string;
      mtime: number;
      size: number;
      fm: string | null;
    }[]).map((r) => ({
      path: r.path,
      title: r.title,
      summary: r.summary,
      hash: r.hash,
      mtime: r.mtime,
      size: r.size,
      frontmatter: r.fm ? JSON.parse(r.fm) : null,
      tags: tagMap.get(r.path) ?? [],
    }));
  }

  tasks(): TaskRow[] {
    return (this.db.prepare("SELECT path, line, done, text FROM tasks ORDER BY path, line").all() as {
      path: string;
      line: number;
      done: number;
      text: string;
    }[]).map((r) => ({ path: r.path, line: r.line, done: r.done === 1, text: r.text }));
  }
}

/** 링크 대상의 파일 이름 부분(소문자, .md 제외). 백링크 후보를 빠르게 좁히는 키. */
function linkName(target: string): string {
  return target.trim().split("/").pop()!.replace(/\.md$/i, "").toLowerCase();
}
