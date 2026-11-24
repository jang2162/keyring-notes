import { friendlyDate, type DailyNote } from "@keyring-notes/core";

export interface DailyLabelOpts {
  /** 「읽기 좋은 날짜」 설정 */
  friendly: boolean;
  /** 파일 이름 그대로(고정 목록 등) */
  plain?: boolean;
  now?: Date;
  lang: string;
}

export interface DailyLabelParts {
  /** 보일 날짜: 읽기 좋은 날짜이거나 파일 이름의 날짜 그대로 */
  date: string;
  /** 읽기 좋은 날짜로 바꿨을 때만 원래 날짜(툴팁) */
  tip: string | null;
  /** 날짜 뒤 제목(없으면 null) */
  title: string | null;
  /** 날짜와 제목 사이에 넣을 글. 구분 글자가 있으면 양옆에 빈칸 */
  sep: string;
}

/** 데일리 노트 라벨 조각. 제목이 있어도 설정이 켜져 있으면 날짜 부분을 읽기 좋은 날짜로 보인다 */
export function dailyLabel(d: DailyNote, opts: DailyLabelOpts): DailyLabelParts {
  const friendly = opts.friendly && !opts.plain;
  const sep = d.sep.trim();
  return {
    date: friendly ? friendlyDate(d.date, opts.now ?? new Date(), opts.lang) : d.datePart,
    tip: friendly ? d.datePart : null,
    title: d.title || null,
    sep: d.title ? (sep ? ` ${sep} ` : " ") : "",
  };
}

/** 빠른 열기 검색 글: 파일 이름에 읽기 좋은 날짜를 덧붙여 그 날짜로도 찾게 한다 */
export function dailySearchLabel(stem: string, d: DailyNote, opts: DailyLabelOpts): string {
  return opts.friendly ? `${stem} ${friendlyDate(d.date, opts.now ?? new Date(), opts.lang)}` : stem;
}
