/**
 * keyring-widget 위젯과 앱 사이의 API. 정본은 docs/superpowers/specs/2026-11-09-keyring-widget-design.md 「공통 API」 —
 * 인라인과 iframe 이 같은 모양을 쓴다.
 */

export interface WidgetDefinition {
  /** "keyring/dday" */
  id: string;
  /** 상태 판 */
  version: number;
  isolation: "inline" | "frame";
  /** 블록에 display 가 없을 때 */
  display: "block" | "inline";
  /**
   * 큰 상태는 노트 첨부인 데이터 파일(state.file)에 둔다. ext 는 "." 으로 시작한다. 서버가 빈 첨부를 거절하므로 처음 내용(initial)이 있어야 하고,
   * 파일 이름 앞부분은 name[볼트 언어] ?? title[볼트 언어] ?? title.en
   */
  dataFile?: { ext: string; initial(): Uint8Array; name?: Record<string, string> };
  /** 「위젯 넣기」 때, 그리고 블록에 state 가 없을 때 */
  defaultState(): unknown;
  migrate?(state: unknown, from: number): unknown;
  /** 언어별 이름(넣기 목록) */
  title: Record<string, string>;
}

export interface WidgetContext {
  /** 지금 보일 상태(수정 중이면 초안) */
  state: unknown;
  editing: boolean;
  editable: boolean;
  display: "block" | "inline";
  /** 화면 언어 */
  lang: string;
  /** 앱 테마 토큰 값(--fg, --bg, --accent …) */
  theme: Record<string, string>;
  /** 이력 보기 등 */
  readOnly: boolean;
  /** 전체 화면 중(위젯이 높이를 정하게) */
  fullscreen?: boolean;
}

export interface WidgetApi {
  /** 얕은 병합. 보기 모드면 블록을 곧바로 한 번 다시 쓰고, 수정 중이면 초안만 바꾼다 */
  setState(patch: object): void;
  requestEdit(): void;
  /** true = 적용, false = 버리기 */
  exitEdit(apply: boolean): void;
  /** 위젯이 가져온 메시지 */
  t(key: string, vars?: object): string;
  file?: {
    read(): Promise<{ bytes: Uint8Array; hash: string }>;
    write(bytes: Uint8Array, baseHash: string): Promise<{ hash: string }>;
  };
  /** display: block 위젯만 */
  toggleFullscreen?(): void;
  /** 상태·테마·언어가 바뀌면 */
  onUpdate(cb: (ctx: WidgetContext) => void): void;
}

/** 위젯 코드가 구현한다. 돌려주는 것은 정리 함수 */
export type WidgetRender = (el: HTMLElement, ctx: WidgetContext, api: WidgetApi) => () => void;
