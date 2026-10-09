import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setDataBaseDir } from "@zcode/services/node";

function resolveBootstrapSettingsFile(homePath: string = homedir()): string {
  return join(homePath, ".zcode", "v2", "setting.json");
}

function extractBootstrapDataBaseDir(rawValue: unknown): string | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const dataBaseDir = (rawValue as { dataBaseDir?: unknown }).dataBaseDir;
  if (typeof dataBaseDir !== "string") {
    return null;
  }

  const trimmed = dataBaseDir.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBootstrapDataBaseDirFromDisk(
  settingsFile: string = resolveBootstrapSettingsFile(),
): string | null {
  if (!existsSync(settingsFile)) {
    return null;
  }

  try {
    const raw = readFileSync(settingsFile, "utf-8");
    return extractBootstrapDataBaseDir(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function applyEarlyDataBaseDirBootstrap(): string | null {
  // qiven fork: qualification isolation (PR22 doc 08 section 3 item 5).
  // ZCODE_DATA_BASE_DIR 显式生效时它就是权威数据根：跳过真实 HOME 下
  // setting.json 的 bootstrap 读取。否则该读取既会 consult 真实 profile，
  // 其 dataBaseDir 字段又会在 services/paths.ts 里以 setDataBaseDir 优先级
  // 反向覆盖环境变量指定的 scratch 根。变量缺席时行为不变。
  if (process.env.ZCODE_DATA_BASE_DIR?.trim()) {
    return null;
  }
  const dataBaseDir = readBootstrapDataBaseDirFromDisk();
  if (dataBaseDir) {
    // 启动早期就把 dataBaseDir 注入进来，避免 logger / crashReporter 先按默认 HOME 建目录，
    // 导致后续再切换到自定义目录时，日志和 crash dump 落在两套路径里。
    setDataBaseDir(dataBaseDir);
  }
  return dataBaseDir;
}
