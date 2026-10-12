import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { supervisorError } from "../contracts.js";
import type { RunMode } from "../contracts.js";

export const RECEIPT_TTL_MS = 10 * 60 * 1000;
const PREFIX = "vsr1";
const MAX_RECEIPT_CHARS = 2048;

export interface ReceiptBinding {
  revision: string;
  operation: RunMode;
  workspace: string;
  baseRef: string | null;
  baseCommit: string | null;
}

export interface OpenedReceipt extends ReceiptBinding {
  instance: string;
  expiresAt: number;
}

export type ReceiptRejection = "malformed" | "instance" | "signature" | "expired" | "revision" | "operation" | "workspace" | "base_ref" | "base_ref_unresolved" | "base_commit";

const REJECTION_MESSAGES: Record<ReceiptRejection, string> = {
  malformed: "The readiness receipt is malformed.",
  instance: "The readiness receipt was issued by another server instance; receipts are valid only on the connection that issued them.",
  signature: "The readiness receipt failed verification; it was altered or not issued by this server.",
  expired: "The readiness receipt has expired.",
  revision: "The selected configuration changed since the readiness check; the receipt names an older policy revision.",
  operation: "The readiness receipt was issued for a different operation.",
  workspace: "The readiness receipt was issued for a different canonical workspace.",
  base_ref: "The readiness receipt was issued for a different base_ref.",
  base_ref_unresolved: "The edit base_ref no longer resolves to a commit; it was deleted or renamed after the readiness check.",
  base_commit: "The edit base now resolves to a different commit than at the readiness check."
};

export function receiptRejected(reason: ReceiptRejection): Error {
  return Object.assign(new Error(REJECTION_MESSAGES[reason]), supervisorError("VSUP_READINESS_RECEIPT_INVALID", REJECTION_MESSAGES[reason], { reason }));
}

function encode(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function isBinding(value: Record<string, unknown>): boolean {
  const optionalString = (field: unknown): boolean => field === null || (typeof field === "string" && field.length <= 4096);
  return typeof value.instance === "string" && typeof value.revision === "string" && (value.operation === "review" || value.operation === "edit")
    && typeof value.workspace === "string" && optionalString(value.baseRef) && optionalString(value.baseCommit)
    && typeof value.expiresAt === "number" && Number.isSafeInteger(value.expiresAt);
}

export class ReadinessReceipts {
  readonly instanceId = randomUUID();
  private readonly key = randomBytes(32);

  issue(binding: ReceiptBinding, now = Date.now()): { receipt: string; expiresAt: string } {
    const expiresAt = now + RECEIPT_TTL_MS;
    const payload = encode(JSON.stringify({ v: 1, instance: this.instanceId, ...binding, expiresAt }));
    return { receipt: `${PREFIX}.${payload}.${this.sign(payload)}`, expiresAt: new Date(expiresAt).toISOString() };
  }

  open(receipt: string, now = Date.now()): OpenedReceipt {
    const parts = receipt.length <= MAX_RECEIPT_CHARS ? receipt.split(".") : [];
    if (parts.length !== 3 || parts[0] !== PREFIX) throw receiptRejected("malformed");
    const [, payload, signature] = parts as [string, string, string];
    let decoded: Record<string, unknown>;
    try { decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>; }
    catch { throw receiptRejected("malformed"); }
    if (!decoded || typeof decoded !== "object" || decoded.v !== 1 || !isBinding(decoded)) throw receiptRejected("malformed");
    if (decoded.instance !== this.instanceId) throw receiptRejected("instance");
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw receiptRejected("signature");
    const opened = decoded as unknown as OpenedReceipt;
    if (opened.expiresAt <= now) throw receiptRejected("expired");
    return opened;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.key).update(`${PREFIX}.${payload}`).digest("base64url");
  }
}

export function receiptMismatch(opened: ReceiptBinding, actual: ReceiptBinding): ReceiptRejection | undefined {
  if (opened.revision !== actual.revision) return "revision";
  if (opened.operation !== actual.operation) return "operation";
  if (opened.workspace !== actual.workspace) return "workspace";
  if (opened.baseRef !== actual.baseRef) return "base_ref";
  if (opened.baseCommit !== actual.baseCommit) return "base_commit";
  return undefined;
}
