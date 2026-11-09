import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { build, defaultClientConditions, type Plugin } from "vite";
import { FRAME_DIR, frameAssetName, frameSizeErrors, inlineCssFonts, type FrameManifestEntry } from "./src/widgetFrames.ts";

/**
 * keyring-widget iframe 에 싣는 코드(런타임·내장 위젯)를 진입마다 IIFE 한 파일로 따로 빌드해 /widget-frame/ 에 낸다.
 * 앱 묶음과 섞지 않는 까닭: iframe 안에서는 부모가 건넨 글을 blob: 스크립트 하나로 실행하므로(bootstrap.ts) import 할 곳이 없다.
 * 주소 표는 `virtual:widget-frames`. 개발 서버는 같은 빌드를 한 번 돌려 메모리에서 낸다.
 * `/widget-frame/` 은 assets/ 밖이라 SW 의 설치 때 받기(LAZY)에 들지 않고 처음 쓸 때 SW 가 캐시한다.
 */
export interface FrameEntrySpec {
  name: string;
  entry: string;
  /** 개발 서버·개발 모드 빌드에서만(예: D-day 를 iframe 으로 견주는 개발용 위젯) */
  dev?: boolean;
  alias?: Record<string, string>;
  /** 묶음과 함께 건넬 CSS 파일(그 안 woff2 는 data: 로) */
  css?: string;
  /** 바이트로 건넬 woff2 글꼴 폴더(iframe CSP 가 글꼴 URL 을 막아 부모가 FontFace 바이트로 넘긴다) */
  fontsDir?: string;
  /** fontsDir 안에서 뺄 하위 폴더 이름 */
  fontsSkip?: string[];
}

interface Built {
  name: string;
  files: { fileName: string; source: string | Uint8Array }[];
  manifest: FrameManifestEntry;
  gzip: number;
  modules: string[];
}

const VIRTUAL = "virtual:widget-frames";

function woff2Files(dir: string, skip: string[], base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return skip.includes(f) ? [] : woff2Files(p, skip, base);
    return f.endsWith(".woff2") ? [path.relative(base, p).split(path.sep).join("/")] : [];
  });
}

async function buildEntry(root: string, spec: FrameEntrySpec): Promise<Built> {
  const out = await build({
    configFile: false,
    root,
    logLevel: "warn",
    // 묶음은 늘 배포판 — 바깥이 개발 모드(개발 서버·NODE_ENV=development 빌드)여도 JSX 를 jsxDEV 로 바꾸지 않게 mode 와 development 를 함께 고정한다
    // (React 는 위 define 으로 배포판이 실려 jsxDEV 가 없다 — 그러면 위젯이 아무것도 그리지 않는다)
    mode: "production",
    define: { "process.env.NODE_ENV": '"production"' },
    // configFile: false 라 웹 설정의 plugin-react 가 없다 — .tsx 진입의 JSX 를 여기서 정한다
    oxc: { jsx: { runtime: "automatic", importSource: "react", development: false } },
    resolve: { conditions: ["keyring-source", ...defaultClientConditions], alias: spec.alias },
    build: {
      write: false,
      minify: true,
      emptyOutDir: false,
      copyPublicDir: false,
      rolldownOptions: { input: path.resolve(root, spec.entry), output: { format: "iife", inlineDynamicImports: true } },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]) as {
    output: { type: string; code?: string; source?: string | Uint8Array; fileName: string; moduleIds?: string[] }[];
  }[];
  const items = outputs.flatMap((o) => o.output);
  const js = items
    .filter((i) => i.type === "chunk")
    .map((i) => i.code ?? "")
    .join("\n");
  const modules = items.flatMap((i) => (i.type === "chunk" ? (i.moduleIds ?? []) : []));
  const cssParts = items.filter((i) => i.type === "asset" && i.fileName.endsWith(".css")).map((i) => String(i.source));
  if (spec.css) cssParts.push(readFileSync(path.resolve(root, spec.css), "utf8"));
  const files: Built["files"] = [];
  const jsName = frameAssetName(spec.name, js, ".js");
  files.push({ fileName: jsName, source: js });
  const manifest: FrameManifestEntry = { js: `/${jsName}` };
  const fontsBase = spec.fontsDir ? path.resolve(root, spec.fontsDir) : null;
  if (cssParts.length) {
    const css = inlineCssFonts(cssParts.join("\n"), (rel) => {
      const file = fontsBase && path.join(fontsBase, rel);
      return file && existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
    });
    const cssName = frameAssetName(spec.name, css, ".css");
    files.push({ fileName: cssName, source: css });
    manifest.css = `/${cssName}`;
  }
  if (fontsBase) {
    manifest.fonts = {};
    for (const rel of woff2Files(fontsBase, spec.fontsSkip ?? [])) {
      const bytes = new Uint8Array(readFileSync(path.join(fontsBase, rel)));
      const fileName = frameAssetName(`${spec.name}-font`, bytes, ".woff2");
      files.push({ fileName, source: bytes });
      manifest.fonts[rel] = `/${fileName}`;
    }
  }
  return { name: spec.name, files, manifest, gzip: gzipSync(js).length, modules };
}

export function widgetFrames(entries: FrameEntrySpec[]): Plugin & { modules(): string[] } {
  let root = "";
  let serve = false;
  /** import.meta.env.DEV 와 같은 판정 — dev 진입은 개발 서버와 개발 모드 빌드(NODE_ENV=development)에만 싣는다 */
  let dev = false;
  let built: Promise<Built[]> | null = null;
  let last: Built[] = [];
  const runAll = () =>
    (built ??= Promise.all(entries.filter((e) => dev || !e.dev).map((e) => buildEntry(root, e))).then((b) => {
      last = b;
      return b;
    }));
  return {
    name: "keyring-widget-frames",
    modules: () => last.flatMap((b) => b.modules),
    configResolved(c) {
      root = c.root;
      serve = c.command === "serve";
      dev = !c.isProduction;
    },
    async buildStart() {
      if (serve) return;
      built = null;
      await runAll();
    },
    resolveId: (source) => (source === VIRTUAL ? `\0${VIRTUAL}` : null),
    async load(id) {
      if (id !== `\0${VIRTUAL}`) return null;
      const b = await runAll();
      return `export default ${JSON.stringify(Object.fromEntries(b.map((x) => [x.name, x.manifest])))};`;
    },
    generateBundle() {
      for (const b of last) {
        for (const f of b.files) this.emitFile({ type: "asset", fileName: f.fileName, source: f.source });
        this.info(`widget-frame ${b.name}: ${b.gzip} B gzip`);
      }
      const errors = frameSizeErrors(last.map((b) => ({ name: b.name, gzip: b.gzip })));
      if (errors.length) this.error(`${errors.join("; ")} — 묶음 크기 상한(src/widgetFrames.ts)`);
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? "").split("?")[0]!;
        if (!url.startsWith(`/${FRAME_DIR}/`)) return next();
        const file = (await runAll()).flatMap((b) => b.files).find((f) => `/${f.fileName}` === url);
        if (!file) {
          res.statusCode = 404;
          return res.end();
        }
        const type = url.endsWith(".js") ? "text/javascript" : url.endsWith(".css") ? "text/css" : "font/woff2";
        res.setHeader("content-type", type);
        res.end(typeof file.source === "string" ? file.source : Buffer.from(file.source));
      });
    },
  };
}
