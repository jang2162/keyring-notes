import { describe, expect, it } from "vitest";
import { crumbNodes, overlayTitleBar, switcherSpot } from "./topbar";

describe("crumbNodes", () => {
  it("워크스페이스 하나를 보는 동안에는 워크스페이스 칸을 뺀다", () => {
    expect(crumbNodes("개인/프로젝트/회의/첫 회의", false)).toEqual(["개인/프로젝트", "개인/프로젝트/회의"]);
  });

  it("모든 워크스페이스 모드에서는 워크스페이스 칸을 남긴다", () => {
    expect(crumbNodes("개인/프로젝트/첫 회의", true)).toEqual(["개인", "개인/프로젝트"]);
  });

  it("워크스페이스 바로 아래 노트", () => {
    expect(crumbNodes("개인/메모", false)).toEqual([]);
    expect(crumbNodes("개인/메모", true)).toEqual(["개인"]);
  });

  it("워크스페이스 노트 자신은 위가 없다", () => {
    expect(crumbNodes("개인", false)).toEqual([]);
    expect(crumbNodes("개인", true)).toEqual([]);
  });
});

describe("switcherSpot", () => {
  it("넓은 화면에서 사이드바를 접었을 때만 브레드크럼으로 옮긴다", () => {
    expect(switcherSpot(false, true)).toBe("sidebar");
    expect(switcherSpot(false, false)).toBe("crumbs");
  });

  it("좁은 화면은 사이드바 설정과 상관없이 서랍에 둔다", () => {
    expect(switcherSpot(true, true)).toBe("sidebar");
    expect(switcherSpot(true, false)).toBe("sidebar");
  });
});

describe("overlayTitleBar", () => {
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
  it("macOS 데스크톱 앱", () => {
    expect(overlayTitleBar({ tauri: true, userAgent: mac, touchPoints: 0 })).toBe(true);
  });

  it("브라우저·iPad(UA 는 Macintosh, 터치 있음)·다른 데스크톱 앱은 아니다", () => {
    expect(overlayTitleBar({ tauri: false, userAgent: mac, touchPoints: 0 })).toBe(false);
    expect(overlayTitleBar({ tauri: true, userAgent: mac, touchPoints: 5 })).toBe(false);
    expect(overlayTitleBar({ tauri: true, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", touchPoints: 0 })).toBe(false);
  });
});
