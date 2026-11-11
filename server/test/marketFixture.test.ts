import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 픽스처 index.json 은 별도 저장소의 `keyring-market index` 로 만든다. 앱에는 그 CLI 가 없으니,
// 패키지를 손으로 고치고 index 를 다시 만들지 않은 어긋남을 여기서 잡는다.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "market");

type IndexFile = { path: string; sha256: string; size: number };
type Index = { packages: Record<string, { versions: Record<string, { files: IndexFile[] }> }> };

const index = JSON.parse(readFileSync(path.join(root, "index.json"), "utf8")) as Index;

/** 폴더 안 파일 경로(`/` 로 잇고 숨김 파일·폴더는 뺀다) */
function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

function versionDir(id: string, version: string): string {
  const [scope, name] = id.replace(/^@/, "").split("/");
  return path.join(root, "packages", scope!, name!, version);
}

const versions = Object.entries(index.packages).flatMap(([id, pkg]) => Object.entries(pkg.versions).map(([version, v]) => ({ id, version, files: v.files })));

describe("시험 픽스처 마켓 저장소", () => {
  it("판이 하나 이상 있다", () => {
    expect(versions.length).toBeGreaterThan(0);
  });

  it.each(versions)("$id@$version: 파일 목록·크기·sha256 이 index.json 과 같다", ({ id, version, files }) => {
    const dir = versionDir(id, version);
    expect(listFiles(dir)).toEqual(files.map((f) => f.path).sort());
    for (const f of files) {
      const bytes = readFileSync(path.join(dir, ...f.path.split("/")));
      const actual = { path: f.path, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
      expect(actual).toEqual({ path: f.path, size: f.size, sha256: f.sha256 });
    }
  });

  it("packages/ 아래 판 폴더는 모두 index.json 에 있다", () => {
    const onDisk: string[] = [];
    const pkgRoot = path.join(root, "packages");
    for (const scope of readdirSync(pkgRoot).filter((n) => !n.startsWith(".")))
      for (const name of readdirSync(path.join(pkgRoot, scope)).filter((n) => !n.startsWith(".")))
        for (const version of readdirSync(path.join(pkgRoot, scope, name)).filter((n) => !n.startsWith("."))) onDisk.push(`@${scope}/${name}@${version}`);
    expect(onDisk.sort()).toEqual(versions.map((v) => `${v.id}@${v.version}`).sort());
  });
});
