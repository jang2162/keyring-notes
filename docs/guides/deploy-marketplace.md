# 공식 마켓 배포

공식 마켓플레이스(`https://keyring-notes-marketplace.develma.com/`, core `OFFICIAL_REPO_URL`)를 띄우고 갱신하는 사람이 지킬 규칙이다. 운영자 누구나 따라 하는 절차(개인 마켓 포함)는 사용자 문서 `docs/manual/en/how-to/run-a-marketplace.md`(번역 `docs/manual/ko/how-to/run-a-marketplace.md`)에, 저장소 형식은 `docs/manual/en/how-to/publish-packages.md` 에, 받는 쪽의 지킴은 [development.md](development.md) 「마켓 받기와 나가는 요청」 에 있다. Docker 구성의 공통 규칙은 [deploy-docker.md](deploy-docker.md), Komodo 의 공통 규칙은 [deploy-komodo.md](deploy-komodo.md).

## 구성

- 마켓 서버는 앱과 따로다: `marketplace/Dockerfile`(core·서버만 빌드, 웹 화면 없음), `marketplace/compose.yaml`, `marketplace/.env.example`. 앱의 `docker-compose.yml`·`Dockerfile` 에 섞지 않는다.
- 컨테이너는 `keyring pkg serve /srv/market` 하나다(`server/src/marketServe.ts`). 시작할 때와 `MARKET_REBUILD_SECONDS` 마다 `index.json` 을 다시 만들고(바뀔 때만 쓴다), `/index.json`(짧은 캐시)과 `/packages/...`(긴 캐시)만 내준다. 압축하지 않는다 — 받는 쪽이 identity 만 받는다.
- 공식 패키지는 이 저장소 `marketplace/packages/<scope>/<name>/<version>/` 에 둔다. 이미지가 그 폴더를 싣는다. 넣기 전에 `pnpm keyring pkg check <판 폴더>` 로 본다. 범위 `@keyring` 은 공식 저장소에서만 받히므로 공식 패키지는 `marketplace/packages/keyring/…` 에 둔다.
- 리버스 프록시·TLS 는 넣지 않는다. 앱과 서버 받기는 `https:` 저장소만 받으므로 공식 마켓은 반드시 프록시 뒤에서 https 로 열린다. 프록시 네트워크·`ports` 닫기는 서버의 `marketplace/compose.override.yaml`(저장소에서 ignore)에 쓴다 — 앱과 같은 꼴([deploy-docker.md](deploy-docker.md) 「저장소가 갖는 것과 갖지 않는 것」).
- `marketplace/Dockerfile` 도 BuildKit(`RUN --mount=type=secret`)을 쓴다. 앱 이미지와 같은 요구다.

## Komodo Stack 설정

| 항목 | 값 |
| --- | --- |
| Name | 마켓용 이름(앱 Stack 과 다르게 — compose project·named volume 이름이 갈린다) |
| Source | Git Repo — 이 저장소, 배포하는 브랜치 |
| Run Directory | `marketplace` |
| File Paths | 한 줄씩 이 순서로: `compose.yaml`, `compose.override.yaml`. `COMPOSE_FILE` 은 쓰지 않는다 |
| Environment | 아래 표 |
| Webhook | 끔 — 이 저장소의 push 는 대부분 앱 코드라 마켓을 다시 빌드할 이유가 없다. 공식 패키지를 바꾼 커밋을 넣은 뒤 사람이 Deploy 한다 |
| override 파일 | 서버의 `{stack_dir}/{Stack 이름}/marketplace/compose.override.yaml`. 앱 Stack 의 override 와 같은 꼴(`ports: !reset []`, 프록시 외부 네트워크 `external: true`). 네트워크 이름은 서버 전용이라 여기에 적지 않는다 |

Environment:

| 키 | 필수 | 설명 |
| --- | --- | --- |
| `MARKET_NAME` | 아니오 | 저장소 이름(`index.json` 의 `name`). 기본 `Keyring Notes` |
| `MARKET_REBUILD_SECONDS` | 아니오 | `index.json` 을 다시 만드는 주기. 기본 60 |
| `MARKET_BIND`, `MARKET_PORT` | 아니오 | 호스트 쪽 바인드. 프록시 뒤면 override 가 `ports` 를 닫으므로 쓰지 않는다 |

compose 는 `container_name` 을 쓰지 않고, `pull_policy: build` 라 Deploy 마다 저장소 코드로 빌드한다.

## 갱신 절차

1. 새 판 폴더를 `marketplace/packages/keyring/<name>/<version>/` 에 넣고 `pnpm keyring pkg check` 로 본다. 이미 낸 판의 파일은 바꾸지 않는다 — 잠금이 그 판의 sha256 을 모든 기기에 고정해 두었다. 고칠 것은 새 판으로 낸다.
2. `pnpm keyring pkg index marketplace` 로 `index.json` 이 만들어지는지 본다(커밋하지 않는다 — `marketplace/index.json` 은 컨테이너가 만든다).
3. 커밋·병합한 뒤 Komodo 에서 Deploy 한다.
4. `https://keyring-notes-marketplace.develma.com/index.json` 에 새 판이 보이는지 본다.
