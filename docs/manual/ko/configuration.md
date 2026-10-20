# 설정값

서버가 읽는 환경 변수와 Docker Compose `.env` 파일이 받는 키를 모두 모았습니다.

서버를 운영하는 분을 위한 문서입니다. 볼트에 저장되는 설정(테마, 볼트 언어, 데일리 노트 등)은 [설정 바꾸기](how-to/customize-settings.md)에 있습니다.

## 서버 환경 변수

`pnpm start` 의 환경에 두거나, Docker Compose 를 쓰면 `.env` 에 두세요. Docker 에서는 [컨테이너에 넘어가는 변수](#컨테이너에-넘어가는-변수)에 적힌 것만 컨테이너에 들어갑니다.

| 변수 | 형식 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `KEYRING_DATA` | 경로 | (없음, Docker 는 `/data`) | 정하면 볼트·설정·백업이 `<DATA>/vault`, `<DATA>/config/keyring.json`, `<DATA>/backups` 로 갑니다 |
| `KEYRING_VAULT` | 경로 | `./vault` | 볼트 폴더 |
| `KEYRING_CONFIG` | 경로 | `./config/keyring.json` | 비밀번호 해시, 에이전트 토큰 해시, 권한 표, 백업 설정. 볼트 밖에 두세요 |
| `KEYRING_BACKUP_DIR` | 경로 | `./backups` | 백업 파일 폴더 |
| `KEYRING_INDEX` | 경로 | `<볼트>/.keyring/index.db` | 검색 인덱스. 캐시라서 지우면 다음 시작 때 다시 만듭니다 |
| `KEYRING_PLUGINS_DIR` | 경로 | `./plugins`(Docker 는 `/data/plugins`) | 위젯 플러그인 폴더 |
| `KEYRING_HOST` | 주소 | `127.0.0.1` | 바인드 주소 |
| `KEYRING_PORT` | 숫자 | `8787` | 포트 |
| `KEYRING_PUBLIC_URL` | URL | (없음) | 접속하는 https 주소. 이 호스트 이름으로 온 요청만 받고, 로그인 쿠키에 `Secure` 가 붙습니다 |
| `KEYRING_ALLOWED_HOSTS` | 목록 | `KEYRING_PUBLIC_URL` 의 호스트 | 받을 호스트 이름(쉼표로 여럿). 정하면 이 목록만 받으므로 `KEYRING_PUBLIC_URL` 의 호스트도 함께 적으세요. `localhost` 는 늘 받습니다 |
| `KEYRING_LANG` | `en`·`ko` | `LANG` 을 따름 | 서버 언어: 서버 오류 글, 로그, CLI, 볼트 언어를 정하기 전의 볼트 글. 설정 → **언어** → **서버 언어**에서 정한 값이 먼저입니다 |
| `KEYRING_UPDATE_URL` | URL | GitHub `releases/latest` | 업데이트 확인 주소. 빈 값이면 확인하지 않습니다 |
| `KEYRING_BACKUP_SCHEDULER` | `0`·`1` | `1` | `0` 이면 자동 백업을 끕니다 |
| `KEYRING_SCHEDULER` | `0`·`1` | `1` | `0` 이면 정기 작업(웹훅)을 끕니다 |
| `KEYRING_FETCH_ALLOW_PRIVATE` | `0`·`1` | (없음) | `1` 이면 URL 수집이 사내 위키 같은 사설·루프백 주소에도 닿습니다. 서버 측 요청 위조(SSRF)를 막으려고 기본은 막혀 있습니다 |
| `KEYRING_EMBED_URL` | URL | (없음) | 의미 검색용 OpenAI 호환 `/embeddings` 주소. `KEYRING_EMBED_MODEL` 도 있어야 합니다 |
| `KEYRING_EMBED_MODEL` | 글 | (없음) | 임베딩 모델 이름 |
| `KEYRING_EMBED_KEY` | 비밀 | (없음) | 임베딩 API 키. `Authorization: Bearer` 로 보냅니다 |
| `KEYRING_S3_BUCKET` | 글 | (없음) | S3 호환 저장소 버킷. 키와 함께 정하면 원격 백업이 켜집니다 |
| `KEYRING_S3_ACCESS_KEY_ID` | 비밀 | (없음) | 접근 키 ID. `AWS_ACCESS_KEY_ID` 도 읽습니다 |
| `KEYRING_S3_SECRET_ACCESS_KEY` | 비밀 | (없음) | 비밀 접근 키. `AWS_SECRET_ACCESS_KEY` 도 읽습니다 |
| `KEYRING_S3_REGION` | 글 | `us-east-1` | 리전. Cloudflare R2 는 `auto`. `AWS_REGION` 도 읽습니다 |
| `KEYRING_S3_ENDPOINT` | URL | AWS S3 | R2·MinIO 같은 다른 저장소의 주소. 정하면 경로 방식 주소를 씁니다 |
| `KEYRING_S3_PATH_STYLE` | `0`·`1` | `KEYRING_S3_ENDPOINT` 가 있으면 `1` | 경로 방식 주소 |
| `KEYRING_S3_PREFIX` | 글 | `keyring/` | 버킷 안 키의 앞부분 |
| `KEYRING_S3_BLOBS` | `0`·`1` | `0` | `1` 이면 큰 첨부를 Git 대신 S3 에 둡니다 |
| `KEYRING_S3_BLOB_MIN_KB` | 숫자 | `256` | `KEYRING_S3_BLOBS` 의 기준 크기(KB) |
| `KEYRING_S3_ENCRYPTION_KEY` | 비밀 | (없음) | 정하면 올리기 전에 백업과 첨부를 암호화합니다. 잃으면 암호화한 것은 열 수 없습니다 |
| `KEYRING_S3_ENCRYPTION_KEY_FILE` | 경로 | (없음) | 암호화 키를 이 파일에서 읽습니다. Docker 에서는 컨테이너 안 경로라서 `/data` 아래에 두세요 |

`KEYRING_PASSWORD` 는 CLI 만 읽습니다.

## Docker Compose `.env` 키

`docker-compose.yml` 이 `.env` 에서 읽는 키입니다. `.env.example` 을 `.env` 로 복사해 고치세요.

| 키 | 기본값 | 설명 | 예 |
| --- | --- | --- | --- |
| `COMPOSE_FILE` | `docker-compose.yml` | 겹쳐 쓸 compose 파일(`:` 로 이음) | `docker-compose.yml:compose.override.yaml` |
| `KEYRING_BIND` | `127.0.0.1` | 포트를 여는 호스트 주소 | `100.64.0.10` |
| `KEYRING_PORT` | `8787` | 호스트 포트. 컨테이너 안에서는 늘 `8787` 로 받습니다 | |
| `KEYRING_DATA_DIR` | named volume `keyring-data` | 볼트·설정·백업을 둘 호스트 폴더. 먼저 만드세요: `sudo install -d -o 1000 -g 1000 <경로>` | `/srv/keyring-notes/data` |
| `PROXY_NETWORK` | (없음) | 리버스 프록시와 함께 쓰는 외부 네트워크. 예시 `compose.override.yaml` 이 읽습니다 | |
| `TZ` | `Asia/Seoul` | 정기 작업과 자동 백업 시각의 시간대 | `Europe/Berlin` |
| `COMPOSE_PROFILES` | (없음) | `s3` 면 함께 든 SeaweedFS 도 띄웁니다 | `s3` |
| `SEAWEEDFS_DATA_DIR` | named volume `seaweedfs-data` | SeaweedFS 데이터의 호스트 폴더 | `/srv/keyring-notes/seaweedfs` |
| `SEAWEEDFS_IMAGE` | `chrislusf/seaweedfs` | SeaweedFS 이미지. 판을 고정할 때 씁니다 | |

### 컨테이너에 넘어가는 변수

`docker-compose.yml` 의 `environment:` 에 적힌 키만 컨테이너에 들어갑니다.

- `KEYRING_PUBLIC_URL`, `KEYRING_ALLOWED_HOSTS`, `KEYRING_FETCH_ALLOW_PRIVATE`
- 위 표의 모든 `KEYRING_S3_*` 변수
- `KEYRING_EMBED_URL`, `KEYRING_EMBED_MODEL`, `KEYRING_EMBED_KEY`
- `KEYRING_SCHEDULER`, `KEYRING_BACKUP_SCHEDULER`
- `KEYRING_UPDATE_URL`, `KEYRING_LANG`(빈 값과 없는 값의 뜻이 달라서 `.env` 에 있을 때만 넘깁니다)
- `TZ`

`KEYRING_DATA`, `KEYRING_HOST`, `KEYRING_PORT` 는 이미지가 정하고, 볼트·설정·백업·플러그인·인덱스 경로는 모두 `/data` 아래입니다.

> [!NOTE]
> 컨테이너 안의 `localhost` 는 컨테이너 자신입니다. 호스트에서 도는 모델을 `KEYRING_EMBED_URL` 로 가리키려면 호스트의 주소를 쓰세요.

## 다음 단계

- [Docker 로 배포하기](how-to/deploy-with-docker.md): 이 키들을 서버에 적용하기
- [백업과 복원](how-to/back-up-and-restore.md): S3 저장소와 암호화 자세히
