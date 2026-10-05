# Keyring Notes

마크다운 파일을 원본으로 셀프호스팅 서버에 두고, 사람은 웹에서 편집하고 에이전트는 토픽별 권한 토큰으로만 접근하는 개인용 노트 앱.
전체 계획은 [docs/PLAN.md](docs/PLAN.md)에 있다.

> 현재 상태: **2단계** — 파일 저장소·웹 에디터·Git 이력(1단계) + 소유자 로그인, 토큰 × 폴더 권한, 내장 MCP 서버, 일괄 쓰기.
> 서버는 기본적으로 `127.0.0.1`에만 열린다. 원격 접속(HTTPS·VPN)은 5단계에서 다룬다.

## 실행

```bash
npm install
npm run build                      # web/dist, server/dist 생성
npm run keyring -- passwd          # 웹 로그인 비밀번호 설정(처음 한 번)
npm start                          # http://127.0.0.1:8787
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
| `KEYRING_CONFIG` | `./config/keyring.json` | 비밀번호 해시·에이전트 토큰 해시·권한 표. 볼트 밖에 둔다 |
| `KEYRING_HOST` | `127.0.0.1` | 바인드 주소 |
| `KEYRING_PORT` | `8787` | 포트 |

### Obsidian 볼트로 시험하기

원본 볼트를 건드리지 않도록 **복사본**을 만들어 연다.

```bash
cp -R ~/ObsidianVault /tmp/vault-copy
KEYRING_VAULT=/tmp/vault-copy npm start
```

서버가 시작할 때 볼트 안의 기존 파일을 `system` 작성자의 커밋 하나로 흡수한다. 이후 서버 밖에서 고친 내용도 다음 시작 때 같은 방식으로 기록된다.

## 에이전트 연결

### 1. 토큰 발급과 권한 지정

```bash
npm run keyring -- agent add wiki-work                    # 토큰은 이때 한 번만 보인다
npm run keyring -- agent grant wiki-work 업무/raw append
npm run keyring -- agent grant wiki-work 업무/wiki delete
npm run keyring -- agent grant wiki-work 업무/SCHEMA.md read
npm run keyring -- agent list
```

그 밖의 명령: `agent rotate <이름>`(토큰 재발급, 이전 토큰 즉시 무효), `agent revoke <이름> <경로>`, `agent remove <이름>`.
설정 파일이 바뀌면 서버가 다음 요청부터 다시 읽으므로 재시작할 필요가 없다.

| 권한 | 할 수 있는 일 |
| --- | --- |
| `hidden` | 없음. 목록·검색·링크 해석에서도 빠지고, 읽기는 "없는 문서"와 같은 오류 |
| `read` | 읽기, 검색, 이력 조회 |
| `append` | + 새 문서 만들기, 기존 문서 **끝에 덧붙이기**(기존 내용 수정·삭제·이동 불가) |
| `write` | + 기존 내용 수정, 롤백 |
| `delete` | + 삭제, 다른 곳으로 이동 |

- 규칙이 없는 경로는 `hidden`이다. 볼트 전체 규칙은 경로 `/`로 준다.
- 같은 문서에 여러 규칙이 걸리면 가장 구체적인(긴) 경로의 규칙이 이긴다.
- 에이전트가 만든 커밋은 작성자가 에이전트 이름으로 기록된다.

### 2. MCP 클라이언트 설정

Streamable HTTP(무상태, JSON 응답) 방식이다.

- URL: `http://127.0.0.1:8787/mcp`
- 헤더: `Authorization: Bearer <토큰>`

| 도구 | 설명 |
| --- | --- |
| `whoami` | 내 이름과 권한 표 |
| `list_documents` | 읽을 수 있는 문서와 각 권한 |
| `read_outline` | 해시·줄 수·프런트매터·제목(줄 범위)·위키링크. 본문 없음 |
| `read_section` | 제목(`상위 > 하위`) 또는 줄 범위로 일부만 읽기 |
| `read_document` | 전체 읽기 |
| `list_frontmatter` | 폴더 안 문서들의 프런트매터를 한 번에 |
| `search` | 전체 텍스트 검색(3단계에서 SQLite FTS로 교체 예정) |
| `write_document` / `append_document` | 쓰기 / 끝에 덧붙이기 |
| `move_document` / `delete_document` | 이동 / 삭제 |
| `batch_write` | write·append·delete·move 여러 개를 한 커밋으로. 하나라도 실패하면 전부 취소 |

쓰기에는 마지막으로 읽은 `hash`를 `base_hash`로 넘긴다(새 문서는 `null`). 서버 버전과 다르면 `conflict`와 `current_hash`를 돌려주고 아무것도 쓰지 않는다.

## 저장 구조

- `vault/**.md` — 원본. 순수 마크다운 + YAML 프런트매터.
- `vault/.history/` — Git 저장소(`--git-dir`). 작업 트리는 볼트 자체라서 다른 에디터에서 열어도 `.git`이 보이지 않는다.
- 점으로 시작하는 폴더(`.obsidian`, `.trash`, `.history`)는 트리에서 숨기고 API로 접근할 수 없다.
- `config/keyring.json` — 권한 0600. 비밀번호는 scrypt 해시, 토큰은 sha256 해시만 저장한다.

## 구조

```
웹(쿠키 로그인) ─┐
                 ├─ REST /api/*  ─┐
에이전트(토큰) ──┤                ├─ ScopedVault(권한 계층) ─ Vault(파일·일괄 쓰기) ─ Git
                 └─ MCP /mcp ─────┘
```

REST와 MCP는 모두 `server/src/scoped.ts`의 `ScopedVault`를 거쳐서만 볼트에 닿는다. 모든 변경은 `Vault.batch()` 하나를 지나며, 가상의 상태에서 권한·충돌을 먼저 모두 검사한 뒤 디스크에 적용하고 한 커밋으로 남긴다. 적용이나 커밋 중에 실패하면 원래 내용으로 되돌린다.

## REST API

인증: 웹은 `POST /api/auth/login`이 주는 쿠키(HttpOnly, SameSite=Strict), 에이전트는 `Authorization: Bearer <토큰>`. 모든 변경 요청은 `Content-Type: application/json`이어야 한다.

| 메서드 | 경로 | 본문 / 쿼리 | 설명 |
| --- | --- | --- | --- |
| GET | `/api/auth/status` | | 로그인 상태 |
| POST | `/api/auth/login` · `/api/auth/logout` | `{password}` | 소유자 로그인 / 로그아웃 |
| GET | `/api/whoami` | | 이름과 권한 표 |
| GET | `/api/tree` · `/api/documents` | `?folder=` | 트리 / 평면 목록 |
| GET | `/api/file?path=` | | 문서 내용과 `hash`(sha256) |
| GET | `/api/outline?path=` | | 문서 개요 |
| GET | `/api/section?path=` | `&heading=` 또는 `&start=&end=` | 섹션 읽기 |
| GET | `/api/frontmatter` | `?folder=&fields=a,b` | 프런트매터 목록 |
| GET | `/api/search?q=` | `&folder=&limit=` | 검색 |
| PUT | `/api/file` | `{path, content, baseHash}` | 쓰기. 새 문서면 `baseHash: null` |
| POST | `/api/append` | `{path, content, baseHash?}` | 끝에 덧붙이기 |
| DELETE | `/api/file` | `{path, baseHash}` | 삭제 |
| POST | `/api/move` | `{from, to, baseHash}` | 이동·이름 변경 |
| POST | `/api/batch` | `{message?, operations: [{op, ...}]}` | 일괄 쓰기 |
| GET | `/api/raw?path=` | | 첨부 파일(이미지 등) 원본 |
| GET | `/api/history?path=` | | 문서의 커밋 목록(작성자 포함) |
| GET | `/api/revision?path=&rev=` | | 특정 리비전의 내용 |
| POST | `/api/rollback` | `{path, rev, baseHash}` | 과거 리비전으로 되돌리기(새 커밋) |

오류: `401` 인증 없음, `403` 권한 없음, `404` 없음(숨김 포함), `409` 충돌(`currentHash` 포함).

## 테스트

```bash
npm test         # 경로 검증, 충돌, 이력·롤백, 일괄 쓰기 원자성, 권한(숨김·읽기·추가 전용), 인증, MCP
npm run typecheck
```
