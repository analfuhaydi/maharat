import { z } from "zod";

const IsoDateSchema = z.iso.datetime();

export const WhisperResponseSchema = z
  .object({
    text: z.string(),
  })
  .passthrough();

export const MaharatResponseSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^0-9]*$/, "Numeric digits are not allowed."),
});

export const MaharatMessageSchema = z.object({
  id: z.string().min(1),
  sender: z.literal("maharat"),
  text: z.string().min(1),
  createdAt: IsoDateSchema,
  playbackStartedAt: IsoDateSchema.nullable(),
  playbackEndedAt: IsoDateSchema.nullable(),
});

export const UserMessageSchema = z.object({
  id: z.string().min(1),
  sender: z.literal("user"),
  createdAt: IsoDateSchema,
  recordingStartedAt: IsoDateSchema,
  recordingEndedAt: IsoDateSchema,
  whisperResponse: WhisperResponseSchema,
});

export const MessageSchema = z.discriminatedUnion("sender", [
  MaharatMessageSchema,
  UserMessageSchema,
]);

export const MessagesResponseSchema = z.object({
  messages: z.array(MessageSchema),
});

export const ConversationCreatedResponseSchema = z.object({
  conversationId: z.string().min(1),
  message: MaharatMessageSchema,
  audioBase64: z.string().min(1),
});

export const RecordingRequestSchema = z.object({
  recordingStartedAt: z.coerce.number().int().nonnegative(),
  recordingEndedAt: z.coerce.number().int().nonnegative(),
});

export const PlaybackUpdateSchema = z
  .object({
    playbackStartedAt: IsoDateSchema.optional(),
    playbackEndedAt: IsoDateSchema.optional(),
  })
  .refine(
    (value) => value.playbackStartedAt || value.playbackEndedAt,
    "A playback timestamp is required.",
  );

export const ConversationStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("userMessage"), message: UserMessageSchema }),
  z.object({ type: z.literal("maharatThinking") }),
  z.object({ type: z.literal("maharatGeneratingSpeech") }),
  z.object({
    type: z.literal("maharatMessage"),
    message: MaharatMessageSchema,
    audioBase64: z.string().min(1),
  }),
  z.object({ type: z.literal("error"), message: z.string().min(1) }),
]);

export type WhisperResponse = z.infer<typeof WhisperResponseSchema>;
export type MaharatResponse = z.infer<typeof MaharatResponseSchema>;
export type MaharatMessage = z.infer<typeof MaharatMessageSchema>;
export type UserMessage = z.infer<typeof UserMessageSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ConversationStreamEvent = z.infer<
  typeof ConversationStreamEventSchema
>;
