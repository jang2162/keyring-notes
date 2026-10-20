<!-- source: README.md @ v0.8.5 -->
<p align="center"><a href="README.md">English</a> | <b>한국어</b></p>

<h1 align="center">Keyring Notes</h1>

<p align="center">AI 에이전트와 함께 일하는 사람을 위한 셀프호스팅 마크다운 노트: Git 에 담긴 평범한 파일을 폴더별 권한으로 나눠 줍니다.</p>

<p align="center">
  <a href="https://github.com/jang2162/keyring-notes/releases/latest"><img src="https://img.shields.io/github/v/release/jang2162/keyring-notes" alt="최신 릴리스"></a>
  <a href="https://github.com/jang2162/keyring-notes/actions/workflows/release-macos.yml"><img src="https://img.shields.io/github/actions/workflow/status/jang2162/keyring-notes/release-macos.yml?label=macOS%20release" alt="macOS 릴리스 빌드"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/jang2162/keyring-notes" alt="라이선스"></a>
</p>

<p align="center">
  <img src="docs/manual/images/ko/projects-kanban-board.png" width="800" alt="브라우저에서 연 Keyring Notes: 왼쪽에 노트 트리, 가운데에 프로젝트 카드를 칸반 보드로 보이는 프로젝트 노트">
</p>

## 소개

대부분의 노트 앱은 노트를 자기 형식에 담고, AI 에이전트에게는 전부를 주거나 아무것도 주지 않습니다. Keyring Notes 는 모든 노트를 내 서버의 Git 볼트에 평범한 마크다운 파일로 둡니다. 사람은 브라우저나 데스크톱 앱에서 쓰고, 에이전트는 허락한 폴더만 보이는 토큰으로 MCP 나 REST API 를 통해 들어옵니다. 볼트는 Obsidian 식 마크다운이라 다른 편집기에서도 그대로 열립니다. 노트를 직접 운영하면서 그 일부를 에이전트가 안전하게 읽고 가꾸게 하려는 분을 위한 프로젝트입니다.

## 주요 기능

- 브라우저나 데스크톱 앱에서 평범한 마크다운을 쓰고, 모든 변경을 Git 이력에 남깁니다.
- AI 에이전트마다 고른 폴더와 권한 단계로만 제한된 토큰을 줍니다.
- 에이전트의 변경을 볼트에 들어가기 전에 검토합니다.
- 웹 페이지와 PDF 를 모아 에이전트가 출처를 달아 관리하는 LLM Wiki 로 만듭니다.
- 위젯 블록으로 노트를 살아 있는 표, 칸반 보드, 차트로 보입니다.
- 데스크톱 앱을 서버 없이 쓰고, 원할 때 서버와 동기화합니다.
- S3 호환 저장소에 올리기 전에 암호화해 백업합니다.

## 설치

요구 사항: Git, 그리고 Compose v2 와 BuildKit(`docker buildx` 플러그인, Docker Desktop 에 포함)이 있는 Docker.

```bash
git clone https://github.com/jang2162/keyring-notes && cd keyring-notes
docker compose up -d --build
```

서버가 응답하는지 확인하세요.

```bash
curl http://127.0.0.1:8787/api/health
```

```text
{"ok":true}
```

포트는 `127.0.0.1` 에만 열려 이 컴퓨터에서만 접속할 수 있습니다. 다른 기기에서 접속하려면 [Docker 로 배포하기](docs/manual/ko/how-to/deploy-with-docker.md)를 보세요. [소스에서 실행](docs/manual/ko/how-to/run-from-source.md)하거나 서버 없이 [데스크톱 앱을 쓸](docs/manual/ko/how-to/use-the-desktop-app.md) 수도 있습니다.

## 빠른 시작

1. 서버 로그에서 일회용 설정 코드를 찾으세요.

   ```bash
   docker compose logs keyring
   ```

   ```text
   keyring-1  | First run: set a password in the web app with this setup code → 4248-441D-E87C
   ```

2. `http://127.0.0.1:8787` 을 열고 설정 코드와 새 비밀번호를 넣은 뒤 **비밀번호 정하고 시작**을 누르세요.
3. **새 워크스페이스**, 이어서 **+ 새 워크스페이스**를 누르고 `업무` 를 입력한 뒤 Enter 를 누르세요. Esc 를 누르고 **새 노트**를 눌러 제목을 입력하고 쓰기 시작하세요.

상태 표시줄에 **저장됨**이 보이고, 노트는 `업무/` 안의 마크다운 파일이 되어 볼트 이력에 첫 커밋이 남습니다.

## 문서

- [시작하기](docs/manual/ko/getting-started.md)
- [방법 안내](docs/manual/ko/how-to/): 노트 정리, 에이전트 연결, LLM Wiki, 백업 등
- [설정값](docs/manual/ko/configuration.md): 환경 변수와 `.env` 키
- [참조](docs/manual/ko/reference.md): CLI, MCP 도구, REST API, 파일 형식, 단축키
- [문제 해결](docs/manual/ko/troubleshooting.md)

## 라이선스

MIT License. 자세한 내용은 [LICENSE](LICENSE)를 보세요.
