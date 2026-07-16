import type { Sensitivity } from "./types";

export type ActorKind = "web" | "discord" | "voice";

export interface Actor {
  kind: ActorKind;
  /** Web user id or Discord snowflake or voice point id */
  id: string;
  /** Discord allowlist / web logged-in / voice trusted */
  allowSensitive: boolean;
}

export function canUseTool(actor: Actor, sensitivity: Sensitivity): boolean {
  if (sensitivity === "public") return true;
  return actor.allowSensitive;
}

export function refusalMessage(toolName: string): string {
  return `I can't run "${toolName}" for you — that action needs an authorized Discord user (add your Discord user ID in the WebUI) or a logged-in WebUI session.`;
}
