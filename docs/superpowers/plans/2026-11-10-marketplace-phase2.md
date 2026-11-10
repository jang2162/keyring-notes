# 마켓플레이스 2단계(언어와 테마) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마켓에서 받은 언어 패키지를 잠금을 따라 모든 기기의 화면 언어로 쓰고(기존 비공식 언어팩과 함께), 앱 색 토큰 목록을 `styles.css` 의 실제 변수로 고정해 받은 테마를 `html[data-theme]` 자리에 토큰만 덮어 그리며(밝음·어두움, 대비 4.5:1 경고, 늘 보이는 「기본 테마로 돌아가기」), 설정에 마켓플레이스 화면(저장소 더하기·빼기·순서, 둘러보기, 설치·제거, 새 판과 업데이트)을 더한다. 위젯 패키지는 목록에 보이되 설치는 3단계다.

**Architecture:** 형식·판정은 core 에 둔다 — 테마 토큰 목록과 밝음·어두움 기본값(`themeTokens.ts`), 색 읽기와 WCAG 대비(`color.ts`), `index.json` 판마다의 표시 필드(`marketFormat.ts`). 화면은 1단계 `web/src/market/state.ts` 의 `registerPackageKind` 에 종류별 적용자 둘을 건다: 테마 적용자는 sha256 을 다시 확인한 매니페스트를 읽어 테마 목록(`web/src/theme/apply.ts`)에 넘기고, 언어 적용자는 `messages.json` 을 `checkPack` 으로 걸러 i18n 의 마켓 층에 넘긴다. 고르기는 지금 화면 설정 동기화(`prefs.ts` 의 `theme`·`language`, 공통 → 이 기기에서만 다르게)를 그대로 탄다 — `theme` 값에 패키지 id 를 더한다. 테마 풀이는 DOM 없는 순수 함수(`theme/resolve.ts`)이고, DOM 에는 `data-theme`(늘 그리는 모드)와 `documentElement.style` 의 토큰만 쓴다. 마켓 화면은 순수 모델(`market/view.ts`)과 설정 묶음 하나(`MarketSettings.tsx`)다. 종류마다 「설치할 수 있는가·설치 때 알림」 표(`MARKET_KINDS`)를 두어 3단계가 위젯 줄만 바꾸면 된다.

**Tech Stack:** TypeScript, React 19, core(새 의존성 없음), 1단계 `web/src/market/*`, `localStorage`·IndexedDB(1단계 캐시), vitest(Node — DOM 없음), Playwright chromium·webkit(화면 확인).

**Spec:** `docs/superpowers/specs/2026-11-10-marketplace-design.md` — 「단계」 의 **2단계**와, 그것이 다루는 「테마 토큰」·「설치·제거·업데이트 화면」·「제약」 의 언어 줄. 실행자는 설계와 이 계획 둘 다 읽는다. 둘이 다르면 설계가 원본이고, 다르다는 것을 보고한다. 1단계 계획 `docs/superpowers/plans/2026-11-10-marketplace-phase1.md` 「2·3단계 인터페이스」 와 `docs/ops/ux.md` 「마켓플레이스 1단계 구현」 의 정한 것이 그대로 이어진다.

## 확인한 것 (계획 단계, 2026-11-10 — 기준 커밋 `b306345`)

- **1단계가 준 자리:** `MarketState` 의 `installedPackages`·`readPackageFile`(잠금의 sha256 으로 다시 확인)·`readPackageText`·`onPackagesChange`·`registerPackageKind(type, { apply })`·`repoIndexes`·`installPackage(id, { version?, repo? })`·`uninstallPackage`·`marketAvailability`·`reconcile`. `registerPackageKind` 는 **등록하는 순간 지금 목록으로 한 번 부른다** — 앱 시작 직후에는 첫 맞추기 전이라 빈 목록이다. 그대로 적용하면 받은 테마가 시작 때마다 기본 → 받은 테마로 깜빡인다(아래 Task 5 의 `ready()`·시작 캐시).
- **`InstalledPackage.manifest` 는 캐시에서 sha256 확인 없이 읽은 것이다**(`describe` → `manifestOf`). 적용자는 이것을 쓰지 않고 `readPackageText(id, "keyring-package.json")` 로 다시 읽는다.
- **`index.json` 에는 이름·설명·작성자·라이선스가 없다** — 각 판의 매니페스트에만 있다. 코디네이터 결정으로 판마다 선택 필드를 더한다(아래 「코디네이터 답」).
- **색 토큰(`styles.css`):** 맨 앞 `:root`(2–49줄), 코드 색 `--tok-*`(171–186줄), 콜아웃·하이라이트 `--co-*`·`--mark-*`(429–466줄)에 있고, 셋 다 `:root[data-theme="dark"]` 와 `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` 두 벌로 어두운 값을 갖는다. **`--focus` 는 색이 아니라 그림자 값**(`0 0 0 2px var(--bg), 0 0 0 4px rgb(…)`)이라 core `isThemeColor` 가 거부한다. 설계의 예 목록에 `--focus` 가 있으므로 색 부분을 새 토큰 `--focus-ring` 으로 떼어 낸다.
- **테마를 따라가는 자리:**
  - PWA theme-color: `themeColor.ts` 가 `THEME_BG`(고정 두 색)로 메타 두 벌을 쓴다 → 받은 테마의 `--bg` 를 받게 바꾼다.
  - 코드 색: `--tok-*` 변수라 토큰에 넣으면 따라간다. 편집기의 어두운 덧칠(`.cm-activeLine`·선택 색 등 `:root[data-theme="dark"] .cm-*`)은 고정 색이라 **모드만** 따라간다.
  - mermaid: `enhance.ts` `isDark()` 가 `data-theme`(없으면 시스템)로 mermaid 의 밝음·어두움 팔레트를 고른다 → 모드만 따라가고 토큰 색은 쓰지 않는다(알려진 한계로 문서에).
  - 위젯 iframe: `widgets/mount.ts` `readTheme()` 가 `getComputedStyle` 로 7개 토큰(`frame/themeTokens.ts`)을 읽어 넘기고, `data-theme` 속성과 `prefers-color-scheme` 바뀜만 본다. 토큰을 `style` 로 덮으면 **바뀜을 놓친다** → `attributeFilter` 에 `"style"`. 사용자 정의 속성의 계산값은 적은 글 그대로라(`oklch(…)` 그대로) Excalidraw `isDark(bg)`(16진 3·6자리·`rgb()` 만 읽음)가 밝음으로 잘못 고른다 → `readTheme` 이 색을 16진으로 바꿔 넘긴다.
  - 그래프: `Graph.tsx` 가 그릴 때 `cssVar()` 로 읽고 테마 바뀜을 듣지 않는다 → 적용 알림을 듣고 다시 그린다.
- **`documentElement.style` 을 쓰는 코드는 지금 없다**(검색 0건) — 테마 토큰을 거기 두어도 다른 것과 부딪히지 않는다.
- **비공식 언어팩:** `meta.id` 는 언어 태그(`ja`·`pt-BR`)이고 `checkPack` 이 공식 id·`pseudo` 를 거부, 기준에 없는 키를 버리고(`unknown`), 자리가 다른 키를 버린다(`placeholderMismatch` — 그 키만 기준 언어로). 빠진 키는 사슬(`build`)이 기준 언어 → 영어로 메운다. 고른 언어의 팩이 없으면 `missingPack()` 이 알리고 기준 언어로 보인다. 마켓 언어 패키지 id(`@scope/name`)와 언어 id(`meta.id`)는 다른 것이다 — **고르기 값은 언어 id** 다.
- **`prefs.ts` `valid()` 는 `theme` 을 `["system","light","dark"]` 로만 받는다** — 옛 앱 판의 기기는 `ui.theme: "@me/sea"` 를 버리고 기본값(시스템)으로 보인다. 그대로 두면 되는 뒤 호환이다.
- 설정 묶음(`Settings.tsx` `SECTIONS`)은 `local`(기기 볼트만)·`server`(서버 모드만) 표시가 있고, 마켓 화면은 모든 모드에 보인다(브라우저 기기 볼트에 동기화가 없으면 `market.unavailable`).

## 코디네이터 답과 이 계획의 판단

- **코디네이터 결정 — 둘러보기 표시 필드(A):** `index.json` 판마다 선택 필드 `name`·`description`(언어 태그 → 글)·`author`·`license` 를 `pkg index` 가 매니페스트에서 옮겨 쓴다. `format` 은 1 그대로, 없으면 화면은 id 만 보인다. `parseRepoIndex` 는 같은 검사로 읽고 틀리면 **그 필드만** 버린다. 이 필드는 둘러보기 표시용일 뿐이다 — **설치 판정·적용은 늘 sha256 을 확인한 매니페스트가 원본이고, 둘이 다르면 설치 뒤 화면은 매니페스트를 보인다.** `publish-packages` en·ko 의 index 형식 표도 함께 고친다. 설계 문서의 해당 줄은 코디네이터가 고친다(이 계획은 설계를 고치지 않는다).
- **정한 것(워커):**
  - **테마 토큰 목록(55개, `styles.css` 순서):**
    - 바탕·글·선: `--bg`·`--bg-soft`·`--fg`·`--muted`·`--border`·`--accent`·`--hover`·`--active`·`--focus-ring`(새로)
    - 알림·상태: `--warn-bg`·`--warn-fg`·`--info-bg`·`--danger`·`--danger-bg`·`--notice`·`--success`·`--success-bg`
    - 차트·그래프: `--series`·`--cat-1`·`--cat-2`·`--cat-3`·`--cat-other`·`--grid`·`--axis`
    - 노트 안 찾기: `--find-match`·`--find-current`
    - 코드 색: `--tok-keyword`·`--tok-string`·`--tok-string2`·`--tok-number`·`--tok-comment`·`--tok-def`·`--tok-type`·`--tok-prop`·`--tok-meta`·`--tok-deleted`·`--tok-invalid`
    - 콜아웃·하이라이트: `--co-{blue,teal,green,yellow,orange,red,purple,gray}` 와 각 `-bg`, `--mark-bg`·`--mark-fg`

    밝음·어두움 기본값은 `styles.css` 의 지금 값 그대로다(시험이 맞춰 본다). **넣지 않는 것:** `--shadow*`·`--focus`(그림자 꼴), `--sp-*`·`--fs-*`·`--radius*`·`--font-*`·`--*-w`·`--*-h`·`--lights-w`, 규칙 안 국소 변수(`--co`·`--co-bg`·`--li-indent`·`--task-lh`·`--fold-lh`·`--bar-h`·PDF 변수), 규칙에 박힌 고정 색(편집기 어두운 덧칠·`.sync-button.has-error` 등 — 모드만 따라간다).
  - **`--focus-ring`:** 밝음 `rgb(59 111 216 / 0.55)`, 어두움 `rgb(122 162 247 / 0.6)`. `--focus` 는 `:root` 한 곳에서 `0 0 0 2px var(--bg), 0 0 0 4px var(--focus-ring)` 로 두고 어두운 두 벌에서는 뺀다(보이는 것은 그대로).
  - **테마 고르기 값:** `Prefs.theme` 는 `"system" | "light" | "dark" | <패키지 id>`. 하나만 고른다(설계: 「밝게·어둡게·시스템」 과 받은 테마 중에서). 받은 테마가 **밝음·어두움 둘 다** 가지면 시스템 설정을 따라 고르고, **한쪽만** 가지면 늘 그쪽으로 그린다. 잘못된 꼴(`@../x`)은 `valid()` 가 버린다.
  - **적용 방법:** 받은 테마를 그릴 때 `data-theme` 을 그리는 모드(`light`·`dark`)로 **늘 정해 두고**, `documentElement.style.setProperty(token, value)` 로 그 모드의 토큰만 덮는다. CSS 글을 만들지 않으므로 값이 규칙 밖으로 새는 길이 없고, 값은 그래도 `isThemeColor` 를 지난 것만, 이름은 `THEME_TOKENS` 에 있는 것만 쓴다(모르는 토큰은 버린다). `data-theme` 이 정해져 있으므로 모드에 걸린 모든 자리(편집기 덧칠·`color-scheme`·mermaid·위젯)가 그대로 따라간다.
  - **시작 깜빡임:** 고른 받은 테마 하나(`{ id, version, name, colors }`)를 `localStorage` `keyring:theme-cache` 에 두고 시작 때 그것으로 먼저 그린다(값은 읽을 때 다시 검사). 마켓 상태가 **첫 맞추기를 마치기 전**(`ready()` 가 거짓)에는 적용자가 받은 빈 목록으로 캐시를 지우지 않는다. 언어도 같은 꼴로 `keyring:langpack-market-cache`(고른 마켓 언어 하나).
  - **`MarketState.ready(): boolean` 을 더한다(1단계 인터페이스를 넓힘):** 공통 설정을 읽은 `reconcileOnce` 가 **`installed = next` 와 `notify()` 사이**에 참으로 세운다 — 적용자는 `notify` 안에서 불리므로, 뒤에 세우면 첫 맞추기 결과를 받은 적용자가 거짓을 보고 돌아가 캐시 없는 새 기기에서 받은 테마·언어가 다음 설정 바뀜까지 그려지지 않는다(리뷰 1). 공통 설정을 아직 못 읽었거나 깨졌으면 거짓 — 그동안 적용자는 시작 캐시를 유지한다(오프라인에서 이미 깐 테마·언어가 사라지지 않게).
  - **고른 테마가 이 기기에 없을 때**(설치 안 됨·받는 중·받지 못함·`incompatible`·sha 불일치): 기본(시스템)으로 그리고, 설정의 테마 줄에 「고른 테마 `<이름 또는 id>` 가 이 기기에 없어 기본 테마로 보입니다」 와 그 패키지의 `market.status.*`. 고르기 값은 바꾸지 않는다(받아지면 저절로 돌아온다).
  - **「기본 테마로 돌아가기」:** 설정 「일반」 테마 줄 바로 아래 **늘 보이는** 단추(지금 값이 패키지가 아니면 꺼짐), 명령 팔레트 명령 `cmd.themeReset`(늘 있음), 그리고 주소 `?theme=default`(이번 열기에만 받은 테마를 그리지 않음 — 화면을 읽을 수 없어 설정에 갈 수 없을 때). **`?theme=default` 는 주소창이 있는 곳에서만 닿는다(리뷰 7):** 데스크톱 앱과 설치한 PWA(독립 창)는 주소창이 없다. 길을 셋으로 문서에 적는다 — 데스크톱·웹: 명령 팔레트(`Mod+K` → 「기본 테마」), 브라우저 웹: `?theme=default`, 모바일(PWA·앱 — 키보드 단축키 없음): 같은 볼트를 브라우저에서 `?theme=default` 로 열어 설정에서 되돌리거나(공통 값이면 모든 기기에 닿는다), 공통 설정 파일 `keyring-settings.md` 의 `ui.theme` 를 지운다. **escape 로 연 동안에는 시작 캐시를 읽지도 지우지도 않는다** — 지우면 다음 오프라인 열기에서 받은 테마가 빠진다. 쿼리 값은 `"default"` 와 같은지만 보고(다른 값은 무시), 하는 일은 받은 테마를 끄는 것뿐이라 링크로 악용할 거리가 없다. 지금 `theme` 쿼리를 읽는 곳은 없다(`lang`·`local`·`solo` 만). 단추·명령은 `setPrefs({ theme: "system" })` — 「이 기기에서만 다르게」 를 켠 기기에서는 그 기기 값만, 아니면 공통 값이 바뀐다(지금 규칙 그대로).
  - **대비 계산:** WCAG 2 상대 휘도. 채널 `c = v/255`, `c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`, `L = 0.2126R + 0.7152G + 0.0722B`, 비 `(L밝은+0.05)/(L어두운+0.05)`. 재는 쌍은 **본문 글 `--fg` 와 배경 `--bg`**, 테마가 그리는 모드마다. 테마에 없는 토큰은 그 모드 기본값. `--bg` 가 반투명이면 그 모드의 기본 `--bg` 위에, `--fg` 가 반투명이면 (합친) `--bg` 위에 합성한다. 기준 **4.5**, 보일 때는 소수 첫째 자리 **내림**(4.48 → 4.4 — 「4.5」 로 보이는데 경고가 뜨는 일이 없게). 색을 읽지 못하면(꼴은 지났는데 계산할 수 없음) 「대비를 확인할 수 없습니다」 로 같은 경고 자리에. 경고는 **막지 않는다** — 마켓 화면의 설치된 테마 줄(설치 직후 포함)과 설정 테마 줄(고를 때)에 보이고, `pkg check` 도 경고로 센다.
  - **PWA theme-color:** 받은 테마를 그리면 메타 두 벌 다 그 모드의 `--bg` 를 `#rrggbb` 로(반투명은 기본 `--bg` 위에 합성) — 일부 브라우저가 메타에서 `oklch()` 를 읽지 못한다.
  - **언어 id 가 겹칠 때:** 이 기기 비공식 언어팩과 마켓 언어 패키지가 같은 `meta.id` 면 **이 기기 언어팩을 쓴다**(사람이 이 기기에 일부러 넣은 것이고, 번역하는 사람이 마켓 판 위에서 자기 고침을 보는 흐름을 지킨다). 언어 목록에는 하나만 보이고 「이 기기 언어팩이 마켓 패키지 `<id>` 를 가림」 을 단다. 마켓 패키지 둘이 같은 `meta.id` 면 **잠금 순서의 앞 것**을 쓰고, 마켓 화면의 뒤 것 줄에 「같은 언어(`ja`)를 `<앞 패키지>` 가 쓰는 중」.
  - **언어 패키지가 공식 키를 덮는 범위:** `checkPack` 을 그대로 쓴다 — 기준 언어에 있는 키만, 글자만, 자리(`{name}`)가 기준과 같은 키만 쓴다. 빠진 키·버린 키는 기준 언어(`meta.base`) → 영어로 보인다. 받은 HTML 같은 글은 지금처럼 글자로만 그린다. 마켓 화면의 언어 줄에 빠진 키·버린 키 수를 보인다(`PackReport`).
  - **제거하면:** 화면은 저절로 기본으로 돌아간다(적용자가 빠진 것을 받는다). 마켓 화면에서 지운 경우에는 더해 `clearRemovedChoice` 로 이 기기 덮어쓰기와 공통 값이 그 테마 id(또는 그 패키지만 주던 언어 id)를 가리키면 `"system"`(언어는 `""`)으로 되돌린다 — 다른 기기에 「없음」 안내가 남지 않게. 동기화로 잠금에서 빠진 것(화면을 거치지 않음)은 고르기 값을 건드리지 않는다.
  - **새 판:** 마켓 화면을 열 때(그리고 「새로 고침」) 저장소 목록을 받아 본다. 배경 확인은 두지 않는다(나가는 요청을 늘리지 않는다). **서버의 `index.json` 캐시(5분, `marketCache.ts` `index()`)에 막히지 않게(리뷰 3):** `GET /api/market/index` 에 `fresh=1` 을 더한다 — 그 저장소의 캐시가 **10초보다 오래됐으면** 버리고 다시 받는다(10초 안이면 캐시 그대로 — 화면을 연달아 열거나 단추를 연타해도 저장소로 나가는 요청은 저장소마다 10초에 한 번). 실패 캐시(30초)도 같은 규칙. 마켓 화면은 묶음을 열 때와 「새로 고침」 에 `fresh` 로 묻고, 그 밖의 길(설치 판정 등)은 지금처럼 캐시를 쓴다. 앱 네이티브 받기는 캐시가 없어 늘 새로 받는다. 서버 API 가 바뀌므로 `reference.md` en·ko 와 `/llms.txt`(`server/src/llmsTxt.ts`)를 같은 커밋에. 「새 판 있음」 = 잠금의 저장소 index 에서 `latestVersion(…, APP_VERSION)` 이 잠금 판보다 높음. 업데이트 = `installPackage(id, { version: latest })`(잠금의 `repo` 고정은 1단계 `resolveInstall` 이 지킨다).
  - **저장소 목록 고치기:** `updateVaultSetting(["marketplace", "repos"], repos.map((url) => ({ url })))`(설계의 YAML 꼴). 더할 때 `normalizeRepoUrl(input, { allowHttp: true })` — `http:` 는 기록으로는 받고, 받을 수 있는지는 받는 쪽이 판정해 그 저장소 줄에 오류로 보인다. 같은 정규형이 있으면 `market_repo_duplicate`. 공식도 뺄 수 있고, 빠져 있으면 「공식 저장소 다시 더하기」. 순서는 위·아래 단추(끌기 없음 — 키보드·화면 읽기 프로그램).
  - **앱 기기 설정 화면:** Tauri 앱(모드 `app`·`app+sync`)에만 「이 기기에서 `http:` 저장소 허용」·「사설 주소 허용」 확인란(`keyring:market:device`, 동기화되지 않음, 1단계가 값만 읽던 것). 바꾸면 `reconcile()`.
  - **3단계가 그대로 더할 자리:** `MARKET_KINDS: Record<PackageType, { label: string; installable: boolean; installNotice?: string }>` — 2단계는 `widget.installable = false`(둘러보기에 보이고 설치 단추는 꺼짐, 「위젯 설치는 다음 판에서」). 3단계는 그 줄을 `true` 와 WebRTC 알림 키로 바꾸고 적용자를 건다. 마켓 화면은 종류를 이 표로만 가른다.
- **구현자 몫:** 화면 문구(키 이름은 아래), 마켓 화면의 정확한 모양(아래 390px·키보드 조건 안에서), 언어 시작 캐시가 저장소 한도를 넘을 때(조용히 캐시 없이 — 깜빡임만 남는다), 그래프 다시 그리기 방법, `oklch()`·`oklab()` 변환의 세부(아래 시험 벡터 안에서).

## Global Constraints

- 웹 CSP 는 그대로다(`connect-src 'self'`). 서버 `APP_CSP`·`tauri.conf.json` `security.csp` 를 바꾸지 않는다. 서버 API 바뀜은 `GET /api/market/index` 의 `fresh=1` 하나뿐이다(Task 8 — `reference.md` en·ko·`/llms.txt` 같은 커밋).
- 테마가 바꾸는 것은 `THEME_TOKENS` 의 색 토큰뿐이다(설계 ①). 값은 `isThemeColor` 를 지난 것만 DOM 에 닿는다 — 받은 파일, 시작 캐시, 어느 길이든. 테마가 CSS 글(`<style>`)을 만들지 않는다.
- 패키지 내용은 늘 `readPackageText`(잠금의 sha256 으로 다시 확인)로 읽는다. `InstalledPackage.manifest` 와 index 의 표시 필드는 보여 주기에만 쓴다.
- `engines` 가 맞지 않거나 받지 못한 패키지는 그 기기에서만 기본(테마)·기준 언어로 보이고, 잠금과 고르기 값은 바꾸지 않는다.
- 언제든 기본 테마로 돌아갈 수 있다: 설정 단추(늘 보임)·명령 팔레트·`?theme=default`.
- 기존 비공식 언어팩(`keyring:langpacks`)은 그대로 불러오고 고칠 수 있다.
- 새 CSS 에 고정 색을 쓰지 않는다 — 토큰만(밝은·어두운·받은 테마가 다 맞게).
- 화면 글은 `packages/core/src/messages/{en,ko}.json` 같은 커밋, en·ko 같은 키(`packages/core/test/i18n.test.ts`), 알파벳 자리에 손으로. 새 키: `settings.marketplace`·`settings.marketplaceKeywords`, `market.*`(아래 Task 마다), `theme.reset`·`theme.resetHint`·`theme.package`·`theme.packageMissing`·`theme.contrastLow`·`theme.contrastUnknown`·`theme.onlyLight`·`theme.onlyDark`, `cmd.themeReset`·`cmd.marketplace`, `lang.market`·`lang.shadowed`, `error.market_repo_duplicate`. 사용자 문서는 `docs/manual/{en,ko}/` 같은 커밋.
- 새 npm 의존성 없음. 시험은 Node(vitest, DOM 없음) — DOM 에 닿는 부분은 얇게 두고 순수 함수를 시험한다. 명령: core `cd packages/core && pnpm exec vitest run`, server `pnpm --filter @keyring-notes/server test`, web `cd web && pnpm exec vitest run`, 타입 `pnpm typecheck`, 웹 빌드 `pnpm --filter @keyring-notes/web build`, 형식·린트 `pnpm fmt:check`·`pnpm lint`. 시작 전에 패키지별 시험 개수를 적어 두고 끝에 늘었는지 본다.
- 커밋 메시지는 한국어(`feat(core): …`·`feat(server): …`·`feat(web): …`·`docs: …`), 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 파일은 경로로 stage. `docs/ops/ux.md` 는 고치지 않는다. `git stash` 금지.

## Review Focus

1. **본문 글과 배경이 같은 색인 테마(`--fg` = `--bg`)를 모든 기기에 고름** — 화면을 읽을 수 없어도 길마다 돌아올 수 있다: 브라우저 웹은 `?theme=default`, 데스크톱 앱·웹은 명령 팔레트(`Mod+K` → 「기본 테마」), 주소창·단축키가 없는 모바일(PWA·앱)은 같은 볼트를 브라우저에서 `?theme=default` 로 열어 공통 값을 되돌림(또는 `keyring-settings.md` 의 `ui.theme` 지움). escape 로 연 번에 시작 캐시가 지워지지 않는다. 설치·고를 때 대비 경고가 보인다. (Task 2: `themeContrast` 1:1, Task 4: `escape`, Task 6: 단추·명령, 검문 2 화면)
2. **고른 받은 테마가 이 기기에 없음 — 새 기기·`engines` 가 안 맞음·받는 중·sha 불일치, 그리고 시작 캐시의 판이 잠금과 다름** — 기본으로 그리고 안내를 보이며, 낡은 캐시를 받은 테마로 계속 그리지 않는다(맞추기를 마친 뒤). 공통 설정을 읽지 못한 오프라인에서는 시작 캐시를 유지한다. (Task 4: `resolveTheme` missing, Task 5: `ready()`·캐시 판 대조 시험)
3. **한쪽 모드만 가진 테마를 시스템이 어두운 기기에서 고름** — 그 테마의 모드(밝음)로 그리고 `data-theme="light"`, PWA 메타 두 벌이 그 `--bg`, 편집기·mermaid·위젯이 밝음으로 맞는다. 둘 다 가진 테마는 시스템 설정이 바뀌면 다시 그린다. (Task 4 시험, Task 5 `matchMedia`, 검문 2 화면)
4. **같은 언어 id(`ja`)가 이 기기 언어팩과 마켓 패키지 둘에 다 있음, 그리고 자리가 기준과 다른 키·기준에 없는 키·HTML 같은 글이 든 언어 패키지** — 이 기기 언어팩이 쓰이고 목록에 하나만 보이며, 잘못된 키는 그 키만 기준 언어로 보이고 HTML 은 글자로 보인다. (Task 7 시험)
5. **손으로 고친 시작 캐시·공통 설정(`ui.theme: "@me/x"` 인데 캐시 `colors` 에 `"red; background: url(x)"`, `ui.theme: "@../x"`)** — 캐시 값은 다시 검사해 버리고, 잘못된 고르기 값은 기본으로 읽는다. 옛 앱 판 기기는 `"@me/x"` 를 시스템으로 읽는다. (Task 4: `valid` 시험, Task 5: 캐시 읽기 시험)

---

### Task 1: core — 테마 토큰 목록과 기본값, `--focus-ring`

**Files:**
- Create: `packages/core/src/themeTokens.ts`
- Modify: `packages/core/src/index.ts`(내보내기), `web/src/styles.css`(`--focus-ring` 와 `--focus`)
- Test: `web/src/theme/tokens.test.ts`(styles.css 를 읽으므로 web 쪽), `packages/core/test/themeTokens.test.ts`

**Interfaces:**
- Produces: `THEME_TOKENS: readonly string[]`(위 55개, 위 순서), `THEME_DEFAULTS: { light: Record<string, string>; dark: Record<string, string> }`(키 = `THEME_TOKENS` 전부).

- [ ] **Step 1: 실패하는 시험**
  - core `themeTokens.test.ts`: `THEME_TOKENS` 가 55개·중복 없음·모두 `checkThemeColors({ light: { [t]: "#000" } }).errors` 가 빈 배열(크기·글꼴 꼴에 걸리지 않음), `--focus`·`--shadow`·`--sp-1` 은 목록에 없음. `THEME_DEFAULTS.light`·`.dark` 의 키가 `THEME_TOKENS` 와 같고 값이 모두 `isThemeColor`.
  - web `tokens.test.ts`: `readFileSync(new URL("../styles.css", import.meta.url))` 에서 `:root {…}`·`:root[data-theme="dark"] {…}`·`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` 블록들의 선언을 모아 — (1) 밝음 값 = `THEME_DEFAULTS.light`, (2) 어두움 값 = `THEME_DEFAULTS.dark`, (3) 미디어 쿼리 벌 = `[data-theme="dark"]` 벌(두 벌이 어긋나지 않음), (4) `:root` 의 색 꼴 선언 중 `THEME_TOKENS` 에 없는 것이 없음(새 색 변수를 더하고 목록을 잊으면 실패), (5) `--focus` 가 `var(--focus-ring)` 을 쓰고 어두운 벌에 없음.
- [ ] **Step 2: 실행해 실패 확인** — `cd packages/core && pnpm exec vitest run test/themeTokens.test.ts`, `cd web && pnpm exec vitest run src/theme/tokens.test.ts` → FAIL(모듈 없음).
- [ ] **Step 3: 구현** — `themeTokens.ts` 에 두 상수(값은 styles.css 에서 옮겨 적음). `styles.css`: `:root` 에 `--focus-ring: rgb(59 111 216 / 0.55)`, `--focus: 0 0 0 2px var(--bg), 0 0 0 4px var(--focus-ring)`, 어두운 두 벌의 `--focus` 를 `--focus-ring: rgb(122 162 247 / 0.6)` 으로 바꾼다. `themeColor.ts` 의 `THEME_BG` 는 `THEME_DEFAULTS[mode]["--bg"]` 로 바꾼다(지금 시험이 계속 지나야 한다).
- [ ] **Step 4: 통과 확인** — 위 두 명령 + `cd web && pnpm exec vitest run src/themeColor` → PASS.
- [ ] **Step 5: 커밋** — `feat(core): 테마 색 토큰 목록과 밝음·어두움 기본값, 초점 고리 색 토큰`

### Task 2: core — 색 읽기와 대비, `pkg check` 의 테마 경고

**Files:**
- Create: `packages/core/src/color.ts`
- Modify: `packages/core/src/marketFormat.ts`(`checkPackageFiles` 의 테마 경고, `isThemeColor` 를 `color.ts` 로 옮기고 다시 내보냄), `packages/core/src/index.ts`
- **import 는 한 방향:** `marketFormat.ts` → `color.ts`. `isThemeColor`(와 그 정규식)를 `color.ts` 로 옮겨 `parseCssColor` 가 같은 파일의 그것을 먼저 부르고, `marketFormat.ts` 는 `export { isThemeColor } from "./color.js"` 로 지금 이름을 지킨다(리뷰 — 서로 import 하면 함수만 오갈 때는 돌지만 깨지기 쉽다). `color.ts` 는 `themeTokens.ts` 만 import 한다.
- Test: `packages/core/test/color.test.ts`, `packages/core/test/marketManifest.test.ts`

**Interfaces:**
- Consumes: `THEME_DEFAULTS`, `THEME_TOKENS`(Task 1), `isThemeColor`, `checkThemeColors`(1단계).
- Produces:
  - `interface Rgba { r: number; g: number; b: number; a: number }`(r·g·b 0–255 실수, a 0–1)
  - `parseCssColor(value: string): Rgba | null` — `isThemeColor` 가 거짓이면 null. 16진 3·6·8자리, `rgb()`·`rgba()`(쉼표·빈칸 꼴, `%`, `/ 알파`), `hsl()`·`hsla()`(`deg` 또는 단위 없음), `oklab()`·`oklch()`(L 은 `%` 또는 0–1, CSS Color 4 의 OKLab → 선형 sRGB 행렬, 범위 밖은 0–1 로 자름).
  - `toHex(c: Rgba): string` — 불투명이면 `#rrggbb`, 아니면 `#rrggbbaa`(소문자).
  - `composite(top: Rgba, under: Rgba): Rgba`(결과 불투명은 `under.a === 1` 일 때)
  - `contrastRatio(fg: Rgba, bg: Rgba): number` — fg 를 bg 위에 합성한 뒤 위 식(bg 는 불투명이어야 한다 — 아니면 그 자체를 흰 바탕에 합성).
  - `CONTRAST_MIN = 4.5`
  - `themeContrast(colors: PackageManifest["colors"], mode: "light" | "dark"): number | null` — 위 「대비 계산」 규칙. 그 모드 색이 테마에 없으면 null 이 아니라 **기본값끼리**의 비(테마가 그 모드를 그리지 않으면 부르는 쪽이 부르지 않는다).
  - `contrastLabel(ratio: number): string` — 소수 첫째 자리 내림(`4.48 → "4.4"`, `21 → "21.0"`).

- [ ] **Step 1: 실패하는 시험** — `color.test.ts`:
  - `toHex(parseCssColor("#abc")!) === "#aabbcc"`, `"#11223380"` → `a ≈ 0.502`, `"rgb(255 0 0)"`·`"rgba(255, 0, 0, 1)"`·`"rgb(100% 0% 0%)"` → `#ff0000`, `"hsl(120deg 100% 25%)"` → `#008000`, `"oklch(62.8% 0.2577 29.23)"` → `#ff0000`(채널 ±1), `"oklch(0 0 0)"` → `#000000`, `"oklch(1 0 0)"` → `#ffffff`, `"oklab(0.5 -0.1 0.1)"` 는 null 이 아님. `"red"`·`"url(x)"`·`"rgb(1 2 3); x"` → null.
  - `contrastRatio(#000, #fff) === 21`, `#777 on #fff` → `4.47…`(< 4.5), `#767676 on #fff` → `4.54…`(≥ 4.5), 반투명 `rgb(0 0 0 / 0.5)` on `#fff` = `#808080` on `#fff` 의 비.
  - `themeContrast({ light: { "--fg": "#fff", "--bg": "#fff" } }, "light") === 1`, `themeContrast({ dark: { "--bg": "#000" } }, "dark")` = 기본 어두운 `--fg`(`#e6e6e6`) on `#000`, 반투명 `--bg`(`rgb(255 255 255 / 0)`)는 기본 밝은 `--bg` 위에 합성(= 기본값끼리와 같음).
  - `contrastLabel(4.48) === "4.4"`, `contrastLabel(4.5) === "4.5"`.
  - `marketManifest.test.ts`: 테마 패키지 `checkPackageFiles` 의 `warnings` 에 모르는 토큰(`"unknown_tokens: --zz"`)과 낮은 대비(`"contrast: light 1.0"`)가 들고, 기본 대비 이상이면 대비 경고가 없음. 오류는 그대로(주입 값은 여전히 `market_manifest_invalid`).
- [ ] **Step 2: 실패 확인** — `cd packages/core && pnpm exec vitest run test/color.test.ts test/marketManifest.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 위 서명대로. `checkPackageFiles` 의 테마 갈래: `checkThemeColors(colors, THEME_TOKENS).unknownTokens` 가 있으면 경고 하나, 테마가 가진 모드마다 `themeContrast` 가 null 이거나 `< CONTRAST_MIN` 이면 `contrast: <mode> <contrastLabel 또는 "?">`.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. `pnpm keyring pkg check` 가 경고를 실패 없이 보이는지 `server/test/pkgCli.test.ts` 에 테마 픽스처 하나로 확인(경고 줄, 종료 코드 0).
- [ ] **Step 5: 커밋** — `feat(core): 색 값 읽기와 WCAG 대비, 테마 패키지 검사의 모르는 토큰·낮은 대비 경고`

### Task 3: core·server — `index.json` 판마다 표시 필드(코디네이터 결정 A)

**Files:**
- Modify: `packages/core/src/marketFormat.ts`(`IndexVersion`·`parseIndexVersion`), `server/src/pkgCli.ts`(`buildRepoIndex`·`serialize`·`checkPackageDir` 경고), `server/test/fixtures/market/`(**커밋된 시험 픽스처 — 이 Task 만 고친다**: 테마·언어 패키지 셋을 더하고 `index.json` 을 다시 만듦. 있는 판은 바꾸지 않는다 — `@me/sea` 는 `0.1.0` 그대로), `docs/manual/{en,ko}/how-to/publish-packages.md`(index 형식 표·테마 토큰 표)
- Test: `packages/core/test/marketFormat.test.ts`, `server/test/pkgCli.test.ts`, 그리고 **픽스처 목록에 기대는 시험들을 함께 맞춘다**: web `web/src/market/source.test.ts`(`index` 의 패키지 id 목록 — 지금 `["@me/clock", "@me/sea"]`)·`state.test.ts`, server `marketCache.test.ts`·`market.test.ts`·`marketServe.test.ts` 중 픽스처 `index.json` 의 id·sha 를 세는 것(`grep -rn "fixtures/market" server/test web/src` 로 찾는다)

**Interfaces:**
- Produces: `displayText(rec: Record<string, string> | undefined, lang: string): string | null`(`marketFormat.ts` — 언어 태그 → 글 묶음에서 보일 글: 같은 태그 → 같은 첫 조각(`ko-KR` → `ko`) → `en` → 처음 것). `IndexVersion` 에 선택 필드 `name?: Record<string, string>`·`description?: Record<string, string>`·`author?: string`·`license?: string`. 상한: 언어 태그 20개, `name` 값 100자·`description` 값 500자·`author`·`license` 100자. 하나라도 틀리면 **그 필드만** 빼고 판은 그대로(`ignored` 에 세지 않는다). 상한은 상수 `INDEX_TEXT_LIMITS = { tags: 20, name: 100, description: 500, author: 100, license: 100 }` 하나로 두고 쓰는 쪽이 다 같이 본다. **매니페스트(`langText`)는 상한이 없어 어긋난다(리뷰 5):** 매니페스트 검사는 바꾸지 않고(이미 받은 패키지를 깨지 않게), `checkPackageFiles` 가 상한을 넘는 필드를 경고 `display_too_long: <필드>[.<태그>]` 로 세고(`pkg check` 가 보인다), `buildRepoIndex` 는 그 필드를 index 에 **쓰지 않고**(자르지 않는다 — 글을 몰래 바꾸지 않게) 같은 경고를 `pkg index` 출력에 한 줄씩 낸다. 그래서 「앱이 조용히 버려 id 만 보임」 이 작성자에게 보인다. 설치 뒤 화면은 매니페스트 그대로(긴 글은 CSS 로 줄임).
- 픽스처(검문 2·3 의 시험 자료): `@me/sea@0.1.0`(테마, 밝음·어두움 둘 다 — **이미 있는 것 그대로**, 어두움은 `--bg` 만), `@me/paper`(테마, 밝음만), `@me/fog`(테마, `--fg` = `--bg` 의 낮은 대비), `@me/ja`(언어, `meta.id: "ja"`, `meta.base: "en"`, 일부 키만·자리 틀린 키 하나·기준에 없는 키 하나·HTML 같은 값 하나).

- [ ] **Step 1: 실패하는 시험**
  - core `displayText`: `({ en: "Sea", ko: "바다" }, "ko") === "바다"`, `"ko-KR"` → `"바다"`, `"ja"` → `"Sea"`, `({ fr: "Mer" }, "ja") === "Mer"`, `(undefined, "en") === null`.
  - core: 판에 `name: { en: "Sea", ko: "바다" }`·`author`·`license` 가 있으면 그대로 읽힘. `name: { en: "" }`·`name: "Sea"`·`author: 3`·`description` 의 501자 값·언어 태그 아닌 키 → 그 필드만 없고 판·`files` 는 그대로, `ignored` 는 비어 있음. 필드가 없는 옛 index 도 그대로 읽힘.
  - core `marketManifest.test.ts`: 501자 `description.en` 인 매니페스트 → `checkPackageFiles` 가 오류 없이 경고 `display_too_long: description.en`.
  - server `pkgCli.test.ts`: `buildRepoIndex` 가 매니페스트의 `name`·`description`·`author`·`license` 를 판마다 옮겨 씀, 상한을 넘는 필드는 index 에 없고 돌려준 경고(`warnings: string[]` 를 결과에 더함)에 있음, 두 번 돌려도 `written: false`(멱등), 키 순서가 고정(`engines`·`name`·`description`·`author`·`license`·`files`).
- [ ] **Step 2: 실패 확인** — `cd packages/core && pnpm exec vitest run test/marketFormat.test.ts`, `pnpm --filter @keyring-notes/server test -- pkgCli` → FAIL.
- [ ] **Step 3: 구현** — `parseIndexVersion` 에 표시 필드 읽기(던지지 않는 `langText` 꼴 — 1단계 `langText` 의 검사를 같이 쓰도록 꺼내도 좋다). `buildRepoIndex` 가 판마다 매니페스트에서 옮긴다. 픽스처 넷을 만들고 `pnpm keyring pkg index server/test/fixtures/market` 로 `index.json` 을 다시 만든다(서버 시험이 그 sha 에 기대면 함께 맞춘다). `publish-packages` en·ko: index 형식 표에 네 필드(「둘러보기 표시용, 설치 뒤에는 매니페스트를 보인다」), 「테마」 절에 토큰 표(이름 · 뜻 · 밝음 기본 · 어두움 기본 — `THEME_DEFAULTS` 그대로), 대비 경고(4.5:1, 막지 않음), 「앱이 읽는 토큰 목록은 테마 적용과 함께 싣습니다」 줄을 표로 바꾼다.
- [ ] **Step 4: 통과 확인** — core·server 시험 전체 → PASS.
- [ ] **Step 5: 커밋** — `feat(core): index.json 판마다 둘러보기 표시 필드(이름·설명·작성자·라이선스), pkg index 가 옮겨 씀`

> **── 검문 1 (Task 1–3): 형식과 계산. 네트워크·화면 없음 — 시험과 코드 리뷰로 본다. 특히 토큰 목록이 styles.css 와 어긋나지 않는 시험(Task 1 의 (4)), 색 읽기가 `isThemeColor` 를 먼저 지나는지(Task 2 — 주입 거부가 한 곳), 표시 필드가 틀려도 판이 살아 있는지와 멱등(Task 3). 픽스처 넷을 `pkg check` 로 돌려 경고가 기대대로인지 본다. ──**

### Task 4: web — 테마 고르기 값과 풀이(순수)

**Files:**
- Create: `web/src/theme/resolve.ts`
- Modify: `web/src/prefs.ts`(`ThemeChoice`·`valid`), `web/src/themeColor.ts`
- Test: `web/src/theme/resolve.test.ts`, `web/src/prefs.test.ts`(없으면 만든다 — `valid` 를 시험할 수 있게 내보낸다), `web/src/themeColor.test.ts`

**Interfaces:**
- Consumes: `THEME_TOKENS`·`THEME_DEFAULTS`(Task 1), `parseCssColor`·`toHex`·`composite`(Task 2), `PACKAGE_ID_RE`·`isThemeColor`(1단계).
- Produces:
  - `prefs.ts`: `export type ThemeChoice = "system" | "light" | "dark" | `@${string}/${string}``; `Prefs.theme: ThemeChoice`; `validPref(k, v)`(지금 `valid` 를 내보냄) — `theme` 은 셋 또는 `PACKAGE_ID_RE`.
  - `resolve.ts`:
    ```ts
    export interface ThemePackage { id: string; version: string; name: Record<string, string>; colors: { light?: Record<string, string>; dark?: Record<string, string> } }
    export interface ResolvedTheme {
      dataTheme: "light" | "dark" | null; // null = 시스템을 CSS 가 따른다
      mode: "light" | "dark";
      tokens: Record<string, string>;      // THEME_TOKENS 안, isThemeColor 를 지난 것만
      metaBg: { light: string; dark: string }; // theme-color 메타 두 벌(#rrggbb)
      packageId: string | null;            // 그리는 받은 테마
      missing: string | null;              // 골랐는데 이 기기에 없는 id
    }
    export function resolveTheme(choice: ThemeChoice, pkgs: ThemePackage[], env: { systemDark: boolean; escape: boolean }): ResolvedTheme;
    export function themeModes(p: ThemePackage): ("light" | "dark")[];
    ```
  - `themeColor.ts`: `applyThemeColor(metaBg: { light: string; dark: string }, doc?: Document)`(테마 이름을 받던 것을 색 둘로). `themeColorContents` 는 지우거나 `resolveTheme` 이 대신한다.

- [ ] **Step 1: 실패하는 시험** — `resolve.test.ts`:
  - `"system"` → `dataTheme: null`, `tokens: {}`, `metaBg` = 기본 밝음·어두움 `--bg`, `mode` 는 `systemDark` 를 따름. `"light"`·`"dark"` → 그 모드, 메타 두 벌이 같은 색(지금 동작).
  - 둘 다 가진 테마 + `systemDark: true` → `dataTheme: "dark"`, `tokens` = `colors.dark` 중 토큰 목록 안의 것, `metaBg` 두 벌 = 그 `--bg` 의 `#rrggbb`. `systemDark: false` → 밝음.
  - 밝음만 가진 테마 + `systemDark: true` → `dataTheme: "light"`(Review Focus 3).
  - 모르는 토큰(`--zz`)·나쁜 값(`"red; x"` — 캐시에서 온 것을 가정)은 `tokens` 에 없음(Review Focus 5).
  - 반투명 `--bg` → 메타는 기본 `--bg` 위에 합성한 `#rrggbb`.
  - 고른 id 가 `pkgs` 에 없음 → `"system"` 과 같은 결과 + `missing: id`(Review Focus 2). `escape: true` → `"system"` 과 같고 `missing: null`, `packageId: null`.
  - `prefs.test.ts`: `validPref("theme", "@me/sea") === "@me/sea"`, `"@../x"`·`"@Me/Sea"`·`"blue"`·`3` → undefined.
  - `themeColor.test.ts`: `applyThemeColor({ light: "#000000", dark: "#111111" }, fakeDoc)` 가 두 메타에 각각 씀(가짜 `querySelector` 문서).
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/theme src/prefs src/themeColor` → FAIL.
- [ ] **Step 3: 구현** — 위 서명대로. `prefs.ts` 의 `applyTheme` 은 아직 그대로 두고(Task 5 가 옮긴다) 타입만 넓힌다. `Workspace.tsx` 의 `cmd.theme` 순환은 받은 테마에서 `"system"` 으로 간다(`system → light → dark → system`, 패키지 → `system`).
- [ ] **Step 4: 통과 확인** — 같은 명령 + 타입 검사 → PASS.
- [ ] **Step 5: 커밋** — `feat(web): 테마 고르기 값에 받은 테마 id, 테마 풀이(모드·토큰·PWA 색) 순수 함수`

### Task 5: web — 테마 적용·시작 캐시·마켓 적용자

**Files:**
- Create: `web/src/theme/apply.ts`, `web/src/theme/marketThemes.ts`
- Modify: `web/src/prefs.ts`(`publish` 가 `applyThemeChoice` 를 부름, 옛 `applyTheme` 지움), `web/src/market/state.ts`(`ready()`), `web/src/main.tsx`(적용자 등록)
- Test: `web/src/theme/apply.test.ts`, `web/src/theme/marketThemes.test.ts`, `web/src/market/state.test.ts`

**Interfaces:**
- Consumes: `resolveTheme`·`ThemePackage`(Task 4), `MarketState`(1단계), `parseManifest`·`MANIFEST_FILE`.
- Produces:
  - `state.ts`: `MarketState.ready(): boolean` — `settings()` 를 읽은 `reconcileOnce` 가 `installed = next` 바로 뒤, `await notify()` **앞**에 참으로 세운다(한 번 참이면 계속 참).
  - `apply.ts`:
    - **고르기 값의 출처(리뷰 8):** `apply.ts` 가 마지막으로 받은 `choice` 를 모듈 변수로 든다(처음은 `"system"`). `prefs.ts` 를 import 하지 않는다 — prefs 가 모듈 최상위에서 `publish()` → `applyThemeChoice` 를 부르므로 거꾸로 import 하면 순환한다(`ThemeChoice` 는 `import type` 만).
    - `applyThemeChoice(choice: ThemeChoice): void` — `choice` 를 기억하고 풀어서 DOM 에 쓴다: `data-theme`(null 이면 지움), `THEME_TOKENS` 전부 `style.removeProperty` 뒤 `tokens` 만 `setProperty`, `applyThemeColor(metaBg)`, 시작 캐시(그리는 받은 테마가 있으면 그것을 씀, 없으면 지움 — **단 `themeEscape` 이면 캐시를 건드리지 않는다**), 알림.
    - `setThemePackages(pkgs: ThemePackage[]): void`(기억한 `choice` 로 다시 적용), `themePackages(): ThemePackage[]`, `appliedTheme(): ResolvedTheme`, `onThemeApplied(fn: (r: ResolvedTheme) => void): () => void`, `useAppliedTheme(): ResolvedTheme`, `useThemePackages(): ThemePackage[]`.
    - `readThemeCache(raw: string | null): ThemePackage | null`(순수 — 꼴과 값을 `checkThemeColors`·`isThemeColor` 로 다시 검사, 하나라도 나쁘면 그 토큰만 버림, id 꼴이 나쁘면 null).
    - `themeEscape: boolean` — 주소 `?theme=default`.
    - 받은 테마가 둘 다 가진 모드면 `matchMedia("(prefers-color-scheme: dark)")` 바뀜에 다시 적용.
  - `marketThemes.ts`: `registerThemeKind(m: MarketState): () => void` — `apply(pkgs)` 에서 `m.ready()` 가 거짓이면 아무것도 하지 않는다(시작 캐시 유지). 참이면 패키지마다 `readPackageText(id, MANIFEST_FILE)` → `parseManifest` → `{ id, version, name, colors }`, 읽기 실패한 것은 뺀다(그 패키지는 1단계가 이미 오류로 표시). 결과로 `setThemePackages`.
- 시작 캐시 키: `keyring:theme-cache` = `JSON.stringify(ThemePackage)`. 쓰기 실패는 조용히.

- [ ] **Step 1: 실패하는 시험**
  - `state.test.ts`: 설정이 null 인 동안 `ready()` 거짓, 첫 맞추기 뒤 참, 받지 못한 패키지가 있어도 참. **실물 `createMarketState`**(1단계 시험의 `setup` — 가짜가 아니다)에 `registerPackageKind("theme", { apply })` 를 걸고, `apply` 안에서 `state.ready()` 를 기록한다: 등록 때의 첫 호출(빈 목록)은 `false`, **첫 맞추기의 `notify` 가 부른 호출은 `true` 이고 그때 목록에 `@me/sea` 가 있음**(리뷰 1 — notify 뒤에 세우면 이 단언이 실패한다).
  - `apply.test.ts`(`readThemeCache` 와 캐시 판단 — DOM 없음): 정상 캐시 → 그대로, `colors.light["--bg"] = "red; background: url(x)"` → 그 토큰만 빠짐, `id: "@../x"` → null, 깨진 JSON → null. 캐시에 무엇을 할지 고르는 순수 함수 `cacheAction(r: ResolvedTheme, escape: boolean): "write" | "clear" | "keep"` 를 떼어: 받은 테마를 그림 → `"write"`, 기본을 그림 → `"clear"`, **`escape` → `"keep"`**(리뷰 7).
  - `marketThemes.test.ts`(가짜 `MarketState`·가짜 `setThemePackages` 를 주입 — `registerThemeKind(m, set = setThemePackages)` 꼴로): `ready()` 거짓이면 `set` 을 부르지 않음, 참이면 읽은 테마들로 부름, `readPackageText` 가 `market_hash_mismatch` 로 던진 패키지는 빠짐, 빈 목록이면 빈 배열로 부름(고른 테마가 사라짐 → `missing`).
  - 캐시 판 대조(Review Focus 2): `set` 이 부른 목록에 고른 id 가 다른 판으로 있으면 그 판으로 그린다 — `resolveTheme` 은 목록만 보므로, `setThemePackages` 가 캐시를 목록으로 **바꾸는**(합치지 않는) 것을 시험(`themePackages()` 가 새 목록 그대로).
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/theme src/market/state.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 모듈이 읽힐 때 `themePackages = [readThemeCache(localStorage)]`(있으면). `prefs.ts` `publish()` 는 `applyThemeChoice(current.theme)`(바뀌었을 때·처음). `main.tsx` 는 `startMarket()` 다음 줄에 `registerThemeKind(market())`.
- [ ] **Step 4: 통과 확인** — web 시험 전체 + 타입 검사 → PASS.
- [ ] **Step 5: 커밋** — `feat(web): 받은 테마 적용(data-theme 와 토큰만), 시작 캐시, 마켓 테마 적용자, 마켓 상태 ready`

### Task 6: web — 테마가 퍼지는 자리와 설정의 테마 줄

**Files:**
- Create: `web/src/widgets/excalidraw/theme.ts`(`isDark` 를 `frame.tsx` 에서 떼어 냄 — `frame.tsx` 는 Excalidraw React 를 끌어와 Node vitest 에서 읽히지 않을 수 있다(리뷰 6))
- Modify: `web/src/widgets/mount.ts`(`readTheme` 16진·`attributeFilter`), `web/src/widgets/excalidraw/frame.tsx`(`theme.ts` 의 `isDark` 를 씀 — 8자리 16진도 읽게), `web/src/Graph.tsx`(적용 알림에 다시 그림), `web/src/Settings.tsx`(일반 → 테마 줄), `web/src/Workspace.tsx`(`cmd.themeReset`), `web/src/styles.css`(대비 경고 줄 — 토큰만), `packages/core/src/messages/{en,ko}.json`
- Test: `web/src/widgets/themeValue.test.ts`(`widgetThemeValue` 를 DOM 없는 `widgets/themeValue.ts` 로 떼어 `mount.ts` 가 import), `web/src/widgets/excalidraw/theme.test.ts`

**Interfaces:**
- Consumes: `useAppliedTheme`·`useThemePackages`·`onThemeApplied`(Task 5), `themeModes`(Task 4), `themeContrast`·`contrastLabel`·`CONTRAST_MIN`·`parseCssColor`·`toHex`(Task 2), `displayText`(Task 3).
- Produces: `widgetThemeValue(v: string): string`(`widgets/themeValue.ts`) — 읽을 수 있는 색이면 `toHex`, 아니면 그대로. `isDark(bg: string | undefined): boolean`(`widgets/excalidraw/theme.ts`). 메시지 키 `theme.reset`·`theme.resetHint`·`theme.package`(`{name}`)·`theme.packageMissing`(`{name}`)·`theme.contrastLow`(`{ratio}`)·`theme.contrastUnknown`·`theme.onlyLight`·`theme.onlyDark`·`cmd.themeReset`.

- [ ] **Step 1: 실패하는 시험** — `widgetThemeValue("oklch(1 0 0)") === "#ffffff"`, `("#17191c") === "#17191c"`, `("")===""`. Excalidraw `isDark("#17191cff") === true`, `isDark("#ffffff80") === false`(알파는 무시하고 색으로).
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets` → FAIL.
- [ ] **Step 3: 구현**
  - `mount.ts`: `readTheme` 이 `widgetThemeValue` 를 거침, `attributeFilter: ["data-theme", "style"]`.
  - `Graph.tsx`: `onThemeApplied` 를 들어 다시 그린다(방법은 구현자 몫 — 상태 하나를 올리는 정도).
  - `Settings.tsx` 일반 → 테마 줄: `<select aria-label>`(받은 테마가 늘면 단추 묶음이 좁은 화면에서 넘친다) — 「시스템·밝게·어둡게」, 그다음 `themePackages()` 를 이름순(`displayText(name, language())`)으로 `theme.package`, 한쪽 모드만 가진 것은 `theme.onlyLight`·`onlyDark` 를 붙임. 지금 값이 목록에 없는 패키지 id 면 그 값을 `theme.packageMissing` 으로 한 줄 더(고른 것이 사라져 보이지 않게). 줄 아래: 고른 받은 테마의 대비가 `< CONTRAST_MIN` 이거나 null 이면 그리는 모드마다 경고(`role="status"`), `appliedTheme().missing` 이면 없음 안내와 그 패키지의 `market.status.*`. 그 아래 **늘 보이는** 「기본 테마로 돌아가기」 단추(`theme.reset`, 지금 값이 패키지가 아니면 `disabled`) → `setPrefs({ theme: "system" })`. `sharedText` 도 받은 테마 이름을 보인다.
  - `Workspace.tsx`: 명령 `cmd.themeReset` → `setPrefs({ theme: "system" })`(늘 있음).
- [ ] **Step 4: 통과 확인** — web 시험 전체 + 타입 검사 → PASS.
- [ ] **Step 5: 커밋** — `feat(web): 받은 테마를 위젯·그래프·PWA 색이 따라감, 설정 테마 줄의 받은 테마·대비 경고·기본 테마로 돌아가기`

### Task 7: web — 언어 패키지 층

**Files:**
- Create: `web/src/i18nMarket.ts`
- Modify: `web/src/i18n.ts`(마켓 층·목록·시스템 언어·고르기 원값), `web/src/prefs.ts`(`applyLanguage` 가 `setLanguagePref` 를 부름), `web/src/Settings.tsx`(언어 목록의 표시), `web/src/main.tsx`(적용자 등록), `packages/core/src/messages/{en,ko}.json`
- Test: `web/src/i18n.test.ts`(있으면 거기, 없으면 만든다), `web/src/i18nMarket.test.ts`

**Interfaces:**
- Consumes: `MarketState`·`ready()`(Task 5), core `checkPack`·`LanguagePack`·`PackReport`.
- Produces:
  - `i18n.ts`:
    - **고르기 원값을 i18n 이 기억한다(리뷰 2):** 지금 `prefs.applyLanguage` 는 `setLanguage(urlLanguage ?? (lang || systemLanguage()))` 로 **이미 푼 값**을 넘겨, `""`(시스템)였다는 사실이 i18n 에 남지 않는다. `setLanguagePref(pref: string): void` 를 더하고 `prefs.applyLanguage` 는 그것만 부른다 — i18n 이 `pref` 를 들고 있다가 `urlLanguage ?? (pref || systemLanguage())` 로 풀어 `setLanguage` 한다. 이 기기 언어팩·마켓 층이 바뀔 때(`putPack`·`removePack`·`setMarketPacks`)마다 **같은 풀이를 다시** 한다(지금의 `setLanguage(wanted)` 를 바꾼다). 그래야 시스템 언어가 `ja` 인 기기가 마켓 `ja` 를 받는 순간 `ja` 로 바뀐다.
    - `setMarketPacks(list: { pkgId: string; pack: LanguagePack; report: PackReport }[]): void` — 같은 `meta.id` 가 둘 이상이면 앞 것만(잠금 순서), 바꾼 뒤 위 풀이를 다시.
    - 풀이 순서: 이 기기 언어팩(`packs`) → 마켓 층 → 공식. `build`·`setLanguage`·`systemLanguage`·`missingPack` 이 마켓 층도 본다.
    - `languages()` 의 원소에 `source: "official" | "device" | "market"` 와 `pkgId?: string`·`shadows?: string`(이 기기 언어팩이 가린 마켓 패키지 id)을 더한다(지금 `official` 필드는 둔다).
    - `marketLanguageConflicts(): { lang: string; used: string; ignored: string[] }[]`, `marketPackReport(pkgId: string): PackReport | null`.
    - 시작 캐시 `keyring:langpack-market-cache` = **풀린** 화면 언어(`""` 를 시스템 언어로 푼 뒤 포함)가 마켓 층일 때 그 `{ pkgId, pack }` 하나. 읽을 때 `checkPack` 을 다시 지난다.
  - `i18nMarket.ts`: `registerLanguageKind(m: MarketState, set = setMarketPacks): () => void` — `ready()` 거짓이면 아무것도 하지 않음. 패키지마다 `readPackageText(id, "messages.json")` → `JSON.parse` → `checkPack(raw, byteLength)`; 오류(`{ error }`)·읽기 실패는 뺀다.
  - 메시지 키 `lang.market`(목록 꼬리표), `lang.shadowed`(`{id}`), `market.langConflict`(`{lang}`·`{used}`), `market.langReport`(`{missing}`·`{dropped}`).

- [ ] **Step 1: 실패하는 시험**
  - `i18n.test.ts`: 마켓 층에 `ja` → `setLanguage("ja")` 뒤 `t()` 가 그 팩의 글, 팩에 없는 키는 `meta.base`(→ 영어)로, `missingPack()` null. 이 기기 언어팩에도 `ja` 가 있으면 이 기기 것이 쓰이고 `languages()` 에 `ja` 가 하나, 그 원소의 `shadows` 가 마켓 패키지 id(Review Focus 4). 마켓 패키지 둘이 `ja` → 앞 것이 쓰이고 `marketLanguageConflicts()` 에 뒤 것. 마켓 층을 비우면(제거) `missingPack() === "ja"` 이고 기준 언어로 보임. **시스템 언어(리뷰 2):** `navigator.languages` 를 `["ja-JP"]` 로 둔 가짜 전역에서 `setLanguagePref("")` → `language() === "en"`, 그 뒤 `setMarketPacks([ja 팩])` 만 부르면(prefs 를 다시 부르지 않고) `language() === "ja"`, 다시 빈 목록이면 `"en"`. `setLanguagePref("ko")` 인 동안은 마켓 `ja` 가 와도 `"ko"`.
  - `i18nMarket.test.ts`(Task 3 픽스처 `@me/ja` 의 `messages.json` 을 읽어): 자리 틀린 키는 기준 언어 글로, 기준에 없는 키는 없음, HTML 같은 값은 그대로 글자(`report.htmlLike` 에 듦), `ready()` 거짓이면 `set` 을 부르지 않음, 공식 id(`meta.id: "ko"`)인 패키지는 빠짐(`checkPack` 의 `official_id`).
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/i18n src/i18nMarket` → FAIL.
- [ ] **Step 3: 구현** — 위 서명대로. `Settings.tsx` 언어 목록: 마켓 언어는 `(${t("lang.market")})`, 이 기기 언어팩 줄에 `shadows` 가 있으면 `lang.shadowed`. 이 기기 언어팩의 고치기·지우기 흐름은 그대로. `main.tsx` 에 `registerLanguageKind(market())`.
- [ ] **Step 4: 통과 확인** — web 시험 전체 + 타입 검사 → PASS.
- [ ] **Step 5: 커밋** — `feat(web): 마켓 언어 패키지를 화면 언어의 한 층으로(이 기기 언어팩이 우선), 시작 캐시`

> **── 검문 2 (Task 4–7): 테마·언어 적용. 시험에 더해 화면으로 본다 — 1단계 검문 3 과 같은 꾸밈: Task 3 픽스처를 이 기기의 로컬 정적 서버(`127.0.0.1`, 다른 포트)로 내고, 시험 서버(임시 `KEYRING_DATA`, 다른 포트, `KEYRING_MARKET_ALLOW_HTTP=1 KEYRING_MARKET_ALLOW_PRIVATE=1`)에 개발 빌드의 `globalThis.keyringMarket.installPackage` 로 설치한다(마켓 화면은 아직 없다). 바깥에 올리지 않는다. Playwright chromium·webkit 으로: ① `@me/sea` 를 시스템 밝음·어두움(`emulateMedia`)에서 — 토큰, `data-theme`, theme-color 메타 두 벌, 코드 블록 색, mermaid 모드, Excalidraw iframe 모드, 그래프 색. ② `@me/paper` 를 어두운 시스템에서 → 밝음(Review Focus 3). ③ `@me/fog` → 대비 경고, `?theme=default`·명령 팔레트·설정 단추로 돌아오기, `?theme=default` 로 연 뒤 서버를 끄고 그냥 다시 열면 받은 테마가 시작 캐시로 그려짐(escape 가 캐시를 지우지 않음)(Review Focus 1). ④ 새로고침 때 깜빡임 없음(시작 캐시), 서버를 끈 뒤 새로고침해도 받은 테마·언어가 남음, 다른 브라우저 문맥(두 번째 기기)이 공통 설정으로 같은 테마를 고르고 받아 옴, 잠금에서 빼면 기본 + 안내(Review Focus 2). ⑤ `@me/ja` 를 고르고 빠진 키·자리 틀린 키가 영어로, 같은 `ja` 비공식 언어팩을 불러오면 그것이 이김(Review Focus 4). 띄운 것은 끈다. ──**

### Task 8: server·web — 저장소 목록 새로 고침 길과 마켓 화면 모델(순수)

**Files:**
- Create: `web/src/market/view.ts`
- Modify: `server/src/marketCache.ts`(`index(repo, { fresh })`), `server/src/app.ts`(`/market/index` 의 `fresh`), `server/src/llmsTxt.ts`, `docs/manual/{en,ko}/reference.md`(마켓 API 표), `web/src/market/client.ts`·`source.ts`(`index(repo, opts?)`·`writeDeviceMarketSettings`), `web/src/market/state.ts`(`repoIndexes(opts?)`)
- Test: `server/test/marketCache.test.ts`, `server/test/market.test.ts`, `web/src/market/view.test.ts`, `web/src/market/source.test.ts`, `web/src/market/state.test.ts`

**Interfaces:**
- Consumes: core `RepoIndexResult`·`LockEntry`·`PackageType`·`latestVersion`·`compareSemver`·`normalizeRepoUrl`·`isOfficialRepo`·`OFFICIAL_REPO_URL`, `displayText`(Task 3), `InstalledPackage`(1단계).
- Produces:
  ```ts
  export const MARKET_KINDS: Record<PackageType, { label: string; installable: boolean; installNotice?: string }>;
  // theme·language: installable true. widget: installable false (3단계가 true 와 WebRTC 알림 키로 바꾼다)
  export interface BrowseRow {
    id: string; type: PackageType; repo: string; repoName: string;
    version: string | null;              // 이 앱에 맞는 최신 판(없으면 null)
    incompatible: { range: string } | null; // 판은 있으나 맞는 것이 없음
    info: { name: string | null; description: string | null; author: string | null; license: string | null }; // index 표시 필드
    alsoIn: string[];                    // 같은 id 가 있는 다른 저장소
    installed: LockEntry | null;
    update: string | null;               // 설치됐고 잠금 저장소에 더 높은 맞는 판
  }
  export function browseRows(indexes: RepoIndexResult[], lock: Record<string, LockEntry>, appVersion: string, lang: string): BrowseRow[];
  export function repoAdd(repos: string[], input: string): { repos: string[] } | { error: "market_url_invalid" | "market_url_protocol" | "market_url_credentials" | "market_repo_duplicate" };
  export function repoMove(repos: string[], index: number, delta: -1 | 1): string[];
  export function repoRemove(repos: string[], index: number): string[];
  ```
  - `source.ts`: `writeDeviceMarketSettings(v: { allowHttp: boolean; allowPrivate: boolean }): void`. `PackageSource.index(repo: string, opts?: { fresh?: boolean }): Promise<RepoIndexResult>` — 서버 쪽은 `?repo=…&fresh=1`, 네이티브는 무시(늘 새로), `fallbackSource` 는 그대로 넘긴다.
  - `state.ts`: `repoIndexes(opts?: { fresh?: boolean })`.
  - server `marketCache.ts`: `index(repoInput: string, opts?: { fresh?: boolean })` — `fresh` 이고 캐시가 `FRESH_FLOOR_MS = 10_000` 보다 오래됐으면 버리고 다시 받는다. `app.ts`: `queryOf(c, "fresh") === "1"`.

- [ ] **Step 1: 실패하는 시험** — `marketCache.test.ts`(가짜 `now`·가짜 `fetch` 로 받은 횟수를 셈): 첫 `index` 1번, 1분 뒤 그냥 `index` → 0번 더(5분 캐시), 1분 뒤 `fresh` → 1번 더, 그 5초 뒤 `fresh` → 0번 더(10초 바닥), 실패한 저장소도 `fresh` 로 10초 뒤 다시. `market.test.ts`: `GET /api/market/index?repo=…&fresh=1` 이 소유자에게 200, 에이전트 토큰 403(지금 규칙 그대로). `source.test.ts`: 서버 쪽 `index(repo, { fresh: true })` 가 `fresh=1` 을 붙임, 없으면 붙이지 않음. `view.test.ts`:
  - 두 저장소에 같은 `@me/sea` → 행은 하나, `repo` 는 위의 저장소, `alsoIn` 에 아래 것. 설치된 것은 잠금의 `repo` 를 따른다(아래 저장소에 설치했으면 그 저장소 행). 판이 있는데 앱에 맞는 것이 없으면 `version: null`·`incompatible.range`. 설치된 `1.0.0` 에 `1.1.0` 이 있으면 `update: "1.1.0"`, 프리릴리스 `1.2.0-beta` 는 `update` 로 고르지 않음. 표시 필드가 없는 index → `info` 모두 null. 오류 난 저장소(`index: null`)는 행을 만들지 않음. 위젯 행도 나오고(`type: "widget"`), `MARKET_KINDS.widget.installable === false`.
  - `repoAdd(["https://a.example/"], "https://a.example")` → `market_repo_duplicate`, `"ftp://x"` → `market_url_protocol`, `"https://u:p@x/"` → `market_url_credentials`, `"http://10.0.0.2/r"` → 받아 들임(기록), 정규형으로 끝 `/`. `repoMove` 끝에서 더 못 감(그대로), `repoRemove` 로 공식도 빠짐.
  - `source.test.ts`: `writeDeviceMarketSettings` 뒤 `readDeviceMarketSettings` 가 같은 값(가짜 `localStorage`).
- [ ] **Step 2: 실패 확인** — `pnpm --filter @keyring-notes/server test -- marketCache market`, `cd web && pnpm exec vitest run src/market` → FAIL.
- [ ] **Step 3: 구현** — 위 서명대로. `browseRows` 정렬: 종류(`theme`·`language`·`widget`) → 이름(없으면 id). `reference.md` en·ko 의 마켓 API 표와 `llmsTxt.ts` 에 `fresh=1`(「저장소마다 10초에 한 번까지 캐시를 건너뜀」).
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS.
- [ ] **Step 5: 커밋** — `feat(server,web): 저장소 목록을 새로 받는 fresh 길, 마켓 화면 모델 — 둘러보기 행·새 판·저장소 목록 고치기, 종류별 설치 표`

### Task 9: web — 설정의 마켓플레이스 화면

**Files:**
- Create: `web/src/MarketSettings.tsx`
- Modify: `web/src/Settings.tsx`(`SECTIONS` 에 `marketplace`, `SettingsSection` 타입), `web/src/Workspace.tsx`(`openMarket`·팔레트 명령), `web/src/askFirst.ts`(`askUninstallPackage`), `web/src/prefs.ts`(`clearRemovedChoice`), `web/src/styles.css`, `packages/core/src/messages/{en,ko}.json`
- Test: `web/src/prefs.test.ts`(`clearRemovedChoice`), `web/src/firstMouse.test.ts`(askFirst 시험이 있는 곳 — `askUninstallPackage` 의 확인 → `true`, 취소 → `false` 두 길), 화면은 검문 3

**Interfaces:**
- Consumes: `market()`(1단계), `browseRows`·`MARKET_KINDS`·`displayText`·`repoAdd`·`repoMove`·`repoRemove`·`writeDeviceMarketSettings`(Task 8), `marketMode`(1단계 `source.ts`), `themeContrast`·`contrastLabel`(Task 2), `themeModes`(Task 4), `marketLanguageConflicts`·`marketPackReport`(Task 7), `marketplaceSettings`·`useVaultSettings`·`updateVaultSetting`.
- Produces: **3단계 진입점** `openMarket(id?: string)`(`Workspace.tsx` — `openSettings("marketplace")` 에 둘러보기를 그 id 로 걸러 펼친 채 연다. 3단계의 「찾을 수 없음」 옆 「설치」 가 이것만 부르면 된다. 2단계에서는 팔레트 명령 `cmd.marketplace` 하나가 쓴다). `prefs.ts` `clearRemovedChoice(k: "theme" | "language", removed: string): void` — 이 기기 덮어쓰기 값이 `removed` 면 덮어쓰기를 기본값(`"system"`·`""`)으로, 공통 값이 `removed` 면 공통 값을 기본값으로(멈춘 뒤 한 번 쓰기, 지금 `pendingShared` 길). 메시지 키 `settings.marketplace`·`settings.marketplaceKeywords`, `cmd.marketplace`, `market.repos`·`market.repoAdd`·`market.repoAddRun`·`market.repoUp`·`market.repoDown`·`market.repoRemove`·`market.repoOfficial`·`market.repoReaddOfficial`·`market.repoError`(`{repo}`)·`market.refresh`·`market.installed`·`market.browse`·`market.kind.all|theme|language|widget`·`market.install`·`market.installing`·`market.uninstall`·`market.uninstallConfirm`(`{name}`)·`market.update`(`{version}`)·`market.updateAvailable`·`market.alsoIn`(`{repos}`)·`market.incompatible`(`{range}`)·`market.widgetLater`·`market.by`(`{author}`·`{license}`)·`market.device`·`market.deviceAllowHttp`·`market.deviceAllowPrivate`, `error.market_repo_duplicate`.

- [ ] **Step 1: 실패하는 시험** — `clearRemovedChoice("theme", "@me/sea")`: 공통 값이 그것이면 공통 → `"system"`(덮어쓰기 없음), 덮어쓰기가 그것이면 덮어쓰기만 `"system"`, 둘 다 다른 값이면 아무것도 안 함. `language` 는 `""`.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/prefs` → FAIL.
- [ ] **Step 3: 구현** — 묶음 `{ id: "marketplace", label: "settings.marketplace", icon: Store(lucide), keywords: "settings.marketplaceKeywords" }` 를 「언어」 다음에, 모든 모드에. 화면 순서:
  1. `marketAvailability() === "unavailable"` 이면 맨 위 `market.unavailable` 안내(아래는 보이되 설치·업데이트는 꺼짐).
  2. **설치됨** — `installedPackages()` 를 종류별로: 이름(매니페스트 `displayText`, 없으면 id)·판·저장소·상태(`market.status.*`, 오류면 `error.<code>`). 테마 줄: 그리는 모드마다 대비가 낮거나 잴 수 없으면 `theme.contrastLow`·`contrastUnknown`. 언어 줄: `market.langReport`·`market.langConflict`. `update` 가 있으면 「새 판 있음」 과 `market.update`. `market.uninstall` → 확인(**`askFirst.ts` 에는 범용 확인이 없다**(리뷰 9) — `askUninstallPackage(name: string): Promise<boolean>` 를 더해 `confirmDialog(t("market.uninstallConfirm", { name }), t("market.uninstall"))` 를 돌려준다) → 참이면 `uninstallPackage` → 테마면 `clearRemovedChoice("theme", id)`, 언어면 그 패키지가 주던 `meta.id` 를 다른 층이 주지 않을 때 `clearRemovedChoice("language", meta.id)`. 위젯도 여기 보이고 제거할 수 있다(잠금에 손으로 들어온 것).
  3. **둘러보기** — 종류 거르개(`Choice`: 전체·테마·언어·위젯) + `market.refresh`. 행: 이름·설명·`market.by`·판·저장소 이름, `alsoIn` 이면 `market.alsoIn`, `incompatible` 이면 `market.incompatible`. 단추: 설치돼 있으면 `market.installed`(꺼짐, 업데이트는 위 목록), `MARKET_KINDS[type].installable` 이 거짓이면 꺼진 단추 + `market.widgetLater`, 아니면 `market.install` → `installPackage(id, { repo })`(진행 중 `market.installing`·단추 꺼짐) → 테마면 설치 결과의 대비 경고를 그 행에 보임. 실패는 그 행에 `error.<code>`.
  4. **저장소** — 순서대로 줄마다 주소(`word-break: break-all`)·공식이면 `market.repoOfficial`·그 저장소 `index` 오류면 `market.repoError` + `error.<code>`, 단추 `market.repoUp`·`repoDown`(끝이면 꺼짐)·`repoRemove`. 아래 입력 + `market.repoAddRun`(Enter 로도), 오류는 입력 아래 `role="alert"`. 공식이 없으면 `market.repoReaddOfficial`. 쓰기는 `updateVaultSetting(["marketplace", "repos"], …)`.
  5. **이 기기**(Tauri 앱만 — `marketMode` 가 `app`·`app+sync`) — 확인란 둘, 바꾸면 `writeDeviceMarketSettings` 와 `reconcile()`.
  - 저장소 목록은 묶음을 열 때 한 번, `market.refresh` 로 다시 — 둘 다 `repoIndexes({ fresh: true })`(Task 8). 설정 검색은 묶음 이름·낱말로 걸린다(`keywords`).
  - **키보드:** 모든 조작이 단추·입력·확인란(끌기 없음). 위·아래로 옮긴 뒤 초점은 옮긴 줄의 같은 단추에 남는다(끝에 닿아 꺼지면 반대 단추로). 지운 뒤 초점은 다음 줄(없으면 입력)로. 설치·제거·업데이트 결과는 `aria-live="polite"` 한 곳에도 읽힌다. 단추마다 `aria-label` 에 패키지 이름·저장소를 넣는다.
  - **390px:** 행은 넓으면 「글 | 단추」 두 칸, `max-width: 480px` 아래에서는 한 칸으로 쌓고 단추 묶음이 줄을 바꾼다. 가로 스크롤 없음. 터치 대상은 지금 설정 단추 크기 그대로.
  - **밝은·어두운:** 새 CSS 는 토큰만(`--bg-soft`·`--border`·`--muted`·`--warn-bg`·`--warn-fg`·`--danger` 등).
- [ ] **Step 4: 통과 확인** — web 시험 전체 + `pnpm typecheck` + `pnpm --filter @keyring-notes/web build` → PASS.
- [ ] **Step 5: 커밋** — `feat(web): 설정의 마켓플레이스 화면 — 저장소 목록·둘러보기·설치·제거·업데이트(위젯 설치는 3단계)`

### Task 10: 사용자 문서와 전체 확인

**Files:**
- Create: `docs/manual/{en,ko}/how-to/install-packages.md`
- Modify: `docs/manual/{en,ko}/how-to/customize-settings.md`(일반의 테마에 받은 테마·기본 테마로 돌아가기, 묶음 표에 「마켓플레이스」), `docs/manual/{en,ko}/how-to/publish-packages.md`(머리의 「아직 설치할 수 없습니다」 를 「위젯 설치는 다음 릴리스」 로, 언어 패키지 절에 「같은 언어 id 일 때」·「빠진 키·자리 틀린 키」), `docs/manual/{en,ko}/reference.md`(how-to 목록에 새 문서 — `publish-packages` 가 걸린 자리), `README.md:72`·`README.ko.md` 같은 줄(how-to 목록 글에 「패키지 설치」)
- Test: 문서 시험이 있으면(링크 검사 등) 그것

- [ ] **Step 1: 문서** — `install-packages`: 마켓 화면 열기, 저장소 더하기·빼기·순서(공식 주소, `http:`·사설 저장소는 서버 운영자 환경 변수·앱 「이 기기」 설정으로만), 둘러보기·설치·제거·업데이트(새 판은 알리기만, 모든 기기가 같은 판), 테마 고르기(「이 기기에서만 다르게」, 한쪽 모드만 가진 테마, 대비 경고, **기본 테마로 돌아가기 — 설정 단추·명령 팔레트·브라우저 주소 `?theme=default`, 주소창이 없는 데스크톱 앱은 팔레트, 모바일 PWA·앱은 브라우저에서 같은 볼트를 `?theme=default` 로 열거나 `keyring-settings.md` 의 `ui.theme` 지우기**), 서버 모드의 「새로 고침」 은 저장소마다 10초에 한 번까지 새로 받는다는 것, 언어 고르기(이 기기 언어팩이 우선), 받지 못한 기기·오래된 앱 판에서 보이는 것, 오프라인, 알려진 한계(편집기 덧칠·mermaid 는 모드만, 위젯 설치는 다음 릴리스). en·ko 같은 커밋.
- [ ] **Step 2: 전체 확인** — core·server·web 시험, 타입 검사, 웹 빌드 → PASS, 시험 개수가 시작보다 늘었음.
- [ ] **Step 3: 화면 확인** — 검문 2 의 꾸밈 그대로, 이번에는 **마켓 화면으로** 설치·제거·업데이트. Playwright chromium·webkit:
  - (이 확인 전체를 위 스크래치 사본으로 한다.)
  - 저장소: 더하기(중복·`ftp:` 오류), 위·아래·빼기, 공식 다시 더하기, 사설 저장소가 서버 스위치 없이 띄운 시험 서버에서 그 줄 오류로.
  - 둘러보기: 종류 거르개, 같은 id 두 저장소(`alsoIn`), 위젯 행의 꺼진 설치 단추와 안내, 맞는 판이 없는 패키지.
  - 설치·업데이트: **커밋된 픽스처를 고치지 않는다** — `server/test/fixtures/market` 을 스크래치 폴더에 복사해 그 사본을 정적 서버로 낸다. `@me/sea@0.1.0` 설치 → 사본에 `packages/me/sea/0.2.0/`(0.1.0 을 복사해 `version` 과 색 하나를 바꿈)을 더해 `pnpm keyring pkg index <사본>` → 마켓 화면의 「새로 고침」(`fresh`)에 **바로**(5분을 기다리지 않고) 「새 판 있음 0.2.0」 → 업데이트 → 두 번째 브라우저 문맥이 같은 판·같은 sha. 10초 안에 다시 누르면 서버가 저장소에 다시 나가지 않는 것도 서버 로그·정적 서버 접근 기록으로 본다.
  - 제거: 고른 테마·언어를 지우면 두 문맥 다 기본으로, 고르기 값이 `system`·`""`.
  - **390px**(뷰포트 390×844): 가로 스크롤 없음, 긴 저장소 주소가 줄을 바꿈, 단추가 가려지지 않음 — 밝은·어두운·받은 테마(`@me/sea`) 셋에서 스크린숏.
  - **키보드만:** Tab 으로 모든 단추에 닿음, 위·아래 뒤 초점 유지, 제거 확인 대화상자 Esc, 설치 결과가 `aria-live` 로 읽힘.
  - 기기 볼트(`?local`) + 동기화 없음 → `market.unavailable`, 이미 깐 테마는 그대로.
  - 데스크톱 앱 「이 기기」 확인란은 화면 빌드로만 본다(1단계와 같은 이유 — 개발 실행의 웹뷰 저장소가 격리되지 않는다, `docs/guides/development.md` 「개발 모드」). 확인하지 못한 것은 끝 보고에 적는다.
- [ ] **Step 4: 커밋** — `docs: 패키지 설치하기(마켓 화면·테마·언어·기본 테마로 돌아가기), 설정·패키지 만들기 문서 갱신`

> **── 검문 3 (Task 8–10): 마켓 화면과 문서. 화면 확인(Task 10 Step 3) 전부를 리뷰어가 다시 돈다. 특히 390px·키보드·밝은·어두운·받은 테마, 3단계가 `MARKET_KINDS.widget` 한 줄과 적용자 등록만으로 위젯 설치를 켤 수 있는지(화면 코드에 `type === "widget"` 갈래가 없는지), 제거 뒤 고르기 값 되돌림이 화면을 거친 제거에만 걸리는지, 「새로 고침」 이 5분 캐시를 건너뛰되 저장소마다 10초에 한 번만 나가는지, 커밋된 픽스처가 바뀌지 않았는지(`git status`). 띄운 것은 끈다. ──**

## 설계 항목별 대응

| 설계 항목 | Task |
| --- | --- |
| 테마 토큰 목록을 `styles.css` 실제 변수로 고정, 크기·글꼴·간격 제외, 사용자 문서에 | 1, 3(토큰 표) |
| 색 값만(엄격한 꼴), 주입 거부 — core 검사 재사용 | 2(`parseCssColor` 가 `isThemeColor` 를 먼저), 4·5(DOM 에 닿는 값 다시 검사) |
| `html[data-theme]` 자리에 토큰만 덮기, 없는 토큰은 기본값 | 4, 5 |
| 「밝게·어둡게·시스템」 과 받은 테마 중 고르기, 가진 모드로 그림 | 4, 6 |
| 고르기는 화면 설정 동기화(공통 → 이 기기에서만 다르게) | 4(`theme` 값), 6(설정 줄) |
| 대비 4.5:1 경고(막지 않음), 설치·고를 때 | 2, 6, 9 |
| 「기본 테마로 돌아가기」 늘 보임 | 6(단추·명령), 5(`?theme=default`) |
| 언어 패키지 설치·적용, 잠금을 따라 모든 기기 | 7, 9 |
| 기존 비공식 언어팩은 계속 | 7(이 기기 층이 우선) |
| `engines` 안 맞는 기기에서만 테마·언어 기본 | 5·7(적용자는 `ready` 인 것만 — 1단계가 `incompatible` 을 뺌), 6(안내) |
| 제거하면 고른 테마·언어가 기본으로 | 5·7(적용자), 9(`clearRemovedChoice`) |
| 오프라인에서 이미 깐 테마·언어가 사라지지 않음 | 5·7(`ready()`·시작 캐시), 검문 2 ④ |
| 설정 → 마켓플레이스: 저장소 목록(더하기·빼기·순서) | 8, 9 |
| 둘러보기(종류별, 이름·설명·작성자·라이선스·판) | 3(표시 필드 — 코디네이터 A), 8, 9 |
| 설치·제거, 「새 판 있음」 과 업데이트(저절로 업데이트 없음) | 8(`fresh` 로 서버 index 캐시를 건너뜀), 9 |
| 「다른 저장소에도 같은 id 가 있음」 | 8(`alsoIn`), 9 |
| 브라우저 기기 볼트·동기화 없음 안내 | 9 |
| 데스크톱 기기 설정(`http:`·사설, 이 기기에서만) | 8, 9 |
| 위젯 종류는 목록에 보이되 설치는 3단계 | 8(`MARKET_KINDS`), 9 |
| 화면 글 en·ko, 사용자 문서 en·ko 같은 커밋 | 6·7·9(메시지), 3·10(문서) |
| 검증: web 시험 — 테마 적용·기본으로 돌아가기, 언어 패키지 적용 | 4–7 |
| 검증: 화면 — 서버 모드·기기 볼트·오프라인, 두 기기 같은 판, 밝은·어두운 테마 패키지, 390px | 검문 2, 10 |
