import { useEffect, type MutableRefObject } from "react";
import type { EditorHandle } from "../Editor";
import { mountKeyringWidget } from "./mount";

/**
 * 미리보기의 ```keyring-widget 자리(.kw-slot)에 붙는 위젯. 쓰기는 늘 숨은 편집기(handle)를 거친다 —
 * 본문 문서가 유일한 원본이라 미리보기에서 고쳐도 실행 취소·자동 저장·다른 칸이 편집기 경로 그대로다.
 *
 * 다른 칸·동기화가 노트를 바꾸면 미리보기 HTML 이 새로 그려져 이 자리 요소(el)가 새것이 된다. 옛 뿌리는 DOM 에서 빠지며 blur 가 나도
 * mount 의 지연 판정(focusOutAction)이 적용하지 않고, 새로 붙는 위젯이 편집기 필드의 초안·포커스를 이어받는다.
 * 그래서 정리(destroy)는 수정을 끝내지 않는다 — 세션 끝은 적용·버림·사라짐뿐이다.
 */
export function PreviewKeyringWidget(p: {
  el: HTMLElement;
  body: string;
  line: number;
  readOnly: boolean;
  handle: MutableRefObject<EditorHandle | null>;
}): null {
  const { el, body, line, readOnly, handle } = p;
  useEffect(() => {
    const h = () => handle.current;
    const edit = readOnly ? null : h()?.widgetEdit();
    const resume = edit && edit.line === line ? edit : null;
    const m = mountKeyringWidget(el, {
      body,
      readOnly: readOnly || !h(),
      resumeDraft: resume ? resume.draft : undefined,
      resumeFocus: resume ? resume.focus : null,
      write: (state, version) => h()?.writeWidget(line, state, version) ?? false,
      edit: {
        start: (draft) => h()?.startWidgetEdit(line, draft),
        draft: (draft) => h()?.setWidgetDraft(draft),
        focus: (i) => h()?.setWidgetFocus(i),
        end: () => h()?.endWidgetEdit(),
      },
    });
    return () => m.destroy();
  }, [el, body, line, readOnly, handle]);
  return null;
}
