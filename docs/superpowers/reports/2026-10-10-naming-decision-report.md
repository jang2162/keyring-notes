# 앱 이름 통일 판단: keyring-notes vs tote-note

작성일: 2026-10-10

## 질문

개발 중인 메모앱 두 개의 이름이 `keyring-notes`(복수)와 `tote-note`(단수)다. 이름 형태를 맞춰야 하는지, 맞춘다면 어느 쪽으로 맞출지.

## 결론 (현재 판단)

1. **먼저 "맞출지"를 정한다.** 두 앱을 한 시리즈로 보여줄 계획이 없다면 통일하지 않는 게 가장 싸고 안전하다.
2. **시리즈로 묶을 거라면 복수형 `-notes`로 통일, 즉 `tote-note` → `tote-notes`를 권한다.** 변경 비용이 훨씬 작다.
3. **단수 쪽(`keyring-notes` → `keyring-note`)은 비용이 크다.** 이미 외부에 배포했거나 공유했다면 사실상 피한다.

## 비용 비교 (두 저장소에서 직접 센 값)

| 항목 | keyring-notes | tote-note |
|---|---|---|
| 저장소 전체 출현 횟수 | 84 | 37 |
| 코드/설정 파일 | npm 워크스페이스 4개(`@keyring-notes/core`, `/server`, `/web`, `/app`), `web/src`의 import 다수, Rust 크레이트(`app/src-tauri/Cargo.toml`), `Dockerfile`, `docker-compose.yml` | `package.json`, `src-tauri/Cargo.toml`, `.idea/modules.xml` (3개) |
| 외부 노출 | Docker 이미지 `ghcr.io/jang2162/keyring-notes`, GitHub 저장소 주소 | git remote 없음 (공개 저장소 없는 것으로 보임) |
| 번들 ID | 설정 못 찾음 (검색 1회 실패, 확신 못 함) | `dev.tote.*` (스파이크 기준, 철자와 무관) |

## 의견 간 차이

- **의견 1 (단수 `-note` 권장):** "tote-note가 패키지명·크레이트명·문서에 깔려 있어 비용이 크다"는 전제. 실제로는 코드 파일 3개뿐이라 **전제가 틀렸다.** 다만 이 의견도 keyring-notes 쪽 비용은 못 봤다고 밝혔다.
- **의견 2 (복수 `-notes` 권장):** 비용 계산이 실측과 맞다. 단, 근거로 든 "Google Keep notes"는 제품명이 아니라 약하고, "복수형이 흔하다"는 주장도 약하다.
- **취향 쟁점:** "tote-note는 tote와 note의 말장난이라 복수형이면 리듬이 깨진다"는 주장은 검증 불가. 어감 문제라 직접 판단해야 한다.

## 확인하지 못한 것 (결정 전에 확인)

- `tote-note`로 도메인, npm 이름, 앱 스토어 이름을 이미 잡았는지
- `keyring-notes` 이미지를 다른 사람이 pull하고 있는지, 저장소 주소를 공유했는지
- 두 앱을 같은 브랜드로 묶을 계획이 있는지

## 결정 체크리스트

- [ ] 두 앱을 한 시리즈로 묶을 계획이 있는가? → 없으면 여기서 끝, 변경 없음
- [ ] `tote-notes`의 어감이 괜찮은가?
- [ ] `tote-note` 외부 자원(도메인 등)을 이미 잡았는가?
- [ ] 위가 모두 괜찮다면 `tote-note`의 3개 파일 + 문서(37곳)를 치환
