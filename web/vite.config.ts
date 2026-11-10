/// <reference types="vitest/config" />
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { widgetFrames } from "./frameBuild.ts";
import { licenseNotices } from "./licenses/plugin.ts";
import { buildCatalog } from "./src/emojiCatalog.ts";
import { HAND_WORDS } from "./src/emojiWords.ts";
import { INLINE_WIDGET_GZIP_LIMIT, inlineWidgetSizes, type BudgetChunk } from "./src/widgetBudget.ts";

/**
 * 이 빌드의 id. 서비스 워커의 캐시 이름(stampServiceWorker)과 화면 번들(define 의 __KEYRING_BUILD__)이 같은 값을 써,
 * 열린 화면이 새 워커의 빌드가 자기와 다른지 알 수 있다(src/pwaUpdate.ts). 36진수 시각이라 크기 순서가 만든 순서다(public/sw.js 의 옛 캐시 정리)
 */
const BUILD = Date.now().toString(36);

/**
 * 빌드마다 서비스 워커의 캐시 이름을 바꿔, 새 배포 때 예전 화면 캐시를 정리하게 한다.
 * 나중에 불러오는 자산(수식 KaTeX·다이어그램 Mermaid·PDF 조각, woff2 글꼴) 목록도 넣어, 설치 뒤 틈틈이 받아 두게 한다(오프라인용).
 */
function stampServiceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "keyring-sw-stamp",
    apply: "build",
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const file = path.join(outDir, "sw.js");
      // 앞 단계(번들 쓰기 전)에서 빌드가 실패해도 closeBundle 은 돈다 — 번들이 없으면 건너뛰어 원래 오류를 가리지 않는다
      if (!existsSync(path.join(outDir, "assets"))) return;
      const lazy = readdirSync(path.join(outDir, "assets"))
        .filter((f) => /\.(m?js|css|woff2)$/.test(f))
        .map((f) => `/assets/${f}`);
      // 제3자 라이선스 고지(licenseNotices)도 오프라인에서 열리게
      if (existsSync(path.join(outDir, "licenses.txt"))) lazy.push("/licenses.txt");
      writeFileSync(file, readFileSync(file, "utf8").replace("__KEYRING_BUILD__", BUILD).replace('"__KEYRING_LAZY__"', JSON.stringify(lazy)));
    },
  };
}

/**
 * 아이콘 고르기 창의 이모지 목록(`virtual:emoji-data`). emojibase-data 의 한·영 원본 두 벌(약 1.6MB)에서 쓰는 칸만 골라 싣는다.
 * 창을 처음 열 때 불러오는 청크가 되고, 위의 지연 자산 목록에도 들어가 오프라인에서도 열린다.
 */
/**
 * 인라인 위젯(src/widgets/inline/)의 처음 불러오는 크기(gzip)를 재서 기준을 넘으면 빌드를 떨어뜨린다 — 기준과 이유는 src/widgetBudget.ts.
 * 리뷰 점검 넷(전역 이벤트·전역 CSS·키 가로채기·자체 실행 취소·DOM 수)은 이 시험이 보지 않는다.
 */
function inlineWidgetBudget(): Plugin {
  return {
    name: "keyring-inline-widget-budget",
    apply: "build",
    generateBundle(_, bundle) {
      const chunks: BudgetChunk[] = Object.values(bundle).flatMap((c) =>
        c.type === "chunk" ? [{ fileName: c.fileName, code: c.code, imports: c.imports, isEntry: c.isEntry, facadeModuleId: c.facadeModuleId }] : [],
      );
      for (const s of inlineWidgetSizes(chunks, (code) => gzipSync(code).length)) {
        if (s.over)
          this.error(
            `${s.facade}: ${s.bytes} B gzip > ${INLINE_WIDGET_GZIP_LIMIT} B — 인라인 기준을 넘는다(설계 「인라인/iframe 기준」). 줄이거나 isolation: "frame" 으로`,
          );
        this.info(`inline widget ${s.facade}: ${s.bytes} B gzip (limit ${INLINE_WIDGET_GZIP_LIMIT})`);
      }
    },
  };
}

function emojiData(): Plugin {
  const id = "virtual:emoji-data";
  const require = createRequire(import.meta.url);
  const read = (lang: string) => JSON.parse(readFileSync(require.resolve(`emojibase-data/${lang}/data.json`), "utf8"));
  return {
    name: "keyring-emoji-data",
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(file) {
      if (file !== `\0${id}`) return null;
      const catalog = buildCatalog(read("ko"), read("en"), HAND_WORDS);
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(catalog))});`;
    },
  };
}

/** keyring-widget iframe 묶음(/widget-frame/). dev 표시는 import.meta.env.DEV 와 같은 때(개발 서버·NODE_ENV=development 빌드)만 — 배포 빌드에는 없다 */
const frames = widgetFrames([
  { name: "runtime", entry: "src/widgets/frame/runtimeEntry.ts" },
  { name: "dday", entry: "src/widgets/frame/ddayEntry.ts", dev: true },
  {
    name: "excalidraw",
    entry: "src/widgets/excalidraw/frame.tsx",
    // Mermaid 변환(gzip 약 1MB)은 싣지 않는다
    alias: { "@excalidraw/mermaid-to-excalidraw": path.resolve(import.meta.dirname, "src/widgets/excalidraw/mermaidStub.ts") },
    css: "node_modules/@excalidraw/excalidraw/dist/prod/index.css",
    fontsDir: "node_modules/@excalidraw/excalidraw/dist/prod/fonts",
    // Xiaolai(CJK, 약 13MB)는 뺀다 — 한글은 시스템 글꼴로 보인다. Liberation(1.05 — GPLv2 + font exception)과
    // Excalifont(파일·원저장소에 라이선스 표기 없음)는 싣지 않는다(사용자 결정) — 그 글꼴로 쓴 글은 시스템 글꼴로 보인다
    fontsSkip: ["Xiaolai", "Liberation", "Excalifont"],
  },
]);

export default defineConfig({
  // frames 를 licenseNotices 앞에 둔다 — 고지 수집(generateBundle)이 iframe 묶음의 모듈까지 본다
  plugins: [react(), stampServiceWorker(), emojiData(), frames, licenseNotices({ extraModules: () => frames.modules() }), inlineWidgetBudget()],
  define: { __KEYRING_BUILD__: JSON.stringify(BUILD) },
  // 시험에서 styles.css 만 CSS 처리를 켠다 — 끈 기본값에서는 styles.css?raw 가 빈 글이다(themeColor.test.ts 가 --bg 를 읽는다)
  test: { css: { include: [/styles\.css/] } },
  // 같은 저장소의 core 패키지는 빌드 없이 TypeScript 원본을 쓴다
  resolve: { conditions: ["keyring-source", ...defaultClientConditions] },
  // vitest 는 Node(ssr) 쪽 해석을 쓰므로 여기에도 둬야 시험이 dist 가 아닌 원본을 읽는다
  ssr: { resolve: { conditions: ["keyring-source"] } },
  // 데스크톱·모바일 앱(Tauri) 개발 서버: 같은 화면을 띄운다
  clearScreen: false,
  server: {
    proxy: { "/api": "http://127.0.0.1:8787", "/plugins": "http://127.0.0.1:8787" },
  },
});
