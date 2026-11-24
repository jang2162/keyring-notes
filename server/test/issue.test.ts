import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigStore } from "../src/config.js";
import { tempDir } from "./helpers.js";

let config: ConfigStore;
let cleanup: () => Promise<void>;

/** 던진 오류의 코드(PathError.code)와 인자 */
function failure(fn: () => unknown): { code: string; params?: Record<string, unknown> } {
  try {
    fn();
  } catch (e) {
    const err = e as { code: string; params?: Record<string, unknown> };
    return { code: err.code, params: err.params };
  }
  throw new Error("던지지 않았다");
}

beforeEach(async () => {
  const t = await tempDir("keyring-issue-");
  cleanup = t.cleanup;
  config = new ConfigStore(path.join(t.dir, "config", "keyring.json"));
  config.issueToken("boss");
  config.setRules("boss", { 업무: "issue", "업무/비밀": "hidden" });
});

afterEach(() => cleanup());

describe("하위 토큰 발급", () => {
  it("createChild: 이름은 <발급자>-<뒷부분>", () => {
    const { name, token } = config.createChild("boss", "w1", { "업무/a": "write" });
    expect(name).toBe("boss-w1");
    const p = config.agentByToken(token);
    expect(p).toMatchObject({ kind: "agent", name: "boss-w1", issuedBy: "boss" });
    expect(config.get().agents.find((a) => a.name === "boss-w1")).toMatchObject({ issuedBy: "boss", rules: { "업무/a": "write" } });
    // 사람이 만든 에이전트의 Principal 에는 issuedBy 가 없다
    const bossToken = config.issueToken("boss");
    expect(config.agentByToken(bossToken)).not.toHaveProperty("issuedBy");
  });

  it("범위 밖·단계 초과면 아무것도 만들지 않는다", () => {
    const before = config.get().agents.length;
    expect(failure(() => config.createChild("boss", "w1", { "업무/a": "read", 개인: "read" }))).toMatchObject({
      code: "issue_scope",
      params: { path: "개인" },
    });
    expect(failure(() => config.createChild("boss", "w1", { "업무/a": "issue" }))).toMatchObject({ code: "issue_level", params: { path: "업무/a" } });
    expect(failure(() => config.createChild("boss", "w1", { "업무/비밀": "read" }))).toMatchObject({ code: "issue_level", params: { path: "업무/비밀" } });
    expect(config.get().agents.length).toBe(before);
  });

  it("이름 경계", () => {
    expect(failure(() => config.createChild("boss", "", { "업무/a": "read" })).code).toBe("agent_name");
    expect(failure(() => config.createChild("boss", "A b", { "업무/a": "read" })).code).toBe("agent_name");
    // "boss-" 5자 + 60자 = 65자
    expect(failure(() => config.createChild("boss", "x".repeat(60), { "업무/a": "read" })).code).toBe("agent_name");
    expect(config.createChild("boss", "x".repeat(59), { "업무/a": "read" }).name).toHaveLength(64);
    config.issueToken("boss-x");
    expect(failure(() => config.createChild("boss", "x", { "업무/a": "read" })).code).toBe("agent_exists");
    expect(config.get().agents.find((a) => a.name === "boss-x")?.issuedBy).toBeUndefined();
  });

  it("issue 없는 발급자·하위 토큰 발급자는 거부", () => {
    config.issueToken("plain");
    config.setRules("plain", { 업무: "delete" });
    expect(failure(() => config.createChild("plain", "w1", { "업무/a": "read" })).code).toBe("issue_scope");
    expect(failure(() => config.createChild("plain", "w1", {})).code).toBe("issue_scope");
    config.createChild("boss", "w1", { "업무/a": "read" });
    expect(failure(() => config.createChild("boss-w1", "w2", { "업무/a": "read" })).code).toBe("issue_scope");
    expect(failure(() => config.createChild("nobody", "w1", {})).code).toBe("agent_missing");
  });

  it("상한 50", () => {
    for (let i = 0; i < 50; i++) config.createChild("boss", `w${i}`, { "업무/a": "read" });
    expect(failure(() => config.createChild("boss", "w50", { "업무/a": "read" }))).toMatchObject({ code: "issue_limit", params: { limit: 50 } });
    expect(config.childrenOf("boss")).toHaveLength(50);
  });

  it("childrenOf 는 자기가 발급한 것만", () => {
    config.issueToken("other");
    config.setRules("other", { 업무: "issue" });
    config.createChild("boss", "w1", { "업무/a": "read" });
    config.createChild("other", "w1", { "업무/a": "read" });
    expect(config.childrenOf("boss").map((a) => a.name)).toEqual(["boss-w1"]);
  });

  it("남의 이름은 agent_missing", () => {
    config.issueToken("claude");
    config.issueToken("other");
    config.setRules("other", { 업무: "issue" });
    config.createChild("other", "1", { "업무/a": "read" });
    expect(failure(() => config.rotateChild("boss", "other-1"))).toMatchObject({ code: "agent_missing", params: { name: "other-1" } });
    expect(failure(() => config.removeChild("boss", "claude"))).toMatchObject({ code: "agent_missing", params: { name: "claude" } });
    expect(failure(() => config.removeChild("boss", "boss-none")).code).toBe("agent_missing");
    expect(config.get().agents.map((a) => a.name)).toEqual(expect.arrayContaining(["claude", "other-1"]));
  });

  it("rotateChild 는 이전 토큰을 바로 무효로 한다", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    const next = config.rotateChild("boss", "boss-w1");
    expect(next).not.toBe(token);
    expect(config.agentByToken(token)).toBeNull();
    expect(config.agentByToken(next)).toMatchObject({ name: "boss-w1", issuedBy: "boss" });
  });

  it("removeChild 는 그 하위 토큰을 지운다", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    config.removeChild("boss", "boss-w1");
    expect(config.agentByToken(token)).toBeNull();
    expect(config.childrenOf("boss")).toEqual([]);
  });

  it("발급자 삭제는 하위 토큰도 지운다", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    expect(config.removeAgent("boss")).toEqual(["boss-w1"]);
    expect(config.agentByToken(token)).toBeNull();
    expect(config.get().agents.map((a) => a.name)).not.toContain("boss-w1");
    config.issueToken("solo");
    expect(config.removeAgent("solo")).toEqual([]);
  });

  it("발급자 재발급은 하위 토큰을 유지", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    config.issueToken("boss");
    expect(config.agentByToken(token)).toMatchObject({ name: "boss-w1" });
  });

  it("발급자 권한을 줄이면 다음 인증부터 줄어든다", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "write" });
    const p = config.agentByToken(token);
    expect(p?.kind === "agent" && p.policy.level("업무/a/n.md")).toBe("write");
    config.setRule("boss", "업무", "read");
    const after = config.agentByToken(token);
    expect(after?.kind === "agent" && after.policy.level("업무/a/n.md")).toBe("read");
    expect(config.policyOf("boss-w1")?.level("업무/a/n.md")).toBe("read");
    expect(config.policyOf("boss-w1")?.toJSON()).toEqual({ "업무/a": "write" });
  });

  it("policyOf: 없는 에이전트는 null, 사람이 만든 에이전트는 자기 규칙", () => {
    expect(config.policyOf("nobody")).toBeNull();
    expect(config.policyOf("boss")?.level("업무/x.md")).toBe("issue");
  });

  it("하위 토큰에 issue 를 줄 수 없다", () => {
    config.createChild("boss", "w1", { "업무/a": "read" });
    expect(failure(() => config.setRule("boss-w1", "업무/a", "issue")).code).toBe("child_cannot_issue");
    expect(failure(() => config.setRules("boss-w1", { "업무/a": "issue" })).code).toBe("child_cannot_issue");
    // 소유자는 하위 토큰 규칙을 issue 아래로는 고칠 수 있다
    config.setRule("boss-w1", "업무/a", "delete");
    expect(config.get().agents.find((a) => a.name === "boss-w1")?.rules).toEqual({ "업무/a": "delete" });
  });

  it("설정 검증", () => {
    const base = config.get();
    const agent = (name: string, extra: Record<string, unknown>) => ({ name, tokenHash: "0".repeat(64), rules: {}, createdAt: "", ...extra });
    expect(
      failure(() =>
        config.replaceAll({
          ...base,
          agents: [agent("boss", { rules: { 업무: "issue" } }), agent("boss-a", { issuedBy: "boss" }), agent("boss-a-b", { issuedBy: "boss-a" })],
        }),
      ),
    ).toMatchObject({ code: "config.child_chain", params: { name: "boss-a-b" } });
    expect(
      failure(() =>
        config.replaceAll({ ...base, agents: [agent("boss", { rules: { 업무: "issue" } }), agent("boss-a", { issuedBy: "boss", rules: { 업무: "issue" } })] }),
      ),
    ).toMatchObject({ code: "config.child_issue", params: { name: "boss-a" } });
    // 설정이 바뀌지 않았다
    expect(config.get().agents.map((a) => a.name)).toEqual(["boss"]);

    // 발급자가 없는 하위 토큰은 검증을 통과하고 인증만 막힌다
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    const now = config.get();
    config.replaceAll({ ...now, agents: now.agents.filter((a) => a.name !== "boss") });
    expect(config.get().agents.map((a) => a.name)).toEqual(["boss-w1"]);
    expect(config.agentByToken(token)).toBeNull();
    expect(config.policyOf("boss-w1")).toBeNull();
  });

  it("발급자가 사라진 뒤 같은 이름을 새로 만들면 고아 하위 토큰은 지워진다", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    const now = config.get();
    config.replaceAll({ ...now, agents: now.agents.filter((a) => a.name !== "boss") });
    config.issueToken("boss");
    expect(config.agentByToken(token)).toBeNull();
    expect(config.get().agents.map((a) => a.name)).toEqual(["boss"]);
  });

  it("발급자 재발급은 하위 토큰을 건드리지 않는다", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    config.issueToken("boss");
    expect(config.agentByToken(token)).not.toBeNull();
  });
});
