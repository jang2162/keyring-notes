import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

/**
 * 코드 블록 언어 이름 → language-data 의 언어 이름. language-data 의 이름·별칭에 없는 흔한 짧은 이름을 더한다(설계 9절).
 * null 은 「글 블록이니 칠하지 않는다」 — language-data 의 느슨한 찾기가 "text" 안의 "tex" 를 LaTeX 로 읽는 것을 막는다.
 * 편집 화면(Editor.tsx 의 markdown codeLanguages)과 미리보기(codeHighlight.ts)가 함께 쓴다. 표의 언어가 실제로 있는지는 시험이 확인한다.
 */
export const CODE_ALIASES: ReadonlyMap<string, string | null> = new Map([
  ["py", "Python"],
  ["py3", "Python"],
  ["python3", "Python"],
  ["sh", "Shell"],
  ["zsh", "Shell"],
  ["bash", "Shell"],
  ["shell", "Shell"],
  ["yml", "YAML"],
  ["md", "Markdown"],
  ["rb", "Ruby"],
  ["rs", "Rust"],
  ["kt", "Kotlin"],
  ["kts", "Kotlin"],
  ["ps1", "PowerShell"],
  ["pwsh", "PowerShell"],
  ["golang", "Go"],
  ["hs", "Haskell"],
  ["erl", "Erlang"],
  ["clj", "Clojure"],
  ["cljs", "ClojureScript"],
  ["pl", "Perl"],
  ["docker", "Dockerfile"],
  ["proto", "ProtoBuf"],
  ["patch", "diff"],
  ["h", "C"],
  ["cc", "C++"],
  ["cxx", "C++"],
  ["hpp", "C++"],
  ["mjs", "JavaScript"],
  ["cjs", "JavaScript"],
  ["mts", "TypeScript"],
  ["cts", "TypeScript"],
  ["jsonc", "JSON"],
  ["fs", "F#"],
  ["ml", "OCaml"],
  ["vb", "VB.NET"],
  ["text", null],
  ["txt", null],
  ["plain", null],
  ["plaintext", null],
]);

/** 펜스 정보 글(```py title=x 의 "py title=x")의 언어. 모르면 null */
export function findLanguage(info: string): LanguageDescription | null {
  const name = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!name) return null;
  const alias = CODE_ALIASES.get(name);
  if (alias !== undefined) return alias === null ? null : (languages.find((l) => l.name === alias) ?? null);
  return LanguageDescription.matchLanguageName(languages, name, true);
}
