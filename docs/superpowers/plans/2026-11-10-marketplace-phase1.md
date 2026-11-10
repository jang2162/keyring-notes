# 마켓플레이스 1단계(형식과 서버 받기) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정적 저장소 형식(`index.json`·`keyring-package.json`)과 그 검사를 core 에 두고, 그것을 쓰는 패키지 CLI(`pnpm keyring pkg check|index`)를 만들고, 공통 설정에 `marketplace`(저장소 목록·잠금)를 더해 잠금 항목을 통째로 합치며, 서버가 저장소에서 패키지를 안전하게(https 만·실제 접속 주소로 사설 IP 판정·크기 상한·시간 제한·sha256) 받아 캐시해 소유자에게 같은 출처 API 로 내주고, 데스크톱 앱이 서버 없이 네이티브로 받으며, 화면이 「모드별로 누가 받는가」 표대로 잠금을 원천 삼아 기기 캐시를 맞추게 한다. 화면(마켓플레이스 설정)·언어·테마·위젯 적용은 하지 않는다 — 2·3단계가 이 위에 선다.

**Architecture:** core 의 `marketFormat.ts`(id·semver·engines·저장소 주소·패키지 파일 경로·`index.json`·매니페스트·테마 색 값 검사, Node API 없음)와 `marketLock.ts`(공통 설정의 `marketplace` 읽기·잠금 항목·설치 판정·캐시 맞추기 계획)가 형식의 단일 원본이다. 서버는 `netGuard.ts`(주소 판정·이름 풀이 고정)와 `marketFetch.ts`(나가는 요청 하나 — 리다이렉트마다 다시 판정, 스트리밍 중 크기 상한)를 거쳐 `marketCache.ts` 가 `<KEYRING_DATA>/packages/<id>/<version>/` 에 임시 폴더 → sha256 확인 → 이름 바꾸기로 둔다. 잠금이 원천이라 서버는 시작할 때와 공통 설정 파일이 커밋될 때마다 캐시를 잠금에 맞춘다. 화면 쪽은 `web/src/market/` 이 받는 쪽(`PackageSource` — 서버 API·Tauri 네이티브·없음)과 기기 캐시(`PackageCache` — IndexedDB·앱 데이터 폴더)를 표대로 고르고, 잠금이 바뀔 때마다 기기 캐시를 맞춘 뒤 종류별 적용 자리(`registerPackageKind`)에 알린다. 데스크톱 네이티브 받기는 Rust 명령 `market_fetch`(reqwest + 사설 IP 를 거르는 DNS resolver)다.

**Tech Stack:** TypeScript, core(의존성 `yaml`·`diff` 만 — semver 는 직접), Node 24 `node:http`·`node:https`(`lookup` 옵션)·`node:dns`·`node:zlib`, Hono, vitest(Node), Tauri 2 + Rust `reqwest` 0.12(`tauri-plugin-http` 가 이미 쓰는 판), IndexedDB, `@tauri-apps/plugin-fs`.

**Spec:** `docs/superpowers/specs/2026-11-10-marketplace-design.md` — 이 계획은 그 문서 「단계」 의 **1단계**와, 그것이 다루는 「저장소 형식」·「설정과 잠금」·「받기와 캐시」·「패키지 CLI」 절을 구현한다. 실행자는 둘 다 읽는다. 둘이 다르면 설계 문서가 원본이고, 다르다는 것을 보고한다. 위젯 계획들(`docs/superpowers/plans/2026-11-09-keyring-widget-phase{1,2}.md`)의 정한 것(iframe 규칙·`FrameCode` 의 `text`·제3자 메시지 표)은 그대로 이어진다.

## 확인한 것 (계획 단계, 2026-11-10 — 기준 커밋 `bc3acba`)

- **지금 서버의 나가는 요청(`server/src/convert.ts` `fetchUrl`, 웹 클립)은 DNS 재바인딩에 열려 있다:** `assertPublicHost` 가 `dns.lookup` 으로 판정한 뒤 `fetch` 가 이름을 **다시** 푼다. 첫 풀이는 공개 주소, 둘째는 `127.0.0.1` 을 주는 이름이면 판정을 지난다. 마켓 받기는 이 함수를 쓰지 않고 새 `netGuard.ts` 로 **접속에 쓰는 풀이 결과 자체**를 판정한다(아래 Task 6). 웹 클립을 옮기는 것은 이 계획 밖이다 — 압축 해제·헤더가 달라 회귀 범위가 다르다. 알려진 한계로 `docs/guides/development.md` 에 적고 코디네이터에 보고한다.
- **Node 의 `lookup` 옵션 함정:** (1) 주소가 IP 글자(`https://127.0.0.1/`, `https://[::1]/`)면 `net.connect` 는 `lookup` 을 부르지 않는다 → 접속 전에 따로 판정해야 한다. (2) Node 20 부터 `autoSelectFamily` 가 켜져 있어 `lookup(host, { all: true }, cb)` 꼴로도 불리고 그때 콜백은 `cb(null, [{ address, family }])` 를 기대한다 → 두 꼴 다 받는다. (3) `node:https` 는 `HTTPS_PROXY` 를 쓰지 않는다(프록시를 거치면 프록시가 이름을 풀어 판정이 무의미해진다 — 쓰지 않는 것이 맞다).
- **`isPrivateAddress`(convert.ts)는 빈 곳이 있다:** `::ffff:7f00:1`(16진 IPv4 사상), `64:ff9b::7f00:1`(NAT64), `2002:7f00:1::`(6to4), `fec0::/10`, `ff00::/8`(IPv6 멀티캐스트)을 공개로 본다. 새 판정은 아래 「주소 판정 표」를 쓴다(서버·Rust 같은 표).
- **데스크톱 capabilities 는 좁힐 수 없다(그리고 넓히지 않는다):** `capabilities/default.json` 의 `http:default` 는 동기화 서버 주소가 사람마다 달라 이미 `https://*`·`http://*` 전부다. 마켓 받기는 `tauri-plugin-http`(JS `fetch`)를 쓰지 않고 앱 Rust 명령 `market_fetch` 로 한다 — JS 쪽 `fetch` 로는 실제 접속 주소를 볼 수 없어 사설 IP 판정을 할 수 없기 때문이다. 앱 자체 명령은 `build.rs` 에 앱 매니페스트가 없으므로 capabilities 없이 모든 창에서 불린다(Tauri 2 기본) — 권한 파일은 바꾸지 않는다. 받은 파일은 이미 허용된 `$APPDATA/**` 에 쓴다.
- **Tauri 앱은 늘 기기 볼트다**(`web/src/local/mode.ts` `startsLocal`: `if (m.tauri) return true`). 설계 표의 「서버 모드(웹·모바일·데스크톱 앱이 서버 화면)」 중 「앱이 서버 화면」 인 경우는 지금 코드에 없다 — 서버 모드는 브라우저뿐이다. 모바일 앱(iOS·Android)도 Tauri 기기 볼트이므로 표의 「데스크톱 앱」 줄을 **Tauri 앱 전체**로 읽는다(정한 것, 아래).
- **동기화 인증 = 기기 토큰(Bearer)** — `HttpRemote(server, token, fetchFn)`, 서버 `config.deviceByToken` → `{ kind: "owner", device }`. 서버 `/api/*` CORS 는 Bearer 요청에 `access-control-allow-origin: *` 를 이미 연다. 그래서 기기 볼트 + 동기화의 서버 캐시 읽기는 새 인증 없이 같은 토큰으로 된다. 에이전트 토큰은 `kind: "agent"` 라 막는다.
- **공통 설정 파일은 에이전트가 쓸 수 없다**(`ScopedVault.level` — 규칙과 상관없이 읽기까지). 잠금을 쓰는 것이 곧 설치·제거이므로 「소유자만 설치·제거」 의 절반은 이미 서 있다. 나머지 절반(서버에 받게 하기·캐시 읽기)은 Task 8 이 소유자만으로 막는다.
- **개발 기본 경로 충돌:** `KEYRING_DATA` 가 없을 때 서버의 기본 폴더는 저장소 맨 위(`../../plugins`·`../../backups`)다. 같은 꼴로 `../../packages` 를 쓰면 **모노레포의 `packages/`(core) 폴더**가 된다 → 기본은 `../../market-cache`, `.gitignore` 에 `/market-cache/`.
- **Docker 의 CLI 는 `docker compose exec keyring keyring <명령>`** 이다(`docs/manual/*/reference.md` 「명령줄 도구」). 설계의 `docker compose exec … pnpm keyring pkg …` 는 이 꼴로 쓴다. 컨테이너 안에서 저장소 폴더를 읽으려면 그 폴더가 `/data` 아래에 있거나 마운트돼야 한다 — 사용자 문서에 적는다.
- 지금 `marketplace` 같은 「묶음 통째」 잎은 병합에 없다. `settingsMerge.ts` `leaves()` 는 빈 객체가 아닌 객체를 늘 내려간다.

### 주소 판정 표 (서버 `netGuard.ts` 와 Rust `market_fetch` 가 같은 시험 벡터를 쓴다)

막는 것(사설·특수): IPv4 `0.0.0.0/8`·`10/8`·`100.64/10`·`127/8`·`169.254/16`·`172.16/12`·`192.0.0/24`·`192.168/16`·`198.18/15`·`224/4` 이상(멀티캐스트·예약·`255.255.255.255`). IPv6 `::`·`::1`·`fc00::/7`·`fe80::/10`·`fec0::/10`·`ff00::/8`, 그리고 IPv4 를 품은 꼴은 품은 IPv4 로 다시 판정: `::ffff:a.b.c.d`·`::ffff:XXXX:XXXX`(사상), `64:ff9b::/96`(NAT64), `2002::/16`(6to4 — 둘째·셋째 16비트).

시험 벡터(공통) — 막음: `127.0.0.1`, `10.1.2.3`, `100.64.0.1`, `169.254.169.254`, `172.31.255.255`, `192.168.0.1`, `198.19.0.1`, `0.0.0.0`, `224.0.0.1`, `::1`, `::`, `fd00::1`, `fe80::1`, `fec0::1`, `ff02::1`, `::ffff:127.0.0.1`, `::ffff:7f00:1`, `64:ff9b::a00:1`, `2002:c0a8:1::1`. 통과: `1.1.1.1`, `93.184.216.34`, `172.32.0.1`, `100.128.0.1`, `2606:4700::1111`, `::ffff:1.1.1.1`, `64:ff9b::101:101`.

## 코디네이터 답과 이 계획의 판단

- **사용자 결정(설계):** 받기 안 A, 정적 저장소, 파일마다 sha256, 잠금이 모든 기기의 판을 고정, `@keyring` 은 공식 저장소에서만, `http:`·사설 IP 는 서버 운영자 환경 변수(서버)·그 기기 설정(앱)으로만, CSP `connect-src 'self'` 그대로.
- **정한 것(워커):**
  - **2·3단계가 설 자리**(아래 「2·3단계 인터페이스」)를 1단계가 만들고, 1단계는 적용자를 하나도 등록하지 않는다. 화면이 없는 1단계의 설치·제거는 함수(`installPackage`·`uninstallPackage`)까지이고, 개발 빌드(`import.meta.env.DEV`)에서만 `globalThis.keyringMarket` 으로 내보내 브라우저·데스크톱 확인에 쓴다(배포 빌드에는 없다 — 위젯 2단계의 `keyring/dday-frame` 과 같은 관례).
  - **설치 흐름은 화면이 짠다(모든 모드 같은 꼴):** ① 저장소 목록을 받아 `resolveInstall` 로 잠금 항목을 정한다 ② 받는 쪽(표)에 그 항목을 받게 하고 기기 캐시에 둔다 ③ `updateVaultSetting(["marketplace", "packages", id], entry)` 로 잠금을 쓴다. 잠금을 쓰기 전에 받으므로 받지 못한 패키지는 잠금에 들어가지 않는다. 제거는 잠금에서 빼기만 하고, 캐시는 맞추기가 지운다. 서버에는 「설치」 API 가 따로 없다 — 잠금 쓰기가 설치다(소유자만 쓸 수 있다).
  - **저장소 안 경로:** id `@<scope>/<name>` 의 파일은 `<repo>/packages/<scope>/<name>/<version>/<path>`(`@` 없이 — 설계의 `<scope>` 는 id 에서 `@` 를 뺀 이름). 서버·기기 캐시는 id 그대로 `packages/@<scope>/<name>/<version>/`(node_modules 꼴).
  - **저장소 주소 정규형:** `new URL` 로 읽히고, `https:`(허용 시 `http:`), 사용자·비밀번호·`?`·`#` 없음, 끝 `/` 하나. 같은지는 정규형 글자로 본다. 공식 저장소 = 정규형이 `OFFICIAL_REPO_URL` 과 같은 것.
  - **`repos` 가 없을 때만** 공식 하나로 시작한다. `repos: []`(사람이 공식을 지움)는 빈 목록 그대로.
  - **잠금 항목 병합:** `["marketplace", "packages", <id>]` 를 잎 하나로 본다. 둘 다 있고 다르면 `compareSemver` 가 높은 쪽(같은 판이면 서버 쪽 — 지금 규칙), **한쪽이 지우고 다른 쪽이 바꿨으면 바꾼 쪽**(노트 동기화의 「고친 쪽을 살린다」), 한쪽만 바뀌면 바뀐 쪽. 이 키들은 `settingsConflicts` 에 넣지 않는다(정해진 규칙으로 풀렸고, 「이 기기에서만 다르게」 대상이 아니다). `marketplace.repos` 는 목록이라 지금처럼 잎 하나이고 지금 규칙(서버 값 + 알림)을 따른다.
  - **크기·시간 상한(설계가 구현자 몫으로 둔 값):** 파일 하나 **8 MiB**, 패키지 하나(모든 파일 합) **16 MiB**, `index.json` **2 MiB**, 요청 하나(접속부터 본문 끝까지) **30초**(`index.json` 15초), 리다이렉트 **5번**. 받는 바이트가 `min(상한, index 의 size)` 를 넘으면 그 자리에서 끊는다(잠금으로만 받을 때는 size 가 없어 상한만). 서버 `index.json` 캐시 **5분**, 실패는 **30초** 동안 다시 묻지 않는다.
  - **서버 캐시 정리:** 잠금에 없는 캐시는 **마지막으로 받은 지 24시간이 지났을 때만** 지운다 — 기기 볼트 + 동기화 기기가 서버에 받게 한 뒤 잠금이 동기화로 오기 전에 정리가 돌아 지우는 일을 막는다. 공통 설정을 읽지 못하면(YAML 깨짐) 정리하지 않는다.
  - **기기 캐시 정리:** 잠금을 읽은 뒤에만, 잠금에 없는 것을 바로 지운다. 오프라인이어도 정리는 캐시만 보므로 이미 깐 것은 지워지지 않는다(잠금에 있는 한).
  - **서버 환경 변수:** `KEYRING_MARKET_ALLOW_HTTP=1`·`KEYRING_MARKET_ALLOW_PRIVATE=1`(웹 클립의 `KEYRING_FETCH_ALLOW_PRIVATE` 와 따로 — 한쪽을 켜려다 다른 쪽이 열리지 않게), `KEYRING_PACKAGES_DIR`(기본 `<KEYRING_DATA>/packages`, 없으면 `../../market-cache`).
  - **앱(Tauri)의 기기 설정:** `localStorage` `keyring:market:device` = `{ allowHttp?: boolean; allowPrivate?: boolean }`(동기화되지 않음). 1단계는 값만 읽고, 고치는 화면은 2단계 마켓 화면.
  - **서버가 실패했을 때 앱이 네이티브로 대신 받는 오류:** 저장소에 닿지 못함·사설 IP 거부·`http:` 거부·시간 초과·리다이렉트 초과·서버에 닿지 못함·401. **대신 받지 않는 오류:** sha256·크기 불일치, 매니페스트 잘못, 패키지 없음, `@keyring` 범위 위반 — 파일 자체의 문제라 다른 길로 받아도 같다.
  - **서버가 내주는 패키지 파일은 실행할 수 없는 꼴로만:** `content-type: application/octet-stream`, `x-content-type-options: nosniff`(이미 전역), `content-security-policy: default-src 'none'; sandbox`, `content-disposition: attachment`. 앱 페이지 CSP 가 `script-src 'self'` 라, 같은 출처에서 JS 타입으로 내면 HTML 주입 하나로 제3자 `frame.js` 가 앱 권한으로 돈다 — 화면은 바이트로만 받아 iframe 에 글로 건넨다.
  - **매니페스트 공통 필드의 모양:** `name`·`description` 은 둘 다 언어 태그 → 글자(`{ "en": "…", "ko": "…" }`, 하나 이상), `author`·`license` 는 글자, `engines.keyring` 은 범위 글. 위젯 `dataFile` 은 `{ ext: string, initial: string, name?: Record<lang, string> }`(`initial` 은 비지 않은 UTF-8 글 — 서버가 빈 첨부를 거절하므로, 3단계가 바이트로 바꾼다).
  - **테마 토큰 이름:** 정확한 목록은 2단계에서 `styles.css` 를 보고 정한다(설계). 1단계 검사는 이름 꼴(`^--[a-z][a-z0-9-]*$`)과 크기·글꼴·간격 꼴(`--fs-*`·`--font-*`·`--radius-*`·`--*-h`·`--*-w`) 거부, 값의 엄격한 색 꼴만 보고, 알려진 목록을 인자로 받으면(2단계) 모르는 토큰을 경고로 센다.
  - **semver:** `MAJOR.MINOR.PATCH(-prerelease)?`(`+build` 없음 — 경로에 들어간다), 각 수는 앞 0 없는 정수. 범위: `*`, 판 그대로(= 같음), `=`·`>`·`>=`·`<`·`<=`·`^`·`~` 붙은 판, 빈칸으로 이은 것(그리고), `||`(또는). 프리릴리스는 semver 순서로 비교만 한다(npm 의 「같은 튜플만」 규칙은 두지 않는다 — 문서에 적는다).
- **구현자 몫:** 오류 문구(키는 아래 정한 것), 서버 내부 큐 모양, IndexedDB 의 저장소 이름, Rust 쪽 오류를 글자 코드로 넘기는 세부, `index.json` 받는 동안의 로그. **공식 저장소 주소 `OFFICIAL_REPO_URL` 의 값**(설계: 구현자 몫·설정 상수 하나) — 운영 주소가 정해지지 않았으면 `https://market.keyring-notes.invalid/` 로 두고 끝 보고에 「출시 전 운영 주소 필요」 를 적는다(`.invalid` 는 이름 풀이가 늘 실패해 엉뚱한 곳으로 가지 않는다).

## 2·3단계 인터페이스 (1단계가 만들고 2·3단계가 그대로 쓴다)

- **설치된 패키지를 화면이 읽는 길**(`web/src/market/state.ts`, Task 11): `installedPackages(): InstalledPackage[]`, `readPackageFile(id, path): Promise<Uint8Array>`(기기 캐시에서, 잠금의 sha256 으로 다시 확인), `readPackageText(id, path): Promise<string>`, `onPackagesChange(fn): () => void`.
- **종류별 적용 자리:** `registerPackageKind(type, { apply(pkgs: InstalledPackage[]): void | Promise<void> })` — 그 종류의 `status: "ready"` 인 패키지 전부(잠금 순서)를 바뀔 때마다 넘긴다. 빠진 것은 다음 `apply` 에 없는 것으로 알린다(지우기 = 다시 그리기). 2단계: `language` 는 `checkPack` 을 지난 `messages.json` 을 i18n 에 별도 층으로, `theme` 는 `colors` 를 테마 목록에. 3단계: `widget` 은 레지스트리에 `builtIn: false` iframe 항목(`frame()` → `{ kind: "text", js: frame.js, css?: frame.css }`, `messages` → `messages/<lang>.json` 표, `version` → `widget.stateVersion`).
- **설치·제거·둘러보기:** `repoIndexes(): Promise<RepoIndexResult[]>`, `installPackage(id, opts?)`, `uninstallPackage(id)`, `marketAvailability()`(`"ok" | "unavailable"` — 브라우저 기기 볼트에 동기화가 없을 때 `unavailable`, 2단계 화면이 `market.unavailable` 을 보인다), core `latestVersion(index, id, appVersion)`(「새 판 있음」).
- **3단계가 넓힐 것(1단계는 손대지 않는다):** `parseWidgetRef` 의 `REF_RE` 는 지금 `scope/name@N` 만 받는다 → 3단계가 `@scope/name@N` 을 더한다. 1단계의 `PACKAGE_ID_RE` 는 그때 그대로 쓰일 수 있게 `^@([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$` 로 둔다(위젯 ref 의 조각 꼴과 같다).
- **앱 판:** 화면은 core `APP_VERSION`(`packages/core/src/i18n.ts`), 서버는 `server/src/version.ts` `APP_VERSION`. `engines` 가 맞지 않는 잠금 항목은 받아 두되 `status: "incompatible"` — 적용자에게 넘기지 않는다(2·3단계가 「앱을 업데이트해야 이 위젯이 보입니다」·기본 테마·기본 언어).

## Global Constraints

- 웹 화면 CSP 는 그대로다(`connect-src 'self'`). 서버 `APP_CSP`·`tauri.conf.json` `security.csp` 를 바꾸지 않는다.
- 서버·앱에서 저장소로 나가는 요청: `https:` 만(`http:` 는 서버 환경 변수 `KEYRING_MARKET_ALLOW_HTTP=1`, 앱은 그 기기 설정으로만), 사설·특수 주소 거부(위 표 — 서버 `KEYRING_MARKET_ALLOW_PRIVATE=1`, 앱은 그 기기 설정으로만), **판정은 접속에 쓰는 이름 풀이 결과로**, 리다이렉트마다 다시, 사용자·비밀번호가 든 주소 거부, 쿠키·인증 헤더를 보내지 않음, 프록시 쓰지 않음. 볼트의 공통 설정에는 이 스위치를 두지 않는다.
- 상한: 파일 8 MiB·패키지 16 MiB·`index.json` 2 MiB·요청 30초(`index.json` 15초)·리다이렉트 5번. 크기는 받는 동안 센다(`content-length` 만 믿지 않는다).
- sha256 이 잠금(또는 설치 때 `index.json`)과 다르면 그 판을 쓰지 않는다: 임시 자리에 받은 것을 버리고, 이미 있는 캐시를 덮지 않고, 오류(`market_hash_mismatch`)로 남긴다.
- 캐시 경로는 검사를 지난 id·판·파일 이름으로만 만든다(`..`·절대 경로·백슬래시가 들어갈 수 없는 꼴). 그 위에서도 `resolveInVault` 와 같은 「루트 밖이면 거부」 를 한 번 더 한다.
- 범위 `@keyring` 은 공식 저장소의 `index.json` 에서만 받는다. 다른 저장소의 `@keyring/…` 는 버리고 `ignored` 로 센다. 잠금 항목의 `repo` 가 공식이 아닌데 id 가 `@keyring/…` 면 받지 않는다(`market_scope_reserved`).
- 마켓 API 는 소유자만(쿠키 로그인 또는 기기 토큰). 에이전트 토큰은 403 `market_owner_only`.
- 서버가 내주는 패키지 파일은 `application/octet-stream` + `content-security-policy: default-src 'none'; sandbox` + `content-disposition: attachment`.
- core 는 Node 전용 API 를 쓰지 않는다(sha256 은 `hash.ts`). 새 npm 의존성 없음. Rust 는 `reqwest = { version = "0.12", default-features = false, features = [<tauri-plugin-http 가 켠 TLS 기능과 같게>, "stream"] }` 하나.
- 화면·서버 글은 `packages/core/src/messages/{en,ko}.json`, 키는 `error.market_*`·`market.*`·`cli.pkg_*`, 알파벳 자리에 손으로, en·ko 같은 키(`packages/core/test/i18n.test.ts`). 사용자 문서는 `docs/manual/{en,ko}/` 같은 커밋. 서버 API 를 바꾸면 `reference.md` 와 `/llms.txt`(`server/src/llmsTxt.ts`, `docs/guideline/web/00-llms-txt.md`).
- 오류 코드(이 이름으로): `market_url_invalid`·`market_url_protocol`·`market_url_credentials`·`market_private_address`·`market_fetch_failed{reason}`·`market_timeout`·`market_too_large`·`market_too_many_redirects`·`market_hash_mismatch{path}`·`market_size_mismatch{path}`·`market_index_invalid{reason}`·`market_manifest_invalid{reason}`·`market_not_found{id}`·`market_scope_reserved{id}`·`market_engines{range,version}`·`market_lock_invalid{id}`·`market_owner_only`·`market_unavailable`.
- 시험은 Node(vitest, DOM 없음). 명령: core `cd packages/core && pnpm exec vitest run`, server `pnpm --filter @keyring-notes/server test`, web `cd web && pnpm exec vitest run`, Rust `cd app/src-tauri && cargo test`. 시작 전에 패키지별 지금 개수를 적어 두고 끝에 늘었는지 본다. 루트 `pnpm test` 는 첫 실패 패키지에서 멈춘다.
- 커밋 메시지는 한국어(`feat(core): …`·`feat(server): …`·`feat(web): …`·`feat(app): …`·`docs: …`), 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 파일은 경로로 stage. `docs/ops/ux.md` 는 고치지 않는다.

## Review Focus

1. **이름 풀이가 공개 주소였다가 사설 주소로 바뀌는 저장소(DNS 재바인딩), IP 글자 주소, IPv4 를 품은 IPv6, 공개 주소에서 `http://127.0.0.1/` 로 가는 리다이렉트** — 어느 것도 사설 주소에 TCP 접속을 열지 않고 `market_private_address`·`market_url_protocol` 로 끝난다. (Task 6: 고정 풀이·IP 글자·리다이렉트 시험과 표 벡터, Task 9: Rust 같은 벡터)
2. **두 기기가 같은 패키지를 동시에 다른 판으로 올림(또는 한쪽은 지우고 한쪽은 올림)** — 합친 잠금 항목은 어느 한쪽의 항목 **통째**이고 `version` 과 `sha256` 이 섞이지 않는다. (Task 3: 병합 시험, `SyncEngine` 끝까지)
3. **사람이 공통 설정을 손으로 고쳐 잠금 항목에 `version: ../../x`·`"@a/../b"`·`sha256: { "../../config/keyring.json": … }`·64자가 아닌 해시를 넣음** — 그 항목은 `market_lock_invalid` 로 보이고 아무 파일도 받거나 쓰거나 지우지 않으며, 나머지 항목은 그대로 돈다. (Task 3: 읽기 시험, Task 7: 캐시 경로 시험)
4. **설치한 뒤 오프라인(서버 꺼짐·비행기 모드)에서 앱을 다시 엶** — 기기 캐시의 패키지가 `ready` 로 남고, 맞추기는 받지 못한 것만 `error` 로 두며 캐시를 지우지 않는다. 공통 설정을 읽지 못하면 정리하지 않는다. (Task 11 시험, Task 12 확인)
5. **서버 캐시의 `frame.js` 를 같은 출처 주소로 `<script src>` 에 넣으려는 HTML 주입** — 응답이 `application/octet-stream` + `nosniff` 라 브라우저가 실행하지 않는다. (Task 8: 응답 헤더 시험, Task 12 확인)

---

### Task 1: core — id·semver·engines·저장소 주소·패키지 파일 경로

**Files:**
- Create: `packages/core/src/marketFormat.ts`
- Modify: `packages/core/src/index.ts`(export)
- Test: `packages/core/test/marketFormat.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PACKAGE_ID_RE: RegExp; // ^@([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$
  export const OFFICIAL_REPO_URL: string; // 정규형(끝 /)
  export const MARKET_LIMITS: { fileBytes: 8388608; packageBytes: 16777216; indexBytes: 2097152; requestMs: 30000; indexMs: 15000; redirects: 5 };
  export type PackageType = "widget" | "theme" | "language";
  export interface SemVer { major: number; minor: number; patch: number; pre: (string | number)[] }
  export function parseSemver(v: string): SemVer | null;
  export function compareSemver(a: string, b: string): number;      // 잘못된 판은 올바른 판보다 낮다, 둘 다 잘못이면 0
  export function satisfies(version: string, range: string): boolean; // 범위가 잘못이면 false
  export function validRange(range: string): boolean;
  export function parsePackageId(id: string): { scope: string; name: string } | null;
  export function normalizeRepoUrl(url: string, opts?: { allowHttp?: boolean }): string; // 아니면 PathError(market_url_invalid | market_url_protocol | market_url_credentials)
  export function isOfficialRepo(url: string): boolean;
  /** format 1 의 파일 이름(종류별) — 이 꼴만 경로에 들어간다 */
  export function packageFileAllowed(type: PackageType, path: string): boolean;
  export function packageFileUrl(repo: string, id: string, version: string, path: string): string; // <repo>/packages/<scope>/<name>/<version>/<path>
  export function packageCacheDir(id: string, version: string): string[]; // ["@scope", "name", "1.2.0"] — 검사 실패면 PathError(market_lock_invalid)
  ```
- [ ] **Step 1: 실패하는 시험** — `marketFormat.test.ts`:
  - semver: `parseSemver("1.2.0")` 값, `"01.2.0"`·`"1.2"`·`"1.2.0+b"`·`"1.2.0-"`·`"v1.2.0"`·`"../1.0.0"` → null. `compareSemver("1.2.0-alpha", "1.2.0") < 0`, `"1.2.0-alpha.2" < "1.2.0-alpha.10"`, `"1.10.0" > "1.9.9"`.
  - `satisfies`: `("0.13.0", ">=0.13.0")` true, `("0.12.9", ">=0.13.0")` false, `("1.4.2", "^1.2.0")` true, `("2.0.0", "^1.2.0")` false, `("0.2.5", "^0.2.0")` true, `("0.3.0", "^0.2.0")` false, `("1.2.9", "~1.2.0")` true, `("1.3.0", "~1.2.0")` false, `("1.0.0", ">=0.9.0 <1.0.0 || 1.0.0")` true, `("5.0.0", "*")` true, 잘못된 범위 `">= banana"` false·`validRange` false.
  - `parsePackageId("@keyring/pomodoro")` → `{ scope: "keyring", name: "pomodoro" }`. `"keyring/pomodoro"`·`"@Keyring/x"`·`"@a/b/c"`·`"@a/.."`·`"@-a/b"`·`"@a/"` → null.
  - `normalizeRepoUrl("https://me.github.io/w")` → `"https://me.github.io/w/"`. `"http://x/"` → `market_url_protocol`, `{ allowHttp: true }` 이면 통과. `"https://u:p@x/"` → `market_url_credentials`. `"https://x/?a=1"`·`"https://x/#a"`·`"ftp://x/"`·`"not a url"` → 오류.
  - `packageFileAllowed("widget", "frame.js")`·`"frame.css"`·`"messages/ko.json"`·`"messages/pt-BR.json"`·`"keyring-package.json"` true. `"../frame.js"`·`"messages/../x.json"`·`"img.png"`·`"Frame.js"`·`"messages.json"`(위젯) false. `("language", "messages.json")` true, `("theme", "frame.js")` false.
  - `packageFileUrl("https://r.example/m/", "@a/b", "1.0.0", "frame.js")` → `"https://r.example/m/packages/a/b/1.0.0/frame.js"`. `packageCacheDir("@a/b", "1.0.0")` → `["@a", "b", "1.0.0"]`, `("@a/b", "../1")` → 던짐.
- [ ] **Step 2: 실패 확인** — `cd packages/core && pnpm exec vitest run test/marketFormat.test.ts` → FAIL.
- [ ] **Step 3: 구현** — semver 는 직접(의존성 없음). 파일 허용 꼴: 모든 종류 `keyring-package.json`, widget `frame.js`·`frame.css`·`messages/<태그>.json`(태그는 `checkPack` 의 id 꼴 `^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$`), language `messages.json`, theme 없음.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS, `pnpm typecheck`.
- [ ] **Step 5: 커밋** — `git add packages/core/src/marketFormat.ts packages/core/src/index.ts packages/core/test/marketFormat.test.ts` → `feat(core): 마켓 형식 — 패키지 id·semver·engines·저장소 주소·파일 경로`

### Task 2: core — `index.json`·매니페스트·패키지 파일 검사(테마 색 값 포함)

**Files:**
- Modify: `packages/core/src/marketFormat.ts`
- Test: `packages/core/test/marketFormat.test.ts`(이어서), `packages/core/test/marketManifest.test.ts`

**Interfaces:**
- Consumes: Task 1, `checkPack`(`i18n.ts`), `sha256Hex`(`hash.ts`).
- Produces:
  ```ts
  export interface IndexFile { path: string; sha256: string; size: number }
  export interface IndexVersion { engines: { keyring: string }; files: IndexFile[] }
  export interface RepoIndex { format: 1; name: string; packages: Record<string, { type: PackageType; versions: Record<string, IndexVersion> }> }
  /** 잘못된 패키지·판은 빼고 ignored 에 「id[@판]: 이유」. 공식이 아니면 @keyring/… 를 뺀다. 맨 모양이 틀리면 PathError(market_index_invalid) */
  export function parseRepoIndex(raw: unknown, opts: { official: boolean }): { index: RepoIndex; ignored: string[] };
  export function latestVersion(index: RepoIndex, id: string, appVersion: string): string | null; // engines 가 맞는 가장 높은 판
  export interface PackageManifest { id: string; version: string; type: PackageType; name: Record<string, string>; description: Record<string, string>; author: string; license: string; engines: { keyring: string };
    widget?: { stateVersion: number; display: "block" | "inline"; dataFile?: { ext: string; initial: string; name?: Record<string, string> }; defaultState: unknown };
    colors?: { light?: Record<string, string>; dark?: Record<string, string> } }
  export function parseManifest(raw: unknown): PackageManifest; // 아니면 PathError(market_manifest_invalid, { reason })
  export function isThemeColor(value: string): boolean;
  export function checkThemeColors(colors: PackageManifest["colors"], known?: readonly string[]): { errors: string[]; unknownTokens: string[] };
  /** 파일 묶음 전체 검사(CLI check·서버·앱이 받은 뒤 같이 씀): 매니페스트, 필수 파일, 허용 꼴, 종류별 내용 */
  export function checkPackageFiles(files: Map<string, Uint8Array>, expect?: { id: string; version: string; type: PackageType }): { manifest: PackageManifest; warnings: string[] }; // 아니면 PathError
  ```
- [ ] **Step 1: 실패하는 시험** —
  - `parseRepoIndex`: 설계의 예 `index.json` → 그대로. `official: false` 이면 `@keyring/pomodoro` 가 빠지고 `ignored` 에 들어간다. 판 `"1.2"`·잘못된 `engines` 범위·`sha256` 이 64자 소문자 16진이 아님·`size` 음수·허용되지 않은 `path`(`../x`)·같은 path 두 번·`keyring-package.json` 이 files 에 없음 → 그 판만 빠진다. `format: 2`·배열·`packages` 없음 → `market_index_invalid`.
  - `latestVersion`: 판 `1.0.0`(>=0.1.0)·`1.3.0`(>=0.13.0)·`2.0.0-beta`(>=0.1.0) 에서 앱 `0.12.0` → `"1.0.0"`(프리릴리스는 「가장 높은 판」 으로 고르지 않는다 — 판을 지정하면 설치는 된다). 앱 `0.13.0` → `"1.3.0"`.
  - `isThemeColor`: `#abc`·`#a1b2c3`·`#a1b2c3d4`·`rgb(1 2 3)`·`rgb(1, 2, 3)`·`rgb(1 2 3 / 50%)`·`hsl(120 50% 40%)`·`oklch(0.7 0.1 200)`·`oklch(70% 0.1 200 / 0.5)` true. `red`·`#abcd5`·`url(x)`·`var(--x)`·`rgb(1 2 3);x`·`#fff}`·`rgb(calc(1) 2 3)`·`expression(1)`·`rgb(1 2 3) !important` false.
  - `checkThemeColors({ light: { "--bg": "#fff", "--fs-body": "#000", "bg": "#fff", "--fg": "url(a)" } })` → errors 셋(크기 꼴 토큰·이름 꼴·값). `known: ["--bg"]` 와 `{ dark: { "--bg": "#000", "--zz": "#111" } }` → `unknownTokens: ["--zz"]`, errors 없음.
  - `checkPackageFiles`: 위젯(매니페스트 + `frame.js`) 통과. `frame.js` 없음·`img.png` 가 끼어 있음·매니페스트 `id` 가 `expect.id` 와 다름·`widget.stateVersion: 0`·`display: "x"`·`dataFile.initial: ""`·`isolation` 이 `frame` 이 아님 → `market_manifest_invalid`. 언어: `messages.json` 이 `checkPack` 오류(`bad_id`) → 오류, 보고서의 `missing` 은 warnings. 테마: `colors` 없음 → 오류, `light` 만 있음 → 통과.
- [ ] **Step 2: 실패 확인** — `cd packages/core && pnpm exec vitest run test/marketFormat.test.ts test/marketManifest.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 색 값은 정규식 꼴 하나씩(`#` 3·6·8자리, `rgb|rgba|hsl|hsla|oklch|oklab` + 괄호 안은 숫자·`%`·`deg`·`.`·빈칸·`,`·`/` 만, 괄호 하나). 금지 글자(`;`·`}`·`{`·`url(`·`var(`·`\`·`!`)가 있으면 꼴 검사 전에 거부. `widget.isolation` 은 없거나 `"frame"`.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS, core 전체, `pnpm typecheck`.
- [ ] **Step 5: 커밋** — `git add packages/core/src/marketFormat.ts packages/core/test/marketFormat.test.ts packages/core/test/marketManifest.test.ts` → `feat(core): 마켓 형식 — index.json·매니페스트·파일 묶음·테마 색 값 검사`

### Task 3: core — 공통 설정의 `marketplace` 와 잠금 항목 통째 병합

**Files:**
- Create: `packages/core/src/marketLock.ts`
- Modify: `packages/core/src/settings.ts`(`VaultSettings.marketplace`, `parseVaultSettings`, 머리 주석 「묶음」 에 `marketplace`), `packages/core/src/settingsMerge.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/marketLock.test.ts`, `packages/core/test/settingsMerge.test.ts`, `packages/core/test/sync.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  export interface LockEntry { version: string; repo: string; sha256: Record<string, string> } // sha256 의 키 = 받을 파일 전부
  export interface MarketplaceSettings { repos: string[]; packages: Record<string, LockEntry>; problems: { id: string; code: "market_lock_invalid" }[] }
  export function parseMarketplace(raw: unknown): MarketplaceSettings; // repos 가 없으면 [OFFICIAL_REPO_URL]. 잘못된 저장소 주소는 빼고, 잘못된 항목은 problems
  // settings.ts: VaultSettings 에 marketplace: MarketplaceSettings 를 더한다(DEFAULT 는 repos [OFFICIAL_REPO_URL], packages {})
  export function lockEntryValue(e: LockEntry): Record<string, unknown>; // 설정 파일에 쓸 꼴(키 순서 version·repo·sha256, sha256 키 정렬)
  // settingsMerge.ts
  export function isAtomicSettingsKey(key: string[]): boolean; // ["marketplace","packages",<id>]
  ```
- [ ] **Step 1: 실패하는 시험** —
  - `marketLock.test.ts`: 설계의 YAML 예를 `parseVaultSettings` → `marketplace.repos` 둘(정규형), `packages["@keyring/pomodoro"]` 항목. `marketplace` 없음 → `repos: [OFFICIAL_REPO_URL]`. `repos: []` → 빈 목록. 항목 `version: ../../x`·id `"@a/../b"`·`sha256: { "../../config/keyring.json": "<64자>" }`·해시가 63자·`repo` 가 `ftp://`·`sha256` 에 `keyring-package.json` 없음 → 그 항목만 `packages` 에서 빠지고 `problems` 에 `{ id, code: "market_lock_invalid" }`. `repo` 의 `http:` 는 읽을 때 받는다(허용은 받는 쪽이 판정 — 잠금은 기록이다).
  - `setVaultSetting(content, ["marketplace", "packages", "@keyring/pomodoro"], lockEntryValue(e))` 로 쓴 글을 다시 읽으면 같은 항목(YAML 이 `@` 로 시작하는 키를 따옴표로 쓴다).
  - `settingsMerge.test.ts`: 기준 B 에 항목 `1.2.0`, 기기 L `1.3.0`(sha 다름), 서버 S `1.2.1`(sha 다름) → 합친 값은 L 의 항목 통째(`version` 1.3.0 과 그 sha256), `conflicts` 비어 있음. L 이 지우고 S 가 `1.2.1` 로 → S 항목. L 이 `1.3.0` 으로, S 가 지움 → L 항목. 같은 판 다른 `repo` → S 항목. 한쪽만 바뀜 → 그쪽. 같은 파일의 `ui.theme` 충돌은 지금처럼 `conflicts` 에 남는다. 기준이 없을 때(처음 연결) 양쪽에 다른 판 → 높은 판.
  - `sync.test.ts`: 두 `LocalVault`(기기 둘)과 가짜 서버로 같은 패키지를 동시에 올린 뒤 둘 다 동기화 → 세 곳의 공통 설정에서 그 항목이 같고, `version` 과 `sha256` 이 같은 항목에서 왔다.
- [ ] **Step 2: 실패 확인** — `cd packages/core && pnpm exec vitest run test/marketLock.test.ts test/settingsMerge.test.ts test/sync.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `leaves()` 가 `isAtomicSettingsKey(key)` 에서 내려가지 않고 잎으로 둔다. `mergeSettingsObjects` 의 「둘 다 바뀜」 갈래에서 원자 키면 위 규칙으로 고르고 `conflicts` 에 넣지 않는다(`compareSemver(l.version, s.version) > 0` 이면 L).
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS, core 전체, `pnpm typecheck`. web 의 `vaultSettings.ts` 기본값이 새 필드로 typecheck 되는지 `cd web && pnpm typecheck`(빈 기본값 `{ ...DEFAULT_VAULT_SETTINGS, … }` 자리에 `marketplace` 를 더한다).
- [ ] **Step 5: 커밋** — `git add packages/core/src/marketLock.ts packages/core/src/settings.ts packages/core/src/settingsMerge.ts packages/core/src/index.ts packages/core/test/marketLock.test.ts packages/core/test/settingsMerge.test.ts packages/core/test/sync.test.ts web/src/vaultSettings.ts` → `feat(core): 공통 설정 marketplace(저장소·잠금)와 잠금 항목 통째 병합`

### Task 4: core — 설치 판정과 캐시 맞추기 계획

**Files:**
- Modify: `packages/core/src/marketLock.ts`
- Test: `packages/core/test/marketLock.test.ts`(이어서)

**Interfaces:**
- Consumes: Task 1–3.
- Produces:
  ```ts
  export interface RepoIndexResult { repo: string; index: RepoIndex | null; ignored: string[]; error?: { code: string; params: Record<string, string | number> } }
  /** 저장소 순서가 우선순위. 이미 잠금에 있으면 그 repo 에서만(opts.repo 로 바꿀 수 없다 — 바꾸려면 먼저 제거). 판을 안 주면 latestVersion */
  export function resolveInstall(indexes: RepoIndexResult[], lock: Record<string, LockEntry>, id: string, appVersion: string, opts?: { version?: string; repo?: string }):
    | { ok: true; entry: LockEntry; sizes: Record<string, number>; type: PackageType; alsoIn: string[] }
    | { ok: false; code: "market_not_found" | "market_scope_reserved" | "market_engines"; params: Record<string, string> };
  export interface CachedVersion { id: string; version: string; sha256: Record<string, string> }
  /** 잠금 ↔ 캐시: 받을 것(없거나 sha 가 다름), 지울 것(잠금에 없는 id·판) */
  export function planCache(lock: Record<string, LockEntry>, cached: CachedVersion[]): { fetch: { id: string; entry: LockEntry }[]; remove: { id: string; version: string }[] };
  export function enginesOk(manifest: PackageManifest, appVersion: string): boolean;
  ```
- [ ] **Step 1: 실패하는 시험** — 공식 + 개인 저장소 index 둘(개인에도 `@me/clock`·공식에도 `@me/clock`): `resolveInstall(…, "@me/clock")` → 공식 쪽(목록 위), `alsoIn: [개인]`. 잠금에 개인 저장소로 이미 있으면 → 개인 쪽(우선순위가 바뀌어도). `@keyring/pomodoro` 를 `opts.repo: 개인` 으로 → `market_scope_reserved`. 판 지정이 engines 에 맞지 않음 → `market_engines { range, version }`. 없는 id·없는 판 → `market_not_found`. 결과 `entry.sha256` 은 index 의 files 그대로, `sizes` 도. `planCache`: 잠금 `@a/b@1.0.0`, 캐시 `@a/b@0.9.0`·`@c/d@1.0.0` → fetch `@a/b`, remove 둘. 같은 판인데 sha 하나 다름 → fetch. 같으면 아무것도 없음.
- [ ] **Step 2: 실패 확인** — `cd packages/core && pnpm exec vitest run test/marketLock.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `resolveInstall` 은 `isOfficialRepo` 로 `@keyring` 을 막고(index 가 이미 걸렀어도 잠금의 repo 로 한 번 더), engines 는 index 판의 `engines.keyring`.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS, core 전체.
- [ ] **Step 5: 커밋** — `git add packages/core/src/marketLock.ts packages/core/test/marketLock.test.ts` → `feat(core): 마켓 설치 판정(우선순위·잠금 고정·@keyring·engines)과 캐시 맞추기 계획`

### Task 5: 패키지 CLI(`pnpm keyring pkg check|index`)와 형식 문서

**Files:**
- Create: `server/src/pkgCli.ts`, `docs/manual/en/how-to/publish-packages.md`, `docs/manual/ko/how-to/publish-packages.md`
- Modify: `server/src/cli.ts`(`pkg` 갈래), `packages/core/src/messages/{en,ko}.json`(`cli.usage` 에 `pkg`, `cli.pkg_*`), `docs/manual/{en,ko}/reference.md`(「명령줄 도구」)
- Test: `server/test/pkgCli.test.ts`

**Interfaces:**
- Consumes: Task 2 `checkPackageFiles`·`parseRepoIndex`, `sha256Hex`.
- Produces:
  ```ts
  export async function checkPackageDir(dir: string): Promise<{ manifest: PackageManifest; warnings: string[] }>; // 폴더 안 파일 전부(숨김 포함 — 허용 꼴이 아니면 오류)
  export async function buildRepoIndex(repoDir: string, opts?: { name?: string }): Promise<{ index: RepoIndex; written: boolean }>; // packages/<scope>/<name>/<version>/ 를 훑어 index.json 을 쓴다
  ```
- [ ] **Step 1: 실패하는 시험** — 임시 폴더에 위젯 패키지 둘(같은 id 두 판)과 테마 하나:
  - `checkPackageDir` 통과, `frame.js` 를 지우면 `market_manifest_invalid`, `.DS_Store` 가 있으면 오류 이유에 그 이름.
  - `buildRepoIndex` → `index.json` 의 각 파일 sha256·size 가 실제와 같고, `type`·`engines` 는 매니페스트에서. 폴더 경로(`packages/a/b/1.0.0`)와 매니페스트 `id`·`version` 이 다르면 오류(어느 폴더인지). **두 번 돌리면 `written: false` 이고 파일 바이트가 같다**(멱등 — 키 정렬, 2칸 들여쓰기, 끝 줄바꿈). 기존 `index.json` 의 `name` 을 지키고, 없으면 `opts.name`, 그것도 없으면 폴더 이름. 결과를 `parseRepoIndex(…, { official: true })` 가 `ignored` 없이 읽는다.
  - `cli.ts` 를 자식 프로세스로(`tsx --conditions=keyring-source src/cli.ts pkg check <폴더>`) → 종료 코드 0·경고 줄, 잘못된 폴더 → 1.
- [ ] **Step 2: 실패 확인** — `pnpm --filter @keyring-notes/server exec vitest run test/pkgCli.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `cli.ts` 의 `if (cmd !== "agent")` 앞에 `pkg` 를 넣는다(`pkg check <dir>`·`pkg index <dir> [--name <이름>]`). 사용자 문서 `publish-packages.md`: 저장소 구조, `index.json`·`keyring-package.json` 전 필드(위 타입 그대로)·파일 허용 꼴·sha256·크기 상한·semver 와 범위 문법(프리릴리스 비교 규칙)·`@keyring` 예약·CLI 두 명령(소스 체크아웃 `pnpm keyring pkg …`, Docker `docker compose exec keyring keyring pkg …` — 폴더가 `/data` 아래나 마운트에 있어야 함)·CLI 없이 손으로 만드는 법·위젯 `frame.js` 최소 예(`keyringWidgetRegister` 와 위젯 런타임 API — `web/src/widgets/frame/runtime.ts` 의 실제 이름을 보고 쓴다)·GitHub Pages 에 올리는 예. 3단계 전까지 위젯·테마·언어를 화면에서 쓸 수 없다는 줄을 맨 위에 둔다.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS, server 전체, core `i18n.test.ts`, `pnpm typecheck`.
- [ ] **Step 5: 커밋** — `git add server/src/pkgCli.ts server/src/cli.ts server/test/pkgCli.test.ts packages/core/src/messages/en.json packages/core/src/messages/ko.json docs/manual/en/how-to/publish-packages.md docs/manual/ko/how-to/publish-packages.md docs/manual/en/reference.md docs/manual/ko/reference.md` → `feat(server): 패키지 CLI(pkg check·index)와 저장소 형식 문서`

> **── 검문 1 (Task 1–5): 형식·검사·잠금·병합·CLI. 네트워크 없음 — 시험과 코드 리뷰로 본다. 특히 테마 색 값의 주입 거부(Task 2), 잠금 항목 통째 병합과 잘못된 잠금 항목(Task 3, Review Focus 2·3), `index` 의 멱등(Task 5). 실제 저장소 폴더 하나를 CLI 로 만들어 다음 검문의 시험 자료로 둔다(`server/test/fixtures/market/` — Task 6 이 커밋). ──**

### Task 6: server — 나가는 요청 지킴(`netGuard`·`marketFetch`)

**Files:**
- Create: `server/src/netGuard.ts`, `server/src/marketFetch.ts`
- Test: `server/test/netGuard.test.ts`, `server/test/marketFetch.test.ts`, `server/test/fixtures/market/`(Task 5 CLI 로 만든 작은 저장소)

**Interfaces:**
- Produces:
  ```ts
  // netGuard.ts
  export function isPrivateAddress(ip: string): boolean; // 위 「주소 판정 표」
  export type LookupFn = (host: string) => Promise<{ address: string; family: 4 | 6 }[]>;
  /** http.request 의 lookup 옵션 — 풀이 결과 중 하나라도 사설이면(허용이 아니면) 오류. { all } 두 꼴 다 */
  export function guardedLookup(opts: { allowPrivate: boolean; resolve?: LookupFn }): NonNullable<import("node:http").RequestOptions["lookup"]>;
  // marketFetch.ts
  export interface MarketFetchOptions { allowHttp: boolean; allowPrivate: boolean; maxBytes: number; timeoutMs: number; expectSize?: number; resolve?: LookupFn }
  export async function marketFetch(url: string, opts: MarketFetchOptions): Promise<Uint8Array>; // 실패는 PathError(Global Constraints 의 market_* 코드)
  /** 첫 주소와 리다이렉트 주소마다 같은 판정: 프로토콜·사용자 정보·IP 글자 사설 주소 */
  export function checkUrl(url: URL, opts: { allowHttp: boolean; allowPrivate: boolean }): void;
  ```
- [ ] **Step 1: 실패하는 시험** —
  - `netGuard.test.ts`: 표의 벡터 전부(막음·통과). `guardedLookup` 이 `all: false`·`all: true` 두 꼴로 불릴 때 콜백 모양이 맞고, `resolve` 가 `[{1.1.1.1}, {10.0.0.1}]` 를 주면 오류.
  - `marketFetch.test.ts`(로컬 `http.createServer` 를 `127.0.0.1` 임의 포트에, 접속 수를 센다):
    - `allowHttp: false` 로 `http://…` → `market_url_protocol`, 접속 0.
    - `allowHttp: true, allowPrivate: false`, `resolve` 가 `repo.test → 127.0.0.1` → `market_private_address`, **접속 0**(재바인딩: 판정한 그 풀이가 접속에 쓰인다 — 두 번째 풀이가 없다는 것을 `resolve` 호출 수 1 로 단언).
    - `allowPrivate: true`, `resolve` 가 `repo.test → 127.0.0.1` → 시험 서버에 닿아 바이트를 받는다(이름이 실제 DNS 에 없으므로 우리 풀이가 접속에 쓰였다는 증거), 요청의 `host` 헤더는 `repo.test:<포트>`.
    - IP 글자 `http://127.0.0.1:<포트>/x` 를 `allowPrivate: false` → `market_private_address`, 접속 0.
    - 리다이렉트: 302 → `http://127.0.0.1:<포트>/b` 를 공개로 풀리는 이름에서 시작(`resolve` 로 첫 이름만 공개) → `market_private_address`. 302 여섯 번 → `market_too_many_redirects`. `location` 에 사용자 정보 → `market_url_credentials`. https 시험 서버는 두지 않는다(인증서) — `https:` → `http:` 낮추기는 `checkUrl(new URL("http://x/"), { allowHttp: false, allowPrivate: false })` 가 `market_url_protocol` 인 것과, 리다이렉트마다 `checkUrl` 을 부른다는 것(가짜로 바꾼 `checkUrl` 호출 수 = 단계 수)으로 고정한다. 실제 https 는 검문 2 에서 본다.
    - 크기: `content-length` 없이 `maxBytes + 1` 바이트를 흘림 → `market_too_large`, 서버 쪽 소켓이 끝까지 쓰기 전에 닫힌다. `expectSize: 10` 인데 11바이트 → `market_size_mismatch`. `content-length` 가 상한보다 크면 본문을 읽지 않고 오류.
    - 시간: 헤더 뒤 멈춤 → `timeoutMs` 뒤 `market_timeout`(가짜 시계 대신 `timeoutMs: 200`).
    - 압축: `content-encoding: gzip` 응답 → 풀린 바이트, 풀린 크기로 상한을 센다(압축 폭탄 — 1KB gzip 이 상한을 넘게 풀림 → `market_too_large`).
    - 보내는 헤더에 `cookie`·`authorization` 이 없고 `accept-encoding: identity` 가 있다.
- [ ] **Step 2: 실패 확인** — `pnpm --filter @keyring-notes/server exec vitest run test/netGuard.test.ts test/marketFetch.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `node:http`·`node:https` 의 `request(url, { lookup, signal: AbortSignal.timeout(timeoutMs), headers, agent: false })`. 호스트가 IP 글자면(`net.isIP`) 접속 전에 `isPrivateAddress`. 접속 뒤 `socket.remoteAddress` 를 한 번 더 판정해 사설이면 끊는다(지킴 둘째 줄). 리다이렉트는 손으로(`location` 을 `new URL(loc, url)`, 매번 프로토콜·사용자 정보·주소 다시). 본문은 `data` 마다 세다 넘으면 `req.destroy()`. 압축은 `zlib.createGunzip`·`createInflate`·`createBrotliDecompress` 뒤에서 센다. `isPrivateAddress` 를 `convert.ts` 에서 옮기지 않는다(웹 클립은 이 계획 밖 — 위 「확인한 것」).
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS, server 전체.
- [ ] **Step 5: 커밋** — `git add server/src/netGuard.ts server/src/marketFetch.ts server/test/netGuard.test.ts server/test/marketFetch.test.ts server/test/fixtures/market` → `feat(server): 마켓 받기 — 접속 주소로 사설 IP 판정·리다이렉트마다 다시·스트리밍 크기 상한·시간 제한`

### Task 7: server — 패키지 캐시(`marketCache`)와 잠금 맞추기

**Files:**
- Create: `server/src/marketCache.ts`
- Modify: `server/src/index.ts`(만들기, `vault.onChange` 에 공통 설정 경로가 있으면 `reconcile`, 시작할 때 한 번), `.gitignore`(`/market-cache/`)
- Test: `server/test/marketCache.test.ts`

**Interfaces:**
- Consumes: Task 1–4(`packageCacheDir`·`packageFileUrl`·`planCache`·`checkPackageFiles`·`parseRepoIndex`·`isOfficialRepo`), Task 6 `marketFetch`.
- Produces:
  ```ts
  export interface MarketCacheOptions { root: string; allowHttp: boolean; allowPrivate: boolean; fetch?: typeof marketFetch; now?: () => number; graceMs?: number /* 24h */; indexTtlMs?: number /* 5분 */ }
  export class MarketCache {
    constructor(opts: MarketCacheOptions);
    /** 잠금 항목 하나를 캐시에 둔다(이미 같은 sha 면 바로). 같은 id@판은 한 번만 돈다. sizes 가 있으면 expectSize */
    ensure(id: string, entry: LockEntry, sizes?: Record<string, number>): Promise<void>;
    /** 잠금의 sha 와 캐시 메타가 같을 때만 바이트. 아니면 NotFoundError */
    read(id: string, version: string, path: string, sha256: string): Promise<Uint8Array>;
    index(repo: string): Promise<RepoIndexResult>;
    reconcile(settings: MarketplaceSettings | null): Promise<void>; // null(읽지 못함) → 받기만 하고 정리하지 않는다
    status(): Record<string, { state: "ready" | "fetching" | "error"; version: string; error?: { code: string; params: Record<string, string | number> } }>;
  }
  /** 시작 때 한 번, 그리고 공통 설정 파일이 든 커밋마다 reconcile. index.ts 와 시험 도우미(server/test/helpers.ts)가 같이 부른다 */
  export function attachMarketReconcile(vault: Vault, cache: MarketCache): Promise<void>;
  ```
  캐시 모양: `<root>/@scope/name/<version>/<파일들>` + 같은 폴더의 `.keyring-cache.json`(`{ repo, sha256, at }` — 확인을 마친 뒤에만 쓴다).
- [ ] **Step 1: 실패하는 시험** — 가짜 `fetch`(Task 6 픽스처 저장소의 바이트를 돌려주는 함수)로:
  - `ensure` → 파일·메타가 생기고 `read(…, 맞는 sha)` 가 바이트. **파일 하나의 sha 가 다르면** `market_hash_mismatch { path }`, 그 판 폴더가 생기지 않고 임시 폴더(`<root>/.tmp-*`)도 남지 않는다. 이미 다른 sha 의 캐시가 있을 때 불일치 → **기존 캐시가 그대로**다.
  - 받은 파일 묶음이 `checkPackageFiles(…, { id, version, type })` 에 걸리면(`id` 다름) → `market_manifest_invalid`, 캐시 없음.
  - 잠금 항목의 `repo` 가 공식이 아닌데 id 가 `@keyring/x` → `market_scope_reserved`, `fetch` 0번.
  - 같은 `ensure` 두 번 동시 → `fetch` 는 파일마다 1번.
  - 경로 탈출: `read("@a/b", "1.0.0", "../../config/keyring.json", sha)`·`read("@a/..", …)`·`read(…, "../1", …)` → 던짐(`market_lock_invalid` 또는 NotFound), `root` 밖 파일을 열지 않는다(`root` 옆에 미끼 파일을 두고 확인). `root` 안 판 폴더를 밖을 가리키는 심볼릭 링크로 바꿔도 읽지 않는다.
  - `reconcile`: 잠금에 있고 없는 것은 받고, 잠금에 없는 판은 `now - at > graceMs` 일 때만 지운다(23시간 → 남음, 25시간 → 지움). `reconcile(null)` 은 지우지 않는다. 실패한 항목은 `status()` 에 `error` 로, 다음 `reconcile` 에서 다시 시도.
  - `index(repo)`: 5분 안에 두 번 → `fetch` 1번. 실패 뒤 30초 안에는 다시 묻지 않고 같은 오류. 개인 저장소 index 의 `@keyring/…` 는 `ignored`.
- [ ] **Step 2: 실패 확인** — `pnpm --filter @keyring-notes/server exec vitest run test/marketCache.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 받기는 `<root>/.tmp-<무작위>/` 에 파일을 다 쓰고 sha·크기·`checkPackageFiles` 를 지난 뒤 메타를 쓰고 `rename` 으로 판 폴더에 놓는다(있던 판 폴더는 그 뒤에 지운다 — 이름 바꾸기 전에 지우지 않는다). 모든 경로는 `packageCacheDir` 조각과 `packageFileAllowed` 를 지난 이름으로만 잇고, 이은 뒤 `resolveInVault(root, rel)`·`realpath` 가 `root` 아래인지 본다. 시작 때 남은 `.tmp-*` 는 지운다. `index.ts` 는 `KEYRING_PACKAGES_DIR ?? (dataDir ? join(dataDir, "packages") : join(here, "../../market-cache"))` 로 만들고 `attachMarketReconcile(vault, cache)`(안에서 `vault.onChange(paths => paths.includes(VAULT_SETTINGS_PATH) && …)` 와 시작 때 한 번 — 맞추기는 기다리지 않고 뒤에서, 커밋 큐를 막지 않는다). 공통 설정을 읽는 것은 `vault.sharedSettings()` 가 아니라 파일을 직접 읽어 `settingsObject` 가 null(깨짐)인지 가른다.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS, server 전체, `pnpm typecheck`.
- [ ] **Step 5: 커밋** — `git add server/src/marketCache.ts server/src/index.ts server/test/marketCache.test.ts .gitignore` → `feat(server): 마켓 캐시 — sha256 확인 뒤 놓기·경로 탈출 막기·잠금 맞추기·정리 유예`

### Task 8: server — 마켓 API(소유자만)·환경 변수·문서

**Files:**
- Modify: `server/src/app.ts`(`AppOptions.market?: MarketCache`, 라우트), `server/src/index.ts`(환경 변수), `server/test/helpers.ts`(가짜 `fetch` 의 `MarketCache` 를 넣는 선택 인자 + `attachMarketReconcile`), `server/src/llmsTxt.ts`, `packages/core/src/messages/{en,ko}.json`(`error.market_*`), `docs/manual/{en,ko}/reference.md`(REST API·공통 설정 파일 `marketplace`·저장 구조), `docs/manual/{en,ko}/configuration.md`(환경 변수 셋)
- Test: `server/test/market.test.ts`, `server/test/llmstxt.test.ts`

**Interfaces:**
- Consumes: Task 7 `MarketCache`.
- Produces(모두 `/api` 아래, 소유자 — 쿠키 또는 기기 토큰 — 만, 에이전트는 403 `market_owner_only`):
  - `GET /api/market/index?repo=<url>` → `RepoIndexResult`(저장소 주소는 정규형으로 읽은 것만, `official` 은 서버가 판정).
  - `POST /api/market/ensure` `{ id, entry: LockEntry, sizes?: Record<string, number> }` → `{ ok: true }` 또는 오류 응답(`code` = Global Constraints 의 코드). 잠금은 바꾸지 않는다.
  - `GET /api/market/file?id=&version=&path=&sha256=` → 바이트(헤더는 Global Constraints). 캐시에 없거나 sha 가 다르면 404 `market_not_found`.
  - `GET /api/market/status` → `MarketCache.status()`.
  - 화면 쪽 클라이언트는 Task 10 이 만든다(이 Task 는 서버만).
- [ ] **Step 1: 실패하는 시험** — `market.test.ts`(기존 `helpers.ts` 로 앱을 띄우고 가짜 `fetch` 를 넣은 `MarketCache`):
  - 로그인 없이 네 경로 → 401. 에이전트 토큰(쓰기 규칙이 `/` 전체라도) → 403 `market_owner_only`. 기기 토큰(`/api/auth/device` 로 받은 것) → 200, 응답에 `access-control-allow-origin: *`(다른 출처의 기기 볼트 화면이 읽을 수 있다). 쿠키 로그인 → 200.
  - `ensure` 뒤 `file` → 바이트가 픽스처와 같고 `content-type: application/octet-stream`, `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; sandbox`, `content-disposition: attachment`. `sha256` 이 다른 값 → 404. `path=../../config/keyring.json` → 400/404, 설정 파일 바이트가 응답에 없다.
  - `ensure` 에 sha 가 틀린 항목 → 400 `market_hash_mismatch`(`params.path`), 이어서 `status` 에 그 id 가 `error`.
  - `POST` 에 `content-type: application/json` 이 아니면 415(지금 CSRF 규칙 그대로).
  - 소유자가 `/api/file` 로 공통 설정에 잠금 항목을 쓰면(설치 = 잠금 쓰기) 서버 `reconcile` 이 돌아 `file` 이 200 이 된다(가짜 `fetch` 가 불렸다). 에이전트가 같은 쓰기 → 403(지금 규칙 — 회귀 단언).
  - `llmstxt.test.ts`: 본문에 `/api/market/` 과 「소유자만」 이 있다.
- [ ] **Step 2: 실패 확인** — `pnpm --filter @keyring-notes/server exec vitest run test/market.test.ts test/llmstxt.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 라우트는 인증 미들웨어 뒤에, `c.var.scoped.principal.kind !== "owner"` 면 `ForbiddenError("market_owner_only")`(동기화 manifest 와 같은 꼴). `market` 이 없으면(시험의 다른 앱) 404. `index.ts`: `allowHttp = env("KEYRING_MARKET_ALLOW_HTTP") === "1"`, `allowPrivate = env("KEYRING_MARKET_ALLOW_PRIVATE") === "1"`. 문서: reference 「REST API」 에 네 경로와 인증·오류, 「공통 설정 파일」 에 `marketplace`(저장소 순서 = 우선순위, 잠금 = 원천, 손으로 고쳐도 받는다, 잘못된 항목은 오류로 보인다), 「저장 구조」 에 `packages/`. configuration 표에 세 변수(사설 IP·`http:` 를 켤 때의 위험 — 볼트를 고칠 수 있는 사람이 서버를 내부망으로 보낼 수 있다).
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS, server 전체, core `i18n.test.ts`, `pnpm typecheck`.
- [ ] **Step 5: 커밋** — `git add server/src/app.ts server/src/index.ts server/src/llmsTxt.ts server/test/helpers.ts server/test/market.test.ts server/test/llmstxt.test.ts packages/core/src/messages/en.json packages/core/src/messages/ko.json docs/manual/en/reference.md docs/manual/ko/reference.md docs/manual/en/configuration.md docs/manual/ko/configuration.md` → `feat(server): 마켓 API(소유자만 — 목록·받게 하기·파일·상태)와 운영자 환경 변수`

> **── 검문 2 (Task 6–8): 서버 받기 전부. 시험에 더해 개발 서버를 띄워 실제 https 저장소(GitHub Pages 등 공개 정적 호스팅에 검문 1 의 픽스처를 올린 것, 또는 이미 있는 아무 공개 https 정적 파일)로 `ensure`·`file` 을 curl 로 보고, `KEYRING_MARKET_ALLOW_PRIVATE` 없이 `https://127.0.0.1/`·사설로 풀리는 이름(예: `localtest.me`)이 거부되는 것을 본다. Review Focus 1·3·5 를 특히 본다. 띄운 것은 끈다. ──**

### Task 9: app — 네이티브 받기 명령 `market_fetch`

**Files:**
- Create: `app/src-tauri/src/market.rs`
- Modify: `app/src-tauri/src/lib.rs`(`mod market;`), `app/src-tauri/src/close_guard.rs:375`(데스크톱의 `generate_handler![…]` 목록에 `crate::market::market_fetch` 를 더한다 — **Tauri 는 `invoke_handler` 를 하나만 받아 나중 것이 앞의 것을 덮는다**. 모바일(`#[cfg(mobile)]`)에는 `close_guard` 가 없으므로 `lib.rs` 에서 `market_fetch` 만 든 `invoke_handler` 를 따로 건다), `app/src-tauri/Cargo.toml`(`reqwest`), `app/src-tauri/capabilities/default.json`(바꾸지 않는다 — 설명 글에 「마켓 받기는 앱 명령(market_fetch), http 권한은 동기화용」 만 더한다)
- Test: `app/src-tauri/src/market.rs` 안 `#[cfg(test)]`

**Interfaces:**
- Produces:
  ```rust
  #[tauri::command]
  pub async fn market_fetch(url: String, max_bytes: u64, expect_size: Option<u64>, allow_http: bool, allow_private: bool) -> Result<tauri::ipc::Response, String>; // Ok = 바이트(JS 에 ArrayBuffer), Err = "market_…" 코드(Global Constraints 와 같은 이름)
  pub fn is_private_ip(ip: std::net::IpAddr) -> bool; // 「주소 판정 표」
  ```
  JS 쪽: `invoke<ArrayBuffer>("market_fetch", { url, maxBytes, expectSize, allowHttp, allowPrivate })`(Task 10 이 감싼다).
- [ ] **Step 1: 실패하는 시험** — `is_private_ip` 에 표의 벡터 전부(Node 시험과 같은 목록을 그대로 옮긴다). URL 판정 함수(`check_url(&Url, allow_http) -> Result<(), &'static str>`)에 `http:`·사용자 정보·IP 글자 사설 주소. 로컬 `std::net::TcpListener` 로 띄운 HTTP 응답기(사설 주소이므로 `allow_private: true, allow_http: true`)로: 정상 바이트, `max_bytes` 넘김 → `market_too_large`, 302 여섯 번 → `market_too_many_redirects`, `allow_private: false` → `market_private_address` 이고 응답기에 접속이 오지 않음.
- [ ] **Step 2: 실패 확인** — `cd app/src-tauri && cargo test market` → 컴파일 실패(없는 함수).
- [ ] **Step 3: 구현** — `reqwest::Client::builder().no_proxy().redirect(Policy::none()).timeout(30s).connect_timeout(10s).dns_resolver(Arc::new(GuardResolver { allow_private }))`. `GuardResolver` 는 `tokio::net::lookup_host((name, 0))` 결과 중 하나라도 사설이면(허용 아님) 오류 — reqwest 는 이 결과로만 접속한다. IP 글자 호스트는 resolver 를 타지 않으므로 `check_url` 이 먼저 본다. 리다이렉트는 손으로 5번(매번 `check_url`). 본문은 `resp.chunk()` 로 세다 넘으면 끊는다. `accept-encoding: identity`(reqwest 의 압축 기능을 켜지 않는다 — 켜지 않으면 풀지 않으므로 서버가 압축해 보내면 sha 불일치로 끝난다; 문서에 정적 호스팅은 identity 를 따른다고 적는다). `tauri-plugin-http` 가 켠 reqwest TLS 기능을 `cargo tree -e features -i reqwest` 로 보고 같게 켠다(바이너리에 TLS 가 둘 들어가지 않게).
- [ ] **Step 4: 통과 확인** — `cd app/src-tauri && cargo test market && cargo build` → PASS. (`pnpm app:dev` 확인은 검문 3)
- [ ] **Step 5: 커밋** — `git add app/src-tauri/src/market.rs app/src-tauri/src/lib.rs app/src-tauri/src/close_guard.rs app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock app/src-tauri/capabilities/default.json` → `feat(app): 마켓 네이티브 받기 — 사설 IP 를 거르는 DNS resolver·https 만·크기·시간·리다이렉트`

### Task 10: web — 받는 쪽(표대로)과 기기 캐시

**Files:**
- Create: `web/src/market/source.ts`, `web/src/market/cache.ts`, `web/src/market/client.ts`(서버 마켓 API 클라이언트)
- Test: `web/src/market/source.test.ts`, `web/src/market/cache.test.ts`

**Interfaces:**
- Consumes: Task 4 `LockEntry`·`RepoIndexResult`, Task 8 API, Task 9 `market_fetch`, `SyncController.get().settings`(`{ server, token }`), `appMode.local`, `localContext.kind`.
- Produces:
  ```ts
  // source.ts
  export type MarketMode = "server" | "app" | "app+sync" | "browser+sync" | "browser";
  export function marketMode(env: { local: boolean; kind: "app" | "browser" | null; sync: boolean }): MarketMode; // 설계 표의 다섯 줄
  export interface PackageSource {
    index(repo: string): Promise<RepoIndexResult>;
    /** 잠금 항목의 파일을 다 받아 sha256·크기 확인을 마친 묶음. 실패는 KeyedError(market_* 코드) */
    fetch(id: string, entry: LockEntry, sizes?: Record<string, number>): Promise<Map<string, Uint8Array>>;
  }
  export function serverSource(base: string, fetchFn: typeof fetch, token?: string): PackageSource; // ensure → file(sha256) 들. base "" = 같은 출처 쿠키
  export function nativeSource(device: { allowHttp: boolean; allowPrivate: boolean }, invokeFn?: (cmd: string, args: unknown) => Promise<ArrayBuffer>): PackageSource; // index·파일 모두 market_fetch, sha 확인은 화면에서
  export function fallbackSource(primary: PackageSource, secondary: PackageSource): PackageSource; // 「정한 것」 의 대신 받는 오류일 때만 secondary
  export function pickSource(mode: MarketMode, deps: { server?: { base: string; fetchFn: typeof fetch; token?: string }; device: { allowHttp: boolean; allowPrivate: boolean } }): PackageSource | null; // browser → null
  export function readDeviceMarketSettings(): { allowHttp: boolean; allowPrivate: boolean }; // localStorage keyring:market:device, 읽지 못하면 둘 다 false
  // cache.ts
  export interface PackageCache {
    list(): Promise<CachedVersion[]>;
    get(id: string, version: string, path: string): Promise<Uint8Array | null>;
    put(id: string, version: string, entry: LockEntry, files: Map<string, Uint8Array>): Promise<void>; // 한 판을 통째로(다 쓴 뒤 메타)
    remove(id: string, version: string): Promise<void>;
  }
  export function idbPackageCache(name?: string): PackageCache;   // 브라우저(서버 모드·기기 볼트 둘 다) — 볼트 IndexedDB 와 다른 DB
  export function tauriPackageCache(): PackageCache;              // $APPDATA/packages/@scope/name/<version>/ + .keyring-cache.json
  export function memoryPackageCache(): PackageCache;             // 시험용
  ```
- [ ] **Step 1: 실패하는 시험** —
  - `marketMode`: `{ local: false }` → `server`; `{ local: true, kind: "app", sync: false }` → `app`; `sync: true` → `app+sync`; `kind: "browser", sync: true` → `browser+sync`; `sync: false` → `browser`. `pickSource("browser", …)` → null, `"app+sync"` → fallback(server, native).
  - `serverSource`(가짜 `fetchFn`): `ensure` 를 `POST` + JSON + `authorization: Bearer <token>` 으로 부르고(토큰이 있을 때만), 파일마다 `file?…&sha256=` 를 받아 **화면에서 sha256 을 다시 잰다** — 다르면 `market_hash_mismatch`. 서버 오류 응답 `{ code, params }` 는 같은 코드의 `KeyedError`.
  - `fallbackSource`: primary 가 `market_private_address`·`market_fetch_failed`·`TypeError`(서버에 닿지 못함)·401 → secondary 를 부른다. `market_hash_mismatch`·`market_manifest_invalid`·`market_not_found`·`market_scope_reserved` → 부르지 않고 그 오류.
  - `nativeSource`(가짜 `invokeFn`): `packageFileUrl` 로 파일 주소를 만들고 `maxBytes: MARKET_LIMITS.fileBytes`, `expectSize` 를 넘긴다. 받은 묶음을 `checkPackageFiles` 로 본다(서버가 하는 확인을 앱이 같이). 공식이 아닌 repo 의 `@keyring/x` → `market_scope_reserved`, invoke 0번.
  - `memoryPackageCache`(같은 계약 시험을 세 구현이 공유하는 함수로 — IDB·Tauri 는 Node 에서 돌지 않으니 계약 시험은 memory 로, 둘은 검문 3 에서 화면으로): `put` 뒤 `list`·`get`, `remove` 뒤 없음, 같은 판 `put` 두 번은 덮어씀.
  - `readDeviceMarketSettings`: 값 없음·깨진 JSON·`localStorage` 가 던짐 → 둘 다 false.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/market` → FAIL.
- [ ] **Step 3: 구현** — `tauriPackageCache` 는 `@tauri-apps/api/path` `appDataDir()` 아래 `packages/` + `packageCacheDir` 조각(이미 허용된 `$APPDATA/**`). `idbPackageCache` 는 키 `${id}@${version}` 에 `{ entry, files: Record<path, Uint8Array> }` 한 덩어리(판 하나를 원자적으로). `fetchFn` 은 기기 볼트에서 `startLocal` 이 만든 것(앱은 `tauri-plugin-http`, 브라우저는 `fetch`).
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS, web 전체, `cd web && pnpm typecheck`.
- [ ] **Step 5: 커밋** — `git add web/src/market/source.ts web/src/market/cache.ts web/src/market/client.ts web/src/market/source.test.ts web/src/market/cache.test.ts` → `feat(web): 마켓 받는 쪽(모드별 표 — 서버 캐시·네이티브·대신 받기)과 기기 캐시`

### Task 11: web — 잠금이 원천인 기기 상태와 2·3단계 적용 자리

**Files:**
- Create: `web/src/market/state.ts`
- Modify: `web/src/main.tsx`(또는 앱 시작 자리 — `startLocal`·서버 로그인 뒤 `startMarket()` 한 번), `packages/core/src/messages/{en,ko}.json`(`market.unavailable`·`market.status.*`)
- Test: `web/src/market/state.test.ts`

**Interfaces:**
- Consumes: Task 3 `parseMarketplace`(공통 설정의 `marketplace`), Task 4 `planCache`·`resolveInstall`·`enginesOk`, Task 10, `onVaultSettings`·`getVaultSettings`·`updateVaultSetting`(`web/src/vaultSettings.ts`), core `APP_VERSION`.
- Produces(위 「2·3단계 인터페이스」 그대로):
  ```ts
  export interface InstalledPackage { id: string; type: PackageType; version: string; repo: string; manifest: PackageManifest | null; status: "ready" | "fetching" | "error" | "incompatible"; error?: { code: string; params: Record<string, string | number> } }
  export function createMarketState(deps: { source: PackageSource | null; cache: PackageCache; settings: () => MarketplaceSettings | null; onSettings(fn: () => void): () => void; writeLock(id: string, entry: LockEntry | null): Promise<void>; appVersion: string }): MarketState;
  export interface MarketState {
    installedPackages(): InstalledPackage[];
    readPackageFile(id: string, path: string): Promise<Uint8Array>;
    readPackageText(id: string, path: string): Promise<string>;
    onPackagesChange(fn: () => void): () => void;
    registerPackageKind(type: PackageType, applier: { apply(pkgs: InstalledPackage[]): void | Promise<void> }): () => void;
    repoIndexes(): Promise<RepoIndexResult[]>;
    installPackage(id: string, opts?: { version?: string; repo?: string }): Promise<InstalledPackage>;
    uninstallPackage(id: string): Promise<void>;
    marketAvailability(): "ok" | "unavailable";
    reconcile(): Promise<void>;
  }
  export function startMarket(): MarketState; // 지금 모드로 deps 를 골라 하나 만든다. 개발 빌드면 globalThis.keyringMarket
  export function market(): MarketState;      // startMarket 이 만든 것
  ```
- [ ] **Step 1: 실패하는 시험** — 가짜 source·memory 캐시·가짜 설정으로:
  - 잠금에 항목 둘, 캐시에 없음 → `reconcile` 이 둘 다 받아 `ready`, `apply` 가 그 종류 패키지로 한 번씩 불린다. 다시 `reconcile` → source 0번.
  - **설정 화면을 거치지 않은 잠금 변경**(동기화로 온 새 판): `onSettings` 를 쏘면 새 판을 받고 옛 판을 캐시에서 지우며 `apply` 가 새 판으로.
  - 잠금에서 빠짐 → 캐시에서 지우고 `apply([])`.
  - **오프라인**: source 가 `TypeError` → 캐시에 있는 것은 `ready`, 없는 것은 `error`(`market_fetch_failed`), 캐시를 지우지 않는다. `settings()` 가 null(읽지 못함) → 아무것도 지우지 않는다.
  - source 가 null(브라우저 기기 볼트, 동기화 없음) → `marketAvailability()` `"unavailable"`, 캐시에 있는 것은 `ready`, 없는 것은 `error`(`market_unavailable`), `installPackage` 는 `market_unavailable` 로 던짐.
  - engines 가 맞지 않는 잠금 항목 → 받아 두고 `incompatible`, `apply` 에 넘기지 않는다. 잠금은 바꾸지 않는다(`writeLock` 0번).
  - `problems` 의 잘못된 항목 → `error`(`market_lock_invalid`), 받기·지우기 없음.
  - `installPackage("@me/clock")` → source.fetch → 캐시 put → `writeLock(id, entry)` 순서(받지 못하면 `writeLock` 0번). `uninstallPackage` → `writeLock(id, null)` 뒤 캐시에서 지움. 고른 테마·언어를 기본으로 돌리는 것은 2단계 적용자 몫(`apply` 에서 빠짐으로 알린다).
  - `readPackageFile`: 캐시 바이트의 sha 가 잠금과 다르면(캐시가 상함) 던지고 그 판을 다시 받게 표시. `ready` 가 아니면 던짐.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/market/state.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 맞추기는 한 번에 하나(돌고 있으면 끝난 뒤 한 번 더). `startMarket` 의 deps: 서버 모드 `serverSource("", fetch)` + `idbPackageCache()`, 앱 `tauriPackageCache()`, 기기 볼트 + 동기화는 `SyncController` 의 `server`·`token` 과 `startLocal` 의 `fetchFn`. 동기화 연결·해제(`SyncController` 상태 바뀜)에서 source 를 다시 고른다. `writeLock` = `updateVaultSetting(["marketplace", "packages", id], entry ? lockEntryValue(entry) : null)`.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS, web 전체, core `i18n.test.ts`, `cd web && pnpm typecheck`, `cd web && pnpm build`(배포 묶음에 `keyringMarket` 이 없다: `grep -r keyringMarket web/dist` 빈 결과).
- [ ] **Step 5: 커밋** — `git add web/src/market/state.ts web/src/market/state.test.ts web/src/main.tsx packages/core/src/messages/en.json packages/core/src/messages/ko.json` → `feat(web): 잠금이 원천인 마켓 기기 상태 — 맞추기·오프라인·적용 자리·설치·제거`

### Task 12: 개발 문서와 전체 확인

**Files:**
- Modify: `docs/guides/development.md`(새 절 「마켓 받기와 나가는 요청」), `docs/manual/{en,ko}/how-to/publish-packages.md`(확인에서 고칠 것만)

- [ ] **Step 1: 개발 문서** — 「마켓 받기와 나가는 요청」: 이름 풀이를 접속에 고정하는 이유와 Node `lookup` 함정 셋(위 「확인한 것」), 주소 판정 표와 서버·Rust 가 같은 벡터를 쓴다는 것, 패키지 파일을 `octet-stream` 으로만 내는 이유, 캐시를 임시 폴더 → 이름 바꾸기로 두는 것, 정리 유예 24시간의 이유, 2·3단계 적용 자리(`registerPackageKind`), **알려진 한계**: 웹 클립(`convert.ts` `fetchUrl`)은 아직 재바인딩에 열려 있다, 정적 호스팅이 압축을 강제하면 앱 네이티브 받기는 sha 불일치로 끝난다, 공식 저장소 주소는 운영 결정 전까지 자리 값이다.
- [ ] **Step 2: 전체 시험** — core·server·web·`cargo test`·`pnpm typecheck`·`pnpm lint`·`pnpm fmt:check`. 개수가 시작 때보다 늘었는지 적는다.
- [ ] **Step 3: 화면 확인(개발 빌드의 `globalThis.keyringMarket`)** — 검문 1 픽스처를 공개 https 정적 호스팅에 올린 개인 저장소로:
  - 서버 모드(웹, 390px 포함 — 화면은 없지만 콘솔·오류 알림이 깨지지 않는지): `repos` 에 개인 저장소를 손으로 넣고 `installPackage` → 공통 설정에 잠금 항목, 서버 `packages/` 에 판 폴더, 브라우저 IndexedDB 에 같은 판. 개발자 도구로 `<script src="/api/market/file?…frame.js">` 를 넣어 실행되지 않는 것(콘솔의 MIME 거부)을 본다(Review Focus 5).
  - 두 기기에서 같은 판: 서버 모드 브라우저와 `?local` + 동기화 브라우저 — 한쪽에서 설치, 다른 쪽은 동기화 뒤 맞추기로 같은 sha 를 받는다.
  - 데스크톱 앱 기기 볼트(동기화 없음, `pnpm app:dev`): `installPackage` → `$APPDATA/packages/…`, 오프라인(네트워크 끔)으로 다시 열어 `ready`(Review Focus 4). 동기화를 붙이고 서버를 `KEYRING_MARKET_ALLOW_PRIVATE` 없이 두고 사설 주소 저장소를 잠금에 넣으면 서버는 거부, 앱 기기 설정 `allowPrivate` 를 켜면 네이티브로 대신 받는다.
  - 서버 로그·앱 콘솔에 받기 오류가 오류 코드로 보인다. 띄운 것은 모두 끄고 끝 보고에 「띄운 것/끈 것」 을 적는다.
- [ ] **Step 4: 커밋** — `git add docs/guides/development.md docs/manual/en/how-to/publish-packages.md docs/manual/ko/how-to/publish-packages.md` → `docs: 마켓 1단계 — 나가는 요청 지킴·캐시·알려진 한계`

> **── 검문 3 (Task 9–12): 앱 네이티브 받기, 화면 쪽 표·기기 캐시·잠금 맞추기, 문서와 실제 화면. Review Focus 2·4·5 를 화면으로, 「모드별로 누가 받는가」 다섯 줄을 하나씩 본다. ──**

## 설계 항목별 대응

| 설계 항목 | Task |
| --- | --- |
| 저장소 형식(`index.json`, `packages/<scope>/<name>/<version>/`, 파일마다 sha256) | 1(경로·주소), 2(index 검사), 5(만들기) |
| id `@scope/name`·semver·`engines` 판정(설치 때·기기별 표시, 잠금은 바꾸지 않음) | 1, 4(`resolveInstall`·`enginesOk`), 11(`incompatible`) |
| `@keyring` 은 공식 저장소에서만, 같은 id 여러 저장소(「다른 저장소에도」·잠금 `repo` 고정) | 2(`parseRepoIndex`), 4(`alsoIn`·잠금 고정), 7·10(받을 때 한 번 더) |
| 매니페스트(공통 필드·widget·theme·language, format 1 파일 셋) | 2 |
| 테마 색 값 검사(주입 거부) — 토큰 목록은 2단계 | 2 |
| 공통 설정 `marketplace`(저장소 순서·첫 실행 공식 하나·잠금) | 3 |
| 잠금 항목 통째 병합(판 높은 쪽, 「이 기기에서만」 없음) | 3 |
| 잠금이 원천(손으로 고친 것·동기화로 온 것도 받고, 빠진 것은 지움, `repo` 가 목록에 없어도) | 4(`planCache`), 7(서버 `reconcile`), 11(기기 `reconcile`) |
| sha256 이 다르면 쓰지 않고 오류 | 7(서버), 10(화면이 다시 잼), 11(`readPackageFile`) |
| 서버 받기·캐시 `<KEYRING_DATA>/packages/<id>/<version>/`·API·`index.json` 캐시 | 7, 8 |
| `https:` 만·크기 상한·시간 제한·`http:`/사설 IP 는 운영자 환경 변수만 | 6, 8 |
| 데스크톱 네이티브 받기(같은 규칙, 기기 설정)·capabilities 검토 | 9, 10(`nativeSource`·`readDeviceMarketSettings`), 위 「확인한 것」 |
| 「모드별로 누가 받는가」 다섯 줄 | 10(`marketMode`·`pickSource`·`fallbackSource`), 11, 12 Step 3 |
| 화면 쪽 캐시(오프라인에서도) | 10(`PackageCache`), 11 |
| 소유자만 설치·제거 | 8(API), 공통 설정 쓰기 권한(지금 규칙 — 8 에서 회귀 단언) |
| 패키지 CLI `check`·`index`(멱등)·Docker 안에서 | 5 |
| 형식을 사용자 문서에 전부(CLI 없이도) | 5, 8(reference·configuration), 12 |
| 2·3단계가 설 자리(파일 읽는 길·종류별 적용) | 11, 위 「2·3단계 인터페이스」 |
| CSP 그대로 | Global Constraints(바꾸는 Task 없음), 8(파일 응답 헤더) |
| 설치 화면·언어·테마·위젯 적용·「설치」 단추·WebRTC 알림 | 2·3단계(이 계획 밖) |
