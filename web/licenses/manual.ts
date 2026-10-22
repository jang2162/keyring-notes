import type { ManualNotice } from "../src/licenseNotices.ts";

/**
 * 손으로 덧붙이는 고지. 자동 수집은 번들의 import 그래프(web)와 package.json 의존성(server)·cargo 의존성(app)만 본다 —
 * 그래프 밖에서 들어오는 것은 여기에 이유와 함께 적는다. 넣어야 하는 경우는 docs/guides/development.md 「의존성과 라이선스 고지」 절.
 *
 * 어긋남은 빌드가 알아챈다: package 가 설치돼 있지 않거나 data 의 via 가 없으면 빌드가 멈추고,
 * package 가 자동 수집에도 잡히면(그래프에 들어왔으면) 손 목록에서 지우라고 멈춘다.
 */
export const MANUAL_NOTICES: ManualNotice[] = [
  {
    kind: "package",
    package: "emojibase-data",
    parts: ["web"],
    why: "vite.config.ts 의 emojiData 플러그인이 fs 로 직접 읽어 `virtual:emoji-data` 청크에 싣는다 — import 그래프에 없다",
  },
  {
    kind: "data",
    name: "Unicode CLDR annotations (emoji names and keywords)",
    license: "Unicode-3.0",
    textFile: "unicode-license-v3.txt",
    via: "emojibase-data",
    parts: ["web"],
    why: "emojibase-data 의 이모지 이름(label)·낱말(tags)은 Unicode CLDR 주석 데이터에서 온다. CLDR 데이터는 Unicode License V3 이고 고지를 함께 실을 것을 조건으로 한다(https://github.com/unicode-org/cldr/blob/main/LICENSE). emojibase-data 의 LICENSE 는 MIT 만 적는다",
  },
];

/**
 * 여러 라이선스 중 하나를 고를 수 있는 패키지에서 고른 것(패키지 이름 → SPDX id). 고지 줄에 「used under <id>」 로 적힌다.
 * 패키지가 빠지거나 라이선스가 바뀌어 고른 id 가 식에 없으면 빌드가 멈춘다.
 */
export const LICENSE_CHOICES: Record<string, string> = {
  // (MPL-2.0 OR Apache-2.0): 파일 단위 카피레프트(MPL)의 소스 제공 의무를 지지 않도록 Apache-2.0 을 고른다
  dompurify: "Apache-2.0",
};
