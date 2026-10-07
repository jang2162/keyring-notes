import { officialLangOf, setErrorLanguage, translate, type Params } from "@keyring-notes/core";

/**
 * 서버 언어: 서버가 스스로 내는 글(오류 message·로그·CLI)의 언어.
 * 서버 설정(config.language) → KEYRING_LANG → LANG 순서, 없으면 영어. 화면은 오류 code로 자기 언어의 글을 만든다.
 */
let lang: "en" | "ko" = officialLangOf(process.env.KEYRING_LANG ?? process.env.LANG);
setErrorLanguage(lang);

export function setServerLanguage(configured: string | null | undefined) {
  lang = officialLangOf(configured ?? process.env.KEYRING_LANG ?? process.env.LANG);
  setErrorLanguage(lang);
}

export function serverLanguage(): "en" | "ko" {
  return lang;
}

/** 서버 언어의 메시지 */
export function serverText(key: string, params?: Params): string {
  return translate(lang, key, params);
}
