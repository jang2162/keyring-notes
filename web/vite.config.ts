import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { buildCatalog } from "./src/emojiCatalog.ts";
import { HAND_WORDS } from "./src/emojiWords.ts";

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
      const build = Date.now().toString(36);
      const lazy = readdirSync(path.join(outDir, "assets"))
        .filter((f) => /\.(m?js|css|woff2)$/.test(f))
        .map((f) => `/assets/${f}`);
      writeFileSync(file, readFileSync(file, "utf8").replace("__KEYRING_BUILD__", build).replace('"__KEYRING_LAZY__"', JSON.stringify(lazy)));
    },
  };
}

/**
 * 아이콘 고르기 창의 이모지 목록(`virtual:emoji-data`). emojibase-data 의 한·영 원본 두 벌(약 1.6MB)에서 쓰는 칸만 골라 싣는다.
 * 창을 처음 열 때 불러오는 청크가 되고, 위의 지연 자산 목록에도 들어가 오프라인에서도 열린다.
 */
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

export default defineConfig({
  plugins: [react(), stampServiceWorker(), emojiData()],
  // 같은 저장소의 core 패키지는 빌드 없이 TypeScript 원본을 쓴다
  resolve: { conditions: ["keyring-source", ...defaultClientConditions] },
  // 데스크톱·모바일 앱(Tauri) 개발 서버: 같은 화면을 띄운다
  clearScreen: false,
  server: {
    proxy: { "/api": "http://127.0.0.1:8787", "/plugins": "http://127.0.0.1:8787" },
  },
});
