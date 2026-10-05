import { defineConfig } from "vitest/config";

// 같은 저장소의 core 패키지는 빌드 없이 TypeScript 원본을 쓴다
export default defineConfig({ resolve: { conditions: ["keyring-source"] }, ssr: { resolve: { conditions: ["keyring-source"] } } });
