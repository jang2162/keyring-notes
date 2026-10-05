import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** 빌드마다 서비스 워커의 캐시 이름을 바꿔, 새 배포 때 예전 화면 캐시를 정리하게 한다. */
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
      writeFileSync(file, readFileSync(file, "utf8").replace("__KEYRING_BUILD__", build));
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  server: {
    proxy: { "/api": "http://127.0.0.1:8787", "/plugins": "http://127.0.0.1:8787" },
  },
});
