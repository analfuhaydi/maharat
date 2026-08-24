import { z } from "zod";

const IsoDateSchema = z.iso.datetime();
const TtsAudioSchema = z.string().startsWith("data:audio/wav;base64,");

export const SpeechResponseSchema = z.object({ audioUrl: TtsAudioSchema });

export const WhisperResponseSchema = z
  .object({ text: z.string() })
  .passthrough();

export const MateResponseSchema = z.object({
  text: z.string().trim().min(1).max(300),
  arabicTranslation: z.string().trim().min(1).max(400),
});

export const MateTurnResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("correction"),
    suggestedSpokenVersion: z.string().trim().min(1).max(1000),
  }),
  z.object({
    outcome: z.literal("reply"),
    text: z.string().trim().min(1).max(300),
    arabicTranslation: z.string().trim().min(1).max(400),
  }),
]);

export const MateTurnEnvelopeSchema = z.object({
  result: MateTurnResultSchema,
});

export const MateOpeningEnvelopeSchema = z.object({
  result: z.object({
    outcome: z.literal("reply"),
    text: z.string().trim().min(1).max(300),
    arabicTranslation: z.string().trim().min(1).max(400),
  }),
});

export const ConversationStartRequestSchema = z.object({
  timeOfDay: z.enum(["morning", "afternoon", "evening"]).optional(),
});

export const MateMessageSchema = z.object({
  id: z.string().min(1),
  sender: z.literal("mate"),
  text: z.string().min(1),
  arabicTranslation: z.string().min(1),
  createdAt: IsoDateSchema,
});

export const UserMessageSchema = z.object({
  id: z.string().min(1),
  sender: z.literal("user"),
  text: z.string().min(1),
  createdAt: IsoDateSchema,
});

export const MessageSchema = z.discriminatedUnion("sender", [
  MateMessageSchema,
  UserMessageSchema,
]);

export const MessagesResponseSchema = z.object({
  messages: z.array(MessageSchema),
});

export const ConversationCreatedResponseSchema = z.object({
  conversationId: z.string().min(1),
  message: MateMessageSchema,
  audioUrl: TtsAudioSchema,
});

export const ConversationTurnResponseSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("correction"),
    transcript: z.string().min(1),
    suggestedSpokenVersion: z.string().min(1),
    audioUrl: TtsAudioSchema,
  }),
  z.object({
    outcome: z.literal("reply"),
    userMessage: UserMessageSchema,
    mateMessage: MateMessageSchema,
    audioUrl: TtsAudioSchema,
  }),
]);

export type WhisperResponse = z.infer<typeof WhisperResponseSchema>;
export type MateResponse = z.infer<typeof MateResponseSchema>;
export type MateTurnResult = z.infer<typeof MateTurnResultSchema>;
export type TimeOfDay = z.infer<
  typeof ConversationStartRequestSchema
>["timeOfDay"];
export type MateMessage = z.infer<typeof MateMessageSchema>;
export type UserMessage = z.infer<typeof UserMessageSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ConversationTurnResponse = z.infer<
  typeof ConversationTurnResponseSchema
>;
