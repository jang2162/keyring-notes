<!-- source: docs/manual/en/how-to/publish-packages.md @ v0.12.0 -->
# 마켓 패키지 올리기

Keyring Notes 가 받아 쓸 수 있는 위젯·테마·언어 패키지 저장소를 만드는 방법입니다.

패키지를 만들거나 자기 저장소를 운영하는 분을 위한 문서입니다.

> [!NOTE]
> 아직 앱에서 패키지를 설치하거나 쓸 수 없습니다. 앱에서 설치하기와 테마·언어·위젯 적용은 다음 릴리스에 들어옵니다. 저장소를 만들고 검사하는 아래 명령은 지금 쓸 수 있습니다.

## 저장소 구조

저장소는 정적 파일 폴더입니다. 아무 웹 서버나 정적 호스팅 서비스에서 내줄 수 있습니다.

```text
<저장소>/index.json
<저장소>/packages/<scope>/<name>/<version>/<파일들>
```

- 패키지 id 는 `@<scope>/<name>` 입니다. 두 부분 모두 소문자·숫자·`-` 로 쓰고, 글자나 숫자로 시작합니다. 폴더 이름에는 `@` 를 뺍니다. `@me/clock` 1.0.0 의 파일은 `packages/me/clock/1.0.0/` 에 둡니다.
- 범위 `@keyring` 은 공식 저장소 몫입니다. 다른 저장소의 `@keyring/…` 패키지는 앱이 무시합니다.
- `index.json` 에 파일마다 SHA-256 체크섬을 적습니다. 체크섬이 맞지 않는 파일은 앱이 받지 않습니다.

## 패키지 파일

모든 패키지에는 `keyring-package.json` 이라는 매니페스트가 있습니다. 나머지 파일은 종류에 따라 다릅니다.

| 종류 | 필수 파일 | 선택 파일 |
| --- | --- | --- |
| `widget` | `frame.js` | `frame.css`, `messages/<언어>.json` |
| `theme` | 없음 | 없음 |
| `language` | `messages.json` | 없음 |

다른 이름의 파일은 둘 수 없습니다. `.DS_Store` 같은 숨김 파일도 마찬가지입니다. 심볼릭 링크도 받지 않습니다. 대소문자만 다른 두 이름(`messages/ko.json` 과 `messages/KO.json`)은 macOS·Windows 에서 같은 파일이 되므로 받지 않습니다. 위젯의 그림·글꼴은 `frame.js` 나 `frame.css` 안에 넣어 옵니다(예: `data:` URL).

### 매니페스트

```json
{
  "id": "@me/clock",
  "version": "1.0.0",
  "type": "widget",
  "name": { "en": "Clock", "ko": "시계" },
  "description": { "en": "A clock for your notes" },
  "author": "Me",
  "license": "MIT",
  "engines": { "keyring": ">=0.13.0" },
  "widget": { "stateVersion": 1, "display": "block", "defaultState": {} }
}
```

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | 글자 | 패키지 id. 폴더와 같아야 합니다 |
| `version` | 글자 | 패키지 판([판과 범위](#판과-범위) 참고). 폴더와 같아야 합니다 |
| `type` | 글자 | `widget`, `theme`, `language` 중 하나 |
| `name` | 객체 | 언어 태그 → 이름. 하나 이상 |
| `description` | 객체 | 언어 태그 → 설명. 하나 이상 |
| `author` | 글자 | 작성자 |
| `license` | 글자 | 라이선스(예: SPDX id) |
| `engines.keyring` | 글자 | 이 패키지가 맞는 앱 판의 범위 |
| `widget` | 객체 | 위젯만. 아래 참고 |
| `colors` | 객체 | 테마만. 아래 참고 |

`widget` 객체:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `stateVersion` | 1 이상의 정수 | 위젯이 노트에 남기는 상태의 판. 패키지 판과 따로입니다 |
| `display` | 글자 | `block` 또는 `inline` |
| `defaultState` | 아무 JSON 값 | 새 위젯의 상태 |
| `dataFile` | 객체 | 선택. 위젯이 노트 옆에 두는 데이터 파일: `ext`(소문자·숫자), `initial`(비지 않은 글), `name`(선택, 언어 태그 → 이름) |
| `isolation` | 글자 | 선택. 늘 `frame` 입니다 — 받은 위젯은 늘 격리된 프레임에서 돕니다 |

테마의 `colors` 객체는 `light`, `dark` 중 하나나 둘 다를 가집니다. 각각 색 토큰 → 색 값입니다.

```json
"colors": {
  "light": { "--bg": "#fdfaf3", "--accent": "#b4532a" },
  "dark": { "--bg": "#1d1b18", "--accent": "oklch(0.72 0.12 45)" }
}
```

- 토큰 이름은 `--bg` 꼴입니다. 대시 둘 다음에 소문자·숫자·`-` 를 씁니다. 크기·글꼴·간격 토큰(`--fs-*`, `--font-*`, `--radius-*`, `--*-h`, `--*-w`)은 받지 않습니다. 테마는 색만 바꿉니다. 앱이 읽는 토큰 목록은 테마 적용과 함께 싣습니다.
- 값은 `#rgb`, `#rrggbb`, `#rrggbbaa` 이거나, 괄호 안에 숫자·`%`·`deg`·빈칸·`,`·`/` 만 쓴 `rgb()`, `rgba()`, `hsl()`, `hsla()`, `oklch()`, `oklab()` 입니다. 그 밖의 값은 받지 않습니다. `red` 같은 이름, `var(…)`, `url(…)`, `;`·`{`·`}`·`!` 가 든 값도 받지 않습니다.

`language` 패키지의 `messages.json` 은 언어팩 파일과 같은 형식(`meta` 와 `messages`)입니다. 빠진 키가 있어도 되고, 그 자리는 기준 언어로 보입니다.

### 가장 작은 위젯

`frame.js` 는 격리된 프레임 안에서 돕니다. 그리기 함수를 넘겨 `keyringWidgetRegister` 를 한 번 부릅니다. 그리기 함수는 그릴 요소·문맥·API 를 받고, 정리 함수를 돌려줍니다.

```js
self.keyringWidgetRegister((el, ctx, api) => {
  let state = ctx.state;
  const button = document.createElement("button");
  const draw = () => (button.textContent = api.t("clicks", { count: state.count ?? 0 }));
  button.addEventListener("click", () => api.setState({ count: (state.count ?? 0) + 1 }));
  api.onUpdate((next) => {
    state = next.state;
    draw();
  });
  el.append(button);
  draw();
  return () => button.remove();
});
```

이 위젯의 `messages/ko.json`:

```json
{ "clicks": "{count}번 눌렀습니다" }
```

| 문맥 필드 | 설명 |
| --- | --- |
| `state` | 보일 상태(수정 중이면 초안) |
| `editing`, `editable`, `readOnly` | 수정 중인지, 고칠 수 있는지, 읽기 전용(예: 이력 보기)으로 보이는지 |
| `display` | `block` 또는 `inline` |
| `lang` | 화면 언어 |
| `theme` | 앱의 색 토큰 값 |

| API | 설명 |
| --- | --- |
| `setState(patch)` | `patch` 를 상태에 합칩니다. 수정 중이 아니면 블록을 바로 씁니다 |
| `requestEdit()`, `exitEdit(apply)` | 수정을 시작하고 끝냅니다(`true` 는 적용, `false` 는 버리기) |
| `t(key, vars)` | `messages/<언어>.json` 의 글 |
| `onUpdate(callback)` | 상태·테마·언어가 바뀌면 불립니다 |
| `file.read()`, `file.write(bytes, baseHash)` | 매니페스트에 `dataFile` 이 있을 때 그 데이터 파일 |
| `toggleFullscreen()` | 블록 위젯만 |

## 목록 파일

`index.json` 은 저장소의 모든 패키지와 판을 적습니다.

```json
{
  "format": 1,
  "name": "My widgets",
  "packages": {
    "@me/clock": {
      "type": "widget",
      "versions": {
        "1.0.0": {
          "engines": { "keyring": ">=0.13.0" },
          "files": [
            { "path": "frame.js", "sha256": "…", "size": 20480 },
            { "path": "keyring-package.json", "sha256": "…", "size": 812 }
          ]
        }
      }
    }
  }
}
```

- `format` 은 `1` 입니다.
- `files` 에는 `keyring-package.json` 을 포함해 그 판의 파일을 모두 적습니다. `sha256` 은 소문자 16진수 64자리, `size` 는 바이트 수입니다.
- 이 규칙을 어긴 판은 앱이 건너뛰고, 저장소의 나머지는 그대로 씁니다.

### 상한

| 상한 | 값 |
| --- | --- |
| 파일 하나 | 8 MiB |
| 패키지 판 하나(파일 전부) | 16 MiB |
| `index.json` | 2 MiB |
| 받기 한 번(리다이렉트 포함) | 30초(`index.json` 은 15초) |
| 리다이렉트 | 5번 |

## 판과 범위

판은 `MAJOR.MINOR.PATCH` 이고, 뒤에 `-` 와 프리릴리스(예: `1.2.0-beta.1`)를 붙일 수 있습니다. 수는 0 으로 시작하지 않습니다. `1.2.0-Beta` 와 `1.2.0-beta` 가 macOS·Windows 에서 같은 폴더가 되므로 프리릴리스에는 소문자·숫자·`-` 만 씁니다. 판이 파일 경로에 들어가므로 빌드 메타데이터(`+…`)는 쓸 수 없습니다.

`engines.keyring` 은 범위입니다.

| 범위 | 맞는 판 |
| --- | --- |
| `*` | 모든 판 |
| `1.2.0` 또는 `=1.2.0` | 1.2.0 만 |
| `>1.2.0`, `>=1.2.0`, `<2.0.0`, `<=2.0.0` | 비교 |
| `^1.2.0` | `>=1.2.0 <2.0.0` (`^0.2.0` 은 `>=0.2.0 <0.3.0`, `^0.0.3` 은 `>=0.0.3 <0.0.4`) |
| `~1.2.0` | `>=1.2.0 <1.3.0` |
| `>=0.13.0 <1.0.0` | 둘 다(빈칸으로 잇습니다) |
| `^1.0.0 \|\| ^2.0.0` | 둘 중 하나 |

프리릴리스는 어떤 범위에서나 semver 순서로 비교합니다. npm 과 달리 `>=1.0.0` 은 `2.0.0-beta` 에도 맞습니다. 앱이 가장 새 판을 고를 때는 프리릴리스를 건너뜁니다. 프리릴리스는 판을 지정하면 설치할 수 있습니다.

## 패키지를 검사하고 목록 만들기

소스 체크아웃에서는 `pnpm keyring` 으로 실행합니다. 상대 경로는 명령을 실행한 폴더 기준입니다.

```bash
pnpm keyring pkg check my-repo/packages/me/clock/1.0.0
pnpm keyring pkg index my-repo --name "My widgets"
```

- `pkg check <폴더>` 는 매니페스트, 필수·허용 파일, 테마 색, 언어 키를 검사합니다. 오류가 있으면 종료 코드 `1` 로 끝나고, 빠진 언어 키 같은 경고는 실패 없이 보여 줍니다.
- `pkg index <폴더>` 는 `packages/` 아래 모든 패키지를 검사하고, 파일마다 크기와 체크섬을 재서 `index.json` 을 씁니다. 이름은 기존 `index.json` 의 `name`, 없으면 `--name`, 그것도 없으면 폴더 이름입니다. 파일이 그대로면 다시 실행해도 `index.json` 을 건드리지 않습니다.

Docker 에서는 컨테이너 안에서 같은 명령을 실행합니다. 폴더는 데이터 볼륨(`/data`) 안이나 컨테이너에 마운트한 다른 볼륨에 있어야 합니다.

```bash
docker compose exec keyring keyring pkg index /data/my-repo
```

`index.json` 을 손이나 다른 도구로 만들어도 됩니다. 위 형식을 그대로 따르세요.

## 저장소 올리기

정적 파일을 그대로 내주는 곳이면 어디든 폴더 전체를 올리면 됩니다.

- `https:` 로 내주세요. `http:` 저장소와 사설망 저장소는 서버 운영자나 그 기기가 허용할 때만 받습니다.
- 응답을 압축하지 마세요. 앱은 압축하지 않은 파일을 요청하고, 압축된 응답은 받지 않습니다.
- 파일을 바이트 그대로 내주세요. 바뀐 파일은 체크섬과 맞지 않습니다.

새 판을 올린 뒤에는 `pkg index` 를 다시 실행하고, 새 파일과 함께 `index.json` 도 올리세요. `index.json` 을 스스로 다시 만드는 서버를 띄우려면 [내 마켓플레이스 운영하기](run-a-marketplace.md)를 보세요.

## 다음 단계

- [위젯 쓰기](use-widgets.md)
- [참조](../reference.md#명령줄-도구)
