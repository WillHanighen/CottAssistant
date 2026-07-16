import { z } from "zod";

export const UserRoleSchema = z.enum(["admin", "user"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const SensitivitySchema = z.enum(["public", "sensitive"]);
export type Sensitivity = z.infer<typeof SensitivitySchema>;

export const ChannelKindSchema = z.enum(["web", "discord_dm", "discord_guild", "voice"]);
export type ChannelKind = z.infer<typeof ChannelKindSchema>;

export type SessionChannel =
  | `web:${string}`
  | `discord:dm:${string}`
  | `discord:guild:${string}`
  | `voice:${string}`
  | `cron:${string}`;

/** Image passed into the agent for vision models (OpenRouter multimodal). */
export const ChatImageSchema = z.object({
  /** MIME type, e.g. image/png */
  mimeType: z.string(),
  /** Raw bytes as base64 (no data: prefix) */
  base64: z.string(),
  /** Optional original filename for history notes */
  name: z.string().optional(),
});
export type ChatImage = z.infer<typeof ChatImageSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const AudioDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  direction: z.enum(["input", "output"]),
});
export type AudioDevice = z.infer<typeof AudioDeviceSchema>;

export const VoicePointConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  inputDeviceId: z.string().nullable(),
  outputDeviceId: z.string().nullable(),
  lastSeenAt: z.number().nullable(),
  connected: z.boolean().default(false),
});
export type VoicePointConfig = z.infer<typeof VoicePointConfigSchema>;

export const SettingsSchema = z.object({
  openrouterApiKey: z.string().optional(),
  openrouterModel: z.string().default("openai/gpt-4.1-mini"),
  discordToken: z.string().optional(),
  voiceDaemonToken: z.string().optional(),
  whisperBinary: z.string().default("whisper-cli"),
  whisperModel: z.string().default("medium.en"),
  piperBinary: z.string().default("piper-tts"),
  piperModel: z.string().default("en_US-lessac-high"),
  wakeWordModel: z.string().default("hey_jarvis"),
  localInputDeviceId: z.string().nullable().optional(),
  localOutputDeviceId: z.string().nullable().optional(),
  voiceEnabled: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DiscordUserSchema = z.object({
  discordId: z.string(),
  label: z.string().optional(),
  createdAt: z.number(),
});
export type DiscordUser = z.infer<typeof DiscordUserSchema>;

export const PublicUserSchema = z.object({
  id: z.number(),
  username: z.string(),
  role: UserRoleSchema,
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

/** Simple jobs are capped ~500 tokens when they fire; untrusted Discord may only create these. */
export const CronComplexitySchema = z.enum(["simple", "complex"]);
export type CronComplexity = z.infer<typeof CronComplexitySchema>;

export const CronDeliverSchema = z.enum(["discord_dm", "voice", "both"]);
export type CronDeliver = z.infer<typeof CronDeliverSchema>;

export const CronStatusSchema = z.enum(["active", "paused", "completed", "cancelled"]);
export type CronStatus = z.infer<typeof CronStatusSchema>;

export const CronJobSchema = z.object({
  id: z.number(),
  title: z.string(),
  prompt: z.string(),
  complexity: CronComplexitySchema,
  deliverDiscord: z.boolean(),
  deliverVoice: z.boolean(),
  discordUserId: z.string().nullable(),
  voicePointId: z.string().nullable(),
  nextRunAt: z.number(),
  intervalMs: z.number().nullable(),
  createdByKind: z.enum(["web", "discord", "voice"]),
  createdById: z.string(),
  status: CronStatusSchema,
  lastRunAt: z.number().nullable(),
  lastTokens: z.number().nullable(),
  createdAt: z.number(),
});
export type CronJob = z.infer<typeof CronJobSchema>;

/** Soft cap for simple scheduled runs (prompt + completion tokens). */
export const CRON_SIMPLE_TOKEN_BUDGET = 500;
/** Max active simple jobs for Discord users who are not on the allowlist. */
export const CRON_UNTRUSTED_MAX_SIMPLE = 3;
