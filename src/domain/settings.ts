import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { workspaceSettings } from "@/db/schema";
import type { Actor } from "./permissions";
import type { PublicStatus } from "./tracking";

// Workspace defaults the Admin controls. Deliberately few: an AI match threshold and which
// delivery events customers hear about. No configurable prompts or automation rules.

export type CustomerNotifyKey = PublicStatus | "rework_decision";
export const CUSTOMER_NOTIFY_KEYS: CustomerNotifyKey[] = ["planned", "in_development", "ready_for_review", "released", "rework_decision"];
export type CustomerNotify = Record<CustomerNotifyKey, boolean>;

export interface Settings {
  matchThreshold: number;
  customerNotify: CustomerNotify;
  defaultNotifyEmail: boolean;
  defaultNotifyInApp: boolean;
}

const DEFAULTS: Settings = {
  matchThreshold: 0.6,
  customerNotify: { planned: true, in_development: true, ready_for_review: true, released: true, rework_decision: true },
  defaultNotifyEmail: true,
  defaultNotifyInApp: true,
};

export async function getSettings(): Promise<Settings> {
  const [row] = await getDb().select().from(workspaceSettings).where(eq(workspaceSettings.id, 1));
  if (!row) return DEFAULTS;
  return {
    matchThreshold: row.matchThreshold,
    customerNotify: { ...DEFAULTS.customerNotify, ...(row.customerNotify as Partial<CustomerNotify>) },
    defaultNotifyEmail: row.defaultNotifyEmail,
    defaultNotifyInApp: row.defaultNotifyInApp,
  };
}

export async function updateSettings(actor: Actor, input: Settings) {
  if (actor.role !== "admin") throw new Error("Only the Workspace Admin can change workspace settings");
  if (!(input.matchThreshold >= 0.3 && input.matchThreshold <= 0.95)) throw new Error("Choose a match threshold between 0.30 and 0.95");
  const values = { id: 1, ...input };
  await getDb().insert(workspaceSettings).values(values).onConflictDoUpdate({ target: workspaceSettings.id, set: input });
}
