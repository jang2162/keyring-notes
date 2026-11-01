import { describe, expect, it } from "vitest";
import { editorAutoFocus } from "./editorFocus";

describe("editorAutoFocus", () => {
  it("mouse: focuses the editor of the focused pane", () => {
    expect(editorAutoFocus({ touch: false, focused: true })).toBe(true);
  });
  it("touch: never focuses on open (keeps the on-screen keyboard down)", () => {
    expect(editorAutoFocus({ touch: true, focused: true })).toBe(false);
  });
  it("an unfocused pane never takes focus", () => {
    expect(editorAutoFocus({ touch: false, focused: false })).toBe(false);
    expect(editorAutoFocus({ touch: true, focused: false })).toBe(false);
  });
});
