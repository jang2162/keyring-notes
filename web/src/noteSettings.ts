/** 데일리 노트·템플릿 설정(이 기기에 둔다) */
export interface NoteSettings {
  dailyFolder: string;
  /** 파일 이름 형식(/가 있으면 하위 폴더) */
  dailyFormat: string;
  /** 데일리 노트 템플릿 문서 경로(없으면 "# 날짜") */
  dailyTemplate: string;
  /** 템플릿 폴더: 이 아래 문서가 "템플릿 넣기" 목록에 나온다 */
  templateFolder: string;
}

const KEY = "keyring:note-settings";
export const DEFAULT_NOTE_SETTINGS: NoteSettings = { dailyFolder: "일기", dailyFormat: "YYYY-MM-DD", dailyTemplate: "템플릿/데일리.md", templateFolder: "템플릿" };

export function loadNoteSettings(): NoteSettings {
  try {
    return { ...DEFAULT_NOTE_SETTINGS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<NoteSettings>) };
  } catch {
    return DEFAULT_NOTE_SETTINGS;
  }
}

export function saveNoteSettings(s: NoteSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}
