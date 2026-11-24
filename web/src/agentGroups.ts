import type { AgentInfo } from "./api";

/** 하위 토큰은 발급자 카드 아래에 묶는다. 발급자가 목록에 없는 하위 토큰(설정 손편집 등)은 따로 한 줄로 둔다 */
export function agentGroups(agents: AgentInfo[]): { agent: AgentInfo; children: AgentInfo[] }[] {
  const names = new Set(agents.map((a) => a.name));
  const isChild = (a: AgentInfo) => !!a.issuedBy && names.has(a.issuedBy);
  return agents.filter((a) => !isChild(a)).map((agent) => ({ agent, children: agents.filter((c) => isChild(c) && c.issuedBy === agent.name) }));
}

/** 발급자를 지우면 함께 지워질 하위 토큰 이름. 확인 직전에 새로 불러온 목록으로 부른다(화면을 연 뒤 발급됐을 수 있다) */
export function issuedNames(agents: AgentInfo[], issuer: string): string[] {
  return agents.filter((a) => a.issuedBy === issuer).map((a) => a.name);
}

/** 서버가 함께 지운 이름 중 확인 문구에 없던 것(확인과 삭제 사이에 발급된 것) */
export function unconfirmedRemoved(removed: string[], confirmed: string[]): string[] {
  const shown = new Set(confirmed);
  return removed.filter((n) => !shown.has(n));
}
