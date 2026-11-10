import { checkPack } from "@keyring-notes/core";
import { setMarketPacks, type MarketPack } from "./i18n";
import type { MarketState } from "./market/state";

/**
 * 마켓 언어 적용자. messages.json 은 readPackageText(잠금의 sha256 으로 다시 확인)로 읽고 checkPack 으로 거른다 —
 * 기준 언어에 있는 키만, 글자만, 자리가 기준과 같은 키만 쓴다. 오류·읽기 실패한 패키지는 뺀다.
 */
export function registerLanguageKind(m: MarketState, set: (list: MarketPack[]) => void = setMarketPacks): () => void {
  return m.registerPackageKind("language", {
    async apply(pkgs) {
      // 첫 맞추기 전의 빈 목록은 「아직 모름」 — 시작 캐시의 언어를 지우지 않는다
      if (!m.ready()) return;
      const out: MarketPack[] = [];
      for (const p of pkgs) {
        try {
          const text = await m.readPackageText(p.id, "messages.json");
          const r = checkPack(JSON.parse(text), new TextEncoder().encode(text).byteLength);
          if (!("error" in r)) out.push({ pkgId: p.id, pack: r.pack, report: r.report });
        } catch {
          /* 그 패키지만 뺀다 */
        }
      }
      set(out);
    },
  });
}
