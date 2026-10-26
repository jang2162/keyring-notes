<!-- source: docs/manual/en/how-to/automate-with-webhooks.md @ v0.9.0 -->
# 웹훅으로 자동화하기

볼트 이벤트를 다른 서비스로 보내고, 에이전트의 주간 정리처럼 정해진 때에 작업을 돌립니다.

Keyring Notes 를 자동화 도구나 에이전트 실행기에 잇는 분을 위한 문서입니다.

## 웹훅 더하기

1. 설정 → **자동화**를 여세요(서버만, 소유자만).
2. 받을 URL 로 웹훅을 더하세요. secret 은 한 번만 보입니다.
3. 시험 단추를 눌러 `ping` 이벤트를 보내 보세요.

웹훅은 이벤트를 JSON 으로 POST 합니다. 이벤트와 데이터는 [참조](../reference.md#웹훅-이벤트)에 있습니다.

## 서명 확인하기

요청마다 `X-Keyring-Signature: sha256=<HMAC-SHA256(secret, 본문)>` 이 붙습니다. 받는 쪽에서 본문을 믿기 전에 확인하세요. Node.js 예:

```js
const ok =
  req.headers["x-keyring-signature"] ===
  "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
```

`5xx`·`429` 응답과 연결 실패는 1·5·25초 뒤에 다시 보냅니다.

## 묶어 보내는 변경 이벤트

`doc.changed` 는 자동 저장마다 나가지 않습니다. 노트마다 마지막 저장 뒤 90초 동안 다른 저장이 없을 때까지 기다렸다가, 그때까지의 커밋을 묶어 보냅니다. 만들었다가 지운 노트는 보내지 않습니다. 서버를 끌 때 남은 이벤트는 바로 보냅니다.

## 정기 작업 돌리기

설정 → **자동화**에서 cron 일정(`분 시 일 월 요일`, 서버 시간대)으로 작업을 더하세요. 돌 때마다 웹훅으로 `schedule` 이벤트를 보냅니다.

**정리 점검 포함**을 켜면 정리 점검 결과와 지시문을 함께 보내, 에이전트가 정리 작업을 하게 할 수 있습니다. 예를 들어 `0 9 * * 1` 은 매주 월요일 9시에 돕니다.

서버에서 정기 작업을 끄려면 `KEYRING_SCHEDULER=0` 을 정하세요.

## 다음 단계

- [LLM Wiki 만들기](build-an-llm-wiki.md)
- [에이전트 변경 검토하기](review-agent-changes.md)
