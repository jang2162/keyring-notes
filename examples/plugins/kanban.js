// Keyring Notes 위젯 플러그인 예: 칸반 보드.
//
//   ```widget
//   type: plugin
//   plugin: kanban
//   from: 업무
//   show: [title, status, due]
//   options:
//     group: status                 # 칸을 나눌 필드
//     columns: [todo, doing, done]  # 칸 순서(생략하면 값이 나온 순서)
//   ```
//
// 서버가 from/where/show/sort/limit로 문서를 고르고, 이 플러그인은 그 행(rows)을 그리기만 한다.

export default {
  render(el, data, api) {
    const { h } = api;
    const group = data.options.group ?? "status";
    const order = Array.isArray(data.options.columns) ? data.options.columns.map(String) : [];
    const buckets = new Map(order.map((c) => [c, []]));
    for (const row of data.rows) {
      const key = row.values[group] == null || row.values[group] === "" ? "(없음)" : String(row.values[group]);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
    const extra = data.columns.filter((c) => c !== "title" && c !== group);
    const board = h(
      "div",
      { class: "kanban" },
      ...[...buckets.entries()].map(([name, rows]) =>
        h(
          "section",
          { class: "kanban-col" },
          h("h5", {}, name, h("span", { class: "kanban-count" }, String(rows.length))),
          ...rows.map((row) =>
            h(
              "a",
              { class: "kanban-card", href: "#", onclick: (e) => (e.preventDefault(), api.open(row.path)) },
              h("strong", {}, row.title),
              ...extra.filter((c) => row.values[c] != null && row.values[c] !== "").map((c) => h("span", { class: "kanban-field" }, `${c}: ${row.values[c]}`)),
            ),
          ),
        ),
      ),
    );
    const style = h(
      "style",
      {},
      `.kanban{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
       .kanban-col{flex:1 0 160px;background:var(--bg-soft);border-radius:8px;padding:6px}
       .kanban-col h5{margin:2px 4px 6px;font-size:13px;display:flex;justify-content:space-between}
       .kanban-count{color:var(--muted);font-weight:400}
       .kanban-card{display:flex;flex-direction:column;gap:2px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px;margin-bottom:6px;color:var(--fg);text-decoration:none;font-size:13px}
       .kanban-card:hover{border-color:var(--accent)}
       .kanban-field{color:var(--muted);font-size:12px}`,
    );
    el.append(style, board);
    return () => el.replaceChildren();
  },
};
