<!-- source: docs/manual/en/how-to/enable-semantic-search.md @ v0.10.0 -->
# 의미 검색 켜기

단어가 달라도 뜻이 가까운 노트를 찾는 의미 검색을 켭니다.

서버를 운영하고 로컬이나 호스팅 임베딩 모델을 가진 분을 위한 문서입니다.

## 임베딩 엔드포인트 고르기

OpenAI 호환 `/embeddings` 엔드포인트면 무엇이든 됩니다. `KEYRING_EMBED_URL` 과 `KEYRING_EMBED_MODEL` 을 정하세요. 둘 다 있어야 의미 검색이 켜집니다.

로컬 Ollama(먼저 `ollama pull nomic-embed-text` 실행):

```bash
KEYRING_EMBED_URL=http://localhost:11434/v1/embeddings KEYRING_EMBED_MODEL=nomic-embed-text pnpm start
```

OpenAI:

```bash
KEYRING_EMBED_URL=https://api.openai.com/v1/embeddings KEYRING_EMBED_MODEL=text-embedding-3-small KEYRING_EMBED_KEY=<YOUR_API_KEY> pnpm start
```

Docker 에서는 같은 키를 `.env` 에 두세요. 컨테이너 안의 `localhost` 는 컨테이너 자신이므로, 호스트에서 도는 모델은 호스트의 주소로 가리키세요.

> [!NOTE]
> 호스팅 API 를 쓰면 노트 내용이 그 서비스로 갑니다.

## 동작 방식

노트를 절 단위로 나눠 벡터를 인덱스 파일에 저장합니다. 바뀐 노트만 다시 계산합니다.

상태는 `GET /api/semantic/status` 로 확인하세요. 켜지면 검색창 옆에 **의미**가 보이고, 에이전트는 MCP 도구 `semantic_search` 를 쓸 수 있습니다.

## 다음 단계

- [노트 찾기](find-notes.md)
- [설정값](../configuration.md)
