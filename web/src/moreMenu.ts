/**
 * 좁은 화면 하단 바의 「더 보기」 내용: 맨 위 상태 줄과 레일 항목, 「더 보기」 칸 배지의 입력.
 * 좁은 화면에는 상태 표시줄·레일이 없으므로 그 둘이 보이던 조건을 여기 모은다. Workspace 와 떼어 시험한다 —
 * 아이콘과 누를 때 할 일은 Workspace 가 id 로 꽂는다(이 모듈은 화면 상태와 글만 안다).
 */
import type { MoreStatus } from "./bottomBarState";
import { t } from "./i18n";

/** 알릴 저장 상태: 충돌, 저장 실패, 자동 저장이 꺼진 채 저장 안 함. 자동 저장이 켜진 「편집 중」 은 평소 상태라 알리지 않는다 */
export type SaveAttention = "conflict" | "failed" | "unsaved" | null;

/** 상태 표시줄의 저장 표시(Workspace saveLabel)와 같은 우선순위: 충돌 > 저장 중 > 실패 > 저장 안 함 */
export function saveAttention(s: { hasDoc: boolean; conflict: boolean; saving: boolean; failed: boolean; dirty: boolean; autosave: boolean }): SaveAttention {
  if (!s.hasDoc) return null;
  if (s.conflict) return "conflict";
  if (s.saving) return null;
  if (s.failed && s.dirty) return "failed";
  return s.dirty && !s.autosave ? "unsaved" : null;
}

export interface MoreInput {
  /** 로컬 모드(앱·기기 볼트). 오프라인·보낼 변경·검토는 서버 모드 것이다 */
  local: boolean;
  online: boolean;
  outboxCount: number;
  pendingCount: number;
  save: SaveAttention;
  /** 로컬 모드 동기화 오류 */
  syncError: boolean;
  /** 동기화하는 서버 이름(없으면 null) */
  syncServer: string | null;
  /** 지금 워크스페이스에 데일리 노트가 켜져 있다 */
  dailyOn: boolean;
  /** 앱 새 버전(데스크톱 앱 업데이터) */
  update: boolean;
}

export type MoreStatusId = "save" | "offline" | "outbox" | "sync" | "review-waiting";
export interface MoreStatusSpec {
  id: MoreStatusId;
  text: string;
  kind: "" | "warn" | "error";
}

const SAVE_LINE = {
  conflict: { key: "status.conflict", kind: "warn" },
  failed: { key: "status.failed", kind: "error" },
  unsaved: { key: "status.unsaved", kind: "" },
} as const;

/** 「더 보기」 목록 맨 위 상태 줄: 지금 상태 표시줄이 보이는 것 중 알아야 할 것만, 같은 순서 */
export function moreStatusLines(i: MoreInput): MoreStatusSpec[] {
  const out: MoreStatusSpec[] = [];
  if (i.save) out.push({ id: "save", text: t(SAVE_LINE[i.save].key), kind: SAVE_LINE[i.save].kind });
  if (!i.local && !i.online)
    out.push({ id: "offline", text: i.outboxCount ? t("status.offlineOutbox", { count: i.outboxCount }) : t("status.offline"), kind: "warn" });
  if (!i.local && i.online && i.outboxCount > 0) out.push({ id: "outbox", text: t("status.sendNow", { count: i.outboxCount }), kind: "warn" });
  if (i.local && i.syncError) out.push({ id: "sync", text: t("sync.failed"), kind: "error" });
  if (!i.local && i.pendingCount > 0) out.push({ id: "review-waiting", text: t("status.reviewWaiting", { count: i.pendingCount }), kind: "" });
  return out;
}

export type MoreEntryId = "daily" | "tags" | "attachments" | "graph" | "ingest" | "review" | "lint" | "sync" | "settings" | "logout";
export interface MoreEntrySpec {
  id: MoreEntryId;
  label: string;
  badge?: number;
  dot?: boolean;
}

/** 「더 보기」 항목: 레일과 같은 조건·순서(파일·검색은 바에 있고, 단축키 화면은 모바일에서 숨긴다). 로그아웃이 끝 */
export function moreEntrySpecs(i: MoreInput): MoreEntrySpec[] {
  const out: MoreEntrySpec[] = [];
  if (i.dailyOn) out.push({ id: "daily", label: t("cmd.daily") });
  out.push({ id: "tags", label: t("rail.tags") }, { id: "attachments", label: t("rail.attachments") }, { id: "graph", label: t("tool.graph") });
  if (!i.local) out.push({ id: "ingest", label: t("tool.ingestLong") }, { id: "review", label: t("tool.reviewLong"), badge: i.pendingCount });
  out.push({ id: "lint", label: t("tool.lintLong") });
  if (i.local) out.push({ id: "sync", label: i.syncServer ? t("sync.with", { server: i.syncServer }) : t("tool.device"), dot: i.syncError });
  out.push({ id: "settings", label: t("settings.title"), dot: i.update });
  if (!i.local) out.push({ id: "logout", label: t("rail.logout") });
  return out;
}

/** 「더 보기」 칸 배지(moreBadge)의 입력 */
export function moreStatusOf(i: MoreInput): MoreStatus {
  return {
    offline: !i.local && !i.online,
    outbox: i.local ? 0 : i.outboxCount,
    saveIssue: i.save === "conflict" || i.save === "failed",
    unsaved: i.save === "unsaved",
    syncError: i.local && i.syncError,
    reviewWaiting: i.local ? 0 : i.pendingCount,
    update: i.update,
  };
}
