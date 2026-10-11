# keyring-notes 에이전트 지침

이 파일은 **keyring-notes 저장소만의 규칙**을 담는다. 모든 프로젝트에 공통인 규칙은 `guideline` 서버에서 받은 스택(`.ruler/<스택>/`)이 갖는다.

- 응답·커밋 메시지·문서는 **한국어**로 쓴다. 영어 README(`README.md`)와 한국어 README(`README.ko.md`)는 함께 고친다.
- 진행 중인 사용성 요청·결정·구현 현황은 `docs/ops/ux.md` 에 있다. 화면 동작을 바꾸면 그 절도 고친다. 일이 끝나 굳은 규칙은 `docs/guides/` 로 올린다.
- 화면 글은 `packages/core/src/messages/{en,ko}.json`(키 정렬, 들여쓰기 1칸), 볼트에 남는 글은 `packages/core/src/vaultText.ts` 에 둔다. 영어가 기준이다.
- 다 했다고 말하기 전에 루트에서 `pnpm test`, `pnpm typecheck`, `pnpm build` 를 돌린다. 화면을 바꿨으면 시험 서버(임시 `KEYRING_DATA`, 다른 포트)로 브라우저에서 확인한다.

## 작업별로 읽을 문서

| 언제 | 읽을 문서 |
| --- | --- |
| Docker 이미지·compose·Komodo 배포 구성을 바꿀 때 | `docs/guides/deploy-komodo.md` |
