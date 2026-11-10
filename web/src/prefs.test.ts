import { describe, expect, it } from "vitest";
import { validPref } from "./prefs";

describe("validPref", () => {
  it("theme: 셋 또는 패키지 id", () => {
    for (const v of ["system", "light", "dark", "@me/sea", "@keyring/paper-2"]) expect(validPref("theme", v)).toBe(v);
  });

  it("theme: 잘못된 꼴은 버린다(손으로 고친 공통 설정)", () => {
    for (const v of ["@../x", "@Me/Sea", "blue", "@me/sea@1", "", 3, null, { id: "@me/sea" }]) expect(validPref("theme", v), String(v)).toBeUndefined();
  });

  it("다른 열거 값은 그대로 검사", () => {
    expect(validPref("editorFont", "mono")).toBe("mono");
    expect(validPref("editorFont", "@me/sea")).toBeUndefined();
  });
});
