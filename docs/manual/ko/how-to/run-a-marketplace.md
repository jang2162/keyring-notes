<!-- source: docs/manual/en/how-to/run-a-marketplace.md @ v0.12.0 -->
# 내 마켓플레이스 운영하기

마켓 저장소를 Docker 로 띄우고 Keyring Notes 에 더하는 방법입니다.

자기 위젯·테마·언어를 공개로 또는 집 안 네트워크에서 나누는 분을 위한 문서입니다.

> [!NOTE]
> 앱에서 내 저장소의 패키지를 설치하는 방법은 [패키지 설치하기](install-packages.md)를 보세요.

패키지 자체를 만드는 방법은 [마켓 패키지 올리기](publish-packages.md)에 있습니다.

## 올릴 곳 고르기

저장소는 정적 파일 폴더라 두 가지 중에서 고릅니다.

- **아무 정적 호스팅.** 폴더에서 `pkg index` 를 실행한 뒤 올립니다. [저장소 올리기](publish-packages.md#저장소-올리기)를 보세요.
- **마켓 서버 이미지.** `index.json` 을 스스로 다시 만들고 알맞은 헤더로 파일을 내줍니다. 이 문서의 나머지는 이것을 씁니다.

## 준비물

- Compose v2 와 BuildKit(`docker buildx`)이 있는 Docker. [Docker 로 배포하기](deploy-with-docker.md)와 같습니다.
- 이 저장소의 클론. 이미지를 소스로 빌드합니다.

## 서버 띄우기

1. 패키지를 `packages/<scope>/<name>/<version>/` 꼴의 폴더에 둡니다.

2. 예시 설정을 복사해 엽니다.

   ```bash
   cp marketplace/.env.example marketplace/.env
   ```

3. `marketplace/compose.override.yaml` 을 만들고, 내 폴더를 이미지에 든 패키지 위에 마운트합니다.

   ```yaml
   services:
     market:
       volumes:
         - /srv/my-market/packages:/srv/market/packages:ro
   ```

4. 서버를 띄웁니다.

   ```bash
   docker compose -f marketplace/compose.yaml up -d --build
   ```

5. `http://127.0.0.1:8080/index.json` 을 엽니다. 내 패키지가 보입니다.

서버는 시작할 때와 `MARKET_REBUILD_SECONDS` 초마다 `index.json` 을 다시 만듭니다. 그래서 새 판은 다시 시작하지 않아도 보입니다. 잘못된 패키지가 있으면 마지막으로 성공한 `index.json` 을 그대로 두고, 이유를 `docker compose -f marketplace/compose.yaml logs market` 에 남깁니다.

저장소는 `marketplace/.env` 와 `marketplace/compose.override.yaml` 을 무시합니다.

## HTTPS 뒤에 두기

Keyring Notes 는 `https:` 저장소에서만 받습니다. `http:` 와 사설망 주소는 Keyring Notes 서버 운영자가 `KEYRING_MARKET_ALLOW_HTTP`·`KEYRING_MARKET_ALLOW_PRIVATE` 로 허용했을 때만 받습니다([설정값](../configuration.md) 참고). 데스크톱 앱은 그 기기에서 허용했을 때만 받습니다.

마켓 서버도 Keyring Notes 와 같은 리버스 프록시 뒤에 둡니다([구성 A](deploy-with-docker.md#구성-a-리버스-프록시-뒤)와 같습니다). `marketplace/compose.override.yaml` 에서 호스트 포트를 닫고 프록시 네트워크에 붙습니다.

```yaml
services:
  market:
    ports: !reset []
    networks: [proxy]
networks:
  proxy:
    external: true
    name: your-proxy-network
```

호스트 이름을 `market` 서비스의 `8080` 포트로 잇습니다. 프록시가 응답을 압축하지 않게 하세요. Keyring Notes 는 압축된 패키지를 받지 않습니다.

## Keyring Notes 에 더하기

[공통 설정 파일](../reference.md#공통-설정-파일)의 `marketplace.repos` 에 저장소 주소를 더합니다. 공식 저장소도 계속 쓰려면 그것을 맨 위에 둡니다.

```yaml
marketplace:
  repos:
    - url: https://keyring-notes-marketplace.develma.com/
    - url: https://market.example.com/
```

같은 패키지 id 가 두 저장소에 있으면 목록 위의 저장소가 이깁니다.

## 다음 단계

- [마켓 패키지 올리기](publish-packages.md)
- [설정값](../configuration.md#마켓-서버)
