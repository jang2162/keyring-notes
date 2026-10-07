/**
 * 템플릿 변수와 날짜 형식(데일리 노트·템플릿 넣기). Obsidian 핵심 플러그인과 같은 꼴:
 *   {{title}}  {{date}}  {{time}}  {{date:YYYY년 M월 D일 dddd}}  {{yesterday}}  {{tomorrow}}
 * 날짜 형식은 daily.ts의 formatDate(주차 W·WW, 주 기준 연도 GGGG, 월 이름 MMMM 포함).
 */
import { formatDate, shiftDays, type WeekStart } from "./daily.js";
import type { VaultLang } from "./vaultText.js";

export interface TemplateContext {
  title: string;
  /** 기준 시각(데일리 노트면 그 날) */
  date: Date;
  /** {{date}}의 기본 형식 */
  dateFormat?: string;
  timeFormat?: string;
  /** 주차 토큰(W·WW·GGGG)의 주 시작 요일 */
  weekStart?: WeekStart;
  /** 볼트 언어(월·요일 이름) */
  lang?: VaultLang;
}

/** 템플릿 원문의 변수를 채운다. 모르는 변수는 그대로 둔다. */
export function applyTemplate(template: string, ctx: TemplateContext): string {
  const df = ctx.dateFormat ?? "YYYY-MM-DD";
  const tf = ctx.timeFormat ?? "HH:mm";
  const o = { weekStart: ctx.weekStart, lang: ctx.lang };
  return template.replace(/\{\{\s*(title|date|time|yesterday|tomorrow)\s*(?::([^}]*))?\}\}/g, (_all, name: string, fmt: string | undefined) => {
    switch (name) {
      case "title":
        return ctx.title;
      case "date":
        return formatDate(ctx.date, fmt?.trim() || df, o);
      case "time":
        return formatDate(ctx.date, fmt?.trim() || tf, o);
      case "yesterday":
        return formatDate(shiftDays(ctx.date, -1), fmt?.trim() || df, o);
      default:
        return formatDate(shiftDays(ctx.date, 1), fmt?.trim() || df, o);
    }
  });
}
