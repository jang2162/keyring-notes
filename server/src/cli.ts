import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { isLevel, LEVELS } from "./access.js";
import { ConfigStore } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.resolve(process.env.KEYRING_CONFIG ?? path.join(here, "../../config/keyring.json"));
const config = new ConfigStore(configFile);

const USAGE = `사용법: npm run keyring -- <명령>

  passwd                               소유자(웹 로그인) 비밀번호 설정
  agent list                           에이전트와 권한 표
  agent add <이름>                     에이전트를 만들고 토큰 발급(한 번만 표시)
  agent rotate <이름>                  토큰 재발급(이전 토큰은 즉시 무효)
  agent remove <이름>                  에이전트 삭제
  agent grant <이름> <경로> <권한>     폴더·문서 권한 지정. 경로 "/"는 볼트 전체
  agent revoke <이름> <경로>           규칙 제거(상위 규칙 또는 숨김으로 돌아감)

권한: ${LEVELS.join(" < ")}
설정 파일: ${configFile}`;

function askHidden(question: string): Promise<string> {
  if (process.env.KEYRING_PASSWORD) return Promise.resolve(process.env.KEYRING_PASSWORD);
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.includes(question)) write.call(rl, s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function printAgents() {
  const agents = config.get().agents;
  if (agents.length === 0) return console.log("에이전트가 없습니다.");
  for (const a of agents) {
    console.log(`${a.name}  (만든 날: ${a.createdAt.slice(0, 10) || "-"})`);
    const rules = Object.entries(a.rules).sort(([x], [y]) => x.localeCompare(y, "ko"));
    if (rules.length === 0) console.log("    (규칙 없음 — 모든 경로 숨김)");
    for (const [p, l] of rules) console.log(`    ${l.padEnd(7)} ${p}`);
  }
}

async function main(args: string[]) {
  const [cmd, sub, ...rest] = args;
  if (cmd === "passwd") {
    const pw = await askHidden("새 비밀번호: ");
    if (!process.env.KEYRING_PASSWORD && (await askHidden("한 번 더: ")) !== pw) throw new Error("비밀번호가 서로 다릅니다");
    config.setPassword(pw);
    console.log("비밀번호를 설정했습니다. 기존 로그인 세션은 모두 끊겼습니다.");
    return;
  }
  if (cmd !== "agent") {
    console.log(USAGE);
    process.exitCode = cmd ? 1 : 0;
    return;
  }
  switch (sub) {
    case "list":
      return printAgents();
    case "add":
    case "rotate": {
      const [name] = rest;
      if (!name) throw new Error("이름이 필요합니다");
      const exists = config.get().agents.some((a) => a.name === name);
      if (sub === "add" && exists) throw new Error(`이미 있는 에이전트입니다: ${name} (토큰 재발급은 rotate)`);
      if (sub === "rotate" && !exists) throw new Error(`에이전트가 없습니다: ${name}`);
      const token = config.issueToken(name);
      console.log(`${name} 토큰 (다시 볼 수 없으니 지금 저장하세요):\n\n  ${token}\n`);
      if (sub === "add") console.log(`아직 권한이 없습니다. 예: npm run keyring -- agent grant ${name} 업무/wiki write`);
      return;
    }
    case "remove": {
      const [name] = rest;
      if (!name) throw new Error("이름이 필요합니다");
      config.removeAgent(name);
      console.log(`${name} 삭제됨`);
      return;
    }
    case "grant": {
      const [name, p, level] = rest;
      if (!name || !p || !isLevel(level)) throw new Error(`사용법: agent grant <이름> <경로> <${LEVELS.join("|")}>`);
      config.setRule(name, p, level);
      return printAgents();
    }
    case "revoke": {
      const [name, p] = rest;
      if (!name || !p) throw new Error("사용법: agent revoke <이름> <경로>");
      config.setRule(name, p, null);
      return printAgents();
    }
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(`오류: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
