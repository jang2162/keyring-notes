/**
 * 워크스페이스 루트 노트(`<워크스페이스>.md`)는 화면에서 열지 않는다 — docs/ops/ux.md 31번 「정한 것」.
 * 파일은 워크스페이스가 있다는 표식이자 워크스페이스 아이콘(frontmatter icon)의 자리라 지우지도 바꾸지도 않는다.
 * 서버·REST·MCP·동기화는 그대로 읽고 쓰므로, 이미 내용이 있는 파일도 디스크에 남는다(화면에서만 안 보인다)
 */
import { isVaultSettingsPath } from "@keyring-notes/core";

/** 볼트 맨 위의 마크다운 파일. 볼트 맨 위 노드는 모두 워크스페이스다(공통 설정 파일은 빼고) */
export const isWorkspaceNote = (path: string) => !path.includes("/") && /\.md$/i.test(path) && !isVaultSettingsPath(path);
