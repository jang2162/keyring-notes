/**
 * 실행 때 확인. 「업데이트 자동 확인」 이 꺼졌거나 데스크톱 앱이 아니면 check 를 부르지 않는다 — 밖으로 나가는 요청이 없어야 한다.
 * 찾으면 onFound 로 넘길 뿐 받거나 설치하지 않는다. 실패(오프라인 등)는 조용히 넘긴다(설정의 「지금 확인」 이 오류를 보인다).
 */
export async function startupCheck<U>(opts: {
  enabled: boolean;
  supported: boolean;
  check: () => Promise<U | null>;
  onFound: (u: U) => void;
}): Promise<"off" | "none" | "found" | "failed"> {
  if (!opts.supported || !opts.enabled) return "off";
  try {
    const u = await opts.check();
    if (!u) return "none";
    opts.onFound(u);
    return "found";
  } catch {
    return "failed";
  }
}
