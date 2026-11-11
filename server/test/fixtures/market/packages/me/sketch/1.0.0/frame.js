// 데이터 파일 위젯: api.file 로 { lines: [] } 를 읽고, 단추로 줄을 하나 더해 쓴다.
self.keyringWidgetRegister((el, ctx, api) => {
  const info = document.createElement("span");
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = api.t("addLine");
  let doc = { lines: [] };
  let hash = "";
  const draw = () => (info.textContent = api.t("lines", { n: doc.lines.length }) + " ");
  const load = async () => {
    const r = await api.file.read();
    hash = r.hash;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(r.bytes));
      doc = parsed && Array.isArray(parsed.lines) ? parsed : { lines: [] };
    } catch {
      doc = { lines: [] };
    }
    draw();
  };
  b.addEventListener("click", async () => {
    doc = { lines: [...doc.lines, "line " + (doc.lines.length + 1)] };
    draw();
    const r = await api.file.write(new TextEncoder().encode(JSON.stringify(doc)), hash);
    hash = r.hash;
  });
  b.disabled = ctx.readOnly;
  load().catch((e) => (info.textContent = String(e && e.message ? e.message : e) + " "));
  el.append(info, b);
  return () => {
    info.remove();
    b.remove();
  };
});
