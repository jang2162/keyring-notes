<!-- source: examples/plugins/README.md @ v0.9.0 -->
[English](README.md) | **한국어**

# 위젯 플러그인

위젯 종류를 직접 만들 수 있습니다. 플러그인은 서버의 플러그인 폴더에 둔 ES 모듈 하나입니다.

- 폴더: `KEYRING_PLUGINS_DIR`(기본: 소스 실행은 `./plugins`, Docker 는 `/data/plugins`). 파일 이름은 `<이름>.js` 이고, 이름은 영문 소문자·숫자·`-` 로 씁니다.
- 볼트 밖이라 웹 API 와 MCP 에이전트로는 플러그인을 만들거나 고칠 수 없습니다. **플러그인은 브라우저에서 소유자 권한으로 돌아가므로 믿을 수 있는 코드만 넣으세요.**
- 노트 안에서 `type: plugin`, `plugin: <이름>` 으로 씁니다. `from`, `where`, `show`, `sort`, `limit` 는 다른 위젯과 같고(권한 필터 포함, 서버에서 실행), `options:` 아래는 플러그인에 그대로 넘어갑니다.

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

예제: [`kanban.js`](kanban.js) — `options.group` 필드로 칸을 나누는 칸반 보드입니다.

```bash
mkdir -p plugins && cp examples/plugins/kanban.js plugins/          # running from source
docker compose exec keyring sh -c "mkdir -p /data/plugins && cp /app/examples/plugins/kanban.js /data/plugins/"  # Docker (the image includes the examples)
```
