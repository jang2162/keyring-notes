<!-- source: docs/manual/en/troubleshooting.md @ v0.12.0 -->
# 문제 해결

실제로 겪은 문제를 원인과 해결 방법과 함께 모았습니다.

서버를 설치하거나 운영하는 분과 앱에서 노트를 쓰는 분을 위한 문서입니다.

## `docker compose up --build` 가 "the --mount option requires BuildKit" 로 실패합니다

**증상.** 빌드가 `RUN --mount=type=secret,…` 단계에서 멈춥니다.

```text
the --mount option requires BuildKit. Refer to https://docs.docker.com/go/buildkit/ to learn how to build images with BuildKit enabled
```

**원인.** Dockerfile 이 BuildKit 기능을 쓰는데 Docker CLI 에 buildx 플러그인이 없어 예전 빌더로 빌드했습니다. 플러그인이 없으면 `DOCKER_BUILDKIT=1` 을 줘도 소용없습니다. 예를 들어 Homebrew 의 `docker` CLI 와 Colima 조합은 buildx 를 설치하지 않습니다.

**해결.**

1. 쓰는 플랫폼에 맞는 Docker buildx 플러그인을 설치하세요. Docker Desktop 에는 이미 들어 있습니다.
2. 플러그인이 잡히는지 확인하세요.

   ```bash
   docker buildx version
   ```

   `github.com/docker/buildx v0.38.0` 같은 판 정보가 나와야 합니다. `unknown command` 가 나오면 Docker CLI 가 찾는 폴더에 플러그인이 없는 것입니다.

3. `docker compose up -d --build` 를 다시 실행하세요.

## 미리보기 자리에 "이 노트를 그리지 못했습니다" 가 보입니다

**증상.** **미리보기**나 **나란히**에서 한 노트의 미리보기 자리에 아래 안내와 **다시 시도** 단추, 그리고 노트의 원문이 보입니다.

```text
이 노트를 그리지 못했습니다. 아래에 원문을 그대로 보여 줍니다.
```

편집기와 다른 탭, 사이드바는 그대로 동작합니다. **휴지통**에서 지운 노트를 미리 볼 때도 같은 안내가 나올 수 있습니다. Live Preview 를 켠 **편집**에서는 그리지 못한 블록이 원문 글자로 남습니다.

**원인.** 노트의 글 가운데 무언가가 미리보기를 그리는 도중에 오류를 일으켰습니다. 노트는 손상되지 않았고 저장하지 않은 변경도 남아 있습니다.

**해결.**

1. 노트를 **편집**으로 바꾸세요.
2. 마지막에 넣은 부분이나, 깨진 링크·원시 HTML 처럼 평소와 다른 부분을 고치거나 지우세요. 글이 바뀌면 미리보기를 다시 그립니다.
3. 글에 이상이 없어 보이면 **다시 시도**를 누르세요. 그래도 실패하면 브라우저 콘솔을 열어 `keyring: note render failed` 로 시작하는 줄을 복사하세요. 문제를 알릴 때 그 줄과 노트의 글을 함께 보내세요.

## 다음 단계

- [시작하기](getting-started.md)
- [Docker 로 배포하기](how-to/deploy-with-docker.md)
