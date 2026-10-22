import { describe, expect, it } from "vitest";
import {
  applyChoices,
  cargoTargets,
  cratesFromMetadata,
  holderNames,
  isLicenseFile,
  licenseField,
  manualConflicts,
  mergeNotices,
  normalizeText,
  packageOfModule,
  renderNotices,
  spdxIds,
  walkPackages,
  withStandardText,
  type CargoMetadata,
  type ManualNotice,
  type Notice,
} from "./licenseNotices";

const notice = (name: string, over: Partial<Notice> = {}): Notice => ({
  name,
  version: "1.0.0",
  license: "MIT",
  texts: [`${name} text`],
  parts: ["web"],
  ...over,
});

describe("모듈 경로 → 패키지", () => {
  it("pnpm 경로는 마지막 node_modules 뒤의 이름이다(일반·scope)", () => {
    expect(packageOfModule("/r/node_modules/.pnpm/react@19.3.0/node_modules/react/cjs/react.js")).toEqual({
      dir: "/r/node_modules/.pnpm/react@19.3.0/node_modules/react",
      name: "react",
    });
    expect(packageOfModule("/r/node_modules/.pnpm/@codemirror+view@6/node_modules/@codemirror/view/dist/index.js")).toEqual({
      dir: "/r/node_modules/.pnpm/@codemirror+view@6/node_modules/@codemirror/view",
      name: "@codemirror/view",
    });
  });

  it("가상 모듈 표시(\\0)와 ?url 같은 꼬리, 윈도 경로를 걷어 낸다", () => {
    expect(packageOfModule("\0/r/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")?.name).toBe("pdfjs-dist");
    expect(packageOfModule("C:\\r\\node_modules\\katex\\dist\\katex.css")).toEqual({ dir: "C:/r/node_modules/katex", name: "katex" });
    // 꼬리 안의 경로에 끌려가지 않는다: 저장소 코드에 붙은 질의가 node_modules 를 가리켜도 저장소 코드다
    expect(packageOfModule("/r/web/src/a.ts?importer=/r/node_modules/react/index.js")).toBeNull();
    expect(packageOfModule("/r/node_modules/foo?commonjs-entry")?.name).toBe("foo");
  });

  it("저장소의 코드와 패키지가 아닌 node_modules 자리는 null", () => {
    expect(packageOfModule("/r/web/src/main.tsx")).toBeNull();
    expect(packageOfModule("\0virtual:emoji-data")).toBeNull();
    expect(packageOfModule("/r/node_modules/.pnpm/lock.yaml")).toBeNull();
    expect(packageOfModule("/r/node_modules/@scope")).toBeNull();
  });
});

describe("라이선스 파일·필드", () => {
  it("LICENSE·LICENCE·COPYING·NOTICE·UNLICENSE 와 꼬리 붙은 이름은 라이선스 파일이고 코드·README 는 아니다", () => {
    for (const f of ["LICENSE", "license", "LICENSE.md", "LICENSE-MIT", "LICENSE-APACHE", "LICENCE.txt", "COPYING", "NOTICE", "UNLICENSE"])
      expect(isLicenseFile(f), f).toBe(true);
    for (const f of ["license.js", "LICENSE.json", "licenses.d.ts", "README.md", "package.json", "license.rs"]) expect(isLicenseFile(f), f).toBe(false);
  });

  it("license 문자열·{type}·옛 licenses 배열, 없으면 UNKNOWN", () => {
    expect(licenseField({ license: "MIT" })).toBe("MIT");
    expect(licenseField({ license: { type: "ISC" } })).toBe("ISC");
    expect(licenseField({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe("(MIT OR Apache-2.0)");
    expect(licenseField({ licenses: ["BSD-3-Clause"] })).toBe("BSD-3-Clause");
    expect(licenseField({})).toBe("UNKNOWN");
  });
});

describe("의존성 따라가기", () => {
  it("시작 폴더부터 모든 의존성을 한 번씩(고리가 있어도 끝난다)", () => {
    const graph: Record<string, string[]> = { server: ["a", "b"], a: ["c"], b: ["c", "a"], c: ["a"], x: ["y"] };
    expect(walkPackages(["server"], (d) => graph[d] ?? []).sort()).toEqual(["a", "b", "c", "server"]);
  });

  const pkg = (id: string, source: string | null = "registry", over = {}) => ({
    id,
    name: id,
    version: "1.0.0",
    license: "MIT",
    license_file: null,
    manifest_path: `/cargo/${id}/Cargo.toml`,
    repository: null,
    source,
    ...over,
  });
  const meta: CargoMetadata = {
    packages: [
      pkg("app", null),
      pkg("tauri"),
      pkg("serde"),
      pkg("tauri-build"),
      pkg("build-only-dep"),
      pkg("dev-only"),
      pkg("local-crate", null),
      pkg("odd", "registry", { license: null, license_file: "LICENSE.txt", authors: ["Jane <j@x>"] }),
    ],
    resolve: {
      root: "app",
      nodes: [
        {
          id: "app",
          deps: [
            { pkg: "tauri", dep_kinds: [{ kind: null }] },
            { pkg: "tauri-build", dep_kinds: [{ kind: "build" }] },
            { pkg: "dev-only", dep_kinds: [{ kind: "dev" }] },
            { pkg: "local-crate", dep_kinds: [{ kind: null }] },
          ],
        },
        { id: "tauri", deps: [{ pkg: "serde", dep_kinds: [{ kind: "build" }, { kind: null }] }] },
        { id: "tauri-build", deps: [{ pkg: "build-only-dep", dep_kinds: [{ kind: null }] }] },
        { id: "local-crate", deps: [{ pkg: "odd", dep_kinds: [{ kind: null }] }] },
        { id: "serde", deps: [] },
        { id: "build-only-dep", deps: [] },
        { id: "dev-only", deps: [] },
        { id: "odd", deps: [] },
      ],
    },
  };

  it("크레이트는 일반 의존성만 따라가고(빌드·개발 의존성과 그 아래는 빼고) 경로 의존성 자신은 뺀다", () => {
    const crates = cratesFromMetadata(meta);
    expect(crates.map((c) => c.name).sort()).toEqual(["odd", "serde", "tauri"]);
    const odd = crates.find((c) => c.name === "odd")!;
    expect(odd).toMatchObject({ license: "SEE LICENSE IN LICENSE.txt", licenseFile: "LICENSE.txt", dir: "/cargo/odd", authors: ["Jane <j@x>"] });
  });

  it("작업 공간 매니페스트(root 없음)는 알린다", () => {
    expect(() => cratesFromMetadata({ ...meta, resolve: { ...meta.resolve, root: null } })).toThrow(/resolve\.root/);
  });

  it("universal 빌드는 두 아키텍처, 그 밖은 그대로", () => {
    expect(cargoTargets("universal-apple-darwin")).toEqual(["aarch64-apple-darwin", "x86_64-apple-darwin"]);
    expect(cargoTargets("aarch64-apple-ios")).toEqual(["aarch64-apple-ios"]);
  });
});

describe("SPDX 식·저작권자·표준 전문", () => {
  it("OR·AND·옛 / 표기의 id 를 모두, WITH 뒤 예외는 빼고", () => {
    expect(spdxIds("MIT/Apache-2.0")).toEqual(["MIT", "Apache-2.0"]);
    expect(spdxIds("(MIT OR Apache-2.0) AND Unicode-3.0")).toEqual(["MIT", "Apache-2.0", "Unicode-3.0"]);
    expect(spdxIds("Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT")).toEqual(["Apache-2.0", "MIT"]);
  });

  it("저작권자는 이름만(전자 우편·주소 빼고), 중복 없이", () => {
    expect(holderNames(["Mads Marquart <mads@marquart.dk>", { name: "Wilson Page", email: "w@x" }, "A (https://a.dev)", undefined, "Mads Marquart"])).toEqual([
      "Mads Marquart",
      "Wilson Page",
      "A",
    ]);
  });

  const standard = {
    MIT: "MIT License\n\nCopyright (c) <year> <copyright holders>\n\nPermission is hereby granted",
    "BSD-3-Clause": "Copyright (c) <year> <owner>. \n\nRedistribution and use",
    Zlib: "zlib License\n\nThis software is provided 'as-is'",
    "Apache-2.0": "Apache License\nVersion 2.0",
  };

  it("라이선스 파일이 없으면 표준 전문의 저작권 자리에 저작권자를 넣는다(MIT·BSD)", () => {
    const mit = withStandardText(notice("block2", { texts: [], holders: ["Mads Marquart"] }), standard);
    expect(mit.missing).toEqual([]);
    expect(mit.notice.standard).toBe(true);
    expect(mit.notice.texts.join("\n")).toContain("MIT License\n\nCopyright (c) Mads Marquart\n\nPermission");
    expect(mit.notice.texts.join("\n")).not.toContain("<year>");
    const bsd = withStandardText(notice("alloc-stdlib", { license: "BSD-3-Clause", texts: [], holders: ["Daniel"] }), standard);
    expect(bsd.notice.texts.join("\n")).toMatch(/^Copyright \(c\) Daniel\n\nRedistribution/m);
  });

  it("OR 식은 갈래마다 전문을 싣고, 저작권 자리가 없는 전문만이면 저작권자를 맨 앞 한 줄로", () => {
    const all = withStandardText(notice("dispatch2", { license: "Zlib OR Apache-2.0 OR MIT", texts: [], holders: ["M"] }), standard).notice.texts.join("\n");
    expect(all).toContain("zlib License");
    expect(all).toContain("Apache License");
    expect(all).toContain("Copyright (c) M\n\nPermission");
    const zlib = withStandardText(notice("z", { license: "Zlib", texts: [], holders: ["M"] }), standard).notice.texts;
    expect(zlib[1]).toBe("Copyright (c) M");
  });

  it("저작권자를 못 찾으면 그렇다고 적고 소스 주소를 남긴다", () => {
    const n = withStandardText(notice("objc2-app-kit", { texts: [], holders: [], source: "https://github.com/madsmtm/objc2" }), standard).notice;
    expect(n.texts.join("\n")).toContain("Copyright holder not stated in the package metadata; see https://github.com/madsmtm/objc2");
  });

  it("표준 전문이 없는 id 는 missing 으로, 이미 전문이 있으면 그대로", () => {
    expect(withStandardText(notice("x", { license: "MPL-2.0", texts: [] }), standard).missing).toEqual(["MPL-2.0"]);
    expect(withStandardText(notice("y", { license: "UNKNOWN", texts: [] }), standard).missing).toEqual(["UNKNOWN"]);
    const has = notice("z");
    expect(withStandardText(has, standard).notice).toBe(has);
  });
});

describe("손 목록·선택·합치기", () => {
  const manual: ManualNotice[] = [
    { kind: "package", package: "emojibase-data", parts: ["web"], why: "fs" },
    { kind: "data", name: "CLDR", license: "Unicode-3.0", textFile: "u.txt", via: "emojibase-data", parts: ["web"], why: "data" },
  ];

  it("자동 수집이 이미 찾은 패키지가 손 목록에 있으면 알린다(data 는 대상이 아니다)", () => {
    expect(manualConflicts(manual, [notice("react")])).toEqual([]);
    expect(manualConflicts(manual, [notice("emojibase-data")])).toEqual(["emojibase-data"]);
  });

  it("고른 라이선스를 붙이고, 패키지가 없거나 식에 없는 id 면 문제로 돌려준다", () => {
    const list = [notice("dompurify", { license: "(MPL-2.0 OR Apache-2.0)" })];
    expect(applyChoices(list, { dompurify: "Apache-2.0" })).toEqual({ notices: [{ ...list[0], chosen: "Apache-2.0" }], problems: [] });
    expect(applyChoices(list, { dompurify: "MIT" }).problems).toEqual(["dompurify 1.0.0: (MPL-2.0 OR Apache-2.0) 에 MIT 가 없다"]);
    expect(applyChoices(list, { gone: "MIT" }).problems).toEqual(["gone: 목록에 없다"]);
  });

  it("같은 이름·판은 하나로: 조각은 합치고 전문은 먼저 찾은 것(없으면 뒤의 것)", () => {
    const merged = mergeNotices([
      notice("yaml", { texts: [] }),
      notice("yaml", { parts: ["server"], texts: ["yaml text"] }),
      notice("yaml", { version: "2.0.0", parts: ["server"] }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ parts: ["web", "server"], texts: ["yaml text"] });
  });
});

describe("licenses.txt 글", () => {
  it("전문이 같은 패키지는 한 묶음(줄 끝 차이는 같은 것으로), 이름 순", () => {
    const text = renderNotices(
      [notice("zeta", { texts: ["MIT\r\nsame  \r\n"] }), notice("alpha", { texts: ["MIT\nsame"], parts: ["server"] }), notice("mid", { texts: ["other"] })],
      "1.2.3",
    );
    expect(text.match(/^={80}$/gm)).toHaveLength(2);
    expect(text).toContain(`alpha 1.0.0 — MIT  [server]\nzeta 1.0.0 — MIT  [web]\n${"-".repeat(80)}\nMIT\nsame`);
    expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("mid 1.0.0"));
    expect(text).toContain("Keyring Notes 1.2.3 — third-party software notices");
    expect(text).toMatch(/\[web\] Web app .*: 2\n {2}\[server\] Server .*: 1/);
    expect(text).not.toContain("[app]");
  });

  it("MPL-2.0 구성요소는 소스 주소를 줄에 적고 머리에 한 줄 밝힌다 — 다른 라이선스를 고른 것은 해당하지 않는다", () => {
    const mpl = renderNotices([notice("selectors", { license: "MPL-2.0", parts: ["app"], source: "https://github.com/servo/stylo" })], "1");
    expect(mpl).toContain("selectors 1.0.0 — MPL-2.0  [app]  https://github.com/servo/stylo");
    expect(mpl).toContain("The source code of each MPL-2.0 component is available");
    const chosen = renderNotices([notice("dompurify", { license: "(MPL-2.0 OR Apache-2.0)", chosen: "Apache-2.0", source: "https://x" })], "1");
    expect(chosen).toContain("dompurify 1.0.0 — (MPL-2.0 OR Apache-2.0), used under Apache-2.0  [web]\n");
    expect(chosen).not.toContain("MPL-2.0 component");
  });

  it("표준 전문을 붙인 것도 소스 주소를 적고, 라이선스를 적지 않은 패키지는 그렇다고 쓴다", () => {
    const text = renderNotices([notice("fastdom", { standard: true, source: "https://f" }), notice("khroma", { license: "UNKNOWN" })], "1");
    expect(text).toContain("fastdom 1.0.0 — MIT  [web]  https://f");
    expect(text).toContain("khroma 1.0.0 — license not declared in package metadata (see text below)  [web]");
  });

  it("전문이 빈 고지는 받지 않는다(표준 전문을 먼저 붙인다)", () => {
    expect(() => renderNotices([notice("bare", { texts: [] })], "1")).toThrow(/bare/);
  });

  it("전문 비교는 BOM·CRLF·줄 끝 공백·앞뒤 빈 줄만 맞춘다", () => {
    expect(normalizeText("\uFEFF\n\nA  \r\nB\r\n\n")).toBe("A\nB");
  });
});
