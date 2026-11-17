// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachmentMenu, AttachmentList, type AttachmentMenuActions } from "./Attachments";
import { setLanguage, t } from "./i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "W/_첨부/그림.png";
const spies = () => ({ openAttachment: vi.fn(), replace: vi.fn(), remove: vi.fn() }) satisfies AttachmentMenuActions;

beforeEach(() => setLanguage("en"));

describe("「파일」 패널 항목 메뉴", () => {
  it("열기 · 내용 바꾸기… · 삭제(danger) 순서, 트리의 파일 줄 메뉴와 같은 이름", () => {
    const items = attachmentMenu(PATH, spies());
    expect(items.map((it) => (it === "-" ? "-" : it.label))).toEqual([t("common.open"), "-", t("file.replace"), "-", t("common.delete")]);
    const del = items.at(-1);
    expect(del !== "-" && del?.danger).toBe(true);
  });

  it('각 항목은 트리 동작을 그 경로로 부른다(삭제는 remove(path, "file"))', () => {
    const a = spies();
    for (const it of attachmentMenu(PATH, a)) if (it !== "-") it.run();
    expect(a.openAttachment).toHaveBeenCalledWith(PATH);
    expect(a.replace).toHaveBeenCalledWith(PATH);
    expect(a.remove).toHaveBeenCalledWith(PATH, "file");
  });
});

describe("「파일」 패널에서 메뉴 띄우기", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const draw = (actions?: AttachmentMenuActions) =>
    act(() => root.render(<AttachmentList paths={[PATH, "W/다른.pdf"]} embedText={(p) => p} onOpen={() => undefined} actions={actions} />));
  const item = (name: string) => [...host.querySelectorAll<HTMLElement>(".attachment-item")].find((el) => el.textContent?.includes(name))!;
  const menuButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".menu .menu-item")].find((b) => b.textContent === label);

  it("오른쪽 클릭 → 메뉴 → 「삭제」 가 트리의 remove 를 그 첨부 경로로 부른다", () => {
    const a = spies();
    draw(a);
    act(() => void item("그림.png").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 })));
    expect(document.querySelector(".menu")).not.toBeNull();
    act(() => menuButton(t("common.delete"))!.click());
    expect(a.remove).toHaveBeenCalledWith(PATH, "file");
    expect(a.remove).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".menu")).toBeNull();
  });

  it("메뉴 키로도 열린다(트리와 같이)", () => {
    const a = spies();
    draw(a);
    act(() => void item("다른.pdf").dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true })));
    act(() => menuButton(t("file.replace"))!.click());
    expect(a.replace).toHaveBeenCalledWith("W/다른.pdf");
  });

  it("동작을 안 넘기면 메뉴를 띄우지 않고 브라우저 기본 메뉴를 막지 않는다", () => {
    draw(undefined);
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => void item("그림.png").dispatchEvent(ev));
    expect(document.querySelector(".menu")).toBeNull();
    expect(ev.defaultPrevented).toBe(false);
  });
});
