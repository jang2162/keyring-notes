# 두 칸 편집 분할 — 병합 판정

Oct 12, 2026 · 브랜치 `jang2162/feat-split-panes` → `main`(병합 커밋 `e1140ea`)

설계 `docs/superpowers/specs/2026-10-12-split-panes-design.md`, 계획 `docs/superpowers/plans/2026-10-12-split-panes.md` 를 구현자 워커가 9태스크로 구현하고, 독립 리뷰어가 리뷰·재검했다. 전달 문서(브리프·보고서)는 지워지므로 여기에는 **판정과 이월**만 남긴다.

## 판정

- **병합.** 리뷰 차단 1건을 수정한 뒤 재검에서 차단 0건.
- 최종 검증(병합 뒤 `main`): `pnpm test` core 107 · server 175 · web 39(분할로 +10), `pnpm typecheck`, `pnpm build`, `oxfmt --check`, `oxlint` 통과.
- 브라우저 확인은 시험 서버와 `?local` 양쪽에서 구현자가 돌리고(스크린샷 26장), 리뷰어가 핵심 경로(같은 문서 두 칸, 차단 경로 2개)를 독립 재현했다. 데스크톱 앱(Tauri)·실제 터치 기기는 보지 않았다.

## 리뷰에서 차단으로 판정하고 고친 것

**칸의 문서가 바뀌는 렌더 한 틈에 들어온 ChangeSet 이 다른 문서를 덮고 자동 저장되는 경로.** 보낼 칸은 즉시 갱신되는 배치 ref 로 고르면서 보내는 곳은 마지막으로 그려진 에디터 핸들이어서, 탭 닫기·좁은 화면 합치기 직후 Y 에디터가 X 내용을 받아 서버의 `Y.md` 를 덮었다(강제 타이밍 2/2 재현, 실제 키보드 0/8). 수정: 전달 대상을 에디터의 `docKey`(경로#판)로 판정하는 순수 함수 `mirrorTargets`(`web/src/mirror.ts`, 테스트 4개), 받은 변경은 초안을 쓰지 않음, 낡은 뷰의 콜백 차단. 수정 뒤 같은 하네스로 2/2 차단.

## 이월(병합 뒤 따로)

아래 중 접힘 상태를 뺀 다섯 항목은 `2026-10-12-split-panes-followups-merge.md`(병합 `196ae4c`)에서 처리했다. 그때 새로 나온 이월은 그 문서에 있다.

- **다시 읽기·합치기(`seq` 올림) 직후, 렌더 전에 옛 뷰에 친 입력이 새 판의 초안을 덮는 틈.** 이 브랜치 이전부터 한 칸에서도 있던 순서다(추론, 재현 안 함).
- Editor 쪽 두 조건(받은 변경의 `onChange` 생략, 낡은 뷰 콜백 차단)에 단위 테스트가 없다. 브라우저 재현이 대신 지킨다.
- 같은 문서 두 칸을 번갈아 치면 「에디터 이탈 저장」이 한 번 더 돈다(쓰기 2건, 둘 다 200, 409 아님). 비용 문제.
- `focus-other-pane` 이 미리보기 모드 칸에서 숨은 에디터에 포커스를 주는지 미확인.
- 접힘 상태는 두 칸이 같은 키를 쓴다(설계상 받아들인 한계).
- **oxfmt·oxlint 가 어느 `package.json` 에도 없어** 깨끗한 워크트리에서 pre-commit 훅이 `oxfmt not found` 로 실패한다. 루트 `devDependencies` 에 고정하는 쪽으로 처리한다(`docs/guideline/oxc/00-version.md` 를 읽고).

## 지침 서버에 올릴 제안(사본이라 직접 못 고침)

- `mcp/playwright-neo`: `--cdp-endpoint` 포트를 기본값으로 박지 말고 neo 설정 파일(`~/Library/Application Support/BrowserClaw/.browseros/config.json`)의 `ports.cdp` 를 읽는 래퍼로 띄운다. 이 머신은 9112 라 9110 으로 `ECONNREFUSED` 가 났다.
- `lefthook/02-post-checkout.md` 「post-checkout 은 런타임을 맞춘 뒤에…」: 예시 `run` 을 `mise trust && mise install` 로. 새 워크트리의 `mise.toml` 은 신뢰되지 않아 `mise install` 이 바로 실패한다.
