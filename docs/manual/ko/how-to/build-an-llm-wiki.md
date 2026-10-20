<!-- source: docs/manual/en/how-to/build-an-llm-wiki.md @ v0.8.5 -->
# LLM Wiki 만들기

모아 둔 원본으로 에이전트가 관리하는 위키 토픽을 만들고, 인용하고 점검하는 방법을 보입니다.

기사, PDF, 메모를 에이전트가 관리하는 위키로 만들려는 분을 위한 문서입니다.

## 위키 토픽의 짜임

토픽은 세 층으로 운영합니다: 원본 자료, 에이전트가 관리하는 위키, 사람이 쓰는 스키마. 워크스페이스 바로 아래 노드(`<워크스페이스>/<토픽>`)에 `SCHEMA.md` 가 있으면 위키 토픽이 됩니다.

```text
업무/경제/
├── SCHEMA.md            Wiki structure and procedures (ingest, query, maintenance). Edited by people only
├── raw/                 Collected sources, converted to Markdown. Recommended agent permission: append
│   └── assets/          Original files (PDF, images, HTML)
└── wiki/                Pages maintained by agents. Recommended permission: delete
    ├── index.md         [auto] Page list (category, summary, source count) and unprocessed/processed sources
    └── log.md           [auto] Activity log built from Git history: ## [date time] author | message
```

`SCHEMA.md`, index, log 는 볼트 언어로 만듭니다.

## 토픽 만들기

레일의 **가져오기**(받은편지함 아이콘)를 누르고 **새 위키 토픽**을 고르세요. 지금 워크스페이스에 `SCHEMA.md` 템플릿과 함께 토픽이 생깁니다. 목적과 규칙을 채우세요.

## 에이전트에게 권한 주기

```bash
pnpm keyring agent grant <이름> 업무/경제/raw append
pnpm keyring agent grant <이름> 업무/경제/wiki delete
pnpm keyring agent grant <이름> 업무/경제/SCHEMA.md read
```

에이전트는 규칙과 상관없이 `SCHEMA.md` 를 읽기만 할 수 있습니다. [에이전트 연결하기](connect-agents.md)를 보세요.

## 원본 가져오기

레일의 **가져오기**나 MCP 도구 `ingest_url`·`ingest_text` 를 쓰세요.

- **파일**: PDF(쪽마다 글 추출), 이미지, HTML, 마크다운, 텍스트. 파일당 50MB 까지.
- **URL**: 서버가 페이지를 가져와 본문만 마크다운으로 남깁니다. PDF 링크는 PDF 로 다룹니다.
- **웹 클리퍼**: URL 탭의 **📎 Keyring 클립**을 북마크바로 끌어다 놓고, 저장할 페이지에서 누르세요. 브라우저가 이미 가진 HTML 을 보내므로 로그인이 필요한 페이지도 저장됩니다. 고른 부분만 저장할 수도 있습니다.
- **붙여넣기**: 텍스트나 마크다운을 그대로.

원본은 `<토픽>/raw/<날짜> <제목>.md` 로 저장되고, 프런트매터에 `source_type`, `source_url`, `original`, `ingested_at`, `ingested_by` 가 붙습니다.

`KEYRING_FETCH_ALLOW_PRIVATE=1` 이 없으면 URL 수집은 사설·루프백 주소에 닿지 않습니다.

## index 와 log 는 저절로 바뀝니다

서버는 토픽 안에서 무엇이든 바뀌면 `wiki/index.md` 와 `wiki/log.md` 를 다시 만듭니다. 직접 고칠 수 없고, Git 과 검색 인덱스에도 넣지 않습니다.

읽는 사람의 권한에 맞춰 만들므로, 원본을 볼 수 없는 에이전트에게는 그 이름이 나오지 않습니다. 원본은 위키 페이지가 본문 링크나 `sources` 로 인용하면 "반영됨"이 됩니다.

## 문단 인용하기

프런트매터 `sources` 에 블록 ID 나 제목으로 원본의 일부를 가리키세요.

```yaml
sources: ["[[원본#^p3|문단]]", "[[원본#제목]]"]
```

오른쪽 패널 **연결** 탭의 출처 목록에 그 문단을 짧게 인용해 보이고, 누르면 그 자리로 갑니다. 에이전트는 `read_section` 에 `heading: "^p3"` 를 주어 그 블록만 읽습니다.

## PDF 에 주석 남기기

트리의 PDF 나 `[[x.pdf]]`·`[[x.pdf#page=3]]` 링크를 누르면 앱 안에서 열립니다.

1. 글을 고르고 **주석 남기기**를 누르세요.
2. PDF 의 짝 노트의 `## PDF 주석` 절에 `- [[x.pdf#page=3|3쪽]] “고른 글” — 메모 ^pdf-3-k2x9` 같은 줄이 쪽 순서로 더해집니다. 절 제목과 쪽 표시는 볼트 언어를 따릅니다.
3. 위키 페이지에서 PDF 를 열었으면 주석마다 **이 문서 출처로**를 눌러 그 페이지의 `sources` 에 `[[짝 노트#^pdf-3-k2x9]]` 를 더합니다.

짝 노트는 수집한 원본 노트(`raw/assets/x.pdf` 이면 `raw/x.md`), 없으면 PDF 를 연 노트, 그것도 없으면 PDF 옆에 새로 만든 노트입니다. PDF 를 다시 열면 주석을 남긴 자리가 칠해져 보입니다. 에이전트는 `read_section` 으로 주석을 읽습니다.

## 위키 구조 점검하기

레일의 **정리 점검**(빗자루)을 누르거나 MCP `lint` 를 쓰세요. 다음을 알려 줍니다.

- 깨진 링크와 깨진 출처(인용한 블록이나 제목이 이제 없음)
- 고아 위키 페이지와 `sources` 가 없는 페이지
- 빠진 `title` 이나 `summary`
- 오래된 페이지(기본 180일, 프런트매터 `updated` 가 먼저)
- 아직 인용되지 않은 원본
- 노트의 날짜와 맞지 않는 데일리 태그

## 다음 단계

- [에이전트 변경 검토하기](review-agent-changes.md)
- [웹훅으로 자동화하기](automate-with-webhooks.md): 점검 결과를 정해진 때에 에이전트에게 보내기
