import { translate, type Params } from "./i18n.js";

/**
 * 오류는 코드(code)와 끼워 넣을 값(params)을 가진다. 글(message)은 오류 언어(서버 언어, 기본 영어)로 만들고,
 * 화면은 code로 자기 언어의 글을 다시 만든다(메시지 키 `error.<code>`). 에이전트에게는 에이전트 언어로(text(lang)).
 */
let errorLang = "en";

/** message를 만들 언어(서버는 서버 언어로 바꾼다) */
export function setErrorLanguage(lang: string | null | undefined) {
  errorLang = lang || "en";
}

export class KeyedError extends Error {
  readonly code: string;
  readonly params: Params;
  constructor(code: string, params: Params = {}) {
    super(translate(errorLang, `error.${code}`, params));
    this.code = code;
    this.params = params;
  }
  /** 다른 언어의 글 */
  text(lang: string | null | undefined): string {
    return translate(lang, `error.${this.code}`, this.params);
  }
}

/** 오류를 그 언어의 글로: 코드가 있으면 번역, 없으면 받은 글 그대로 */
export function errorMessage(e: unknown, lang: string | null | undefined): string {
  if (e instanceof KeyedError) return e.text(lang);
  return e instanceof Error ? e.message : String(e);
}

/** 로컬 볼트·동기화·서버가 내는 오류. 웹 화면은 서버 응답과 같은 상태 코드(404·403·409)로 바꿔 보여 준다. */
export class NotFoundError extends KeyedError {}

export class ForbiddenError extends KeyedError {
  constructor(code = "forbidden", params?: Params) {
    super(code, params);
  }
}

/** baseHash가 현재 내용과 다름. currentHash가 null이면 지금은 문서가 없다. */
export class ConflictError extends KeyedError {
  constructor(
    readonly currentHash: string | null,
    code = currentHash === null ? "conflict_gone" : "conflict",
    params?: Params,
  ) {
    super(code, params);
  }
}

/** 서버가 기기 토큰을 받지 않음(끊었거나 잘못됨). 다시 연결해야 한다. */
export class UnauthorizedError extends KeyedError {
  constructor(code = "device_unauthorized", params?: Params) {
    super(code, params);
  }
}

/** 요청이 잘못됨(경로·값). */
export class PathError extends KeyedError {}
