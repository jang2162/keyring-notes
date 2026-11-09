import { beforeAll, describe, expect, it } from "vitest";
import { firstUseFiles, firstUseGzip, inlineWidgetSizes, INLINE_WIDGET_GZIP_LIMIT, type BudgetChunk } from "./widgetBudget";

/** 압축이 안 되는 결정적 글(xorshift32 — 곱셈형 합동 난수는 JS 수의 53비트를 넘어 정밀도가 깨져 압축된다) */
function noise(n: number): string {
  let x = 2463534242;
  let s = "";
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    s += String.fromCharCode(33 + ((x >>> 0) % 94));
  }
  return s;
}

const chunk = (fileName: string, imports: string[], extra: Partial<BudgetChunk> = {}): BudgetChunk => ({
  fileName,
  code: `/* ${fileName} */`,
  imports,
  isEntry: false,
  facadeModuleId: null,
  ...extra,
});

function graph(ddayCode = "short"): BudgetChunk[] {
  return [
    chunk("index.js", ["shared.js"], { isEntry: true, facadeModuleId: "/w/web/index.html" }),
    chunk("shared.js", []),
    chunk("dday.js", ["shared.js", "lib.js"], { facadeModuleId: "/w/web/src/widgets/inline/dday.ts", code: ddayCode }),
    chunk("lib.js", ["lib2.js"]),
    chunk("lib2.js", ["lib.js"]),
  ];
}

/** gzip 길이 — 웹 tsconfig 에는 node 타입이 없어 CompressionStream(Node 18+ 전역)으로 미리 재 둔다 */
const sizes = new Map<string, number>();
async function measure(code: string) {
  const buf = await new Response(new Blob([code]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  sizes.set(code, buf.byteLength);
}
const gzip = (code: string) => {
  const n = sizes.get(code);
  if (n === undefined) throw new Error(`not measured: ${code.slice(0, 20)}`);
  return n;
};

beforeAll(async () => {
  for (const c of [...graph(), ...graph(noise(5000)), ...graph(noise(70000))]) await measure(c.code);
});

describe("인라인 위젯 크기", () => {
  it("처음 쓸 때 새로 받는 파일: 진입 청크의 정적 그래프에 있는 것은 뺀다(순환도 끝난다)", () => {
    expect(firstUseFiles(graph(), "dday.js").sort()).toEqual(["dday.js", "lib.js", "lib2.js"]);
  });

  it("gzip 크기의 합", () => {
    const g = graph();
    expect(firstUseGzip(g, "dday.js", gzip)).toBeGreaterThan(0);
    expect(firstUseGzip(g, "dday.js", gzip)).toBeLessThan(firstUseGzip(graph(noise(5000)), "dday.js", gzip));
  });

  // 94글자 난수는 글자당 약 6.55비트라 계획의 60000자는 gzip 약 49KB 로 51200 을 넘지 못한다 — 70000자를 쓴다
  it("기준을 넘으면 over", () => {
    expect(INLINE_WIDGET_GZIP_LIMIT).toBe(51200);
    const [big] = inlineWidgetSizes(graph(noise(70000)), gzip);
    expect(big).toMatchObject({ fileName: "dday.js", facade: "/w/web/src/widgets/inline/dday.ts", over: true });
    expect(big!.bytes).toBeGreaterThan(INLINE_WIDGET_GZIP_LIMIT);
    const [small] = inlineWidgetSizes(graph(), gzip);
    expect(small!.over).toBe(false);
  });

  it("인라인 청크가 없으면 throw(정적으로 묶여 지연 불러오기가 깨진 것)", () => {
    expect(() =>
      inlineWidgetSizes(
        graph().filter((c) => c.fileName !== "dday.js"),
        gzip,
      ),
    ).toThrow();
  });
});
