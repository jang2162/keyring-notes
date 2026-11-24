// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipLayer } from "./Tooltip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tip = () => document.querySelector('[role="tooltip"]');
const fire = (el: Element, type: string, init: PointerEventInit = {}) =>
  act(() => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse", ...init }));
  });

describe("툴팁과 메뉴", () => {
  let host: HTMLElement;
  let root: Root;
  let button: HTMLButtonElement;
  let inner: HTMLSpanElement;
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    // 워크스페이스 전환기처럼 단추 안에 자식이 여럿이다 — 단추 안에서 움직여도 pointerover 가 다시 온다
    button = document.createElement("button");
    button.dataset.tip = "개발 프로젝트";
    inner = document.createElement("span");
    inner.textContent = "개발 프로젝트";
    button.append(document.createElement("span"), inner);
    document.body.append(button);
    root = createRoot(host);
    act(() => root.render(<TooltipLayer />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    button.remove();
    document.querySelector('[role="menu"]')?.remove();
    vi.useRealTimers();
  });

  const hoverUntilShown = () => {
    fire(button, "pointerover");
    act(() => vi.advanceTimersByTime(400));
    expect(tip()?.textContent).toBe("개발 프로젝트");
  };

  it("단추를 눌러 메뉴가 열린 뒤 단추 안에서 포인터가 움직여도 툴팁이 다시 뜨지 않는다(메뉴 첫 줄을 덮던 것)", () => {
    hoverUntilShown();
    fire(button, "pointerdown");
    expect(tip()).toBeNull();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    // 숨긴 지 WARM_MS 안이라 예전에는 기다리지 않고 바로 다시 떴다
    fire(inner, "pointerover");
    act(() => vi.advanceTimersByTime(400));
    expect(tip()).toBeNull();
  });

  it("메뉴가 닫히면 다시 뜬다", () => {
    hoverUntilShown();
    fire(button, "pointerdown");
    fire(inner, "pointerover");
    act(() => vi.advanceTimersByTime(400));
    expect(tip()?.textContent).toBe("개발 프로젝트");
  });

  it("누른 채로 단추 위를 지나가면 띄우지 않는다", () => {
    hoverUntilShown();
    fire(button, "pointerdown");
    fire(inner, "pointerover", { buttons: 1 });
    act(() => vi.advanceTimersByTime(400));
    expect(tip()).toBeNull();
  });
});
