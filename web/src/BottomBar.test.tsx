import { renderToStaticMarkup } from "react-dom/server";
import { Settings, Tag } from "lucide-react";
import { beforeEach, describe, expect, it } from "vitest";
import { BottomBar, MoreSheetBody, type MoreEntry, type MoreStatusLine } from "./BottomBar";
import { setLanguage, t } from "./i18n";

const noop = () => undefined;
type Props = Parameters<typeof BottomBar>[0];
const bar = (p: Partial<Props> = {}) =>
  renderToStaticMarkup(
    <BottomBar
      active={null}
      tabCount={0}
      canNew
      badge={null}
      onFiles={noop}
      onSearch={noop}
      onNew={noop}
      onNewHold={noop}
      onTabs={noop}
      onMore={noop}
      {...p}
    />,
  );
/** 단추 하나(aria-label 로 찾는다)의 여는 태그부터 닫는 태그까지 */
const button = (html: string, label: string) => {
  const at = html.indexOf(`aria-label="${label}"`);
  expect(at).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<button", at);
  return html.slice(start, html.indexOf("</button>", at) + "</button>".length).replaceAll("&#x27;", "'");
};

beforeEach(() => setLanguage("en"));

describe("BottomBar", () => {
  it("다섯 칸이 이 순서: Notes · Search · New note · Tabs · More", () => {
    const labels = [...bar().matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual([t("rail.files"), t("rail.search"), t("tree.newNote"), t("bar.tabs"), t("bar.more")]);
    expect(labels).toEqual(["Notes", "Search", "New note", "Tabs", "More"]);
  });

  it("주 메뉴 이름이 붙은 nav", () => expect(bar()).toMatch(/<nav class="bottom-bar" aria-label="Main"/));

  it("active 칸은 aria-pressed=true, 다른 칸은 false", () => {
    const html = bar({ active: "search" });
    expect(button(html, "Search")).toContain('aria-pressed="true"');
    expect(button(html, "Notes")).toContain('aria-pressed="false"');
    expect(button(bar(), "Notes")).toContain('aria-pressed="false"');
  });

  it("탭 칸에 열린 탭 수가 보인다", () => {
    expect(button(bar({ tabCount: 3 }), "Tabs")).toContain(">3<");
    expect(button(bar({ tabCount: 120 }), "Tabs")).toContain(">99+<");
  });

  it("badge 가 수면 더 보기 칸에 수, dot 이면 점 요소, null 이면 둘 다 없다", () => {
    expect(button(bar({ badge: 4 }), "More")).toMatch(/class="bar-badge"[^>]*>4</);
    const dot = button(bar({ badge: "dot" }), "More");
    expect(dot).toContain("bar-dot");
    expect(dot).not.toContain("bar-badge");
    const none = button(bar(), "More");
    expect(none).not.toContain("bar-dot");
    expect(none).not.toContain("bar-badge");
  });

  it("열린 탭이 없으면(노트가 없는 홈 화면) 탭 칸이 disabled", () => {
    expect(button(bar({ tabCount: 0 }), "Tabs")).toMatch(/ disabled=""/);
    expect(button(bar({ tabCount: 1 }), "Tabs")).not.toMatch(/ disabled=""/);
  });

  it("canNew=false 면 ＋ 가 disabled", () => {
    expect(button(bar({ canNew: false }), "New note")).toMatch(/ disabled=""/);
    expect(button(bar(), "New note")).not.toMatch(/ disabled=""/);
  });

  it("onNewHold 가 있으면 ＋ 의 설명에 길게 누르기 안내가 붙고, 없으면 안 붙는다", () => {
    expect(button(bar(), "New note")).toContain(t("bar.newHold"));
    expect(button(bar({ onNewHold: null }), "New note")).not.toContain(t("bar.newHold"));
  });

  it("＋ 에는 툴팁(data-tip)을 달지 않는다 — 터치 길게 누르기를 툴팁이 가로채지 않게", () => {
    expect(button(bar(), "New note")).not.toContain("data-tip");
  });
});

describe("MoreSheetBody", () => {
  const status: MoreStatusLine[] = [
    { id: "offline", text: "Offline · 2 to send", kind: "warn", run: noop },
    { id: "plain", text: "Plain status", kind: "" },
  ];
  const entries: MoreEntry[] = [
    { id: "tags", label: "Tags", icon: Tag, run: noop },
    { id: "settings", label: "Settings", icon: Settings, dot: true, run: noop },
    { id: "review", label: "Review", icon: Tag, badge: 5, run: noop },
  ];
  const html = renderToStaticMarkup(<MoreSheetBody status={status} entries={entries} onClose={noop} />);

  it("status 줄이 entries 보다 먼저", () => {
    expect(html.indexOf("Offline · 2 to send")).toBeGreaterThan(-1);
    expect(html.indexOf("Plain status")).toBeLessThan(html.indexOf(">Tags<"));
    expect(html.indexOf("Offline · 2 to send")).toBeLessThan(html.indexOf(">Tags<"));
  });

  it("run 이 있는 줄은 단추, 없는 줄은 단추가 아니다", () => {
    expect(html).toMatch(/<button[^>]*class="more-status warn"[^>]*>[^]*?Offline · 2 to send/);
    expect(html).not.toMatch(/<button[^>]*class="more-status"[^>]*>[^]*?Plain status/);
  });

  it("항목의 수 배지·점이 보인다", () => {
    expect(html).toMatch(/>Review<[^]*?class="bar-badge"[^>]*>5</);
    expect(html).toMatch(/>Settings<[^]*?bar-dot/);
  });
});
