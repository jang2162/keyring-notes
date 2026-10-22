import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Logger, Plugin } from "vite";
import {
  applyChoices,
  cargoTargets,
  cratesFromMetadata,
  isLicenseFile,
  licenseField,
  manualConflicts,
  mergeNotices,
  packageOfModule,
  renderNotices,
  walkPackages,
  holderNames,
  withStandardText,
  type CargoMetadata,
  type Notice,
  type NoticePart,
} from "../src/licenseNotices.ts";
import { LICENSE_CHOICES, MANUAL_NOTICES } from "./manual.ts";

type PackageJson = {
  name?: string;
  version?: string;
  license?: unknown;
  licenses?: unknown;
  repository?: string | { url?: string };
  homepage?: string;
  author?: unknown;
  contributors?: unknown[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const readJson = (file: string): PackageJson => JSON.parse(readFileSync(file, "utf8"));

/** 폴더 맨 위의 라이선스 파일들(이름 순). 따로 지정된 파일(cargo 의 license-file)이 있으면 그것도 */
function licenseTexts(dir: string, extra?: string | null): string[] {
  const files = readdirSync(dir)
    .filter((f) => isLicenseFile(f) && statSync(path.join(dir, f)).isFile())
    .sort()
    .map((f) => path.join(dir, f));
  if (extra) {
    const file = path.resolve(dir, extra);
    if (existsSync(file) && !files.includes(file)) files.push(file);
  }
  return files.map((f) => readFileSync(f, "utf8"));
}

function npmNotice(dir: string, parts: NoticePart[]): Notice {
  const pkg = readJson(path.join(dir, "package.json"));
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return {
    name: pkg.name ?? path.basename(dir),
    version: pkg.version ?? "0.0.0",
    license: licenseField(pkg),
    texts: licenseTexts(dir),
    parts,
    source: repo ?? pkg.homepage ?? `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`,
    holders: holderNames([pkg.author, ...(pkg.contributors ?? [])]),
  };
}

/** Node 의 해석 규칙대로 from 폴더에서 위로 올라가며 node_modules/<name> 을 찾는다(pnpm 의 링크는 실제 경로로) */
function resolvePackage(from: string, name: string): string | null {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
    if (path.dirname(dir) === dir) return null;
  }
}

/** 웹 번들: 내보내는 청크의 모듈과 자산의 원본 파일(글꼴·`?url` 로 싣는 pdf.js 워커 등)이 든 패키지 */
function bundlePackages(root: string, bundle: Record<string, { type: string; moduleIds?: string[]; originalFileNames?: string[] }>): string[] {
  const dirs = new Set<string>();
  for (const out of Object.values(bundle)) {
    const ids = out.type === "chunk" ? (out.moduleIds ?? []) : (out.originalFileNames ?? []).map((f) => path.resolve(root, f));
    for (const id of ids) {
      const pkg = packageOfModule(id);
      if (pkg && existsSync(path.join(pkg.dir, "package.json"))) dirs.add(pkg.dir);
    }
  }
  return [...dirs];
}

/** 서버 이미지의 실행 의존성: server 와 그것이 쓰는 워크스페이스 패키지에서 dependencies·optionalDependencies·필수 peer 를 따라간다(Dockerfile 의 `--prod` 설치와 같은 범위) */
function serverPackages(repo: string): string[] {
  const start = [path.join(repo, "server")];
  const all = walkPackages(start, (dir) => {
    const pkg = readJson(path.join(dir, "package.json"));
    const optional = new Set([
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...Object.entries(pkg.peerDependenciesMeta ?? {})
        .filter(([, m]) => m.optional)
        .map(([n]) => n),
    ]);
    const names = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
    return [...names].flatMap((name) => {
      const found = resolvePackage(dir, name);
      if (!found && !optional.has(name) && !(pkg.peerDependencies && name in pkg.peerDependencies))
        throw new Error(`라이선스 고지: ${pkg.name} 의 의존성 ${name} 이 설치돼 있지 않다(pnpm install)`);
      return found ? [found] : [];
    });
  });
  return all.filter((dir) => packageOfModule(`${dir}/package.json`));
}

/** 앱(Tauri) 실행 파일의 크레이트. cargo 는 Rust 기본 도구라 따로 설치할 것이 없다 */
function appCrates(repo: string, triple: string): Notice[] {
  const args = ["metadata", "--format-version", "1", "--locked", "--manifest-path", path.join(repo, "app/src-tauri/Cargo.toml")];
  for (const t of cargoTargets(triple)) args.push("--filter-platform", t);
  const meta = JSON.parse(execFileSync("cargo", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })) as CargoMetadata;
  return cratesFromMetadata(meta).map((c) => ({
    name: c.name,
    version: c.version,
    license: c.license,
    texts: licenseTexts(c.dir, c.licenseFile),
    parts: ["app"],
    source: c.repository ?? `https://crates.io/crates/${c.name}/${c.version}`,
    holders: holderNames(c.authors),
  }));
}

/** 손 목록(manual.ts)을 고지로. 설치돼 있지 않으면 멈춘다 — 의존성에서 빠졌는데 손 목록에 남은 것 */
function manualNotices(webRoot: string, auto: Notice[]): Notice[] {
  const stale = manualConflicts(MANUAL_NOTICES, auto);
  if (stale.length) throw new Error(`라이선스 고지: ${stale.join(", ")} 은 이제 자동으로 모인다 — web/licenses/manual.ts 에서 지운다`);
  const need = (name: string) => {
    const dir = resolvePackage(webRoot, name);
    if (!dir) throw new Error(`라이선스 고지: 손 목록의 ${name} 이 web 의 의존성에 없다 — web/licenses/manual.ts 를 고친다`);
    return dir;
  };
  return MANUAL_NOTICES.map((m) => {
    if (m.kind === "package") return npmNotice(need(m.package), m.parts);
    const via = npmNotice(need(m.via), m.parts);
    return {
      name: m.name,
      version: `via ${via.name} ${via.version}`,
      license: m.license,
      texts: [readFileSync(new URL(m.textFile, import.meta.url), "utf8")],
      parts: m.parts,
    };
  });
}

/** 라이선스 파일을 싣지 않은 패키지에 붙일 표준 전문(licenses/spdx/<id>.txt, SPDX License List 에서 받은 그대로) */
function standardTexts(): Record<string, string> {
  const dir = new URL("./spdx/", import.meta.url);
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => [f.slice(0, -4), readFileSync(new URL(f, dir), "utf8")]),
  );
}

/**
 * 빌드 결과에 `licenses.txt`(제3자 라이선스 고지)를 낸다. 서버는 정적 파일로 내주고, 앱은 번들에 든 것을 연다.
 * Tauri 가 부른 빌드(beforeBuildCommand — TAURI_ENV_TARGET_TRIPLE 이 있다)면 서버 대신 앱의 Rust 크레이트를 싣는다:
 * 앱에는 서버의 node_modules 가 들어가지 않고, Docker 이미지에는 Rust 가 들어가지 않는다.
 */
export function licenseNotices(): Plugin {
  let webRoot = "";
  let logger: Logger | undefined;
  return {
    name: "keyring-license-notices",
    apply: "build",
    configResolved(c) {
      webRoot = c.root;
      logger = c.logger;
    },
    generateBundle(_, bundle) {
      const repo = path.resolve(webRoot, "..");
      const triple = process.env.TAURI_ENV_TARGET_TRIPLE;
      const web = bundlePackages(webRoot, bundle as never).map((dir) => npmNotice(dir, ["web"]));
      const other = triple ? appCrates(repo, triple) : serverPackages(repo).map((dir) => npmNotice(dir, ["server"]));
      const auto = [...web, ...other];
      const chosen = applyChoices(mergeNotices([...auto, ...manualNotices(webRoot, auto)]), LICENSE_CHOICES);
      if (chosen.problems.length)
        throw new Error(`라이선스 고지: web/licenses/manual.ts 의 LICENSE_CHOICES 가 실제와 어긋난다 — ${chosen.problems.join("; ")}`);
      const standard = standardTexts();
      const filled = chosen.notices.map((n) => withStandardText(n, standard));
      const missing = filled.filter((f) => f.missing.length).map((f) => `${f.notice.name} ${f.notice.version} (${f.missing.join(", ")})`);
      if (missing.length) throw new Error(`라이선스 고지: 라이선스 파일이 없고 표준 전문(web/licenses/spdx/)도 없는 패키지 — ${missing.join("; ")}`);
      const notices = filled.map((f) => f.notice);
      const version = readJson(path.join(repo, "package.json")).version ?? "";
      const source = renderNotices(notices, version);
      this.emitFile({ type: "asset", fileName: "licenses.txt", source });
      const count = (p: NoticePart) => notices.filter((n) => n.parts.includes(p)).length;
      const standardOnly = notices.filter((n) => n.standard);
      const noHolder = standardOnly.filter((n) => !n.holders?.length).map((n) => n.name);
      logger?.info(
        `licenses.txt: web ${count("web")}, ${triple ? `app ${count("app")} (${triple})` : `server ${count("server")}`}, 표준 전문 ${standardOnly.length}(저작권자 없음 ${noHolder.length}${noHolder.length ? `: ${noHolder.join(", ")}` : ""}), ${(source.length / 1024).toFixed(0)} KB`,
      );
    },
  };
}
