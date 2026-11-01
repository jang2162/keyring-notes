import { describe, expect, it } from "vitest";
import { nodeTap, showOpenButton } from "./treeTap";

describe("nodeTap", () => {
  it("touch: a note with children toggles when its row is tapped", () => {
    expect(nodeTap({ touch: true, canExpand: true, hasNote: true, onChevron: false })).toBe("toggle");
  });
  it("touch: a note without children opens", () => {
    expect(nodeTap({ touch: true, canExpand: false, hasNote: true, onChevron: false })).toBe("open");
  });
  it("touch: the chevron of a note with children toggles", () => {
    expect(nodeTap({ touch: true, canExpand: true, hasNote: true, onChevron: true })).toBe("toggle");
  });
  it("mouse: the name opens even when the note has children", () => {
    expect(nodeTap({ touch: false, canExpand: true, hasNote: true, onChevron: false })).toBe("open");
  });
  it("mouse: the chevron toggles", () => {
    expect(nodeTap({ touch: false, canExpand: true, hasNote: true, onChevron: true })).toBe("toggle");
  });
});

describe("showOpenButton", () => {
  it("only for a note with children on touch", () => {
    expect(showOpenButton({ touch: true, canExpand: true, hasNote: true })).toBe(true);
    expect(showOpenButton({ touch: true, canExpand: false, hasNote: true })).toBe(false);
    expect(showOpenButton({ touch: true, canExpand: true, hasNote: false })).toBe(false);
    expect(showOpenButton({ touch: false, canExpand: true, hasNote: true })).toBe(false);
  });
});
