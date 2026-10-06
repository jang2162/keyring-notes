/**
 * 템플릿 변수와 날짜 형식(데일리 노트·템플릿 넣기). Obsidian 핵심 플러그인과 같은 꼴:
 *   {{title}}  {{date}}  {{time}}  {{date:YYYY년 M월 D일 dddd}}  {{yesterday}}  {{tomorrow}}
 * 날짜 형식: YYYY YY M MM D DD H HH m mm s ss ddd(월) dddd(월요일)
 */
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function formatDate(d: Date, format: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return format.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s|dddd|ddd|\[([^\]]*)\]/g, (tok, lit: string | undefined) => {
    if (lit !== undefined) return lit; // [글자]는 그대로
    switch (tok) {
      case "YYYY":
        return String(d.getFullYear());
      case "YY":
        return String(d.getFullYear()).slice(-2);
      case "MM":
        return pad(d.getMonth() + 1);
      case "M":
        return String(d.getMonth() + 1);
      case "DD":
        return pad(d.getDate());
      case "D":
        return String(d.getDate());
      case "HH":
        return pad(d.getHours());
      case "H":
        return String(d.getHours());
      case "mm":
        return pad(d.getMinutes());
      case "m":
        return String(d.getMinutes());
      case "ss":
        return pad(d.getSeconds());
      case "s":
        return String(d.getSeconds());
      case "dddd":
        return `${DAYS[d.getDay()]}요일`;
      case "ddd":
        return DAYS[d.getDay()];
    }
    return tok;
  });
}

function shiftDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export interface TemplateContext {
  title: string;
  /** 기준 시각(데일리 노트면 그 날) */
  date: Date;
  /** {{date}}의 기본 형식 */
  dateFormat?: string;
  timeFormat?: string;
}

/** 템플릿 원문의 변수를 채운다. 모르는 변수는 그대로 둔다. */
export function applyTemplate(template: string, ctx: TemplateContext): string {
  const df = ctx.dateFormat ?? "YYYY-MM-DD";
  const tf = ctx.timeFormat ?? "HH:mm";
  return template.replace(/\{\{\s*(title|date|time|yesterday|tomorrow)\s*(?::([^}]*))?\}\}/g, (_all, name: string, fmt: string | undefined) => {
    switch (name) {
      case "title":
        return ctx.title;
      case "date":
        return formatDate(ctx.date, fmt?.trim() || df);
      case "time":
        return formatDate(ctx.date, fmt?.trim() || tf);
      case "yesterday":
        return formatDate(shiftDays(ctx.date, -1), fmt?.trim() || df);
      default:
        return formatDate(shiftDays(ctx.date, 1), fmt?.trim() || df);
    }
  });
}

/** 데일리 노트 경로: 폴더 + 형식(형식에 /가 있으면 하위 폴더, 예: YYYY/MM/YYYY-MM-DD) */
export function dailyNotePath(folder: string, format: string, d: Date): string {
  const name = formatDate(d, format || "YYYY-MM-DD").replace(/^\/+|\/+$/g, "");
  const dir = folder.trim().replace(/^\/+|\/+$/g, "");
  return `${dir ? `${dir}/` : ""}${name}.md`;
}
