import type { Choice, Holders, ManualNotice } from "../src/licenseNotices.ts";

/**
 * 손으로 덧붙이는 고지. 자동 수집은 번들의 import 그래프(web)와 package.json 의존성(server)·cargo 의존성(app)만 본다 —
 * 그래프 밖에서 들어오는 것은 여기에 이유와 함께 적는다. 넣어야 하는 경우는 docs/guides/development.md 「의존성과 라이선스 고지」 절.
 *
 * 어긋남은 빌드가 알아챈다: package 가 설치돼 있지 않거나 data·bundled 의 via 가 없으면 빌드가 멈추고,
 * package 가 자동 수집에도 잡히면(그래프에 들어왔으면) 손 목록에서 지우라고 멈춘다.
 * 묶여 실린 것(bundled)은 빌드가 출력에 쓰인 패키지 파일의 동봉 소스맵을 읽어, 고지에 없는 것이 있으면 멈춘다 —
 * 소스맵이 없는 묶음(roughjs)과 네이티브 바이너리(Skia)는 그 검사가 못 보므로 직접 찾아 넣은 것이다.
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
  {
    kind: "bundled",
    name: "langium",
    license: "MIT",
    textFile: "bundled/langium.txt",
    via: "@mermaid-js/parser",
    parts: ["web"],
    why: "@mermaid-js/parser 의 배포 파일이 미리 묶어 담는다 — 그 파일의 동봉 소스맵 sources 에 node_modules/langium/ 가 있다. 전문은 npm 의 langium 패키지에서 받았다",
  },
  {
    kind: "bundled",
    name: "chevrotain",
    license: "Apache-2.0",
    textFile: "bundled/chevrotain.txt",
    via: "@mermaid-js/parser",
    parts: ["web"],
    why: "@mermaid-js/parser 의 배포 파일이 미리 묶어 담는다 — 그 파일의 동봉 소스맵 sources 에 node_modules/chevrotain/ 가 있다. 전문은 npm 의 chevrotain 패키지에서 받았다",
  },
  {
    kind: "bundled",
    name: "@chevrotain/gast",
    license: "Apache-2.0",
    textFile: "bundled/chevrotain.txt",
    via: "@mermaid-js/parser",
    parts: ["web"],
    why: "@mermaid-js/parser 의 배포 파일이 미리 묶어 담는다 — 그 파일의 동봉 소스맵 sources 에 node_modules/@chevrotain/gast/ 가 있다. 전문은 npm 의 @chevrotain/gast 패키지에서 받았다",
  },
  {
    kind: "bundled",
    name: "@chevrotain/regexp-to-ast",
    license: "Apache-2.0",
    textFile: "bundled/chevrotain.txt",
    via: "@mermaid-js/parser",
    parts: ["web"],
    why: "@mermaid-js/parser 의 배포 파일이 미리 묶어 담는다 — 그 파일의 동봉 소스맵 sources 에 node_modules/@chevrotain/regexp-to-ast/ 가 있다. 전문은 npm 의 @chevrotain/regexp-to-ast 패키지에서 받았다",
  },
  {
    kind: "bundled",
    name: "@chevrotain/utils",
    license: "Apache-2.0",
    textFile: "bundled/chevrotain.txt",
    via: "@mermaid-js/parser",
    parts: ["web"],
    why: "@mermaid-js/parser 의 배포 파일이 미리 묶어 담는다 — 그 파일의 동봉 소스맵 sources 에 node_modules/@chevrotain/utils/ 가 있다. 전문은 npm 의 @chevrotain/utils 패키지에서 받았다",
  },
  {
    kind: "bundled",
    name: "chevrotain-allstar",
    license: "MIT",
    textFile: "bundled/chevrotain-allstar.txt",
    via: "@mermaid-js/parser",
    parts: ["web"],
    why: "@mermaid-js/parser 의 배포 파일이 미리 묶어 담는다 — 그 파일의 동봉 소스맵 sources 에 node_modules/chevrotain-allstar/ 가 있다. 전문은 npm 의 chevrotain-allstar 패키지에서 받았다",
  },
  {
    kind: "bundled",
    name: "vscode-jsonrpc",
    license: "MIT",
    textFile: "bundled/vscode-languageserver-node.txt",
    via: "@mermaid-js/parser",
    parts: ["web"],
    why: "@mermaid-js/parser 의 배포 파일이 미리 묶어 담는다 — 그 파일의 동봉 소스맵 sources 에 node_modules/vscode-jsonrpc/ 가 있다. 전문은 npm 의 vscode-jsonrpc 패키지에서 받았다",
  },
  {
    kind: "bundled",
    name: "vscode-languageserver-protocol",
    license: "MIT",
    textFile: "bundled/vscode-languageserver-node.txt",
    via: "@mermaid-js/parser",
    parts: ["web"],
    why: "@mermaid-js/parser 의 배포 파일이 미리 묶어 담는다 — 그 파일의 동봉 소스맵 sources 에 node_modules/vscode-languageserver-protocol/ 가 있다. 전문은 npm 의 vscode-languageserver-protocol 패키지에서 받았다",
  },
  {
    kind: "bundled",
    name: "vscode-languageserver-textdocument",
    license: "MIT",
    textFile: "bundled/vscode-languageserver-node.txt",
    via: "@mermaid-js/parser",
    parts: ["web"],
    why: "@mermaid-js/parser 의 배포 파일이 미리 묶어 담는다 — 그 파일의 동봉 소스맵 sources 에 node_modules/vscode-languageserver-textdocument/ 가 있다. 전문은 npm 의 vscode-languageserver-textdocument 패키지에서 받았다",
  },
  {
    kind: "bundled",
    name: "vscode-languageserver-types",
    license: "MIT",
    textFile: "bundled/vscode-languageserver-node.txt",
    via: "@mermaid-js/parser",
    parts: ["web"],
    why: "@mermaid-js/parser 의 배포 파일이 미리 묶어 담는다 — 그 파일의 동봉 소스맵 sources 에 node_modules/vscode-languageserver-types/ 가 있다. 전문은 npm 의 vscode-languageserver-types 패키지에서 받았다",
  },
  {
    kind: "bundled",
    name: "path-browserify",
    license: "MIT",
    textFile: "bundled/path-browserify.txt",
    via: "@mermaid-js/parser",
    parts: ["web"],
    why: "@mermaid-js/parser 의 배포 파일이 미리 묶어 담는다 — 그 파일의 동봉 소스맵 sources 에 node_modules/path-browserify/ 가 있다. 전문은 npm 의 path-browserify 패키지에서 받았다",
  },
  {
    kind: "bundled",
    name: "js-yaml",
    license: "MIT",
    textFile: "bundled/js-yaml.txt",
    via: "mermaid",
    parts: ["web"],
    why: "mermaid 의 배포 파일이 미리 묶어 담는다 — 그 파일의 동봉 소스맵 sources 에 node_modules/js-yaml/ 가 있다. 전문은 npm 의 js-yaml 패키지에서 받았다",
  },
  {
    kind: "bundled",
    name: "core-js",
    license: "MIT",
    textFile: "bundled/core-js.txt",
    via: "pdfjs-dist",
    parts: ["web"],
    why: "pdfjs-dist 의 배포 파일이 미리 묶어 담는다 — 그 파일의 동봉 소스맵 sources 에 node_modules/core-js/ 가 있다. 전문은 npm 의 core-js 패키지에서 받았다",
  },
  {
    kind: "bundled",
    name: "hachure-fill",
    license: "MIT",
    textFile: "bundled/hachure-fill.txt",
    via: "roughjs",
    parts: ["web"],
    why: "roughjs 가 싣는 bundled/rough.esm.js 는 이 패키지를 import 없이 미리 묶어 담는다. 소스맵이 없어 빌드 검사가 못 본다(rough.esm.js 의 코드와 roughjs 의 package.json 의존성으로 확인)",
  },
  {
    kind: "bundled",
    name: "path-data-parser",
    license: "MIT",
    textFile: "bundled/points-on-curve.txt",
    via: "roughjs",
    parts: ["web"],
    why: "roughjs 가 싣는 bundled/rough.esm.js 는 이 패키지를 import 없이 미리 묶어 담는다. 소스맵이 없어 빌드 검사가 못 본다(rough.esm.js 의 코드와 roughjs 의 package.json 의존성으로 확인)",
  },
  {
    kind: "bundled",
    name: "points-on-curve",
    license: "MIT",
    textFile: "bundled/points-on-curve.txt",
    via: "roughjs",
    parts: ["web"],
    why: "roughjs 가 싣는 bundled/rough.esm.js 는 이 패키지를 import 없이 미리 묶어 담는다. 소스맵이 없어 빌드 검사가 못 본다(rough.esm.js 의 코드와 roughjs 의 package.json 의존성으로 확인)",
  },
  {
    kind: "bundled",
    name: "points-on-path",
    license: "MIT",
    textFile: "bundled/points-on-path.txt",
    via: "roughjs",
    parts: ["web"],
    why: "roughjs 가 싣는 bundled/rough.esm.js 는 이 패키지를 import 없이 미리 묶어 담는다. 소스맵이 없어 빌드 검사가 못 본다(rough.esm.js 의 코드와 roughjs 의 package.json 의존성으로 확인)",
  },
  {
    kind: "bundled",
    name: "Skia",
    license: "BSD-3-Clause",
    textFile: "bundled/skia.txt",
    via: "@napi-rs/canvas",
    parts: ["server"],
    why: "@napi-rs/canvas 의 플랫폼 패키지(@napi-rs/canvas-<플랫폼>)가 싣는 skia.*.node 에 Skia 가 정적으로 링크돼 있다. 네이티브 바이너리라 빌드 검사가 못 본다. 전문은 https://github.com/google/skia/blob/main/LICENSE. Skia 가 다시 싣는 하위 라이브러리는 확인하지 않았다",
  },
  {
    kind: "bundled",
    name: "PDF.js",
    license: "Apache-2.0",
    textFile: "bundled/pdf.js.txt",
    via: "unpdf",
    parts: ["server"],
    why: "unpdf 의 dist/pdfjs.mjs 가 pdf.js(서버리스 빌드)를 미리 묶어 담는다. 소스맵이 없어 빌드 검사가 못 본다. 전문은 pdfjs-dist 의 LICENSE 와 같은 Apache-2.0",
  },
];

/**
 * 여러 라이선스 중 하나를 고를 수 있는 패키지에서 고른 것(패키지 이름 → SPDX id). 고지 줄에 「used under <id>」 로 적힌다.
 * 패키지가 빠지거나 라이선스가 바뀌어 고른 id 가 식에 없으면 빌드가 멈춘다.
 */
export const LICENSE_CHOICES: Record<string, Choice> = {
  // (MPL-2.0 OR Apache-2.0): 파일 단위 카피레프트(MPL)의 소스 제공 의무를 지지 않도록 Apache-2.0 을 고른다
  dompurify: { license: "Apache-2.0", part: "web" },
  // (Zlib OR Apache-2.0 OR MIT), 라이선스 파일·저작권자 메타데이터가 없는 크레이트: 실행 형태 배포에 저작권 줄을 요구하지 않는 Apache-2.0 을 고른다
  "objc2-app-kit": { license: "Apache-2.0", part: "app" },
  "objc2-core-foundation": { license: "Apache-2.0", part: "app" },
  "objc2-core-graphics": { license: "Apache-2.0", part: "app" },
  "objc2-io-surface": { license: "Apache-2.0", part: "app" },
  "objc2-osa-kit": { license: "Apache-2.0", part: "app" },
  "objc2-quartz-core": { license: "Apache-2.0", part: "app" },
  "objc2-web-kit": { license: "Apache-2.0", part: "app" },
};

/**
 * 라이선스 파일도 메타데이터의 저작권자도 없는 패키지의 저작권자(패키지 이름 → 이름들). 표준 전문의 저작권 자리에 들어간다 — MIT·BSD 는 저작권 줄이 조건이다.
 * 패키지가 빠지거나 라이선스 파일을 싣게 되면 빌드가 멈춘다.
 */
export const HOLDERS: Record<string, Holders> = {
  // MIT 단독. 크레이트(0.3.2)와 그 태그의 원저장소에는 저작권 줄이 없고, 원저장소 LICENSE-MIT.txt 가 「Copyright 2026 Mads Marquart」 다
  // (https://github.com/madsmtm/objc2/blob/main/LICENSE-MIT.txt)
  "objc2-foundation": { holders: ["Mads Marquart"], part: "app" },
};
