# post-checkout

## post-checkout 은 런타임을 맞춘 뒤에 의존성을 설치한다 — `parallel: true` 를 쓰지 않는다

런타임 관리자(mise 등)의 설치 잡을 첫 잡으로 두고, 의존성 설치 잡을 그 뒤에 **순차로** 둔다.

- **Why:** 병렬로 돌거나 순서가 뒤집히면, 의존성 설치가 그 브랜치가 요구하는 런타임이 아니라 **지금 PATH 에 있는 런타임**으로 돈다.
- **How to apply:**
  ```yaml
  # 순차 실행이다 — 런타임이 맞은 뒤에 설치가 돌아야 한다.
  post-checkout:
    piped: true
    jobs:
      - name: runtime
        run: "[ '{3}' = 1 ] || exit 0; if command -v mise >/dev/null; then mise trust && mise install; else echo 'mise 가 없어 런타임 버전을 맞추지 못했다'; fi"
      - name: deps
        run: "[ '{3}' = 1 ] || exit 0; pnpm install"
  ```
  - 새 워크트리의 `mise.toml` 은 아직 신뢰되지 않아 `mise install` 만 부르면 바로 실패한다. `mise trust` 를 먼저 부른다.
  - 런타임 관리자가 없는 환경에서는 첫 잡이 **안내만 찍고 넘어가게** 한다.
  - `piped: true` 를 둔다. 순차 실행만으로는 앞 잡이 실패해도 다음 잡이 돈다 — 런타임 설치가 실패한 채 지금 PATH 의 런타임으로 의존성이 깔린다. `piped` 면 첫 실패에서 나머지를 건너뛴다.
  - 잡마다 `[ '{3}' = 1 ] || exit 0` 으로 **브랜치 체크아웃일 때만** 돌게 한다. git 은 파일 체크아웃(`git checkout -- <파일>`)에도 post-checkout 을 부르고 세 번째 인자로 `0` 을 준다(브랜치 체크아웃과 `git worktree add` 는 `1`). 가드가 없으면 파일 하나를 되돌릴 때마다 의존성 설치가 돈다.
