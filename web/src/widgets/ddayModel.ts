import type { WidgetDefinition } from "./types";

/**
 * 내장 위젯 D-day 의 순수 부분. 정의는 앱 묶음에 늘 실리고, 그리는 코드(inline/dday.ts)만 처음 쓸 때 불러온다.
 */

/** targetDate: YYYY-MM-DD(지역 날짜) */
export interface DdayState {
  targetDate: string;
  label: string;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD → UTC 자정 ms. 없는 날짜(2월 30일 등)는 null */
function utcDay(s: string): number | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
}

/** target − today(일). 날짜 차는 UTC 로 잰다 — 지역 시간 자정 차는 서머타임에 23·25시간이 된다 */
export function ddayCount(target: string, today: string): number | null {
  const a = utcDay(target);
  const b = utcDay(today);
  return a === null || b === null ? null : Math.round((a - b) / 86_400_000);
}

/** 3 → "D-3", 0 → "D-day", -2 → "D+2", null → "" */
export function ddayText(n: number | null): string {
  if (n === null) return "";
  if (n === 0) return "D-day";
  return n > 0 ? `D-${n}` : `D+${-n}`;
}

/** 지역 시간의 YYYY-MM-DD */
export function todayLocal(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const ddayDef: WidgetDefinition = {
  id: "keyring/dday",
  version: 1,
  isolation: "inline",
  display: "inline",
  defaultState: (): DdayState => ({ targetDate: todayLocal(new Date()), label: "" }),
  title: { en: "D-day", ko: "D-day" },
};
