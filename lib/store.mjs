// lib/store.mjs — 跨进程持久化 Claude Code 会话 id。
// DSH session header 是白名单 schema，塞不进自定义字段，故用插件自持的 JSON 旁路存储：
// 一个 `sessionId → claudeSessionId` 的映射，写在一个文件里。写串行化，避免并发丢更新。
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

/** 存储文件路径；可用 DSH_CLAUDE_CODE_STORE 覆盖根目录（默认 ~/.dsh/dsh-claude-code）。 */
function storePath() {
  const root = process.env.DSH_CLAUDE_CODE_STORE ?? join(homedir(), ".dsh", "dsh-claude-code");
  return join(root, "sessions.json");
}

async function readAll() {
  try {
    const parsed = JSON.parse(await readFile(storePath(), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** 读某个 DSH 会话对应的 Claude Code 会话 id；没有则返回 undefined。 */
export async function load(sessionId) {
  const value = (await readAll())[sessionId];
  return typeof value === "string" && value !== "" ? value : undefined;
}

let writeChain = Promise.resolve();

/** 记录某个 DSH 会话对应的 Claude Code 会话 id。失败静默（不因写盘失败打断 turn）。 */
export function save(sessionId, claudeSessionId) {
  if (typeof claudeSessionId !== "string" || claudeSessionId === "") return Promise.resolve();
  writeChain = writeChain
    .then(async () => {
      const path = storePath();
      const all = await readAll();
      all[sessionId] = claudeSessionId;
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(all, null, 2), "utf8");
      await rename(tmp, path);
    })
    .catch(() => {});
  return writeChain;
}
