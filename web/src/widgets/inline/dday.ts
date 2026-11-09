import { ddayCount, ddayText, todayLocal, type DdayState } from "../ddayModel";
import type { WidgetContext, WidgetRender } from "../types";

/*
 * 인라인 위젯 리뷰 점검(설계 「인라인/iframe 기준」): window·document 에 리스너를 걸지 않는다, 스타일은 .kw-dday 안,
 * 키는 자기 입력칸 것만 받고(Esc 는 뿌리가 받는다), 자체 실행 취소 기록이 없다, DOM 은 열 개 남짓이고 타이머·루프가 없다.
 */

function asState(s: unknown): DdayState {
  const o = s !== null && typeof s === "object" ? (s as Record<string, unknown>) : {};
  return { targetDate: typeof o.targetDate === "string" ? o.targetDate : "", label: typeof o.label === "string" ? o.label : "" };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

export const render: WidgetRender = (root, ctx, api) => {
  root.classList.add("kw-dday");

  const view = el("button", "kw-dday-view");
  view.type = "button";
  const name = el("span", "kw-dday-name");
  const count = el("span", "kw-dday-count");
  view.append(name, count);
  view.addEventListener("click", () => api.requestEdit());

  const form = el("div", "kw-dday-form");
  const dateLabel = el("label", "kw-dday-field");
  const dateText = el("span", "kw-dday-field-name");
  const date = el("input", "kw-dday-input");
  date.type = "date";
  dateLabel.append(dateText, date);
  const nameLabel = el("label", "kw-dday-field");
  const nameText = el("span", "kw-dday-field-name");
  const label = el("input", "kw-dday-input");
  label.type = "text";
  nameLabel.append(nameText, label);
  const preview = el("span", "kw-dday-count");
  form.append(dateLabel, nameLabel, preview);
  date.addEventListener("input", () => api.setState({ targetDate: date.value }));
  label.addEventListener("input", () => api.setState({ label: label.value }));

  root.append(view, form);

  let editing = false;
  const paint = (c: WidgetContext) => {
    const st = asState(c.state);
    const n = ddayCount(st.targetDate, todayLocal(new Date()));
    const text = n === null ? api.t("noDate") : ddayText(n);
    name.textContent = st.label;
    name.hidden = st.label === "";
    count.textContent = text;
    preview.textContent = text;
    view.classList.toggle("kw-dday-static", !c.editable || c.readOnly);
    view.title = c.editable && !c.readOnly ? api.t("edit") : "";
    dateText.textContent = api.t("date");
    nameText.textContent = api.t("label");
    view.hidden = c.editing;
    form.hidden = !c.editing;
    if (c.editing && !editing) {
      // 들어갈 때만 입력칸 값을 채운다 — 수정 중에 값을 다시 넣으면 한글 조합이 끊긴다
      date.value = st.targetDate;
      label.value = st.label;
      // 포커스가 위젯 안에 있어야 밖을 눌렀을 때 focusout(적용)이 나고 Esc 가 뿌리에 온다
      date.focus();
    }
    editing = c.editing;
  };
  paint(ctx);
  api.onUpdate(paint);

  return () => root.replaceChildren();
};
