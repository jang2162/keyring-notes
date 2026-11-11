// 상태 판 2: { count }. 판 1({ n })은 migrate 가 iframe 안에서 올린다. 수정 모드는 1.0.0 과 같다.
self.keyringWidgetRegister(
  (el, ctx, api) => {
    let cur = ctx;
    const count = (c) => (c.state && typeof c.state.count === "number" ? c.state.count : 0);
    const label = document.createElement("span");
    const button = (text, run) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.addEventListener("click", run);
      return b;
    };
    const plus = button(api.t("plus"), () => api.setState({ count: count(cur) + 1 }));
    const edit = button(api.t("edit"), () => api.requestEdit());
    const done = button(api.t("done"), () => api.exitEdit(true));
    const draw = () => (label.textContent = "v2 " + api.t("count", { n: count(cur) }) + (cur.editing ? " " + api.t("editing") : "") + " ");
    draw();
    api.onUpdate((c) => {
      cur = c;
      draw();
    });
    el.append(label, plus, edit, done);
    return () => {
      for (const n of [label, plus, edit, done]) n.remove();
    };
  },
  { migrate: (s, from) => (from < 2 ? { count: s && typeof s.n === "number" ? s.n : 0 } : s) },
);
