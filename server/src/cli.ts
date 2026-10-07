import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { isLevel, LEVELS } from "./access.js";
import { ConfigStore } from "./config.js";
import { serverLanguage, serverText, setServerLanguage } from "./lang.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.resolve(
  (process.env.KEYRING_CONFIG || undefined) ??
    (process.env.KEYRING_DATA ? path.join(process.env.KEYRING_DATA, "config", "keyring.json") : path.join(here, "../../config/keyring.json")),
);
const config = new ConfigStore(configFile);

// 서버 언어: 설정 파일을 읽을 수 있으면 그 언어, 아니면 KEYRING_LANG → LANG
let configuredLanguage: string | null = null;
try {
  // 파일이 없을 때 get()은 기본 설정을 만들어 저장하므로, 있을 때만 읽는다
  if (existsSync(configFile)) configuredLanguage = config.get().language;
} catch {
  // 설정을 못 읽어도 도움말·오류는 보여 준다(명령을 실행할 때 다시 오류가 난다)
}
setServerLanguage(configuredLanguage);

const usage = () => serverText("cli.usage", { levels: LEVELS.join(" < "), config: configFile });

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
  if (agents.length === 0) return console.log(serverText("cli.no_agents"));
  for (const a of agents) {
    console.log(serverText("cli.agent_line", { name: a.name, created: a.createdAt.slice(0, 10) || "-" }));
    const rules = Object.entries(a.rules).sort(([x], [y]) => x.localeCompare(y, serverLanguage()));
    if (rules.length === 0) console.log(`    ${serverText("cli.no_rules")}`);
    for (const [p, l] of rules) console.log(`    ${l.padEnd(7)} ${p}`);
  }
}

async function main(args: string[]) {
  const [cmd, sub, ...rest] = args;
  if (cmd === "passwd") {
    const pw = await askHidden(serverText("cli.new_password"));
    if (!process.env.KEYRING_PASSWORD && (await askHidden(serverText("cli.password_again"))) !== pw) throw new Error(serverText("cli.password_mismatch"));
    config.setPassword(pw);
    console.log(serverText("cli.password_set"));
    return;
  }
  if (cmd !== "agent") {
    console.log(usage());
    process.exitCode = cmd ? 1 : 0;
    return;
  }
  switch (sub) {
    case "list":
      return printAgents();
    case "add":
    case "rotate": {
      const [name] = rest;
      if (!name) throw new Error(serverText("cli.name_required"));
      const exists = config.get().agents.some((a) => a.name === name);
      if (sub === "add" && exists) throw new Error(serverText("cli.agent_exists", { name }));
      if (sub === "rotate" && !exists) throw new Error(serverText("cli.agent_missing", { name }));
      const token = config.issueToken(name);
      console.log(`${serverText("cli.token", { name })}\n\n  ${token}\n`);
      if (sub === "add") console.log(serverText("cli.no_rules_hint", { name }));
      return;
    }
    case "remove": {
      const [name] = rest;
      if (!name) throw new Error(serverText("cli.name_required"));
      config.removeAgent(name);
      console.log(serverText("cli.agent_removed", { name }));
      return;
    }
    case "grant": {
      const [name, p, level] = rest;
      if (!name || !p || !isLevel(level)) throw new Error(serverText("cli.grant_usage", { levels: LEVELS.join("|") }));
      config.setRule(name, p, level);
      return printAgents();
    }
    case "revoke": {
      const [name, p] = rest;
      if (!name || !p) throw new Error(serverText("cli.revoke_usage"));
      config.setRule(name, p, null);
      return printAgents();
    }
    default:
      console.log(usage());
      process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(serverText("cli.error", { message: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
});
