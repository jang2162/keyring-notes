# 두 칸 편집 분할 이월 4건 — 병합 판정

Oct 12, 2026 · 브랜치 `jang2162/feat-split-followups` → `main`(병합 커밋 `196ae4c`)

`2026-10-12-split-panes-merge.md` 「이월」 의 네 항목을 구현자 워커가 처리하고 독립 리뷰어가 리뷰했다. 전달 문서(브리프·보고서·하네스)는 지워지므로 여기에는 **판정과 이월**만 남긴다.

## 판정

- **병합.** 리뷰 차단 0건, 메모 6건(전부 이월).
- 최종 검증(병합 뒤 `main`): `pnpm test` core 107 · server 175 · web 48(이월로 +9), `pnpm typecheck`, `pnpm build`, `oxfmt --check`, `oxlint` 통과.
- 구현자와 리뷰어가 **각각** 하네스로 재현·차단을 확인했다. `?local` 모드·데스크톱 앱(Tauri)은 보지 않았다.

## 처리한 것

1. **다시 읽기·합치기 직후 옛 뷰 입력이 새 판 초안을 덮는 틈 — 재현됐고 고쳤다**(`edabf58`). React 스케줄러 태스크 직전에 옛 `EditorView` 에 입력을 끼우면 합치기 경로 2/2·다시 읽기 경로 1/1 로 서버 변경이 조용히 덮였다(PUT 본문·서버 파일로 확인). 원인은 `docKeyRef` 가 렌더 중에만 갱신돼 `seq` 올림과 렌더 사이에는 옛 뷰의 `onChange` 가 판을 가리지 않고 초안을 덮는 것. 수정: `openDocs.setDraft(s, path, draft, fromKey)` — 뷰의 `docKey`(경로#seq) 가 저장소 판일 때만 초안을 받는다. 리뷰어가 같은 하네스로 2/2 차단, 판정 한 줄을 빼면 덮임 복귀(쓰기 3건)를 독립 확인. **대가:** 그 틈(수 ms)의 타이핑·핸들 호출(체크박스 토글·템플릿 삽입)은 알림 없이 버려진다 — 덮는 것보다 옳다고 판정.
2. **Editor 판정 함수 단위 테스트**(`361f5c9`). `outgoingChanges`·`mirrorSpec`·`diffChange` 를 `web/src/mirror.ts` 로 빼 테스트 4개. 순수 함수만 고정하므로 Editor 가 그 함수를 안 부르게 되돌리면 못 잡는다 — 항목 1 의 브라우저 하네스가 그 경로를 지킨다.
3. **같은 문서 두 칸 번갈아 치면 이탈 저장이 더 도는 것**(`2522e69`). 원인은 `Editor onBlur` 가 칸 전환마다 저장을 부르는 것. 다음 틱에 같은 문서를 보고 있는 다른 칸 에디터가 포커스를 가졌으면 저장을 건너뛴다(`panes.otherPaneShowing`). PUT 3건 → 1건, 다른 곳으로의 이탈은 40~45ms 에 저장 유지. 리뷰어가 창 blur·`beforeunload`·`autosave=false`·틱 사이 배치 변경을 코드로 따라가 손실 순서 없음(모두 저장하는 쪽으로 기움).
4. **`focus-other-pane` 이 미리보기 칸에서 포커스를 두는 자리**(`1c88e9b`). 관찰은 브리프의 두 가정 어느 쪽도 아니었다 — 숨은 에디터로 가지 않고 **이전 칸 에디터에 남아** 활성 칸(상태 표시줄·저장·탭 닫기 대상)과 키 입력이 어긋났다. 수정: 보이는 에디터가 없는 칸(미리보기·과거 판 보기)은 칸 요소(`section.split-pane`, `tabIndex=-1`)에 포커스, 보기 모드는 그대로. 과거 판 보기 칸은 리뷰어가 브라우저로 확인(칸 요소 포커스·입력 무효·`Alt+W` 가 그 칸 탭을 닫음).

## 이월(병합 뒤 따로)

- **버려진 입력에 알림이 없다**(항목 1 의 대가). 틈이 매우 짧아 그대로 둔다. 필요하면 `setDraft` 거절 시 개발용 로그.
- **올리는 중 판이 바뀌면 자리 표시가 남는다**(이번 변경 전부터). `Editor.tsx insertFiles` 가 처음 받은 `view` 에서 자리 표시를 링크로 바꾸는데, 올리는 동안 seq 가 오르면 그 dispatch 가 막혀 새 판 초안에 `<!-- 올리는 중 -->` 이 남고 자동 저장된다. 코드 추론, 재현 안 함. 바꾸기를 저장소 초안이나 그 문서의 지금 핸들에 다시 걸면 된다.
- **칸 요소에 포커스가 가면 키보드로 미리보기를 스크롤하지 못할 것으로 보인다**(코드 추론). `.preview-pane` 에 `tabIndex=-1` 을 주고 그것에 포커스를 주는 쪽이 낫다.
- **칸 요소의 포커스 테두리를 지웠다**(`.split-pane:focus { outline: none }`). 키 입력이 어디로 가는지 보이지 않는다. `:focus-visible` 일 때만 옅은 테두리를 그리는 정도.
- 칸 안의 빈 곳을 클릭하면 activeElement 가 BODY 대신 `section` 이 된다(`tabIndex` 기본 동작). 해로운 경로 없음, 기록용.
- 접힘 상태는 두 칸이 같은 키를 쓴다(설계상 수용, 이전 보고서에서 이월).

## 작업 환경에서 알게 된 것

- `git checkout -- <파일>` 로 변이를 복구하면 lefthook `post-checkout` 이 돌아 `pnpm install` 이 한 번 돈다. 무해하지만 느리다 — 변이 복구는 `sed` 나 편집으로 되돌리는 쪽이 빠르다.
- 공유 neo 에 이전 작업의 같은 포트 탭이 남아 있으면 그 탭이 새 시험 서버로 낡은 쿠키를 보낸다(콘솔 오류 수백 건). `http://<작업명>.localhost:<포트>` 처럼 호스트를 달리하면 쿠키가 갈린다.

## 지침 서버에 올릴 제안(사본이라 직접 못 고침)

- `browseros-neo/02-playwright.md`: `playwright-neo` MCP 의 `browser_run_code_unsafe`·스크린샷 경로는 **허용 루트 안**(워크트리와 `.playwright-mcp/`)이어야 한다 — 세션 스크래치패드는 `File access denied: … outside allowed roots` 로 막힌다. 하네스는 워크트리의 gitignore 폴더(예: `.superpowers/handoff/pw/`)에 둔다.
- `browseros-neo/02-playwright.md` 또는 `01-limits.md`: `Target.createTarget {background:true}` 로 연 탭은 `document.hasFocus()` 가 false 라 포커스에 기대는 동작(에디터 blur 저장, focus 스타일)이 안 돈다. 그 페이지에 `newCDPSession` 으로 `Emulation.setFocusEmulationEnabled {enabled:true}` 를 보낸 뒤 확인한다.
- `base/08-shared-resources.md` 「머신 전역 자원은 워크트리가 공유한다」 쿠키 항목 뒤: 공유 브라우저에 같은 포트의 옛 탭이 남아 있으면 그 탭이 새 서버로 요청을 보낸다. 시험 서버를 띄우기 전에 그 포트의 탭이 있는지 보고, 쿠키까지 가르려면 `http://<작업명>.localhost:<포트>` 처럼 호스트를 달리해 연다(`*.localhost` 는 루프백으로 풀리고 쿠키는 호스트별이다).
