import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { CODE_ALIASES, findLanguage } from "./codeLanguages";

describe("코드 블록 언어 찾기", () => {
  it("별칭 표의 언어는 모두 language-data 에 있다", () => {
    const names = new Set(languages.map((l) => l.name));
    for (const [alias, name] of CODE_ALIASES) if (name !== null) expect(names.has(name), `${alias} → ${name}`).toBe(true);
  });

  it("흔한 짧은 이름을 찾는다(설계 9절)", () => {
    const want: Record<string, string> = {
      py: "Python",
      sh: "Shell",
      zsh: "Shell",
      bash: "Shell",
      yml: "YAML",
      md: "Markdown",
      rb: "Ruby",
      rs: "Rust",
      kt: "Kotlin",
      ps1: "PowerShell",
    };
    for (const [alias, name] of Object.entries(want)) expect(findLanguage(alias)?.name, alias).toBe(name);
  });

  it("대소문자와 펜스 뒤 덧붙인 말은 무시하고, 표에 없으면 language-data 의 이름·별칭으로 찾는다", () => {
    expect(findLanguage("PY")?.name).toBe("Python");
    expect(findLanguage("py title=a.py")?.name).toBe("Python");
    expect(findLanguage("typescript")?.name).toBe("TypeScript");
    expect(findLanguage("js")?.name).toBe("JavaScript");
  });

  it("글 블록(text·txt·plain)과 모르는 이름은 칠하지 않는다", () => {
    // language-data 의 느슨한 찾기는 "text" 안의 "tex" 를 LaTeX 로 읽는다
    for (const name of ["text", "txt", "plain", "plaintext", "", "없는언어"]) expect(findLanguage(name), name).toBeNull();
  });

  it("편집 화면(markdown 의 codeLanguages 함수)도 같은 표로 py 블록을 Python 으로 읽는다", async () => {
    await findLanguage("py")!.load();
    const s = EditorState.create({ doc: "```py\ndef f():\n  pass\n```", extensions: [markdown({ base: markdownLanguage, codeLanguages: findLanguage })] });
    ensureSyntaxTree(s, s.doc.length, 5000);
    // 안쪽 언어 트리는 mount 되어 있어 resolveInner 로 들어간다
    expect(syntaxTree(s).resolveInner(s.doc.toString().indexOf("def") + 1, 1).name).toBe("def");
  });
});
