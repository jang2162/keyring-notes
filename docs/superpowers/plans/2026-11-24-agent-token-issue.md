# 에이전트 하위 토큰 발급(`issue` 권한) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 권한 단계 맨 위에 `issue` 를 두고, 그것을 가진 에이전트가 자기 범위 아래로 `delete` 이하 하위 토큰을 발급·재발급·삭제할 수 있게 한다.

**Architecture:** 하위 토큰도 `AgentConfig` 한 줄로 저장하고 `issuedBy` 를 붙인다. 정책은 `ConfigStore.policyOf` 한 곳에서 만든다 — 하위 토큰이면 자기 규칙과 발급자의 지금 규칙(최대 `delete`)을 겹친 정책이다. 인증(`agentByToken`)과 검토 승인(`ReviewQueue.approve`)이 이 함수를 같이 쓴다.

**Tech Stack:** TypeScript, Hono(server), MCP SDK, React(web), vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-11-24-agent-token-issue-design.md` — 실행자는 이 계획과 스펙을 함께 읽는다. 둘이 다르면 스펙을 따르고 보고한다.

## Global Constraints

- 단계 순서: `hidden < read < append < write < delete < issue`. `issue` 는 그 경로에서 `delete` 가 하는 일을 전부 한다.
- 하위 토큰은 `issue` 를 갖지 못한다(설정 검증·발급·관리 API·CLI 모두에서 거부). 발급은 한 단계뿐이다.
- 하위 토큰 전체 이름 = `<발급자>-<뒷부분>`, 전체가 `AGENT_NAME_RE`(`/^[a-z0-9][a-z0-9_-]{0,63}$/`)에 맞아야 한다.
- 같은 이름이 있으면 발급 거부. 기존 `ConfigStore.issueToken`(있으면 덮어씀)은 발급 경로에서 쓰지 않는다.
- 발급자당 하위 토큰 상한 50(`CHILD_TOKEN_LIMIT = 50`).
- 토큰 원문은 저장하지 않는다(sha256 해시만). 원문은 발급·재발급 응답에서 한 번만.
- 발급자가 남의 이름을 다루면 「없는 에이전트」와 같은 오류(`agent_missing`)를 낸다.
- 발급 API(MCP·REST)는 에이전트 전용. 소유자가 부르면 `ForbiddenError("issue_agent_only")`.
- 발급자 삭제 시 하위 토큰도 설정에서 함께 지운다. 발급자 재발급은 하위 토큰을 건드리지 않는다.
- 화면 글은 `packages/core/src/messages/{en,ko}.json` 에 알파벳 순서 자리로 손으로 넣는다. 영어가 기준.
- 사용자 문서 `docs/manual/en/`(원본)과 `docs/manual/ko/` 는 같은 커밋에서 고친다.
- 최종: 루트에서 `pnpm test`, `pnpm typecheck`, `pnpm build`, oxfmt·oxlint. 실행된 테스트 개수를 보고에 적는다.

## Review Focus

1. **대소문자·정규화가 다른 발급 범위** — 발급자 `Work: issue` 에 하위 규칙 `work/x: read`(소문자)는 거부돼야 한다(허용 규칙은 글자로 맞아야 넓어진다). NFD 로 쓴 `업무` 는 NFC 규칙과 같은 것으로 받아야 한다. → Task 1 테스트.
2. **`issue` 범위 안의 더 구체적인 제한** — 발급자 `업무: issue`, `업무/비밀: hidden` 일 때 하위 `업무: delete` 는 발급되지만 하위 토큰으로 `업무/비밀/a.md` 를 읽으면 없는 노트 오류. → Task 2 테스트.
3. **이름 경계** — 뒷부분이 비었거나 대문자·공백, 합친 이름이 64자 초과, 사람이 미리 만든 `<발급자>-x` 와 충돌. 모두 거부되고 설정은 그대로. → Task 2 테스트.
4. **백업 복원·손으로 고친 설정** — 발급자가 없는 하위 토큰은 서버가 뜨되 그 토큰만 인증 실패. 두 단계 발급·하위 토큰의 `issue` 는 검증 오류. → Task 2 테스트.
5. **승인 재판정** — 제안 뒤 발급자를 지우거나 권한을 줄이면 승인 거부, 사람이 만든 에이전트의 권한을 줄인 경우도 거부. 권한이 그대로면 지금처럼 승인. → Task 3 테스트.

---

### Task 1: `issue` 단계와 겹친 정책

**Files:**
- Modify: `server/src/access.ts`
- Modify: `web/src/api.ts`(`Level` 타입에 `"issue"`)
- Test: `server/test/access.test.ts`

**Interfaces:**
- Produces:
  - `LEVELS = ["hidden","read","append","write","delete","issue"]`
  - `interface Policy { level(relPath: string): Level; mayContainVisible(dirPath: string): boolean; toJSON(): Record<string, Level> }` — `AccessPolicy` 가 구현한다.
  - `AccessPolicy.issueCovers(relPath: string): boolean` — NFC 로 맞춘 **글자 그대로의** 규칙 중 단계가 `issue` 이고 `covers(prefix, relPath)` 인 것이 있는가(대소문자 접기 없음 — 허용 범위이므로).
  - `boundedPolicy(own: AccessPolicy, issuer: AccessPolicy): Policy` — `level(p) = stricter(own.level(p), stricter(issuer.level(p), "delete"))`, `mayContainVisible` 는 둘 다 참일 때, `toJSON` 은 `own.toJSON()`.
  - `issueViolations(issuer: AccessPolicy, rules: Record<string, Level>): { path: string; reason: "scope" | "level" }[]` — 규칙 `(p, L)` 마다: `issuer.issueCovers(p)` 가 아니면 `scope`; `L === "issue"` 이거나 `!atLeast(min(issuer.level(p), "delete"), L)` 이면 `level`. 경로는 `normalizeRulePath` 로 맞춘다(`""` 는 `/`).
  - `Principal` 의 agent 쪽 `policy: Policy`, 그리고 선택 필드 `issuedBy?: string`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test("issue 는 delete 위 단계", () => { expect(atLeast("issue", "delete")).toBe(true); expect(isLevel("issue")).toBe(true); });
test("boundedPolicy: 발급자 단계와 delete 로 깎인다", () => {
  const p = boundedPolicy(new AccessPolicy({ "업무": "delete" }), new AccessPolicy({ "업무": "issue", "업무/비밀": "hidden", "업무/x": "read" }));
  expect(p.level("업무/a.md")).toBe("delete");
  expect(p.level("업무/비밀/a.md")).toBe("hidden");
  expect(p.level("업무/x/a.md")).toBe("read");
  expect(p.level("기타/a.md")).toBe("hidden");
});
test("issueViolations: 범위 밖·단계 초과·좁히기 허용", () => {
  const issuer = new AccessPolicy({ "업무": "issue", "업무/x": "write" });
  expect(issueViolations(issuer, { "업무/x": "read", "업무/y": "delete" })).toEqual([]);
  expect(issueViolations(issuer, { "업무/x": "delete" })).toEqual([{ path: "업무/x", reason: "level" }]);
  expect(issueViolations(issuer, { "/": "read" })).toEqual([{ path: "/", reason: "scope" }]);
  expect(issueViolations(issuer, { "업무": "issue" })).toEqual([{ path: "업무", reason: "level" }]);
});
test("issueCovers 는 대소문자를 넓히지 않고 NFD 는 같은 것으로 본다", () => {
  expect(issueViolations(new AccessPolicy({ Work: "issue" }), { "work/x": "read" })).toEqual([{ path: "work/x", reason: "scope" }]);
  expect(issueViolations(new AccessPolicy({ "업무": "issue" }), { ["업무".normalize("NFD") + "/a"]: "read" })).toEqual([]);
});
```

- [ ] **Step 2:** `pnpm --filter @keyring-notes/server exec vitest run test/access.test.ts` → 새 테스트 FAIL(`boundedPolicy` 없음 등).
- [ ] **Step 3:** 위 Interfaces 대로 구현. `levelOf` 의 소유자 반환값은 `"delete"` 그대로 둔다. `Principal.policy` 타입을 `Policy` 로 바꾸고 타입 오류가 나는 호출자를 맞춘다.
- [ ] **Step 4:** 같은 명령 → PASS. `pnpm typecheck` 통과.
- [ ] **Step 5:** 커밋 `feat(server): 권한 단계 issue 와 발급자에 묶인 정책`

### Task 2: 설정 — `issuedBy`, 정책 생성, 하위 토큰 관리

**Files:**
- Modify: `server/src/config.ts`
- Test: `server/test/authz.test.ts`(인증), 새 `server/test/issue.test.ts`(발급 관리)

**Interfaces:**
- Consumes: Task 1 의 `boundedPolicy`, `issueViolations`, `Policy`.
- Produces(`ConfigStore` 메서드):
  - `AgentConfig.issuedBy?: string`
  - `policyOf(name: string): Policy | null` — 에이전트가 없거나, `issuedBy` 의 발급자가 없으면 `null`. 하위 토큰이면 `boundedPolicy(own, issuer)`.
  - `agentByToken` 은 `policyOf` 로 정책을 만들고 `null` 이면 `null` 반환. Principal 에 `issuedBy` 를 싣는다.
  - `createChild(issuer: string, suffix: string, rules: Record<string, Level>): { name: string; token: string }`
  - `childrenOf(issuer: string): AgentConfig[]`
  - `rotateChild(issuer: string, name: string): string`(새 토큰)
  - `removeChild(issuer: string, name: string): void`
  - `removeAgent(name)` 은 지운 하위 토큰 이름 배열 `string[]` 을 돌려준다(발급자면 하위 토큰도 함께 지움).
  - `setRules`·`setRule` 은 대상이 하위 토큰이고 단계에 `issue` 가 있으면 `PathError("child_cannot_issue")`.
- 오류 코드(메시지 키 `error.<code>` 를 en/ko 에 추가): `issue_scope`({path}), `issue_level`({path}), `issue_limit`({limit}), `child_cannot_issue`, 기존 `agent_name`·`agent_exists`·`agent_missing` 재사용.
- 검증(`validate`): `issuedBy` 는 문자열이면 유지. 하위 토큰 규칙에 `issue` → `PathError("config.child_issue", {name})`; `issuedBy` 가 가리키는 에이전트가 또 `issuedBy` 를 가짐 → `PathError("config.child_chain", {name})`. 발급자가 없는 것은 통과.

- [ ] **Step 1: 실패하는 테스트** — `issue.test.ts` 에 아래 이름과 단언으로 쓴다(헬퍼는 기존 `server/test/helpers.ts` 를 따른다).
  - `createChild: 이름은 <발급자>-<뒷부분>` → `createChild("boss","w1",{"업무/a":"write"}).name === "boss-w1"`, `agentByToken(token)` 이 `issuedBy: "boss"` 를 싣는다.
  - `범위 밖·단계 초과면 아무것도 만들지 않는다` → `issue_scope`/`issue_level` 로 던지고 `get().agents.length` 불변.
  - `이름 경계` → 뒷부분 `""`, `"A b"`, 합쳐서 65자 → `agent_name`; 사람이 만든 `boss-x` 가 있으면 `agent_exists`.
  - `issue 없는 발급자·하위 토큰 발급자는 거부` → `issue_scope`.
  - `상한 50` → 51번째에서 `issue_limit`.
  - `남의 이름은 agent_missing` → `rotateChild("boss","other-1")`, `removeChild("boss","claude")`.
  - `발급자 삭제는 하위 토큰도 지운다` → `removeAgent("boss")` 가 `["boss-w1"]` 반환, 그 토큰 인증 `null`.
  - `발급자 재발급은 하위 토큰을 유지` → `issueToken("boss")` 뒤 하위 토큰 인증 성공.
  - `발급자 권한을 줄이면 다음 인증부터 줄어든다` → `setRule("boss","업무","read")` 뒤 하위 토큰 정책의 `level("업무/a/n.md") === "read"`.
  - `하위 토큰에 issue 를 줄 수 없다` → `setRule("boss-w1","업무/a","issue")` 가 `child_cannot_issue`.
  - `설정 검증` → `replaceAll` 에 두 단계 발급이면 `config.child_chain`, 하위 토큰 `issue` 면 `config.child_issue`; 발급자 없는 하위 토큰은 통과하고 그 토큰 인증 `null`.
  - `authz.test.ts` 에: 발급자 `업무: issue`, `업무/비밀: hidden`, 하위 `업무: delete` 로 MCP/REST `read_document 업무/비밀/a.md` 가 not_found.
- [ ] **Step 2:** `pnpm --filter @keyring-notes/server exec vitest run test/issue.test.ts test/authz.test.ts` → FAIL.
- [ ] **Step 3:** 구현. `createChild` 는 한 번의 `this.update` 안에서 존재·상한 검사와 추가를 한다(경쟁 방지).
- [ ] **Step 4:** 같은 명령 → PASS, `pnpm --filter @keyring-notes/server test` 전체 통과.
- [ ] **Step 5:** 커밋 `feat(server): 하위 토큰 저장·정책·관리`

### Task 3: 검토 승인 때 권한 재판정

**Files:**
- Modify: `server/src/scoped.ts`(판정 헬퍼를 빼서 export), `server/src/review.ts`
- Test: `server/test/review.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `ConfigStore.policyOf`.
- Produces(`scoped.ts`에서 export):
  - `agentLevel(policy: Policy, relPath: string): Level` — 지금 `ScopedVault.level` 의 에이전트 갈래(SCHEMA·공통 설정·사람 전용 별칭은 `read` 로 깎기)를 그대로 옮긴 함수. `ScopedVault.level` 은 이것을 부른다.
  - `checkOpLevels(ops: Op[], level: (rel: string) => Level): void` — 지금 `batch` 앞부분의 연산별 최소 권한 검사(move/put/write/append/delete)를 옮긴 함수.
  - `opGuard(level: (rel: string) => Level): (action: Action, rel: string) => void` — 지금 `batch` 안의 `guard` 를 옮긴 함수.
- `ReviewQueue.approve`: `policy = config.policyOf(p.agent)`; `null` 이면 `ForbiddenError("proposal_agent_missing", {name})`. 아니면 `level = rel => agentLevel(policy, rel)` 로 `checkOpLevels` 를 하고 `vault.batch` 에 `guard: opGuard(level)` 을 넘긴다. 링크 갱신의 `canSee` 도 이 `policy` 로. 거부되면 제안은 `pending` 으로 남는다.
- 오류 코드: `proposal_agent_missing`({name}). 권한 부족은 기존 `forbidden_need`·`forbidden_append_only` 를 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트**(`review.test.ts`)
  - `승인 전 권한을 줄이면 승인이 거부되고 제안은 pending` — 사람이 만든 에이전트 `write` 로 제안 → `setRule(..., "read")` → `approve` 가 `forbidden_need`, 상태 `pending`.
  - `발급자를 지우면 하위 토큰의 제안 승인은 proposal_agent_missing`.
  - `권한이 그대로면 지금처럼 승인된다`(회귀).
- [ ] **Step 2:** `pnpm --filter @keyring-notes/server exec vitest run test/review.test.ts` → 새 테스트 FAIL.
- [ ] **Step 3:** 헬퍼를 빼고(`ScopedVault` 동작 불변), `approve` 를 고친다.
- [ ] **Step 4:** 서버 테스트 전체 PASS.
- [ ] **Step 5:** 커밋 `fix(server): 검토 승인 때 에이전트의 지금 권한으로 다시 판정`

### Task 4: 에이전트 표면 — MCP 도구·REST·whoami·llms.txt

**Files:**
- Modify: `server/src/scoped.ts`, `server/src/mcp.ts`, `server/src/app.ts`, `server/src/agentText.ts`, `server/src/llmsTxt.ts`
- Test: `server/test/issue.test.ts`(MCP·REST 갈래 추가), `server/test/llmstxt.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `createChild`·`childrenOf`·`rotateChild`·`removeChild`.
- Produces(`ScopedVault`):
  - `issueToken(suffix: string, rules: Record<string, Level>, baseUrl: string): { name: string; token: string; mcp: { url: string; headers: { Authorization: string } } }`
  - `issuedTokens(): { name: string; rules: Record<string, Level>; createdAt: string; lastUsed: string | null }[]`
  - `rotateIssued(name: string, baseUrl: string)` — `issueToken` 과 같은 꼴
  - `revokeIssued(name: string): { ok: true }`
  - 넷 다 소유자면 `ForbiddenError("issue_agent_only")`.
  - `whoami()` 는 하위 토큰이면 `issuedBy` 를 더한다.
- MCP 도구: `issue_token`(`name`, `rules: Record<string, enum(hidden..delete)>`), `list_issued_tokens`, `rotate_issued_token`(`name`), `revoke_issued_token`(`name`). 설명은 `agentText.ts` en/ko 의 `tools` 에 추가. `baseUrl` 은 `/llms.txt` 와 같은 방식(`admin.publicUrl`)으로 얻는다.
- REST(에이전트 토큰): `GET /api/tokens`, `POST /api/tokens`(`{name, rules}`), `POST /api/tokens/:name/rotate`, `DELETE /api/tokens/:name`.
- `llmsTxt` 에 발급 도구와 규칙 한 단락(범위 아래, `delete` 이하, 이름 `<발급자>-<이름>`, 발급자에 묶임).

- [ ] **Step 1: 실패하는 테스트** — REST: `issue` 를 가진 에이전트로 `POST /api/tokens` → 200, `name` 이 `<발급자>-w1`, 응답 토큰으로 `GET /api/...` 가 범위 안에서만 동작. 소유자 세션으로 `POST /api/tokens` → 403 `issue_agent_only`. MCP: `issue_token` 이 같은 결과, `list_issued_tokens` 에 방금 것이 보임, `whoami` 에 `issuedBy`. `llmstxt.test.ts`: 본문에 `issue_token` 포함.
- [ ] **Step 2:** 해당 테스트 실행 → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 서버 테스트 전체 PASS.
- [ ] **Step 5:** 커밋 `feat(server): 에이전트가 하위 토큰을 발급하는 MCP 도구와 REST`

### Task 5: 소유자 표면 — 관리 API·관리 화면·CLI

**Files:**
- Modify: `server/src/admin.ts`, `server/src/cli.ts`, `web/src/api.ts`, `web/src/Admin.tsx`, `packages/core/src/messages/{en,ko}.json`
- Test: `server/test/admin.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `removeAgent(): string[]`, `AgentConfig.issuedBy`.
- `GET /api/admin/agents` 각 항목에 `issuedBy: string | null`. `DELETE /api/admin/agents/:name` 응답 `{ ok: true, removed: string[] }`(함께 지운 하위 토큰). `PUT .../rules` 는 하위 토큰에 `issue` 면 400 `child_cannot_issue`.
- `web/src/api.ts`: `AgentInfo.issuedBy?: string | null`, `removeAgent` 반환 `{ ok: true; removed: string[] }`.
- `Admin.tsx`: `LEVELS` 에 `issue`(라벨 키 `admin.agents.level.issue`). 하위 토큰 카드에서는 `issue` 를 고를 수 없다. 하위 토큰은 발급자 카드 아래에 묶어 보이고 「발급: <발급자>」를 표시(`admin.agents.issuedBy`). 발급자 삭제 확인 문구에 함께 지워질 하위 토큰 이름(`admin.agents.confirmRemoveWithChildren`), 발급자 재발급 확인 문구에 하위 토큰 목록 확인 안내(`admin.agents.confirmRotateIssuer`).
- CLI: `agent grant` 가 `issue` 를 받고 하위 토큰엔 거부, `agent list` 에 발급자 표시, `agent remove` 가 함께 지운 하위 토큰 출력(`cli.removed_children`). `cli.usage` 의 단계 목록은 `LEVELS` 에서 자동.

- [ ] **Step 1: 실패하는 테스트**(`admin.test.ts`): 목록에 `issuedBy`, 발급자 삭제 응답 `removed: ["boss-w1"]`, 하위 토큰 규칙에 `issue` → 400.
- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** 구현. 메시지 키는 정렬된 자리에 손으로 넣는다.
- [ ] **Step 4:** `pnpm test`, `pnpm typecheck` PASS.
- [ ] **Step 5:** 시험 서버(임시 `KEYRING_DATA`, 기본이 아닌 포트, `docs/guides/development.md`)로 관리 화면 확인: `issue` 선택, 하위 토큰 묶음 표시, 삭제 확인 문구.
- [ ] **Step 6:** 커밋 `feat(web): 관리 화면·CLI 에 issue 권한과 하위 토큰 표시`

### Task 6: 문서

**Files:**
- Modify: `docs/manual/en/reference.md`, `docs/manual/ko/reference.md`(「권한」 절, MCP 도구·REST 표), `docs/manual/en/how-to/connect-agents.md`, `docs/manual/ko/how-to/connect-agents.md`(「권한 주기」 뒤에 「하위 토큰 발급하기」 절), `docs/ops/ux.md`(에이전트·권한 화면 절), `CHANGELOG.md`(Unreleased)

- [ ] **Step 1:** en 원본을 먼저 쓰고 ko 를 번역. 다룰 것: `issue` 단계, 발급 범위·`delete` 이하·좁히기 허용, 이름 `<발급자>-<이름>`, 발급자에 묶임(권한 축소·삭제), 승인 때 재판정(사람이 만든 에이전트 포함), 소유자는 관리 화면·CLI 사용.
- [ ] **Step 2:** `pnpm test`, `pnpm typecheck`, `pnpm build`, oxfmt·oxlint — 실행 개수 기록.
- [ ] **Step 3:** 커밋 `docs: 하위 토큰 발급(issue) 사용자 문서`
