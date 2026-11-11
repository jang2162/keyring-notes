// 상태 판 1: { n }. 보기 모드에서 「+1」 을 누르면 블록을 곧바로 쓴다.
self.keyringWidgetRegister((el, ctx, api) => {
  let cur = ctx;
  const count = (c) => (c.state && typeof c.state.n === "number" ? c.state.n : 0);
  const label = document.createElement("span");
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = api.t("plus");
  b.addEventListener("click", () => api.setState({ n: count(cur) + 1 }));
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
});
