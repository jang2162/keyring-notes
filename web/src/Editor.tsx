import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

interface Props {
  /** 문서가 바뀔 때마다 달라지는 키. 같은 키 동안에는 에디터 내용을 밖에서 덮어쓰지 않는다. */
  docKey: string;
  initial: string;
  onChange: (value: string) => void;
  onSave: () => void;
}

export function Editor({ docKey, initial, onChange, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          EditorView.lineWrapping,
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (callbacks.current.onSave(), true) },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.focus();
    return () => view.destroy();
    // initial은 docKey가 바뀔 때만 반영한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  return <div className="editor" ref={host} />;
}
