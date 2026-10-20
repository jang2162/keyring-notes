**English** | [한국어](README.ko.md)

# Widget plugins

You can add your own widget types. A plugin is one ES module in the server's plugin folder.

- Folder: `KEYRING_PLUGINS_DIR` (default: `./plugins` when running from source, `/data/plugins` in Docker). The file name is `<name>.js`, where the name uses lowercase letters, digits and `-`.
- The folder is outside the vault, so the web API and MCP agents cannot create or change plugins. **Plugins run in the browser with the owner's permissions, so install only code you trust.**
- Use it in a note with `type: plugin` and `plugin: <name>`. `from`, `where`, `show`, `sort` and `limit` work as in other widgets (permission filtering included, run on the server), and everything under `options:` is passed to the plugin as is.

```js
export default {
  /**
   * el   : the element to draw into (div)
   * data : { rows: [{ path, title, values: { field: value } }], columns, total, title, options }
   * api  : { open(path) — open a note, h(tag, attrs, ...children) — DOM helper }
   * returns: (optional) a cleanup function, called when the widget is redrawn or removed.
   */
  render(el, data, api) {
    el.append(api.h("p", {}, `${data.total} notes`));
  },
};
```

Example: [`kanban.js`](kanban.js), a kanban board that splits cards into columns by the `options.group` field.

```bash
mkdir -p plugins && cp examples/plugins/kanban.js plugins/          # running from source
docker compose exec keyring sh -c "mkdir -p /data/plugins && cp /app/examples/plugins/kanban.js /data/plugins/"  # Docker (the image includes the examples)
```
