/**
 * 창 맨 위 두 줄(첫 줄: 신호등·앱 이름·사이드바 토글 + 탭, 둘째 줄: 워크스페이스 전환기 + 트리 단추)의 판정.
 * 배치의 까닭은 docs/ops/ux.md 「상단 UI 통합」 절.
 */

/**
 * 브레드크럼에 놓을 상위 노드들(노드 경로의 조상, 위에서부터).
 * 워크스페이스 하나를 보는 동안에는 워크스페이스 칸을 뺀다 — 전환기가 이미 보여 준다.
 * 모든 워크스페이스 모드에서는 남긴다 — 그 노트가 어느 워크스페이스 것인지 알 길이 그 칸뿐이다
 */
export function crumbNodes(node: string, allWorkspaces: boolean): string[] {
  const up = node
    .split("/")
    .slice(0, -1)
    .map((_, i, all) => all.slice(0, i + 1).join("/"));
  return allWorkspaces ? up : up.slice(1);
}

/**
 * 워크스페이스 전환기를 어디에 두는가. 사이드바 둘째 줄이 기본이고(좁은 화면은 서랍 맨 위),
 * 넓은 화면에서 사이드바를 접었을 때만 브레드크럼 첫 칸으로 옮긴다 — 접으면 둘째 줄이 숨기 때문이다
 */
export type SwitcherSpot = "sidebar" | "crumbs";
export const switcherSpot = (narrow: boolean, leftOpen: boolean): SwitcherSpot => (!narrow && !leftOpen ? "crumbs" : "sidebar");

/**
 * 제목 표시줄을 없애고 신호등을 콘텐츠 위에 얹은 창인가: macOS 데스크톱 앱(app/src-tauri 의 titleBarStyle Overlay).
 * iPad 앱의 WebView 는 UA 가 Macintosh 라 터치 지점 수로 가른다. Windows·Linux 앱은 제목 표시줄을 그대로 둔다
 */
export const overlayTitleBar = (env: { tauri: boolean; userAgent: string; touchPoints: number }) =>
  env.tauri && /Macintosh|Mac OS X/.test(env.userAgent) && env.touchPoints === 0;
