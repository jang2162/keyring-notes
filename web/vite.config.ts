import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

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

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  // 같은 저장소의 core 패키지는 빌드 없이 TypeScript 원본을 쓴다
  resolve: { conditions: ["keyring-source", ...defaultClientConditions] },
  // 데스크톱·모바일 앱(Tauri) 개발 서버: 같은 화면을 띄운다
  clearScreen: false,
  server: {
    proxy: { "/api": "http://127.0.0.1:8787", "/plugins": "http://127.0.0.1:8787" },
  },
});
