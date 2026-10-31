import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as PwaUpdate from "./pwaUpdate";

// onNewVersion 은 모듈 전역(「이미 알아챘다」)을 가지므로 시험마다 새로 불러온다
let m: typeof PwaUpdate;
beforeEach(async () => {
  vi.resetModules();
  m = await import("./pwaUpdate");
});

const MIN = 60_000;

/** 답하는 워커: postMessage(msg, [port]) 에서 포트로 build 를 돌려준다 */
function answering(build: string) {
  const sw = {
    postMessage: vi.fn((msg: unknown, transfer?: Transferable[]) => {
      const port = transfer?.[0] as MessagePort | undefined;
      if ((msg as { type?: string } | null)?.type === "build") port?.postMessage(build);
    }),
  };
  // ServiceWorker.postMessage 는 겹쳐 쓴 두 모양(transfer 배열·options)이라 가짜 하나로는 타입이 맞지 않는다
  return sw as unknown as Pick<ServiceWorker, "postMessage">;
}

/** 가짜 환경: 보임 처리기·워커 교체 처리기를 모아 두고 시험이 직접 부른다 */
function fakeEnv(controller: Pick<ServiceWorker, "postMessage"> | null = null) {
  const env = {
    time: 0,
    shown: true,
    worker: controller,
    visibleFns: [] as (() => void)[],
    changeFns: [] as (() => void)[],
    now: () => env.time,
    visible: () => env.shown,
    onVisible: (fn: () => void) => (env.visibleFns.push(fn), () => void (env.visibleFns = env.visibleFns.filter((f) => f !== fn))),
    onControllerChange: (fn: () => void) => (env.changeFns.push(fn), () => void (env.changeFns = env.changeFns.filter((f) => f !== fn))),
    controller: () => env.worker,
  };
  return env;
}

/** 대기 중인 약속·메시지 포트 전달이 끝날 때까지 */
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("pwaUpdate", () => {
  it("shouldCheck: 30분이 지나야 다시 확인", () => {
    expect(m.CHECK_EVERY_MS).toBe(30 * MIN);
    expect(m.shouldCheck(30 * MIN, 0)).toBe(true);
    expect(m.shouldCheck(30 * MIN - 1, 0)).toBe(false);
  });

  it("isNewBuild: 다를 때만, null 이면 아니다", () => {
    expect(m.isNewBuild("b2", "b1")).toBe(true);
    expect(m.isNewBuild("b1", "b1")).toBe(false);
    expect(m.isNewBuild(null, "b1")).toBe(false);
  });

  it("askBuild: 답이 없으면 시간 초과로 null", async () => {
    const silent = { postMessage: vi.fn() };
    await expect(m.askBuild(silent, 10)).resolves.toBeNull();
    expect(silent.postMessage).toHaveBeenCalledWith({ type: "build" }, [expect.anything()]);
  });

  it("askBuild: postMessage 가 던지면 null", async () => {
    const broken = {
      postMessage: () => {
        throw new Error("gone");
      },
    };
    await expect(m.askBuild(broken, 1000)).resolves.toBeNull();
  });

  it("askBuild: 포트로 온 답을 돌려준다", async () => {
    await expect(m.askBuild(answering("b2"), 1000)).resolves.toBe("b2");
  });

  it("watchUpdates: 보이게 될 때 마지막 확인 뒤 30분이 지났을 때만 update()", () => {
    const reg = { update: vi.fn(async () => undefined) };
    const env = fakeEnv();
    m.watchUpdates(reg as unknown as ServiceWorkerRegistration, env, "b1");
    env.time = 10 * MIN;
    env.visibleFns.forEach((f) => f());
    expect(reg.update).not.toHaveBeenCalled();
    env.time = 31 * MIN;
    env.shown = false; // 숨겨질 때는 확인하지 않는다
    env.visibleFns.forEach((f) => f());
    expect(reg.update).not.toHaveBeenCalled();
    env.shown = true;
    env.visibleFns.forEach((f) => f());
    expect(reg.update).toHaveBeenCalledTimes(1);
    // 바로 다시 보이게 돼도 30분 문턱은 방금 확인한 때부터 다시 센다
    env.time = 40 * MIN;
    env.visibleFns.forEach((f) => f());
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it("watchUpdates: update() 가 거부돼도(오프라인) 던지지 않고 알리지 않는다", async () => {
    // vi.fn 은 돌려준 약속에 결과 추적용 처리기를 달아 거부를 「처리됨」 으로 만든다 — 평범한 함수로 센다
    let updates = 0;
    const reg = { update: () => (updates++, Promise.reject(new TypeError("Failed to fetch"))) };
    const env = fakeEnv();
    const seen = vi.fn();
    // 삼키지 않은 거부는 vitest 가 실패로 잡지 않는다 — 직접 지켜본다(web 의 tsconfig 에 node 타입이 없어 쓰는 모양만 적는다)
    type Listener = (reason: unknown) => void;
    const proc = (globalThis as unknown as { process: { on(e: string, f: Listener): void; off(e: string, f: Listener): void } }).process;
    const unhandled = vi.fn();
    proc.on("unhandledRejection", unhandled);
    try {
      m.onNewVersion(seen);
      m.watchUpdates(reg as unknown as ServiceWorkerRegistration, env, "b1");
      env.time = 31 * MIN;
      expect(() => env.visibleFns.forEach((f) => f())).not.toThrow();
      await settle();
    } finally {
      proc.off("unhandledRejection", unhandled);
    }
    expect(updates).toBe(1);
    expect(unhandled).not.toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalled();
  });

  it("watchUpdates: controllerchange 뒤 워커 빌드가 다르면 onNewVersion 을 부른다", async () => {
    const env = fakeEnv(answering("b2"));
    const seen = vi.fn();
    m.onNewVersion(seen);
    m.watchUpdates({ update: vi.fn() } as unknown as ServiceWorkerRegistration, env, "b1");
    env.changeFns.forEach((f) => f());
    await settle();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("watchUpdates: 같은 빌드(배포 뒤 처음 연 화면·처음 설치)면 알리지 않는다", async () => {
    const env = fakeEnv(answering("b1"));
    const seen = vi.fn();
    m.onNewVersion(seen);
    m.watchUpdates({ update: vi.fn() } as unknown as ServiceWorkerRegistration, env, "b1");
    env.changeFns.forEach((f) => f());
    await settle();
    expect(seen).not.toHaveBeenCalled();
  });

  it("watchUpdates: 답하지 않는 워커(옛 워커)·워커 없음이면 알리지 않는다", async () => {
    const env = fakeEnv({ postMessage: vi.fn() });
    const seen = vi.fn();
    m.onNewVersion(seen);
    m.watchUpdates({ update: vi.fn() } as unknown as ServiceWorkerRegistration, env, "b1", 10);
    env.changeFns.forEach((f) => f());
    env.worker = null;
    env.changeFns.forEach((f) => f());
    await settle();
    expect(seen).not.toHaveBeenCalled();
  });

  it("watchUpdates: 돌려준 함수로 감시를 끝낸다", () => {
    const env = fakeEnv();
    const stop = m.watchUpdates({ update: vi.fn() } as unknown as ServiceWorkerRegistration, env, "b1");
    stop();
    expect(env.visibleFns).toHaveLength(0);
    expect(env.changeFns).toHaveLength(0);
  });

  it("onNewVersion: 알아챈 뒤 구독해도 한 번 불린다", async () => {
    const env = fakeEnv(answering("b2"));
    m.watchUpdates({ update: vi.fn() } as unknown as ServiceWorkerRegistration, env, "b1");
    env.changeFns.forEach((f) => f());
    await settle();
    const late = vi.fn();
    const off = m.onNewVersion(late);
    expect(late).toHaveBeenCalledTimes(1);
    off();
  });
});
