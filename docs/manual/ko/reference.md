<!-- source: docs/manual/en/reference.md @ v0.9.0 -->
# 참조

Keyring Notes 의 명령, API, 파일 형식을 정확히 모았습니다.

서버를 스크립트로 다루거나, 에이전트를 연결하거나, 볼트 파일을 직접 고치는 분을 위한 문서입니다. 단계별 작업은 방법 안내 문서에서 시작하세요.

## 명령줄 도구

관리 CLI 는 소스 체크아웃에서 `pnpm keyring <명령>`, Docker 에서는 `docker compose exec keyring keyring <명령>` 으로 실행합니다.

| 명령 | 설명 |
| --- | --- |
| `passwd` | 소유자(웹 로그인) 비밀번호를 정합니다 |
| `agent list` | 에이전트와 권한을 봅니다 |
| `agent add <이름>` | 에이전트를 만들고 토큰을 발급합니다. 토큰은 이때 한 번만 보입니다 |
| `agent rotate <이름>` | 토큰을 다시 발급합니다. 이전 토큰은 바로 쓸 수 없게 됩니다 |
| `agent remove <이름>` | 에이전트를 지웁니다 |
| `agent grant <이름> <경로> <단계>` | 폴더나 노트의 권한을 정합니다. 경로 `/` 는 볼트 전체입니다 |
| `agent revoke <이름> <경로>` | 규칙을 지웁니다. 상위 규칙이나 `hidden` 이 다시 적용됩니다 |

설정 파일이 바뀌면 서버가 다음 요청부터 다시 읽으므로 재시작할 필요가 없습니다.

## 권한

| 단계 | 할 수 있는 일 |
| --- | --- |
| `hidden` | 없음. 목록·검색·링크 해석에서도 빠지고, 읽으면 없는 노트와 같은 오류가 납니다 |
| `read` | 읽기, 검색, 이력 보기 |
| `append` | `read` 에 더해 새 노트 만들기, 기존 노트 끝에 덧붙이기. 기존 내용을 고치거나 지우거나 옮길 수는 없습니다 |
| `write` | `append` 에 더해 기존 내용 고치기, 되돌리기 |
| `delete` | `write` 에 더해 지우기, 다른 곳으로 옮기기 |

규칙:

- 규칙이 없는 경로는 `hidden` 입니다. 볼트 전체 규칙은 경로 `/` 로 줍니다.
- 한 노트에 규칙이 여럿 걸리면 가장 구체적인(긴) 경로의 규칙이 이깁니다.
- 노드 규칙은 폴더와 노트를 함께 덮습니다. `업무/프로젝트` 는 `업무/프로젝트/…` 와 `업무/프로젝트.md` 를 덮습니다(더 구체적인 `업무/프로젝트.md` 규칙이 있으면 그것). `업무/비밀: hidden` 이면 노트 `업무/비밀.md` 도 목록, 검색, 백링크, 링크 해석, 태그, 그래프, 위젯, 위키 index·log, 이력 어디에도 나오지 않습니다.
- 볼 수 없는 경로가 하나라도 든 커밋은 메시지가 "(숨김 경로가 포함된 변경)"으로 바뀌어 보입니다. 판정은 커밋 메시지가 아니라 실제로 바뀐 경로 목록(옮긴 노드의 원래·새 경로 포함)으로 합니다.
- 위키 토픽의 `SCHEMA.md` 와 볼트의 `keyring-settings.md` 는 규칙과 상관없이 에이전트에게 읽기 전용입니다.
- 에이전트가 만든 커밋은 작성자가 에이전트 이름으로 남습니다.

## MCP 도구

MCP 엔드포인트는 `http://<서버>/mcp` 이고 Streamable HTTP(무상태, JSON 응답)입니다. `Authorization: Bearer <토큰>` 을 보내세요.

도구 설명과 오류 글은 서버의 **에이전트 언어** 설정(기본 영어)을 따릅니다. 오류에는 언어와 상관없는 `code` 도 붙습니다.

| 도구 | 설명 |
| --- | --- |
| `whoami` | 내 이름과 권한 표 |
| `list_children` | 노드의 하위(노트·하위 노드·첨부 수). 경로를 비우면 워크스페이스 목록 |
| `list_topics` | 토픽 목록(`<워크스페이스>/<토픽>`). `wiki: true` 는 LLM Wiki 토픽 |
| `ingest_url` | URL(웹 페이지·PDF)을 가져와 `<토픽>/raw/` 에 저장 |
| `ingest_text` | 가진 텍스트를 `<토픽>/raw/` 에 원본으로 저장 |
| `list_documents` | 읽을 수 있는 노트와 각각의 권한 |
| `read_outline` | 해시, 줄 수, 프런트매터, 제목(줄 범위), 위키링크. 본문은 없음 |
| `read_section` | 제목(`상위 > 하위`, 또는 `^p3` 같은 블록 ID)이나 줄 범위로 일부만 읽기 |
| `read_document` | 노트 전체 읽기 |
| `list_frontmatter` | 폴더 안 노트들의 프런트매터를 한 번에 |
| `search` | 전체 텍스트 검색. `#태그` 단어는 태그 조건 |
| `backlinks` | 이 노트를 링크한 노트 |
| `unlinked_mentions` | 이 노트 이름이 링크 없이 나오는 노트와 자리(줄·위치·문맥) |
| `list_tags` | 태그와 노트 수 |
| `query` | 위젯과 같은 YAML 쿼리(`query`, `table`, `cards`, `kanban`, `tasks`, `chart`, `plugin`) |
| `sources` | 출처(프런트매터 `sources`), 이 노트를 인용한 페이지, 본문 백링크 |
| `lint` | 정리 점검 |
| `semantic_search` | 의미 검색. 서버에 임베딩 모델이 있을 때 |
| `my_proposals` | 내가 올린 변경 제안의 처리 결과 |
| `write_document` / `append_document` | 쓰기 / 끝에 덧붙이기 |
| `move_document` / `delete_document` | 옮기기 / 지우기. 옮기면 이 노트를 가리키는 링크를 같은 커밋에서 고칩니다(`update_links: false` 로 끔). 결과에 `linksUpdated` 와 `linkCount` 가 붙습니다 |
| `batch_write` | 쓰기·덧붙이기·지우기·옮기기 여럿을 한 커밋으로. 하나라도 실패하면 아무것도 반영하지 않습니다. 옮기기는 링크도 고칩니다(`update_links`) |

쓸 때는 마지막으로 읽은 `hash` 를 `base_hash` 로 넘기세요(새 노트는 `null`). 서버 버전과 다르면 `conflict` 와 `current_hash` 를 돌려주고 아무것도 쓰지 않습니다. 검토 대상 폴더에 쓰면 `pending` 을 돌려줍니다. 볼트는 그대로이고, 돌려준 `hash` 는 승인 뒤의 해시입니다.

## REST API

### 인증

- 웹 앱은 `POST /api/auth/login` 이 주는 쿠키(HttpOnly, SameSite=Strict)를 씁니다.
- 에이전트와 앱 기기는 `Authorization: Bearer <토큰>` 을 보냅니다.
- 바꾸는 요청은 모두 `Content-Type: application/json` 이어야 합니다. 파일 올리기는 대신 원본 바이트와 헤더 `x-keyring-upload: 1` 을 보냅니다.
- CORS 응답은 `Authorization` 헤더가 있는 요청, 기기 등록, `/api/health` 에만 보냅니다.

`GET /llms.txt` 는 인증이 필요 없습니다. LLM 에이전트용 짧은 정적 안내를 마크다운으로 줍니다: 연결 방법, 권한 단계, 주요 작업, `baseHash` 충돌 규칙. 볼트나 설정 내용은 담지 않습니다. `KEYRING_PUBLIC_URL` 을 정했으면 링크가 절대 주소, 아니면 상대 경로입니다.

### 엔드포인트

| 메서드 | 경로 | 본문 / 쿼리 | 설명 |
| --- | --- | --- | --- |
| GET | `/api/health` | | 헬스 체크(인증 없음) |
| GET | `/api/auth/status` | | 로그인 상태 |
| POST | `/api/auth/setup` | `{code, password}` | 처음 설정. 비밀번호가 없을 때만. 설정 코드는 서버 로그에 있습니다 |
| POST | `/api/auth/login` · `/api/auth/logout` | `{password}` | 소유자 로그인 / 로그아웃 |
| POST | `/api/auth/passkey/options` · `/api/auth/passkey/login` | `{}` · `{id, response}` | 패스키 로그인: 도전값을 받고 서명을 보냅니다. 맞으면 로그인 쿠키 |
| POST | `/api/auth/device` | `{password, name}` | 앱 기기 등록 → `{id, name, token}`. 토큰은 한 번만 보입니다 |
| GET·POST·DELETE | `/api/admin/passkeys` · `/api/admin/passkeys/options` · `/api/admin/passkeys/:id` | | 패스키 목록·등록(`{id, response, name}`)·삭제. 소유자 웹 로그인만 |
| * | `/api/admin/…` | | 관리 콘솔 API, 소유자만: `status`, `update`, `language`, `devices`(·`DELETE devices/:id`), `agents`(·`DELETE agents/:name`), `agents/:name/rules`, `agents/:name/rotate`, `password`, `backups`(·`GET`·`DELETE backups/:name`), `backups/settings`, `backups/upload`, `backups/:name/restore`, `backups/:name/push`, `backups/remote`, `backups/remote/:name/fetch`, `automation`, `automation/webhooks`, `automation/jobs`, `automation/webhooks/:id/test`, `automation/jobs/:id/run` |
| GET | `/api/whoami` | | 이름과 권한 표 |
| GET | `/api/tree` · `/api/documents` | `?folder=` | 트리 / 평면 목록 |
| GET | `/api/children` | `?path=` | 노드의 하위. 경로를 비우면 워크스페이스 목록 |
| GET | `/api/file?path=` | | 노트 내용과 `hash`(sha256) |
| GET | `/api/outline?path=` | | 노트 개요 |
| GET | `/api/section?path=` | `&heading=` 또는 `&start=&end=` | 섹션 읽기 |
| GET | `/api/frontmatter` | `?folder=&fields=a,b` | 프런트매터 목록 |
| GET | `/api/properties` | | 볼 수 있는 노트의 속성 이름·종류·노트 수·자주 쓴 값 |
| GET | `/api/search?q=` | `&folder=&tag=&lines=&limit=` | 검색. `tag` 를 여러 번 주면 그 태그를 모두 가진 노트만 찾습니다. `lines` 를 주면 노트마다 일치 줄을 그만큼(0 이상의 정수, 최대 50) 붙입니다 |
| GET | `/api/semantic` · `/api/semantic/status` | `?q=&folder=&limit=` | 의미 검색 / 상태 |
| GET | `/api/tags` | `?folder=` | 태그와 노트 수(폴더·노드 범위) |
| GET | `/api/backlinks?path=` | | 백링크 |
| GET | `/api/mentions?path=` | | 연결되지 않은 언급(볼 수 있는 노트만) |
| GET | `/api/sources?path=` | | 출처, 인용, 백링크 |
| GET | `/api/graph` | `?folder=` | 그래프(노드·링크) |
| GET | `/api/lint` | `?folder=&staleDays=` | 정리 점검 |
| POST | `/api/widget` | `{source}` | 위젯 YAML 실행 |
| POST | `/api/task` | `{path, line, done, baseHash}` | 할 일 체크 |
| PUT | `/api/file` | `{path, content, baseHash, coalesce?}` | 쓰기. 새 노트는 `baseHash: null`. `coalesce: true`(웹 자동 저장, 소유자만)면 같은 노트의 잇단 저장을 10분 동안 한 커밋으로 묶습니다 |
| POST | `/api/append` | `{path, content, baseHash?}` | 끝에 덧붙이기 |
| DELETE | `/api/file` | `{path, baseHash}` | 지우기(첨부 포함). 첨부의 `baseHash` 는 바이트의 sha256 |
| POST | `/api/move` | `{from, to, baseHash, updateLinks?}` | 노트·첨부 옮기기·이름 바꾸기. 링크는 기본으로 고칩니다 → `linksUpdated`(고친 노트), `linkCount` |
| POST | `/api/move` | `{from, to, node: true, updateLinks?}` | 노드 옮기기·이름 바꾸기: `A.md` 와 `A/` 안 전체를 한 커밋으로 → `moved[[from, to]]`, `linksUpdated`, `linkCount` |
| POST | `/api/node/delete` | `{path, files[{path, baseHash}]}` | 노드를 하위째 한 커밋으로 지우기. 클라이언트가 본 파일 목록·해시와 다르면 409 |
| POST | `/api/batch` | `{message?, operations: [{op, ...}], updateLinks?}` | 일괄 쓰기. `op` 는 `write`, `append`, `delete`, `move`, `put`. 같은 일괄 쓰기의 연쇄 이동(A→B→C)은 합쳐서 링크를 고칩니다. `files` 에는 실제로 바뀐 파일만 |
| POST | `/api/attachment?path=` | 파일 바이트, 헤더 `x-keyring-upload: 1` | 첨부 새로 만들기(50MB 까지). 이미 있으면 409 |
| GET | `/api/raw?path=` | | 첨부 원본 파일 |
| GET | `/api/history?path=` | | 노트의 커밋 목록(작성자 포함) |
| GET | `/api/revision?path=&rev=` | | 특정 리비전의 내용 |
| POST | `/api/rollback` | `{path, rev, baseHash}` | 과거 리비전으로 되돌리기(새 커밋) |
| GET | `/api/trash` | `?folder=&cursor=` | 휴지통(소유자만): 삭제를 최근 것부터 → `items[{id, date, author, node, notes, attachments, lost}]`, `next`(마지막으로 읽은 커밋. 더 오래된 삭제를 볼 때 `cursor` 로 넘김, 끝이면 `null`). 서버에서 옮긴 노트와 지금 쓰이는 경로는 빠집니다 |
| GET | `/api/trash/preview?id=&path=` | | 지운 노트의 지우기 직전 내용(소유자만) |
| POST | `/api/trash/restore` | `{id, paths?}` | 한 번의 삭제를 한 커밋으로 되살리기. 자리에 파일이 있으면 덮어쓰지 않고 ` 2` 를 붙임 → `restored[[from, to]]`, `lost`(되살리지 못한 첨부 수). 소유자만 |
| GET · POST | `/api/topics` | `{name}` | 토픽 목록 / 위키 토픽 만들기(소유자) |
| POST | `/api/ingest` | `{kind: url\|html\|text, topic, ...}` | 원본 수집 |
| POST | `/api/ingest/file?topic=&name=` | 파일 바이트, 헤더 `x-keyring-upload: 1` | 올린 파일 수집 |
| GET · PUT | `/api/review/settings` | `{reviewPaths}` | 검토 대상 폴더(소유자) |
| GET | `/api/review` · `/api/review/:id` | `?status=pending` | 제안 목록 / diff 포함 상세(소유자) |
| POST | `/api/review/:id/approve` · `/api/review/:id/reject` | `{reason?}` | 승인 / 거절(소유자) |
| GET | `/api/sync/manifest` | | 동기화용 파일 목록 `{files: [{path, hash, size}]}`. 소유자와 기기. 서버가 만드는 위키 index·log 는 뺍니다 |
| GET | `/api/plugins` · `/plugins/<이름>.js` | | 위젯 플러그인 목록 / 모듈(소유자 로그인) |

### 오류

| 상태 | 뜻 |
| --- | --- |
| `401` | 인증 없음 |
| `403` | 권한 없음 |
| `404` | 없음(숨김 경로 포함) |
| `409` | 충돌. 본문에 `currentHash` 가 있습니다 |
| `421` | 받지 않는 호스트 이름으로 온 요청(`KEYRING_PUBLIC_URL`, `KEYRING_ALLOWED_HOSTS` 참고) |

오류 본문은 `{error, code, params, message}` 입니다. `421` 응답은 이 JSON 이 아니라 평문입니다. `code` 는 언어와 상관없는 메시지 키(`error.<code>`), `params` 는 끼워 넣을 값, `message` 는 서버 언어의 글입니다.

## 위젯 문법

위젯은 언어를 `widget` 으로 단 코드 블록 안의 YAML 입니다.

````markdown
```widget
type: query          # query | table | cards | kanban | tasks | chart | plugin
from: Work/ProjectA  # a folder, "#tag", or a list. Omit for the whole vault
where: status != done # one condition or a list (all must match)
show: [title, due]
sort: due            # -due or "due desc" for descending; a list for several keys
limit: 50
```
````

| 항목 | 설명 |
| --- | --- |
| 필드 | 프런트매터 키와 내장 필드 `path`, `title`(프런트매터 `title` → 첫 `#` 제목 → 파일 이름), `folder`, `name`, `tags`, `modified` |
| 조건 | `=` `!=` `>` `>=` `<` `<=` `contains` `!contains`, `필드`(값 있음), `!필드`(값 없음). 값 `today` 는 오늘 날짜(`YYYY-MM-DD`) |
| `group` | `group: status` 는 `query`, `table`, `cards` 를 그 필드로 묶습니다 |
| `tasks` | `status: open`(기본), `done`, `all` |
| `chart` | `chart: bar`(기본) 또는 `line`, `x: <묶을 필드>`, `y: <숫자 필드>`, `agg: sum`(`y` 가 있으면 기본), `count`, `avg`. 또는 `data: [{label, value}]` 로 직접 줍니다 |
| `cards` | 노트마다 카드 하나: 제목, 요약, `show` 필드 |
| `kanban` | `group`(기본 `status`) 값이 칸입니다. `lanes: [할 일, 진행, 완료]` 로 칸 순서를 정합니다 |
| `plugin` | `plugin: <이름>` 과 같은 `from`, `where`, `show`, `sort`. `options:` 는 플러그인에 그대로 넘어갑니다. [examples/plugins](../../../examples/plugins/README.ko.md) 참고 |

위젯도 권한 계층을 지나므로 에이전트가 같은 쿼리(MCP `query`)를 돌려도 읽을 수 있는 노트만 나옵니다.

## 웹훅 이벤트

웹훅은 JSON `{event, id, time, data}` 를 헤더 `X-Keyring-Signature: sha256=<HMAC-SHA256(secret, 본문)>` 과 함께 POST 합니다.

| 이벤트 | 언제 | `data` |
| --- | --- | --- |
| `raw.added` | 위키 토픽 `raw/` 에 새 원본이 들어온 직후(수집, 에이전트 쓰기, 승인) | `topic, path, rev, author, message` |
| `doc.changed` | 노트가 마지막 저장 뒤 90초 동안 조용하면 한 번. 그때까지의 커밋을 묶어 보냅니다. 만들고 고친 노트는 `A`, 만들고 지운 노트는 보내지 않습니다. 서버를 끌 때 남은 것은 바로 보냅니다 | `rev, author, message`(마지막 커밋), `commits`(묶인 커밋 수), `files[{status, path}]` |
| `proposal.created` | 검토 대기열에 새 제안 | `id, agent, message, topic, files` |
| `schedule` | 정기 작업 실행 | `job, topic, instructions, lint?{counts, issues, total}` |
| `ping` | 설정 → **자동화**의 시험 단추 | `message` |

`5xx`·`429` 응답과 연결 실패는 1·5·25초 뒤에 다시 보냅니다. 정기 작업은 서버 시간대의 cron 문법(`분 시 일 월 요일`)을 씁니다.

## 마크다운 문법

Keyring Notes 는 Obsidian 과 같은 문법을 읽습니다.

| 문법 | 예 |
| --- | --- |
| 위키링크 | `[[노트]]`, `[[폴더/노트]]`, `[[노트#제목\|별칭]]` |
| 임베드 | `![[이미지.png\|300]]`, `![[노트]]`, `![[노트#제목]]`, `![[노트#^블록]]`(노트 임베드는 3단계 깊이까지) |
| 블록 ID | 문단·목록 항목 끝의 ` ^id`(표는 다음 줄에 `^id` 만). `[[노트#^id]]` 로 링크 |
| 날짜 링크 | `[[2026-10-07]]` 은 그날 데일리 노트를 가리킵니다. 이름이 정확히 같은 노트가 있으면 그것이 먼저입니다 |
| 콜아웃 | `> [!note] 제목`. 종류는 note, tip, warning, danger, question, example, quote 등. `[!tip]-` 는 접힌 채, `[!tip]+` 는 펼친 채로 시작 |
| 하이라이트 | `==글==` |
| 각주 | `본문[^1]` … `[^1]: 내용` |
| 수식 | `$E=mc^2$`, `$$ … $$`(KaTeX). `$5와 $6` 처럼 `$` 바로 뒤가 공백이면 수식이 아닙니다 |
| 다이어그램 | 언어를 `mermaid` 로 단 코드 블록 |
| 주석 | `%%…%%`(여러 줄 가능). 안의 링크·태그·할 일은 색인하지 않습니다 |
| 할 일 | `- [ ] 할 일`, `- [x] 끝남` |
| 상대 링크 | `[x](폴더/노트.md#제목)` 도 노트로 열립니다 |

## 템플릿 변수

| 변수 | 값 |
| --- | --- |
| `{{title}}` | 노트 제목 |
| `{{date}}` | 오늘 날짜 |
| `{{time}}` | 지금 시각 |
| `{{date:<형식>}}` | 형식에 맞춘 오늘 날짜. 예: `{{date:YYYY년 M월 D일 dddd}}` |
| `{{yesterday}}` · `{{tomorrow}}` | 어제 / 내일 |

## 데일리 노트 형식 토큰

`YYYY YY M MM MMMM D DD W WW GGGG ddd dddd H HH m mm s ss [글자]`

- `MMMM` 은 월 이름, `ddd`·`dddd` 는 짧은·긴 요일 이름입니다. 볼트 언어를 따릅니다.
- `W`·`WW` 는 주차, `GGGG` 는 주 기준 연도입니다.
- `[글자]` 는 글자 그대로, `/` 는 하위 폴더입니다.

## 단축키

`Ctrl/Cmd+/` 로 전체 목록을 보고, 설정 → **단축키**에서 바꾸세요. 웹 앱에서는 브라우저가 가로채는 키 대신 `Alt` 조합을 씁니다. 데스크톱 앱은 원래 키를 씁니다.

| 동작 | 단축키 |
| --- | --- |
| 새 노트 | `Alt+N`(데스크톱 앱: `Ctrl/Cmd+N`) |
| 탭 닫기 | `Alt+W`(데스크톱 앱: `Ctrl/Cmd+W`) |
| 창 닫기 | 데스크톱 앱만: `Ctrl/Cmd+Shift+W` |
| 닫은 탭 다시 열기 | `Alt+Shift+T`(데스크톱 앱: `Ctrl/Cmd+Shift+T`) |
| 이전 / 다음 탭 | `Alt+[` / `Alt+]`(데스크톱 앱: `Ctrl+Shift+Tab` / `Ctrl+Tab`) |
| N번째 탭 | `Alt+1` … `Alt+9`(데스크톱 앱: `Ctrl/Cmd+1` … `Ctrl/Cmd+9`) |
| 노트 빠르게 열기 | `Ctrl/Cmd+O` |
| 명령 팔레트 | `Ctrl/Cmd+P` |
| 검색 | `Ctrl/Cmd+Shift+F` |
| 노트 안 찾기 | `Ctrl/Cmd+F`. 다음 / 이전 결과: Enter / Shift+Enter 또는 `Ctrl/Cmd+G` / `Ctrl/Cmd+Shift+G`. 바꾸기: `Ctrl/Cmd+Alt+F` |
| 지금 저장 | `Ctrl/Cmd+S` |
| 편집 ↔ 미리보기 | `Ctrl/Cmd+E` |
| 뒤로 / 앞으로 | `Ctrl/Cmd+Alt+←` / `Ctrl/Cmd+Alt+→` |
| 왼쪽 / 오른쪽 패널 | `Ctrl/Cmd+Shift+E` / `Ctrl/Cmd+Alt+B` |
| 오늘 노트 | `Ctrl/Cmd+Shift+D` |
| 설정 | `Ctrl/Cmd+,` |
| 이름 바꾸기 | F2 |
| 오른쪽 / 아래로 나누기 | `Ctrl/Cmd+\` / `Ctrl/Cmd+Shift+\` |
| 이웃 칸 / 다음 칸으로 포커스 | `Ctrl/Cmd+Alt+Shift+방향키` / `Ctrl/Cmd+Shift+,` |
| 탭을 이웃 칸 / 다음 칸으로 | `Cmd+Ctrl+방향키`(macOS) / `Ctrl/Cmd+Shift+.` |
| 지금 위치 접기 / 펴기 | `Ctrl+Shift+[` / `Ctrl+Shift+]`(macOS: `Cmd+Alt+[` / `Cmd+Alt+]`) |
| 모두 접기 / 펴기 | `Ctrl+Alt+[` / `Ctrl+Alt+]` |
| 굵게, 기울임, 링크, 형광펜 | `Ctrl/Cmd+B`, `Ctrl/Cmd+I`, `Ctrl/Cmd+K`, `Ctrl/Cmd+Shift+H` |
| 할 일 체크 | `Ctrl/Cmd+Enter` |

한글처럼 입력기(IME)로 글자를 조합하는 중에는 단축키를 받지 않습니다.

## 공통 설정 파일

볼트 맨 위의 `keyring-settings.md` 는 모든 기기가 함께 쓰는 설정을 프런트매터에 담습니다. 설정 화면이 만들고 고칩니다.

```yaml
---
vault:
  language: ko            # vault language (text saved into the vault: Untitled, conflict copies, default folders, wiki index/log/SCHEMA, commit messages)
  linkFormat: shortest    # shortest | full
  workspaceOrder: [업무, 개인]
workspaces:
  업무:
    daily: { enabled: true, folder: 데일리 노트, format: "GGGG/[W]WW/YYYY-MM-DD", template: 템플릿/데일리.md, weekStart: monday, icon: "📅" }
    templateFolder: 템플릿
    attachmentFolder: _첨부
  개인:
    daily: { enabled: false }
ui:
  theme: dark
  language: ko
  editorSize: 17
  keys: { daily: "Mod+Shift+J" }
---
```

## 백업 파일 형식

백업은 `keyring-<시각>-<auto|manual|pre-restore>.tar.gz` 파일 하나이고, 안에 다음이 들어 있습니다.

- `manifest.json`
- `vault.bundle`: `git bundle --all`. 모든 노트와 첨부, 전체 이력
- `config.json`(선택): 비밀번호·토큰 해시, 권한 표

검색 인덱스와 위키 index·log 는 서버가 다시 만들므로 넣지 않습니다.

## 저장 구조

| 경로 | 내용 |
| --- | --- |
| `vault/**.md` | 원본. YAML 프런트매터가 붙은 순수 마크다운. 맨 위 폴더와 노트가 워크스페이스입니다. 노드 `A` 는 노트 `A.md` 와 폴더 `A/` 입니다. 예: `업무.md`, `업무/프로젝트.md`, `업무/프로젝트/회의.md`, `업무/_첨부/도식.png` |
| `vault/keyring-settings.md` | 모든 기기 공통 설정([공통 설정 파일](#공통-설정-파일) 참고) |
| `vault/.history/` | Git 저장소(`--git-dir`). 작업 트리가 볼트 자체라서 다른 편집기에서 `.git` 이 보이지 않습니다 |
| `vault/.keyring/index.db` | SQLite 인덱스: 본문 전체 텍스트 검색(FTS5 trigram), 태그, 링크, 할 일, 프런트매터. Git 이 추적하지 않습니다 |
| `vault/.keyring-app/` | 데스크톱·모바일 앱 메타데이터: 변경 기록(`journal.jsonl`), 내용 스냅샷(`objects/`), 동기화 기준점(`sync.json`) |
| `config/keyring.json` | 파일 권한 0600. 비밀번호는 scrypt 해시, 토큰은 sha256 해시, 패스키는 공개 키만 |

점으로 시작하는 폴더(`.obsidian`, `.trash`, `.history`)는 트리에서 숨기고 API 로 닿을 수 없습니다.

## 다음 단계

- [에이전트 연결하기](how-to/connect-agents.md)
- [설정값](configuration.md)
