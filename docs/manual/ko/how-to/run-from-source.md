# 소스에서 실행하기

Docker 없이 소스 체크아웃에서 바로 서버를 띄웁니다.

자기 컴퓨터에서 Keyring Notes 를 써 보거나 기존 Obsidian 볼트를 열어 보려는 분을 위한 문서입니다.

## 요구 사항

- Node.js 22.13 이상. `mise.toml` 은 Node 24 로 고정합니다.
- `package.json` 의 `packageManager` 에 적힌 판의 pnpm.

[mise](https://mise.jdx.dev)를 쓰면 `mise install` 이 `mise.toml` 대로 두 판을 맞춥니다. mise 가 없으면 `corepack enable` 을 실행하세요.

## 빌드하고 띄우기

```bash
pnpm install
pnpm build
pnpm start
```

`pnpm build` 는 `packages/core/dist`, `web/dist`, `server/dist` 를 만듭니다. `pnpm start` 는 `http://127.0.0.1:8787` 을 열고, 처음 실행하면 설정 코드를 보입니다.

```text
First run: set a password in the web app with this setup code → 5A85-1933-717B
(or `pnpm keyring passwd`; with Docker, `docker compose exec keyring keyring passwd`)
```

주소를 열고 코드를 넣은 뒤 비밀번호를 정하세요. 터미널에서 비밀번호를 정하려면 `pnpm keyring passwd` 를 실행하세요.

볼트·설정·백업은 기본으로 `./vault`, `./config/keyring.json`, `./backups` 에 갑니다. 셋을 한 폴더 아래에 두려면 `KEYRING_DATA` 를 정하세요. 나머지 변수는 [설정값](../configuration.md)에 있습니다.

## Obsidian 볼트로 시험하기

원본 볼트를 건드리지 않도록 **복사본**을 만드세요.

```bash
cp -R ~/ObsidianVault /tmp/vault-copy
KEYRING_VAULT=/tmp/vault-copy pnpm start
```

서버는 시작할 때 볼트에 이미 있던 파일을 `system` 작성자의 커밋 하나로 남깁니다. 이후 서버 밖에서 고친 내용도 다음 시작 때 같은 방식으로 남깁니다.

## 다음 단계

- [시작하기](../getting-started.md): 첫 워크스페이스와 노트
- [노트 정리하기](organize-notes.md)
