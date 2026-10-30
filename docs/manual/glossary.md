# Glossary · 용어집

English terms used in the manual and the Korean terms used in the Korean manual and the Korean interface.

영어 문서의 용어와, 한국어 문서·한국어 화면에서 쓰는 용어의 대응입니다.

## Concepts · 개념

| English | 한국어 | Meaning |
| --- | --- | --- |
| vault | 볼트 | The folder of Markdown files that is the source of truth |
| note | 노트 | One Markdown file |
| node | 노드 | A note `A.md` together with its folder `A/` |
| empty node | 빈 노드 | A folder without its note |
| workspace | 워크스페이스 | A top-level node of the vault |
| attachment | 첨부 | A non-Markdown file in the vault |
| frontmatter | 프런트매터 | The YAML block at the top of a note |
| property | 속성 | One frontmatter field |
| wikilink | 위키링크 | A link like `[[Note]]` |
| embed | 임베드 | `![[…]]`, content shown inline |
| backlink | 백링크 | A link to this note from another note |
| unlinked mention | 연결되지 않은 언급 | This note's name in another note, without a link |
| source | 출처 | A note listed in the frontmatter `sources` |
| raw source | 원본 | A collected file in a wiki topic's `raw/` |
| citation | 인용 | A page that lists this note as a source |
| daily note | 데일리 노트 | A note for one date |
| widget | 위젯 | A `widget` code block that shows notes as a list, table, board or chart |
| wiki topic | 위키 토픽 | A node with `SCHEMA.md`, maintained by agents |
| structure check | 정리 점검 | The check for broken links, orphan pages and missing sources |
| trash | 휴지통 | Deleted notes, listed from history so they can be restored |
| pin | 고정 | Keep a note at the top of the left panel and the home screen, on this device |
| sort sub-notes | 하위 노트 정렬 | How a note orders the notes directly under it: name, last modified, last opened or custom |
| custom order | 커스텀 순서 | The order of child notes set by hand, kept in each note's `rank` |
| agent | 에이전트 | An AI client that reaches the vault with a token |
| token | 토큰 | The secret an agent or device sends as `Authorization: Bearer` |
| permission level | 권한 | `hidden`, `read`, `append`, `write`, `delete` |
| review queue | 검토 대기열 | Agent changes waiting for approval |
| proposal | 제안 | One agent change in the review queue |
| owner | 소유자 | The person who logs in with the password |
| device | 기기 | A desktop or mobile app connected to the server |
| sync | 동기화 | Exchanging changes between an app and the server |
| conflict copy | 충돌 사본 | A copy kept when both sides changed the same lines |
| three-way merge | 3방향 병합 | Combining two changes against their common base |
| baseline | 기준점 | The last version both sides agreed on |
| backup | 백업 | A `.tar.gz` file with the vault's full history |
| restore | 복원 | Switching the vault to a backup |
| passkey | 패스키 | Password-less login with WebAuthn |
| setup code | 설정 코드 | The one-time code in the log for the first password |
| search filter | 검색 필터 | A folder or tags that narrow text search |
| semantic search | 의미 검색 | Search by meaning with an embedding model |
| embedding | 임베딩 | The vector a model computes for a text |
| webhook | 웹훅 | An HTTP POST sent on an event |
| scheduled job | 정기 작업 | A webhook sent on a cron schedule |
| language pack | 언어팩 | A JSON translation of the interface |
| shared settings file | 공통 설정 파일 | `keyring-settings.md` |

## Screen · 화면

| English | 한국어 |
| --- | --- |
| rail | 레일 |
| left panel / right panel | 왼쪽 패널 / 오른쪽 패널 |
| top row | 맨 위 줄 |
| workspace switcher | 워크스페이스 전환기 |
| status bar | 상태 표시줄 |
| tab | 탭 |
| pane | 칸 |
| tree | 트리 |
| command palette | 명령 팔레트 |
| Quick open | 노트 빠르게 열기 |
| Outline · Links · Properties · History | 개요 · 연결 · 속성 · 변경 이력 |
| Edit · Side by side · Preview | 편집 · 나란히 · 미리보기 |
| Live Preview | Live Preview |
| Settings | 설정 |
| General · Language · Editor · Files & links · Workspaces · Shortcuts | 일반 · 언어 · 편집기 · 파일·링크 · 워크스페이스 · 단축키 |
| This device & sync | 이 기기·동기화 |
| About | 정보 |
| Open source licenses | 오픈 소스 라이선스 |
| Server status · Agents & permissions · Devices · Backup & restore · Automation · Updates · Security | 서버 상태 · 에이전트·권한 · 기기 · 백업·복원 · 자동화 · 업데이트 · 보안 |
| Display language · Vault language · Agent language · Server language | 화면 언어 · 볼트 언어 · 에이전트 언어 · 서버 언어 |
| Import · Review · Structure check · Graph view | 가져오기 · 검토 · 정리 점검 · 그래프 뷰 |
| admin console | 관리 콘솔 |
