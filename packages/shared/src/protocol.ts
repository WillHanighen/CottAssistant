import { z } from "zod";
import { AudioDeviceSchema } from "./types";

/** WebSocket messages between main server and satellite voice daemons */
export const DaemonToServerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    pointId: z.string(),
    name: z.string(),
    token: z.string(),
    devices: z.array(AudioDeviceSchema),
  }),
  z.object({
    type: z.literal("device_list"),
    pointId: z.string(),
    devices: z.array(AudioDeviceSchema),
  }),
  z.object({
    type: z.literal("wake"),
    pointId: z.string(),
    at: z.number(),
  }),
  z.object({
    type: z.literal("transcript"),
    pointId: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("audio_chunk"),
    pointId: z.string(),
    /** base64 PCM s16le 16kHz mono */
    pcmBase64: z.string(),
  }),
  z.object({
    type: z.literal("ping"),
    pointId: z.string(),
  }),
]);
export type DaemonToServer = z.infer<typeof DaemonToServerSchema>;

export const ServerToDaemonSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    pointId: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
  z.object({
    type: z.literal("set_devices"),
    inputDeviceId: z.string().nullable(),
    outputDeviceId: z.string().nullable(),
  }),
  z.object({
    type: z.literal("tts_audio"),
    /** base64 wav or pcm */
    audioBase64: z.string(),
    format: z.enum(["wav", "pcm_s16le_16k"]),
  }),
  z.object({
    type: z.literal("pong"),
  }),
  z.object({
    type: z.literal("request_devices"),
  }),
  z.object({
    type: z.literal("listen_again"),
    /** Seconds to record after the listen-start cue */
    seconds: z.number().positive().optional(),
  }),
]);
export type ServerToDaemon = z.infer<typeof ServerToDaemonSchema>;
