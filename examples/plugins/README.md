# 위젯 플러그인

위젯 종류를 직접 만들 수 있다. 플러그인은 서버의 플러그인 폴더에 둔 ES 모듈 하나다.

- 폴더: `KEYRING_PLUGINS_DIR`(기본: 소스 실행은 `./plugins`, 도커는 `/data/plugins`). 파일 이름 `<이름>.js`(영문 소문자·숫자·-).
- 볼트 밖이라 웹 API·MCP 에이전트로는 플러그인을 만들거나 고칠 수 없다. **플러그인은 브라우저에서 소유자 권한으로 돌아가므로 믿을 수 있는 코드만 넣는다.**
- 쓰기: 문서 안에 `type: plugin`, `plugin: <이름>`. 나머지 `from`/`where`/`show`/`sort`/`limit`는 다른 위젯과 같고(권한 필터 포함, 서버에서 실행), `options:` 아래는 플러그인에 그대로 넘어간다.

```js
export default {
  /**
   * el   : 그릴 자리(div)
   * data : { rows: [{ path, title, values: { 필드: 값 } }], columns, total, title, options }
   * api  : { open(path) — 문서 열기, h(태그, 속성, ...자식) — DOM 만들기 도우미 }
   * 반환 : (선택) 정리 함수. 위젯이 다시 그려지거나 사라질 때 부른다.
   */
  render(el, data, api) {
    el.append(api.h("p", {}, `문서 ${data.total}개`));
  },
};
```

예제: [`kanban.js`](kanban.js) — `options.group` 필드로 칸을 나누는 칸반 보드.

```bash
mkdir -p plugins && cp examples/plugins/kanban.js plugins/          # 소스 실행
docker compose exec keyring sh -c "mkdir -p /data/plugins && cp /app/examples/plugins/kanban.js /data/plugins/"  # 도커(이미지에 예제 포함)
```
