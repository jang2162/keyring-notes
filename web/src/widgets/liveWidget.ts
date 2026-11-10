import { WidgetType, type EditorView } from "@codemirror/view";
import {
  endWidgetEdit,
  nextWidgetBody,
  rewriteWidgetBlock,
  setWidgetDraft,
  setWidgetFocus,
  startWidgetEdit,
  widgetBlockAt,
  widgetEditField,
  widgetResume,
} from "./blockEdit";
import { mountKeyringWidget, type MountedWidget } from "./mount";

const OWNER = "live";

/** CodeMirror 가 다시 만든 위젯 객체(같은 DOM)에서 마운트를 찾는다 — updateDOM 이 DOM·세션·초안을 지키게 */
const mounted = new WeakMap<HTMLElement, MountedWidget>();

/** Live Preview 에서 ```keyring-widget 블록을 대신 그리는 위젯. 블록 자리는 늘 view.posAtDOM 으로 다시 찾는다(문서가 바뀌어도 맞게) */
export class KeyringBlockWidget extends WidgetType {
  /** from: 만들 때의 블록 자리 — toDOM 에서 이어받을지 가를 때만 쓴다(DOM 이 붙기 전이라 posAtDOM 을 못 쓴다) */
  constructor(
    readonly body: string,
    readonly from: number,
    /** 이 편집기의 노트 경로(데이터 파일 쓰기의 주인) — 편집기의 renderContext 로 읽는다 */
    readonly owner: () => string = () => "",
  ) {
    super();
  }

  eq(other: KeyringBlockWidget) {
    return other.body === this.body;
  }

  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "cm-lp-block cm-lp-keyring-widget";
    const block = () => widgetBlockAt(view.state, view.posAtDOM(dom));
    const edit = view.state.field(widgetEditField, false);
    // 편집기가 화면 밖으로 치웠다 다시 만든 위젯도 수정 중 초안·시작 상태·포커스를 이어받는다. 미리보기가 시작한 수정은 이어받지 않는다
    const resume = widgetResume(edit, OWNER, edit?.from === this.from);
    const m = mountKeyringWidget(dom, {
      body: this.body,
      readOnly: view.state.readOnly,
      owner: this.owner(),
      resume,
      write: (state, version) => {
        const b = block();
        const next = b && nextWidgetBody(b.body, state, version);
        const spec = b && next !== null ? rewriteWidgetBlock(view.state, b, next) : null;
        if (!spec) return false;
        view.dispatch(spec);
        return true;
      },
      edit: {
        start: (draft) => {
          const b = block();
          if (b) view.dispatch({ effects: startWidgetEdit.of({ from: b.from, draft, owner: OWNER }) });
        },
        draft: (draft) => view.dispatch({ effects: setWidgetDraft.of(draft) }),
        focus: (i) => view.dispatch({ effects: setWidgetFocus.of(i) }),
        // 끝은 곧바로 — 미루면 적용(쓰기)으로 다시 그려진 미리보기 위젯이 아직 지워지지 않은 수정을 본다.
        // 편집기 업데이트 안(updateDOM 의 다시 그리기)에서 불리면 편집기가 dispatch 를 막으므로 그때만 미룬다
        end: () => {
          const close = () => {
            if (view.state.field(widgetEditField, false)) view.dispatch({ effects: endWidgetEdit.of(null) });
          };
          try {
            close();
          } catch {
            queueMicrotask(close);
          }
        },
      },
      onRaw: () => {
        const b = block();
        if (!b) return;
        // 커서가 블록 안에 들어가면 원문이 된다. 수정 중이었으면 포커스가 위젯을 떠나 적용으로 끝난다
        view.dispatch({ selection: { anchor: b.bodyFrom }, scrollIntoView: true });
        view.focus();
      },
    });
    mounted.set(dom, m);
    return dom;
  }

  updateDOM(dom: HTMLElement) {
    const m = mounted.get(dom);
    if (!m) return false;
    m.update(this.body);
    return true;
  }

  destroy(dom: HTMLElement) {
    mounted.get(dom)?.destroy();
    mounted.delete(dom);
  }

  /** 편집기가 위젯 안 마우스·키를 받지 않는다 — 선택이 블록 안으로 들어가 원문으로 바뀌지 않게 */
  ignoreEvent() {
    return true;
  }
}
