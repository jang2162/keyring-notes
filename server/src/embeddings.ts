import type { DatabaseSync } from "node:sqlite";
import { headings, KeyedError, parseFrontmatter } from "@keyring-notes/core";
import { serverText } from "./lang.js";
import type { NoteIndex } from "./noteindex.js";
import { PathError } from "./paths.js";
import type { Vault } from "./vault.js";

/**
 * 임베딩 기반 의미 검색(W9). OpenAI 호환 /embeddings 엔드포인트를 쓴다(OpenAI, Ollama, LM Studio 등).
 *
 *   KEYRING_EMBED_URL    예: http://localhost:11434/v1/embeddings (Ollama), https://api.openai.com/v1/embeddings
 *   KEYRING_EMBED_MODEL  예: nomic-embed-text, text-embedding-3-small
 *   KEYRING_EMBED_KEY    (선택) Authorization: Bearer
 *
 * 문서를 제목·절 단위 조각(chunk)으로 나눠 벡터를 SQLite(인덱스와 같은 파일, 별도 테이블)에 저장하고,
 * 문서 해시가 바뀐 것만 다시 계산한다. 검색은 질의 벡터와 코사인 유사도(조각 수가 개인 볼트 규모라 전수 비교).
 * 권한 필터는 호출하는 쪽(ScopedVault)이 볼 수 있는 경로 목록으로 건다.
 */
export interface EmbedConfig {
  url: string;
  model: string;
  key?: string;
  /** 한 번에 보낼 조각 수 */
  batchSize?: number;
}

export interface Chunk {
  heading: string;
  text: string;
}

export interface SemanticHit {
  path: string;
  title: string;
  score: number;
  heading: string;
  snippet: string;
}

const MAX_CHUNK = 1200;

/** 제목(#~###)으로 절을 나누고, 긴 절은 문단 단위로 MAX_CHUNK 이하로 자른다. 각 조각 앞에 문서 제목·절 이름을 붙인다. */
export function chunkDocument(title: string, content: string): Chunk[] {
  const fm = parseFrontmatter(content);
  const lines = content.split("\n");
  const hs = headings(content).filter((h) => h.level <= 3);
  const sections: { heading: string; text: string }[] = [];
  let start = fm.lines;
  let current = "";
  const push = (end: number) => {
    const text = lines.slice(start, end).join("\n").trim();
    if (text) sections.push({ heading: current, text });
  };
  for (const h of hs) {
    push(h.line - 1);
    start = h.line;
    current = h.text;
  }
  push(lines.length);
  const summary = fm.data && typeof fm.data.summary === "string" ? fm.data.summary : "";
  const out: Chunk[] = [];
  for (const s of sections) {
    const paras = s.text.split(/\n\s*\n/);
    let buf = "";
    const flush = () => {
      if (buf.trim()) out.push({ heading: s.heading, text: buf.trim() });
      buf = "";
    };
    for (const p of paras) {
      if (buf && buf.length + p.length > MAX_CHUNK) flush();
      if (p.length > MAX_CHUNK) {
        for (let i = 0; i < p.length; i += MAX_CHUNK) {
          buf = p.slice(i, i + MAX_CHUNK);
          flush();
        }
      } else buf += (buf ? "\n\n" : "") + p;
    }
    flush();
  }
  if (out.length === 0 && (title || summary)) out.push({ heading: "", text: summary || title });
  return out.map((c) => ({
    heading: c.heading,
    text: `${title}${c.heading && c.heading !== title ? ` › ${c.heading}` : ""}${summary ? `\n${summary}` : ""}\n\n${c.text}`,
  }));
}

function toBlob(v: number[]): Uint8Array {
  const f = new Float32Array(v);
  let n = 0;
  for (const x of f) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < f.length; i++) f[i] /= n; // 정규화해 두면 코사인 = 내적
  return new Uint8Array(f.buffer);
}

function fromBlob(b: Uint8Array): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

export class SemanticIndex {
  private db: DatabaseSync;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  lastError: string | null = null;
  lastSync: string | null = null;

  constructor(
    private index: NoteIndex,
    private vault: Vault,
    readonly cfg: EmbedConfig,
    /** 시험용 */
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.db = index.db;
    // 인덱스 스키마가 바뀌어도(검색 인덱스 재생성) 비싼 임베딩은 남도록 따로 둔다
    this.db.exec(`CREATE TABLE IF NOT EXISTS embed_chunks (
      path TEXT NOT NULL, idx INTEGER NOT NULL, doc_hash TEXT NOT NULL, model TEXT NOT NULL,
      heading TEXT NOT NULL, text TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (path, idx));
      CREATE INDEX IF NOT EXISTS embed_chunks_path ON embed_chunks(path);`);
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.fetchImpl(this.cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.cfg.key ? { authorization: `Bearer ${this.cfg.key}` } : {}) },
      body: JSON.stringify({ model: this.cfg.model, input: texts }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new KeyedError("embed_failed", { status: res.status, body: (await res.text().catch(() => "")).slice(0, 200) });
    const data = (await res.json()) as { data?: { embedding: number[]; index?: number }[] };
    if (!Array.isArray(data.data) || data.data.length !== texts.length) throw new KeyedError("embed_format");
    return [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
  }

  status() {
    const docs = this.index.docs().filter((d) => !this.index.skip(d.path));
    const done = new Map(
      (this.db.prepare("SELECT path, doc_hash, model FROM embed_chunks WHERE idx = 0").all() as { path: string; doc_hash: string; model: string }[]).map(
        (r) => [r.path, r],
      ),
    );
    const pending = docs.filter((d) => {
      const r = done.get(d.path);
      return !r || r.doc_hash !== d.hash || r.model !== this.cfg.model;
    }).length;
    const chunks = (this.db.prepare("SELECT count(*) AS n FROM embed_chunks").get() as { n: number }).n;
    return {
      enabled: true,
      model: this.cfg.model,
      url: this.cfg.url.replace(/\/\/[^@/]*@/, "//"),
      documents: docs.length,
      pending,
      chunks,
      lastSync: this.lastSync,
      lastError: this.lastError,
    };
  }

  /** 바뀐 문서만 다시 임베딩하고, 사라진 문서의 조각은 지운다. 동시에 한 번만 돈다. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.syncOnce();
        } while (this.again);
        this.lastError = null;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        console.error(serverText("server.log.semantic_index_failed"), this.lastError);
      } finally {
        this.running = null;
        this.lastSync = new Date().toISOString();
      }
    })();
    return this.running;
  }

  private async syncOnce() {
    const docs = this.index.docs().filter((d) => !this.index.skip(d.path));
    const live = new Set(docs.map((d) => d.path));
    const rows = this.db.prepare("SELECT DISTINCT path, doc_hash, model FROM embed_chunks").all() as { path: string; doc_hash: string; model: string }[];
    const have = new Map(rows.map((r) => [r.path, r]));
    for (const r of rows) if (!live.has(r.path)) this.db.prepare("DELETE FROM embed_chunks WHERE path = ?").run(r.path);
    const todo = docs.filter((d) => {
      const r = have.get(d.path);
      return !r || r.doc_hash !== d.hash || r.model !== this.cfg.model;
    });
    const batchSize = this.cfg.batchSize ?? 32;
    for (const d of todo) {
      let content: string;
      try {
        content = (await this.vault.read(d.path)).content;
      } catch {
        continue; // 그 사이 지워짐
      }
      const chunks = chunkDocument(d.title, content);
      const vecs: number[][] = [];
      for (let i = 0; i < chunks.length; i += batchSize) vecs.push(...(await this.embed(chunks.slice(i, i + batchSize).map((c) => c.text))));
      this.db.exec("BEGIN");
      try {
        this.db.prepare("DELETE FROM embed_chunks WHERE path = ?").run(d.path);
        const ins = this.db.prepare("INSERT INTO embed_chunks (path, idx, doc_hash, model, heading, text, vec) VALUES (?, ?, ?, ?, ?, ?, ?)");
        chunks.forEach((c, i) => ins.run(d.path, i, d.hash, this.cfg.model, c.heading, c.text, toBlob(vecs[i])));
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
  }

  /** 변경 직후 부른다: 잠깐 모았다가 한 번에 색인한다. */
  schedule(delayMs = 2000) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), delayMs);
    this.timer.unref();
  }

  /** canRead로 걸러진 문서만 대상으로, 문서별 가장 가까운 조각의 점수로 순위를 매긴다. */
  async search(query: string, canRead: (p: string) => boolean, limit = 10): Promise<SemanticHit[]> {
    const q = query.trim();
    if (!q) throw new PathError("query_required");
    const [qv] = await this.embed([q]);
    const qf = fromBlob(toBlob(qv));
    const rows = this.db.prepare("SELECT path, heading, text, vec FROM embed_chunks WHERE model = ?").all(this.cfg.model) as {
      path: string;
      heading: string;
      text: string;
      vec: Uint8Array;
    }[];
    const best = new Map<string, { score: number; heading: string; text: string }>();
    for (const r of rows) {
      if (!canRead(r.path)) continue;
      const v = fromBlob(r.vec);
      if (v.length !== qf.length) continue;
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i] * qf[i];
      const cur = best.get(r.path);
      if (!cur || dot > cur.score) best.set(r.path, { score: dot, heading: r.heading, text: r.text });
    }
    const titles = new Map(this.index.docs().map((d) => [d.path, d.title]));
    return [...best.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([path, b]) => ({
        path,
        title: titles.get(path) ?? path,
        score: Math.round(b.score * 1000) / 1000,
        heading: b.heading,
        snippet: b.text.split("\n\n").slice(1).join(" ").replace(/\s+/g, " ").slice(0, 200),
      }));
  }
}
