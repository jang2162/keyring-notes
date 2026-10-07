import path from "node:path";

import { PathError } from "@keyring-notes/core";

export { isHiddenSegment, isMarkdown, normalizeVaultPath, PathError } from "@keyring-notes/core";

/** 정규화된 상대 경로를 볼트 루트 아래 절대 경로로 바꾸고, 루트를 벗어나지 않는지 한 번 더 확인한다. */
export function resolveInVault(root: string, relPath: string): string {
  const abs = path.resolve(root, relPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathError("path_outside");
  }
  return abs;
}
