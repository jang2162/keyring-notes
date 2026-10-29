import { afterEach, describe, expect, it, vi } from "vitest";
import tauriConf from "../../app/src-tauri/tauri.conf.json";
import pdfViewerSrc from "./PdfViewer.tsx?raw";
import propertiesSrc from "./Properties.tsx?raw";

const { created } = vi.hoisted(() => ({ created: [] as Record<string, unknown>[] }));
vi.mock("@tauri-apps/api/core", async (orig) => ({ ...(await orig<typeof import("@tauri-apps/api/core")>()), isTauri: () => true }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    constructor(_label: string, options: Record<string, unknown>) {
      created.push(options);
    }
    once(event: string, cb: () => void) {
      if (event === "tauri://created") cb();
      return Promise.resolve(() => {});
    }
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  created.length = 0;
});

describe("비활성 창의 첫 클릭(macOS acceptFirstMouse)", () => {
  it("설정에 둔 창은 모두 켠다", () => {
    expect(tauriConf.app.windows.length).toBeGreaterThan(0);
    for (const w of tauriConf.app.windows) expect(w).toMatchObject({ acceptFirstMouse: true });
  });

  it("「새 창으로 열기」 창도 켠다", async () => {
    vi.stubGlobal("location", new URL("tauri://localhost/index.html"));
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
    const { openSolo } = await import("./soloWindow");
    await openSolo("a.md", "a");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ acceptFirstMouse: true });
  });
});

/** 함수 본문 첫 부분: `const <name> = …` 에서 다음 `const` 선언 전까지 */
const body = (src: string, name: string) => src.slice(src.indexOf(`const ${name} = `)).split(/\n {2}const /)[0];

describe("첫 클릭이 바로 닿으므로 한 번에 지우는 단추는 묻는다", () => {
  it("PDF 주석 삭제는 짝 노트를 고치기 전에 묻는다", () => {
    const remove = body(pdfViewerSrc, "remove");
    expect(remove).toMatch(/confirmDialog\(t\("pdf\.removeAsk"/);
    expect(remove.indexOf("confirmDialog(")).toBeLessThan(remove.indexOf("editCompanion("));
  });

  it("속성 행 삭제는 프런트매터를 고치기 전에 묻는다", () => {
    const remove = body(propertiesSrc, "remove");
    expect(remove).toMatch(/confirmDialog\(t\("props\.removeAsk"/);
    expect(remove.indexOf("confirmDialog(")).toBeLessThan(remove.indexOf("setFrontmatterField("));
  });
});
