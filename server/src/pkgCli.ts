import { lstat, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  checkPackageFiles,
  compareSemver,
  MARKET_LIMITS,
  parsePackageId,
  parseRepoIndex,
  parseSemver,
  PathError,
  sha256Hex,
  type IndexVersion,
  type PackageManifest,
  type PackageType,
  type RepoIndex,
} from "@keyring-notes/core";
import { serverText } from "./lang.js";

/**
 * 패키지 CLI(`pkg check`·`pkg index`). 형식과 검사는 core(marketFormat.ts)가 원본이고, 여기는 폴더를 읽어 넘기기만 한다.
 * 공식·개인 저장소가 같이 쓴다 — 마켓 설계 「패키지 CLI」.
 */

/** 폴더 안 파일 전부(숨김 포함 — 허용 꼴이 아니면 checkPackageFiles 가 오류로 낸다). 경로는 `/` 로 잇는다 */
async function readTree(dir: string, prefix = "", out = new Map<string, Uint8Array>()): Promise<Map<string, Uint8Array>> {
  for (const name of (await readdir(dir)).sort()) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = await lstat(full);
    // 링크를 따라가면 폴더 밖 파일이 저장소에 실린다
    if (st.isSymbolicLink()) throw new Error(serverText("cli.pkg_symlink", { path: rel }));
    if (st.isDirectory()) await readTree(full, rel, out);
    else {
      if (st.size > MARKET_LIMITS.fileBytes) throw new PathError("market_manifest_invalid", { reason: `size:${rel}` });
      out.set(rel, new Uint8Array(await readFile(full)));
    }
  }
  return out;
}

export async function checkPackageDir(dir: string): Promise<{ manifest: PackageManifest; warnings: string[] }> {
  return checkPackageFiles(await readTree(dir));
}

/** 하위 폴더. 링크된 폴더는 건너뛰지 않고 오류 — 건너뛰면 그 패키지가 목록에서 말없이 빠진다 */
async function subdirs(dir: string, repoDir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw new Error(serverText("cli.pkg_symlink", { path: path.relative(repoDir, path.join(dir, e.name)) }));
    if (e.isDirectory()) out.push(e.name);
  }
  return out.sort();
}

async function existingName(file: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as { name?: unknown };
    return typeof raw.name === "string" ? raw.name : null;
  } catch {
    return null;
  }
}

/** 키 순서를 정해 두고 2칸 들여쓰기·끝 줄바꿈 — 같은 폴더면 같은 바이트(멱등) */
function serialize(index: RepoIndex): string {
  const packages: RepoIndex["packages"] = {};
  for (const id of Object.keys(index.packages).sort()) {
    const p = index.packages[id]!;
    const versions: Record<string, IndexVersion> = {};
    for (const v of Object.keys(p.versions).sort(compareSemver)) {
      const ver = p.versions[v]!;
      versions[v] = {
        engines: { keyring: ver.engines.keyring },
        files: [...ver.files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => ({ path: f.path, sha256: f.sha256, size: f.size })),
      };
    }
    packages[id] = { type: p.type, versions };
  }
  return `${JSON.stringify({ format: 1, name: index.name, packages }, null, 2)}\n`;
}

/** packages/<scope>/<name>/<version>/ 를 훑어 index.json 을 쓴다(바뀌었을 때만). 이름은 기존 index.json → opts.name → 폴더 이름 */
export async function buildRepoIndex(repoDir: string, opts: { name?: string } = {}): Promise<{ index: RepoIndex; written: boolean }> {
  const root = path.join(repoDir, "packages");
  try {
    if (!(await lstat(root)).isDirectory()) throw new Error();
  } catch {
    throw new Error(serverText("cli.pkg_no_packages", { path: root }));
  }
  const indexFile = path.join(repoDir, "index.json");
  const index: RepoIndex = { format: 1, name: (await existingName(indexFile)) ?? opts.name ?? path.basename(path.resolve(repoDir)), packages: {} };
  for (const scope of await subdirs(root, repoDir)) {
    for (const name of await subdirs(path.join(root, scope), repoDir)) {
      for (const version of await subdirs(path.join(root, scope, name), repoDir)) {
        const dir = path.join(root, scope, name, version);
        const folder = path.relative(repoDir, dir);
        const id = `@${scope}/${name}`;
        try {
          if (!parsePackageId(id) || !parseSemver(version)) throw new Error(serverText("cli.pkg_folder_name"));
          const files = await readTree(dir);
          const { manifest } = checkPackageFiles(files);
          if (manifest.id !== id || manifest.version !== version)
            throw new Error(serverText("cli.pkg_folder_mismatch", { id: manifest.id, version: manifest.version }));
          const pkg = (index.packages[id] ??= { type: manifest.type, versions: {} });
          if (pkg.type !== manifest.type) throw new Error(serverText("cli.pkg_type_mismatch", { type: manifest.type, other: pkg.type as PackageType }));
          const list = [];
          for (const [p, bytes] of files) list.push({ path: p, sha256: await sha256Hex(bytes), size: bytes.byteLength });
          pkg.versions[version] = { engines: { keyring: manifest.engines.keyring }, files: list };
        } catch (e) {
          throw new Error(serverText("cli.pkg_in_folder", { folder, message: e instanceof Error ? e.message : String(e) }));
        }
      }
    }
  }
  const text = serialize(index);
  // 검사를 지난 폴더로만 만들었으니 빠지는 것이 없어야 한다 — 빠지면 core 의 두 검사가 어긋난 것
  const { ignored } = parseRepoIndex(JSON.parse(text), { official: true });
  if (ignored.length) throw new Error(ignored.join("\n"));
  let before: string | null = null;
  try {
    before = await readFile(indexFile, "utf8");
  } catch {
    before = null;
  }
  if (before === text) return { index: JSON.parse(text) as RepoIndex, written: false };
  const tmp = `${indexFile}.tmp-${process.pid}`;
  await writeFile(tmp, text);
  await rename(tmp, indexFile);
  return { index: JSON.parse(text) as RepoIndex, written: true };
}

/** `pnpm keyring` 은 server 폴더에서 돈다 — 상대 경로는 명령을 친 자리(INIT_CWD) 기준으로 */
function resolveArg(p: string): string {
  return path.resolve(process.env.INIT_CWD || process.cwd(), p);
}

export async function runPkg(args: string[]): Promise<void> {
  const [sub, dir, ...rest] = args;
  if (sub === "check" && dir && rest.length === 0) {
    const { manifest, warnings } = await checkPackageDir(resolveArg(dir));
    console.log(serverText("cli.pkg_check_ok", { id: manifest.id, version: manifest.version, type: manifest.type }));
    for (const w of warnings) console.log(serverText("cli.pkg_warning", { message: w }));
    return;
  }
  if (sub === "index" && dir && (rest.length === 0 || (rest.length === 2 && rest[0] === "--name" && rest[1]))) {
    const repoDir = resolveArg(dir);
    const { index, written } = await buildRepoIndex(repoDir, rest.length ? { name: rest[1] } : {});
    const versions = Object.values(index.packages).reduce((n, p) => n + Object.keys(p.versions).length, 0);
    const params = { packages: Object.keys(index.packages).length, versions, path: path.join(repoDir, "index.json") };
    console.log(serverText(written ? "cli.pkg_index_written" : "cli.pkg_index_unchanged", params));
    return;
  }
  console.log(serverText("cli.pkg_usage"));
  process.exitCode = 1;
}
