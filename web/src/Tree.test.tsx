import { Check } from "lucide-react";
import { beforeEach, describe, expect, it } from "vitest";
import { setLanguage } from "./i18n";
import { folderMenuItem } from "./Tree";

describe("「폴더로 쓰기」 메뉴 항목", () => {
  beforeEach(() => setLanguage("ko"));

  it("켜져 있으면 checked(보조기기에 aria-checked 로 전해진다)와 체크 아이콘, 고르면 끈다", () => {
    let got: boolean | null = null;
    const it = folderMenuItem(true, false, (on) => (got = on));
    expect(it).toMatchObject({ label: "폴더로 쓰기", checked: true, icon: Check });
    expect(it.disabled).toBeUndefined();
    it.run();
    expect(got).toBe(false);
  });

  it("꺼져 있으면 checked false(체크형 항목 그대로), 아이콘 없음, 고르면 켠다", () => {
    let got: boolean | null = null;
    const it = folderMenuItem(false, false, (on) => (got = on));
    expect(it.checked).toBe(false);
    expect(it.icon).toBeUndefined();
    it.run();
    expect(got).toBe(true);
  });

  it("못 바꾸는 노트면 꺼진 항목", () => {
    expect(folderMenuItem(false, true, () => undefined).disabled).toBe(true);
  });
});
