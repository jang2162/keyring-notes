# Keyring Notes

마크다운 파일을 원본으로 셀프호스팅 서버에 두고, 사람은 웹에서 편집하고 에이전트는 토픽별 권한 토큰으로만 접근하는 개인용 노트 앱.
전체 계획은 [docs/PLAN.md](docs/PLAN.md)에 있다.

> 현재 상태: **5단계(노트 이전 제외)** — 파일 저장소·웹 에디터·Git 이력(1), 로그인·토큰 × 폴더 권한·MCP·일괄 쓰기(2),
> SQLite 인덱스·자동완성·위젯(3), LLM Wiki: 원본 수집·토픽 템플릿·index/log 자동 생성(4),
> 관리 콘솔(상태·에이전트·백업/복원·업데이트·보안), Docker 배포, HTTPS 원격 접속(5).

## 설치(Docker, 권장)

```bash
git clone https://github.com/jang2162/keyring-notes && cd keyring-notes
docker compose up -d --build              # http://127.0.0.1:8787 (이 컴퓨터에서만)
docker compose logs keyring               # "처음 설치: … 설정 코드 → XXXX-XXXX-XXXX"
```

브라우저로 열어 설정 코드와 새 비밀번호를 넣으면 끝이다. 데이터(볼트·설정·백업)는 모두 `keyring-data` 볼륨의 `/data`에 있다.
컨테이너 안 관리 CLI: `docker compose exec keyring keyring agent list`.

### 원격 접속

앱 포트는 기본으로 `127.0.0.1`에만 열린다. 밖에서 쓰려면 둘 중 하나:

- **HTTPS 리버스 프록시(Caddy, 자동 인증서)**: 도메인의 DNS를 서버로 향하게 하고 80·443을 연 뒤
  ```bash
  cp .env.example .env    # KEYRING_PUBLIC_URL=https://notes.example.com, KEYRING_DOMAIN=notes.example.com
  docker compose --profile https up -d
  ```
  사설망·시험용이면 `.env`에 `CADDY_TLS=internal`(Caddy 자체 CA).
- **VPN(Tailscale 등)**: `.env`에 `KEYRING_BIND=<VPN 주소>`와 `KEYRING_ALLOWED_HOSTS=<그 주소·호스트 이름>`. Tailscale이면 `tailscale serve --bg 8787`로 tailnet 안 HTTPS를 붙이는 방법도 있다.

`KEYRING_PUBLIC_URL`을 정하면 그 호스트 이름으로 온 요청만 받고(DNS 리바인딩 방지, 다른 Host는 421) 로그인 쿠키에 `Secure`가 붙는다. 모든 페이지에 CSP·`X-Frame-Options: DENY` 등 보안 헤더가 붙는다.

### 업데이트

관리 콘솔의 "업데이트" 탭이 최신 릴리스를 확인한다. 업데이트 전에 백업을 하나 만들고:

```bash
docker compose pull && docker compose up -d          # GHCR 이미지를 쓸 때(v* 태그마다 .github/workflows/docker.yml이 올림)
git pull && docker compose up -d --build             # 직접 빌드할 때
```

사내 프록시처럼 TLS를 다시 서명하는 곳에서 빌드할 때는 `docker build --secret id=extra_ca,src=<CA.pem> .`(이미지에는 남지 않는다).

## 소스에서 실행

```bash
npm install
npm run build                      # web/dist, server/dist 생성
npm start                          # http://127.0.0.1:8787 — 로그의 설정 코드로 웹에서 비밀번호 설정
                                   # (또는 npm run keyring -- passwd)
```

개발 모드(핫 리로드)는 터미널 두 개에서:

```bash
npm run dev:server   # API: 127.0.0.1:8787
npm run dev:web      # 웹: http://localhost:5173 (API는 프록시)
```

### 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `KEYRING_DATA` | (없음, 도커는 `/data`) | 주면 볼트·설정·백업이 모두 `<DATA>/vault`, `<DATA>/config/keyring.json`, `<DATA>/backups` |
| `KEYRING_VAULT` | `./vault` | 볼트 폴더 |
| `KEYRING_CONFIG` | `./config/keyring.json` | 비밀번호 해시·에이전트 토큰 해시·권한 표·백업 설정. 볼트 밖에 둔다 |
| `KEYRING_BACKUP_DIR` | `./backups` | 백업 파일 폴더 |
| `KEYRING_PUBLIC_URL` | (없음) | 원격 접속 주소(https). 허용 호스트와 Secure 쿠키에 쓰인다 |
| `KEYRING_ALLOWED_HOSTS` | `PUBLIC_URL`의 호스트 | 받을 Host 이름(쉼표로 여럿). localhost는 늘 허용 |
| `KEYRING_UPDATE_URL` | GitHub releases/latest | 업데이트 확인 주소. 빈 값이면 확인하지 않는다 |
| `KEYRING_BACKUP_SCHEDULER` | `1` | `0`이면 자동 백업 스케줄러를 끈다 |
| `KEYRING_FETCH_ALLOW_PRIVATE` | (없음) | `1`이면 URL 수집에서 사설·루프백 주소(사내 위키 등)도 허용. 기본은 SSRF 방지로 막는다 |
| `KEYRING_INDEX` | `<볼트>/.keyring/index.db` | 검색 인덱스(캐시). 지우면 다음 시작 때 다시 만든다 |
| `KEYRING_HOST` | `127.0.0.1` | 바인드 주소 |
| `KEYRING_PORT` | `8787` | 포트 |

### Obsidian 볼트로 시험하기

원본 볼트를 건드리지 않도록 **복사본**을 만들어 연다.

```bash
cp -R ~/ObsidianVault /tmp/vault-copy
KEYRING_VAULT=/tmp/vault-copy npm start
```

서버가 시작할 때 볼트 안의 기존 파일을 `system` 작성자의 커밋 하나로 흡수한다. 이후 서버 밖에서 고친 내용도 다음 시작 때 같은 방식으로 기록된다.

## 관리 콘솔

사이드바의 ⚙. 소유자만 쓸 수 있다(에이전트 토큰은 403).

- **서버 상태**: 버전·실행 시간, 문서·파일 수와 용량, 커밋 수와 마지막 변경, 디스크 여유, 백업 현황, 에이전트별 마지막 접속. HTTPS 아님·허용 호스트 없음·백업 없음·디스크 부족이면 경고.
- **에이전트·권한**: 에이전트 만들기(토큰과 MCP 설정 예를 한 번만 보여 줌), 폴더별 권한 표 편집, 토큰 재발급, 삭제.
- **백업·복원**: 지금 백업, 내려받기, 다른 서버의 백업 파일 올리기, 복원, 자동 백업 설정(간격·남길 개수·설정 포함 여부).
- **업데이트**: 지금·최신 버전 확인과 업데이트 방법.
- **보안**: 비밀번호 변경(다른 기기의 로그인은 모두 끊김), 원격 접속 안내.

### 백업 형식

`keyring-<시각>-<auto|manual|pre-restore>.tar.gz` 하나에 `manifest.json`, `vault.bundle`(`git bundle --all`: 모든 문서·첨부와 전체 이력), 선택으로 `config.json`(비밀번호·토큰 해시, 권한 표)이 들어간다. 검색 인덱스와 위키 index·log는 다시 만들 수 있어 넣지 않는다.

- 백업 직전에 서버 밖에서 생긴 변경도 커밋해 넣는다.
- 자동 백업은 간격(기본 24시간)이 지났고 마지막 자동 백업 뒤 바뀐 것이 있을 때만 만들고, 자동 백업만 개수(기본 14)를 넘으면 지운다.
- **복원**은 먼저 지금 상태를 `pre-restore` 백업으로 남기고 지금 HEAD를 `refs/keyring/before-restore-<시각>`에 보관한 뒤, 볼트 파일과 이력을 백업 시점으로 바꾼다. 그래서 복원도 되돌릴 수 있다. 설정 복원은 고를 때만.
- 다른 서버로 옮기기: 백업을 내려받아 새 서버 관리 콘솔에서 올린 뒤 "복원"(설정도 복원하면 비밀번호·에이전트까지 그대로).

## 노트 쓰기

- **위키링크**: `[[문서]]`, `[[폴더/문서]]`, `[[문서#제목|별칭]]`, `![[이미지.png|300]]`. `[[`를 치면 문서·첨부 이름이 자동완성된다(같은 이름이 여럿이면 경로로 구분).
- **할 일**: `- [ ] 할 일`. 미리보기의 체크박스를 누르면 원문이 바뀐다(저장해야 반영).
- **검색**: 사이드바 검색창. 공백으로 나눈 단어를 모두 포함한 문서를 찾고, `#태그` 단어는 태그 조건이 된다(하위 태그 포함). 본문·제목·경로·프런트매터를 모두 찾는다.
- **백링크**: 미리보기 아래에 이 문서를 링크한 문서 목록.

### 위젯

`widget` 언어 이름을 붙인 코드 블록에 YAML로 쓴다. 다른 에디터에서는 평범한 코드 블록으로 보인다.

````markdown
```widget
type: query          # query(목록) | table(표) | tasks(할 일) | chart(차트)
from: 업무/프로젝트A  # 폴더, "#태그", 또는 목록. 생략하면 볼트 전체
where: status != done # 조건 하나 또는 목록(모두 만족)
show: [title, due]
sort: due            # -due 또는 "due desc"는 역순, 목록이면 여러 기준
limit: 50
```
````

| 항목 | 설명 |
| --- | --- |
| 필드 | 프런트매터 키 + 내장 필드 `path`, `title`(프런트매터 title → 첫 `#` 제목 → 파일 이름), `folder`, `name`, `tags`, `modified` |
| 조건 | `=` `!=` `>` `>=` `<` `<=` `contains` `!contains`, `필드`(값 있음), `!필드`(값 없음). 값 `today`는 오늘 날짜(YYYY-MM-DD) |
| `tasks` | `status: open`(기본) / `done` / `all`. 위젯에서 체크하면 원본 문서에 바로 저장된다 |
| `chart` | `chart: bar`(기본) / `line`, `x: 묶을 필드`, `y: 숫자 필드`, `agg: sum`(y가 있으면 기본) / `count` / `avg`. 또는 `data: [{label, value}]`로 직접 입력. "표로 보기" 제공 |

위젯도 권한 계층을 지나므로, 에이전트가 같은 쿼리를 돌려도(MCP `query`) 볼 수 있는 문서만 나온다.

## LLM Wiki

원본 자료 → 에이전트가 관리하는 위키 → 스키마의 세 층으로 운영하는 토픽이다. 최상위 폴더에 `SCHEMA.md`가 있으면 위키 토픽이 된다.

```
경제/
├── SCHEMA.md            위키 구조와 작업 절차(수집·질의·정리). 사람만 고친다 — 에이전트는 규칙과 상관없이 읽기만
├── raw/                 수집한 원본(마크다운 변환본). 에이전트 권장 권한: append
│   └── assets/          원본 파일(PDF·이미지·HTML)
└── wiki/                에이전트가 관리하는 페이지. 권장 권한: delete
    ├── index.md         [자동] 페이지 목록(분류·요약·출처 수) + 미반영/반영된 원본
    └── log.md           [자동] Git 이력으로 만든 작업 기록: ## [날짜 시각] 작성자 | 메시지
```

1. **토픽 만들기**: 웹의 📥(수집) → "새 위키 토픽". `SCHEMA.md` 템플릿이 생기니 목적과 규칙을 채운다.
2. **에이전트 권한**: `agent grant <이름> 경제/raw append`, `경제/wiki delete`, `경제/SCHEMA.md read`.
3. **원본 수집**(📥 또는 MCP):
   - 파일: PDF(텍스트 추출, 쪽별), 이미지, HTML, 마크다운·텍스트. 파일당 50MB.
   - URL: 서버가 가져와 본문만 마크다운으로(Readability + Turndown). PDF 링크면 PDF로 처리.
   - 웹 클리퍼: URL 탭의 "📎 Keyring 클립"을 북마크바에 끌어다 놓고, 저장할 페이지에서 누른다. 로그인이 필요한 페이지도 브라우저가 가진 HTML을 보내므로 저장되고, 선택한 부분만 저장할 수도 있다.
   - 붙여넣기: 텍스트·마크다운 그대로.
   - 저장 위치: `<토픽>/raw/<날짜> <제목>.md`. 프런트매터에 `source_type`, `source_url`, `original`, `ingested_at`, `ingested_by`.
4. **index·log**: 위키 토픽 안에서 무언가 바뀔 때마다 서버가 다시 만든다. 직접 고칠 수 없고 Git·검색 인덱스에도 넣지 않는다. 읽는 사람의 권한에 맞춰 만들므로, 원본을 볼 수 없는 에이전트에게는 원본 이름이 나오지 않는다. 원본은 위키 페이지가 본문 링크나 `sources`로 인용하면 "반영"으로 바뀐다.

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
| `list_topics` | 토픽 목록. `wiki: true`면 LLM Wiki 토픽 |
| `ingest_url` | URL(웹 페이지·PDF)을 가져와 `<토픽>/raw/`에 저장 |
| `ingest_text` | 가진 텍스트를 `<토픽>/raw/`에 원본으로 저장 |
| `list_documents` | 읽을 수 있는 문서와 각 권한 |
| `read_outline` | 해시·줄 수·프런트매터·제목(줄 범위)·위키링크. 본문 없음 |
| `read_section` | 제목(`상위 > 하위`) 또는 줄 범위로 일부만 읽기 |
| `read_document` | 전체 읽기 |
| `list_frontmatter` | 폴더 안 문서들의 프런트매터를 한 번에 |
| `search` | 전체 텍스트 검색(`#태그` 단어는 태그 조건) |
| `backlinks` | 이 문서를 링크한 문서 |
| `list_tags` | 태그와 문서 수 |
| `query` | 위젯과 같은 YAML 쿼리(query·table·tasks·chart) |
| `write_document` / `append_document` | 쓰기 / 끝에 덧붙이기 |
| `move_document` / `delete_document` | 이동 / 삭제 |
| `batch_write` | write·append·delete·move 여러 개를 한 커밋으로. 하나라도 실패하면 전부 취소 |

쓰기에는 마지막으로 읽은 `hash`를 `base_hash`로 넘긴다(새 문서는 `null`). 서버 버전과 다르면 `conflict`와 `current_hash`를 돌려주고 아무것도 쓰지 않는다.

## 저장 구조

- `vault/**.md` — 원본. 순수 마크다운 + YAML 프런트매터.
- `vault/.history/` — Git 저장소(`--git-dir`). 작업 트리는 볼트 자체라서 다른 에디터에서 열어도 `.git`이 보이지 않는다.
- 점으로 시작하는 폴더(`.obsidian`, `.trash`, `.history`)는 트리에서 숨기고 API로 접근할 수 없다.
- `vault/.keyring/index.db` — SQLite 인덱스(본문 FTS5 trigram, 태그, 링크, 할 일, 프런트매터). 서버 시작 때 바뀐 파일만 다시 읽어 맞추고, 서버를 통한 변경은 커밋 직후 반영한다. Git 추적에서 빠진다.
- `config/keyring.json` — 권한 0600. 비밀번호는 scrypt 해시, 토큰은 sha256 해시만 저장한다.

## 구조

```
웹(쿠키 로그인) ─┐
                 ├─ REST /api/*  ─┐
에이전트(토큰) ──┤                ├─ ScopedVault(권한 계층) ─ Vault(파일·일괄 쓰기) ─ Git
                 └─ MCP /mcp ─────┘
```

REST와 MCP는 모두 `server/src/scoped.ts`의 `ScopedVault`를 거쳐서만 볼트와 인덱스에 닿는다. 인덱스는 권한을 모르고, 검색·백링크·태그·위젯 결과는 모두 `ScopedVault`에서 권한으로 거른다. 모든 변경은 `Vault.batch()` 하나를 지나며, 가상의 상태에서 권한·충돌을 먼저 모두 검사한 뒤 디스크에 적용하고 한 커밋으로 남긴다. 적용이나 커밋 중에 실패하면 원래 내용으로 되돌린다.

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
| GET | `/api/health` | | 헬스체크(인증 없음) |
| POST | `/api/auth/setup` | `{code, password}` | 처음 설치(비밀번호가 없을 때만, 로그의 설정 코드) |
| * | `/api/admin/…` | | 관리 콘솔 API(소유자만): `status`, `update`, `agents`, `agents/:name/rules`·`rotate`, `password`, `backups`, `backups/settings`, `backups/upload`, `backups/:name/restore` |
| GET · POST | `/api/topics` | `{name}` | 토픽 목록 / 위키 토픽 만들기(소유자) |
| POST | `/api/ingest` | `{kind: url\|html\|text, topic, ...}` | 원본 수집 |
| POST | `/api/ingest/file?topic=&name=` | 파일 바이트, 헤더 `x-keyring-upload: 1` | 파일 업로드 수집 |
| GET | `/api/backlinks?path=` | | 백링크 |
| GET | `/api/tags` | | 태그와 문서 수 |
| POST | `/api/widget` | `{source}` | 위젯 YAML 실행 |
| POST | `/api/task` | `{path, line, done, baseHash}` | 할 일 체크 |
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
npm test         # 경로 검증, 충돌, 이력·롤백, 일괄 쓰기 원자성, 권한(숨김·읽기·추가 전용), 인증, MCP,
                 # 한국어 검색, 태그, 백링크, 인덱스 동기화, 위젯, 할 일 체크,
                 # 위키 토픽, 수집(URL·PDF·이미지·클립), SSRF 차단, index·log 생성과 권한별 내용,
                 # 백업·복원(되돌리기·다른 서버로 옮기기)·자동 백업, 관리 API 권한, 처음 설치, 허용 호스트·보안 헤더
npm run typecheck
```
