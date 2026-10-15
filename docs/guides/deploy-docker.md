# Docker 로 배포하기

서버에 Docker Compose 로 올리는 방법이다. 저장소의 `docker-compose.yml` 은 앱(keyring) 하나만 갖는다. **웹 서버(리버스 프록시)는 저장소가 제공하지 않는다** — 각자 쓰는 것(nginx·Traefik·Caddy 등)을 따로 두고, 그 서버에서만 필요한 설정은 `compose.override.yaml` 에 쓴다. 설정은 `.env` 에 둔다. 이미지는 레지스트리에서 받지 않고 **서버에서 저장소 코드로 빌드한다**(`pull_policy: build`). Komodo 로 올리는 법은 [deploy-komodo.md](deploy-komodo.md).

## compose 파일

| 파일 | 쓰임 |
| --- | --- |
| `docker-compose.yml` | 기본. 앱, 호스트 포트는 `127.0.0.1:8787`. `s3` 프로필의 SeaweedFS 도 여기 있다(꺼져 있다). 이것만으로 로컬에서 돈다 |
| `compose.override.yaml` | **서버에서 직접 쓰는 파일.** 프록시 네트워크·호스트 포트 닫기 등 그 서버만의 설정. 저장소가 ignore 하므로 커밋되지 않는다 |

뒤 파일은 앞 파일에서 **달라지는 키만** 갖고 덮어쓴다. 순서가 바뀌면 기본 파일이 덮어쓰기를 지운다.

## 1. 구성 고르기

| 구성 | 파일(이 순서) | 필수 환경 변수 |
| --- | --- | --- |
| **A. 리버스 프록시 뒤** | `docker-compose.yml`, `compose.override.yaml` | `KEYRING_PUBLIC_URL` |
| **B. 이 서버·VPN 에서만** | `docker-compose.yml` | 없음(VPN 이면 `KEYRING_BIND`, `KEYRING_ALLOWED_HOSTS`) |

- **A**: 프록시는 `keyring:8787` 로 넘기고 `Host` 를 그대로 전한다(받는 호스트 목록에 없으면 서버가 421 로 거절한다). `X-Forwarded-Proto: https` 도 넘긴다 — 로그인 쿠키의 Secure 와 패스키 확인이 이것을 본다. 프록시와 같은 외부 네트워크가 서버에 미리 있어야 한다(`docker network ls`). `!reset` 을 쓰므로 Docker Compose 2.24.4 이상이어야 한다(`docker compose version`).
- **B**: 포트는 `127.0.0.1` 에만 열린다. Tailscale 이면 `tailscale serve --bg 8787` 로 tailnet 안 HTTPS 를 붙일 수도 있다.

### 구성 A 의 `compose.override.yaml`

서버에서 이 내용을 직접 쓴다(Komodo 에서는 Stack 디렉터리에, → deploy-komodo.md). `ports` 와 `networks` 는 앞 파일과 **합쳐지므로** 바꾸려면 `!reset`·`!override` 를 쓴다.

```yaml
services:
  keyring:
    ports: !reset []            # 호스트 포트를 닫는다. 외부 접근은 프록시를 통해서만
    networks: !override
      - default
      - proxy

networks:
  proxy:
    name: ${PROXY_NETWORK:?PROXY_NETWORK is required}
    external: true              # 프록시가 쓰는 네트워크. 서버에 먼저 있어야 한다
```

결과는 `docker compose config` 로 확인한다. `keyring` 에 `ports` 가 없고 네트워크가 `default`·프록시 둘이어야 한다.

고른 파일 목록은 `.env` 의 `COMPOSE_FILE` 에 `:` 로 이어 적으면 `-f` 없이 `docker compose up -d` 가 그 순서로 읽는다.

```bash
COMPOSE_FILE=docker-compose.yml:compose.override.yaml
```

## 2. `.env` 채우기

`cp .env.example .env` 뒤 고친다. `.env` 는 커밋하지 않는다. compose 의 `environment:` 에 적힌 키만 컨테이너에 들어가므로, 키를 더하거나 빼면 compose 파일·`.env.example`·이 표를 같은 커밋에서 고친다.

| 키 | 필수 | 설명 | 예시 |
| --- | --- | --- | --- |
| `COMPOSE_FILE` | 선택(`docker-compose.yml`) | 겹쳐 쓸 compose 파일(`:` 로 이음). Komodo 에서는 쓰지 않는다 | `docker-compose.yml:compose.override.yaml` |
| `KEYRING_PUBLIC_URL` | A 필수 | 밖에서 접속하는 https 주소. 이 호스트 이름만 받고 로그인 쿠키에 Secure 가 붙는다 | `https://notes.example.com` |
| `PROXY_NETWORK` | 선택 | 위 `compose.override.yaml` 예시가 읽는 값. 프록시와 함께 쓰는 외부 네트워크 이름 | |
| `KEYRING_DATA_DIR` | 선택(named volume) | 볼트·설정·백업을 둘 호스트 경로. 없으면 Docker 가 root 소유로 만들어 앱이 못 쓰므로 미리 만든다: `sudo install -d -o 1000 -g 1000 <경로>` | `/srv/keyring-notes` |
| `KEYRING_BIND`·`KEYRING_PORT` | 선택(`127.0.0.1`·`8787`) | 호스트에 여는 주소·포트(구성 B) | `100.64.0.10` |
| `KEYRING_ALLOWED_HOSTS` | 선택 | 받을 호스트 목록(쉼표). **정하면 이 목록만 받는다** — `KEYRING_PUBLIC_URL` 의 호스트도 함께 적는다 | `notes.example.com,keyring.tailnet.ts.net` |
| `KEYRING_FETCH_ALLOW_PRIVATE` | 선택(`0`) | 사설 주소 URL 수집 허용 | `1` |
| `TZ` | 선택(`Asia/Seoul`) | 정기 작업·백업 시각의 시간대 | |
| `KEYRING_S3_*` | 선택 | S3 호환 저장소. 키와 뜻은 `.env.example`. 구성 방법은 아래 「S3」 | |
| `COMPOSE_PROFILES` | 선택 | `s3` 면 함께 든 SeaweedFS 를 띄운다 | `s3` |
| `SEAWEEDFS_DATA_DIR` | 선택(named volume) | SeaweedFS 데이터의 호스트 경로 | `/srv/keyring-notes/seaweedfs` |
| `SEAWEEDFS_IMAGE` | 선택(`chrislusf/seaweedfs`) | SeaweedFS 이미지. 판을 고정할 때 | |
| `KEYRING_S3_ACCESS_KEY_ID`·`KEYRING_S3_SECRET_ACCESS_KEY`·`KEYRING_S3_ENCRYPTION_KEY` | 선택(비밀) | 비밀값. 암호화 키는 잃으면 복구할 수 없으니 따로 보관한다 | |

## S3

백업을 서버 밖에도 올리고 큰 첨부를 S3 에 두려면 S3 호환 저장소가 필요하다. 앱이 읽는 키는 어느 방법이든 같은 `KEYRING_S3_*` 다.

| 방법 | 하는 일 |
| --- | --- |
| **쓰던 S3 를 입력** | `.env` 에 `KEYRING_S3_BUCKET`·`KEYRING_S3_ACCESS_KEY_ID`·`KEYRING_S3_SECRET_ACCESS_KEY` 를 적는다. AWS 는 `KEYRING_S3_REGION` 만, R2·MinIO 등은 `KEYRING_S3_ENDPOINT` 도 적는다 |
| **직접 구성(함께 든 SeaweedFS)** | `.env` 에 `COMPOSE_PROFILES=s3` 를 적고 `KEYRING_S3_ENDPOINT=http://seaweedfs:8333`, `KEYRING_S3_PATH_STYLE=1` 과 버킷 이름·키·비밀번호(8자 이상)를 적는다. 키와 비밀번호가 S3 계정이 되고, 버킷은 SeaweedFS(`weed mini`)가 만든다. 포트는 호스트에 열지 않는다 |

프로필을 켰는데 키·비밀번호·버킷 이름이 하나라도 비어 있으면 `seaweedfs` 컨테이너가 이유를 로그에 남기고 종료한다(검사가 없으면 SeaweedFS 는 인증 없이 모두 허용하는 모드로 뜬다)(꺼진 프로필에서는 아무 것도 검사하지 않는다). 쓰던 S3 를 쓸 때는 `COMPOSE_PROFILES` 를 켜지 않는다. 암호화 키(`KEYRING_S3_ENCRYPTION_KEY`)는 어느 방법이든 선택이며, 잃으면 복구할 수 없다.

## 3. 띄우고 처음 설정하기

```bash
docker compose config            # 고른 파일이 겹쳐진 결과
docker compose up -d             # 저장소 코드로 이미지를 빌드하고 띄운다
docker compose logs keyring      # "처음 설치: … 설정 코드 → XXXX-XXXX-XXXX"
```

브라우저로 열어 설정 코드와 새 비밀번호를 넣는다. 관리 CLI 는 `docker compose exec keyring keyring agent list`.

## 4. 업데이트

관리 콘솔의 "업데이트" 탭이 새 릴리스를 알려 준다. 업데이트 전에 관리 콘솔에서 백업을 하나 만든다.

```bash
git pull && docker compose up -d --build        # 받은 코드로 다시 빌드해 띄운다
```

다시 띄우는 동안 편집 중인 웹 세션의 저장·앱 동기화·에이전트의 일괄 쓰기가 끊긴다. 쓰지 않는 때에 한다.

## 데이터

볼트·설정·백업은 모두 컨테이너의 `/data` 에 있다. 기본은 named volume `<project>_keyring-data`, `KEYRING_DATA_DIR` 를 정하면 그 호스트 디렉터리다. named volume 에서 호스트 디렉터리로 옮길 때는 백업을 받고, `KEYRING_DATA_DIR` 를 정해 다시 띄운 뒤 관리 콘솔에서 복원한다.
