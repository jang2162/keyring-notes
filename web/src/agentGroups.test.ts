import { describe, expect, it } from "vitest";
import type { AgentInfo } from "./api";
import { agentGroups, issuedNames, unconfirmedRemoved } from "./agentGroups";

const agent = (name: string, issuedBy?: string): AgentInfo => ({
  name,
  rules: {},
  createdAt: "2026-11-24T00:00:00.000Z",
  lastUsed: null,
  ...(issuedBy ? { issuedBy } : {}),
});

describe("agentGroups", () => {
  it("하위 토큰은 발급자 아래에 묶고, 발급자가 없는 하위 토큰은 따로 한 줄", () => {
    const groups = agentGroups([agent("boss"), agent("boss-w1", "boss"), agent("claude"), agent("ghost-w1", "ghost"), agent("boss-w2", "boss")]);
    expect(groups.map((g) => [g.agent.name, g.children.map((c) => c.name)])).toEqual([
      ["boss", ["boss-w1", "boss-w2"]],
      ["claude", []],
      ["ghost-w1", []],
    ]);
  });
});

describe("issuedNames", () => {
  it("그 발급자가 발급한 이름만", () => {
    const list = [agent("boss"), agent("boss-w1", "boss"), agent("a"), agent("a-x", "a"), agent("boss-w2", "boss")];
    expect(issuedNames(list, "boss")).toEqual(["boss-w1", "boss-w2"]);
    expect(issuedNames(list, "boss-w1")).toEqual([]);
  });
});

describe("unconfirmedRemoved", () => {
  it("확인 문구에 없던 이름만 돌려준다", () => {
    expect(unconfirmedRemoved(["boss-w1", "boss-w2"], ["boss-w1"])).toEqual(["boss-w2"]);
    expect(unconfirmedRemoved(["boss-w1"], ["boss-w1"])).toEqual([]);
    expect(unconfirmedRemoved([], [])).toEqual([]);
  });
});
