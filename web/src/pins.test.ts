import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addPin, dropWorkspacePins, getPins, movePins, pinExists, removePin, restoreWorkspacePins, shownPins, updatePins } from "./pins";

describe("고정 넣기·빼기", () => {
  it("새로 고정한 것은 끝에, 이미 있으면 자리를 바꾸지 않는다", () => {
    expect(addPin(["W/a"], "W/b")).toEqual(["W/a", "W/b"]);
    const pins = ["W/a", "W/b"];
    expect(addPin(pins, "W/a")).toBe(pins);
  });

  it("고정 해제는 그것만 뺀다", () => {
    expect(removePin(["W/a", "W/b", "W/c"], "W/b")).toEqual(["W/a", "W/c"]);
    const pins = ["W/a"];
    expect(removePin(pins, "W/x")).toBe(pins);
  });
});

describe("이동·이름 바꾸기를 따라간다", () => {
  it("노트 이름 바꾸기: 그 노드의 고정이 새 이름으로(자리는 그대로)", () => {
    expect(movePins(["W/a", "W/b", "W/c"], "W/b", "W/새 이름")).toEqual(["W/a", "W/새 이름", "W/c"]);
  });

  it("노드 이동: 노드와 그 하위의 고정이 함께 옮겨 간다", () => {
    expect(movePins(["W/p", "W/p/q", "W/p/q/r", "W/x"], "W/p", "W/x/p")).toEqual(["W/x/p", "W/x/p/q", "W/x/p/q/r", "W/x"]);
  });

  it("워크스페이스 이름 바꾸기: 그 워크스페이스의 고정이 모두 새 이름 아래로", () => {
    expect(movePins(["W/a", "W/b/c", "V/a"], "W", "R")).toEqual(["R/a", "R/b/c", "V/a"]);
  });

  it("다른 워크스페이스로 옮기면 고정도 그 워크스페이스로 간다", () => {
    expect(movePins(["W/a"], "W/a", "V/a")).toEqual(["V/a"]);
  });

  it("이름이 앞부분만 같은 형제는 건드리지 않는다", () => {
    expect(movePins(["W/ab", "W/a b", "Wx/a"], "W/a", "W/z")).toEqual(["W/ab", "W/a b", "Wx/a"]);
    expect(movePins(["Wx/a"], "W", "R")).toEqual(["Wx/a"]);
  });

  it("노트 파일 하나만 옮긴 것(subtree 끔)은 하위 고정을 그 자리에 둔다", () => {
    expect(movePins(["D/2026-10-01", "D/2026-10-01/메모"], "D/2026-10-01", "D/2026/10/2026-10-01", false)).toEqual([
      "D/2026/10/2026-10-01",
      "D/2026-10-01/메모",
    ]);
  });

  it("옮긴 자리에 이미 고정이 있으면 하나만 남긴다", () => {
    expect(movePins(["W/b", "W/a"], "W/a", "W/b")).toEqual(["W/b"]);
  });

  it("파일마다 정확히 옮긴 뒤 노드째 옮겨도 노드째 한 번 옮긴 것과 같다(moveNodeTo 의 두 번 적용)", () => {
    const pins = ["W/a", "W/a/b", "W/a/c", "W/a/c/d", "W/ab", "W/ab/a", "W/a b", "W/x"];
    // c 는 노트 없는 하위 노드라 옮기는 파일에 없다. 형제 W/ab·W/a b 는 이름 앞부분이 같다
    const files = ["W/a", "W/a/b", "W/a/c/d"];
    for (const [from, to] of [
      ["W/a", "W/a2"],
      ["W/a", "W/ab/a"],
      ["W/a", "V/a"],
      ["W/ab", "W/a/ab"],
    ]) {
      const moved = files.filter((f) => f === from || f.startsWith(from + "/"));
      const once = movePins(pins, from, to);
      for (const order of [moved, [...moved].reverse()]) {
        const perFile = order.reduce((acc, f) => movePins(acc, f, to + f.slice(from.length), false), pins);
        expect(movePins(perFile, from, to)).toEqual(once);
      }
    }
  });

  it("상관없는 이동이면 같은 목록을 돌려준다(저장하지 않는다)", () => {
    const pins = ["W/a"];
    expect(movePins(pins, "W/x", "W/y")).toBe(pins);
    expect(movePins(pins, "W/a", "W/a")).toBe(pins);
  });
});

describe("워크스페이스 삭제가 고정을 걷는다", () => {
  const pins = ["W/a", "V/x", "W/b/c", "Wx/d", "V/y"];

  it("그 워크스페이스의 고정만 걷고 자리를 기억한다", () => {
    const r = dropWorkspacePins(pins, "W");
    expect(r.pins).toEqual(["V/x", "Wx/d", "V/y"]);
    expect(r.saved).toEqual([
      { node: "W/a", index: 0 },
      { node: "W/b/c", index: 2 },
    ]);
  });

  it("되돌리면 원래 자리에 다시 넣는다", () => {
    const r = dropWorkspacePins(pins, "W");
    expect(restoreWorkspacePins(r.pins, r.saved)).toEqual(pins);
  });

  it("그 사이 같은 것을 다시 고정했으면 겹쳐 넣지 않는다", () => {
    const r = dropWorkspacePins(pins, "W");
    expect(restoreWorkspacePins([...r.pins, "W/a"], r.saved)).toEqual(["V/x", "Wx/d", "W/b/c", "V/y", "W/a"]);
  });

  it("고정이 없는 워크스페이스는 목록을 그대로 둔다", () => {
    expect(dropWorkspacePins(pins, "Z").pins).toBe(pins);
  });
});

describe("보이는 고정", () => {
  const all = () => true;

  it("지운 노드는 숨기고, 같은 자리에 되살리면 다시 보인다", () => {
    const pins = ["W/a", "W/b"];
    expect(shownPins(pins, (n) => n !== "W/b", all)).toEqual(["W/a"]);
    expect(shownPins(pins, () => true, all)).toEqual(["W/a", "W/b"]);
  });

  it("지금 워크스페이스의 것만(모든 워크스페이스면 전부)", () => {
    const pins = ["W/a", "V/b", "W/c"];
    expect(
      shownPins(
        pins,
        () => true,
        (n) => n.startsWith("W/"),
      ),
    ).toEqual(["W/a", "W/c"]);
    expect(shownPins(pins, () => true, all)).toEqual(pins);
  });
});

describe("고정한 노드가 있는지", () => {
  const paths = ["W/a.md", "W/p/q.md", "W/ab.md", "W/A b.md"];

  it("노트가 있거나 하위가 있으면 있다", () => {
    expect(pinExists("W/a", paths)).toBe(true);
    expect(pinExists("W/p", paths)).toBe(true);
    expect(pinExists("W/p/q", paths)).toBe(true);
  });

  it("대소문자가 다르면 없다(누르면 옛 대소문자로 열리므로)", () => {
    expect(pinExists("W/A", paths)).toBe(false);
    expect(pinExists("W/P", paths)).toBe(false);
    expect(pinExists("W/a b", paths)).toBe(false);
  });

  it("이름 앞부분만 같은 형제로는 있다고 보지 않는다", () => {
    expect(pinExists("W/A", ["W/Ab.md"])).toBe(false);
    expect(pinExists("W/p", ["W/pq.md", "W/p.mdx"])).toBe(false);
  });
});

describe("이 기기 저장소(keyring:pins)", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("고친 값을 저장하고 다시 읽는다", () => {
    updatePins((p) => addPin(p, "W/a"));
    updatePins((p) => addPin(p, "W/b"));
    expect(JSON.parse(store.get("keyring:pins")!)).toEqual(["W/a", "W/b"]);
    expect(getPins()).toEqual(["W/a", "W/b"]);
  });

  it("다른 창이 저장한 값 위에서 고친다(덮어쓰지 않는다)", () => {
    updatePins((p) => addPin(p, "W/a"));
    store.set("keyring:pins", JSON.stringify(["W/a", "W/다른 창"]));
    updatePins((p) => addPin(p, "W/b"));
    expect(getPins()).toEqual(["W/a", "W/다른 창", "W/b"]);
  });

  it("모양이 틀린 저장값은 빈 목록으로 본다", () => {
    store.set("keyring:pins", JSON.stringify({ W: ["W/a"] }));
    expect(getPins()).toEqual([]);
    store.set("keyring:pins", "{깨짐");
    expect(getPins()).toEqual([]);
  });
});
