// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage, t } from "./i18n";
import { RenderBoundary } from "./RenderBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
let logged: { mock: { calls: unknown[][] }; mockRestore(): void };

beforeEach(() => {
  setLanguage("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // 던진 예외는 React 도 콘솔에 남긴다 — 시험 출력을 가리지 않게 받아 두고, 경계가 남겼는지 본다
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  logged.mockRestore();
});

const draw = (node: ReactNode) => act(() => root.render(node));

/** 내용에 "던짐" 이 있으면 그리다 던지는 자식(렌더러 자리) */
function Body({ text }: { text: string }) {
  if (text.includes("던짐")) throw new URIError("URI malformed");
  return <p className="drawn">{text}</p>;
}
const pane = (path: string, text: string, other = "옆 칸") => (
  <div>
    <aside className="other">{other}</aside>
    <RenderBoundary resetKey={path} source={text}>
      <Body text={text} />
    </RenderBoundary>
  </div>
);

describe("RenderBoundary", () => {
  it("자식이 그려지면 그대로 보인다", () => {
    draw(pane("a.md", "본문"));
    expect(host.querySelector(".drawn")?.textContent).toBe("본문");
    expect(host.querySelector(".render-failed")).toBeNull();
  });

  it("자식이 던지면 안내·원문·다시 시도 단추를 보이고, 경계 밖은 남는다", () => {
    draw(pane("a.md", "# 제목\n던짐 <b>굵게</b>"));
    const box = host.querySelector(".render-failed")!;
    expect(box.querySelector("[role=alert]")?.textContent).toBe(t("doc.renderFailed"));
    expect(box.querySelector("pre")?.textContent).toBe("# 제목\n던짐 <b>굵게</b>");
    // 원문은 글자로만 보인다(HTML 로 풀리지 않는다)
    expect(box.querySelector("pre b")).toBeNull();
    expect(box.querySelector("button")?.textContent).toBe(t("common.retry"));
    expect(host.querySelector(".other")?.textContent).toBe("옆 칸");
    expect(host.querySelector(".drawn")).toBeNull();
  });

  it("예외를 console.error 로 남긴다", () => {
    draw(pane("a.md", "던짐"));
    // React 가 남기는 줄과 가르게, 경계가 붙이는 머리말이 든 줄을 본다
    const mine = logged.mock.calls.filter((args) => args[0] === "keyring: note render failed");
    expect(mine).toHaveLength(1);
    expect(mine[0]![1]).toBeInstanceOf(URIError);
  });

  it("내용이 바뀌면 스스로 풀려 다시 그린다", () => {
    draw(pane("a.md", "던짐"));
    expect(host.querySelector(".render-failed")).not.toBeNull();
    draw(pane("a.md", "고친 본문"));
    expect(host.querySelector(".render-failed")).toBeNull();
    expect(host.querySelector(".drawn")?.textContent).toBe("고친 본문");
  });

  it("경로가 바뀌면 스스로 풀려 다시 그린다", () => {
    let broken = true;
    function Flaky() {
      if (broken) throw new Error("한 번만");
      return <p className="drawn">됨</p>;
    }
    const at = (path: string) => (
      <RenderBoundary resetKey={path} source="같은 글">
        <Flaky />
      </RenderBoundary>
    );
    draw(at("a.md"));
    expect(host.querySelector(".render-failed")).not.toBeNull();
    broken = false;
    // 경로도 내용도 같으면 풀리지 않는다 — 부모가 다시 그릴 때마다 실패한 렌더를 되풀이하지 않게
    draw(at("a.md"));
    expect(host.querySelector(".render-failed")).not.toBeNull();
    draw(at("b.md"));
    expect(host.querySelector(".drawn")?.textContent).toBe("됨");
  });

  it("바뀐 내용도 던지면 새 원문으로 대체 화면을 다시 보인다", () => {
    draw(pane("a.md", "던짐 1"));
    draw(pane("a.md", "던짐 2"));
    expect(host.querySelector(".render-failed pre")?.textContent).toBe("던짐 2");
  });

  it("다시 시도 단추를 누르면 다시 그려 본다", () => {
    let broken = true;
    function Flaky() {
      if (broken) throw new Error("한 번만");
      return <p className="drawn">됨</p>;
    }
    draw(
      <RenderBoundary resetKey="a" source="원문">
        <Flaky />
      </RenderBoundary>,
    );
    const button = host.querySelector<HTMLButtonElement>(".render-failed button")!;
    // 아직 던지면 대체 화면이 그대로다
    act(() => button.click());
    expect(host.querySelector(".render-failed")).not.toBeNull();
    broken = false;
    act(() => host.querySelector<HTMLButtonElement>(".render-failed button")!.click());
    expect(host.querySelector(".render-failed")).toBeNull();
    expect(host.querySelector(".drawn")?.textContent).toBe("됨");
  });

  it("자식의 effect 가 던져도 대체 화면으로 떨어진다", async () => {
    const { useEffect } = await import("react");
    function Late() {
      useEffect(() => {
        throw new Error("effect 에서");
      }, []);
      return <p className="drawn">그려짐</p>;
    }
    draw(
      <RenderBoundary resetKey="a" source="원문">
        <Late />
      </RenderBoundary>,
    );
    expect(host.querySelector(".render-failed pre")?.textContent).toBe("원문");
  });
});
