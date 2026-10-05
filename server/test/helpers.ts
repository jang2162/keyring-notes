import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccessPolicy, type Level, type Principal } from "../src/access.js";
import { ScopedVault } from "../src/scoped.js";
import { Ingestor } from "../src/ingest.js";
import { NoteIndex } from "../src/noteindex.js";
import { Wiki } from "../src/wiki.js";
import { Vault } from "../src/vault.js";

export const ownerPrincipal: Principal = { kind: "owner", name: "me", email: "me@test" };

export function agentPrincipal(name: string, rules: Record<string, Level>): Principal {
  return { kind: "agent", name, email: `${name}@agent.test`, policy: new AccessPolicy(rules) };
}

export async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function scoped(vault: Vault, index: NoteIndex, p: Principal) {
  return new ScopedVault(vault, p, index);
}

/** 볼트 + 메모리 인덱스 + 위키. 서버(index.ts)와 같은 순서로 묶는다. */
export async function openVault(dir: string, opts: { init?: boolean; allowPrivate?: boolean } = {}) {
  const vault = new Vault(dir);
  const index = new NoteIndex(":memory:");
  const wiki = new Wiki(vault, index);
  if (opts.init !== false) {
    await wiki.prepare();
    await vault.init();
    await wiki.init();
    await index.sync(vault);
    for (const t of wiki.topics) await wiki.regenerate(t);
  }
  vault.onChange((paths) => index.refresh(vault.root, paths));
  vault.onChange((paths) => wiki.onChange(paths));
  const ingestor = new Ingestor(vault, wiki, { allowPrivate: opts.allowPrivate });
  return { vault, index, wiki, ingestor };
}
