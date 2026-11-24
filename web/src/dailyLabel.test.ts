import { describe, expect, it } from "vitest";
import type { DailyNote } from "@keyring-notes/core";
import { dailyLabel, dailySearchLabel } from "./dailyLabel";

const now = new Date(2026, 10, 24);
const note = (datePart: string, title = "", sep = ""): DailyNote => {
  const [y, m, d] = datePart.split("-").map(Number);
  return { path: `daily/${datePart}${sep}${title}.md`, date: new Date(y, m - 1, d), ymd: datePart, datePart, title, sep };
};

describe("데일리 노트 라벨", () => {
  it("제목 없음 + 읽기 좋은 날짜: 날짜만 읽기 좋게, 툴팁은 원래 날짜", () => {
    expect(dailyLabel(note("2026-11-05"), { friendly: true, now, lang: "ko" })).toEqual({ date: "11월 5일 (목)", tip: "2026-11-05", title: null, sep: "" });
  });

  it("제목 있음 + 읽기 좋은 날짜: 날짜는 읽기 좋게, 제목은 그대로, 툴팁은 원래 날짜", () => {
    expect(dailyLabel(note("2026-11-11", "농협 회의", " "), { friendly: true, now, lang: "ko" })).toEqual({
      date: "11월 11일 (수)",
      tip: "2026-11-11",
      title: "농협 회의",
      sep: " ",
    });
  });

  it("구분 글자가 있으면 양옆에 빈칸을 두고 그대로 둔다", () => {
    expect(dailyLabel(note("2026-11-11", "회의", "_-_"), { friendly: true, now, lang: "ko" }).sep).toBe(" _-_ ");
    expect(dailyLabel(note("2026-11-11", "회의", "-"), { friendly: false, now, lang: "ko" }).sep).toBe(" - ");
  });

  it("설정이 꺼져 있거나 plain 이면 파일 이름의 날짜 그대로, 툴팁 없음", () => {
    const d = note("2026-11-11", "농협 회의", " ");
    expect(dailyLabel(d, { friendly: false, now, lang: "ko" })).toEqual({ date: "2026-11-11", tip: null, title: "농협 회의", sep: " " });
    expect(dailyLabel(d, { friendly: true, plain: true, now, lang: "ko" })).toEqual({ date: "2026-11-11", tip: null, title: "농협 회의", sep: " " });
    expect(dailyLabel(note("2026-11-05"), { friendly: true, plain: true, now, lang: "ko" }).date).toBe("2026-11-05");
  });

  it("빠른 열기 검색 글: 제목이 있어도 읽기 좋은 날짜를 덧붙인다", () => {
    expect(dailySearchLabel("2026-11-11 농협 회의", note("2026-11-11", "농협 회의", " "), { friendly: true, now, lang: "ko" })).toBe(
      "2026-11-11 농협 회의 11월 11일 (수)",
    );
    expect(dailySearchLabel("2026-11-05", note("2026-11-05"), { friendly: true, now, lang: "ko" })).toBe("2026-11-05 11월 5일 (목)");
    expect(dailySearchLabel("2026-11-11 농협 회의", note("2026-11-11", "농협 회의", " "), { friendly: false, now, lang: "ko" })).toBe("2026-11-11 농협 회의");
  });
});
