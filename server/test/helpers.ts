import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccessPolicy, type Level, type Principal } from "../src/access.js";
import { ScopedVault } from "../src/scoped.js";
import { NoteIndex } from "../src/noteindex.js";
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

/** 볼트 + 메모리 인덱스. 서버와 같이 변경 때마다 인덱스를 갱신한다. */
export async function openVault(dir: string, opts: { init?: boolean } = {}) {
  const vault = new Vault(dir);
  const index = new NoteIndex(":memory:");
  if (opts.init !== false) {
    await vault.init();
    await index.sync(vault);
  }
  vault.onChange((paths) => index.refresh(vault.root, paths));
  return { vault, index };
}
