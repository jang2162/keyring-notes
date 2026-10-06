import { describe, expect, it } from "vitest";
import { applyTemplate, dailyNotePath, formatDate } from "../src/index.js";

describe("템플릿", () => {
  const d = new Date(2026, 9, 6, 9, 5, 7); // 2026-10-06 화 09:05:07
  it("날짜 형식", () => {
    expect(formatDate(d, "YYYY-MM-DD")).toBe("2026-10-06");
    expect(formatDate(d, "YYYY년 M월 D일 dddd")).toBe("2026년 10월 6일 화요일");
    expect(formatDate(d, "YY.MM.DD (ddd) HH:mm:ss")).toBe("26.10.06 (화) 09:05:07");
    expect(formatDate(d, "[W]YYYY")).toBe("W2026");
  });
  it("변수 채우기", () => {
    const t = "# {{title}}\n{{date}} {{time}} · {{date:M/D}}\n← [[{{yesterday}}]] [[{{tomorrow}}]] {{모름}}";
    expect(applyTemplate(t, { title: "회의", date: d })).toBe("# 회의\n2026-10-06 09:05 · 10/6\n← [[2026-10-05]] [[2026-10-07]] {{모름}}");
  });
  it("데일리 노트 경로", () => {
    expect(dailyNotePath("일기", "YYYY-MM-DD", d)).toBe("일기/2026-10-06.md");
    expect(dailyNotePath("/일기/", "YYYY/MM/YYYY-MM-DD", d)).toBe("일기/2026/10/2026-10-06.md");
    expect(dailyNotePath("", "YYYY-MM-DD", d)).toBe("2026-10-06.md");
  });
});
