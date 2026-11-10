self.keyringWidgetRegister((el, ctx, api) => {
  const b = document.createElement("button");
  b.textContent = api.t("title");
  el.append(b); // 1.1.0
  return () => b.remove();
});
