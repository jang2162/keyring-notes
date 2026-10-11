# Docker 로 배포하기

서버에 Docker Compose 로 올리는 방법이다. 저장소에 든 compose 파일 중 구성에 맞는 것을 골라 겹쳐 쓰고, 설정은 `.env` 에 둔다. 같은 파일과 `.env` 를 Komodo Stack 에 그대로 옮길 수 있다(「Komodo 에서」).

## compose 파일

| 파일 | 쓰임 |
| --- | --- |
| `docker-compose.yml` | 기본. 앱(`127.0.0.1:8787`)과 `https` 프로필의 Caddy. 이것만으로 로컬에서 돈다 |
| `docker/compose.proxy.yaml` | 이미 떠 있는 리버스 프록시 뒤에 둘 때. 호스트 포트를 닫고 프록시 네트워크에 붙는다 |
| `docker/compose.build.yaml` | 레지스트리 이미지 대신 저장소 코드로 서버에서 빌드할 때(포크·수정판) |

뒤 파일은 기본 파일에서 **달라지는 키만** 갖고, 앞 파일을 덮어쓴다. 순서가 바뀌면 기본 파일이 덮어쓰기를 지운다.

## 1. 구성 고르기

| 구성 | 파일(이 순서) | 필수 환경 변수 |
| --- | --- | --- |
| **A. 기존 리버스 프록시 뒤** | `docker-compose.yml`, `docker/compose.proxy.yaml` | `KEYRING_PUBLIC_URL`, `PROXY_NETWORK` |
| **B. 함께 든 Caddy 로 HTTPS** | `docker-compose.yml` | `COMPOSE_PROFILES=https`, `KEYRING_DOMAIN`, `KEYRING_PUBLIC_URL` |
| **C. 이 서버·VPN 에서만** | `docker-compose.yml` | 없음(VPN 이면 `KEYRING_BIND`, `KEYRING_ALLOWED_HOSTS`) |

서버에서 빌드하려면 어느 구성이든 맨 뒤에 `docker/compose.build.yaml` 을 더한다.

- **A**: 프록시는 `keyring:8787` 로 넘기고 `Host` 를 그대로 전한다(받는 호스트 목록에 없으면 서버가 421 로 거절한다). `X-Forwarded-Proto: https` 도 넘긴다 — 로그인 쿠키의 Secure 와 패스키 확인이 이것을 본다. `PROXY_NETWORK` 네트워크는 서버에 미리 있어야 한다(`docker network ls`). `!reset` 을 쓰므로 Docker Compose 2.24.4 이상이어야 한다(`docker compose version`).
- **B**: 서버의 80·443 이 비어 있고 도메인의 DNS 가 서버를 가리켜야 Let's Encrypt 인증서를 받는다. 사설망·시험용이면 `CADDY_TLS=internal`.
- **C**: 포트는 `127.0.0.1` 에만 열린다. Tailscale 이면 `tailscale serve --bg 8787` 로 tailnet 안 HTTPS 를 붙일 수도 있다.

고른 파일 목록은 `.env` 의 `COMPOSE_FILE` 에 `:` 로 이어 적는다. 그러면 `-f` 없이 `docker compose up -d` 가 그 순서로 읽는다.

```bash
# 구성 A
COMPOSE_FILE=docker-compose.yml:docker/compose.proxy.yaml
```

## 2. `.env` 채우기

`cp .env.example .env` 뒤 고친다. `.env` 는 커밋하지 않는다. compose 의 `environment:` 에 적힌 키만 컨테이너에 들어가므로, 키를 더하거나 빼면 compose 파일·`.env.example`·이 표를 같은 커밋에서 고친다.

| 키 | 필수 | 설명 | 예시 |
| --- | --- | --- | --- |
| `COMPOSE_FILE` | 선택(`docker-compose.yml`) | 겹쳐 쓸 compose 파일(`:` 로 이음) | `docker-compose.yml:docker/compose.proxy.yaml` |
| `KEYRING_PUBLIC_URL` | A·B 필수 | 밖에서 접속하는 https 주소. 이 호스트 이름만 받고 로그인 쿠키에 Secure 가 붙는다 | `https://notes.example.com` |
| `PROXY_NETWORK` | A 필수 | 리버스 프록시와 함께 쓰는 외부 네트워크 이름 | `proxy` |
| `COMPOSE_PROFILES` | B 필수 | `https` 면 Caddy 를 함께 띄운다 | `https` |
| `KEYRING_DOMAIN` | B 필수 | Caddy 가 인증서를 받을 도메인 | `notes.example.com` |
| `CADDY_TLS` | 선택 | `internal` 이면 Caddy 자체 CA | `internal` |
| `KEYRING_DATA_DIR` | 선택(named volume) | 볼트·설정·백업을 둘 호스트 경로. 없으면 Docker 가 root 소유로 만들어 앱이 못 쓰므로 미리 만든다: `sudo install -d -o 1000 -g 1000 <경로>` | `/srv/keyring-notes` |
| `KEYRING_IMAGE` | 선택(`ghcr.io/jang2162/keyring-notes`) | 받을 이미지. 포크 이미지면 바꾼다 | `ghcr.io/<계정>/keyring-notes` |
| `KEYRING_TAG` | 선택(`latest`) | 이미지 태그. 판을 고정할 때 | `0.5.0` |
| `KEYRING_BIND`·`KEYRING_PORT` | 선택(`127.0.0.1`·`8787`) | 호스트에 여는 주소·포트(구성 B·C) | `100.64.0.10` |
| `KEYRING_ALLOWED_HOSTS` | 선택 | 받을 호스트 목록(쉼표). **정하면 이 목록만 받는다** — `KEYRING_PUBLIC_URL` 의 호스트도 함께 적는다 | `notes.example.com,keyring.tailnet.ts.net` |
| `KEYRING_FETCH_ALLOW_PRIVATE` | 선택(`0`) | 사설 주소 URL 수집 허용 | `1` |
| `TZ` | 선택(`Asia/Seoul`) | 정기 작업·백업 시각의 시간대 | |
| `KEYRING_S3_*` | 선택 | S3 호환 저장소. 키와 뜻은 `.env.example` | |
| `KEYRING_S3_ACCESS_KEY_ID`·`KEYRING_S3_SECRET_ACCESS_KEY`·`KEYRING_S3_ENCRYPTION_KEY` | 선택(비밀) | 비밀값. 암호화 키는 잃으면 복구할 수 없으니 따로 보관한다 | |

## 3. 띄우고 처음 설정하기

```bash
docker compose config            # 고른 파일이 겹쳐진 결과. 구성 A 면 keyring 에 ports 가 없고 네트워크가 default·프록시 둘
docker compose up -d             # 구성에 compose.build.yaml 이 있으면 --build
docker compose logs keyring      # "처음 설치: … 설정 코드 → XXXX-XXXX-XXXX"
```

브라우저로 열어 설정 코드와 새 비밀번호를 넣는다. 관리 CLI 는 `docker compose exec keyring keyring agent list`.

## 4. 업데이트

관리 콘솔의 "업데이트" 탭이 새 릴리스를 알려 준다. 업데이트 전에 관리 콘솔에서 백업을 하나 만든다.

```bash
docker compose pull && docker compose up -d     # 레지스트리 이미지(v* 태그마다 GHCR 에 올라간다)
git pull && docker compose up -d --build        # 서버에서 빌드하는 구성
```

다시 띄우는 동안 편집 중인 웹 세션의 저장·앱 동기화·에이전트의 일괄 쓰기가 끊긴다. 쓰지 않는 때에 한다.

## 데이터

볼트·설정·백업은 모두 컨테이너의 `/data` 에 있다. 기본은 named volume `<project>_keyring-data`, `KEYRING_DATA_DIR` 를 정하면 그 호스트 디렉터리다. named volume 에서 호스트 디렉터리로 옮길 때는 백업을 받고, `KEYRING_DATA_DIR` 를 정해 다시 띄운 뒤 관리 콘솔에서 복원한다.

## 그 서버에서만 더 바꿀 것이 있으면

위 파일로 안 되는 그 서버만의 설정은 저장소 루트에 `compose.server.yaml` 을 쓰고 `COMPOSE_FILE` 맨 뒤에 더한다. 이 이름은 저장소가 ignore 한다.

- `ports`·`volumes`·`networks` 는 앞 파일과 **합쳐진다.** 바꾸려면 `!override`, 없애려면 `!reset` 을 쓴다.
- 결과는 `docker compose config` 로 확인한다.

## Komodo 에서

같은 구성을 Komodo 의 **Git Repo Stack** 으로 올릴 때는 위 단계가 Stack 설정에 이렇게 대응한다.

| 위 단계 | Komodo Stack |
| --- | --- |
| `COMPOSE_FILE` 의 파일 목록 | `File Paths` 에 같은 순서로 한 줄씩. Komodo 는 `-f` 로 넘기므로 `COMPOSE_FILE` 은 넣지 않는다 |
| `.env` | `Environment`. Komodo 가 `.env` 로 써서 compose 에 준다. 바꾼 뒤에는 다시 Deploy 한다 |
| 비밀값 | Komodo **Variables** 에 Secret 으로 등록하고 Environment 에는 `KEYRING_S3_SECRET_ACCESS_KEY=[[KEYRING_S3_SECRET_ACCESS_KEY]]` 처럼 참조만 쓴다 |
| 업데이트 | Webhook 은 끄고 Deploy 를 누르기를 권한다 — push 마다 재배포하면 위의 끊김이 생기고, 레지스트리 이미지는 `v*` 태그 때만 바뀐다 |
| `compose.server.yaml` | Stack 디렉터리(Periphery 가 clone 한 곳)에 서버에서 직접 쓰고 `File Paths` 맨 뒤에 더한다. **재 clone(Stack 을 다시 만들거나 저장소·브랜치를 바꿀 때)하면 지워지므로** 내용을 따로 적어 둔다 |

Stack 이름이 compose project 이름이 되므로 named volume 은 `<Stack 이름>_keyring-data` 다. `container_name` 은 쓰지 않아 같은 서버의 다른 Stack 과 겹치지 않는다.
