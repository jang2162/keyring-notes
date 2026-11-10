<!-- source: docs/manual/en/how-to/publish-packages.md @ v0.12.0 -->
# 마켓 패키지 올리기

Keyring Notes 가 받아 쓸 수 있는 위젯·테마·언어 패키지 저장소를 만드는 방법입니다.

패키지를 만들거나 자기 저장소를 운영하는 분을 위한 문서입니다.

> [!NOTE]
> 앱은 테마와 언어를 설치해 씁니다. [패키지 설치하기](install-packages.md)를 보세요. 위젯 설치는 다음 릴리스에 들어옵니다. 위젯 패키지는 지금도 올릴 수 있습니다.

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

- 토큰 이름은 `--bg` 꼴입니다. 대시 둘 다음에 소문자·숫자·`-` 를 씁니다. 크기·글꼴·간격 토큰(`--fs-*`, `--font-*`, `--radius-*`, `--*-h`, `--*-w`)은 받지 않습니다. 테마는 색만 바꿉니다. 앱은 아래 표의 토큰만 읽습니다. 그 밖의 토큰은 무시하고, `pkg check` 가 경고합니다(`unknown_tokens`).
- 값은 `#rgb`, `#rrggbb`, `#rrggbbaa` 이거나, 괄호 안에 숫자·`%`·`deg`·빈칸·`,`·`/` 만 쓴 `rgb()`, `rgba()`, `hsl()`, `hsla()`, `oklch()`, `oklab()` 입니다. 그 밖의 값은 받지 않습니다. `red` 같은 이름, `var(…)`, `url(…)`, `;`·`{`·`}`·`!` 가 든 값도 받지 않습니다.
- 테마에 없는 토큰은 그 모드의 기본값을 씁니다.
- `light` 나 `dark` 한쪽만 가진 테마는 시스템 설정과 상관없이 늘 그 모드로 그립니다.

#### 테마 토큰

| 토큰 | 쓰는 곳 | 밝음 기본값 | 어두움 기본값 |
| --- | --- | --- | --- |
| `--bg` | 화면 바탕 | `#ffffff` | `#17191c` |
| `--bg-soft` | 옆 칸·코드 블록·입력 칸 바탕 | `#f6f7f9` | `#1f2226` |
| `--fg` | 본문 글 | `#1f2328` | `#e6e6e6` |
| `--muted` | 흐린 글 | `#6b7280` | `#9aa0a6` |
| `--border` | 선·테두리 | `#e3e6ea` | `#30343a` |
| `--accent` | 링크·단추·선택 | `#3b6fd8` | `#7aa2f7` |
| `--hover` | 마우스를 올린 줄 | `rgb(0 0 0 / 0.05)` | `rgb(255 255 255 / 0.06)` |
| `--active` | 선택한 줄 | `rgb(59 111 216 / 0.12)` | `rgb(122 162 247 / 0.16)` |
| `--focus-ring` | 키보드 초점 고리 | `rgb(59 111 216 / 0.55)` | `rgb(122 162 247 / 0.6)` |
| `--warn-bg` | 경고 바탕 | `#fff4e5` | `#3a2a12` |
| `--warn-fg` | 경고 글 | `#8a4b00` | `#f5c27a` |
| `--info-bg` | 안내 바탕 | `#eef4ff` | `#1d2a42` |
| `--danger` | 오류·지우기 같은 위험한 동작 | `#c0392b` | `#ff8a80` |
| `--danger-bg` | 오류 바탕 | `#fdeceb` | `#3a1c1a` |
| `--notice` | 알림 점(새 판 등) | `#e8590c` | `#ff9f43` |
| `--success` | 성공 글 | `#1d7438` | `#84d39f` |
| `--success-bg` | 성공 바탕 | `#eaf6ed` | `#16281c` |
| `--series` | 차트 계열 | `#3b6fd8` | `#5b8def` |
| `--cat-1` | 그래프 토픽 색 1 | `#2a78d6` | `#3987e5` |
| `--cat-2` | 그래프 토픽 색 2 | `#eb6834` | `#d95926` |
| `--cat-3` | 그래프 토픽 색 3 | `#1baf7a` | `#199e70` |
| `--cat-other` | 그래프: 그 밖의 토픽 | `#a3a29d` | `#6b6a66` |
| `--grid` | 차트 격자 | `#eceef1` | `#26292e` |
| `--axis` | 차트 축 | `#c9ced6` | `#3a3f46` |
| `--find-match` | 노트 안 찾기: 일치 | `rgb(250 204 21 / 0.4)` | `rgb(250 204 21 / 0.22)` |
| `--find-current` | 노트 안 찾기: 지금 일치 | `rgb(249 115 22 / 0.45)` | `rgb(249 115 22 / 0.5)` |
| `--tok-keyword` | 코드: 키워드 | `#8250df` | `#ff7b72` |
| `--tok-string` | 코드: 문자열 | `#0a3069` | `#a5d6ff` |
| `--tok-string2` | 코드: 그 밖의 리터럴 | `#116329` | `#7ee787` |
| `--tok-number` | 코드: 숫자 | `#0550ae` | `#79c0ff` |
| `--tok-comment` | 코드: 주석 | `#6e7781` | `#8b949e` |
| `--tok-def` | 코드: 정의 | `#6639ba` | `#d2a8ff` |
| `--tok-type` | 코드: 타입 | `#953800` | `#ffa657` |
| `--tok-prop` | 코드: 속성 | `#0550ae` | `#79c0ff` |
| `--tok-meta` | 코드: 메타 | `#57606a` | `#8b949e` |
| `--tok-deleted` | 코드: 지운 것 | `#82071e` | `#ffa198` |
| `--tok-invalid` | 코드: 잘못된 것 | `#cf222e` | `#ff7b72` |
| `--co-blue` | 콜아웃(파랑): 제목 | `#2f63c4` | `#8eb6ff` |
| `--co-blue-bg` | 콜아웃(파랑): 바탕 | `#eef4ff` | `#1a2436` |
| `--co-teal` | 콜아웃(청록): 제목 | `#0d7377` | `#74d2d5` |
| `--co-teal-bg` | 콜아웃(청록): 바탕 | `#e7f5f5` | `#142728` |
| `--co-green` | 콜아웃(초록): 제목 | `#1d7438` | `#84d39f` |
| `--co-green-bg` | 콜아웃(초록): 바탕 | `#eaf6ed` | `#16281c` |
| `--co-yellow` | 콜아웃(노랑): 제목 | `#845c00` | `#efcb6c` |
| `--co-yellow-bg` | 콜아웃(노랑): 바탕 | `#fff6d9` | `#2b2512` |
| `--co-orange` | 콜아웃(주황): 제목 | `#9c4700` | `#f4b07c` |
| `--co-orange-bg` | 콜아웃(주황): 바탕 | `#fff0e1` | `#31220f` |
| `--co-red` | 콜아웃(빨강): 제목 | `#b42318` | `#ff9c93` |
| `--co-red-bg` | 콜아웃(빨강): 바탕 | `#fdeceb` | `#331919` |
| `--co-purple` | 콜아웃(보라): 제목 | `#6a3ec0` | `#c6aaff` |
| `--co-purple-bg` | 콜아웃(보라): 바탕 | `#f3eefe` | `#241c36` |
| `--co-gray` | 콜아웃(회색): 제목 | `#565d69` | `#b5bbc5` |
| `--co-gray-bg` | 콜아웃(회색): 바탕 | `#f3f4f6` | `#22252a` |
| `--mark-bg` | 하이라이트 바탕(==글==) | `#fff0a0` | `#5c4d00` |
| `--mark-fg` | 하이라이트 글 | `#1f2328` | `#fff4c4` |

편집기의 선택·지금 줄 색, 그림자, 어두운 모드에서 편집기 안의 덧칠 색은 토큰이 아니라 모드(밝음·어두움)를 따릅니다.

#### 대비

앱은 테마가 그리는 모드마다 본문 글(`--fg`)과 바탕(`--bg`)의 대비를 WCAG 2 식으로 잽니다. 테마에 없는 토큰은 그 모드의 기본값으로 보고, 비치는 `--bg` 는 기본 바탕 위에 겹쳐 잽니다. 4.5:1 보다 낮으면 `pkg check` 가 경고하고(`contrast: light 3.2`), 앱은 테마를 설치하거나 고를 때 경고를 보입니다. 설치는 막지 않습니다. 비는 소수 첫째 자리에서 내리므로 경고에 4.5 가 보이는 일은 없습니다. 꼴 검사는 지났지만 앱이 색으로 읽지 못하는 값이면 비 대신 `?` 를 보입니다.

`language` 패키지의 `messages.json` 은 언어팩 파일과 같은 형식(`meta` 와 `messages`)입니다. 빠진 키가 있어도 되고, 그 자리는 기준 언어로 보입니다.

- `meta.id` 는 사용자가 고르는 언어 태그입니다(`ja`·`pt-BR` 등). 공식 언어(`en`·`ko`)는 쓸 수 없습니다.
- 앱은 기준 언어에 있는 키 중 값이 글자이고 `{name}` 같은 자리가 기준 언어와 같은 키만 씁니다. 나머지 키는 버리고 그 메시지는 기준 언어로 보입니다. `pkg check` 가 경고로 보입니다.
- 값은 HTML 처럼 보여도 늘 글자로 보입니다.
- 기기에 같은 `meta.id` 의 비공식 언어팩이 있으면 그 기기는 자기 언어팩을 씁니다. 설치한 패키지 둘이 같은 `meta.id` 면 먼저 설치한 것을 씁니다.

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
          "name": { "en": "Clock", "ko": "시계" },
          "description": { "en": "A desk clock" },
          "author": "me",
          "license": "MIT",
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
- `name`, `description`, `author`, `license` 는 매니페스트 필드를 옮겨 둔 선택 필드입니다. 둘러보기 표시용이라, 마켓플레이스가 저장소 하나를 받기 한 번으로 그릴 수 있습니다. 패키지를 설치한 뒤에는 앱이 (체크섬을 확인한) 매니페스트를 보입니다. `pkg index` 가 옮겨 씁니다.

| 표시 필드 | 형식 | 상한 |
| --- | --- | --- |
| `name` | 객체, 언어 태그 → 글 | 언어 20개, 각 100자 |
| `description` | 객체, 언어 태그 → 글 | 언어 20개, 각 500자 |
| `author` | 문자열 | 100자 |
| `license` | 문자열 | 100자 |

이 규칙을 어긴 표시 필드는 앱이 그 필드만 버리고 판은 그대로 씁니다. 그러면 패키지는 id 로 보입니다. `pkg index` 는 너무 긴 필드를 자르지 않습니다. 그 필드를 `index.json` 에 쓰지 않고 경고(`display_too_long: description.en`)를 보입니다. `pkg check` 도 같은 경고를 보입니다.

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

- `pkg check <폴더>` 는 매니페스트, 필수·허용 파일, 테마 색, 언어 키를 검사합니다. 오류가 있으면 종료 코드 `1` 로 끝나고, 빠진 언어 키, 모르는 테마 토큰, 낮은 대비 같은 경고는 실패 없이 보여 줍니다.
- `pkg index <폴더>` 는 `packages/` 아래 모든 패키지를 검사하고, 파일마다 크기와 체크섬을 재고, 매니페스트의 표시 필드를 옮겨 `index.json` 을 씁니다. 이름은 기존 `index.json` 의 `name`, 없으면 `--name`, 그것도 없으면 폴더 이름입니다. 파일이 그대로면 다시 실행해도 `index.json` 을 건드리지 않습니다.

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
