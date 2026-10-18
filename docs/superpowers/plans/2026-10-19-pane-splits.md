# 편집 영역 분할(Zed 식)과 데스크톱 새 창 구현 계획

**Goal:** 가운데 칸 배치를 좌우 두 칸 배열에서 **나눌 수 있는 트리**로 바꾸고(상하·좌우, 개수 제한 없음, 경계 끌기, 단축키), 데스크톱 앱에서도 노트 하나를 새 창으로 연다. 로컬 볼트 모드에서 두 창이 같은 노트를 저장할 때 조용히 덮어쓰지 않게 한다.

**Spec:** `docs/superpowers/specs/2026-10-19-pane-splits-design.md`

**Architecture:** `web/src/panes.ts` 의 `Layout` 을 `{ root: LayoutNode | null; focused: string }` 트리로 바꾼다. 잎(`PaneNode`)은 지금의 칸에 **안정된 id** 를 더한 것, 가지(`SplitNode`)는 방향(`row`·`column`)·자식·비율(`sizes`, 합 1)이다. 모든 연산은 순수 함수이고 vitest 로 고정한다. `Workspace.tsx` 는 칸을 배열 인덱스 대신 id 로 가리키고(에디터·칸 동작·칸 요소·과거 판·커서·끌기 데이터), 트리를 재귀로 그린다.

## Global Constraints

- 화면 글은 `packages/core/src/messages/{en,ko}.json`(영어 기준, 키 정렬 — oxfmt 가 맞춘다).
- 최소 칸 폭 `MIN_PANE_WIDTH = 280`(그대로), 최소 칸 높이 `MIN_PANE_HEIGHT` 는 시험 서버에서 탭 바·문서 머리·본문 몇 줄을 재서 정한다(Task 5).
- 나누면 새 칸과 원래 칸이 각각 그 칸의 **절반**을 갖는다. 절반이 최소보다 작으면 나누지 않고, 끌어 놓을 자리에서도 그 가장자리를 보이지 않는다.
- 창을 줄여 칸이 최소보다 작아져도 배치를 고치지 않는다. 좁은 화면(800px 이하)은 포커스된 칸 하나만 그리고 트리는 그대로 기억한다 — 지금의 「좁아지면 한 칸으로 합치기」 효과는 걷는다.
- 저장 키는 새로 `keyring:pane-tree`. 처음 읽을 때 옛 `keyring:panes`(0~2칸)를 옮기고(두 칸이면 `row` 가지, 비율은 `prefs.splitRatio`), 그것도 없으면 더 옛 `keyring:tabs`/`keyring:last-doc` 을 옮긴다. 옮긴 뒤 옛 키는 지운다. 새 키를 쓰는 이유: 옛 판으로 돌아갔을 때 옛 판이 새 모양을 「모양이 틀린 값」으로 버리고 빈 배치로 시작하게 하려는 것이 아니라, 같은 키를 두 모양이 번갈아 덮어쓰지 않게 하려는 것(지난 분할 작업과 같은 판단).
- 칸 id 는 `p1`, `p2`… 로 배치 안에서만 유일하다(`nextPaneId`). 순수 함수가 만들어 테스트가 결정적이다.
- 새 CSS 클래스는 `split-` 접두어(`.panes`·`.pane` 은 한 문서 안의 편집·미리보기 나란히가 쓴다).
- 다른 파일을 가리킬 때 줄번호를 쓰지 않는다.

## 단축키(빌더 결정)

앱 단축키는 `Workspace.tsx` 의 `commands` 가 창 단위 캡처로 먼저 받는다. 키 묶음(chord)은 지원하지 않고, 에디터가 `Mod-k` 를 링크 넣기로 쓰므로 Zed 의 `Mod-K` 접두어를 들이면 링크 넣기가 죽는다 — 단일 조합으로 정한다.

| 명령 | 키 | 겹침 확인 |
| --- | --- | --- |
| 오른쪽으로 나누기(`split`) | `Mod+\` | 지금 키 그대로(뜻만 「둘째 칸 열기/닫기」 → 「오른쪽으로 나누기」) |
| 아래로 나누기(`split-down`) | `Mod+Shift+\` | CodeMirror 기본 `Shift-Mod-\`(맞는 괄호로 이동)를 가린다. 노트 편집에서 쓸 일이 적다 |
| 이웃 칸으로 포커스(`focus-pane-left/right/up/down`) | `Mod+Alt+Shift+방향키` | `Mod+Alt+←/→` 는 뒤로·앞으로, `Mod+Alt+↑/↓` 는 CodeMirror 커서 추가, `Mod+Shift+방향키`·`Alt+Shift+방향키` 는 선택·줄 복사라 비어 있는 것이 이 조합뿐 |
| 탭을 이웃 칸으로(`move-tab-left/right/up/down`) | macOS `Mod+Ctrl+방향키`, 그 밖 없음(팔레트·설정에서 지정) | Windows·Linux 는 `Ctrl` 이 `Mod` 와 같아 남는 방향키 조합이 없다. 대신 `Mod+Shift+.`(탭을 다른 칸으로)는 그대로 |
| 다른 칸으로 포커스(`focus-other-pane`) | `Mod+Shift+,` | 그대로. 읽는 순서의 다음 칸 |

## Tasks

### Task 1: 트리 연산 `panes.ts` (테스트 먼저)

- `web/src/panes.test.ts` 를 새 API 로 다시 쓴다. 고정할 규칙:
  - `splitPane`: 같은 축으로 거듭 나누면 같은 가지에 자식을 더하고(대상의 비율을 반으로 나눠 준다), 다른 축이면 대상 자리를 새 가지로 바꾼다.
  - `closeIn`/`removePane`: 칸이 비면 빠지고, 자식이 하나 남은 가지는 걷혀 남은 자식이 부모에 붙는다(같은 방향이면 부모 가지에 펼쳐 넣는다). 빠진 칸의 비율은 남은 형제들이 비율대로 나눠 갖는다. 포커스가 빠진 칸이었으면 그 자리를 차지한 형제 쪽 칸으로.
  - `moveTab`, `dropTab`(가운데 → 그 칸의 탭으로, 가장자리 → 그쪽에 새 칸; 같은 칸의 유일한 탭은 그대로).
  - `neighborOf`: 비율로 계산한 단위 사각형에서 그 방향으로 맞닿고 수직 축이 겹치는 칸, 여럿이면 지금 칸 가운데 줄을 품는 칸.
  - `minExtent`(가지의 최소 폭·높이), `setSizes`, `canSplitRect`, `dropZone`(포인터 위치 → 놓을 자리).
  - `isLayout`(모양이 틀린 값 버림: 자식 하나짜리 가지, 비율 개수·합 불일치, id 중복, focused 가 없는 칸), `migrateLegacyPanes`(0~2칸 → 트리, 모양 틀리면 `{}`), `migrateLayouts`(옛 `keyring:tabs`).
  - 기존 `openIn`·`renamePath`·`removePaths`·`setActive`·`setMode`·`focusPane`·`panesWith`·`otherPaneShowing`·`mergePanes`·`rightPanelFloats`·`shownModeOf` 의 규칙은 칸 id 로 그대로 옮긴다.
- 테스트를 먼저 돌려 실패를 보고, 구현한 뒤 통과를 보고, 구현의 핵심(가지 걷기)을 잠깐 되돌려 실패하는 것을 한 번 보인다.

### Task 2: 로컬 볼트 두 창 덮어쓰기 측정과 수정(core)

- 창마다 `LocalVault` 가 파일 해시를 메모리에 들고 `check` 가 그 메모리 값과만 비교한다. 다른 창이 막 쓴 내용은 그 창이 포커스를 받아 `rescan` 하기 전까지 보이지 않는다.
- `packages/core/test/local.test.ts` 에 **같은 저장소를 여는 두 볼트**로 재는 테스트를 먼저 쓴다(A 저장 → 낡은 해시로 B 저장). 고치기 전에는 B 가 조용히 덮어쓴다(실패) — 그 결과를 보고에 적는다.
- 수정: `write`/`remove` 가 검사 전에 저장소의 그 파일을 다시 읽어 해시를 대 보고, 메모리와 다르면 `scan` 으로 메모리를 맞춘 뒤 검사한다. 그러면 B 는 409(충돌)를 받고 화면은 지금의 3방향 병합·충돌 배너 경로를 탄다.

### Task 3: 화면 `Workspace.tsx`·`DocPane.tsx`·`mirror.ts`

- 칸 인덱스를 id 로: `paneHandles`·`paneApis`·`paneEls`(id → ref 맵), `revisions`·`cursors`(id → 값), `tabMenu.pane`, `tabSheet`, 끌기 데이터, `PaneContext` 의 `pane` 인자, `mirrorTargets`(id 와 `editorKeys` 맵).
- 트리를 재귀로 그린다(`split-branch row|column`, 자식은 `flex-grow: 비율`). 이웃 자식 사이에 경계 손잡이(`SplitHandle`, 두 축, 키보드 ←→/↑↓, 두 번 누르면 반반). 끌 때 양쪽 가지의 `minExtent` 를 지킨다.
- 탭을 끄는 동안 칸마다 놓을 자리를 덮는다(가장자리 네 곳·가운데). 강조는 새 칸이 들어갈 절반. 나눌 수 없는 가장자리는 가운데로 친다.
- 좁은 화면은 포커스된 칸 하나만 그린다. 「좁아지면 합치기」 효과를 걷는다.
- 저장값: `keyring:pane-tree` 로 옮기고 옛 키 옮김(Task 1 함수).

### Task 4: 명령·단축키·탭 메뉴

- 위 표대로 명령을 더하고 바꾼다. `split` 은 오른쪽으로 나누기(활성 탭을 새 칸에 — 같은 노트가 두 칸에 보인다), 「모든 칸 합치기」(`merge-panes`)는 키 없이 팔레트에.
- 탭 메뉴: 「오른쪽으로 나누기」·「아래로 나누기」·「다른 칸으로 옮기기」, 「새 창으로 열기」(웹은 그대로, 데스크톱은 Task 6).

### Task 5: 최소 칸 높이 재기

- 시험 서버(임시 `KEYRING_DATA`, 포트 8804)를 headless 브라우저로 열고 탭 바·문서 머리·본문 한 줄 높이를 잰다. `MIN_PANE_HEIGHT` = 탭 바 + 문서 머리 + 본문 3줄 쯤으로 정하고 잰 대상·방법을 주석에 남긴다.

### Task 6: 데스크톱 새 창

- `@tauri-apps/api/webviewWindow` 의 `WebviewWindow` 로 `solo-<시각>` 라벨 창을 연다(주소는 웹의 `soloUrl` 과 같은 `?solo=1#/<경로>`, 앱 안 상대 경로).
- capability: `default` 에 `core:webview:allow-create-webview-window`, 두 capability 의 `windows` 에 `solo-*` 를 더한다(새 창도 볼트 폴더를 읽고 써야 한다). 모바일은 숨긴다.
- `pnpm --filter @keyring-notes/app build:mac`(서명 없음, `CI=true`)으로 빌드한다.

### Task 7: 문서

- `docs/ops/ux.md` 「화면 분할」 절·구현 현황 8번 행·단축키 표, `README.md`·`README.ko.md` 의 분할 설명을 새 동작으로.

### Task 8: 검증

- 루트에서 `pnpm test`·`pnpm typecheck`·`pnpm build`·`pnpm fmt:check`·`pnpm lint`(실행된 테스트 개수 기록).
- 화면: 좌우·상하 분할, 세 칸 이상, 경계 끌기, 탭을 가장자리·가운데로 끌기, 칸 닫기(가지 걷힘), 단축키, 800px 이하, 새로고침 뒤 배치 유지, 옛 저장값 옮김.
