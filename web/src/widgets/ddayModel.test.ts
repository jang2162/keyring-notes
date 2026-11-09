import { describe, expect, it } from "vitest";
import { parseWidgetBlock } from "@keyring-notes/core";
import { ddayCount, ddayDef, ddayText, todayLocal } from "./ddayModel";
import { widgetInsertText } from "./registry";

describe("D-day 모델", () => {
  it("ddayCount", () => {
    expect(ddayCount("2026-12-25", "2026-12-22")).toBe(3);
    expect(ddayCount("2026-12-22", "2026-12-22")).toBe(0);
    expect(ddayCount("2026-12-20", "2026-12-22")).toBe(-2);
    // 서머타임이 끼는 구간(지역 시간 자정 차는 23·25시간이 된다)
    expect(ddayCount("2026-03-30", "2026-03-28")).toBe(2);
    expect(ddayCount("2026-03-09", "2026-03-07")).toBe(2);
    expect(ddayCount("2026-11-02", "2026-10-31")).toBe(2);
    expect(ddayCount("2028-03-01", "2028-02-28")).toBe(2);
    expect(ddayCount("2027-03-01", "2027-02-28")).toBe(1);
  });

  it("잘못된 날짜는 null", () => {
    for (const bad of ["2026-02-30", "", "2026-1-5", "2026-13-01", "abcd-ef-gh", "2026-12-25T00:00"]) {
      expect(ddayCount(bad, "2026-12-22"), bad).toBeNull();
      expect(ddayCount("2026-12-22", bad), bad).toBeNull();
    }
  });

  it("ddayText", () => {
    expect(ddayText(3)).toBe("D-3");
    expect(ddayText(0)).toBe("D-day");
    expect(ddayText(-2)).toBe("D+2");
    expect(ddayText(null)).toBe("");
  });

  it("todayLocal 은 지역 시간 날짜", () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(todayLocal(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });

  it("정의", () => {
    expect(ddayDef).toMatchObject({ id: "keyring/dday", version: 1, isolation: "inline", display: "inline", title: { en: "D-day", ko: "D-day" } });
    const st = ddayDef.defaultState() as { targetDate: string; label: string };
    expect(st).toEqual({ targetDate: todayLocal(new Date()), label: "" });
    const text = widgetInsertText(ddayDef);
    const body = text.slice(text.indexOf("\n") + 1, text.lastIndexOf("\n"));
    expect(parseWidgetBlock(body).ok).toBe(true);
  });
});
