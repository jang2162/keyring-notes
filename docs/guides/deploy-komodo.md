# Komodo 로 배포하기

서버에는 Komodo 의 **Git Repo Stack** 으로 올린다. 저장소의 `docker-compose.yml` 은 로컬에서도 그대로 돌고, 서버에서만 다른 것(포트 닫기, 프록시 네트워크, 데이터 경로)은 서버에 직접 쓰는 `compose.server.yaml` 에 둔다. 규칙의 근거는 `docs/guideline/komodo/`.

이미지는 서버에서 빌드하지 않는다. `v*` 태그를 올리면 `.github/workflows/docker.yml` 이 `ghcr.io/jang2162/keyring-notes` 에 올리고, Stack 은 그것을 받는다.

## Stack 설정

Stack 을 바꾸면 같은 커밋에서 이 표도 고친다.

| 항목 | 값 |
| --- | --- |
| Name | `keyring-notes` (compose project 이름이 된다. named volume 은 `keyring-notes_keyring-data`) |
| Server | `<Komodo 서버 이름>` |
| Source | Git Repo — `github.com` / `jang2162/keyring-notes` / `main`. 비공개면 Komodo 에 등록한 `git_account` |
| File Paths | 1. `docker-compose.yml` 2. `compose.server.yaml` — **이 순서**. 뒤 파일이 앞 파일을 덮어쓴다 |
| Environment | 아래 「Stack Environment」 |
| Image registry | GHCR 패키지가 비공개면 Komodo 에 `ghcr.io` 계정(읽기 토큰)을 등록하고 Stack 에 고른다 |
| Webhook | **끔**. 이유는 아래 「배포 시점」 |
| override 파일 | `compose.server.yaml`. 호스트 `<Periphery 바인드 호스트 경로>/keyring-notes/` ↔ 컨테이너 `{stack_dir}/keyring-notes/` |

`container_name` 은 쓰지 않는다. 서버의 다른 Stack 과 이름이 겹치지 않게 compose 가 `keyring-notes-keyring-1` 처럼 붙인다.

## 배포 시점

Webhook 은 끈다. 사람이 Komodo 에서 **Deploy** 를 누른다.

- **Why:** Webhook 은 `main` 에 push 할 때마다 재배포한다. 그런데 이미지는 `v*` 태그 때만 바뀌므로 push 재배포는 같은 이미지로 컨테이너만 다시 만든다. 재배포하면 서버가 다시 떠서 편집 중인 웹 세션의 저장·앱 동기화·에이전트의 일괄 쓰기가 끊긴다.
- **How to apply:** 태그를 올리고 GitHub Actions 의 `docker` 가 끝나면 Komodo 에서 Stack 을 Deploy 한다(`docker compose pull` 뒤 `up -d`). 특정 판으로 고정하려면 Environment 의 `KEYRING_TAG` 를 `0.5.0` 처럼 바꾸고 Deploy 한다.

## Stack Environment

Komodo 는 Environment 를 `.env` 로 써서 compose 의 `${…}` 를 채운다. 컨테이너가 받는 것은 `docker-compose.yml`·`compose.server.yaml` 의 `environment:` 에 적힌 키뿐이다. 키를 더하거나 빼면 같은 커밋에서 이 표와 `.env.example` 을 고친다. Environment 를 바꾼 뒤에는 다시 Deploy 한다.

| 키 | 필수 | 설명 | 예시 |
| --- | --- | --- | --- |
| `KEYRING_PUBLIC_URL` | 필수(서버) | 밖에서 접속하는 https 주소. 이 호스트 이름만 받고 로그인 쿠키에 Secure 가 붙는다 | `https://notes.example.com` |
| `KEYRING_DATA_DIR` | 필수(서버) | 볼트·설정·백업을 둘 호스트 경로. 비우면 named volume | `/srv/keyring-notes/data` |
| `KEYRING_TAG` | 선택(`latest`) | 받을 이미지 태그 | `0.5.0` |
| `PROXY_NETWORK` | 필수(서버) | 리버스 프록시와 함께 쓰는 외부 네트워크 이름(서버에 미리 있어야 한다) | `proxy` |
| `KEYRING_ALLOWED_HOSTS` | 선택 | 받을 호스트 목록(쉼표). **정하면 이 목록만 받는다** — `KEYRING_PUBLIC_URL` 의 호스트도 함께 적는다. 비우면 그 호스트 하나 | `notes.example.com,keyring.tailnet.ts.net` |
| `KEYRING_FETCH_ALLOW_PRIVATE` | 선택(`0`) | 사설 주소 URL 수집 허용 | `1` |
| `TZ` | 선택(`Asia/Seoul`) | 정기 작업·백업 시각의 시간대 | |
| `KEYRING_S3_BUCKET` 외 `KEYRING_S3_*` | 선택 | S3 호환 저장소. 키 목록과 뜻은 `.env.example` | |
| `KEYRING_S3_ACCESS_KEY_ID` | 선택(비밀) | `[[KEYRING_S3_ACCESS_KEY_ID]]` 로 참조 | |
| `KEYRING_S3_SECRET_ACCESS_KEY` | 선택(비밀) | `[[KEYRING_S3_SECRET_ACCESS_KEY]]` 로 참조 | |
| `KEYRING_S3_ENCRYPTION_KEY` | 선택(비밀) | `[[KEYRING_S3_ENCRYPTION_KEY]]` 로 참조. 잃으면 복구할 수 없으니 Komodo 밖에도 따로 보관한다 | |

비밀값은 Komodo **Variables** 에 Secret 으로 등록하고 Environment 에는 `[[이름]]` 만 쓴다. Environment 에 평문을 쓰지 않는다.

```
KEYRING_PUBLIC_URL=https://notes.example.com
KEYRING_DATA_DIR=/srv/keyring-notes/data
PROXY_NETWORK=proxy
KEYRING_S3_SECRET_ACCESS_KEY=[[KEYRING_S3_SECRET_ACCESS_KEY]]
```

`KEYRING_DATA_DIR` 디렉터리는 컨테이너의 `node` 사용자(uid 1000)가 쓸 수 있어야 한다: `sudo install -d -o 1000 -g 1000 /srv/keyring-notes/data`.

## 서버용 덮어쓰기 파일 `compose.server.yaml`

Periphery 가 clone 한 디렉터리(호스트 `<Periphery 바인드 호스트 경로>/keyring-notes/`)에 호스트에서 직접 쓴다. 저장소는 이 이름을 ignore 하므로 커밋되지 않는다. **재 clone(Stack 을 다시 만들거나 저장소·브랜치를 바꿀 때)하면 지워진다** — 그때는 아래 내용으로 다시 쓴다.

```yaml
# compose.server.yaml — Komodo 서버에서만. 내용의 정본은 docs/guides/deploy-komodo.md
services:
  keyring:
    # 호스트 포트를 닫는다. 접속은 같은 네트워크의 리버스 프록시가 keyring:8787 로 한다
    ports: !reset []
    environment:
      KEYRING_PUBLIC_URL: ${KEYRING_PUBLIC_URL:?KEYRING_PUBLIC_URL is required}
    volumes: !override
      - ${KEYRING_DATA_DIR:?KEYRING_DATA_DIR is required}:/data
    networks: !override
      - default
      - proxy

networks:
  proxy:
    name: ${PROXY_NETWORK:?PROXY_NETWORK is required}
    external: true
```

- 리버스 프록시는 `keyring:8787` 로 넘기고 `Host` 를 그대로 전한다(받는 호스트 목록에 없으면 거절한다). `X-Forwarded-Proto: https` 도 넘긴다 — 로그인 쿠키의 Secure 와 패스키 확인이 이것을 본다.
- 서버에 프록시가 없으면 이 파일의 `networks`·`ports` 줄을 빼고 Environment 에 `COMPOSE_PROFILES=https`, `KEYRING_DOMAIN=<도메인>` 을 넣어 함께 든 Caddy(80·443)를 쓴다.
- 쓴 뒤 서버에서 결과를 확인하고 Deploy 한다. `!reset`·`!override` 는 Docker Compose 2.24.4 이상에서 읽힌다(`docker compose version`).
  ```bash
  docker compose --env-file .env -f docker-compose.yml -f compose.server.yaml config
  ```
  `keyring` 서비스에 `ports` 가 없고, `/data` 가 `KEYRING_DATA_DIR` 로, 네트워크가 `default`·프록시 둘이면 맞다.

## 처음 배포한 뒤

- 로그(Komodo 의 Stack Log 또는 `docker compose logs keyring`)의 설정 코드로 웹에서 소유자 비밀번호를 정한다.
- 관리 CLI: Komodo 의 컨테이너 터미널에서 `keyring agent list`.
- named volume 에서 `KEYRING_DATA_DIR` 로 옮길 때는 관리 콘솔에서 백업을 받고, 새 경로로 Deploy 한 뒤 복원한다.
