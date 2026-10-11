import { describe, expect, it } from "vitest";
import { merge3 } from "../src/index.js";

const base = ["# 회의록", "", "## 안건", "- 예산", "- 일정", "", "## 결정", "- 없음", "", "## 다음", "- 미정", ""].join("\n");

describe("3방향 병합", () => {
  it("서로 다른 절을 고치면 둘 다 반영한다", () => {
    const ours = base.replace("- 예산", "- 예산(2억)");
    const theirs = base.replace("- 미정", "- 금요일 재논의");
    expect(merge3(base, ours, theirs)).toEqual({ ok: true, text: base.replace("- 예산", "- 예산(2억)").replace("- 미정", "- 금요일 재논의") });
  });

  it("한쪽만 바뀌었거나 둘이 같으면 그대로", () => {
    const ours = base + "추가\n";
    expect(merge3(base, ours, base)).toEqual({ ok: true, text: ours });
    expect(merge3(base, base, ours)).toEqual({ ok: true, text: ours });
    expect(merge3(base, ours, ours)).toEqual({ ok: true, text: ours });
  });

  it("양쪽이 끝에 덧붙이고 앞에서도 고치는 경우", () => {
    const ours = base.replace("# 회의록", "# 10월 회의록");
    const theirs = base + "- 덧붙임\n";
    const r = merge3(base, ours, theirs);
    expect(r).toEqual({ ok: true, text: "# 10월 회의록" + base.slice("# 회의록".length) + "- 덧붙임\n" });
  });

  it("같은 줄을 다르게 고치면 병합하지 않는다", () => {
    expect(merge3(base, base.replace("- 없음", "- A안"), base.replace("- 없음", "- B안"))).toEqual({ ok: false, conflicts: 1 });
  });

  it("바로 붙은 줄을 각각 고쳐도 충돌로 본다(git과 같은 기준)", () => {
    expect(merge3(base, base.replace("- 예산", "- 예산!"), base.replace("- 일정", "- 일정!"))).toMatchObject({ ok: false });
  });

  it("같은 자리에 다른 줄을 끼워 넣으면 충돌, 같은 줄이면 하나로", () => {
    const at = (s: string) => base.replace("## 결정\n", `## 결정\n${s}\n`);
    expect(merge3(base, at("- 가"), at("- 나"))).toMatchObject({ ok: false });
    expect(merge3(base, at("- 가"), at("- 가"))).toEqual({ ok: true, text: at("- 가") });
  });

  it("양쪽이 똑같이 고친 줄과 각자 고친 줄이 섞여도 합친다", () => {
    const ours = base.replace("- 예산", "- 예산 확정").replace("- 미정", "- 다음 주");
    const theirs = base.replace("- 예산", "- 예산 확정").replace("## 결정", "## 결정 사항");
    expect(merge3(base, ours, theirs)).toEqual({
      ok: true,
      text: base.replace("- 예산", "- 예산 확정").replace("- 미정", "- 다음 주").replace("## 결정", "## 결정 사항"),
    });
  });

  it("삭제와 다른 곳 수정", () => {
    const ours = base.replace("- 일정\n", "");
    const theirs = base.replace("- 없음", "- 연기");
    expect(merge3(base, ours, theirs)).toEqual({ ok: true, text: base.replace("- 일정\n", "").replace("- 없음", "- 연기") });
  });
});
