# Komodo Stack 구성 바꾸기

Komodo 의 **Git Repo Stack** 으로 올리는 구성(Stack 설정·Environment·서버의 override 파일)을 만들거나 바꾸는 사람이 지킬 규칙이다. 운영자가 따라 하는 절차는 사용자 문서 `docs/manual/en/how-to/deploy-with-komodo.md`(번역 `docs/manual/ko/how-to/deploy-with-komodo.md`)에 있고, 그 바탕인 Docker 구성의 규칙은 [deploy-docker.md](deploy-docker.md)에 있다.

## Stack 은 프록시를 갖지 않는다

웹 서버(리버스 프록시)는 저장소가 제공하지 않으므로 Stack 에도 없다. 앱은 프록시의 외부 네트워크에 붙기만 하고, 그 설정은 서버의 `compose.override.yaml` 에 있다.

## Webhook 은 끈다

push 마다 재배포하면 서버에서 다시 빌드하고 컨테이너를 새로 만들어 편집 중인 웹 세션·앱 동기화·에이전트 일괄 쓰기가 끊긴다. 사람이 Deploy 한다.

## `container_name` 을 쓰지 않는다

같은 서버의 다른 Stack 과 컨테이너 이름이 겹치지 않게 하려는 것이다. compose project 이름(Stack 이름)이 컨테이너·named volume 이름을 가른다.

## File Paths 로 파일을 겹치고 `COMPOSE_FILE` 은 쓰지 않는다

File Paths 는 한 줄씩 `docker-compose.yml`, `compose.override.yaml` 순서다. 뒤 파일이 앞 파일을 덮으므로 순서가 바뀌면 덮어쓰기가 지워진다. Environment 에 `COMPOSE_FILE` 은 넣지 않는다.

## 서버의 override 파일은 재 clone 에 지워진다

Komodo 에는 override 파일을 UI 에서 쓰는 기능이 없어 운영자가 Periphery 의 clone 디렉터리에 직접 쓴다. Stack 을 지웠다 다시 만들거나 Stack 이름·저장소·브랜치를 바꾸면 그 파일이 사라지고 배포가 실패한다. 이 구성을 바꾸는 변경을 내면 사용자 문서의 해당 경고와 override 예시도 함께 맞춘다.
