import { defineConfig } from "vitest/config";

// 같은 저장소의 core 패키지는 빌드 없이 TypeScript 원본을 쓴다
export default defineConfig({
  resolve: { conditions: ["keyring-source"] },
  ssr: { resolve: { conditions: ["keyring-source"] } },
  test: {
    env: {
      // git이 커밋 뒤 백그라운드로 띄우는 자동 정비(repack 등)가 테스트 정리(rm -rf) 중인 .history에 써서
      // ENOTEMPTY가 나지 않게 끈다(macOS·git 2.54에서 재현)
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "maintenance.auto",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "gc.auto",
      GIT_CONFIG_VALUE_1: "0",
      // 볼트 언어를 정하지 않은 시험 볼트는 한국어로 쓴다(커밋 메시지·위키 목차). 영어는 테스트마다 따로 본다
      KEYRING_LANG: "ko",
    },
  },
});
