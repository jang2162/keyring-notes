import { Check } from "lucide-react";
import { beforeEach, describe, expect, it } from "vitest";
import { setLanguage } from "./i18n";
import { folderMenuItem } from "./Tree";
import { menuItemRole } from "./ui";

describe("「폴더로 쓰기」 메뉴 항목", () => {
  beforeEach(() => setLanguage("ko"));

  it("켜져 있으면 checked(보조기기에 aria-checked 로 전해진다)와 체크 아이콘, 고르면 끈다", () => {
    let got: boolean | null = null;
    const it = folderMenuItem(true, false, (on) => (got = on));
    expect(it).toMatchObject({ label: "폴더로 쓰기", checked: true, icon: Check });
    expect(it.disabled).toBeUndefined();
    expect(menuItemRole(it)).toBe("menuitemcheckbox");
    it.run();
    expect(got).toBe(false);
  });

  it("꺼져 있으면 checked false(체크형 항목 그대로), 아이콘 없음, 고르면 켠다", () => {
    let got: boolean | null = null;
    const it = folderMenuItem(false, false, (on) => (got = on));
    expect(it.checked).toBe(false);
    expect(menuItemRole(it)).toBe("menuitemcheckbox");
    expect(it.icon).toBeUndefined();
    it.run();
    expect(got).toBe(true);
  });

  it("못 바꾸는 노트면 꺼진 항목", () => {
    expect(folderMenuItem(false, true, () => undefined).disabled).toBe(true);
  });
});

describe("메뉴 항목의 역할", () => {
  it("checked 가 없으면 menuitem, checkKind 없이 checked 면 menuitemradio(워크스페이스 전환)", () => {
    expect(menuItemRole({})).toBe("menuitem");
    expect(menuItemRole({ checked: true })).toBe("menuitemradio");
    expect(menuItemRole({ checked: false, checkKind: "checkbox" })).toBe("menuitemcheckbox");
  });
});
