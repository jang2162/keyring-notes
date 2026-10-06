# Keyring Notes

마크다운 파일을 원본으로 셀프호스팅 서버에 두고, 사람은 웹에서 편집하고 에이전트는 토픽별 권한 토큰으로만 접근하는 개인용 노트 앱.
전체 계획은 [docs/PLAN.md](docs/PLAN.md)에 있다.

> 현재 상태: **6단계** — 파일 저장소·웹 에디터·Git 이력(1), 로그인·토큰 × 폴더 권한·MCP·일괄 쓰기(2),
> SQLite 인덱스·자동완성·위젯(3), LLM Wiki: 원본 수집·토픽 템플릿·index/log 자동 생성(4),
> 관리 콘솔·백업/복원·Docker·HTTPS 원격 접속(5, 노트 이전 제외),
> 변경 검토 대기열·출처 연결·정리 점검·웹훅/정기 작업·그래프·의미 검색·PWA 오프라인 편집·위젯 플러그인(6),
> 데스크톱·모바일 앱: 서버 없이 쓰는 로컬 볼트 + 선택 동기화(7, 진행 중).

## 설치(Docker, 권장)

```bash
git clone https://github.com/jang2162/keyring-notes && cd keyring-notes
docker compose up -d --build              # http://127.0.0.1:8787 (이 컴퓨터에서만)
docker compose logs keyring               # "처음 설치: … 설정 코드 → XXXX-XXXX-XXXX"
```

브라우저로 열어 설정 코드와 새 비밀번호를 넣으면 끝이다. 데이터(볼트·설정·백업)는 모두 `keyring-data` 볼륨의 `/data`에 있다.
컨테이너 안 관리 CLI: `docker compose exec keyring keyring agent list`.

### 원격 접속

앱 포트는 기본으로 `127.0.0.1`에만 열린다. 밖에서 쓰려면 둘 중 하나:

- **HTTPS 리버스 프록시(Caddy, 자동 인증서)**: 도메인의 DNS를 서버로 향하게 하고 80·443을 연 뒤
  ```bash
  cp .env.example .env    # KEYRING_PUBLIC_URL=https://notes.example.com, KEYRING_DOMAIN=notes.example.com
  docker compose --profile https up -d
  ```
  사설망·시험용이면 `.env`에 `CADDY_TLS=internal`(Caddy 자체 CA).
- **VPN(Tailscale 등)**: `.env`에 `KEYRING_BIND=<VPN 주소>`와 `KEYRING_ALLOWED_HOSTS=<그 주소·호스트 이름>`. Tailscale이면 `tailscale serve --bg 8787`로 tailnet 안 HTTPS를 붙이는 방법도 있다.

`KEYRING_PUBLIC_URL`을 정하면 그 호스트 이름으로 온 요청만 받고(DNS 리바인딩 방지, 다른 Host는 421) 로그인 쿠키에 `Secure`가 붙는다. 모든 페이지에 CSP·`X-Frame-Options: DENY` 등 보안 헤더가 붙는다.

### 업데이트

관리 콘솔의 "업데이트" 탭이 최신 릴리스를 확인한다. 업데이트 전에 백업을 하나 만들고:

```bash
docker compose pull && docker compose up -d          # GHCR 이미지를 쓸 때(v* 태그마다 .github/workflows/docker.yml이 올림)
git pull && docker compose up -d --build             # 직접 빌드할 때
```

사내 프록시처럼 TLS를 다시 서명하는 곳에서 빌드할 때는 `docker build --secret id=extra_ca,src=<CA.pem> .`(이미지에는 남지 않는다).

## 소스에서 실행

```bash
npm install
npm run build                      # web/dist, server/dist 생성
npm start                          # http://127.0.0.1:8787 — 로그의 설정 코드로 웹에서 비밀번호 설정
                                   # (또는 npm run keyring -- passwd)
```

개발 모드(핫 리로드)는 터미널 두 개에서:

```bash
npm run dev:server   # API: 127.0.0.1:8787
npm run dev:web      # 웹: http://localhost:5173 (API는 프록시)
```

### 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `KEYRING_DATA` | (없음, 도커는 `/data`) | 주면 볼트·설정·백업이 모두 `<DATA>/vault`, `<DATA>/config/keyring.json`, `<DATA>/backups` |
| `KEYRING_VAULT` | `./vault` | 볼트 폴더 |
| `KEYRING_CONFIG` | `./config/keyring.json` | 비밀번호 해시·에이전트 토큰 해시·권한 표·백업 설정. 볼트 밖에 둔다 |
| `KEYRING_BACKUP_DIR` | `./backups` | 백업 파일 폴더 |
| `KEYRING_PUBLIC_URL` | (없음) | 원격 접속 주소(https). 허용 호스트와 Secure 쿠키에 쓰인다 |
| `KEYRING_ALLOWED_HOSTS` | `PUBLIC_URL`의 호스트 | 받을 Host 이름(쉼표로 여럿). localhost는 늘 허용 |
| `KEYRING_UPDATE_URL` | GitHub releases/latest | 업데이트 확인 주소. 빈 값이면 확인하지 않는다 |
| `KEYRING_BACKUP_SCHEDULER` | `1` | `0`이면 자동 백업 스케줄러를 끈다 |
| `KEYRING_FETCH_ALLOW_PRIVATE` | (없음) | `1`이면 URL 수집에서 사설·루프백 주소(사내 위키 등)도 허용. 기본은 SSRF 방지로 막는다 |
| `KEYRING_INDEX` | `<볼트>/.keyring/index.db` | 검색 인덱스(캐시). 지우면 다음 시작 때 다시 만든다 |
| `KEYRING_EMBED_URL` · `KEYRING_EMBED_MODEL` | (없음) | 의미 검색용 OpenAI 호환 `/embeddings` 주소와 모델. 둘 다 있어야 켜진다 |
| `KEYRING_EMBED_KEY` | (없음) | 임베딩 API 키(`Authorization: Bearer`) |
| `KEYRING_PLUGINS_DIR` | `./plugins`(도커 `/data/plugins`) | 위젯 플러그인 폴더 |
| `KEYRING_SCHEDULER` | `1` | `0`이면 정기 작업(웹훅) 스케줄러를 끈다 |
| `KEYRING_S3_BUCKET` | (없음) | S3 호환 저장소 버킷. 주면 원격 백업이 켜진다(아래 "S3 저장소") |
| `KEYRING_S3_ACCESS_KEY_ID` · `KEYRING_S3_SECRET_ACCESS_KEY` | (없음) | 접근 키(`AWS_ACCESS_KEY_ID`·`AWS_SECRET_ACCESS_KEY`도 읽는다) |
| `KEYRING_S3_REGION` | `us-east-1` | 리전(R2는 `auto`) |
| `KEYRING_S3_ENDPOINT` | AWS S3 | R2·MinIO 등 다른 저장소 주소. 주면 경로 방식(`KEYRING_S3_PATH_STYLE`로 바꿀 수 있음) |
| `KEYRING_S3_PREFIX` | `keyring/` | 버킷 안 키 앞부분 |
| `KEYRING_S3_BLOBS` · `KEYRING_S3_BLOB_MIN_KB` | `0` · `256` | `1`이면 이 크기 이상 첨부를 Git 대신 S3에 둔다 |
| `KEYRING_HOST` | `127.0.0.1` | 바인드 주소 |
| `KEYRING_PORT` | `8787` | 포트 |

### Obsidian 볼트로 시험하기

원본 볼트를 건드리지 않도록 **복사본**을 만들어 연다.

```bash
cp -R ~/ObsidianVault /tmp/vault-copy
KEYRING_VAULT=/tmp/vault-copy npm start
```

서버가 시작할 때 볼트 안의 기존 파일을 `system` 작성자의 커밋 하나로 흡수한다. 이후 서버 밖에서 고친 내용도 다음 시작 때 같은 방식으로 기록된다.

## 관리 콘솔

사이드바의 ⚙. 소유자만 쓸 수 있다(에이전트 토큰은 403).

- **서버 상태**: 버전·실행 시간, 문서·파일 수와 용량, 커밋 수와 마지막 변경, 디스크 여유, 백업 현황, 에이전트별 마지막 접속. HTTPS 아님·허용 호스트 없음·백업 없음·디스크 부족이면 경고.
- **에이전트·권한**: 에이전트 만들기(토큰과 MCP 설정 예를 한 번만 보여 줌), 폴더별 권한 표 편집, 토큰 재발급, 삭제.
- **백업·복원**: 지금 백업, 내려받기, 다른 서버의 백업 파일 올리기, 복원, 자동 백업 설정(간격·남길 개수·설정 포함 여부).
- **업데이트**: 지금·최신 버전 확인과 업데이트 방법.
- **보안**: 비밀번호 변경(다른 기기의 로그인은 모두 끊김), 원격 접속 안내.

### S3 저장소(선택)

원본은 계속 서버 디스크(볼트 폴더 + Git)에 두고, S3 호환 저장소(AWS S3·Cloudflare R2·MinIO·Backblaze B2 …)는 두 가지에 쓴다. SDK 없이 SigV4로 직접 붙는다.

- **원격 백업**: `KEYRING_S3_BUCKET`과 키만 주면 켜진다. 백업을 만들 때마다(자동·수동) `<접두사>backups/`에 올리고, 자동 백업은 설정한 개수만 남긴다. 업로드가 실패해도 로컬 백업은 만들어지고 관리 콘솔에 경고가 뜬다. 서버를 잃었을 때: 새 서버에 같은 S3 설정으로 띄운 뒤 관리 콘솔 → 백업·복원 → S3 원격 백업에서 "가져오기" → "복원".
- **큰 첨부 보관**(`KEYRING_S3_BLOBS=1`): 기준 크기 이상의 첨부(마크다운이 아닌 파일)를 `<접두사>blobs/<sha256>`에 내용 해시로 올리고 Git에서는 뺀다. Git에는 경로 → 해시 목록(`.keyring-blobs.json`)만 남는다(Git LFS와 같은 방식). 볼트 폴더에는 파일이 그대로 있어 화면·API·앱 동기화·다른 편집기는 달라지지 않고, Git 이력과 백업 파일이 작아진다.
  - 켜는 순간 이미 Git에 있던 큰 첨부도 이력에서 빠진다(과거 커밋 안의 사본은 그대로 남는다).
  - S3에 못 올리면 쓰기는 그대로 되고 "올리기 대기"로 남아 5분마다 다시 올린다. 대기 중인 첨부는 백업에 들어가지 않는다(관리 콘솔 경고).
  - 복원하면 그 백업의 목록대로 첨부를 S3에서 받아 오고, 그 뒤에 생긴 첨부는 지운다.
  - S3 객체는 내용 해시가 이름이라 덮어쓰지 않고, 지우지도 않는다(과거 백업이 가리킬 수 있어서). 버킷에 버전 관리·수명 주기 규칙을 걸려면 `blobs/`는 빼는 것이 안전하다.
  - 첨부 파일의 이력(어떤 버전이 언제)은 문서 이력 화면이 아니라 `.keyring-blobs.json`의 Git 이력에 있다.
- 버킷은 공개하지 않는다. 첨부는 지금처럼 서버가 권한을 확인한 뒤 내준다(서명 URL로 직접 내주지 않는다).

### 백업 형식

`keyring-<시각>-<auto|manual|pre-restore>.tar.gz` 하나에 `manifest.json`, `vault.bundle`(`git bundle --all`: 모든 문서·첨부와 전체 이력), 선택으로 `config.json`(비밀번호·토큰 해시, 권한 표)이 들어간다. 검색 인덱스와 위키 index·log는 다시 만들 수 있어 넣지 않는다.

- 백업 직전에 서버 밖에서 생긴 변경도 커밋해 넣는다.
- 자동 백업은 간격(기본 24시간)이 지났고 마지막 자동 백업 뒤 바뀐 것이 있을 때만 만들고, 자동 백업만 개수(기본 14)를 넘으면 지운다.
- **복원**은 먼저 지금 상태를 `pre-restore` 백업으로 남기고 지금 HEAD를 `refs/keyring/before-restore-<시각>`에 보관한 뒤, 볼트 파일과 이력을 백업 시점으로 바꾼다. 그래서 복원도 되돌릴 수 있다. 설정 복원은 고를 때만.
- 다른 서버로 옮기기: 백업을 내려받아 새 서버 관리 콘솔에서 올린 뒤 "복원"(설정도 복원하면 비밀번호·에이전트까지 그대로).

## 데스크톱·모바일 앱

앱은 **서버 없이도** 동작한다. 문서는 기기 폴더의 마크다운 파일이 원본이고, 편집·검색·태그·백링크·위젯·위키 목차·정리 점검·그래프·변경 이력이 모두 기기 안에서 돈다.
서버 연결은 선택이며, 연결하면 이 서버와 문서를 맞춘다. 화면은 웹과 같은 코드(`web`), 로컬 볼트·동기화는 `packages/core`, 앱 셸은 Tauri 2(`app`).

| | 볼트 위치 | 비고 |
| --- | --- | --- |
| Windows · macOS · Linux | `문서/Keyring Notes` (⇅ → "다른 폴더 열기"로 Obsidian 볼트 폴더도 열 수 있음) | 다른 편집기에서 고친 파일은 창으로 돌아올 때 다시 읽는다 |
| iOS | 앱 문서 폴더(“파일” 앱에 보임) | |
| Android | 앱 데이터 폴더 | |
| 브라우저 | 이 브라우저의 IndexedDB (`https://서버/?local`, 끄기 `?local=0`) | 서버 없는 PWA·시험용 |

앱 메타데이터는 볼트 안 `.keyring-app/`(점 폴더라 서버·Obsidian은 무시)에 둔다: 변경 기록(`journal.jsonl`), 내용 스냅샷(`objects/`, 해시로 저장해 중복 없음), 동기화 기준점(`sync.json`).

### 서버와 동기화(선택)

앱의 ⇅ → 서버 주소·기기 이름·서버 비밀번호 → "연결하고 동기화". 서버는 이 기기용 토큰(`kd_…`)을 발급하고, 관리 콘솔 → 앱·기기에서 기기별로 끊을 수 있다.
자동 동기화는 앱을 열 때, 저장하고 10초 뒤, 창으로 돌아올 때, 5분마다(모바일은 앱이 열려 있을 때만).

- 문서마다 "마지막으로 같았던 버전(기준점)"과 비교해 한쪽만 바뀌었으면 그쪽을 반영한다.
- 양쪽이 모두 바뀌었으면 기준점 내용으로 **3방향 병합**한다. 서로 다른 부분(떨어진 줄)을 고쳤으면 합친 내용을 양쪽에 저장한다(이력에 "자동 병합"으로 남아 되돌릴 수 있다).
- 같은 줄(또는 바로 붙은 줄)을 다르게 고쳤으면 **덮어쓰지 않는다**: 원래 경로는 서버 버전, 이 기기의 내용은 `<이름> (동기화 충돌 사본 날짜-시각).md`로 양쪽에 남는다. 문서 안에 충돌 표시(`<<<<<<<`)는 넣지 않는다. 한쪽이 지우고 다른 쪽이 고쳤으면 고친 쪽을 살린다.
- 마크다운은 양방향, 첨부(이미지·PDF)는 서버 → 기기만. 위키 index·log는 각자 만든다.
- 앱이 서버에 쓴 커밋의 작성자는 `소유자 (기기 이름)`이고, 기기 토큰으로는 관리 콘솔을 쓸 수 없다. 에이전트(MCP)는 지금처럼 서버에만 붙는다.
- 서버 없이 쓰는 기능 중 원본 수집(웹페이지·PDF 변환), 의미 검색, 변경 검토, 위젯 플러그인 그리기는 서버에 연결된 웹 화면에서 쓴다.

### 빌드

```bash
npm ci
npm run app:dev                       # 데스크톱 개발 실행(웹 개발 서버 + 앱 창)
npm run app:build                     # 설치 파일(Windows .msi/.exe, macOS .dmg, Linux .deb/.rpm/.AppImage)
npm run android:init -w app && npm run android:build -w app   # Android SDK·NDK 필요
npm run ios:init -w app && npm run ios:build -w app           # macOS + Xcode 필요
```

필요한 것: Rust(stable), Node 22, 플랫폼별 [Tauri 사전 요구 사항](https://v2.tauri.app/start/prerequisites/)(Linux는 `libwebkit2gtk-4.1-dev` 등). 아이콘은 `npm run icons -w app`으로 다시 만든다.

## 노트 쓰기

**동시 수정**: 저장할 때 다른 곳(다른 탭·에이전트·앱 동기화)에서 먼저 고쳤으면, 편집을 시작한 버전을 기준으로 3방향 병합해 서로 다른 부분이면 자동으로 합쳐 저장한다. 같은 줄을 다르게 고쳤을 때만 "내 변경을 사본으로 저장 / 서버 버전 불러오기"를 묻는다. 오프라인에서 저장한 내용을 다시 연결해 보낼 때도 같다. 에이전트(MCP·REST)는 지금처럼 409를 받고 다시 읽어 쓴다.

- **위키링크**: `[[문서]]`, `[[폴더/문서]]`, `[[문서#제목|별칭]]`, `![[이미지.png|300]]`. `[[`를 치면 문서·첨부 이름이 자동완성된다(같은 이름이 여럿이면 경로로 구분).
- **할 일**: `- [ ] 할 일`. 미리보기의 체크박스를 누르면 원문이 바뀐다(저장해야 반영).
- **이동·이름 바꾸기**: 이 문서를 가리키던 링크를 같은 커밋에서 함께 고치고 "링크 N곳을 고쳤습니다"로 알린다. 고치는 곳은 본문 위키링크(`[[…]]`·`![[…]]`), 프런트매터 `sources`/`source`의 `[[…]]`와 경로 값, 상대 경로 마크다운 링크·이미지(`[x](../a.md)`, 이동한 문서 자신의 상대 링크도 새 위치 기준으로)다. `#제목`·`#^블록`·`|별칭`은 그대로 두고, 원래 경로를 썼으면 전체 경로, 이름만 썼으면 해석이 맞는 가장 짧은 이름으로 쓴다. 이동한 문서가 더 얕은 같은 이름이 되어 다른 링크를 가로채는 경우도 원래 대상으로 고친다. 코드 블록·인라인 코드 안은 건드리지 않는다. 에이전트가 옮기면 그 에이전트가 볼 수 있는 경로로만 해석하고 쓸 권한이 있는 문서만 고치며, 고친 링크는 늘 전체 경로로 쓴다(검토 대상 경로에 닿으면 제안 미리보기에 함께 들어간다).
- **여러 형식**(Obsidian과 같은 문법, 미리보기 전용):
  - 콜아웃 `> [!note] 제목` — 종류별 색(note·tip·warning·danger·question·example·quote 등), `[!tip]-`는 접힘·`[!tip]+`는 펼침
  - `==하이라이트==`, 각주 `본문[^1]` … `[^1]: 내용`
  - 수식 `$E=mc^2$`, `$$ … $$`(KaTeX). `$5와 $6`처럼 `$` 바로 뒤가 공백이면 수식이 아니다
  - 다이어그램 ` ```mermaid ` 코드 블록
  - 문서 임베드 `![[문서]]`, `![[문서#제목]]`, `![[문서#^블록]]` — 내용을 끼워 넣는다(문단에 임베드만 있을 때). 깊이 3단계까지, 자기 자신을 다시 넣으면 링크로만. 없거나 볼 수 없는 문서는 끊어진 링크
  - 블록 ID: 문단·목록 항목 끝에 ` ^id`(표 등은 다음 줄에 `^id`만). 표시는 숨기고 `[[문서#^id]]`로 그 위치에 간다
  - 주석 `%%…%%`(여러 줄 가능) — 미리보기에서 숨기고, 주석 안의 링크·태그·할 일은 색인에서도 세지 않는다
  - 상대 경로 마크다운 링크 `[x](폴더/문서.md#제목)`도 문서로 열린다
  - KaTeX·Mermaid는 쓸 때만 불러오고(같은 출처의 번들, CDN 아님), 설치된 앱(PWA)은 처음 연 뒤 뒤에서 받아 두어 오프라인에서도 보인다
- **검색**: 사이드바 검색창. 공백으로 나눈 단어를 모두 포함한 문서를 찾고, `#태그` 단어는 태그 조건이 된다(하위 태그 포함). 본문·제목·경로·프런트매터를 모두 찾는다.
- **출처·인용·백링크**: 미리보기 아래에 프런트매터 `sources`가 가리키는 출처(없거나 볼 수 없으면 빨간 줄), 이 문서를 출처로 인용한 페이지, 본문에서 링크한 문서(백링크).
- **의미 검색**: 임베딩을 설정하면 검색창 옆 "의미"로 단어가 달라도 뜻이 가까운 문서를 찾는다.
- **그래프**(◎): 문서와 링크(실선)·출처(점선). 문서 수가 많은 토픽 3개만 색, 나머지는 "기타" 회색. 확대·이동, 호버로 이웃 강조, 누르면 열기, 현재 문서 주변만 보기.
- **오프라인·모바일**: 홈 화면에 앱으로 설치할 수 있다(PWA). 한 번 연 문서는 연결이 없어도 열리고, 오프라인에서 저장하면 이 기기에 두었다가 연결되면 보낸다. 그 사이 서버에서 바뀐 문서는 덮어쓰지 않고 "오프라인 충돌 사본"으로 남긴다. 좁은 화면에서는 문서 목록이 서랍(☰)으로 바뀐다.

### 위젯

`widget` 언어 이름을 붙인 코드 블록에 YAML로 쓴다. 다른 에디터에서는 평범한 코드 블록으로 보인다.

````markdown
```widget
type: query          # query(목록) | table(표) | tasks(할 일) | chart(차트)
from: 업무/프로젝트A  # 폴더, "#태그", 또는 목록. 생략하면 볼트 전체
where: status != done # 조건 하나 또는 목록(모두 만족)
show: [title, due]
sort: due            # -due 또는 "due desc"는 역순, 목록이면 여러 기준
limit: 50
```
````

| 항목 | 설명 |
| --- | --- |
| 필드 | 프런트매터 키 + 내장 필드 `path`, `title`(프런트매터 title → 첫 `#` 제목 → 파일 이름), `folder`, `name`, `tags`, `modified` |
| 조건 | `=` `!=` `>` `>=` `<` `<=` `contains` `!contains`, `필드`(값 있음), `!필드`(값 없음). 값 `today`는 오늘 날짜(YYYY-MM-DD) |
| `tasks` | `status: open`(기본) / `done` / `all`. 위젯에서 체크하면 원본 문서에 바로 저장된다 |
| `chart` | `chart: bar`(기본) / `line`, `x: 묶을 필드`, `y: 숫자 필드`, `agg: sum`(y가 있으면 기본) / `count` / `avg`. 또는 `data: [{label, value}]`로 직접 입력. "표로 보기" 제공 |
| `plugin` | `plugin: <이름>` + 위와 같은 `from`·`where`·`show`·`sort`, `options:`는 플러그인에 그대로. 플러그인 만드는 법은 [examples/plugins](examples/plugins/README.md)(예: 칸반) |

위젯도 권한 계층을 지나므로, 에이전트가 같은 쿼리를 돌려도(MCP `query`) 볼 수 있는 문서만 나온다.

## LLM Wiki

원본 자료 → 에이전트가 관리하는 위키 → 스키마의 세 층으로 운영하는 토픽이다. 최상위 폴더에 `SCHEMA.md`가 있으면 위키 토픽이 된다.

```
경제/
├── SCHEMA.md            위키 구조와 작업 절차(수집·질의·정리). 사람만 고친다 — 에이전트는 규칙과 상관없이 읽기만
├── raw/                 수집한 원본(마크다운 변환본). 에이전트 권장 권한: append
│   └── assets/          원본 파일(PDF·이미지·HTML)
└── wiki/                에이전트가 관리하는 페이지. 권장 권한: delete
    ├── index.md         [자동] 페이지 목록(분류·요약·출처 수) + 미반영/반영된 원본
    └── log.md           [자동] Git 이력으로 만든 작업 기록: ## [날짜 시각] 작성자 | 메시지
```

1. **토픽 만들기**: 웹의 📥(수집) → "새 위키 토픽". `SCHEMA.md` 템플릿이 생기니 목적과 규칙을 채운다.
2. **에이전트 권한**: `agent grant <이름> 경제/raw append`, `경제/wiki delete`, `경제/SCHEMA.md read`.
3. **원본 수집**(📥 또는 MCP):
   - 파일: PDF(텍스트 추출, 쪽별), 이미지, HTML, 마크다운·텍스트. 파일당 50MB.
   - URL: 서버가 가져와 본문만 마크다운으로(Readability + Turndown). PDF 링크면 PDF로 처리.
   - 웹 클리퍼: URL 탭의 "📎 Keyring 클립"을 북마크바에 끌어다 놓고, 저장할 페이지에서 누른다. 로그인이 필요한 페이지도 브라우저가 가진 HTML을 보내므로 저장되고, 선택한 부분만 저장할 수도 있다.
   - 붙여넣기: 텍스트·마크다운 그대로.
   - 저장 위치: `<토픽>/raw/<날짜> <제목>.md`. 프런트매터에 `source_type`, `source_url`, `original`, `ingested_at`, `ingested_by`.
4. **index·log**: 위키 토픽 안에서 무언가 바뀔 때마다 서버가 다시 만든다. 직접 고칠 수 없고 Git·검색 인덱스에도 넣지 않는다. 읽는 사람의 권한에 맞춰 만들므로, 원본을 볼 수 없는 에이전트에게는 원본 이름이 나오지 않는다. 원본은 위키 페이지가 본문 링크나 `sources`로 인용하면 "반영"으로 바뀐다.

## 에이전트와 함께 운영하기

### 변경 검토 대기열

✔(검토) → "검토 대상"에 폴더를 적으면(`/`는 전체) 그 아래에 **에이전트가** 쓰는 변경은 바로 반영하지 않고 제안으로 쌓인다. 권한·충돌 검사는 그때 이미 하고, 사람이 diff를 보고 "승인하고 반영"하면 에이전트 이름으로 커밋된다(본문에 승인자). 그 사이 문서가 바뀌었으면 "문서가 그 사이 바뀜"으로 표시되고 승인은 충돌로 거부된다. 거절 사유는 에이전트가 MCP `my_proposals`로 본다. 사람이 쓰는 것은 늘 바로 반영된다.

### 정리 점검

🧹(정리) 또는 MCP `lint`: 깨진 링크·출처, 고아 위키 페이지, `sources` 없는 페이지, `title`·`summary` 누락, 오래된(기본 180일, 프런트매터 `updated` 우선) 페이지, 아직 인용 안 된 원본.

### 웹훅과 정기 작업

관리 콘솔 → 자동화. 웹훅은 이벤트를 JSON으로 POST한다.

| 이벤트 | 언제 | data |
| --- | --- | --- |
| `raw.added` | 위키 토픽 `raw/`에 새 원본(수집·에이전트 쓰기·승인 모두) | `topic, path, rev, author, message` |
| `doc.changed` | 커밋마다 | `rev, author, message, files[{status, path}]` |
| `proposal.created` | 검토 대기열에 새 제안 | `id, agent, message, topic, files` |
| `schedule` | 정기 작업 실행 | `job, topic, instructions, lint?{counts, issues, total}` |

본문은 `{event, id, time, data}`, 헤더 `X-Keyring-Signature: sha256=<HMAC-SHA256(secret, 본문)>`. 받는 쪽 검증 예(Node):

```js
const ok = req.headers["x-keyring-signature"] === "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
```

5xx·연결 실패는 1·5·25초 뒤 다시 보낸다. 정기 작업은 cron(`분 시 일 월 요일`, 서버 시간대)마다 웹훅으로 `schedule`을 보내며, "정리 점검 포함"이면 점검 결과와 지시문을 함께 보내 에이전트가 정리 작업을 하게 한다. 예: `0 9 * * 1`(매주 월 9시).

### 의미 검색 켜기

OpenAI 호환 임베딩이면 무엇이든 된다.

```bash
# 로컬(Ollama): ollama pull nomic-embed-text
KEYRING_EMBED_URL=http://localhost:11434/v1/embeddings KEYRING_EMBED_MODEL=nomic-embed-text npm start
# OpenAI
KEYRING_EMBED_URL=https://api.openai.com/v1/embeddings KEYRING_EMBED_MODEL=text-embedding-3-small KEYRING_EMBED_KEY=sk-... npm start
```

문서를 절 단위로 나눠 벡터를 인덱스 파일에 저장하고, 바뀐 문서만 다시 계산한다(외부 API를 쓰면 문서 내용이 그 서비스로 간다). 상태는 `GET /api/semantic/status`.

## 에이전트 연결

### 1. 토큰 발급과 권한 지정

```bash
npm run keyring -- agent add wiki-work                    # 토큰은 이때 한 번만 보인다
npm run keyring -- agent grant wiki-work 업무/raw append
npm run keyring -- agent grant wiki-work 업무/wiki delete
npm run keyring -- agent grant wiki-work 업무/SCHEMA.md read
npm run keyring -- agent list
```

그 밖의 명령: `agent rotate <이름>`(토큰 재발급, 이전 토큰 즉시 무효), `agent revoke <이름> <경로>`, `agent remove <이름>`.
설정 파일이 바뀌면 서버가 다음 요청부터 다시 읽으므로 재시작할 필요가 없다.

| 권한 | 할 수 있는 일 |
| --- | --- |
| `hidden` | 없음. 목록·검색·링크 해석에서도 빠지고, 읽기는 "없는 문서"와 같은 오류 |
| `read` | 읽기, 검색, 이력 조회 |
| `append` | + 새 문서 만들기, 기존 문서 **끝에 덧붙이기**(기존 내용 수정·삭제·이동 불가) |
| `write` | + 기존 내용 수정, 롤백 |
| `delete` | + 삭제, 다른 곳으로 이동 |

- 규칙이 없는 경로는 `hidden`이다. 볼트 전체 규칙은 경로 `/`로 준다.
- 같은 문서에 여러 규칙이 걸리면 가장 구체적인(긴) 경로의 규칙이 이긴다.
- 에이전트가 만든 커밋은 작성자가 에이전트 이름으로 기록된다.

### 2. MCP 클라이언트 설정

Streamable HTTP(무상태, JSON 응답) 방식이다.

- URL: `http://127.0.0.1:8787/mcp`
- 헤더: `Authorization: Bearer <토큰>`

| 도구 | 설명 |
| --- | --- |
| `whoami` | 내 이름과 권한 표 |
| `list_topics` | 토픽 목록. `wiki: true`면 LLM Wiki 토픽 |
| `ingest_url` | URL(웹 페이지·PDF)을 가져와 `<토픽>/raw/`에 저장 |
| `ingest_text` | 가진 텍스트를 `<토픽>/raw/`에 원본으로 저장 |
| `list_documents` | 읽을 수 있는 문서와 각 권한 |
| `read_outline` | 해시·줄 수·프런트매터·제목(줄 범위)·위키링크. 본문 없음 |
| `read_section` | 제목(`상위 > 하위`) 또는 줄 범위로 일부만 읽기 |
| `read_document` | 전체 읽기 |
| `list_frontmatter` | 폴더 안 문서들의 프런트매터를 한 번에 |
| `search` | 전체 텍스트 검색(`#태그` 단어는 태그 조건) |
| `backlinks` | 이 문서를 링크한 문서 |
| `list_tags` | 태그와 문서 수 |
| `query` | 위젯과 같은 YAML 쿼리(query·table·tasks·chart·plugin) |
| `sources` | 출처(프런트매터 sources)·이 문서를 인용한 페이지·본문 백링크 |
| `lint` | 정리 점검 |
| `semantic_search` | 의미 검색(설정했을 때) |
| `my_proposals` | 내가 올린 변경 제안의 처리 결과 |
| `write_document` / `append_document` | 쓰기 / 끝에 덧붙이기 |
| `move_document` / `delete_document` | 이동 / 삭제. 이동은 기본으로 이 문서를 가리키던 링크를 같은 커밋에서 고친다(`update_links: false`로 끔, 결과 `linksUpdated`·`linkCount`) |
| `batch_write` | write·append·delete·move 여러 개를 한 커밋으로. 하나라도 실패하면 전부 취소. move가 있으면 링크도 고친다(`update_links`) |

쓰기에는 마지막으로 읽은 `hash`를 `base_hash`로 넘긴다(새 문서는 `null`). 서버 버전과 다르면 `conflict`와 `current_hash`를 돌려주고 아무것도 쓰지 않는다. 검토 대상 폴더에 쓰면 결과에 `pending`이 붙고(볼트는 그대로), 돌려준 `content`·`hash`는 승인 뒤의 모습이다.

## 저장 구조

- `vault/**.md` — 원본. 순수 마크다운 + YAML 프런트매터.
- `vault/.history/` — Git 저장소(`--git-dir`). 작업 트리는 볼트 자체라서 다른 에디터에서 열어도 `.git`이 보이지 않는다.
- 점으로 시작하는 폴더(`.obsidian`, `.trash`, `.history`)는 트리에서 숨기고 API로 접근할 수 없다.
- `vault/.keyring/index.db` — SQLite 인덱스(본문 FTS5 trigram, 태그, 링크, 할 일, 프런트매터). 서버 시작 때 바뀐 파일만 다시 읽어 맞추고, 서버를 통한 변경은 커밋 직후 반영한다. Git 추적에서 빠진다.
- `config/keyring.json` — 권한 0600. 비밀번호는 scrypt 해시, 토큰은 sha256 해시만 저장한다.

## 구조

```
웹(쿠키 로그인) ─┐
앱 기기(토큰) ───┼─ REST /api/*  ─┐
에이전트(토큰) ──┤                ├─ ScopedVault(권한 계층) ─ Vault(파일·일괄 쓰기) ─ Git
                 └─ MCP /mcp ─────┘

앱(Tauri) = 같은 웹 화면 + LocalVault(기기 폴더, 메모리 색인, 스냅샷 이력) ⇄ SyncEngine ⇄ REST
packages/core = 마크다운 분석·위젯 쿼리·위키 목차/기록·정리 점검·그래프(서버와 앱이 같이 씀)
```

REST와 MCP는 모두 `server/src/scoped.ts`의 `ScopedVault`를 거쳐서만 볼트와 인덱스에 닿는다. 인덱스는 권한을 모르고, 검색·백링크·태그·위젯 결과는 모두 `ScopedVault`에서 권한으로 거른다. 모든 변경은 `Vault.batch()` 하나를 지나며, 가상의 상태에서 권한·충돌을 먼저 모두 검사한 뒤 디스크에 적용하고 한 커밋으로 남긴다. 적용이나 커밋 중에 실패하면 원래 내용으로 되돌린다.

## REST API

인증: 웹은 `POST /api/auth/login`이 주는 쿠키(HttpOnly, SameSite=Strict), 에이전트·앱 기기는 `Authorization: Bearer <토큰>`. 모든 변경 요청은 `Content-Type: application/json`이어야 한다. 출처가 다른 앱을 위해 `Authorization` 헤더로 온 요청(과 기기 등록)에만 CORS 응답을 연다.

| 메서드 | 경로 | 본문 / 쿼리 | 설명 |
| --- | --- | --- | --- |
| GET | `/api/auth/status` | | 로그인 상태 |
| POST | `/api/auth/login` · `/api/auth/logout` | `{password}` | 소유자 로그인 / 로그아웃 |
| GET | `/api/whoami` | | 이름과 권한 표 |
| GET | `/api/tree` · `/api/documents` | `?folder=` | 트리 / 평면 목록 |
| GET | `/api/file?path=` | | 문서 내용과 `hash`(sha256) |
| GET | `/api/outline?path=` | | 문서 개요 |
| GET | `/api/section?path=` | `&heading=` 또는 `&start=&end=` | 섹션 읽기 |
| GET | `/api/frontmatter` | `?folder=&fields=a,b` | 프런트매터 목록 |
| GET | `/api/search?q=` | `&folder=&limit=` | 검색 |
| GET | `/api/health` | | 헬스체크(인증 없음) |
| POST | `/api/auth/device` | `{password, name}` | 앱 기기 등록 → `{id, name, token}`(토큰은 한 번만) |
| GET | `/api/sync/manifest` | | 동기화용 파일 목록 `{files: [{path, hash, size}]}`(소유자·기기, 서버가 만드는 위키 index·log 제외) |
| POST | `/api/auth/setup` | `{code, password}` | 처음 설치(비밀번호가 없을 때만, 로그의 설정 코드) |
| * | `/api/admin/…` | | 관리 콘솔 API(소유자만): `status`, `update`, `devices`(·`DELETE devices/:id`), `agents`, `agents/:name/rules`·`rotate`, `password`, `backups`, `backups/settings`, `backups/upload`, `backups/:name/restore`, `automation`, `automation/webhooks`·`jobs`, `automation/webhooks/:id/test`, `automation/jobs/:id/run` |
| GET · POST | `/api/topics` | `{name}` | 토픽 목록 / 위키 토픽 만들기(소유자) |
| POST | `/api/ingest` | `{kind: url\|html\|text, topic, ...}` | 원본 수집 |
| POST | `/api/ingest/file?topic=&name=` | 파일 바이트, 헤더 `x-keyring-upload: 1` | 파일 업로드 수집 |
| GET | `/api/backlinks?path=` | | 백링크 |
| GET | `/api/sources?path=` | | 출처·인용·백링크 |
| GET | `/api/lint` | `?folder=&staleDays=` | 정리 점검 |
| GET | `/api/graph` | `?folder=` | 그래프(노드·링크) |
| GET | `/api/semantic` · `/api/semantic/status` | `?q=&folder=&limit=` | 의미 검색 / 상태 |
| GET · PUT | `/api/review/settings` | `{reviewPaths}` | 검토 대상 폴더(소유자) |
| GET | `/api/review` · `/api/review/:id` | `?status=pending` | 제안 목록 / diff 포함 상세(소유자) |
| POST | `/api/review/:id/approve` · `/reject` | `{reason?}` | 승인·거절(소유자) |
| GET | `/api/plugins` · `/plugins/<이름>.js` | | 위젯 플러그인 목록 / 모듈(소유자 로그인) |
| GET | `/api/tags` | | 태그와 문서 수 |
| POST | `/api/widget` | `{source}` | 위젯 YAML 실행 |
| POST | `/api/task` | `{path, line, done, baseHash}` | 할 일 체크 |
| PUT | `/api/file` | `{path, content, baseHash}` | 쓰기. 새 문서면 `baseHash: null` |
| POST | `/api/append` | `{path, content, baseHash?}` | 끝에 덧붙이기 |
| DELETE | `/api/file` | `{path, baseHash}` | 삭제 |
| POST | `/api/move` | `{from, to, baseHash, updateLinks?}` | 이동·이름 변경. 링크 자동 갱신(기본 켬) → `linksUpdated`(고친 문서)·`linkCount` |
| POST | `/api/batch` | `{message?, operations: [{op, ...}], updateLinks?}` | 일괄 쓰기. 같은 일괄 쓰기의 연쇄 이동(A→B→C)은 합쳐서 링크를 고친다. `files`에는 실제로 바뀐 파일만 |
| GET | `/api/raw?path=` | | 첨부 파일(이미지 등) 원본 |
| GET | `/api/history?path=` | | 문서의 커밋 목록(작성자 포함) |
| GET | `/api/revision?path=&rev=` | | 특정 리비전의 내용 |
| POST | `/api/rollback` | `{path, rev, baseHash}` | 과거 리비전으로 되돌리기(새 커밋) |

오류: `401` 인증 없음, `403` 권한 없음, `404` 없음(숨김 포함), `409` 충돌(`currentHash` 포함).

## 테스트

```bash
npm test         # 경로 검증, 충돌, 이력·롤백, 일괄 쓰기 원자성, 권한(숨김·읽기·추가 전용), 인증, MCP,
                 # 한국어 검색, 태그, 백링크, 인덱스 동기화, 위젯, 할 일 체크,
                 # 위키 토픽, 수집(URL·PDF·이미지·클립), SSRF 차단, index·log 생성과 권한별 내용,
                 # 검토 대기열, 출처·정리 점검, 웹훅 서명·재시도·cron, 그래프, 의미 검색(가짜 임베딩 서버), 플러그인,
                 # 백업·복원(되돌리기·다른 서버로 옮기기)·자동 백업, 관리 API 권한, 처음 설치, 허용 호스트·보안 헤더,
                 # 로컬 볼트(서버 없이 쓰기·검색·위젯·스냅샷 이력·외부 변경·위키 목차), 동기화(3방향·충돌 사본·삭제·409·오프라인),
                 # 기기 토큰·CORS·동기화 목록, 실제 서버 API를 거친 앱 ↔ 서버 동기화
npm run typecheck
```
