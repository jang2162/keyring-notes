# Keyring Notes

마크다운 파일을 원본으로 셀프호스팅 서버에 두고, 사람은 웹에서 편집하고 에이전트는 토픽별 권한 토큰으로만 접근하는 개인용 노트 앱.
전체 계획은 [docs/PLAN.md](docs/PLAN.md)에 있다.

> 현재 상태: **1단계 프로토타입** — 파일 저장소, 웹 에디터, Git 이력.
> 아직 로그인·권한이 없으므로 서버는 기본적으로 `127.0.0.1`에만 열린다. 외부에 노출하지 말 것.

## 실행

```bash
npm install
npm run build        # web/dist, server/dist 생성
npm start            # http://127.0.0.1:8787
```

개발 모드(핫 리로드)는 터미널 두 개에서:

```bash
npm run dev:server   # API: 127.0.0.1:8787
npm run dev:web      # 웹: http://localhost:5173 (API는 프록시)
```

### 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `KEYRING_VAULT` | `./vault` | 볼트 폴더 |
| `KEYRING_HOST` | `127.0.0.1` | 바인드 주소 |
| `KEYRING_PORT` | `8787` | 포트 |
| `KEYRING_AUTHOR_NAME` / `KEYRING_AUTHOR_EMAIL` | `me` | 웹 편집을 기록할 작성자 |

### Obsidian 볼트로 시험하기

원본 볼트를 건드리지 않도록 **복사본**을 만들어 연다.

```bash
cp -R ~/ObsidianVault /tmp/vault-copy
KEYRING_VAULT=/tmp/vault-copy npm start
```

서버가 시작할 때 볼트 안의 기존 파일을 `system` 작성자의 커밋 하나로 흡수한다. 이후 서버 밖에서 고친 내용도 다음 시작 때 같은 방식으로 기록된다.

## 저장 구조

- `vault/**.md` — 원본. 순수 마크다운 + YAML 프런트매터.
- `vault/.history/` — Git 저장소(`--git-dir`). 작업 트리는 볼트 자체라서 다른 에디터에서 열어도 `.git`이 보이지 않는다.
- 점으로 시작하는 폴더(`.obsidian`, `.trash`, `.history`)는 트리에서 숨기고 API로 접근할 수 없다.

## REST API (1단계)

모든 변경 요청은 `Content-Type: application/json`이어야 한다.

| 메서드 | 경로 | 본문 / 쿼리 | 설명 |
| --- | --- | --- | --- |
| GET | `/api/tree` | | 폴더·파일 트리 |
| GET | `/api/file?path=` | | 문서 내용과 `hash`(sha256) |
| PUT | `/api/file` | `{path, content, baseHash}` | 쓰기. `baseHash`는 마지막으로 본 버전, 새 문서면 `null` |
| DELETE | `/api/file` | `{path, baseHash}` | 삭제 |
| POST | `/api/move` | `{from, to, baseHash}` | 이동·이름 변경 |
| GET | `/api/raw?path=` | | 첨부 파일(이미지 등) 원본 |
| GET | `/api/history?path=` | | 문서의 커밋 목록(작성자 포함) |
| GET | `/api/revision?path=&rev=` | | 특정 리비전의 내용 |
| POST | `/api/rollback` | `{path, rev, baseHash}` | 과거 리비전으로 되돌리기(새 커밋) |

`baseHash`가 서버의 현재 버전과 다르면 `409 conflict`와 `currentHash`를 돌려주고 아무것도 쓰지 않는다. 웹 에디터는 이때 덮어쓰지 않고 "사본으로 저장" 또는 "서버 버전 불러오기"를 고르게 한다.

## 테스트

```bash
npm test         # 서버: 경로 검증, 충돌 감지, 이력·롤백, 심볼릭 링크 차단, API
npm run typecheck
```
