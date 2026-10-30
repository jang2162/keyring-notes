/**
 * 워크스페이스 루트 노트(`<워크스페이스>.md`)는 화면에서 열지 않는다 — docs/ops/ux.md 31번 「정한 것」.
 * 파일은 워크스페이스가 있다는 표식이자 워크스페이스 아이콘(frontmatter icon)의 자리라 지우지도 바꾸지도 않는다.
 * 서버·REST·MCP·동기화는 그대로 읽고 쓰므로, 이미 내용이 있는 파일도 디스크에 남는다(화면에서만 안 보인다)
 */
import { isVaultSettingsPath } from "@keyring-notes/core";
import type { SourcesInfo } from "./api";

/** 볼트 맨 위의 마크다운 파일. 볼트 맨 위 노드는 모두 워크스페이스다(공통 설정 파일은 빼고) */
export const isWorkspaceNote = (path: string) => !path.includes("/") && /\.md$/i.test(path) && !isVaultSettingsPath(path);

/**
 * 처음 로드한 주소(`#/<경로>`)의 노트: 열지("open"), 막고 알릴지("blocked"), 열 것이 없는지(null).
 * 첫 로드는 `open` 을 거치지 않고 배치에 바로 넣으므로(범위가 정해지기 전이라) 같은 판정을 여기서 한다
 */
export const bootOpen = (path: string | null): "open" | "blocked" | null => (!path ? null : isWorkspaceNote(path) ? "blocked" : "open");

/** 백링크(이 노트를 링크·인용한 노트)에서 워크스페이스 노트를 뺀다 — 검색 결과에서 빼는 것과 같은 까닭 */
export const withoutWorkspaceBacklinks = (refs: SourcesInfo): SourcesInfo => ({
  ...refs,
  linkedBy: refs.linkedBy.filter((r) => !isWorkspaceNote(r.path)),
  citedBy: refs.citedBy.filter((r) => !isWorkspaceNote(r.path)),
});
