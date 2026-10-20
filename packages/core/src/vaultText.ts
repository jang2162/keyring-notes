/**
 * 볼트에 남는 글(파일 이름·폴더 이름·자동 생성 문서·커밋 메시지·요일 토큰)의 언어.
 * 화면 언어와 따로, 공통 설정의 "볼트 언어"를 따른다(기기마다 화면 언어가 달라도 같은 이름이 나오게).
 * 공식 언어는 영어(기준)·한국어. 모르는 언어면 영어로 쓴다.
 */
export type VaultLang = "en" | "ko";

export const VAULT_LANGS: VaultLang[] = ["en", "ko"];

export function vaultLangOf(v: unknown): VaultLang {
  return typeof v === "string" && v.toLowerCase().startsWith("ko") ? "ko" : "en";
}

export interface VaultText {
  untitled: string;
  /** 동기화 충돌 사본·오프라인 충돌 사본·저장 충돌 사본 이름에 붙는 말 */
  syncConflictCopy: string;
  offlineConflictCopy: string;
  conflictCopy: string;
  /** 복제한 문서 이름 뒤 */
  copySuffix: string;
  pastedImage: string;
  attachmentName: string;
  /** 워크스페이스 기본 폴더(워크스페이스 기준) */
  dailyFolder: string;
  templateFolder: string;
  dailyTemplate: string;
  attachmentFolder: string;
  /** 데일리 노트 자동 태그의 맨 앞(데일리/2026/10/07) */
  dailyTag: string;
  /** 요일(일요일부터) 짧은·긴 이름 */
  weekdaysShort: string[];
  weekdaysLong: string[];
  /** 월 이름(MMMM 토큰, 1월부터) */
  months: string[];
  /** 커밋 메시지(작업 기록) */
  commit: {
    create: (p: string) => string;
    modify: (p: string) => string;
    append: (p: string) => string;
    delete: (p: string) => string;
    move: (a: string, b: string) => string;
    attach: (p: string) => string;
    batch: (n: number) => string;
    linkUpdate: (p: string) => string;
    nodeMove: (a: string, b: string) => string;
    nodeDelete: (p: string) => string;
    restore: (p: string, rev: string) => string;
    /** 휴지통에서 되살리기 */
    restoreDeleted: (p: string) => string;
    outside: string;
    excludeGenerated: string;
    createTopic: (t: string) => string;
    ingest: (title: string) => string;
    appOutside: string;
    appBaseline: string;
    syncPulled: string;
    syncMerged: string;
    task: (done: boolean, p: string) => string;
    dailyMigrate: (n: number) => string;
    /** 변경 제안의 기본 메시지 */
    proposal: (n: number) => string;
    /** 승인한 제안의 커밋 본문 줄 */
    approved: (approver: string, id: string) => string;
  };
  /** 원본 수집으로 만드는 노트 안의 글 */
  ingest: {
    webClip: string;
    notConverted: string;
    source: string;
    originalFile: string;
    page: (n: number) => string;
    noText: string;
    /** PDF 짝 노트의 주석 절 제목 */
    pdfNotes: string;
  };
  /** 공통 설정 파일 본문 안내 */
  settingsBody: string;
}

const EN: VaultText = {
  untitled: "Untitled",
  syncConflictCopy: "sync conflict copy",
  offlineConflictCopy: "offline conflict copy",
  conflictCopy: "conflict copy",
  copySuffix: "copy",
  pastedImage: "Pasted image",
  attachmentName: "Attachment",
  dailyFolder: "Daily",
  templateFolder: "Templates",
  dailyTemplate: "Templates/Daily.md",
  attachmentFolder: "_attachments",
  dailyTag: "daily",
  weekdaysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  weekdaysLong: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  commit: {
    create: (p) => `Create: ${p}`,
    modify: (p) => `Edit: ${p}`,
    append: (p) => `Append: ${p}`,
    delete: (p) => `Delete: ${p}`,
    move: (a, b) => `Move: ${a} → ${b}`,
    attach: (p) => `Attach: ${p}`,
    batch: (n) => `Batch change (${n})`,
    linkUpdate: (p) => `Links updated: ${p}`,
    nodeMove: (a, b) => `Move node: ${a} → ${b}`,
    nodeDelete: (p) => `Delete node: ${p}`,
    restore: (p, rev) => `Restore: ${p} @ ${rev}`,
    restoreDeleted: (p) => `Restore from trash: ${p}`,
    outside: "Record changes made outside the server",
    excludeGenerated: "Exclude generated documents from history",
    createTopic: (t) => `Create wiki topic: ${t}`,
    ingest: (t) => `Ingest: ${t}`,
    appOutside: "Record changes made outside the app",
    appBaseline: "Existing content",
    syncPulled: "Sync: received from server",
    syncMerged: "Sync: merged automatically (changes from this device and the server)",
    task: (done, p) => `Task ${done ? "done" : "reopened"}: ${p}`,
    dailyMigrate: (n) => `Move daily notes to the new format (${n})`,
    proposal: (n) => `${n} change${n === 1 ? "" : "s"}`,
    approved: (a, id) => `Approved: ${a} (proposal ${id})`,
  },
  ingest: {
    webClip: "Web clip",
    notConverted: "_This format could not be converted to Markdown. Open the original file._",
    source: "Source",
    originalFile: "Original file",
    page: (n) => `Page ${n}`,
    noText: "(no text)",
    pdfNotes: "PDF annotations",
  },
  settingsBody: `
# Keyring Notes settings

Settings shared by every device (web, apps, server). Change them in the app's **Settings** screen.
You can edit this file directly, but keep the property names in the frontmatter above. This document does not appear in the tree or search.
`,
};

const KO: VaultText = {
  untitled: "제목 없음",
  syncConflictCopy: "동기화 충돌 사본",
  offlineConflictCopy: "오프라인 충돌 사본",
  conflictCopy: "충돌 사본",
  copySuffix: "사본",
  pastedImage: "붙여넣은 이미지",
  attachmentName: "첨부",
  dailyFolder: "데일리 노트",
  templateFolder: "템플릿",
  dailyTemplate: "템플릿/데일리.md",
  attachmentFolder: "_첨부",
  dailyTag: "데일리",
  weekdaysShort: ["일", "월", "화", "수", "목", "금", "토"],
  weekdaysLong: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"],
  months: Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
  commit: {
    create: (p) => `생성: ${p}`,
    modify: (p) => `수정: ${p}`,
    append: (p) => `덧붙임: ${p}`,
    delete: (p) => `삭제: ${p}`,
    move: (a, b) => `이동: ${a} → ${b}`,
    attach: (p) => `첨부: ${p}`,
    batch: (n) => `일괄 변경 ${n}건`,
    linkUpdate: (p) => `링크 갱신: ${p}`,
    nodeMove: (a, b) => `노드 이동: ${a} → ${b}`,
    nodeDelete: (p) => `노드 삭제: ${p}`,
    restore: (p, rev) => `되돌리기: ${p} @ ${rev}`,
    restoreDeleted: (p) => `휴지통에서 되살리기: ${p}`,
    outside: "서버 밖에서 생긴 변경 반영",
    excludeGenerated: "자동 생성 문서를 이력에서 제외",
    createTopic: (t) => `위키 토픽 만들기: ${t}`,
    ingest: (t) => `수집: ${t}`,
    appOutside: "앱 밖에서 생긴 변경 반영",
    appBaseline: "기존 내용",
    syncPulled: "동기화: 서버에서 받음",
    syncMerged: "동기화: 자동 병합(이 기기와 서버의 변경을 합침)",
    task: (done, p) => `할 일 ${done ? "완료" : "되돌림"}: ${p}`,
    dailyMigrate: (n) => `데일리 노트 형식 옮기기(${n}개)`,
    proposal: (n) => `변경 ${n}건`,
    approved: (a, id) => `승인: ${a} (제안 ${id})`,
  },
  ingest: {
    webClip: "웹 클립",
    notConverted: "_이 형식은 마크다운으로 바꾸지 못했다. 원본 파일을 열어 볼 것._",
    source: "원문",
    originalFile: "원본 파일",
    page: (n) => `${n}쪽`,
    noText: "(텍스트 없음)",
    pdfNotes: "PDF 주석",
  },
  settingsBody: `
# Keyring Notes 설정

모든 기기(웹·앱·서버)가 같이 쓰는 설정입니다. 앱의 **설정** 화면에서 고치세요.
직접 고쳐도 되지만 위 프런트매터의 이름은 바꾸지 마세요. 이 문서는 트리·검색에는 나오지 않습니다.
`,
};

export function vaultText(lang: VaultLang | string | null | undefined): VaultText {
  return vaultLangOf(lang) === "ko" ? KO : EN;
}
