<!-- source: docs/manual/en/how-to/deploy-with-komodo.md @ v0.9.0 -->
# Komodo 로 배포하기

[Docker 로 배포하기](deploy-with-docker.md)의 구성 A(리버스 프록시 뒤)를 Komodo 의 **Git Repo Stack** 으로 올립니다.

Komodo 와 리버스 프록시를 이미 운영하는 분을 위한 문서입니다. Stack 에는 프록시가 들어 있지 않고, 앱은 프록시의 외부 네트워크에 붙기만 합니다.

## Stack 만들기

| 항목 | 값 |
| --- | --- |
| Name | 정하는 대로. Compose 프로젝트 이름이 되므로 named volume 은 `<Stack 이름>_keyring-data` 가 됩니다 |
| Source | Git Repo: `git_provider` `github.com`, `repo` `jang2162/keyring-notes`, `branch` `main`. 비공개 포크면 Komodo 에 등록한 `git_account` |
| File Paths | 한 줄에 하나씩 이 순서로: `docker-compose.yml`, `compose.override.yaml`. `COMPOSE_FILE` 은 정하지 마세요 |
| Environment | 다음 절을 보세요 |
| Webhook | 끔. push 마다 서버에서 다시 빌드하고 컨테이너를 새로 만들어 열린 웹 세션, 앱 동기화, 에이전트 일괄 쓰기가 끊깁니다. 사람이 Deploy 하세요 |

Compose 파일은 `container_name` 을 쓰지 않으므로 같은 서버의 다른 Stack 과 이름이 겹치지 않습니다. **Deploy** 할 때마다 clone 한 코드로 이미지를 빌드합니다.

## Environment 채우기

Komodo 는 Environment 를 `.env` 로 써서 Compose 파일의 `${VAR}` 를 채웁니다. 모든 키는 [설정값](../configuration.md)에, 예시는 `.env.example` 에 있습니다.

| 키 | 필수 | 비고 |
| --- | --- | --- |
| `KEYRING_PUBLIC_URL` | 필수 | 사람들이 접속하는 https 주소 |
| `PROXY_NETWORK` | 필수 | `compose.override.yaml` 이 읽습니다. 프록시와 함께 쓰는 외부 네트워크 |
| `KEYRING_DATA_DIR` | 권장 | 볼트·설정·백업의 호스트 폴더. 먼저 만드세요: `sudo install -d -o 1000 -g 1000 <경로>`. 비우면 named volume |
| `KEYRING_ALLOWED_HOSTS`, `KEYRING_FETCH_ALLOW_PRIVATE`, `TZ` | 선택 | |
| `KEYRING_S3_*` | 선택 | 쓰던 S3 를 쓰거나, `COMPOSE_PROFILES=s3` 를 더해 함께 든 SeaweedFS 를 띄웁니다([Docker 로 배포하기](deploy-with-docker.md#s3-저장소-고르기선택) 참고). `seaweedfs` 가 뜨지 않으면 Stack 설정의 프로필·서비스 지정을 확인하세요 |
| `SEAWEEDFS_DATA_DIR` | 선택 | SeaweedFS 데이터의 호스트 폴더. 먼저 만드세요. 비우면 named volume `<Stack 이름>_seaweedfs-data` |
| `KEYRING_S3_ACCESS_KEY_ID`, `KEYRING_S3_SECRET_ACCESS_KEY`, `KEYRING_S3_ENCRYPTION_KEY` | 선택(비밀) | Komodo **Variables** 에 비밀로 등록하고 참조만 쓰세요. 예: `KEYRING_S3_SECRET_ACCESS_KEY=[[KEYRING_S3_SECRET_ACCESS_KEY]]` |

Environment 를 바꾼 뒤에는 다시 Deploy 하세요. 떠 있는 컨테이너는 시작할 때의 환경을 그대로 씁니다.

## 서버에 override 파일 쓰기

Komodo 에는 override 파일을 쓰는 화면이 없습니다. Periphery 가 Stack 을 clone 한 폴더(`{stack_dir}/{Stack 이름}/`)에 호스트에서 `compose.override.yaml` 을 쓰세요. 호스트 경로는 Periphery 컨테이너 정의에서 Periphery 의 `root_directory`(기본 `/etc/komodo`)가 호스트의 어디에 바인드돼 있는지 보고 찾습니다. 바인드돼 있지 않으면 서버 관리자에게 물으세요.

내용은 [구성 A](deploy-with-docker.md#구성-a-리버스-프록시-뒤)와 같습니다. `ports: !reset []` 로 호스트 포트를 닫고, 프록시 네트워크에 `external: true` 로 붙습니다.

1. 파일을 쓰고 서버에서 결과를 확인하세요.

   ```bash
   docker compose -f docker-compose.yml -f compose.override.yaml config
   ```

2. Komodo 에서 **Deploy** 를 누르세요.

> [!WARNING]
> 새로 clone 하면 이 파일이 지워집니다. Stack 을 지웠다가 다시 만들거나 Stack 이름·저장소·브랜치를 바꾸면 `compose.override.yaml` 이 사라지고, File Paths 의 파일이 없어 배포가 실패합니다. 그런 변경 뒤에는 이 파일부터 다시 쓰세요.

- 저장소는 `/compose.override.yaml` 을 무시합니다. 같은 이름의 파일을 커밋하지 마세요.
- 프록시의 외부 네트워크가 배포 전에 있어야 합니다. 없으면 `up` 이 실패합니다.

## 다음 단계

- [서버 관리하기](manage-the-server.md)
- [백업과 복원](back-up-and-restore.md)
