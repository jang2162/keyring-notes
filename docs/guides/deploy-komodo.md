# Komodo 로 배포하기

자기 서버의 Komodo 에 **Git Repo Stack** 하나로 올리는 방법이다. 서버에 따로 파일을 쓰지 않고, 저장소에 든 compose 파일을 고르고 Environment 만 채우면 된다. 규칙의 근거는 `docs/guideline/komodo/`.

## 저장소에 든 compose 파일

| 파일 | 쓰임 |
| --- | --- |
| `docker-compose.yml` | 기본. 로컬에서도 그대로 돈다. 앱(`127.0.0.1:8787`)과 `https` 프로필의 Caddy |
| `docker/compose.proxy.yaml` | 이미 떠 있는 리버스 프록시 뒤에 둘 때. 호스트 포트를 닫고 프록시 네트워크에 붙는다 |
| `docker/compose.build.yaml` | 레지스트리 이미지 대신 저장소 코드로 서버에서 빌드할 때(포크·수정판) |

뒤 파일은 기본 파일에서 **달라지는 키만** 갖는다. Komodo 는 `File Paths` 에 적은 순서대로 `-f` 로 넘기고, 뒤 파일이 앞 파일을 덮어쓴다.

## 1. 구성 고르기

| 구성 | File Paths(이 순서) | 필수 Environment |
| --- | --- | --- |
| **A. 기존 리버스 프록시 뒤** | `docker-compose.yml`, `docker/compose.proxy.yaml` | `KEYRING_PUBLIC_URL`, `PROXY_NETWORK` |
| **B. 함께 든 Caddy 로 HTTPS** | `docker-compose.yml` | `COMPOSE_PROFILES=https`, `KEYRING_DOMAIN`, `KEYRING_PUBLIC_URL` |
| **C. 이 서버·VPN 에서만** | `docker-compose.yml` | 없음(VPN 이면 `KEYRING_BIND`, `KEYRING_ALLOWED_HOSTS`) |

서버에서 빌드하려면 어느 구성이든 맨 뒤에 `docker/compose.build.yaml` 을 더한다.

- **A**: 프록시는 `keyring:8787` 로 넘기고 `Host` 를 그대로 전한다(받는 호스트 목록에 없으면 서버가 거절한다). `X-Forwarded-Proto: https` 도 넘긴다 — 로그인 쿠키의 Secure 와 패스키 확인이 이것을 본다. `PROXY_NETWORK` 네트워크는 서버에 미리 있어야 한다(`docker network ls`). `!reset` 을 쓰므로 Docker Compose 2.24.4 이상이어야 한다(`docker compose version`).
- **B**: 서버의 80·443 이 비어 있고 도메인이 서버를 가리켜야 Let's Encrypt 인증서를 받는다.

## 2. Stack 만들기

| 항목 | 값 |
| --- | --- |
| Name | 원하는 이름(예: `keyring-notes`). compose project 이름이 되어 named volume 이 `<이름>_keyring-data` 가 된다 |
| Server | 올릴 서버 |
| Source | Git Repo — 이 저장소(또는 포크)와 브랜치. 비공개면 Komodo 에 등록한 `git_account` |
| File Paths | 1단계에서 고른 목록 |
| Environment | 3단계 |
| Webhook | **끔** 을 권한다. 아래 「업데이트」 |

`container_name` 은 쓰지 않는다. compose 가 `<이름>-keyring-1` 처럼 붙이므로 같은 서버의 다른 Stack 과 겹치지 않는다.

## 3. Environment 채우기

Komodo 는 Environment 를 `.env` 로 써서 compose 의 `${…}` 를 채운다. 컨테이너가 받는 것은 compose 파일의 `environment:` 에 적힌 키뿐이다. 바꾼 뒤에는 다시 Deploy 해야 컨테이너에 들어간다.

| 키 | 필수 | 설명 | 예시 |
| --- | --- | --- | --- |
| `KEYRING_PUBLIC_URL` | A·B 필수 | 밖에서 접속하는 https 주소. 이 호스트 이름만 받고 로그인 쿠키에 Secure 가 붙는다 | `https://notes.example.com` |
| `PROXY_NETWORK` | A 필수 | 리버스 프록시와 함께 쓰는 외부 네트워크 이름 | `proxy` |
| `COMPOSE_PROFILES` | B 필수 | `https` 면 Caddy 를 함께 띄운다 | `https` |
| `KEYRING_DOMAIN` | B 필수 | Caddy 가 인증서를 받을 도메인 | `notes.example.com` |
| `CADDY_TLS` | 선택 | `internal` 이면 Caddy 자체 CA(사설망·시험용) | `internal` |
| `KEYRING_DATA_DIR` | 선택(named volume) | 볼트·설정·백업을 둘 호스트 경로. 없으면 Docker 가 root 소유로 만들어 앱이 못 쓰므로 미리 만든다: `sudo install -d -o 1000 -g 1000 <경로>` | `/srv/keyring-notes` |
| `KEYRING_IMAGE` | 선택(`ghcr.io/jang2162/keyring-notes`) | 받을 이미지. 포크 이미지면 바꾼다 | `ghcr.io/<계정>/keyring-notes` |
| `KEYRING_TAG` | 선택(`latest`) | 이미지 태그. 판을 고정할 때 | `0.5.0` |
| `KEYRING_BIND`·`KEYRING_PORT` | 선택(`127.0.0.1`·`8787`) | 호스트에 여는 주소·포트(구성 C) | `100.64.0.10` |
| `KEYRING_ALLOWED_HOSTS` | 선택 | 받을 호스트 목록(쉼표). **정하면 이 목록만 받는다** — `KEYRING_PUBLIC_URL` 의 호스트도 함께 적는다 | `notes.example.com,keyring.tailnet.ts.net` |
| `KEYRING_FETCH_ALLOW_PRIVATE` | 선택(`0`) | 사설 주소 URL 수집 허용 | `1` |
| `TZ` | 선택(`Asia/Seoul`) | 정기 작업·백업 시각의 시간대 | |
| `KEYRING_S3_*` | 선택 | S3 호환 저장소. 키와 뜻은 `.env.example` | |
| `KEYRING_S3_ACCESS_KEY_ID`·`KEYRING_S3_SECRET_ACCESS_KEY`·`KEYRING_S3_ENCRYPTION_KEY` | 선택(비밀) | Komodo Variables 로 참조(아래). 암호화 키는 잃으면 복구할 수 없으니 Komodo 밖에도 보관한다 | |

비밀값은 Komodo **Variables** 에 Secret 으로 등록하고 Environment 에는 `[[이름]]` 만 쓴다. Variable 은 Komodo 전체가 공유하므로 앞에 앱 이름을 붙인다.

```
# 구성 A 예시
KEYRING_PUBLIC_URL=https://notes.example.com
PROXY_NETWORK=proxy
KEYRING_DATA_DIR=/srv/keyring-notes
KEYRING_S3_SECRET_ACCESS_KEY=[[KEYRING_S3_SECRET_ACCESS_KEY]]
```

## 4. Deploy 와 처음 설정

- Deploy 한 뒤 로그(Komodo 의 Stack Log)에 나온 설정 코드로 웹에서 소유자 비밀번호를 정한다.
- 관리 CLI 는 Komodo 의 컨테이너 터미널에서 `keyring agent list`.
- 결과가 의도대로인지 보려면 서버의 Stack 디렉터리에서 같은 파일 순서로 `docker compose --env-file .env -f docker-compose.yml -f docker/compose.proxy.yaml config` 를 본다. 구성 A 면 `keyring` 에 `ports` 가 없고 네트워크가 `default`·프록시 둘이다.

## 업데이트

Webhook 은 끄고 사람이 **Deploy** 를 누르기를 권한다.

- **Why:** Webhook 은 push 마다 재배포한다. 레지스트리 이미지를 쓰면 이미지는 `v*` 태그 때만 바뀌므로 push 재배포는 같은 이미지로 컨테이너만 다시 만든다. 재배포하면 서버가 다시 떠서 편집 중인 웹 세션의 저장·앱 동기화·에이전트의 일괄 쓰기가 끊긴다.
- **How to apply:** 새 판이 나오면(GHCR `latest`) Komodo 에서 Deploy 한다 — `docker compose pull` 뒤 `up -d` 다. 서버에서 빌드하는 구성(`compose.build.yaml`)은 Deploy 가 저장소를 받아 다시 빌드한다.

## 서버에서만 더 바꿀 것이 있으면

위 파일로 안 되는 그 서버만의 설정은 Stack 디렉터리에 `compose.server.yaml` 을 직접 쓰고 `File Paths` 맨 뒤에 더한다. 이 이름은 저장소가 ignore 하므로 Komodo 의 갱신(pull)과 부딪치지 않는다.

- **재 clone(Stack 을 다시 만들거나 저장소·브랜치를 바꿀 때)하면 이 파일은 지워진다.** 내용을 저장소 밖 어딘가에 따로 적어 둔다.
- `ports`·`volumes`·`networks` 는 기본 파일과 **합쳐진다.** 바꾸려면 `!override`, 없애려면 `!reset` 을 쓴다(`docs/guideline/komodo/02-override.md`).
