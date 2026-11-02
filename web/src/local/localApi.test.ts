import { LocalVault, MemoryStore } from "@keyring-notes/core";
import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { createLocalApi } from "./localApi";

describe("로컬 볼트 노드 삭제", () => {
  it("미리 읽은 해시를 볼트에 넘겨, 그 사이 바뀌었으면 서버처럼 409 로 지우지 않는다", async () => {
    const store = new MemoryStore();
    store.touch("N.md", "노드");
    const vault = new LocalVault(store, { author: "A" });
    await vault.open();
    const api = createLocalApi(vault);
    const stale = (await api.read("N.md")).hash;
    await vault.write("N.md", "그 사이 고친 글", stale);
    const err = await api.deleteNode("N", [{ path: "N.md", hash: stale }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect(await store.read("N.md")).not.toBeNull();
    await api.deleteNode("N", [{ path: "N.md", hash: (await api.read("N.md")).hash }]);
    expect(await store.read("N.md")).toBeNull();
  });
});
