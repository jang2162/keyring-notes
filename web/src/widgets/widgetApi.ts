import type { DataFileHandle } from "./dataFile";
import type { WidgetSession } from "./session";
import type { WidgetApi, WidgetContext } from "./types";
import { widgetT, type MessageChain } from "./widgetT";

/** 인라인 연결의 WidgetApi. iframe 연결(frame/runtime.ts)과 같은 동작이어야 한다 — frame/equivalence.test.ts 가 지킨다 */
export function bindWidgetApi(o: {
  session: WidgetSession;
  messages(): MessageChain;
  listeners: ((c: WidgetContext) => void)[];
  file: DataFileHandle | null;
  fullscreen: (() => void) | null;
}): WidgetApi {
  const { session, file, fullscreen } = o;
  const api: WidgetApi = {
    setState: (p) => session.setState(p),
    requestEdit: () => session.requestEdit(),
    exitEdit: (apply) => session.exitEdit(apply),
    t: (k, vars) => widgetT(o.messages(), k, vars),
    onUpdate: (cb) => void o.listeners.push(cb),
  };
  if (file) api.file = { read: () => file.read(), write: (bytes, baseHash) => file.write(bytes, baseHash) };
  if (fullscreen) api.toggleFullscreen = () => fullscreen();
  return api;
}
