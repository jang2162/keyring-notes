self.keyringWidgetRegister((el, ctx, api) => {
  const b = document.createElement("button");
  b.textContent = api.t("title");
  el.append(b);
  return () => b.remove();
});
