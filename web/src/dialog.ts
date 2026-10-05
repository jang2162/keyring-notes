/**
 * 앱 안 확인·입력 대화상자. 데스크톱·모바일 WebView(특히 macOS·iOS)는 window.confirm/prompt를
 * 지원하지 않거나 막을 수 있어, 앱에서도 쓰는 화면은 이것을 쓴다.
 */
function open(message: string, input: { value: string } | null, okLabel: string): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const form = document.createElement("form");
    form.className = "modal ask-dialog";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    const text = document.createElement("p");
    text.className = "ask-message";
    text.textContent = message;
    form.append(text);
    let field: HTMLInputElement | null = null;
    if (input) {
      field = document.createElement("input");
      field.value = input.value;
      field.setAttribute("aria-label", message);
      form.append(field);
    }
    const actions = document.createElement("div");
    actions.className = "ask-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "취소";
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.className = "on";
    ok.textContent = okLabel;
    actions.append(cancel, ok);
    form.append(actions);
    backdrop.append(form);
    const prevFocus = document.activeElement as HTMLElement | null;
    const done = (v: string | null) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      prevFocus?.focus?.();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      }
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      done(field ? field.value : "");
    });
    cancel.addEventListener("click", () => done(null));
    backdrop.addEventListener("mousedown", (e) => e.target === backdrop && done(null));
    document.addEventListener("keydown", onKey, true);
    document.body.append(backdrop);
    if (field) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    } else ok.focus();
  });
}

/** 확인(true) / 취소(false) */
export async function confirmDialog(message: string, okLabel = "확인"): Promise<boolean> {
  return (await open(message, null, okLabel)) !== null;
}

/** 글자 입력. 취소하면 null */
export function promptDialog(message: string, defaultValue = "", okLabel = "확인"): Promise<string | null> {
  return open(message, { value: defaultValue }, okLabel);
}
