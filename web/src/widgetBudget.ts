import { gzipSync } from "node:zlib";

/**
 * 인라인 위젯의 처음 불러오는 크기 기준(설계 「인라인/iframe 기준」 첫째 줄 — 압축 약 50KB). vite.config.ts 의 inlineWidgetBudget 이 빌드에서 잰다.
 * 넘으면 빌드를 떨어뜨린다: 줄이거나 isolation: "frame" 으로 옮긴다.
 */
export const INLINE_WIDGET_GZIP_LIMIT = 51200;
export const INLINE_WIDGET_DIR = "/src/widgets/inline/";

export interface BudgetChunk {
  fileName: string;
  code: string;
  imports: string[];
  isEntry: boolean;
  facadeModuleId: string | null;
}

function staticClosure(byName: Map<string, BudgetChunk>, starts: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const i of byName.get(name)?.imports ?? []) stack.push(i);
  }
  return seen;
}

/** target 청크를 처음 쓸 때 새로 받는 파일: target 과 그 정적 imports(재귀) 중 진입 청크들의 정적 그래프에 없는 것 */
export function firstUseFiles(chunks: BudgetChunk[], target: string): string[] {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const loaded = staticClosure(
    byName,
    chunks.filter((c) => c.isEntry).map((c) => c.fileName),
  );
  return [...staticClosure(byName, [target])].filter((f) => !loaded.has(f));
}

/** 그 파일들의 gzip 길이 합 */
export function firstUseGzip(chunks: BudgetChunk[], target: string): number {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  return firstUseFiles(chunks, target).reduce((n, f) => n + gzipSync(byName.get(f)?.code ?? "").length, 0);
}

/** facade 가 INLINE_WIDGET_DIR 안인 청크마다 크기. 그런 청크가 없으면 throw — 위젯이 정적으로 묶여 지연 불러오기가 깨진 것 */
export function inlineWidgetSizes(chunks: BudgetChunk[]): { fileName: string; facade: string; bytes: number; over: boolean }[] {
  const out = chunks
    .filter((c) => c.facadeModuleId?.replace(/\\/g, "/").includes(INLINE_WIDGET_DIR))
    .map((c) => {
      const bytes = firstUseGzip(chunks, c.fileName);
      return { fileName: c.fileName, facade: c.facadeModuleId!, bytes, over: bytes > INLINE_WIDGET_GZIP_LIMIT };
    });
  if (!out.length)
    throw new Error(`no inline widget chunk (${INLINE_WIDGET_DIR}) — a widget may be bundled statically, so it is no longer loaded on first use`);
  return out;
}
