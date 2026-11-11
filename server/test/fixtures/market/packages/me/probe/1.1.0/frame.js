// 탈출 시도 위젯(시험 전용 — 마켓 3단계 계획 Review Focus 1). 단추마다 시도 하나, 결과는 iframe 안에 글로 보인다.
// 기대: 앱 문서·저장소·네트워크에 닿지 못하고, 자기 탐색이면 그 자리만 오류, file 은 늘 블록 값으로 고정된다.
// 1.1.0: 데이터 파일(.json)을 읽어 보인다 — 1.0.0 이 심어 둔 file 로 다른 첨부를 열지 못해야 한다.
self.keyringWidgetRegister(
  (el, ctx, api) => {
    const out = document.createElement("pre");
    const log = (name, r) => (out.textContent += name + ": " + r + "\n");
    const attempt = (name, fn) => async () => {
      try {
        log(name, "ok " + String(await fn()));
      } catch (e) {
        log(name, "blocked " + String(e && e.name ? e.name : e));
      }
    };
    const target = document.createElement("input");
    target.value = "other.excalidraw.json";
    target.setAttribute("aria-label", "file");
    const tries = [
      ["parent.document", () => typeof parent.document.title],
      ["top.location", () => ((top.location.href = "https://example.com/"), "assigned")],
      ["localStorage", () => String(localStorage.getItem("x"))],
      ["fetch", async () => (await fetch("https://example.com/")).status],
      ["forged message", () => (parent.postMessage({ kw: "kw1", id: "forged-instance", type: "setState", patch: { forged: true } }, "*"), "sent")],
      ["setState file", () => (api.setState({ file: target.value }), "sent " + target.value)],
      ["self navigate", () => ((location.href = "https://example.com/"), "assigned")],
      ["read data file", async () => (api.file ? new TextDecoder().decode((await api.file.read()).bytes).slice(0, 80) : "no file api")],
    ];
    const buttons = tries.map(([name, fn]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      b.addEventListener("click", attempt(name, fn));
      return b;
    });
    const state = document.createElement("code");
    const draw = (c) => (state.textContent = api.t("state") + " " + JSON.stringify(c.state));
    draw(ctx);
    api.onUpdate(draw);
    el.append(state, target, ...buttons, out);
    return () => {
      for (const n of [state, target, ...buttons, out]) n.remove();
    };
  },
  // migrate 결과에 file 을 넣어 본다 — 앱은 블록 값으로 덮어야 한다
  { migrate: (s, from) => Object.assign({}, s, { file: "other.excalidraw.json", migratedFrom: from }) },
);
