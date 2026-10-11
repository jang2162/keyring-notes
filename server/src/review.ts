import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AccessPolicy, atLeast } from "./access.js";
import type { ConfigStore } from "./config.js";
import { serverText } from "./lang.js";
import { PathError } from "./paths.js";
import { hashContent, NotFoundError, type FilePreview, type Op, type Vault } from "./vault.js";

/**
 * 변경 검토 대기열(W5). 검토 대상 경로에 에이전트가 쓰면 바로 커밋하지 않고 제안으로 쌓아 두었다가,
 * 사람이 diff를 보고 승인하면 그때 에이전트 이름으로 커밋한다.
 *
 * 제안은 <볼트>/.keyring/proposals/<id>/ 에 둔다(Git·검색 밖). 첨부 파일(put)의 바이트는 따로 저장한다.
 */
export type ProposalStatus = "pending" | "approved" | "rejected";

export interface Proposal {
  id: string;
  agent: string;
  agentEmail: string;
  message: string;
  createdAt: string;
  status: ProposalStatus;
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
  /** 승인해 만든 커밋 */
  rev?: string | null;
  /** 저장 형식의 연산(put의 data는 파일로 따로) */
  ops: StoredOp[];
  preview: FilePreview[];
  /** 이동 때 링크 자동 갱신: 켰는지와 미리보기에서 고친 문서. 승인 때는 이 문서로만 제한해 다시 계산한다 */
  links?: { enabled: boolean; paths: string[] };
}

type StoredOp = Exclude<Op, { op: "put" }> | { op: "put"; path: string; dataFile: string };

export interface ProposalSummary extends Omit<Proposal, "ops" | "preview"> {
  files: { path: string; change: "add" | "modify" | "delete"; binary: boolean }[];
  /** 제안 뒤에 대상 문서가 바뀌어 그대로는 적용할 수 없을 수 있음 */
  stale: boolean;
}

const ID_RE = /^[0-9a-f]{16}$/;
const KEEP_DECIDED_DAYS = 30;

/** 검토 대상 경로 판정: 설정의 reviewPaths(접두 경로, "/"는 전체) 중 하나 아래면 검토 대상. */
export function underReview(rel: string, reviewPaths: string[]): boolean {
  return reviewPaths.some((p) => {
    const prefix = p.replace(/^\/+|\/+$/g, "");
    return prefix === "" || rel === prefix || rel.startsWith(prefix + "/");
  });
}

export class ReviewQueue {
  private dir: string;
  private listeners: ((p: Proposal) => void)[] = [];

  constructor(
    private vault: Vault,
    private config: ConfigStore,
  ) {
    this.dir = path.join(vault.root, ".keyring", "proposals");
  }

  /** 새 제안이 쌓였을 때(웹훅 알림용) */
  onCreate(fn: (p: Proposal) => void) {
    this.listeners.push(fn);
  }

  /** 검토 대상 경로가 하나라도 설정되어 있는지 */
  enabled(): boolean {
    return this.config.get().reviewPaths.length > 0;
  }

  needsReview(paths: string[]): boolean {
    const reviewPaths = this.config.get().reviewPaths;
    return reviewPaths.length > 0 && paths.some((p) => underReview(p, reviewPaths));
  }

  async create(
    agent: { name: string; email: string },
    ops: Op[],
    message: string | undefined,
    preview: FilePreview[],
    links?: { enabled: boolean; paths: string[] },
  ): Promise<Proposal> {
    const id = randomBytes(8).toString("hex");
    const pdir = path.join(this.dir, id);
    await mkdir(pdir, { recursive: true });
    const stored: StoredOp[] = [];
    let n = 0;
    for (const op of ops) {
      if (op.op === "put") {
        const dataFile = `put-${n++}.bin`;
        await writeFile(path.join(pdir, dataFile), op.data);
        stored.push({ op: "put", path: op.path, dataFile });
      } else stored.push(op);
    }
    const proposal: Proposal = {
      id,
      agent: agent.name,
      agentEmail: agent.email,
      message: message?.trim() || this.vault.text().commit.proposal(preview.length),
      createdAt: new Date().toISOString(),
      status: "pending",
      ops: stored,
      preview,
      links,
    };
    await this.save(proposal);
    for (const fn of this.listeners) {
      try {
        fn(proposal);
      } catch (e) {
        console.error(serverText("server.log.proposal_listener_failed"), e);
      }
    }
    return proposal;
  }

  private async save(p: Proposal) {
    await writeFile(path.join(this.dir, p.id, "proposal.json"), JSON.stringify(p, null, 2));
  }

  async get(id: string): Promise<Proposal> {
    if (!ID_RE.test(id)) throw new PathError("proposal_id_invalid");
    try {
      return JSON.parse(await readFile(path.join(this.dir, id, "proposal.json"), "utf8")) as Proposal;
    } catch {
      throw new NotFoundError("proposal_missing", { id });
    }
  }

  private async currentHash(rel: string): Promise<string | null> {
    try {
      return hashContent(await readFile(path.join(this.vault.root, rel)));
    } catch {
      return null;
    }
  }

  async summarize(p: Proposal): Promise<ProposalSummary> {
    const { ops: _ops, preview, ...rest } = p;
    let stale = false;
    if (p.status === "pending") {
      for (const f of preview) if ((await this.currentHash(f.path)) !== f.beforeHash) stale = true;
    }
    return {
      ...rest,
      stale,
      files: preview.map((f) => ({
        path: f.path,
        change: f.beforeHash === null ? "add" : f.afterHash === null ? "delete" : "modify",
        binary: f.binary,
      })),
    };
  }

  /** 제안 목록(최신 먼저). agent를 주면 그 에이전트의 것만. 오래된 결정 기록은 정리한다. */
  async list(opts: { status?: ProposalStatus; agent?: string } = {}): Promise<ProposalSummary[]> {
    const ids = await readdir(this.dir).catch(() => [] as string[]);
    const out: ProposalSummary[] = [];
    const cutoff = Date.now() - KEEP_DECIDED_DAYS * 86400_000;
    for (const id of ids) {
      if (!ID_RE.test(id)) continue;
      let p: Proposal;
      try {
        p = await this.get(id);
      } catch {
        continue;
      }
      if (p.status !== "pending" && p.decidedAt && Date.parse(p.decidedAt) < cutoff) {
        await rm(path.join(this.dir, id), { recursive: true, force: true });
        continue;
      }
      if (opts.status && p.status !== opts.status) continue;
      if (opts.agent && p.agent !== opts.agent) continue;
      out.push(await this.summarize(p));
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async pendingCount(): Promise<number> {
    return (await this.list({ status: "pending" })).length;
  }

  /** 승인: 저장해 둔 연산을 그대로(같은 baseHash로) 적용한다. 그 사이 문서가 바뀌었으면 충돌로 거부된다. */
  async approve(id: string, approver: string): Promise<Proposal> {
    const p = await this.get(id);
    if (p.status !== "pending") throw new PathError("proposal_done", { status: p.status });
    const ops: Op[] = [];
    for (const op of p.ops) {
      if (op.op === "put") ops.push({ op: "put", path: op.path, data: new Uint8Array(await readFile(path.join(this.dir, id, op.dataFile))) });
      else ops.push(op);
    }
    // 링크 갱신은 승인 시점의 내용으로 다시 계산하되, 제안 때와 같은 범위(그 에이전트가 볼 수 있는 경로, 미리보기에 보인 문서)로만
    const agentRules = this.config.get().agents.find((a) => a.name === p.agent)?.rules;
    const policy = agentRules ? new AccessPolicy(agentRules) : null;
    const links = p.links?.enabled
      ? { enabled: true, fullPaths: true, only: new Set(p.links.paths), canSee: (rel: string) => (policy ? atLeast(policy.level(rel), "read") : false) }
      : { enabled: false };
    const res = await this.vault.batch(
      ops,
      { name: p.agent, email: p.agentEmail },
      { message: `${p.message}\n\n${this.vault.text().commit.approved(approver, p.id)}`, links },
    );
    p.status = "approved";
    p.decidedAt = new Date().toISOString();
    p.decidedBy = approver;
    p.rev = res.rev;
    await this.save(p);
    await this.dropBlobs(p);
    return p;
  }

  async reject(id: string, decider: string, reason?: string): Promise<Proposal> {
    const p = await this.get(id);
    if (p.status !== "pending") throw new PathError("proposal_done", { status: p.status });
    p.status = "rejected";
    p.decidedAt = new Date().toISOString();
    p.decidedBy = decider;
    if (reason?.trim()) p.reason = reason.trim().slice(0, 1000);
    await this.save(p);
    await this.dropBlobs(p);
    return p;
  }

  private async dropBlobs(p: Proposal) {
    for (const op of p.ops) if (op.op === "put") await rm(path.join(this.dir, p.id, op.dataFile), { force: true });
  }
}
