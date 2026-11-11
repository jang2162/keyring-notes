// 상태 판 2: { count }. 판 1({ n })은 migrate 가 iframe 안에서 위젯에 건네기 전에 올린다.
self.keyringWidgetRegister(
  (el, ctx, api) => {
    let cur = ctx;
    const count = (c) => (c.state && typeof c.state.count === "number" ? c.state.count : 0);
    const label = document.createElement("span");
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = api.t("plus");
    b.addEventListener("click", () => api.setState({ count: count(cur) + 1 }));
    const draw = () => (label.textContent = api.t("count", { n: count(cur) }) + " ");
    draw();
    api.onUpdate((c) => {
      cur = c;
      draw();
    });
    el.append(label, b);
    return () => {
      label.remove();
      b.remove();
    };
  },
  { migrate: (s, from) => (from < 2 ? { count: s && typeof s.n === "number" ? s.n : 0 } : s) },
);
