# Automate with webhooks

This guide sends vault events to another service and runs jobs on a schedule, for example a weekly cleanup by an agent.

It is for people who connect Keyring Notes to automation tools or agent runners.

## Add a webhook

1. Open Settings → **Automation** (server only, owner only).
2. Add a webhook with the receiving URL. Its secret is shown once.
3. Click the test button to send a `ping` event.

Webhooks POST events as JSON. The events and their data are listed in [Reference](../reference.md#webhook-events).

## Verify the signature

Each request carries `X-Keyring-Signature: sha256=<HMAC-SHA256(secret, body)>`. Check it on the receiving side before you trust the body. Example in Node.js:

```js
const ok =
  req.headers["x-keyring-signature"] ===
  "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
```

`5xx` and `429` responses, and connection failures, are retried after 1, 5 and 25 seconds.

## Batched change events

`doc.changed` does not fire on every autosave. For each note, it waits until 90 seconds pass after the last save with no further saves, then sends the commits up to then as one batch. A note created and then deleted is not sent. Pending events are sent when the server shuts down.

## Run a scheduled job

Add a job in Settings → **Automation** with a cron schedule (`minute hour day month weekday`, server time zone). Each run sends a `schedule` event to the webhook.

With **Include lint check**, the structure check results and your instructions are sent together, so an agent can do the cleanup. For example, `0 9 * * 1` runs every Monday at 9:00.

To turn scheduled jobs off on a server, set `KEYRING_SCHEDULER=0`.

## Next steps

- [Build an LLM Wiki](build-an-llm-wiki.md)
- [Review agent changes](review-agent-changes.md)
