# Komodo Stack 으로 배포하기

[deploy-docker.md](deploy-docker.md) 의 구성을 Komodo 의 **Git Repo Stack** 으로 올리는 설정이다. 웹 서버(리버스 프록시)는 저장소가 제공하지 않으므로 Stack 에 들어 있지 않다. 프록시는 각자 따로 두고, 앱이 그 프록시의 외부 네트워크에 붙게만 한다.

## Stack 설정

| 항목 | 값 |
| --- | --- |
| Name | 정하는 대로. compose project 이름이 되어 named volume 이 `<Stack 이름>_keyring-data` 가 된다 |
| Source | Git Repo — `git_provider` `github.com` / `repo` `jang2162/keyring-notes` / `branch` `main`. 비공개 포크면 Komodo 에 등록한 `git_account` |
| File Paths | 한 줄씩 이 순서로: `docker-compose.yml`, `compose.override.yaml`. `COMPOSE_FILE` 은 넣지 않는다 |
| Environment | 아래 표 |
| Webhook | **끔.** push 마다 재배포하면 서버에서 다시 빌드하고 컨테이너를 새로 만들어 편집 중인 웹 세션·앱 동기화·에이전트 일괄 쓰기가 끊긴다. 사람이 Deploy 한다 |
| override 파일 | `compose.override.yaml` — 아래 「서버의 override 파일」 |

`container_name` 은 쓰지 않아 같은 서버의 다른 Stack 과 이름이 겹치지 않는다. 이미지는 레지스트리에서 받지 않으므로 `docker-compose.yml` 이 `pull_policy: build` 를 건다 — Deploy 할 때마다 clone 한 코드로 빌드한다.

## Environment

Komodo 는 Environment 를 `.env` 로 써서 compose 의 `${VAR}` 를 채운다. 컨테이너로 들어가는 키는 `docker-compose.yml` 의 `environment:` 에 적힌 것뿐이다. 키 전체와 뜻은 [deploy-docker.md](deploy-docker.md) 「`.env` 채우기」, 예시는 `.env.example`.

| 키 | 필수 | 비고 |
| --- | --- | --- |
| `KEYRING_PUBLIC_URL` | 필수 | 프록시 뒤에 두는 이 구성에서는 필수로 본다. 밖에서 접속하는 https 주소 |
| `PROXY_NETWORK` | 필수 | `compose.override.yaml` 이 읽는다. 프록시와 함께 쓰는 외부 네트워크 이름 |
| `KEYRING_DATA_DIR` | 권장 | 볼트·설정·백업의 호스트 경로. 미리 만든다(`sudo install -d -o 1000 -g 1000 <경로>`). 비우면 named volume |
| `KEYRING_ALLOWED_HOSTS`·`KEYRING_FETCH_ALLOW_PRIVATE`·`TZ` | 선택 | |
| `KEYRING_S3_*` | 선택 | S3 사용 시. 쓰던 S3 를 입력하거나 `COMPOSE_PROFILES=s3` 로 함께 든 SeaweedFS 를 쓴다([deploy-docker.md](deploy-docker.md) 「S3」). Environment 에 `COMPOSE_PROFILES=s3` 를 넣고 Deploy 하면 `seaweedfs` 가 더해진다(Komodo 가 쓰는 `.env` 에서 compose 가 읽는다. 안 뜨면 Stack 설정에서 프로필·서비스 지정을 확인한다) |
| `SEAWEEDFS_DATA_DIR` | 선택 | SeaweedFS 데이터의 호스트 경로(미리 만든다). 비우면 named volume `<Stack 이름>_seaweedfs-data` |
| `KEYRING_S3_ACCESS_KEY_ID`·`KEYRING_S3_SECRET_ACCESS_KEY`·`KEYRING_S3_ENCRYPTION_KEY` | 선택(비밀) | Komodo **Variables** 에 Secret 으로 등록하고 `KEYRING_S3_SECRET_ACCESS_KEY=[[KEYRING_S3_SECRET_ACCESS_KEY]]` 처럼 참조만 쓴다 |

Environment 를 바꾼 뒤에는 Deploy 를 다시 한다. 떠 있는 컨테이너의 환경은 `up` 때 정해진다.

## 서버의 override 파일

Komodo 에는 override 파일을 UI 에서 쓰는 기능이 없다. Periphery 가 clone 한 디렉터리(`{stack_dir}/{Stack 이름}/`)에 호스트에서 직접 `compose.override.yaml` 을 쓴다. 호스트 경로는 Periphery 컨테이너 정의에서 `root_directory`(기본 `/etc/komodo`)가 호스트의 어디에 바인드돼 있는지 보고 정한다. 바인드가 없으면 호스트에서 쓸 수 없으니 서버 관리자에게 묻는다.

내용은 [deploy-docker.md](deploy-docker.md) 「구성 A 의 `compose.override.yaml`」 과 같다(호스트 포트 닫기 `ports: !reset []`, 프록시 네트워크 `external: true`).

- 쓴 뒤 서버에서 `docker compose -f docker-compose.yml -f compose.override.yaml config` 로 결과를 확인하고 Deploy 한다.
- **재 clone 하면 지워진다.** Stack 을 지웠다 다시 만들거나 Stack 이름·저장소·브랜치를 바꾸면 파일이 사라지고, `File Paths` 의 파일이 없어 배포가 실패한다. 그런 변경 뒤에는 이 파일부터 확인한다. 내용은 위 문서에 있으므로 거기서 다시 쓴다.
- 저장소는 `/compose.override.yaml` 을 ignore 한다(`.gitignore`). 같은 이름의 파일을 커밋하지 않는다.
- 프록시의 외부 네트워크가 서버에 먼저 있어야 한다. 없으면 `up` 이 실패한다.
