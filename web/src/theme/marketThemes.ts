import { MANIFEST_FILE, parseManifest } from "@keyring-notes/core";
import type { MarketState } from "../market/state";
import { setThemePackages } from "./apply";
import type { ThemePackage } from "./resolve";

/**
 * 마켓 테마 적용자. 매니페스트는 InstalledPackage.manifest(캐시에서 sha256 확인 없이 읽은 것)가 아니라
 * readPackageText(잠금의 sha256 으로 다시 확인)로 읽는다. 읽지 못한 패키지는 뺀다 — 그 패키지는 마켓 상태가 이미 오류로 보인다.
 */
export function registerThemeKind(m: MarketState, set: (pkgs: ThemePackage[]) => void = setThemePackages): () => void {
  return m.registerPackageKind("theme", {
    async apply(pkgs) {
      // 첫 맞추기 전의 빈 목록은 「아직 모름」 — 시작 캐시로 그린 테마를 지우지 않는다
      if (!m.ready()) return;
      const out: ThemePackage[] = [];
      for (const p of pkgs) {
        try {
          const man = parseManifest(JSON.parse(await m.readPackageText(p.id, MANIFEST_FILE)));
          if (man.type === "theme" && man.colors) out.push({ id: man.id, version: man.version, name: man.name, colors: man.colors });
        } catch {
          /* 그 패키지만 뺀다 */
        }
      }
      set(out);
    },
  });
}
