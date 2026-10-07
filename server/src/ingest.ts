import { access } from "node:fs/promises";
import path from "node:path";
import { stringify as toYaml } from "yaml";
import { decodeText, fetchUrl, htmlToMarkdown, pdfToMarkdown, type Converted, type FetchOptions } from "./convert.js";
import { headings } from "@keyring-notes/core";
import { normalizeVaultPath, PathError } from "./paths.js";
import type { ScopedVault } from "./scoped.js";
import type { Op, Vault } from "./vault.js";
import type { Wiki } from "./wiki.js";

export type IngestInput =
  | { kind: "url"; topic: string; url: string; title?: string }
  | { kind: "html"; topic: string; html: string; url?: string; selectionHtml?: string; title?: string }
  | { kind: "text"; topic: string; text: string; title: string; url?: string }
  | { kind: "file"; topic: string; filename: string; data: Uint8Array; title?: string };

export interface IngestResult {
  path: string;
  title: string;
  asset?: string;
  rev: string | null;
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const TEXT_EXT = new Set(["md", "markdown", "txt"]);
const HTML_EXT = new Set(["html", "htm"]);

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 파일 이름으로 쓸 수 있게 다듬는다(한국어는 그대로, 경로·위키링크에 문제 되는 글자만 뺀다). */
export function slugify(title: string): string {
  const s = title
    .replace(/[\\/:*?"<>|#^[\]{}\u0000-\u001f]/g, " ")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...s];
  return (chars.length > 60 ? chars.slice(0, 60).join("").trim() : s) || "제목 없음";
}

function extOf(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

function textTitle(text: string, fallback: string): string {
  return headings(text).find((h) => h.level === 1)?.text ?? fallback;
}

export class Ingestor {
  constructor(
    private vault: Vault,
    private wiki: Wiki,
    private fetchOptions: FetchOptions = {},
  ) {}

  private async exists(rel: string): Promise<boolean> {
    return access(path.join(this.vault.root, rel)).then(
      () => true,
      () => false,
    );
  }

  /** `<토픽>/raw/<날짜> <제목>.md`. 이름이 겹치면 ` (2)`, ` (3)` …을 붙인다. */
  private async freeName(topic: string, base: string, ext: string, sub = ""): Promise<string> {
    const dir = `${topic}/raw/${sub}`;
    for (let i = 1; i < 1000; i++) {
      const rel = `${dir}${base}${i === 1 ? "" : ` (${i})`}.${ext}`;
      if (!(await this.exists(rel))) return rel;
    }
    throw new PathError("같은 이름의 원본이 너무 많습니다");
  }

  async ingest(scoped: ScopedVault, input: IngestInput): Promise<IngestResult> {
    const topic = normalizeVaultPath(input.topic);
    if (!this.wiki.topics.has(topic)) {
      throw new PathError(`위키 토픽이 아닙니다(SCHEMA.md 없음): ${input.topic}`);
    }

    let converted: Converted;
    let sourceType: string;
    let sourceUrl: string | undefined;
    let asset: { data: Uint8Array; ext: string } | undefined;
    let originalName: string | undefined;

    switch (input.kind) {
      case "url": {
        const got = await fetchUrl(input.url, this.fetchOptions);
        sourceUrl = got.url;
        sourceType = "url";
        const isPdf = got.contentType.includes("application/pdf") || (/\.pdf($|\?)/i.test(got.url) && !got.contentType.includes("html"));
        if (isPdf) {
          const name = decodeURIComponent(new URL(got.url).pathname.split("/").pop() || "document.pdf");
          converted = await pdfToMarkdown(got.data, name.replace(/\.pdf$/i, ""));
          asset = { data: got.data, ext: "pdf" };
        } else if (got.contentType.includes("html") || got.contentType === "") {
          converted = htmlToMarkdown(decodeText(got.data, got.contentType), { url: got.url });
        } else if (got.contentType.startsWith("text/")) {
          const text = decodeText(got.data, got.contentType);
          converted = { title: textTitle(text, got.url), markdown: text, meta: {} };
        } else {
          throw new PathError(`가져올 수 없는 형식입니다: ${got.contentType || "알 수 없음"}`);
        }
        break;
      }
      case "html":
        sourceUrl = input.url;
        sourceType = "clip";
        converted = htmlToMarkdown(input.html, { url: input.url, selectionHtml: input.selectionHtml || undefined });
        break;
      case "text":
        sourceUrl = input.url;
        sourceType = "text";
        converted = { title: input.title, markdown: input.text.trim() + "\n", meta: {} };
        break;
      case "file": {
        const ext = extOf(input.filename);
        const baseName = path.basename(input.filename, path.extname(input.filename));
        originalName = input.filename;
        sourceType = "file";
        if (ext === "pdf") {
          converted = await pdfToMarkdown(input.data, baseName);
          asset = { data: input.data, ext };
        } else if (TEXT_EXT.has(ext)) {
          const text = new TextDecoder("utf-8").decode(input.data);
          converted = { title: textTitle(text, baseName), markdown: text, meta: {} };
        } else if (HTML_EXT.has(ext)) {
          converted = htmlToMarkdown(new TextDecoder("utf-8").decode(input.data));
          asset = { data: input.data, ext };
        } else if (IMAGE_EXT.has(ext)) {
          converted = { title: baseName, markdown: "", meta: {} };
          asset = { data: input.data, ext };
        } else {
          if (!ext) throw new PathError("확장자가 없는 파일은 올릴 수 없습니다");
          converted = { title: baseName, markdown: "_이 형식은 마크다운으로 바꾸지 못했다. 원본 파일을 열어 볼 것._\n", meta: {} };
          asset = { data: input.data, ext };
        }
        break;
      }
    }

    const title = (input.title?.trim() || converted.title).replace(/\s+/g, " ").trim() || "제목 없음";
    const base = `${today()} ${slugify(title)}`;
    const docPath = await this.freeName(topic, base, "md");
    const assetPath = asset ? await this.freeName(topic, path.basename(docPath, ".md"), asset.ext, "assets/") : undefined;

    const fm: Record<string, unknown> = { title, source_type: sourceType };
    if (sourceUrl) fm.source_url = sourceUrl;
    if (originalName) fm.original_name = originalName;
    if (assetPath) fm.original = `[[${assetPath}]]`;
    Object.assign(fm, converted.meta);
    fm.ingested_at = new Date().toISOString();
    fm.ingested_by = scoped.principal.name;

    const lines = [`---`, toYaml(fm).trimEnd(), `---`, `# ${title}`, ""];
    if (sourceUrl) lines.push(`> 원문: <${sourceUrl}>`, "");
    if (assetPath) {
      lines.push(IMAGE_EXT.has(asset!.ext) ? `![[${assetPath}]]` : `> 원본 파일: [[${assetPath}]]`, "");
    }
    lines.push(converted.markdown.trim());
    const content = lines.join("\n").trimEnd() + "\n";

    const ops: Op[] = [];
    if (assetPath && asset) ops.push({ op: "put", path: assetPath, data: asset.data });
    ops.push({ op: "write", path: docPath, content, baseHash: null });
    const res = await scoped.batch(ops, this.vault.text().commit.ingest(title));
    return { path: docPath, title, asset: assetPath, rev: res.rev };
  }
}
