import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NoteIndex } from "../src/noteindex.js";
import { parseCondition } from "@keyring-notes/core";
import { ScopedVault } from "../src/scoped.js";
import type { Vault } from "../src/vault.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

let dir: string;
let cleanup: () => Promise<void>;
let vault: Vault;
let index: NoteIndex;
let owner: ScopedVault;
let agent: ScopedVault;
const h: Record<string, string> = {};

const SEED: Record<string, string> = {
  "업무/프로젝트A/계획.md": `---
title: 프로젝트A 계획
status: doing
due: 2026-10-20
priority: 2
tags: [업무, 프로젝트/a]
---
# 계획
한국은행이 기준금리를 동결했다.
- [ ] 일정 확정
- [x] 킥오프
\`\`\`
- [ ] 코드 블록 안은 할 일이 아님 #코드태그
\`\`\`
[[회의록]] 참고
`,
  "업무/프로젝트A/회의록.md": `---
status: done
due: 2026-10-01
priority: 1
---
# 회의록
금리 이야기. [[계획|계획 문서]] 와 [[계획#일정]] 링크. #회의
- [ ] 회의록 정리
`,
  "업무/프로젝트B/계획.md": `---
status: todo
due: 2026-11-01
priority: 3
---
# B 계획
[[프로젝트B/계획]] 자기 자신, [[회의록]]
`,
  "개인/가계부.md": `---
status: todo
amount: 100
---
# 가계부
금리 비밀. [[계획]] #비밀
- [ ] 비밀 할 일
`,
};

beforeEach(async () => {
  const t = await tempDir("keyring-index-");
  dir = t.dir;
  cleanup = t.cleanup;
  ({ vault, index } = await openVault(dir));
  owner = new ScopedVault(vault, ownerPrincipal, index);
  agent = new ScopedVault(vault, agentPrincipal("work", { 업무: "write" }), index);
  for (const [p, c] of Object.entries(SEED)) h[p] = (await owner.write(p, c, null)).hash;
});

afterEach(async () => {
  index.close();
  await cleanup();
});

describe("검색", () => {
  it("한국어: 3글자 이상은 조사가 붙어도, 2글자는 LIKE로 찾는다", async () => {
    expect((await owner.search("기준금리")).map((x) => x.path)).toEqual(["업무/프로젝트A/계획.md"]);
    expect((await owner.search("동결했")).map((x) => x.path)).toEqual(["업무/프로젝트A/계획.md"]);
    expect((await owner.search("금리")).map((x) => x.path).sort()).toEqual(["개인/가계부.md", "업무/프로젝트A/계획.md", "업무/프로젝트A/회의록.md"]);
  });

  it("여러 단어는 모두 포함, 첫 일치 줄과 문서 기준 줄 번호", async () => {
    const hits = await owner.search("금리 이야기");
    expect(hits.map((x) => x.path)).toEqual(["업무/프로젝트A/회의록.md"]);
    expect(hits[0]).toMatchObject({ title: "회의록", line: 7, snippet: expect.stringContaining("금리 이야기") });
  });

  it("#태그 검색(하위 태그 포함)과 폴더 범위", async () => {
    expect((await owner.search("#프로젝트")).map((x) => x.path)).toEqual(["업무/프로젝트A/계획.md"]);
    expect((await owner.search("#회의 금리")).map((x) => x.path)).toEqual(["업무/프로젝트A/회의록.md"]);
    expect((await owner.search("금리", { folder: "개인" })).map((x) => x.path)).toEqual(["개인/가계부.md"]);
  });

  it("권한 밖 문서는 검색에 나오지 않는다", async () => {
    expect((await agent.search("금리")).map((x) => x.path)).not.toContain("개인/가계부.md");
    expect(await agent.search("#비밀")).toEqual([]);
  });

  it("변경·삭제가 바로 반영된다", async () => {
    await owner.write("업무/프로젝트A/계획.md", "# 계획\n새 내용 환율\n", h["업무/프로젝트A/계획.md"]);
    expect(await owner.search("기준금리")).toEqual([]);
    expect((await owner.search("환율")).map((x) => x.path)).toEqual(["업무/프로젝트A/계획.md"]);
    const d = await owner.read("업무/프로젝트A/계획.md");
    await owner.delete(d.path, d.hash);
    expect(await owner.search("환율")).toEqual([]);
  });
});

describe("태그", () => {
  it("프런트매터 + 본문 #태그, 코드 블록·제목의 #은 제외", async () => {
    const tags = (await owner.tags()).map((t) => t.tag);
    expect(tags).toEqual(expect.arrayContaining(["업무", "프로젝트/a", "회의", "비밀"]));
    expect(tags).not.toContain("코드태그");
    expect(tags).not.toContain("계획");
    expect((await agent.tags()).map((t) => t.tag)).not.toContain("비밀");
  });
});

describe("백링크", () => {
  it("별칭·제목 링크도 세고, 같은 이름이면 가장 얕은 경로로 해석한다", async () => {
    // [[계획]]은 업무/프로젝트A/계획.md 와 업무/프로젝트B/계획.md 중 더 얕은... 둘 다 깊이 3 → 경로 순 첫 번째
    const a = (await owner.backlinks("업무/프로젝트A/계획.md")).map((x) => x.path);
    expect(a).toEqual(["개인/가계부.md", "업무/프로젝트A/회의록.md"]);
    // 경로를 쓴 링크는 정확히 그 문서로
    expect((await owner.backlinks("업무/프로젝트B/계획.md")).map((x) => x.path)).toEqual([]);
    expect((await owner.backlinks("업무/프로젝트A/회의록.md")).map((x) => x.path)).toEqual(["업무/프로젝트A/계획.md", "업무/프로젝트B/계획.md"]);
  });

  it("숨김 문서에서 온 백링크는 빠진다", async () => {
    expect((await agent.backlinks("업무/프로젝트A/계획.md")).map((x) => x.path)).toEqual(["업무/프로젝트A/회의록.md"]);
    await expect(agent.backlinks("개인/가계부.md")).rejects.toThrow(/문서가 없습니다/);
  });

  it("문서를 옮기면 링크 해석이 따라간다", async () => {
    await owner.move("업무/프로젝트A/회의록.md", "회의록.md", h["업무/프로젝트A/회의록.md"]);
    expect((await owner.backlinks("회의록.md")).map((x) => x.path)).toEqual(["업무/프로젝트A/계획.md", "업무/프로젝트B/계획.md"]);
  });
});

describe("동기화", () => {
  it("서버 밖에서 바뀐 파일은 다음 sync에서 반영되고, 인덱스 파일은 지워도 다시 만든다", async () => {
    await writeFile(path.join(dir, "업무/외부.md"), "# 외부\n외부에서 작성한 환율 메모\n");
    await rm(path.join(dir, "개인/가계부.md"));
    const r = await index.sync(vault);
    expect(r).toEqual({ updated: 1, removed: 1 });
    expect((await owner.search("외부에서")).map((x) => x.path)).toEqual(["업무/외부.md"]);

    const fileIdx = path.join(dir, ".keyring", "index.db");
    await mkdir(path.dirname(fileIdx), { recursive: true });
    const fresh = new NoteIndex(fileIdx);
    expect((await fresh.sync(vault)).updated).toBe(4);
    expect((await fresh.sync(vault)).updated).toBe(0); // 바뀐 것이 없으면 다시 읽지 않는다
    fresh.close();
    // 인덱스 파일은 볼트 트리·Git에 나타나지 않는다
    expect(JSON.stringify(await owner.tree())).not.toContain(".keyring");
  });
});

describe("위젯", () => {
  const w = (s: ScopedVault, src: string) => s.widget(src);

  it("계획서 예시: query + where + show + sort", async () => {
    const r = await w(owner, "type: query\nfrom: 업무/프로젝트A\nwhere: status != done\nshow: [title, due]\nsort: due");
    expect(r).toMatchObject({ type: "query", columns: ["title", "due"], total: 1 });
    if (r.type !== "query") throw new Error();
    expect(r.rows.map(({ hash: _h, ...rest }) => rest)).toEqual([
      { path: "업무/프로젝트A/계획.md", title: "프로젝트A 계획", values: { title: "프로젝트A 계획", due: "2026-10-20" } },
    ]);
  });

  it("table: 여러 조건, 역순 정렬, 태그 from", async () => {
    const r = await w(owner, "type: table\nfrom: 업무\nwhere: [priority >= 2, '!amount']\nshow: [title, priority]\nsort: -priority");
    if (r.type !== "table") throw new Error();
    expect(r.rows.map((x) => x.values.priority)).toEqual([3, 2]);
    const t = await w(owner, "type: table\nfrom: '#업무'");
    if (t.type !== "table") throw new Error();
    expect(t.rows.map((x) => x.path)).toEqual(["업무/프로젝트A/계획.md"]);
    expect(t.columns).toEqual(["title", "modified"]);
  });

  it("today 키워드와 contains", async () => {
    const r = await w(owner, "from: 업무\nwhere: due < 2026-10-15");
    if (r.type !== "query") throw new Error();
    expect(r.rows.map((x) => x.path)).toEqual(["업무/프로젝트A/회의록.md"]);
    expect(parseCondition("due < today").value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const c = await w(owner, "where: title contains 계획");
    if (c.type !== "query") throw new Error();
    expect(c.rows).toHaveLength(2 + 0); // 프로젝트A 계획, B 계획 (가계부 제외)
  });

  it("tasks: 열린 할 일만, 코드 블록 제외, 권한 밖 제외", async () => {
    const r = await w(owner, "type: tasks\nfrom: 업무");
    if (r.type !== "tasks") throw new Error();
    expect(r.groups.flatMap((g) => g.tasks.map((t) => t.text))).toEqual(["일정 확정", "회의록 정리"]);
    const all = await w(owner, "type: tasks\nstatus: all");
    if (all.type !== "tasks") throw new Error();
    expect(all.total).toBe(4);
    const mine = await w(agent, "type: tasks\nstatus: all");
    if (mine.type !== "tasks") throw new Error();
    expect(mine.groups.map((g) => g.path)).not.toContain("개인/가계부.md");
  });

  it("chart: 필드별 개수·합계, 직접 입력 data", async () => {
    const r = await w(owner, "type: chart\nx: status");
    if (r.type !== "chart") throw new Error();
    expect(r.series).toEqual(
      expect.arrayContaining([
        { label: "todo", value: 2 },
        { label: "doing", value: 1 },
      ]),
    );
    const s = await w(owner, "type: chart\nchart: line\nx: status\ny: priority\nagg: sum\nfrom: 업무");
    if (s.type !== "chart") throw new Error();
    expect(s.series.find((x) => x.label === "todo")?.value).toBe(3);
    const d = await w(owner, "type: chart\ndata:\n  - {label: 1월, value: 3}\n  - {label: 2월, value: 5}");
    if (d.type !== "chart") throw new Error();
    expect(d.series).toEqual([
      { label: "1월", value: 3 },
      { label: "2월", value: 5 },
    ]);
    const hidden = await w(agent, "type: chart\nx: status");
    if (hidden.type !== "chart") throw new Error();
    expect(hidden.series.find((x) => x.label === "todo")?.value).toBe(1); // 가계부 제외
  });

  it("잘못된 위젯은 이유를 알려 준다", async () => {
    await expect(w(owner, "type: graph")).rejects.toMatchObject({ code: "widget.unknown_type" });
    await expect(w(owner, "type: chart")).rejects.toThrow(/x/);
    await expect(w(owner, "where: [a ~~ b c]")).rejects.toThrow(/조건/);
    await expect(w(owner, "type: [")).rejects.toThrow(/YAML/);
  });
});

describe("할 일 체크", () => {
  it("줄 번호로 체크하고, 버전이 다르면 충돌", async () => {
    const p = "업무/프로젝트A/계획.md";
    const d = await owner.setTask(p, 10, true, h[p]);
    expect(d.content).toContain("- [x] 일정 확정");
    await expect(owner.setTask(p, 11, false, h[p])).rejects.toMatchObject({ code: "conflict_path" });
    await expect(owner.setTask(p, 9, true, d.hash)).rejects.toThrow(/할 일이 아닙니다/);
    const r = await owner.widget("type: tasks\nfrom: 업무/프로젝트A");
    if (r.type !== "tasks") throw new Error();
    expect(r.groups.flatMap((g) => g.tasks.map((t) => t.text))).toEqual(["회의록 정리"]);
  });

  it("읽기 전용 에이전트는 체크할 수 없다", async () => {
    const ro = new ScopedVault(vault, agentPrincipal("ro", { 업무: "read" }), index);
    await expect(ro.setTask("업무/프로젝트A/계획.md", 10, true, h["업무/프로젝트A/계획.md"])).rejects.toThrow(/권한/);
  });
});
