import { PathError } from "./errors.js";

/** 볼트 안에서 숨겨지는 이름: 점으로 시작하는 폴더·파일(.history, .obsidian, .keyring-app 등). */
export function isHiddenSegment(name: string): boolean {
  return name.startsWith(".");
}

/**
 * 클라이언트가 보낸 볼트 상대 경로를 정규화한다.
 * 절대 경로, `..`, 숨김 세그먼트, 빈 세그먼트, 제어 문자는 거부한다.
 * 반환값은 항상 `/` 구분자를 쓰는 상대 경로다.
 */
export function normalizeVaultPath(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new PathError("path_empty");
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(input)) {
    throw new PathError("path_control");
  }
  const unified = input.replace(/\\/g, "/");
  if (unified.startsWith("/") || /^[a-zA-Z]:/.test(unified)) {
    throw new PathError("path_absolute");
  }
  const segments = unified.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) throw new PathError("path_empty");
  for (const seg of segments) {
    if (seg === "." || seg === "..") throw new PathError("path_dotdot");
    if (isHiddenSegment(seg)) throw new PathError("path_hidden");
  }
  return segments.join("/");
}

export function isMarkdown(relPath: string): boolean {
  return relPath.toLowerCase().endsWith(".md");
}

/** 폴더 인자 정규화. 빈 값·"/"는 볼트 전체(""). */
export function normalizeFolder(folder?: string): string {
  if (!folder || folder.trim() === "" || folder.trim() === "/") return "";
  return normalizeVaultPath(folder.replace(/\/+$/, ""));
}
