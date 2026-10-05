import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 저장소 루트 package.json의 version. Docker 이미지에도 함께 들어간다. */
function readVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [path.join(here, "../../package.json"), path.join(here, "../package.json")]) {
    try {
      const v = JSON.parse(readFileSync(p, "utf8")).version;
      if (typeof v === "string") return v;
    } catch {
      /* 다음 후보 */
    }
  }
  return "0.0.0";
}

export const APP_VERSION = process.env.KEYRING_VERSION ?? readVersion();
