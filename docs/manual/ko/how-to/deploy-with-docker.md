<!-- source: docs/manual/en/how-to/deploy-with-docker.md @ v0.8.5 -->
# Docker 로 배포하기

Docker Compose 로 서버에 Keyring Notes 를 띄우고 다른 기기에서 접속할 수 있게 합니다.

서버를 운영하는 분을 위한 문서입니다. 처음 로컬에서 써 보려면 [시작하기](../getting-started.md)가 더 짧습니다.

## Compose 구성의 짜임

- `docker-compose.yml` 에는 앱(`keyring`)과, `s3` 프로필에 든 선택 서비스 SeaweedFS 가 있습니다. SeaweedFS 는 기본으로 꺼져 있습니다.
- 이미지는 서버에서 저장소 코드로 빌드합니다(`pull_policy: build`). 레지스트리 이미지는 없습니다.
- 저장소는 웹 서버나 리버스 프록시를 제공하지 않습니다. 쓰는 것(nginx, Traefik, Caddy 등)을 따로 두세요.
- 설정은 `.env` 에 둡니다. 그 서버에서만 필요한 Compose 변경은 Git 이 무시하는 `compose.override.yaml` 에 씁니다.

요구 사항: Compose v2 와 BuildKit 이 있는 Docker. 아래 override 예시는 `!reset` 을 쓰므로 Docker Compose 2.24.4 이상이어야 합니다(`docker compose version`).

## 접속 방식 고르기

포트는 기본으로 `127.0.0.1` 에만 열립니다. 구성 하나를 고르세요.

| 구성 | Compose 파일(이 순서) | 필수 키 |
| --- | --- | --- |
| **A. HTTPS 리버스 프록시 뒤** | `docker-compose.yml`, `compose.override.yaml` | `KEYRING_PUBLIC_URL` |
| **B. 이 컴퓨터나 VPN 에서만** | `docker-compose.yml` | 없음(VPN 이면 `KEYRING_BIND`, `KEYRING_ALLOWED_HOSTS`) |

### 구성 A: 리버스 프록시 뒤

서버에 `compose.override.yaml` 을 쓰세요. 호스트 포트를 닫고 프록시의 네트워크에 붙습니다. `ports` 와 `networks` 는 기본 파일과 합쳐지므로 예시는 `!reset`·`!override` 로 바꿉니다.

```yaml
services:
  keyring:
    ports: !reset []            # close the host port; reach the app through the proxy only
    networks: !override
      - default
      - proxy

networks:
  proxy:
    name: ${PROXY_NETWORK:?PROXY_NETWORK is required}
    external: true              # the proxy's network; it must already exist on the server
```

그다음:

1. `docker network ls` 로 프록시의 네트워크가 있는지 확인하세요.
2. `.env` 에 파일 순서를 적으세요. 그러면 `-f` 없이 `docker compose up -d` 가 두 파일을 읽습니다.

   ```bash
   COMPOSE_FILE=docker-compose.yml:compose.override.yaml
   ```

3. `docker compose config` 로 합친 결과를 확인하세요. `keyring` 서비스에 `ports` 가 없고, 네트워크가 `default` 와 프록시의 것 둘이어야 합니다.
4. 프록시에서 `keyring:8787` 로 넘기고 `Host` 를 바꾸지 말고 전하세요. 서버는 받지 않는 호스트 이름을 421 로 거절합니다. `X-Forwarded-Proto: https` 도 보내세요. 로그인 쿠키의 `Secure` 와 패스키 확인이 이 값을 봅니다.

### 구성 B: 이 컴퓨터나 VPN

기본 포트 바인딩을 그대로 두세요. Tailscale 같은 VPN 이면 `.env` 에 다음을 적으세요.

```bash
KEYRING_BIND=<VPN 주소>
KEYRING_ALLOWED_HOSTS=<VPN 주소나 호스트 이름>
```

Tailscale 이면 `tailscale serve --bg 8787` 로 tailnet 안에서 HTTPS 를 붙일 수도 있습니다.

## `.env` 채우기

```bash
cp .env.example .env
```

`.env` 를 고치고 커밋하지 마세요. 모든 키는 [설정값](../configuration.md)에 있습니다. 대부분의 서버가 정하는 것:

- `KEYRING_PUBLIC_URL`: 사람들이 접속하는 https 주소. 이 호스트 이름만 받고(DNS 리바인딩 방지), 로그인 쿠키에 `Secure` 가 붙습니다.
- `KEYRING_DATA_DIR`: 볼트·설정·백업을 둘 호스트 폴더. 없으면 named volume 을 씁니다. 폴더를 먼저 만드세요. 그러지 않으면 Docker 가 root 소유로 만들어 앱이 쓰지 못합니다.

  ```bash
  sudo install -d -o 1000 -g 1000 /srv/keyring-notes/data
  ```

- `TZ`: 정기 작업과 자동 백업 시각의 시간대.

모든 페이지는 Content Security Policy, `X-Frame-Options: DENY` 같은 보안 헤더와 함께 나갑니다.

## S3 저장소 고르기(선택)

S3 호환 저장소는 백업을 서버 밖에 두고 큰 첨부를 보관합니다. 하는 일은 [백업과 복원](back-up-and-restore.md)을 보세요. 마련하는 방법을 하나 고르세요.

| 방법 | 할 일 |
| --- | --- |
| **쓰던 S3 쓰기** | `KEYRING_S3_BUCKET`, `KEYRING_S3_ACCESS_KEY_ID`, `KEYRING_S3_SECRET_ACCESS_KEY` 를 적으세요. AWS 는 `KEYRING_S3_REGION` 을, R2·MinIO 등은 `KEYRING_S3_ENDPOINT` 도 적으세요 |
| **함께 든 SeaweedFS 띄우기** | `COMPOSE_PROFILES=s3`, `KEYRING_S3_ENDPOINT=http://seaweedfs:8333`, `KEYRING_S3_PATH_STYLE=1`, 버킷 이름, 키 ID 와 비밀 값(긴 무작위 값)을 적으세요. 이것이 SeaweedFS 의 S3 계정이 되고, 버킷은 SeaweedFS 가 만듭니다. 포트는 호스트에 열지 않습니다 |

`s3` 프로필을 켰는데 키 ID, 비밀 값, 버킷 이름 중 하나라도 비어 있으면 `seaweedfs` 컨테이너가 이유를 로그에 남기고 끝납니다. 이 검사가 없으면 SeaweedFS 는 인증 없이 뜹니다. 쓰던 S3 를 쓸 때는 프로필을 켜지 마세요.

## 서버 띄우기

```bash
docker compose config            # the merged result of the files you chose
docker compose up -d             # build the image from the repository and start it
docker compose logs keyring      # shows the setup code on the first run
```

브라우저로 서버를 열고 설정 코드와 새 비밀번호를 넣으세요. 관리 CLI 는 컨테이너 안에서 돕니다. 예: `docker compose exec keyring keyring agent list`.

## 업데이트

설정 → **업데이트**가 새 릴리스를 알려 줍니다. 먼저 설정 → **백업·복원**에서 백업을 만들고 다음을 실행하세요.

```bash
git pull && docker compose up -d --build
```

컨테이너가 다시 뜨는 동안 열린 웹 세션의 저장, 앱 동기화, 에이전트의 일괄 쓰기가 끊깁니다. 아무도 쓰지 않을 때 하세요.

사내 프록시처럼 TLS 를 다시 서명하는 곳에서 빌드할 때는 그 CA 인증서를 빌드 비밀로 넘기세요. 이미지에는 남지 않습니다.

```bash
docker build --secret id=extra_ca,src=<CA.pem> .
```

## 데이터가 있는 곳

볼트·설정·백업은 모두 컨테이너의 `/data` 에 있습니다. 기본은 named volume `<project>_keyring-data` 이고, `KEYRING_DATA_DIR` 를 정하면 그 폴더입니다. named volume 에서 호스트 폴더로 옮기려면 백업을 내려받고, `KEYRING_DATA_DIR` 를 정해 다시 띄운 뒤 설정 → **백업·복원**에서 복원하세요.

## 다음 단계

- [Komodo 로 배포하기](deploy-with-komodo.md): 같은 구성을 Komodo Stack 으로
- [서버 관리하기](manage-the-server.md): 관리 콘솔, 비밀번호, 패스키
- [문제 해결](../troubleshooting.md)
