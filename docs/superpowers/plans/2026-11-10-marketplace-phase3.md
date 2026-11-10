# 마켓플레이스 3단계(위젯) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마켓에서 받은 위젯 패키지(`frame.js`·`frame.css`·`messages/<lang>.json`, 매니페스트 `widget`)를 잠금을 따라 모든 기기의 위젯 레지스트리에 `builtIn: false` iframe 위젯으로 올리고(받은 위젯의 `migrate` 는 iframe 안에서), 블록 파서가 `@scope/name@N` 을 받게 하며, 등록되지 않은 위젯 블록에 「설치」(→ 마켓 화면), 판이 맞지 않는 기기에 「앱을 업데이트해야 이 위젯이 보입니다」 를 보이고, 마켓 화면에서 위젯을 설치(WebRTC 알림)·제거·업데이트한다.

**Architecture:** 판정은 core(위젯 ref 꼴·잠금의 `@keyring` 지킴·위젯 메시지 검사)와 DOM 없는 web 모듈에 둔다. 1단계 `registerPackageKind("widget", { apply })` 에 위젯 적용자(`widgets/marketWidgets.ts`)를 걸어, sha256 을 다시 확인한 매니페스트·메시지로 레지스트리 항목을 만들고 `frame()` 은 처음 쓸 때 `readPackageText(id, "frame.js")` 로 `FrameCode` `text` 를 돌려준다. 레지스트리는 받은 위젯 묶음을 통째로 바꾸는 `setMarketWidgets` 와 바뀜 알림 `onWidgetsChange` 를 얻고, 등록되지 않은 id 의 사정(받는 중·앱 판 안 맞음·받지 못함·설치 안 됨)은 주입한 판정기가 답한다. 그려진 블록(`mount.ts`)은 바뀜 알림에 다시 판정해 다른 것을 그려야 할 때만 다시 그린다 — 수정 중이거나 저장하지 않은 데이터 파일이 있으면 끝날 때까지 미룬다. iframe 프로토콜은 `init`·`update` 에 상태 판(`from`)·위젯 판(`version`)을 싣고, 런타임이 위젯이 등록한 `migrate` 로 올린 상태를 `migrated` 로 돌려보내 호스트 세션이 기준으로 삼는다.

**Tech Stack:** TypeScript, React 19, core(새 의존성 없음), 1·2단계 `web/src/market/*`·`web/src/widgets/*`, Node `node:vm`(CLI 의 `frame.js` 문법 검사만), vitest(Node — DOM 없음), Playwright chromium·webkit(화면 확인).

**Spec:** `docs/superpowers/specs/2026-11-10-marketplace-design.md` — 「단계」 의 **3단계**와, 그것이 다루는 「저장소 형식」 의 id·`@keyring`·engines 줄, 「매니페스트」 의 `widget` 줄과 `migrate` 줄, 「설치·제거·업데이트 화면」 의 위젯 줄 전부. 위젯 쪽 정본 `docs/superpowers/specs/2026-11-09-keyring-widget-design.md`(iframe 규칙·데이터 파일·`migrate` 규칙·이력 보기). 실행자는 두 설계와 이 계획을 함께 읽는다. 설계와 이 계획이 다르면 설계가 원본이고, 다르다는 것을 보고한다. 1단계 계획 「2·3단계 인터페이스」, 2단계 계획 Task 8·9 의 `MARKET_KINDS`·`openMarket(id?)`, `docs/ops/ux.md` 「keyring-widget 1·2단계 구현」·「마켓플레이스 1·2단계 구현」 의 정한 것이 그대로 이어진다.

## 확인한 것 (계획 단계, 2026-11-11 — 기준 커밋 `4d9af13`)

- **블록 파서가 받은 위젯 id 를 거부한다:** core `keyringWidget.ts` `REF_RE = /^([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)@([1-9][0-9]*)$/` — `@me/clock@1` 은 `badWidget`(「"widget" 값이 올바르지 않습니다」). 1단계 계획 「3단계가 넓힐 것」 이 이것이다. `PACKAGE_ID_RE`(`marketFormat.ts`)는 `^@([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$` 로 이미 맞춰 두었다. `widgetFileRefs`·`rewriteWidgetFileRefs`(첨부 링크)는 `parseWidgetBlock` 을 거치므로 꼴을 넓히면 받은 위젯의 `state.file` 도 저절로 링크가 된다.
- **레지스트리(`widgets/registry.ts`):** `registerWidget` 만 있고 빼기·바꾸기·바뀜 알림이 없다. 같은 id 는 던진다. 제3자(`builtIn: false`)는 isolation 과 상관없이 frame, 메시지는 표(`WidgetMessageTable` — 앞머리 문자열이면 던짐)여야 한다. **id 꼴은 보지 않는다** — 지금은 제3자가 `keyring/dday` 를 등록하면 그 자리를 먼저 차지할 수 있다(내장이 먼저 등록되므로 던지기는 하지만, 규칙으로 막혀 있지 않다).
- **`resolveWidgetView` 는 부모 쪽에서 `def.migrate` 를 부른다**(`resolveWidgetState`). 받은 위젯의 def 에는 `migrate` 가 없으므로 지금 그대로면 판이 낮은 블록을 「호환」 으로 보고 옛 상태 그대로 그린 뒤, 적용 때 **옛 모양 상태에 새 판 번호**를 찍는다. 설계(「받은 위젯의 `migrate` 는 iframe 안에서」)대로 iframe 이 올린 상태를 호스트가 받아야 한다.
- **그려진 블록은 레지스트리 바뀜을 모른다:** `mount.ts` 는 처음과 `update(body)`(블록 글이 바뀔 때)에만 `resolveWidgetView` 를 부른다. 앱 시작 직후 마켓 맞추기가 끝나기 전에 그려진 받은 위젯 블록은 「찾을 수 없습니다」 로 굳는다.
- **iframe 위젯은 `setState({ file })` 로 데이터 파일을 바꿀 수 있다:** 세션은 patch 를 얕게 병합해 블록을 다시 쓰고, `mount.update` 의 `fileChanged` 가 새 경로로 다시 그린다. 내장(Excalidraw)은 그러지 않지만 받은 위젯은 같은 확장자의 다른 첨부를 읽고 쓰게 된다 — 위젯 설계 「그 블록의 `state.file` 하나만」 에 어긋난다.
- **잠금이 `@keyring` 을 지키지 않는다:** `parseMarketplace`(`marketLock.ts`)는 `@keyring/x` 항목의 `repo` 가 개인 저장소여도 받아 들이고, 맞추기는 「잠금이 기록」 이라 그 주소에서 받는다. `resolveInstall`·`parseRepoIndex` 는 막지만, 사람이 고쳤거나 동기화로 온 잠금은 그 둘을 거치지 않는다.
- **매니페스트 `widget.dataFile`:** `ext` 는 `^[a-z0-9]{1,16}$`(점 없음 — 레지스트리는 `"."` 으로 시작해야 한다), `initial` 은 비지 않은 UTF-8 글(1단계 계획 「3단계가 바이트로 바꾼다」), `name` 은 언어별. `ext: "md"` 를 막지 않는다 — 데이터 파일이 노트(`.md`, core `paths.ts`)가 된다.
- **위젯 메시지 검사:** `checkPackageFiles` 는 `messages/*.json` 이 「글자 값만 든 객체」 인지만 본다. 키 꼴·개수·길이 상한이 없다.
- **런타임(`frame/runtime.ts`·`runtimeEntry.ts`):** `keyringWidgetRegister(render)` 하나, 묶음 상한 gzip 20480 바이트(`widgetFrames.ts` `FRAME_RUNTIME_GZIP_LIMIT`). 위젯 코드가 등록하지 않으면(문법 오류·예외) 호스트는 `registered` 를 끝없이 기다린다 — 자리는 빈 iframe 으로 남는다.
- **iframe 격리(2단계):** `sandbox="allow-scripts"`, srcdoc, meta CSP `default-src 'none'; script-src <부트스트랩 해시> blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`, 출처 `"null"` 검사·두 번째 load·ready 면 kill(`layout.ts`). `frame.css` 는 `init` 의 `css` 로 건너가 iframe 문서의 `<style>` 이 된다(`runtimeEntry.ts` `addCss`) — 앱 문서에는 닿지 않는다. 받은 위젯도 이 길을 그대로 탄다.
- **마켓 상태(`market/state.ts`):** 적용자는 `status: "ready"` 인 것만 잠금 순서로 받는다. 맞추기는 새 판을 받은 **뒤** 잠금에 없는 판을 캐시에서 지우고 `installed` 를 한 번에 바꾼 뒤 알린다 — 적용자는 「옛 판 ready → 새 판 ready」 만 본다. 새 판을 받지 못하면(오프라인) 옛 판은 이미 지워져 그 위젯은 `error` 가 된다(1단계 규칙 — 아래 「알려진 한계」).
- **마켓 화면(2단계):** `MARKET_KINDS.widget = { installable: false }`, `installNotice?` 자리는 있으나 화면이 아직 쓰지 않는다. 둘러보기 행 밑에 `market.widgetLater`. 「설치됨」 목록은 위젯도 보이고 제거할 수 있다. `openMarket(id?)`(`Workspace.tsx`)는 `setMarketFocus(id)` 로 둘러보기를 그 id 로 거른다 — 그 id 가 어느 저장소에도 없으면 `market.noneFound` 만 보인다.
- **시험 픽스처(`server/test/fixtures/market`):** 위젯 `@me/clock@1.0.0`·`1.1.0`(둘 다 `stateVersion: 1`, `frame.js` 가 `api.t("title")` 단추 하나), `messages/ko.json` 은 1.0.0 에만.

## 정한 것(워커)과 구현자 몫

설계의 빈 곳을 메운 판단이다. 사용자 결정이 필요한 것은 없었다(코디네이터에게 묻지 않았다).

- **위젯 id 꼴:** 블록의 `widget` 은 `<id>@<상태 판>`, id 는 내장 `scope/name`(앞 `@` 없음 — 지금 `keyring/dday`·`keyring/excalidraw`) **또는** 받은 패키지 `@scope/name`. 조각 꼴은 둘 다 `[a-z0-9][a-z0-9-]*`. `REF_RE = /^(@?[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)@([1-9][0-9]*)$/`. 옛 앱 판의 기기는 `@…` 블록을 「"widget" 값이 올바르지 않습니다」 와 원문으로 보인다(원문은 남는다 — 뒤 호환으로 받아 들인다).
- **받은 위젯이 내장을 흉내 내지 못하게:** `registerWidget` 이 `builtIn: true` 면 id 가 `@` 로 시작하지 않아야, `builtIn: false` 면 `PACKAGE_ID_RE` 에 맞아야 받는다. 두 이름 공간이 겹치지 않으므로 받은 위젯은 어떤 경우에도 `keyring/…` 자리에 들어갈 수 없다.
- **`@keyring` 범위:** 공식 저장소만(index 단계는 1단계가 이미). 더해 **잠금**에서도 — `parseMarketplace` 가 `@keyring/…` 항목의 `repo` 가 공식이 아니면 `problems` 에 `market_scope_reserved` 로 넣고 받지 않는다(블록은 「받지 못함」 과 그 오류). 설계 「`@keyring` 은 공식 저장소에서만 받는다」 를 잠금 길에도 건다.
- **받은 위젯이 레지스트리에 들어오는 순간:** 위젯 적용자가 `ready()` 인 마켓 상태의 `apply(pkgs)` 를 받을 때. 패키지마다 `readPackageText(id, MANIFEST_FILE)`·`messages/*`(잠금 `sha256` 의 키 중 `messages/` 로 시작하는 것)를 읽어 항목을 만든다. **`frame.js`·`frame.css` 는 처음 그릴 때** `frame()` 이 읽는다(sha256 다시 확인). 같은 `id@version` 이면 항목 객체를 그대로 둔다(그려진 블록이 다시 그려지지 않게) — 판이 바뀐 것·새로 온 것·빠진 것만 바꾸고 바뀜을 한 번 알린다. 읽기에 실패한 패키지는 등록하지 않는다(1단계가 그 패키지를 `error` 로 표시 — 블록은 「받지 못함」).
- **마켓이 첫 맞추기를 마치기 전(`ready()` 거짓):** `@scope/name` 블록은 「찾을 수 없습니다」 가 아니라 「위젯을 준비하는 중입니다」(`kw.pending`, 단추 없음)로 그리고 바뀜 알림에 다시 판정한다 — 시작 때 「설치」 단추가 잠깐 보였다 사라지지 않게. 공통 설정을 읽지 못한 오프라인에서는 그대로 `kw.pending` 이다(받은 위젯 코드는 기기 캐시에서 읽으므로 맞추기가 끝나면 그려진다).
- **등록되지 않은 id 의 판정(순서대로):** ① id 가 `@scope/name` 이 아님(내장 꼴) → `kw.notFound`, 단추 없음(받을 수 있는 것이 아니다 — 새 앱 판의 내장일 수 있다). ② 마켓 `ready()` 거짓 → `kw.pending`. ③ 잠금에 있음: `incompatible` → `kw.needsAppUpdate`(「앱을 업데이트해야 이 위젯이 보입니다」, 단추 없음), `fetching` → `kw.pending`, `error` → `kw.packageFailed`(`{error}` = `error.<code>` 글) + 「마켓에서 보기」(`kw.openMarket`), 종류가 위젯이 아님 → `kw.notFound` 단추 없음. ④ 잠금에 없음 → `kw.notFound` + 「설치」(`kw.install`). 모든 경우 원문은 그대로 보인다.
- **「설치」 가 하는 일:** `openMarket(id)` 만 부른다(창 이벤트 `keyring:open-market`, `detail` = id — `OPEN_PATH_EVENT` 와 같은 관례). 블록을 그릴 때 저장소에 묻지 않는다(그리기마다 나가는 요청을 만들지 않는다). 마켓 화면은 저장소 목록을 **목록 순서대로**(위가 우선, 기본은 공식이 맨 위) 받아 그 id 의 행을 보인다 — 2단계 `browseRows` 그대로라 `@keyring/…` 은 공식에서만, 같은 id 가 다른 저장소에도 있으면 `market.alsoIn`. **어느 저장소에도 없으면** 둘러보기 자리에 `market.notInRepos`(「저장소 목록에서 `{id}` 를 찾을 수 없습니다. 이 위젯을 내는 저장소를 아래에서 더하세요.」)와 「모두 보기」 단추, 초점은 저장소 주소 입력. 저장소를 더하면 다시 받아 그 id 로 다시 거른다. 마켓을 쓸 수 없는 모드면 2단계 `market.unavailable` 이 그대로 보인다.
- **이력 보기·읽기 전용:** 이력 보기(`history`)에서는 「설치」·「마켓에서 보기」 단추를 두지 않는다(읽기 화면에서 볼트 설정을 바꾸는 길을 열지 않는다). 받은 위젯은 그 판의 블록 상태를 지금 깔린 코드로 `readOnly` 로 그린다(내장과 같다). 데이터 파일 위젯은 위젯 설계 그대로 「이력 보기에서는 그림을 보이지 않습니다」 와 경로.
- **받은 위젯의 `migrate`(iframe 안):** 런타임 등록은 `keyringWidgetRegister(render, { migrate? })`. 호스트는 `init`·`update` 에 그 상태의 판 `from` 과 위젯 판 `version` 을 싣는다. `from < version` 이고 상태가 있고 위젯이 `migrate` 를 주면, 런타임이 **위젯에 건네기 전에** 올리고 `{ type: "migrated", state }` 를 보낸다(같은 iframe 의 메시지는 순서대로 오므로 호스트는 그 뒤의 `setState` 보다 먼저 받는다). 호스트는 `WidgetSession.adoptMigrated(state)` — 파일을 쓰지 않고 세션의 기준 상태만 바꾸고, 그 뒤 `from = version`. 파일은 다음 적용 때 새 판으로 쓴다(위젯 설계). `migrate` 가 던지면 런타임이 `error` 를 보내고 그 자리는 `kw.migrateFailed`. `migrate` 가 없으면 지금 규칙(호환으로 보고 다음 적용 때 위젯 판). 블록 판이 위젯 판보다 높으면 부모가 `kw.tooNew`(지금 그대로). 내장 iframe 위젯(Excalidraw)은 부모 쪽 `migrate` 를 그대로 쓰고 늘 `from = version` 을 보낸다 — 인라인 내장의 동기 `migrate` 는 바꾸지 않는다.
- **`migrated` 를 믿는 범위:** 호스트는 **마지막으로 보낸 `init`·`update` 의 `from` 이 `version` 보다 낮았을 때, 그 보냄마다 한 번만** `migrated` 를 받는다(그 밖은 버림 — 바깥 변경으로 옛 판 상태가 다시 오면 다시 한 번 받는다). 모양은 `setState` 와 같은 검사(객체, 배열 아님)에 더해 아무 JSON 값 — 받은 위젯이 정하는 상태라 꼴을 앱이 따지지 않는다. 받은 상태는 블록 쓰기 전에는 파일에 닿지 않으므로 이것으로 노트를 바꿀 수 없다.
- **판이 바뀌면 열려 있는 iframe:** 레지스트리 바뀜으로 그 블록의 판정이 바뀌면(항목이 다른 객체·위젯 ↔ 오류) 다시 그린다. 단 **세션이 수정 중**이면 수정이 끝날 때(적용·버리기·포커스 아웃·블록 사라짐)까지 미루고, 데이터 파일이 있으면 다시 그리기 전에 `file.flush()` 를 기다린 뒤 지금의 `stopLive`(→ `mountFrame.destroy` 의 `FRAME_DRAIN_MS` 드레인)로 치운다 — 그리던 것을 잃지 않고, 새 iframe 은 파일을 다시 읽는다. 미루는 동안 옛 iframe 은 옛 코드로 계속 돈다(코드는 이미 iframe 안에 있다). 제거·`incompatible` 로 바뀐 것도 같은 규칙.
- **`state.file` 은 앱만 바꾼다:** 데이터 파일 위젯(내장 포함)의 `setState` patch 에 `file` 키가 있으면 호스트가 그 키를 버린다(나머지 키는 쓴다). `state.file` 을 바꾸는 길은 「위젯 넣기」 와 원문 편집, 첨부 이동·이름 바꾸기(`rewriteLinks`)뿐이다.
- **데이터 파일 위젯의 확장자·이름:** 레지스트리 `ext = "." + manifest.ext`, `initial()` = `TextEncoder().encode(manifest.initial)`, 파일 이름 앞부분은 지금 규칙(`name[볼트 언어] ?? title[볼트 언어] ?? title.en`) → `<앞부분>-<짧은 무작위>.<ext>`. core `parseWidget` 이 `ext` 가 `md` 이면 거부한다(데이터 파일이 노트가 되면 트리·검색·동기화가 노트로 다룬다). 다른 확장자는 막지 않는다(`json` 이면 다른 `.json` 첨부를 원문 편집으로 가리킬 수 있으나, 그것은 사람이 고른 것이다).
- **받은 위젯 글(messages):** 표의 키는 앞머리 없이 위젯의 것이다 — 앱 글 묶음과 섞이지 않는다(위젯이 받는 사슬은 그 표뿐, `widgetMessages`). 키 꼴 `^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}(#(zero|one|two|few|many|other))?$`, 파일마다 키 1000개·값 2000자 상한, 값은 글자. 앱은 상한을 넘거나 꼴이 틀린 키를 버리고(`checkWidgetMessages` 의 `dropped`), `pkg check` 는 경고한다. 언어 파일 이름은 1단계 꼴(`messages/<언어 태그>.json`). **앱은 위젯 글·매니페스트 이름·설명을 HTML 로 해석하지 않는다** — 앱 쪽에 닿는 자리(위젯 넣기 목록, iframe `title` 속성, 마켓 화면)는 모두 글자로 넣는다. iframe 안에서 위젯이 자기 글을 어떻게 그리는지는 위젯 몫이다(격리돼 앱에 닿지 않는다).
- **위젯 CSS:** `frame.css` 는 지금처럼 `init.css` 로만 건너가 iframe 문서 안 `<style>` 이 된다. 앱 문서에 `<style>`·`<link>` 를 만드는 길을 받은 위젯에 두지 않는다(Task 4 시험이 지킨다). iframe 안 CSP(`default-src 'none'`)라 `@import`·`url(https:…)` 은 받지 않는다 — 그림·글꼴은 data URL(설계 「format 1」).
- **`frame.js` 크기:** 1단계 상한 그대로(파일 8 MiB·패키지 16 MiB, `MARKET_LIMITS`). 새 상한을 두지 않는다. `pkg check` 가 1 MiB 를 넘으면 경고(`large_frame_js: <KiB>`) — iframe 마다 코드를 `postMessage` 로 다시 건넨다.
- **등록 시한:** 받은 위젯(`builtIn: false`)은 `ready` 를 받은 뒤 **20초** 안에 `registered` 가 오지 않으면 그 자리를 `kw.loadFailed` 로 바꾸고 iframe 을 치운다(`FRAME_REGISTER_TIMEOUT_MS = 20_000` — 문법 오류·예외로 등록하지 않는 위젯이 빈 자리로 남지 않게). 내장은 시한을 두지 않는다(5MB Excalidraw 가 느린 기기에서 늦을 수 있다).
- **WebRTC 알림:** 마켓 화면에서 **위젯 패키지를 설치할 때마다** 확인 대화상자(`market.widgetNotice` — 「이 위젯은 격리되어 앱·노트에 닿지 못하지만, 외부와 통신할 수 있습니다(WebRTC).」, 확인 단추 `market.install`). 취소하면 설치하지 않는다. 업데이트·동기화로 다른 기기에 깔리는 것에는 다시 묻지 않는다(설치는 볼트에 한 번 하는 일이고, 판이 바뀌어도 같은 위젯이다). 「설치됨」 목록의 위젯 묶음 머리에 같은 글 한 줄을 늘 둔다(`market.widgetNoticeShort`). 화면은 `MARKET_KINDS[type].installNotice` 로만 가른다 — 종류별 갈래를 두지 않는다(2단계 검문 3 의 약속).
- **위젯 넣기:** 받은 위젯도 레지스트리에 있으므로 명령 팔레트 「위젯 넣기」 목록에 들어간다(이름은 매니페스트 `name`). 데이터 파일 위젯은 지금 `insertDataFileWidget` 길 그대로.
- **구현자 몫:** 화면 문구(키 이름은 아래), 오류 블록 단추의 모양, `kw.pending` 을 얼마나 눈에 띄게 할지, 픽스처 위젯의 모양.

**알려진 한계(끝 보고·사용자 문서에 적는다)**
- 이 기기가 오프라인일 때 다른 기기가 위젯을 업데이트하면, 1단계 맞추기가 옛 판 캐시를 지우므로 다시 받을 때까지 블록은 「받지 못함」 과 원문이다(노트는 그대로).
- iframe 안 WebRTC·자기 탐색 URL 로 이미 가진 상태를 밖에 내보내는 것은 막지 못한다(`docs/guides/development.md` 「알려진 한계」) — 알림만 한다.
- 다른 기기가 동기화로 깐 위젯에는 그 기기에서 알림이 뜨지 않는다.

## Global Constraints

- 웹 CSP 는 그대로다(`connect-src 'self'`). 서버 `APP_CSP`·`tauri.conf.json` `security.csp`·iframe `FRAME_META_CSP`·`FRAME_BOOTSTRAP`(해시)를 바꾸지 않는다. 서버 API 를 바꾸지 않는다.
- 받은 위젯은 늘 iframe 이다(`effectiveIsolation` — `builtIn: false`). 위젯 설계의 iframe 규칙(출처 `"null"` 검사·자기 탐색 차단·데이터 파일 하나만·CSP 해시)을 그대로 탄다. `mountFrame`·`layout.ts`·`bootstrap.ts` 의 격리 판정을 받은 위젯 때문에 느슨하게 하지 않는다.
- 패키지 내용은 늘 `readPackageText`/`readPackageFile`(잠금의 sha256 으로 다시 확인)로 읽는다. `InstalledPackage.manifest`·index 표시 필드는 보여 주기에만.
- 패키지를 지우거나 받지 못해도 블록 원문은 늘 남고 원문으로 고칠 수 있다. 앱은 위젯 블록을 읽기만으로 바꾸지 않는다.
- 런타임 묶음은 gzip 20480 바이트 상한 안(`FRAME_RUNTIME_GZIP_LIMIT`) — `runtime.ts` 에 새 import 를 더하지 않는다.
- 새 CSS 는 토큰만. 화면 글은 `packages/core/src/messages/{en,ko}.json` 같은 커밋, en·ko 같은 키(`packages/core/test/i18n.test.ts`), 알파벳 자리. 새 키: `kw.install`·`kw.openMarket`·`kw.pending`·`kw.needsAppUpdate`·`kw.packageFailed`, `market.widgetNotice`·`market.widgetNoticeShort`·`market.notInRepos`·`market.showAll`. 지우는 키: `market.widgetLater`. 사용자 문서 `docs/manual/{en,ko}/` 같은 커밋.
- 새 npm 의존성 없음. 시험은 Node(vitest, DOM 없음). 명령: core `cd packages/core && pnpm exec vitest run`, server `pnpm --filter @keyring-notes/server test`, web `cd web && pnpm exec vitest run`, 타입 `pnpm typecheck`, 웹 빌드 `pnpm --filter @keyring-notes/web build`, 형식·린트 `pnpm fmt:check`·`pnpm lint`. 시작 전에 패키지별 시험 개수를 적어 두고 끝에 늘었는지 본다.
- 커밋 메시지는 한국어(`feat(core): …`·`feat(web): …`·`docs: …`), 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 파일은 경로로 stage. `docs/ops/ux.md` 는 고치지 않는다. `git stash` 금지. 커밋된 픽스처는 Task 2 만 더한다(있는 판은 바꾸지 않는다).

## Review Focus

1. **받은 위젯이 탈출을 시도함** — `parent.document`·`top.location = …`·`localStorage`·`fetch("https://…")`·다른 인스턴스 id 로 위조한 메시지·`setState({ file: "다른/첨부.sketch" })`·`frame.css` 의 `body { display: none }`. 기대: 앱 문서·저장소·네트워크에 닿지 못하고(CSP 위반으로 막힘), 자기 탐색이면 그 자리만 `kw.frameNavigated`, 위조 메시지는 버려지며, `file` 키는 버려져 블록의 `state.file` 이 그대로, 앱 화면 모양이 그대로. (Task 4: `setState` 의 `file` 버림 시험, Task 2 픽스처 `@me/probe`, 검문 2 화면)
2. **판이 낮은 블록(`@me/counter@1`)을 상태 판 2 위젯으로 열고 아무것도 하지 않음, 그다음 +1** — 열기만으로는 파일이 바뀌지 않고, 위젯에는 올린 상태(`{ count }`)가 보이며, +1 한 번에 블록이 `@me/counter@2` 와 올린 모양으로 한 번 쓰인다(옛 모양에 새 판 번호가 찍히지 않음). `migrate` 가 던지면 `kw.migrateFailed` 와 원문. (Task 4 런타임·호스트 시험, 검문 2 화면)
3. **위젯을 그리는 중(수정 모드·저장 안 된 데이터 파일)에 다른 기기가 새 판으로 업데이트하거나 제거함** — 수정이 끝날 때까지 옛 iframe 이 그대로이고, 끝나면 적용한 상태가 쓰인 뒤 새 판(또는 원문과 「설치」)으로 다시 그려진다. 데이터 파일은 비워진 뒤 다시 읽혀 마지막 그림을 잃지 않는다. (Task 6: 미룸 판정 시험, 검문 2 화면)
4. **앱 시작 직후·오프라인에서 받은 위젯 블록** — 첫 맞추기 전에는 「설치」 가 아니라 「준비하는 중」 이고, 맞추기 뒤 저절로 위젯으로 바뀐다. 캐시에 있는 위젯은 서버 없이(오프라인) 그려진다. engines 가 안 맞는 기기에서만 「앱을 업데이트해야…」. (Task 3: 판정기 시험, Task 5: `ready()` 시험, 검문 2 화면)
5. **잠금을 손으로 고쳐 `@keyring/clock` 의 `repo` 를 개인 저장소로, 또는 받은 위젯 id 를 `keyring/dday` 로 꾸밈** — 개인 저장소에서 받지 않고 그 블록은 `kw.packageFailed`(`error.market_scope_reserved`)와 원문, `keyring/…` 꼴 받은 위젯은 등록되지 않는다(내장 D-day 는 그대로). (Task 1·3 시험)

---

### Task 1: core — 위젯 ref 의 `@scope/name`, 잠금의 `@keyring` 지킴

**Files:**
- Modify: `packages/core/src/keyringWidget.ts`(`REF_RE`), `packages/core/src/marketLock.ts`(`parseMarketplace`)
- Test: `packages/core/test/keyringWidget.test.ts`, `packages/core/test/marketLock.test.ts`(없으면 1단계 잠금 시험이 있는 파일 — `grep -ln parseMarketplace packages/core/test`), `packages/core/test/links.test.ts`(있으면 — 받은 위젯의 `state.file` 이 첨부 링크)

**Interfaces:**
- Produces: `parseWidgetRef("@me/clock@1") → { id: "@me/clock", version: 1 }`(내장 꼴 그대로). `MarketplaceSettings.problems` 의 `code` 에 `"market_scope_reserved"` 를 더함(`{ id, code }`).

- [ ] **Step 1: 실패하는 시험**
  - `parseWidgetRef`: `"@me/clock@1"` → `{ id: "@me/clock", version: 1 }`, `"keyring/dday@1"` 그대로, `"@@me/clock@1"`·`"@me/Clock@1"`·`"@/x@1"`·`"@me/clock@0"`·`"@me/clock"`·`"me/@clock@1"` → null. `formatWidgetRef` 왕복.
  - `parseWidgetBlock('{"widget":"@me/clock@2","state":{"count":1}}')` → ok, `serializeWidgetBlock` 이 같은 글.
  - `widgetFileRefs` 에 `@me/sketch@1` 블록의 `state.file` 이 든다.
  - `parseMarketplace({ packages: { "@keyring/clock": { version: "1.0.0", repo: "https://me.example/", sha256: {…} } } })` → `packages` 에 없고 `problems` 에 `{ id: "@keyring/clock", code: "market_scope_reserved" }`. 같은 항목의 `repo` 가 `OFFICIAL_REPO_URL` 이면 `packages` 에 있음.
- [ ] **Step 2: 실패 확인** — `cd packages/core && pnpm exec vitest run test/keyringWidget.test.ts test/marketLock.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `REF_RE` 를 위 「정한 것」 의 꼴로. `parseMarketplace` 는 항목을 읽은 뒤 `parsePackageId(id)?.scope === "keyring" && !isOfficialRepo(entry.repo)` 면 `problems`. web `market/state.ts` 는 `problems` 를 이미 `{ code: p.code, params: { id: p.id } }` 의 `error` 로 바꾸므로(기준 커밋) `error.market_scope_reserved` 의 `{id}` 가 채워진다 — `MarketplaceSettings["problems"]` 의 `code` 타입만 넓힌다.
- [ ] **Step 4: 통과 확인** — core 전체 + `cd web && pnpm exec vitest run src/market` → PASS.
- [ ] **Step 5: 커밋** — `feat(core): 위젯 블록이 받은 위젯 id(@scope/name@N)를 받고, 잠금의 @keyring 항목은 공식 저장소만`

### Task 2: core·server — 받은 위젯 검사, `pkg check` 의 위젯 검사, 위젯 픽스처

**Files:**
- Create: `packages/core/src/widgetMessages.ts`, 픽스처 `server/test/fixtures/market/packages/me/{counter/1.0.0,counter/2.0.0,sketch/1.0.0,probe/1.0.0,silent/1.0.0}/…`(+ `index.json` 다시 만듦)
- Modify: `packages/core/src/marketFormat.ts`(`parseWidget` 의 `ext: "md"` 거부, `checkPackageFiles` 의 위젯 갈래), `packages/core/src/index.ts`, `server/src/pkgCli.ts`(`checkPackageDir` 에 `frame.js` 문법), `docs/manual/{en,ko}/how-to/publish-packages.md`(위젯 절)
- Test: `packages/core/test/widgetMessages.test.ts`, `packages/core/test/marketManifest.test.ts`, `server/test/pkgCli.test.ts`, 픽스처 목록에 기대는 시험(`grep -rn "fixtures/market" server/test web/src` — 2단계 Task 3 과 같은 방법으로 id 목록을 맞춘다)

**Interfaces:**
- Produces:
  - `WIDGET_MESSAGE_LIMITS = { keys: 1000, value: 2000 } as const`, `WIDGET_MESSAGE_KEY_RE`(위 꼴)
  - `checkWidgetMessages(raw: unknown): { messages: Record<string, string>; dropped: string[] } | null` — 객체가 아니면 null. 꼴이 틀린 키·글자가 아닌 값·2000자 넘는 값·1000개를 넘는 뒤쪽 키는 `dropped`.
  - `checkPackageFiles` 위젯 경고: `messages_dropped: <파일>: <키, …>`(처음 10개), `large_frame_js: <KiB>`(1 MiB 초과). 객체가 아닌 메시지 파일은 지금처럼 오류.
  - server `checkPackageDir`: 위젯이면 `new vm.Script(frameJs, { filename: "frame.js" })` 로 문법만 검사(실행하지 않는다). 실패하면 `market_manifest_invalid`(`reason: "frame_js_syntax: <메시지 첫 줄>"`). `import`·`export` 가 든 모듈 꼴도 여기서 걸린다(블롭 스크립트는 고전 스크립트).
- 픽스처(검문 2·3 의 시험 자료 — 모두 `pkg check` 를 지난다):
  - `@me/counter@1.0.0`: `stateVersion: 1`, `defaultState: { n: 0 }`, `frame.js` = 「+1」 단추(보기 모드 `setState({ n: n + 1 })`), `messages/en.json`·`ko.json`.
  - `@me/counter@2.0.0`: `stateVersion: 2`, `defaultState: { count: 0 }`, `keyringWidgetRegister(render, { migrate: (s, from) => from < 2 ? { count: s.n ?? 0 } : s })`, 「+1」 은 `count`.
  - `@me/sketch@1.0.0`: `dataFile: { ext: "sketch", initial: "{\"lines\":[]}" }`, `frame.js` 는 `api.file` 로 글을 읽고 단추로 줄을 더해 쓴다.
  - `@me/probe@1.0.0`: Review Focus 1 의 시도를 하나씩 단추로 하고 결과를 iframe 안에 글로 보인다. `frame.css` 에 `:root, body { background: red } html { display: none }` 같은 것(iframe 밖에 닿지 않음을 보려고 — iframe 안이 가려지면 단추를 못 누르므로 `display` 는 `body > .kw-frame-root` 밖 요소에만).
  - `@me/silent@1.0.0`: 문법은 맞고 `keyringWidgetRegister` 를 부르지 않는다(등록 시한).
- [ ] **Step 1: 실패하는 시험**
  - `widgetMessages.test.ts`: `{ "title": "Clock", "count#one": "{n} tick" }` → 그대로·`dropped: []`. `{ "bad key": "x", "a": 3, "b": "y".repeat(2001), "<b>": "z" }` → `messages` 비고 `dropped` 넷. 1001개 → 뒤 하나 `dropped`. `[]`·`"x"` → null. 값 `"<img src=x onerror=alert(1)>"` 은 그대로 글자(버리지 않는다 — 앱은 HTML 로 해석하지 않는다).
  - `marketManifest.test.ts`: `dataFile.ext: "md"` → `market_manifest_invalid`(`widget.dataFile.ext`), `"MD"` 도(대문자는 지금도 꼴에서 걸림). 위젯 메시지에 틀린 키가 있으면 오류 없이 경고 `messages_dropped`. `frame.js` 1.5 MiB → 경고 `large_frame_js: 1536`.
  - `pkgCli.test.ts`: 임시 폴더 위젯 패키지 — `frame.js` 가 `self.keyringWidgetRegister(() => () => {})` 면 통과, `function (` 면 실패(`frame_js_syntax`), `export default 1` 이면 실패. 새 픽스처 다섯이 `checkPackageDir` 를 지난다(경고는 있어도 됨). `buildRepoIndex(fixtures)` 두 번째 `written: false`.
- [ ] **Step 2: 실패 확인** — `cd packages/core && pnpm exec vitest run test/widgetMessages.test.ts test/marketManifest.test.ts`, `pnpm --filter @keyring-notes/server test -- pkgCli` → FAIL.
- [ ] **Step 3: 구현** — 위 서명대로. 픽스처를 만들고 `pnpm keyring pkg index server/test/fixtures/market` 로 `index.json` 을 다시 만든다. `publish-packages` en·ko 위젯 절: `keyringWidgetRegister(render, { migrate })` 와 「iframe 안에서 돈다·블록 판이 낮으면 위젯에 건네기 전에 부른다·던지면 원문」, 메시지 키 꼴·상한·`#one` 복수형·「앱은 글을 HTML 로 해석하지 않는다」, `dataFile.ext`(`md` 불가, 파일 이름 꼴), `frame.js` 는 고전 스크립트(모듈 아님)·1 MiB 경고·8 MiB 상한, `frame.css` 는 위젯 iframe 안에만·외부 주소 불가, 위젯 id 는 블록에 `@scope/name@<stateVersion>`, 맨 위 「위젯 설치는 다음 릴리스」 줄 지움.
- [ ] **Step 4: 통과 확인** — core·server 전체 → PASS.
- [ ] **Step 5: 커밋** — `feat(core,server): 받은 위젯 메시지 키 검사, 데이터 파일 확장자 md 거부, pkg check 의 frame.js 문법·크기 경고, 위젯 픽스처`

> **── 검문 1 (Task 1–2): 형식과 검사. 네트워크·화면 없음 — 시험과 코드 리뷰로 본다. 특히 `REF_RE` 가 내장 꼴을 그대로 받고 `@` 하나만 더 받는지(`@@`·대문자·0판 거부), 잠금의 `@keyring` 지킴이 `resolveInstall` 과 같은 판정(`isOfficialRepo`)인지, `pkg check` 의 문법 검사가 `frame.js` 를 **실행하지 않는지**(`vm.Script` 생성만 — `runInThisContext` 없음), 픽스처 다섯을 `pkg check` 로 돌려 경고가 기대대로인지, 있는 픽스처 판이 그대로인지(`git diff --stat server/test/fixtures/market/packages/me/clock`). ──**

### Task 3: web — 레지스트리의 받은 위젯 묶음·바뀜 알림·없는 위젯 판정

**Files:**
- Modify: `web/src/widgets/registry.ts`
- Test: `web/src/widgets/registry.test.ts`

**Interfaces:**
- Consumes: core `PACKAGE_ID_RE`·`parsePackageId`.
- Produces:
  ```ts
  /** 받은 위젯이 등록되지 않은 까닭(마켓 위젯 모듈이 답한다 — Task 5). 기본 판정기는 늘 { kind: "notFound", install: false } */
  export type MissingWidget =
    | { kind: "notFound"; install: boolean }
    | { kind: "pending" }
    | { kind: "incompatible" }
    | { kind: "failed"; error: { code: string; params: Record<string, string | number> } };
  export function setMissingWidgetResolver(fn: ((id: string) => MissingWidget) | null): void;
  /** 받은 위젯 전부를 바꾼다. 같은 def.id 이고 같은 객체면 그대로 — 바뀐 것이 있을 때만 알린다. builtIn 항목은 던진다 */
  export function setMarketWidgets(entries: FrameWidgetEntry[]): void;
  export function onWidgetsChange(fn: () => void): () => void;
  /** 판정기의 답이 바뀌었을 수 있을 때(마켓 상태 바뀜) — 알림만 */
  export function notifyWidgetsChanged(): void;
  ```
  - `WidgetView` 의 오류 꼴에 선택 필드 `action?: { kind: "install" | "market"; id: string }` 와 `error?: { code: string; params: Record<string, string | number> }`(`kw.packageFailed` 의 까닭 — 화면이 `t("error." + code, params)` 로 `{error}` 를 채운다).
  - `WidgetView` 의 위젯 꼴에 `from: number` — 지금 상태의 판. 부모가 올렸거나(내장 `migrate`) 블록에 `state` 가 없어 기본 상태를 쓰면 `def.version`, 받은 위젯(`builtIn: false`)이면 `block.widget.version`.
  - `registerWidget` 이 더 거부하는 것: `builtIn: true` 인데 id 가 `@` 로 시작함, `builtIn: false` 인데 `PACKAGE_ID_RE` 에 맞지 않음.

- [ ] **Step 1: 실패하는 시험** — `registry.test.ts`:
  - `registerWidget({ def: { …, id: "keyring/dday" }, builtIn: false, … })` → 던짐(Review Focus 5). `{ id: "@me/x", builtIn: true }` → 던짐. `{ id: "@me/x", builtIn: false, messages: {}, frame }` → 됨.
  - `setMarketWidgets([a])` → 알림 1번, `findWidget("@me/a") === a`. 같은 배열로 다시 → 알림 0번. `[a2]`(같은 id, 다른 객체) → 1번, `findWidget` 이 `a2`. `[]` → 1번, 없음. 내장은 `setMarketWidgets` 가 건드리지 않는다(`widgetList()` 에 남음). 같은 id 둘 → 던짐.
  - `resolveWidgetView` 의 없는 id: 판정기 없음 → `{ key: "kw.notFound" }`, action 없음. 판정기가 `{ kind: "notFound", install: true }` → `action: { kind: "install", id }`. `pending` → `kw.pending`, `incompatible` → `kw.needsAppUpdate`, `failed` → `kw.packageFailed` + `error: { code, params }` + `action: { kind: "market", id }`.
  - 받은 위젯(`builtIn: false`, `version: 2`) + 블록 `@me/c@1`·`state: { n: 1 }` → `kind: "widget"`, `state: { n: 1 }`(부모가 바꾸지 않음), `from: 1`. 같은 블록에 `state` 없음 → 기본 상태, `from: 2`. 블록 `@me/c@3` → `kw.tooNew`. 내장 + `migrate` → `from === def.version`.
  - `widgetViewChange`: 항목 객체가 바뀌면 `"remount"`(지금 규칙 — 판 교체가 여기에 걸린다).
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets/registry.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 위 서명대로. `resolveWidgetView` 는 `builtIn: false` 이면 `resolveWidgetState` 의 `tooNew` 판정만 쓰고 `migrate` 를 부르지 않는다(def 에 없다 — 앞으로 생겨도 부르지 않는다). 받은 위젯 항목은 내장 뒤에 둔다(`widgetList` 순서: 내장 → 받은 것, 받은 것은 `setMarketWidgets` 의 순서 = 잠금 순서).
- [ ] **Step 4: 통과 확인** — `cd web && pnpm exec vitest run src/widgets` + 타입 검사 → PASS.
- [ ] **Step 5: 커밋** — `feat(web): 위젯 레지스트리의 받은 위젯 묶음·바뀜 알림·없는 위젯 판정, 내장 id 흉내 거부`

### Task 4: web — iframe 안 `migrate`, `state.file` 지킴, 받은 위젯 등록 시한

**Files:**
- Modify: `web/src/widgets/frame/protocol.ts`, `web/src/widgets/frame/runtime.ts`, `web/src/widgets/frame/runtimeEntry.ts`, `web/src/widgets/frame/host.ts`, `web/src/widgets/frame/mountFrame.ts`, `web/src/widgets/session.ts`, `web/src/widgets/mount.ts`(`from` 을 잇기만 — 다시 그리기 규칙은 Task 6)
- Test: `web/src/widgets/frame/protocol.test.ts`, `runtime.test.ts`, `host.test.ts`, `equivalence.test.ts`(D-day 두 연결이 여전히 같음), `web/src/widgets/session.test.ts`

**Interfaces:**
- Consumes: `WidgetView.from`(Task 3).
- Produces:
  - `HostMsg` `init`·`update` 에 `from: number`·`version: number`. `FrameMsg` 에 `{ type: "migrated"; state: unknown }`(`parseFrameMsg` — `state` 가 `undefined` 가 아니면 받음).
  - 런타임: `register(render: WidgetRender, opts?: { migrate?(state: unknown, from: number): unknown }): void`, `self.keyringWidgetRegister(render, opts?)`.
  - `WidgetSession.adoptMigrated(state: unknown): void` — 쓰지 않는다. 수정 중이 아니면 `base = state`, 수정 중이면 `editStart = state`(초안은 그대로). `notify` 하지 않는다(iframe 은 이미 올린 상태로 그렸다).
  - `FrameHostOptions` 에 `from(): number`, `migrated(state: unknown): void`, `builtIn: boolean`, `dataFile: boolean`, `registerTimeout(): void`(시한이 지남 — mountFrame 이 그 자리를 `kw.loadFailed` 로).
  - `Resume` 에 `from: number`(다시 붙는 위젯이 이어받는 초안의 판).
  - `FRAME_REGISTER_TIMEOUT_MS = 20_000`(`layout.ts`).

- [ ] **Step 1: 실패하는 시험**
  - `protocol.test.ts`: `{ kw, id, type: "migrated", state: { count: 1 } }` → 받음, `state` 없음 → null.
  - `runtime.test.ts`(가짜 env): `register(render, { migrate })` 후 `init` 에 `from: 1, version: 2, ctx.state: { n: 3 }` → `migrate({ n: 3 }, 1)` 이 불리고, `render` 가 받은 `ctx.state` 가 올린 것, 보낸 메시지 순서가 `registered` → `migrated { count: 3 }` (render 의 `setState` 보다 앞). `from === version` 이면 `migrate` 를 부르지 않고 `migrated` 도 없음. `migrate` 가 없으면 옛 상태 그대로·`migrated` 없음. `migrate` 가 던지면 `error` 를 보내고 `render` 를 부르지 않음. `update` 에 `from < version` 인 새 상태(바깥 변경)가 오면 다시 올리고 `migrated` 를 한 번 더 보냄.
  - `host.test.ts`: 마지막으로 보낸 `from` 이 `version` 보다 낮을 때 온 `migrated` → `o.migrated(state)` 한 번. 같은 보냄에 두 번째 `migrated` → 버림. `from() === version` 일 때 온 것 → 버림. 그 뒤 `update` 가 다시 낮은 `from` 을 보내면 다음 `migrated` 하나를 받음. `dataFile: true` 인 호스트가 `setState({ file: "x.sketch", a: 1 })` 를 받으면 세션에 `{ a: 1 }` 만 넘어감(Review Focus 1), `{ file: "x" }` 만이면 세션을 부르지 않음. `builtIn: false` 이고 `ready` 뒤 시한이 지나도록 `registered` 가 없으면 `registerTimeout` — 가짜 시계, `registered` 가 먼저 오면 부르지 않음, `builtIn: true` 면 시한 없음. **CSS 가 앱 문서에 닿지 않음:** 호스트가 `css` 를 `init` 메시지로만 보낸다(`post` 이외에 css 를 넘기는 길이 없다 — `FrameHostOptions` 에 DOM 이 없음을 타입으로 지킨다).
  - `session.test.ts`: `adoptMigrated(s)` 뒤 `state === s`, `host.write` 0번, `setState({ count: 4 })` 가 `{ ...s, count: 4 }` 를 씀. 수정 중 `adoptMigrated` → 초안 그대로, 바꾸지 않고 끝내면(포커스 아웃) 쓰지 않음(`editStart` 가 올린 상태라 같다 — 적용 때 옛 상태로 비교하지 않는다).
  - `equivalence.test.ts`: 지금 시험이 그대로 지남(D-day iframe 연결 — `from === version`).
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets` → FAIL.
- [ ] **Step 3: 구현**
  - `mount.ts`: `let from = view.from`(이어받을 때는 `resume.from`), `mountFrame` 에 `from: () => from`·`migrated: (s) => { session.adoptMigrated(s); from = entry.def.version; }`, 블록이 바깥에서 바뀌면(`session.external`) `from = nextView.from`. 다시 그리기 때 넘기는 `Resume` 에 `from`.
  - 받은 위젯이 아닌 iframe(내장)은 `from` 이 늘 `def.version` — 런타임이 `migrate` 를 부를 일이 없다.
  - `host.ts` 의 `setState`: `o.dataFile` 이면 patch 에서 `file` 을 뺀다(남은 키가 없으면 무시). 인라인 위젯의 `widgetApi.ts` 에도 같은 지킴(내장뿐이지만 같은 규칙을 한 곳 함수 `stripFileKey(patch)` 로 — `session.ts` 옆).
  - 런타임 크기 상한 안에 든다(`pnpm --filter @keyring-notes/web build` 가 `FRAME_RUNTIME_GZIP_LIMIT` 를 본다).
- [ ] **Step 4: 통과 확인** — web 시험 전체 + 타입 검사 + 웹 빌드 → PASS.
- [ ] **Step 5: 커밋** — `feat(web): 받은 위젯의 migrate 를 iframe 안에서(올린 상태를 호스트가 기준으로), 데이터 파일 경로는 앱만 바꿈, 받은 위젯 등록 시한`

### Task 5: web — 마켓 위젯 적용자

**Files:**
- Create: `web/src/widgets/marketWidgets.ts`
- Modify: `web/src/main.tsx`(`registerWidgetKind(market())` — 2단계의 `registerThemeKind`·`registerLanguageKind` 옆)
- Test: `web/src/widgets/marketWidgets.test.ts`

**Interfaces:**
- Consumes: `MarketState`(`installedPackages`·`readPackageText`·`registerPackageKind`·`onPackagesChange`·`ready`), core `parseManifest`·`MANIFEST_FILE`·`checkWidgetMessages`(Task 2)·`PACKAGE_ID_RE`, `setMarketWidgets`·`setMissingWidgetResolver`·`notifyWidgetsChanged`·`MissingWidget`(Task 3).
- Produces:
  - `widgetEntryFromPackage(manifest: PackageManifest, messages: WidgetMessageTable, read: (path: string) => Promise<string>, hasCss: boolean): FrameWidgetEntry`(순수 — 시험 대상). `def`: `id = manifest.id`, `version = widget.stateVersion`, `isolation: "frame"`, `display`, `title = manifest.name`, `defaultState: () => structuredClone(widget.defaultState)`, `dataFile` 이 있으면 `{ ext: "." + ext, initial: () => new TextEncoder().encode(initial), name }`. `builtIn: false`, `messages`, `frame: async () => ({ kind: "text", js: await read("frame.js"), css: hasCss ? await read("frame.css") : undefined })`. 항목에 `pkgVersion: string`(같은 판인지 보려고 — `FrameWidgetEntry` 에 선택 필드로 더한다).
  - `missingWidget(id: string, m: Pick<MarketState, "installedPackages" | "ready">): MissingWidget` — 위 「등록되지 않은 id 의 판정」 순서 그대로.
  - `registerWidgetKind(m: MarketState, deps = { setMarketWidgets, setMissingWidgetResolver, notifyWidgetsChanged }): () => void` — 판정기를 걸고, `apply(pkgs)`: `ready()` 거짓이면 아무것도 등록하지 않는다(판정기가 `pending`). 참이면 패키지마다 매니페스트(`readPackageText` → `parseManifest`, `type === "widget"` 이고 `id` 가 잠금 id 와 같아야)·메시지(`messages/<lang>.json` → `checkWidgetMessages`, 실패한 파일은 뺀다)를 읽어 항목을 만들되 **지난번과 같은 `id@pkgVersion` 이면 지난번 객체**를 쓴다. 읽기 실패한 패키지는 뺀다. 끝에 `setMarketWidgets(list)`. `onPackagesChange` 에 `notifyWidgetsChanged()`(상태만 바뀐 것 — `fetching`·`error`·`incompatible` — 을 그려진 블록이 다시 판정하게).

- [ ] **Step 1: 실패하는 시험** — 가짜 `MarketState`(Task 2 픽스처 `@me/counter@2.0.0`·`@me/sketch` 의 파일을 읽어 주는):
  - `widgetEntryFromPackage(counter2)` → `def.version === 2`, `isolation === "frame"`, `builtIn === false`, `frame()` 이 `{ kind: "text", js: <frame.js 글> }`, `frame.css` 가 없으면 `css` 없음. `sketch` → `def.dataFile.ext === ".sketch"`, `initial()` 이 `{"lines":[]}` 의 UTF-8 바이트. `defaultState()` 두 번이 서로 다른 객체(위젯이 바꿔도 다음 넣기에 새지 않게). 이름 `{ en: "<b>C</b>" }` 은 `title.en` 에 글자 그대로.
  - `apply` 두 번(같은 판) → `setMarketWidgets` 에 넘긴 항목이 같은 객체(그려진 블록이 다시 그려지지 않음). 판이 바뀌면 새 객체. `readPackageText` 가 `market_hash_mismatch` 로 던지는 패키지는 빠짐. 매니페스트 `id` 가 잠금 id 와 다르면 빠짐. 메시지 파일 하나가 객체가 아니면 그 언어만 빠지고 항목은 등록.
  - `ready()` 거짓 → `setMarketWidgets` 0번. `missingWidget`: `"keyring/x"` → `notFound`·`install: false`, ready 거짓 + `"@me/x"` → `pending`, 잠금에 `incompatible` → `incompatible`, `error`(`market_scope_reserved`) → `failed` 와 그 코드, 잠금에 없음 → `notFound`·`install: true`, 잠금에 있는데 종류가 `theme` → `notFound`·`install: false`(Review Focus 4·5).
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets/marketWidgets.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 위 서명대로. `main.tsx` 등록.
- [ ] **Step 4: 통과 확인** — web 시험 전체 + 타입 검사 → PASS.
- [ ] **Step 5: 커밋** — `feat(web): 받은 위젯 패키지를 레지스트리의 iframe 위젯으로(잠금이 원천, 같은 판은 그대로), 없는 위젯의 까닭 판정`

### Task 6: web — 그려진 블록의 다시 그리기와 「설치」·「마켓에서 보기」

**Files:**
- Modify: `web/src/widgets/mount.ts`, `web/src/Workspace.tsx`(`keyring:open-market` 을 듣고 `openMarket(id)`), `web/src/styles.css`(오류 블록 단추 — 토큰만), `packages/core/src/messages/{en,ko}.json`(`kw.install`·`kw.openMarket`·`kw.pending`·`kw.needsAppUpdate`·`kw.packageFailed`)
- Create: `web/src/widgets/refresh.ts`(다시 그리기 판정 — DOM 없음)
- Test: `web/src/widgets/refresh.test.ts`

**Interfaces:**
- Consumes: `onWidgetsChange`·`resolveWidgetView`·`widgetViewChange`·`WidgetView.action`(Task 3), `OPEN_PATH_EVENT` 관례.
- Produces:
  - `export const OPEN_MARKET_EVENT = "keyring:open-market"`(`mount.ts`).
  - `refreshAction(prev: WidgetView, next: WidgetView, s: { editing: boolean }): "none" | "now" | "defer"` — 같은 위젯(같은 항목 객체·같은 display)이면 `"none"`, 오류 → 같은 오류(같은 key·vars·action)면 `"none"`, 그 밖은 수정 중이면 `"defer"`, 아니면 `"now"`.
  - 메시지 키 `kw.install`·`kw.openMarket`·`kw.pending`·`kw.needsAppUpdate`·`kw.packageFailed`(`{error}`).

- [ ] **Step 1: 실패하는 시험** — `refresh.test.ts`: 같은 항목 → `"none"`. 항목 객체가 바뀜(판 교체) + 수정 중 아님 → `"now"`, 수정 중 → `"defer"`. 위젯 → `kw.notFound` 오류(제거) + 수정 중 → `"defer"`. `kw.pending` → 위젯(맞추기 끝) → `"now"`. `kw.notFound`(action install) → 같은 것 → `"none"`. `kw.pending` → `kw.needsAppUpdate` → `"now"`.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets/refresh.test.ts` → FAIL.
- [ ] **Step 3: 구현**
  - `mountKeyringWidget`: `onWidgetsChange` 를 듣는다(`destroy` 에서 끊음). 들으면 `next = resolveWidgetView(body)` → `refreshAction(view, next, { editing: live?.session.editing ?? false })`. `"now"`: 데이터 파일이 있으면 `await file.flush()`(실패해도 진행 — 드레인·충돌 사본 규칙이 그대로 지킨다) 뒤 `stopLive(); view = next; start(null)`. `"defer"`: 표시만 남기고, 세션 `changed` 에서 `editing` 이 거짓이 되면 그때 다시 판정한다(그사이 블록이 바뀌었으면 `update` 가 이미 다시 그린다 — 표시를 지운다). 사라진 블록(`gone`)이면 표시를 지운다.
  - `errorBlock(el, body, message, onRaw, action?)`: `action` 이 있고 `!opts.history` 면 오류 줄 옆에 단추(`kw.install` 또는 `kw.openMarket`, `type="button"`). 단추의 `mousedown`·`click` 은 `stopPropagation`(블록 전체의 「원문으로」 mousedown 과 갈리게), 누르면 `window.dispatchEvent(new CustomEvent(OPEN_MARKET_EVENT, { detail: id }))`. `kw.packageFailed` 의 `{error}` 는 `t("error." + code, params)`.
  - `Workspace.tsx`: `OPEN_MARKET_EVENT` 를 듣고 `detail` 이 `PACKAGE_ID_RE` 에 맞을 때만 `openMarket(detail)`.
- [ ] **Step 4: 통과 확인** — web 시험 전체 + 타입 검사 + 웹 빌드 → PASS.
- [ ] **Step 5: 커밋** — `feat(web): 받은 위젯이 들어오고 바뀌고 빠질 때 그려진 블록을 다시 그림(수정 중이면 끝난 뒤), 없는 위젯의 「설치」·「마켓에서 보기」`

> **── 검문 2 (Task 3–6): 받은 위젯 적용. 시험에 더해 화면으로 본다 — 2단계 검문 2 와 같은 꾸밈: Task 2 픽스처를 스크래치 사본으로 복사해 이 기기의 로컬 정적 서버(`127.0.0.1`, 다른 포트)로 내고, 시험 서버(임시 `KEYRING_DATA`, 다른 포트, `KEYRING_MARKET_ALLOW_HTTP=1 KEYRING_MARKET_ALLOW_PRIVATE=1`)에 개발 빌드의 `globalThis.keyringMarket.installPackage` 로 설치한다(마켓 화면의 위젯 설치는 Task 7). 바깥에 올리지 않는다. Playwright chromium·webkit 으로: ① `@me/counter@1.0.0` 설치 → 「위젯 넣기」 목록에 보임 → 넣기·+1(블록 `@me/counter@1`, `{ n: 1 }`). ② 사본에 `counter@2.0.0` 을 두고 잠금을 2.0.0 으로(`installPackage(id, { version })`) → 블록이 다시 그려지고 `count: 1` 로 보이며 **파일은 그대로**(블록 글 `@me/counter@1`), +1 하면 `@me/counter@2`·`{ "count": 2 }` 로 한 번 쓰임(Review Focus 2). ③ 수정 중에 다른 브라우저 문맥(두 번째 기기)이 판을 바꾸거나 제거 → 수정이 끝날 때까지 그대로, 끝나면 다시 그려짐. `@me/sketch` 로 같은 것을 하며 그림이 사라지지 않음(Review Focus 3). ④ 제거 → 블록이 원문 + 「설치」, 누르면 마켓 화면이 그 id 로 걸러 열림. 저장소에 없는 `@me/none@1` 블록 → `market.notInRepos`. 이력 보기에서는 단추 없음. ⑤ 새로고침 직후 「준비하는 중」 → 위젯(「설치」 가 깜빡이지 않음), 서버를 끈 뒤(오프라인) 새로고침해도 캐시의 위젯이 그려짐, `keyring-settings.md` 의 잠금 `engines` 가 안 맞는 판으로 손으로 바꾼 사본 기기에서 「앱을 업데이트해야…」(Review Focus 4). ⑥ `@me/probe` 의 시도 전부 — CSP 위반만 나고 앱 `document`·`localStorage`·네트워크(서버 로그·정적 서버 접근 기록) 0, `file` 바꾸기 무시, 앱 화면 배경 그대로, 자기 탐색이면 그 자리만 멈춤(Review Focus 1). ⑦ `@me/silent` → 20초 뒤 `kw.loadFailed`. ⑧ 잠금의 `@keyring/hello` 를 개인 저장소 주소로 손으로 고침 → 받지 않고 `error.market_scope_reserved`(Review Focus 5). 띄운 것은 끈다. ──**

### Task 7: web — 마켓 화면의 위젯 설치·WebRTC 알림·저장소에 없는 id

**Files:**
- Modify: `web/src/market/view.ts`(`MARKET_KINDS.widget`), `web/src/MarketSettings.tsx`, `web/src/askFirst.ts`(`askInstallNotice`), `packages/core/src/messages/{en,ko}.json`(`market.widgetNotice`·`market.widgetNoticeShort`·`market.notInRepos`·`market.showAll` 더함, `market.widgetLater` 지움)
- Test: `web/src/market/view.test.ts`, `web/src/firstMouse.test.ts`(askFirst 시험 자리 — 2단계 `askUninstallPackage` 와 같은 곳)

**Interfaces:**
- Consumes: `openMarket(id?)`·`focusId`(2단계), `browseRows`.
- Produces:
  - `MARKET_KINDS: Record<PackageType, { label: string; installable: boolean; installNotice?: string; installNoticeShort?: string }>`, `widget = { label: "market.kind.widget", installable: true, installNotice: "market.widgetNotice", installNoticeShort: "market.widgetNoticeShort" }`.
  - `askInstallNotice(noticeKey: string): Promise<boolean>`(`askFirst.ts`) — `confirmDialog(t(noticeKey), t("market.install"))`.
  - `focusMissing(rows: BrowseRow[], only: string | null, loaded: boolean): boolean`(`view.ts`, 순수) — 걸러 보는 id 가 있고 목록을 받았는데 그 행이 없음.

- [ ] **Step 1: 실패하는 시험**
  - `view.test.ts`: `MARKET_KINDS.widget.installable === true`, `installNotice === "market.widgetNotice"`. `focusMissing([], "@me/x", true) === true`, 받기 전(`loaded: false`) false, 행이 있으면 false, `only: null` 이면 false. 기존의 「`MARKET_KINDS.widget.installable === false`」 단언은 이 단언으로 바꾼다.
  - askFirst: `askInstallNotice("market.widgetNotice")` 확인 → `true`, 취소 → `false`.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/market src/firstMouse` → FAIL.
- [ ] **Step 3: 구현**
  - `MarketSettings.tsx` `install(row, version?)`: **업데이트가 아니고**(`version` 없음) `MARKET_KINDS[row.type].installNotice` 가 있으면 먼저 `askInstallNotice(…)` — 거짓이면 아무것도 하지 않고 초점은 그 설치 단추에 남긴다. 업데이트 단추는 묻지 않는다. `market.widgetLater` 줄을 지운다. 이 파일에 `type === "widget"` 갈래를 만들지 않는다.
  - 「설치됨」 목록: 종류 묶음 머리 아래 그 종류의 `installNotice` 가 있으면 `market.widgetNoticeShort` 한 줄(`MARKET_KINDS[type].installNoticeShort` 로만 가른다).
  - 둘러보기: `focusMissing(...)` 이면 행 대신 `market.notInRepos`(`{id}`)·「모두 보기」(`market.showAll` → `setOnly(null)`), 초점은 저장소 주소 입력(`pendingFocus`). 저장소를 더하면(`reposKey` 바뀜) 지금처럼 다시 받는다. 그 효과는 모듈 변수 `focusId` 만 비우고 `only` 상태는 그대로 두므로(기준 커밋 코드), 그 id 가 새 저장소에 있으면 행이 나타난다 — 이 동작을 바꾸지 않는다.
  - 키보드·390px·밝은·어두운 조건은 2단계 Task 9 그대로.
- [ ] **Step 4: 통과 확인** — web 시험 전체 + `pnpm typecheck` + `pnpm --filter @keyring-notes/web build` → PASS.
- [ ] **Step 5: 커밋** — `feat(web): 마켓 화면에서 위젯 설치(WebRTC 알림 확인)·제거·업데이트, 저장소에 없는 위젯 id 안내`

### Task 8: 사용자·개발 문서와 전체 확인

**Files:**
- Modify: `docs/manual/{en,ko}/how-to/install-packages.md`(위젯 절), `docs/manual/{en,ko}/how-to/use-widgets.md`(받은 위젯·「설치」·「준비하는 중」·「앱을 업데이트해야…」·이력 보기), `docs/manual/{en,ko}/how-to/publish-packages.md`(Task 2 에 못 넣은 것 — 판 올림과 `migrate` 예, 업데이트 때 열려 있는 위젯이 바뀌는 시점), `docs/guides/development.md`(「알려진 한계」 의 「제3자 위젯은 마켓플레이스 설계에서 다룬다」 를 이번 결정으로: 설치 때 알림, 시한, `file` 지킴, 잠금의 `@keyring`)
- Test: 문서 시험이 있으면(링크 검사 등) 그것

- [ ] **Step 1: 문서** — `install-packages`: 위젯 설치(WebRTC 알림과 뜻 — 「격리되어 앱·노트에 닿지 못하지만 외부와 통신할 수 있다」), 제거하면 블록이 원문과 「설치」 로(노트는 그대로), 업데이트는 수정을 마친 뒤 바뀐다, 다른 기기는 잠금으로 같은 판, 앱 판이 맞지 않는 기기, 오프라인, 알려진 한계 셋(위 「알려진 한계」). `use-widgets`: 위젯 id 꼴(내장 `keyring/…`, 받은 것 `@scope/name`), 블록의 「설치」 단추가 마켓 화면으로 가는 것과 저장소에 없을 때. en·ko 같은 커밋.
- [ ] **Step 2: 전체 확인** — core·server·web 시험, 타입 검사, 웹 빌드(런타임 크기 상한 포함), `pnpm fmt:check`·`pnpm lint` → PASS, 시험 개수가 시작보다 늘었음.
- [ ] **Step 3: 화면 확인** — 검문 2 의 꾸밈 그대로(스크래치 사본 — **커밋된 픽스처를 고치지 않는다**), 이번에는 **마켓 화면으로**. Playwright chromium·webkit:
  - 둘러보기의 위젯 행 → 「설치」 → WebRTC 알림 → 취소하면 설치되지 않음(잠금·캐시 그대로), 확인하면 설치. 「설치됨」 위젯 묶음의 알림 한 줄.
  - 「새로 고침」 → 「새 판 있음」 → 업데이트는 알림 없이, 열려 있던 블록이 다시 그려짐. 두 번째 브라우저 문맥이 같은 판·같은 sha.
  - 제거 → 블록이 원문 + 「설치」 → 누르면 마켓 화면이 그 id 로 → 다시 설치 → 블록이 위젯으로(노트를 다시 열지 않고).
  - 저장소 목록에서 개인 저장소를 빼고 그 위젯 블록의 「설치」 → `market.notInRepos`, 초점이 주소 입력, 저장소를 다시 더하면 그 행.
  - **390px**(390×844): 오류 블록 단추·마켓 위젯 행이 가로 스크롤 없이, 밝은·어두운·받은 테마 셋.
  - **키보드만:** 블록의 「설치」 단추에 Tab 으로 닿고 Enter 로 마켓, 알림 대화상자 Esc = 취소.
  - 기기 볼트(`?local`) + 동기화 없음 → 「설치」 가 `market.unavailable` 화면으로, 이미 깐 위젯은 그대로 그려짐.
  - 데스크톱 앱은 1·2단계와 같은 이유로 실기기를 띄우지 않는다(개발 실행의 웹뷰 저장소가 격리되지 않는다, `docs/guides/development.md` 「개발 모드」) — WebKit Playwright 로 대신하고, 확인하지 못한 것은 끝 보고에.
- [ ] **Step 4: 커밋** — `docs: 위젯 패키지 설치·제거·업데이트, 블록의 「설치」, 받은 위젯 만들기(migrate·메시지·데이터 파일), 제3자 위젯 알려진 한계`

> **── 검문 3 (Task 7–8): 마켓 화면과 문서. Task 8 Step 3 전부를 리뷰어가 다시 돈다. 특히 화면 코드에 `type === "widget"` 갈래가 없는지(종류는 `MARKET_KINDS` 로만), 알림이 설치에만 뜨고 업데이트에는 뜨지 않는지, 취소한 설치가 잠금에 아무것도 남기지 않는지, 저장소에 없는 id 의 안내와 초점, 390px·키보드, 커밋된 픽스처가 Task 2 뒤로 바뀌지 않았는지(`git status`). 띄운 것은 끈다. ──**

## 설계 항목별 대응

| 설계 항목 | Task |
| --- | --- |
| 받은 위젯을 레지스트리에 iframe 위젯으로(`frame.js`·`frame.css`·`messages/<lang>.json`, `isolation` 은 늘 frame) | 3(`setMarketWidgets`·`builtIn: false`), 5(적용자·`FrameCode` text) |
| 매니페스트 `widget.stateVersion`·`display`·`dataFile`·`defaultState` | 5(`widgetEntryFromPackage`), 2(`ext: "md"` 거부) |
| 받은 위젯의 `migrate` 는 iframe 안에서, 파일은 다음 적용 때 새 판 | 3(`from`, 부모가 올리지 않음), 4(런타임·호스트·`adoptMigrated`) |
| 위젯 블록의 `widget` 은 `@scope/name@N`, 내장 `keyring/…` 와 겹치지 않음 | 1(`REF_RE`), 3(내장·받은 id 이름 공간) |
| `@keyring` 은 공식 저장소에서만 | 1(잠금), 1단계(index·`resolveInstall`) |
| 다른 저장소에 같은 id, 설치 뒤 잠금의 `repo` 고정 | 2단계 `browseRows`·`resolveInstall` 그대로, 7(「설치」 가 같은 화면) |
| 잠금이 원천 — 손으로 고친·동기화로 온 잠금도 받아 그림 | 5(`apply`·`onPackagesChange`), 6(그려진 블록 다시 판정) |
| engines 안 맞는 기기에서만 「앱을 업데이트해야 이 위젯이 보입니다」, 잠금은 바꾸지 않음 | 3(`kw.needsAppUpdate`), 5(`missingWidget`) |
| 등록되지 않은 위젯 블록의 「설치」 → 저장소에서 찾으면 설치 화면 | 3(`action`), 6(단추·이벤트), 7(`focusMissing`·`market.notInRepos`) |
| 위젯 설치 때 WebRTC 알림 | 7(`installNotice`·`askInstallNotice`) |
| 마켓 화면에서 위젯 설치·제거·업데이트 | 7 |
| 제거하면 블록은 원문과 「설치」 | 6(다시 그리기), 3(판정) |
| 상태 판이 올라가면 위젯 설계의 `migrate` 규칙 | 4, 검문 2 ② |
| 받은 위젯도 iframe 규칙(출처·자기 탐색·데이터 파일 하나만·CSP 해시) | 4(`file` 키 지킴·시한), Global Constraints, 검문 2 ⑥ |
| 패키지 CLI `pkg check` — 위젯 검사 | 2(`frame.js` 문법·크기 경고·메시지 키) |
| 오프라인에서 이미 깐 위젯이 사라지지 않음 | 5(`ready()`·캐시에서 읽음), 검문 2 ⑤, 「알려진 한계」(다른 기기가 오프라인 중 업데이트) |
| 패키지를 지우거나 저장소를 빼도 노트가 사라지지 않음 | 6(원문 유지), 8 Step 3 |
| 화면 글 en·ko, 사용자 문서 en·ko 같은 커밋 | 6·7(메시지), 2·8(문서) |
| 검증: web 시험 — 위젯 「설치」 흐름, 제거 뒤 블록 원문 | 3·5·6·7 |
| 검증: 화면 — 서버 모드·기기 볼트·오프라인, 두 기기 같은 판, 390px | 검문 2, 8 Step 3 |
