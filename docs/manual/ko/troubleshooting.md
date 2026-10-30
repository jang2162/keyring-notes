<!-- source: docs/manual/en/troubleshooting.md @ v0.10.0 -->
# 문제 해결

실제로 겪은 문제를 원인과 해결 방법과 함께 모았습니다.

서버를 설치하거나 운영하는 분을 위한 문서입니다.

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

## 다음 단계

- [시작하기](getting-started.md)
- [Docker 로 배포하기](how-to/deploy-with-docker.md)
