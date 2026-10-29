import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPdfAnnotation, type PdfAnnotation } from "@keyring-notes/core";
import tauriConf from "../../app/src-tauri/tauri.conf.json";
import { removeAnnotation, removeProperty, resetDevice } from "./askFirst";
import type { CompanionTarget } from "./pdfCompanion";
import pdfViewerSrc from "./PdfViewer.tsx?raw";
import propertiesSrc from "./Properties.tsx?raw";
import settingsSrc from "./Settings.tsx?raw";

const { created, confirmDialog, write, resetDevicePrefs } = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  confirmDialog: vi.fn<(message: string, okLabel?: string) => Promise<boolean>>(),
  write: vi.fn(async (_path: string, _content: string, _hash: string | null) => ({ hash: "h2" })),
  resetDevicePrefs: vi.fn(),
}));
vi.mock("./dialog", () => ({ confirmDialog }));
vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), api: { write } }));
vi.mock("./prefs", () => ({ resetDevicePrefs }));
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

beforeEach(() => {
  confirmDialog.mockReset();
  write.mockClear();
  resetDevicePrefs.mockClear();
});

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

const PDF = "papers/a.pdf";
const NOTE = addPdfAnnotation("# a\n", { pdf: "a.pdf", page: 3, quote: "인용", id: "pdf-3-abcd" }, "ko");
const annotation = { id: "pdf-3-abcd", page: 3 } as PdfAnnotation;
const target = (openDraft: string | null) =>
  ({
    pdf: PDF,
    companion: { path: "papers/a.md", content: openDraft === null ? NOTE : null, hash: openDraft === null ? "h1" : null },
    openDraft,
    onEditOpenDoc: vi.fn<CompanionTarget["onEditOpenDoc"]>(),
    onWritten: vi.fn<CompanionTarget["onWritten"]>(),
  }) satisfies CompanionTarget;

describe("첫 클릭이 바로 닿으므로 한 번에 지우는 단추는 묻고, 취소하면 아무것도 고치지 않는다", () => {
  it("PDF 주석 삭제 — 짝 노트가 열려 있으면 확인했을 때만 초안을 고친다", async () => {
    expect(NOTE).toContain("^pdf-3-abcd");
    confirmDialog.mockResolvedValue(false);
    const no = target(NOTE);
    await removeAnnotation(no, annotation);
    expect(confirmDialog).toHaveBeenCalledOnce();
    expect(no.onEditOpenDoc).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();

    confirmDialog.mockResolvedValue(true);
    const yes = target(NOTE);
    await removeAnnotation(yes, annotation);
    expect(yes.onEditOpenDoc).toHaveBeenCalledOnce();
    expect(yes.onEditOpenDoc.mock.calls[0][0]).not.toContain("^pdf-3-abcd");
    expect(write).not.toHaveBeenCalled();
  });

  it("PDF 주석 삭제 — 짝 노트가 닫혀 있으면 확인했을 때만 저장한다", async () => {
    confirmDialog.mockResolvedValue(false);
    const no = target(null);
    await removeAnnotation(no, annotation);
    expect(write).not.toHaveBeenCalled();
    expect(no.onWritten).not.toHaveBeenCalled();

    confirmDialog.mockResolvedValue(true);
    const yes = target(null);
    await removeAnnotation(yes, annotation);
    expect(write).toHaveBeenCalledOnce();
    const [path, content, hash] = write.mock.calls[0];
    expect([path, hash]).toEqual(["papers/a.md", "h1"]);
    expect(content).not.toContain("^pdf-3-abcd");
    expect(yes.onWritten).toHaveBeenCalledWith({ path: "papers/a.md", content, hash: "h2" });
  });

  it("속성 행 삭제 — 확인했을 때만 프런트매터를 고친다", async () => {
    const content = "---\ntitle: a\nstatus: draft\n---\n본문\n";
    const onChange = vi.fn();
    const apply = (fn: (c: string) => string) => onChange(fn(content));

    confirmDialog.mockResolvedValue(false);
    await removeProperty("status", apply);
    expect(confirmDialog).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();

    confirmDialog.mockResolvedValue(true);
    await removeProperty("status", apply);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("---\ntitle: a\n---\n본문\n");
  });

  it("이 기기 설정 초기화 — 확인했을 때만 지운다", async () => {
    confirmDialog.mockResolvedValue(false);
    await resetDevice();
    expect(confirmDialog).toHaveBeenCalledOnce();
    expect(resetDevicePrefs).not.toHaveBeenCalled();

    confirmDialog.mockResolvedValue(true);
    await resetDevice();
    expect(resetDevicePrefs).toHaveBeenCalledOnce();
  });

  // 화면이 묻는 함수를 건너뛰고 바로 지우면 위 시험이 지키는 것이 소용없다
  it("화면의 단추는 묻는 함수를 거친다", () => {
    expect(pdfViewerSrc).toContain("removeAnnotation(companionTarget, a)");
    expect(pdfViewerSrc).not.toContain("removePdfAnnotation");
    expect(propertiesSrc).toContain("removeProperty(key, apply)");
    expect(propertiesSrc).not.toMatch(/setFrontmatterField\(c, key, null\)/);
    expect(settingsSrc).toContain("onClick={() => void resetDevice()}");
    expect(settingsSrc).not.toContain("resetDevicePrefs");
  });
});
