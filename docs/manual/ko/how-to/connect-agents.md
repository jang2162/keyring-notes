<!-- source: docs/manual/en/how-to/connect-agents.md @ v0.13.2 -->
# 에이전트 연결하기

에이전트용 토큰을 발급하고, 볼 수 있는 것과 바꿀 수 있는 것을 제한하고, MCP 나 REST 로 연결합니다.

AI 에이전트가 노트를 읽거나 쓰게 하려는 분을 위한 문서입니다.

## 토큰 발급하기

브라우저에서 설정 → **에이전트·권한**으로 가서 에이전트를 만드세요. 토큰과 MCP 설정 예시는 한 번만 보입니다.

CLI 로도 됩니다.

```bash
pnpm keyring agent add wiki-work
```

Docker 에서는 `docker compose exec keyring keyring agent add wiki-work` 를 실행하세요. 토큰은 이때만 보입니다. 잃어버리면 `agent rotate` 로 다시 발급하세요. 이전 토큰은 바로 쓸 수 없게 됩니다.

## 권한 주기

새 에이전트는 아무것도 보지 못합니다. 폴더나 노트마다 단계를 주세요.

```bash
pnpm keyring agent grant wiki-work 업무/raw append
pnpm keyring agent grant wiki-work 업무/wiki delete
pnpm keyring agent grant wiki-work 업무/SCHEMA.md read
pnpm keyring agent list
```

단계는 약한 것부터 `hidden`, `read`, `append`, `write`, `delete`, `issue` 입니다. 가장 구체적인 규칙이 이기고, 규칙이 없는 경로는 숨겨집니다. 노드 규칙과 이력 가리기를 포함한 전체 규칙은 [참조](../reference.md#권한)에 있습니다.

권한을 바꾸면 다음 요청부터 적용됩니다. 재시작할 필요가 없습니다.

## 하위 토큰 발급하기

폴더에 `issue` 를 가진 에이전트는 그 폴더 아래로 다른 에이전트용 토큰을 만들 수 있습니다. 그러면 사람을 거치지 않고 다른 에이전트에게 일을 맡길 수 있습니다. 먼저 단계를 주세요.

```bash
pnpm keyring agent grant lead 업무 issue
```

관리 화면에서는 규칙의 단계로 **쓰기·삭제·발급**을 고르세요.

그러면 에이전트가 MCP `issue_token`(또는 REST `POST /api/tokens`)을 이름과 규칙으로 부릅니다.

```json
{ "name": "drafts", "rules": { "업무/초안": "write" } }
```

이 요청은 에이전트 `lead-drafts` 를 만들고, 토큰과 MCP 설정 예시를 한 번만 돌려줍니다. 제한은 다음과 같습니다.

- 규칙의 경로는 발급자가 `issue` 를 가진 경로 아래여야 합니다.
- 단계는 `delete` 이하이면서 그 경로에서 발급자가 가진 단계 이하여야 합니다.
- 하위 토큰은 `issue` 를 가질 수 없습니다.
- 같은 이름의 에이전트가 이미 있으면 갈아 끼우지 않습니다.

하위 토큰은 발급자에 묶여 있습니다.

- 실제 권한은 요청마다 발급자의 지금 권한(최대 `delete`)을 넘지 못합니다. 발급자의 권한을 줄이면 하위 토큰도 함께 줄어듭니다.
- 발급자를 지우면 하위 토큰도 함께 지워집니다. 관리 화면은 지우기 전 확인 문구에 그 이름을 보여 줍니다. `agent remove` 는 지운 뒤 그 이름을 출력합니다.
- 하위 토큰의 `whoami` 는 자기 규칙과 `issuedBy` 를 보여 줍니다. 실제 권한은 발급자의 지금 권한으로 한 번 더 깎입니다.

발급자는 자기가 발급한 토큰만 목록 보기(`list_issued_tokens`)·재발급(`rotate_issued_token`)·삭제(`revoke_issued_token`)할 수 있습니다. 규칙은 고칠 수 없습니다. 소유자는 **에이전트·권한**에서 발급자 아래에 묶여 보이는 하위 토큰을 보고 지울 수 있고, `agent list`·`agent remove` 로도 됩니다. 전체 규칙은 [참조](../reference.md#하위-토큰)에 있습니다.

## MCP 로 연결하기

MCP 클라이언트를 다음처럼 설정하세요.

- URL: `http://127.0.0.1:8787/mcp`(서버 주소로 바꾸세요)
- 헤더: `Authorization: Bearer <YOUR_AGENT_TOKEN>`

전송 방식은 Streamable HTTP(무상태, JSON 응답)입니다. 도구 설명과 오류는 서버의 **에이전트 언어** 설정을 따릅니다.

도구 목록은 [참조](../reference.md#mcp-도구)에 있습니다. 에이전트는 연결 방법과 주요 규칙을 담은 공개 안내 `GET /llms.txt` 도 읽을 수 있습니다.

## 에이전트가 지킬 규칙

- **쓸 때 마지막 해시를 넘깁니다.** 마지막으로 읽은 `hash` 를 `base_hash` 로 보내세요(새 노트는 `null`). 그 사이 노트가 바뀌었으면 `conflict` 와 `current_hash` 를 돌려주고 아무것도 쓰지 않습니다. 다시 읽고 합친 뒤 다시 쓰세요.
- **긴 노트는 나눠 읽습니다.** 먼저 `read_outline` 을 부르고, 필요한 부분만 `read_section` 으로 읽으세요.
- **관련된 노트는 함께 바꿉니다.** `batch_write` 는 여러 작업을 한 커밋으로, 전부 아니면 전무로 반영합니다.
- **검토를 예상합니다.** 검토 대상 폴더에 쓰면 사람이 승인할 때까지 `pending` 을 돌려줍니다. [에이전트 변경 검토하기](review-agent-changes.md)를 보세요.

에이전트가 만든 커밋은 작성자가 에이전트 이름으로 남습니다.

## REST API 쓰기

같은 볼트를 `/api/*` 아래에서 같은 토큰(`Authorization: Bearer <토큰>`)으로 쓸 수 있습니다. 바꾸는 요청은 모두 `Content-Type: application/json` 이어야 합니다. 엔드포인트는 [참조](../reference.md#rest-api)에 있습니다.

## 다음 단계

- [에이전트 변경 검토하기](review-agent-changes.md)
- [LLM Wiki 만들기](build-an-llm-wiki.md)
