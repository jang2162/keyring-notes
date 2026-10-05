import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccessPolicy, type Level, type Principal } from "../src/access.js";
import { ScopedVault } from "../src/scoped.js";
import { Vault } from "../src/vault.js";

export const ownerPrincipal: Principal = { kind: "owner", name: "me", email: "me@test" };

export function agentPrincipal(name: string, rules: Record<string, Level>): Principal {
  return { kind: "agent", name, email: `${name}@agent.test`, policy: new AccessPolicy(rules) };
}

export async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function scoped(vault: Vault, p: Principal) {
  return new ScopedVault(vault, p);
}
