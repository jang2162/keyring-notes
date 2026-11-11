// 상태 판 1: { n }. 「Edit」 으로 수정 모드에 들어가 「+1」 은 초안만 바꾸고, 「Done」 이 적용한다(판 교체·이어받기 시험).
self.keyringWidgetRegister((el, ctx, api) => {
  let cur = ctx;
  const count = (c) => (c.state && typeof c.state.n === "number" ? c.state.n : 0);
  const label = document.createElement("span");
  const button = (text, run) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.addEventListener("click", run);
    return b;
  };
  const plus = button(api.t("plus"), () => api.setState({ n: count(cur) + 1 }));
  const edit = button(api.t("edit"), () => api.requestEdit());
  const done = button(api.t("done"), () => api.exitEdit(true));
  const draw = () => (label.textContent = "v1 " + api.t("count", { n: count(cur) }) + (cur.editing ? " " + api.t("editing") : "") + " ");
  draw();
  api.onUpdate((c) => {
    cur = c;
    draw();
  });
  el.append(label, plus, edit, done);
  return () => {
    for (const n of [label, plus, edit, done]) n.remove();
  };
});
