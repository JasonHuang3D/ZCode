// ============================================================
// Qiven PoC seam events (observation-only, feature-flagged)
// ============================================================
//
// 只在 QIVEN_POC=1 且 QIVEN_POC_LOG 指向非空路径时工作；未启用时
// 调用是两次同步 env 读取，无任何 I/O、不抛错，宿主行为逐字不变。
// 写文件失败只打一行 console.error，绝不让观测破坏宿主调用链。

import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";

export interface PocEventPayload {
  phase: "logical" | "final-permit";
  runner: "generate" | "stream";
  attempt?: number;
  operation?: string;
  actorKind?: string;
  providerId?: string;
  modelId?: string;
  msgCount?: number;
  toolCount?: number;
  projectionDigest?: string;
}

export function pocEnabled(): boolean {
  return (
    process.env.QIVEN_POC === "1" &&
    typeof process.env.QIVEN_POC_LOG === "string" &&
    process.env.QIVEN_POC_LOG.length > 0
  );
}

/** Append one JSONL seam-event line to QIVEN_POC_LOG; swallow write failures. */
export function emitPocEvent(payload: PocEventPayload): void {
  if (!pocEnabled()) return;
  try {
    appendFileSync(
      process.env.QIVEN_POC_LOG as string,
      `${JSON.stringify({ v: 1, ts: new Date().toISOString(), ...payload })}\n`,
    );
  } catch (error) {
    console.error(
      `[qiven-poc] seam event write failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Short sha256 digest of the messages array actually handed to the runtime.
 * Returns undefined when disabled or when the payload cannot be stringified.
 */
export function pocProjectionDigest(messages: unknown): string | undefined {
  if (!pocEnabled()) return undefined;
  try {
    return createHash("sha256").update(JSON.stringify(messages)).digest("hex").slice(0, 16);
  } catch {
    return undefined;
  }
}
