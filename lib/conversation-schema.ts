import { z } from "zod";

const IsoDateSchema = z.iso.datetime();

export const WhisperResponseSchema = z
  .object({ text: z.string() })
  .passthrough();

export const MateResponseSchema = z.object({
  text: z.string().trim().min(1).max(300),
  arabicTranslation: z.string().trim().min(1).max(400),
});

export const CoachOutputSchema = z
  .object({
    accepted: z.boolean(),
    professionalResponse: z.string().trim().min(1).max(1000).nullable(),
    lesson: z.string().trim().min(1).max(500).nullable(),
  })
  .superRefine((value, context) => {
    if (value.accepted && (value.professionalResponse || value.lesson)) {
      context.addIssue({
        code: "custom",
        message: "Accepted coach responses cannot contain feedback.",
      });
    }
  });

export const RetryContextSchema = z.object({
  transcript: z.string().trim().min(1),
  professionalResponse: z.string().trim().min(1),
  lesson: z.string().trim().min(1),
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
  transcript: z.string().min(1),
  createdAt: IsoDateSchema,
  recordingStartedAt: IsoDateSchema,
  recordingEndedAt: IsoDateSchema,
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
  audioBase64: z.string().min(1).nullable(),
});

export const RecordingAttemptKindSchema = z.enum(["initial", "retry"]);

export const RecordingRequestSchema = z.object({
  recordingStartedAt: z.coerce.number().int().nonnegative(),
  recordingEndedAt: z.coerce.number().int().nonnegative(),
  attemptKind: RecordingAttemptKindSchema,
  retryContext: z.string().optional(),
});

export const ConversationStreamEventSchema = z.union([
  z.object({
    type: z.literal("coachFeedback"),
    accepted: z.literal(true),
  }),
  z.object({
    type: z.literal("coachFeedback"),
    accepted: z.literal(false),
    transcript: z.string().min(1),
    professionalResponse: z.string().min(1),
    lesson: z.string().min(1),
    professionalResponseAudioBase64: z.string().min(1).nullable(),
  }),
  z.object({
    type: z.literal("coachRetryRejected"),
    transcript: z.string().min(1),
  }),
  z.object({ type: z.literal("mateThinking") }),
  z.object({
    type: z.literal("userMessage"),
    message: UserMessageSchema,
  }),
  z.object({
    type: z.literal("mateMessage"),
    message: MateMessageSchema,
    audioBase64: z.string().min(1).nullable(),
  }),
  z.object({ type: z.literal("error"), message: z.string().min(1) }),
]);

export type WhisperResponse = z.infer<typeof WhisperResponseSchema>;
export type MateResponse = z.infer<typeof MateResponseSchema>;
export type CoachOutput = z.infer<typeof CoachOutputSchema>;
export type RetryContext = z.infer<typeof RetryContextSchema>;
export type MateMessage = z.infer<typeof MateMessageSchema>;
export type UserMessage = z.infer<typeof UserMessageSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ConversationStreamEvent = z.infer<
  typeof ConversationStreamEventSchema
>;
