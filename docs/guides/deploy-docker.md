# Docker 배포 구성 바꾸기

`Dockerfile`·`docker-compose.yml`·`.env.example`·배포용 환경 변수를 바꾸는 사람이 지킬 규칙이다. 운영자가 따라 하는 배포 절차는 사용자 문서 `docs/manual/en/how-to/deploy-with-docker.md`(번역 `docs/manual/ko/how-to/deploy-with-docker.md`)에, 환경 변수와 `.env` 키 표는 `docs/manual/en/configuration.md`(번역 `docs/manual/ko/configuration.md`)에 있다.

## 저장소가 갖는 것과 갖지 않는 것

- `docker-compose.yml` 은 앱(`keyring`)과, 꺼져 있는 `s3` 프로필의 SeaweedFS 만 갖는다. 이것만으로 로컬에서 돈다.
- **웹 서버(리버스 프록시)는 넣지 않는다.** 운영자마다 쓰는 프록시가 다르다. 그 서버에서만 필요한 설정(호스트 포트 닫기, 프록시 네트워크)은 운영자가 서버에서 `compose.override.yaml` 로 쓰고, 저장소는 그 파일을 ignore 한다. 기본 compose 파일에 특정 서버의 설정을 넣지 않는다.
- **이미지는 게시하지 않는다.** `pull_policy: build` 로 서버가 `up` 할 때마다 저장소 코드로 빌드한다. 레지스트리 이미지를 들이면 업데이트 절차(`git pull && docker compose up -d --build`)와 사용자 문서가 함께 바뀌어야 한다.
- `Dockerfile` 은 BuildKit 기능(`RUN --mount=type=secret,id=extra_ca`)을 쓴다. 그래서 사용자 문서의 요구 사항에 BuildKit(buildx)이 있고, buildx 가 없을 때의 증상은 `troubleshooting.md` 에 있다. 이 기능을 빼거나 더하면 그 두 자리도 고친다.

## 컨테이너에 넘기는 환경 변수를 바꿀 때

compose 의 `environment:` 에 적힌 키만 컨테이너에 들어간다. 키를 더하거나 빼면 **같은 커밋에서** 다음을 함께 고친다.

- `docker-compose.yml` 의 `environment:`
- `.env.example`
- `docs/manual/en/configuration.md` 와 `docs/manual/ko/configuration.md` 의 표와 「Which variables reach the container」·「컨테이너에 넘어가는 변수」 절

하나라도 빠지면 운영자가 `.env` 에 적은 값이 경고 없이 컨테이너에 닿지 않는다.

### 빈 값을 넘기는 두 방식

- `${X:-}` 는 `.env` 에 없는 키도 빈 문자열로 넘긴다. 서버가 빈 값을 「없음」과 같게 읽는 키에 쓴다.
- 서버가 빈 값을 「없음」과 다르게 읽는 키(`KEYRING_UPDATE_URL` 은 빈 값이면 업데이트 확인을 끈다, `KEYRING_LANG` 은 빈 값이면 `LANG` 으로 넘어가지 않는다)는 값 없이(`KEYRING_LANG:`) 적어 `.env` 에 없으면 넘기지 않는다.

키를 더할 때는 서버 코드가 빈 값을 어떻게 읽는지 보고 둘 중 하나를 고른다.

### 컨테이너에 넘기지 않는 서버 변수

- `KEYRING_DATA`·`KEYRING_HOST`·`KEYRING_PORT`·`KEYRING_WEB_DIST` 는 Dockerfile 이 정한다.
- `KEYRING_VAULT`·`KEYRING_CONFIG`·`KEYRING_BACKUP_DIR`·`KEYRING_PLUGINS_DIR`·`KEYRING_INDEX` 는 `/data` 아래로 정해진다.
- `KEYRING_PASSWORD` 는 CLI 전용이다.
- `.env` 의 `KEYRING_PORT` 는 호스트 쪽 포트일 뿐이다.

## 함께 든 SeaweedFS

`s3` 프로필을 켰는데 키·비밀번호·버킷 이름이 하나라도 비어 있으면 `seaweedfs` 컨테이너가 이유를 로그에 남기고 종료한다. 이 검사가 없으면 SeaweedFS 는 인증 없이 모두 허용하는 모드로 뜬다. compose 의 `:?` 는 꺼진 프로필에서도 평가되므로 쓰지 않고 entrypoint 에서 직접 검사한다. 이 검사를 걷지 않는다.
