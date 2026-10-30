# 파일 트리 하위 노트 정렬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 노트마다 바로 아래 하위 노트를 이름순·수정순·조회순·커스텀으로 정렬하고, 커스텀이면 끌어 놓아 순서를 바꾼다.

**Architecture:** 정렬 방식은 부모 노트 프런트매터 `sort`, 커스텀 순서는 하위 노트 프런트매터 `rank`(fractional index 글자 키), 수정 시각은 쓰기 계층(core `LocalVault.apply`, 서버 `Vault.batch`)이 적는 `edited`. 세 값은 트리 응답(`TreeNode`)에 실려 `VaultNode` 로 오고, 정렬은 core 의 순수 함수 하나가 한다. 조회 기록만 기기별(`localStorage`).

**Tech Stack:** TypeScript, React(web), Node 서버(git 볼트), `yaml`(프런트매터 편집, `frontmatter.ts`), vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-tree-child-sort-design.md`

## Global Constraints

- 필드 이름: 부모 `sort`(값 `name`·`modified`·`viewed`·`custom`, 없으면 이름순), 하위 `rank`, 모든 노트 `edited`. `updated`·`modified` 를 쓰지 않는다.
- `edited` 형식: 초 단위 UTC ISO 8601, 밀리초 없음(`2026-10-30T09:12:33Z`).
- 모든 정렬의 마지막 동점 처리는 이름 `localeCompare(…, "ko")`. rank 끼리는 글자 코드 비교(`<`), `localeCompare` 가 아니다.
- 정렬은 부모의 **바로 아래** 하위에만. 물려받지 않는다. 정하지 않은 노트는 이름순(데일리 폴더는 정하지 않았을 때만 `prefs.dailySortDesc`).
- 노트를 연 것만으로는 볼트 파일을 바꾸지 않는다. 조회 기록은 `localStorage` 만.
- `edited` 는 그 기기에서 난 변경(`LocalVault` 의 `source: "local"`)과 서버의 기기 토큰이 아닌 쓰기에만 적는다. 동기화로 받은 것·앱 밖 변경·`keyring-settings.md`·첨부에는 적지 않는다. YAML 이 깨진 노트는 적지 않고 저장한다.
- 화면 글은 `packages/core/src/messages/{en,ko}.json`(영어 기준, 키는 알파벳 순서 자리에 손으로). 공개 문서는 en 원본·ko 번역을 같은 커밋에서.
- 커밋 메시지는 한국어, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 파일은 경로로 stage.

## Review Focus

- **프런트매터가 깨진 노트를 저장한다** → 시각 없이 그대로 저장되어야 한다(저장 실패 금지). Task 2·5.
- **같은 부모 안에서 이름만 바꾼다** → rank 가 남아 순서가 그대로여야 한다. 부모가 바뀔 때만 지운다. Task 5·6.
- **동기화 기기가 올린 노트** → 서버가 다시 적지 않아, 다음 동기화가 같은 노트를 다시 올리지 않아야 한다. Task 6·7.
- **두 노트의 rank 가 같다**(두 기기가 같은 자리에 넣음) → 이름순으로, 어느 기기·몇 번을 그려도 같은 순서. Task 3.
- **`sort` 값이 이상하다**(`Custom`, 숫자, 목록) → 이름순으로 보이고 메뉴에는 아무것도 체크되지 않으며 오류가 나지 않는다. Task 3.

---

### Task 1: rank 키

**Files:**
- Create: `packages/core/src/rank.ts`
- Modify: `packages/core/src/index.ts`(내보내기)
- Test: `packages/core/test/rank.test.ts`

**Interfaces:**
- Produces: `rankBetween(a: string | null, b: string | null): string` — `a < r < b`(글자 코드 비교)인 가장 짧은 키. `null` 은 열린 끝. `a >= b` 면 `PathError("rank_order")`.

- [ ] **Step 1: 시험을 쓴다** — `rank.test.ts`:
  - `rankBetween(null, null)` 은 비어 있지 않은 글자.
  - 무작위 1000번: 지금 목록의 임의의 두 이웃(또는 맨 앞·맨 뒤) 사이에 넣고, 매번 목록이 `<` 로 엄격히 오름차순인지.
  - 같은 자리(맨 앞)에 200번 연달아 넣어도 키 길이가 40 이하.
  - `rankBetween("b", "a")`·`rankBetween("a", "a")` 는 `rank_order` 로 던진다.
- [ ] **Step 2: 실패를 확인한다** — `pnpm --filter @keyring-notes/core exec vitest run test/rank.test.ts` → 모듈 없음으로 FAIL.
- [ ] **Step 3: 구현한다** — 글자 집합은 `0-9A-Za-z`(62진, 코드 순서와 같은 순서). 키를 62진 소수로 보고 두 키의 중간 자릿수를 고른다. 키는 `"0"` 으로 끝나지 않게 해 언제나 그 앞에 넣을 자리를 남긴다. 오류 코드 `rank_order` 의 문구를 `messages/{en,ko}.json` 의 `error.rank_order` 에 넣는다.
- [ ] **Step 4: 통과를 확인한다** — 같은 명령, 실행된 시험 수가 0 이 아닌지 본다.
- [ ] **Step 5: 커밋** — `rank: 두 키 사이의 순서 키(rankBetween)`.

### Task 2: `edited` 읽기·적기·병합 맞추기

**Files:**
- Create: `packages/core/src/edited.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/edited.test.ts`

**Interfaces:**
- Consumes: `setFrontmatterField`(`frontmatter.ts`).
- Produces:
  - `EDITED_FIELD = "edited"`
  - `editedStamp(now: Date): string` — 초 단위 UTC, `Z` 로 끝남.
  - `editedOf(frontmatter: Record<string, unknown> | null): number | null` — 글자(ISO)나 `Date` 를 ms 로, 아니면 `null`.
  - `stampEdited(path: string, content: string, stamp: string): string` — `edited` 를 `stamp` 로 바꾼 내용. `path` 가 마크다운이 아니거나 `isVaultSettingsPath(path)` 거나 YAML 이 깨졌으면(`setFrontmatterField` 가 던지면) `content` 그대로.
  - `alignEdited(base: string, a: string, b: string): [string, string, string]` — 세 판의 `edited` 를 셋 중 가장 늦은 값으로 맞춘 판(셋 다 없으면 그대로). 병합 전에 부른다.

- [ ] **Step 1: 시험을 쓴다** — `edited.test.ts`:
  - `editedStamp(new Date("2026-10-30T09:12:33.456Z"))` === `"2026-10-30T09:12:33Z"`.
  - 프런트매터 없는 `"# 제목\n본문"` 에 적으면 `"---\nedited: 2026-10-30T09:12:33Z\n---\n# 제목\n본문"` 꼴, 다른 필드(`icon`, `tags`)와 그 순서는 그대로.
  - 깨진 YAML(`"---\na: [\n---\n본문"`)은 입력 그대로 돌려준다.
  - `keyring-settings.md` 와 `a.png` 는 그대로.
  - `editedOf({ edited: "2026-10-30T09:12:33Z" })` === `Date.parse(...)`, `editedOf({ edited: 3 })` === `null`.
  - `alignEdited` 후 `merge3` 시험: base `edited: T0` + 두 문단, a 는 첫 문단을 고치고 `edited: T1`, b 는 둘째 문단을 고치고 `edited: T2`(T2 > T1) → `merge3(...alignEdited(base, a, b))` 가 `ok` 이고 결과의 `edited` 가 T2.
- [ ] **Step 2: 실패를 확인한다** — `pnpm --filter @keyring-notes/core exec vitest run test/edited.test.ts` → FAIL.
- [ ] **Step 3: 구현한다** — `setFrontmatterField(content, EDITED_FIELD, stamp)` 를 try 로 감싼다.
- [ ] **Step 4: 통과를 확인한다.**
- [ ] **Step 5: 커밋** — `edited: 수정 시각 필드 읽기·적기와 병합 전 맞추기`.

### Task 3: 하위 노트 정렬과 커스텀 순서 계산

**Files:**
- Create: `packages/core/src/childSort.ts`
- Modify: `packages/core/src/nodes.ts`(`VaultNode` 필드), `packages/core/src/index.ts`
- Test: `packages/core/test/childSort.test.ts`

**Interfaces:**
- Consumes: `rankBetween`(Task 1), `VaultNode`.
- Produces:
  - `type ChildSort = "name" | "modified" | "viewed" | "custom"`; `SORT_FIELD = "sort"`, `RANK_FIELD = "rank"`.
  - `parseChildSort(v: unknown): ChildSort | null` — 네 글자 값만, 아니면 `null`(대소문자 그대로 비교).
  - `VaultNode` 에 선택 필드 `sort?: ChildSort`, `rank?: string`, `edited?: number`(ms; `edited` 가 없으면 파일 시각).
  - `sortChildren(nodes: VaultNode[], sort: ChildSort | null, viewedAt: (notePath: string) => number | undefined): VaultNode[]` — 새 배열. 규칙은 spec 「정렬 규칙」 표. `null`·`"name"` 은 받은 순서(이미 이름순)를 그대로 둔다.
  - `seedRanks(siblings: VaultNode[]): { note: string; rank: string }[]` — rank 가 하나도 없을 때 `note !== null` 인 노트에 지금 순서대로 rank. 하나라도 있으면 `[]`.
  - `planReorder(siblings: VaultNode[], moving: string, beforePath: string | null): { note: string | null; node: string; rank: string }[]` — `siblings` 는 지금 보이는 순서(커스텀 정렬 결과). `moving`(노드 경로)을 `beforePath` 앞(`null` 이면 맨 뒤)에 두기 위해 적을 rank. 이웃 둘이 rank 를 가지면 결과는 한 개. 사이 값을 못 만들면(이웃이 rank 없음) 그 자리까지의 rank 없는 노드에도 rank 를 함께 매긴다. `note === null` 인 항목은 부르는 쪽이 노트를 만든 뒤 적는다.

- [ ] **Step 1: 시험을 쓴다** — `childSort.test.ts`(노드는 `{ name, path, note, dir:false, children:[], attachments:[] }` 를 만드는 작은 도우미로):
  - `custom`: rank `a1`·`a0`·없음(가)·없음(나) → `a0, a1, 가, 나`.
  - 같은 rank 둘 → 이름순, 입력 순서를 섞어 10번 불러도 같은 결과.
  - `modified`: `edited` 큰 것이 위, `edited` 없는(노트 없는 폴더) 노드는 맨 뒤 이름순.
  - `viewed`: `viewedAt` 이 큰 것이 위, `undefined` 는 뒤에 이름순.
  - `parseChildSort("Custom")`·`parseChildSort(["custom"])`·`parseChildSort(3)` 은 `null`, `"viewed"` 는 `"viewed"`.
  - `seedRanks`: 노트 셋 + 노트 없는 폴더 하나 → 결과 셋, 순서대로 rank 오름차순. 이미 rank 하나 있으면 `[]`.
  - `planReorder`: rank 있는 셋 `[A,B,C]` 에서 C 를 A 앞으로 → 결과 하나(C), `C.rank < A.rank`. rank 있는 `[A,B]` + rank 없는 `[x,y]` 에서 y 를 B 와 x 사이로 → 결과에 y 가 있고, 그 결과를 적용해 `sortChildren(…, "custom")` 하면 `A,B,y,x`.
- [ ] **Step 2: 실패를 확인한다** — `pnpm --filter @keyring-notes/core exec vitest run test/childSort.test.ts` → FAIL.
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과를 확인한다.**
- [ ] **Step 5: 커밋** — `정렬: 하위 노트 정렬(sortChildren)과 커스텀 순서 계산(seedRanks·planReorder)`.

### Task 4: 트리 응답에 `sort`·`rank`·`edited` 싣기

**Files:**
- Modify: `packages/core/src/types.ts`(`TreeNode`), `packages/core/src/local.ts`(`LocalVault.tree`), `packages/core/src/nodes.ts`(`buildNodeTree`), `server/src/vault.ts`(`TreeNode`), `server/src/scoped.ts`(`withIcons` → `withMeta`), `web/src/api.ts`(`TreeNode`)
- Test: `packages/core/test/nodes.test.ts`, `packages/core/test/local.test.ts`, `server/test/nodes.test.ts`

**Interfaces:**
- Consumes: `parseChildSort`, `editedOf`, `RANK_FIELD`, `SORT_FIELD`.
- Produces: 세 `TreeNode` 정의 모두에 `sort?: ChildSort; rank?: string; edited?: number`(파일 노드만). `edited` 는 `editedOf(fm) ?? mtime`. `buildNodeTree` 가 노트 파일 노드의 세 값을 `VaultNode` 로 옮긴다(`icon` 과 같은 자리).

- [ ] **Step 1: 시험을 쓴다**
  - `nodes.test.ts`: `sort: "custom"`·`rank: "a0"`·`edited: 5` 가 붙은 `A.md` 와 `A/` → `VaultNode` 에 셋 다 있다. `sort: "Custom"` 은 실리지 않는다(Task 3 의 `parseChildSort` 를 트리 쪽에서 거른다).
  - `local.test.ts`: 프런트매터 `edited: 2026-10-30T09:12:33Z` 인 노트의 `tree()` 노드 `edited` 가 그 ms, `edited` 없는 노트는 그 파일의 `mtime`.
  - `server/test/nodes.test.ts`: 서버 트리 응답도 같은 두 경우.
- [ ] **Step 2: 실패를 확인한다** — 세 시험 파일을 각 패키지에서 vitest 로.
- [ ] **Step 3: 구현한다** — 서버는 색인(`this.index.docs()` 의 `frontmatter`·`mtime`)에서, 로컬은 `entry.meta`. `withIcons` 를 `withMeta` 로 이름을 바꾸고 아이콘과 함께 붙인다.
- [ ] **Step 4: 통과를 확인한다.**
- [ ] **Step 5: 커밋** — `트리: 노트의 sort·rank·edited 를 트리 응답과 노드 트리에 싣는다`.

### Task 5: 로컬 볼트 — 시각 적기, 옮길 때 rank 지우기, 여러 파일 쓰기

**Files:**
- Modify: `packages/core/src/local.ts`(`apply`, `write`, `move`, `moveNode`, 새 `writeMany`), `web/src/local/localApi.ts`
- Test: `packages/core/test/local.test.ts`

**Interfaces:**
- Consumes: `stampEdited`, `editedStamp`(Task 2), `RANK_FIELD`.
- Produces:
  - `LocalVault.apply` 가 `source === "local"` 인 마크다운 변경마다 `stampEdited(c.path, c.content, editedStamp(now))` 를 적용한다(링크 고쳐 쓰기·옮기기·할 일·되돌리기·데일리 옮기기가 모두 `apply` 를 지난다). 기록(journal)·색인·해시는 적은 내용으로.
  - `write`·`move` 가 돌려주는 `content`·`hash` 는 적은 뒤의 것.
  - `moveNode(from, to)`: `parentNode(from) !== parentNode(to)` 면 옮긴 노드 노트의 `rank` 를 같은 기록 안에서 지운다(`setFrontmatterField(…, RANK_FIELD, null)`). 같은 부모 안 이름 바꾸기는 그대로.
  - `writeMany(files: { path: string; content: string; baseHash: string | null }[], message: string): Promise<{ path: string; hash: string }[]>` — 모든 `baseHash` 를 확인한 뒤 한 번의 `apply` 로.

- [ ] **Step 1: 시험을 쓴다** — `local.test.ts`(시계는 `vi.setSystemTime`):
  - `write` 한 노트의 디스크 내용에 `edited: <지금>` 이 있고 돌려준 `hash` 가 디스크 내용의 해시.
  - 옛 `edited` 가 든 초안을 `write` 하면 새 시각으로 적힌다(되돌아오지 않는다).
  - 깨진 YAML 노트도 `write` 가 성공하고 내용이 그대로.
  - `move` 로 이름을 바꾸면 옮긴 노트와 **링크를 고친 다른 노트** 모두 `edited` 가 지금.
  - 동기화로 받은 변경(`SyncEngine` 이 pull 한 노트)과 `keyring-settings.md` 쓰기에는 `edited` 가 생기지 않는다.
  - `moveNode("업무/A", "개인/A")` 는 `개인/A.md` 의 `rank` 를 지우고, `moveNode("업무/A", "업무/B")` 는 남긴다.
  - `writeMany` 두 파일 → 기록 하나, 하나의 `baseHash` 가 틀리면 아무것도 안 바뀌고 `ConflictError`.
- [ ] **Step 2: 실패를 확인한다** — `pnpm --filter @keyring-notes/core exec vitest run test/local.test.ts`.
- [ ] **Step 3: 구현한다** — 시각은 `apply` 한 번에 하나(`editedStamp(new Date())`)로 모든 변경에 같은 값.
- [ ] **Step 4: 통과를 확인한다** — 그리고 core 전체 `pnpm --filter @keyring-notes/core test`(`edited` 가 생겨 깨지는 기존 시험은 기대값을 고친다. 고친 시험 목록을 보고에 적는다).
- [ ] **Step 5: 커밋** — `로컬 볼트: 바뀐 노트에 edited 를 적고, 다른 노드로 옮기면 rank 를 지우고, 여러 파일을 한 기록으로 쓴다`.

### Task 6: 서버 — 시각 적기(기기 토큰 제외), 옮길 때 rank 지우기, 여러 파일 쓰기

**Files:**
- Modify: `server/src/vault.ts`(`batch` 옵션 `edited?: string`), `server/src/scoped.ts`(`batch` 가 넘김, `moveNode`), `server/src/review.ts`(승인해 적용할 때), `web/src/api.ts`(`writeMany`)
- Test: `server/test/nodes.test.ts`, `server/test/index.test.ts`(쓰기 시험이 있는 쪽), `server/test/devices.test.ts`

**Interfaces:**
- Consumes: `stampEdited`, `editedStamp`, `RANK_FIELD`.
- Produces:
  - `Vault.batch(ops, author, { …, edited?: string })`: 링크 고쳐 쓰기(1-2 단계)까지 끝난 가상 상태에서, 내용이 원래와 다르거나 새 경로로 옮겨 온 마크다운 슬롯마다 `stampEdited(rel, s.content, opts.edited)` 를 적용한 뒤 디스크에 쓴다. `edited` 를 안 넘기면 적지 않는다.
  - `ScopedVault.batch` 는 `principal.kind === "owner" && principal.device` 가 **아니면** `edited: editedStamp(new Date())` 를 넘긴다(에이전트·웹 소유자·MCP·REST 는 적고, 동기화 기기는 안 적는다). 검토 대기열을 승인해 적용하는 길도 적는다.
  - `ScopedVault.moveNode`: 부모가 바뀌면 옮긴 노드 노트에 `rank` 를 지우는 `write` 연산을 같은 일괄 쓰기에 덧붙인다.
  - 웹 `api.writeMany(files, message)` 가 `POST /api/batch` 에 `write` 연산들로 보낸다. `Api` 형식(원격·로컬 모두)에 같은 시그니처를 둔다.

- [ ] **Step 1: 시험을 쓴다**
  - 소유자 `PUT /api/file` → 저장된 내용에 `edited`, 응답 `content`·`hash` 가 저장된 것.
  - 기기 토큰으로 같은 쓰기 → 보낸 내용 그대로(`edited` 를 바꾸지 않는다), 응답 해시 = 보낸 내용의 해시.
  - 이동으로 링크를 고친 노트들도 `edited` 가 생긴다.
  - `moveNode` 다른 부모 → `rank` 없음, 같은 부모 이름 바꾸기 → `rank` 남음. 커밋은 하나.
  - 깨진 YAML 노트 쓰기가 성공한다.
- [ ] **Step 2: 실패를 확인한다** — `pnpm --filter @keyring-notes/server exec vitest run`(해당 파일).
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과를 확인한다** — 서버 전체 시험도 돌려 기대값을 고친 시험을 보고에 적는다.
- [ ] **Step 5: 커밋** — `서버: 기기 토큰이 아닌 쓰기에 edited 를 적고, 다른 노드로 옮기면 rank 를 지운다`.

### Task 7: 동기화 병합에서 `edited` 맞추기

**Files:**
- Modify: `packages/core/src/sync.ts`(`runOnce` 의 `merge3` 호출 자리)
- Test: `packages/core/test/sync.test.ts`

**Interfaces:**
- Consumes: `alignEdited`(Task 2), Task 5·6 의 적기 규칙.

- [ ] **Step 1: 시험을 쓴다** — `fakeServer` 로:
  - 두 기기가 같은 노트의 서로 다른 문단을 고치고(각자 `edited` 가 다름) 차례로 동기화 → 충돌 사본 없이 합쳐지고, 결과 `edited` 는 더 늦은 값.
  - 한 기기가 노트를 고쳐 동기화한 뒤 다시 동기화 → 두 번째 동기화의 `pushed` 가 비어 있다(되풀이해 올리지 않음).
- [ ] **Step 2: 실패를 확인한다** — `pnpm --filter @keyring-notes/core exec vitest run test/sync.test.ts`.
- [ ] **Step 3: 구현한다** — `merge3(baseText, mine.content, theirs.content)` 를 `merge3(...alignEdited(baseText, mine.content, theirs.content))` 로. `fakeServer` 가 기기 쓰기에 시각을 적지 않는지(Task 6 과 같은 규칙) 확인한다.
- [ ] **Step 4: 통과를 확인한다.**
- [ ] **Step 5: 커밋** — `동기화: 병합 전에 edited 를 더 늦은 값으로 맞춘다`.

### Task 8: 기기별 조회 기록

**Files:**
- Create: `web/src/viewed.ts`
- Modify: `web/src/Workspace.tsx`(`remember` 자리, 이름 바꾸기 뒤 `setRecent` 를 고치는 자리, 지운 뒤 `setRecent` 를 거르는 자리)
- Test: `web/src/viewed.test.ts`

**Interfaces:**
- Produces:
  - `VIEWED_KEY = "keyring:viewed"`; `viewedAt(notePath: string): number | undefined`
  - `markViewed(notePath: string, at?: number): void`
  - `renameViewed(from: string, to: string): void` — 노트 경로가 같으면 옮기고, 노드 이동이면 `from` 아래(`from` 의 확장자 뺀 경로 + `/`)도 따라 옮긴다.
  - `forgetViewed(gone: (notePath: string) => boolean): void`
  - `useViewedVersion(): number` — 기록이 바뀔 때 오르는 값(트리가 다시 정렬하게).
  - `localStorage` 접근은 모두 try 로 감싼다.

- [ ] **Step 1: 시험을 쓴다** — `viewed.test.ts`: 표시·조회, 노드 이동으로 `업무/A.md`·`업무/A/b.md` 가 함께 옮겨짐, 지우기, `localStorage` 가 던져도 오류 없음.
- [ ] **Step 2: 실패를 확인한다** — `pnpm --filter @keyring-notes/web exec vitest run src/viewed.test.ts`.
- [ ] **Step 3: 구현하고 `Workspace.tsx` 세 자리에서 부른다.**
- [ ] **Step 4: 통과를 확인한다.**
- [ ] **Step 5: 커밋** — `조회 기록: 기기마다 노트를 마지막으로 연 시각`.

### Task 9: 트리가 정렬해 보이고, 정렬을 고른다

**Files:**
- Modify: `web/src/Tree.tsx`(`rows` 의 `walk`, `menuFor`, props), `web/src/Workspace.tsx`(`TreeOptions`, 정렬을 적는 처리), `web/src/Properties.tsx`, `packages/core/src/messages/{en,ko}.json`
- Test: `web/src/childSortUi.test.ts`(순수 도우미가 있으면), 그 밖에는 Step 4 의 화면 확인

**Interfaces:**
- Consumes: `sortChildren`, `seedRanks`, `parseChildSort`(Task 3), `viewedAt`·`useViewedVersion`(Task 8), `api.writeMany`(Task 5·6).
- Produces:
  - `Tree` prop `rootSort: ChildSort | null` — 워크스페이스 하나를 볼 때 맨 위 목록의 정렬(워크스페이스 노드의 `sort`). 모든 워크스페이스 보기에서는 `null`(워크스페이스 순서는 `workspaceOrder`).
  - `TreeActions.setChildSort(node: VaultNode | null, sort: ChildSort): void` — `null` 이면 지금 워크스페이스. 부모 노트의 `sort` 를 적고(`name` 이면 지움), 노트가 없으면 만든다. `custom` 이고 `seedRanks` 가 비지 않으면 그 rank 쓰기까지 `writeMany` 한 번(메시지 하나)으로.
  - 트리 `walk` 는 부모 노드의 `sort`(맨 위는 `rootSort`)로 `sortChildren` 한다. 정렬을 정하지 않았을 때만 지금의 `decor.descending`(데일리) 을 쓴다.
  - 노드 메뉴에 「하위 노트 정렬」(워크스페이스 행 포함). 누르면 같은 자리에 둘째 `Menu` 를 띄워 네 가지를 `icon: Check` 로 고르게 한다(`TreeOptions` 의 첨부 보이기 항목과 같은 모양).
  - `TreeOptions`(파일 보기 「더 보기」, `tree.options`)에 구분선과 「노트 정렬」 네 항목. 워크스페이스 하나를 볼 때만.
  - `Properties` 는 `sort`·`rank`·`edited` 행을 보이지 않는다.
  - 화면 글 키(영어 기준): `tree.childSort`(Sort sub-notes), `tree.childSortRoot`(Sort notes), `tree.sortName`(Name), `tree.sortModified`(Last modified), `tree.sortViewed`(Last opened), `tree.sortCustom`(Custom). 한국어: 하위 노트 정렬, 노트 정렬, 이름순, 수정순, 조회순, 커스텀.

- [ ] **Step 1: 순수 부분이 있으면 시험을 쓴다** — 예: 「정렬을 적을 쓰기 목록 만들기」 를 함수로 빼면 그것을 시험한다(이름순이면 필드 삭제, 노트 없는 노드면 새 노트 내용, `custom` 처음이면 rank 쓰기 포함).
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 확인한다** — 루트에서 `pnpm test`·`pnpm typecheck`. 시험 서버(임시 `KEYRING_DATA`, 다른 포트, `docs/guides/development.md`)로 브라우저에서: 노트 하나를 수정순·조회순·커스텀으로 바꿔 순서가 바뀌는지, 워크스페이스 「더 보기」 에서 맨 위 정렬, 노트 없는 폴더에서 고르면 노트가 생기는지, 새로 고침 뒤에도 같은지, 속성 패널에 세 필드가 안 보이는지.
- [ ] **Step 5: 커밋** — `트리: 하위 노트 정렬을 고르고 그 순서로 보인다`.

### Task 10: 커스텀 순서 바꾸기

**Files:**
- Modify: `web/src/Tree.tsx`(`dragOver`·`drop`, 삽입선, `menuFor`, `onKey`), `web/src/Workspace.tsx`(재배치 처리), `web/src/styles.css`, `web/src/shortcuts.ts`, `packages/core/src/messages/{en,ko}.json`

**Interfaces:**
- Consumes: `planReorder`(Task 3), `api.writeMany`.
- Produces:
  - `TreeActions.reorder(path: string, beforePath: string | null): void` — 같은 부모 안에서 `path` 를 `beforePath` 앞으로. `planReorder` 결과 중 `note === null` 인 노드는 노트를 만들고, 모두 `writeMany` 한 번으로.
  - 부모가 커스텀일 때만: 행의 위·아래 가장자리 위에서는 삽입선을 보이고 `reorder`, 가운데는 지금처럼 `move`. 다른 부모의 행 사이면 그 부모로 `move`. 부모가 커스텀이 아니면 판정을 하지 않는다.
  - 노드 메뉴 「위로」·「아래로」(부모가 커스텀일 때만 켜짐, 맨 위·맨 아래면 꺼짐)와 단축키. 키는 `shortcuts.ts` 의 기존 키와 겹치지 않게 고르고 키 설정 화면에 보이게 한다.
  - 화면 글 키: `tree.moveUp`(Move up), `tree.moveDown`(Move down). 한국어: 위로, 아래로.

- [ ] **Step 1: 확인 절차를 정한다** — 아래 Step 4 의 화면 확인 항목.
- [ ] **Step 2: 구현한다.**
- [ ] **Step 3: 루트에서 `pnpm test`·`pnpm typecheck`.**
- [ ] **Step 4: 화면에서 확인한다** — 시험 서버로: 커스텀 노트 아래에서 끌어 순서 바꾸기(파일 하나만 바뀌는지 — 서버 모드면 커밋의 파일 수), 가운데에 놓으면 그 안으로 옮겨지고 rank 가 지워지는지, 이름순 노트 아래에서는 삽입선이 안 나오는지, 「위로」·「아래로」·단축키, 새로 고침 뒤 순서 유지.
- [ ] **Step 5: 커밋** — `트리: 커스텀 정렬에서 끌어 놓기·위로·아래로 순서 바꾸기`.

### Task 11: 문서

**Files:**
- Modify: `docs/ops/ux.md`(새 절), `docs/manual/en/how-to/organize-notes.md`, `docs/manual/ko/how-to/organize-notes.md`, `docs/manual/en/reference.md`·`ko/reference.md`(단축키·속성 필드가 실리는 곳이면), `CHANGELOG.md`

- [ ] **Step 1: `ux.md` 에 절을 쓴다** — 요청·결정(spec 의 「결정 (사용자)」 표와 같은 값)·구조(필드 셋, 적는 자리, 기기 토큰 예외)·확인한 것(Task 9·10 의 화면 확인)·남은 것(위젯 `modified` 열, 시각이 없는 기존 노트의 기기별 어긋남, 다른 편집기로 고친 노트).
- [ ] **Step 2: 사용자 문서 en 을 쓰고 ko 로 옮긴다** — 정렬 고르기, 커스텀 순서 바꾸기, 조회순은 기기마다 다르다는 것, 노트에 `edited`·`rank`·`sort` 가 생긴다는 것. 규칙은 `docs/guideline/public-docs/03-i18n.md`·`04-style.md`.
- [ ] **Step 3: CHANGELOG 한 줄(Added).**
- [ ] **Step 4: 루트에서 `pnpm test`·`pnpm typecheck`·`pnpm build`, 실행된 시험 수를 적는다.**
- [ ] **Step 5: 커밋** — `문서: 하위 노트 정렬 — ux.md, 사용자 문서 en·ko, CHANGELOG`.
