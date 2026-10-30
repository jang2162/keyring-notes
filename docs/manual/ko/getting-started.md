<!-- source: docs/manual/en/getting-started.md @ v0.10.0 -->
# 시작하기

빈 컴퓨터에서 Keyring Notes 의 첫 노트를 쓰기까지 안내하고, 에이전트를 들이는 방법까지 보입니다.

Docker 로 서버를 직접 운영하는 분을 위한 문서입니다.

## 시작하기 전에

필요한 것:

- Git
- Docker Compose v2 와 BuildKit(`docker buildx` 플러그인)이 있는 Docker. Docker Desktop 에는 둘 다 들어 있습니다.

## 1. 서버 띄우기

저장소를 받고 컨테이너를 띄우세요.

```bash
git clone https://github.com/jang2162/keyring-notes && cd keyring-notes
docker compose up -d --build
```

이 명령은 저장소 코드로 이미지를 빌드합니다. 받아 올 미리 만든 이미지는 없습니다.

서버가 응답하는지 확인하세요.

```bash
curl http://127.0.0.1:8787/api/health
```

```text
{"ok":true}
```

포트는 `127.0.0.1` 에만 열리므로 이 컴퓨터에서만 접속할 수 있습니다. 다른 기기에서 쓰려면 [Docker 로 배포하기](how-to/deploy-with-docker.md)를 보세요.

## 2. 설정 코드 찾기

서버는 처음 시작할 때 로그에 일회용 설정 코드를 남깁니다.

```bash
docker compose logs keyring
```

```text
keyring-1  | Index synced: 0 updated, 0 removed, 0 wiki topics (20ms)
keyring-1  | keyring-notes: http://0.0.0.0:8787  (vault: /data/vault, config: /data/config/keyring.json)
keyring-1  | MCP: http://0.0.0.0:8787/mcp  (Authorization: Bearer <agent token>)
keyring-1  | Backups: /data/backups
keyring-1  |
keyring-1  | First run: set a password in the web app with this setup code → 4248-441D-E87C
keyring-1  | (or `pnpm keyring passwd`; with Docker, `docker compose exec keyring keyring passwd`)
```

코드는 실행할 때마다 다릅니다. 서버 언어를 정하기 전에는 `KEYRING_LANG` 이나 `LANG` 이 다른 언어를 가리키지 않는 한 로그가 영어로 나옵니다.

## 3. 비밀번호 정하기

1. 브라우저에서 `http://127.0.0.1:8787` 을 여세요.
2. 설정 코드를 넣고, 8자 이상의 새 비밀번호를 두 번 넣으세요.
3. **비밀번호 정하고 시작**을 누르세요.

로그인되고, 홈 화면에 **먼저 워크스페이스를 만드세요.** 가 보입니다.

## 4. 워크스페이스 만들기

노트는 볼트의 맨 위 노드인 워크스페이스 안에 둡니다(예: `업무`, `개인`).

1. 홈 화면의 **새 워크스페이스**를 누르세요. 설정이 **워크스페이스** 묶음으로 열립니다.
2. **+ 새 워크스페이스**를 누르고 `업무` 를 입력한 뒤 Enter 를 누르세요.
3. Esc 를 눌러 설정을 닫으세요.

## 5. 첫 노트 쓰기

1. **새 노트**를 누르세요(또는 `Alt+N`). "제목 없음" 노트가 열리고 커서가 제목 칸에 있습니다.
2. `첫 노트` 를 입력하고 Enter 를 누르세요. 노트 이름이 바뀌고 커서가 본문으로 갑니다.
3. 본문을 입력하세요. 입력을 멈추고 1.5초쯤 지나면 상태 표시줄에 **저장됨**이 보입니다.

이제 이 노트는 볼트의 `업무/첫 노트.md` 파일이고, 첫 버전이 볼트의 Git 이력에 남아 있습니다.

## 6. 에이전트 연결하기(선택)

에이전트는 폴더별 권한이 있는 토큰으로만 볼트에 닿습니다.

1. 토큰을 발급하세요.

   ```bash
   docker compose exec keyring keyring agent add my-agent
   ```

   ```text
   Token for my-agent (save it now; it cannot be shown again):

     <token>

   No permissions yet. Example: pnpm keyring agent grant my-agent work/wiki write
   ```

2. 에이전트에게 폴더 권한을 주세요.

   ```bash
   docker compose exec keyring keyring agent grant my-agent 업무 read
   ```

   ```text
   my-agent  (created: 2026-10-20)
       read    업무
   ```

3. MCP 클라이언트를 `http://127.0.0.1:8787/mcp` 에 연결하고 헤더 `Authorization: Bearer <YOUR_AGENT_TOKEN>` 을 주세요.

브라우저의 설정 → **에이전트·권한**에서도 같은 일을 할 수 있습니다.

## 다음 단계

- [노트 정리하기](how-to/organize-notes.md): 노드, 워크스페이스, 노트 트리
- [에이전트 연결하기](how-to/connect-agents.md): 권한 단계와 MCP 설정
- [백업과 복원](how-to/back-up-and-restore.md): 볼트에 기대기 전에 지켜 두기
