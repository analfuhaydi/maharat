import "server-only";

import Groq from "groq-sdk";
import { z } from "zod";

import {
  MateResponseSchema,
  MateTurnEnvelopeSchema,
  MateTurnResultSchema,
  WhisperResponseSchema,
  type MateResponse,
  type MateTurnResult,
  type TimeOfDay,
  type WhisperResponse,
} from "@/lib/conversation-schema";

const GROQ_MODELS = {
  chat: "openai/gpt-oss-20b",
  speechToText: "whisper-large-v3",
  textToSpeech: "canopylabs/orpheus-v1-english",
} as const;

const MATE_VOICE = "hannah";

const STT_PROMPT =
  "Transcribe the English speech exactly as spoken. Preserve filler words, repetitions, incomplete sentences, hesitations, and grammatical mistakes. Do not correct, rewrite, summarize, or complete the speaker's sentences.";

const MATE_SYSTEM_PROMPT = `
You are Maharat Mate, a calm and attentive English conversation partner for an Arabic-speaking learner.

Help the learner become comfortable speaking clear, natural, professional English through an open conversation.

Before responding, silently read the whole conversation and understand what the learner means. Then review the learner's latest message as spoken English captured by speech-to-text.

Ignore harmless spoken imperfections, including fillers, repetition, hesitation, punctuation, capitalization, spelling, and transcript formatting.

Accept the message when it is clear, natural to say aloud, and appropriate professional spoken English. Reject only an obvious English mistake that meaningfully weakens grammar, phrasing, clarity, or professional communication. Do not reject a message merely because you could make it more polished or formal.

If the message needs correction, return outcome "correction" with one suggestedSpokenVersion. Preserve the learner's intended meaning and use only information the learner provided. Make the suggestion natural and comfortable to say aloud. Do not explain the correction or continue the conversation.

If the message is accepted, return outcome "reply" and continue the conversation naturally.

When continuing the conversation:
- Respond to what the learner means.
- Ask no more than one question.
- Encourage the learner to speak more than you.
- Use clear, natural English that is comfortable to say aloud.
- Do not correct, score, evaluate, or teach.
- Do not mention the private review.
- Do not use lists, headings, markdown, emojis, or stage directions.
- Do not invent facts or personal experiences.
- Keep the English reply under 300 characters.
- Provide a faithful Modern Standard Arabic translation.

If the conversation is empty, greet the learner naturally and return a reply. Do not introduce a prepared topic or lesson.

Place one valid correction or reply in the required result field. Never return your reasoning or fields from the other outcome.
`.trim();

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured.");
  return new Groq({ apiKey });
}

async function parseCompletion<T>(
  completion: { choices: Array<{ message: { content: string | null } }> },
  schema: z.ZodType<T>,
  label: string,
): Promise<T> {
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error(`Groq returned an empty ${label} response.`);
  return schema.parse(JSON.parse(content));
}

export async function transcribeRecording(
  recording: File,
): Promise<WhisperResponse> {
  const transcription = await getGroqClient().audio.transcriptions.create({
    file: recording,
    model: GROQ_MODELS.speechToText,
    language: "en",
    temperature: 0,
    response_format: "json",
    prompt: STT_PROMPT,
  });

  return WhisperResponseSchema.parse(JSON.parse(JSON.stringify(transcription)));
}

export async function synthesizeSpeech(text: string) {
  return getGroqClient().audio.speech.create({
    model: GROQ_MODELS.textToSpeech,
    voice: MATE_VOICE,
    input: text,
    response_format: "wav",
  });
}

export async function generateMateOpening(
  timeOfDay?: TimeOfDay,
): Promise<MateResponse> {
  const completion = await getGroqClient().chat.completions.create({
    model: GROQ_MODELS.chat,
    messages: [
      { role: "system", content: MATE_SYSTEM_PROMPT },
      ...(timeOfDay
        ? [
            {
              role: "system" as const,
              content: `The learner's local time of day is ${timeOfDay}. Use this only to make an empty-history greeting sound natural.`,
            },
          ]
        : []),
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "mate_opening",
        strict: true,
        schema: z.toJSONSchema(MateTurnEnvelopeSchema),
      },
    },
  });

  const { result } = await parseCompletion(
    completion,
    MateTurnEnvelopeSchema,
    "Mate opening",
  );
  if (result.outcome !== "reply") {
    throw new Error("Mate returned a correction for an empty conversation.");
  }
  return MateResponseSchema.parse(result);
}

export async function generateMateTurn(
  conversationMessages: ConversationMessage[],
  pendingTranscript: string,
): Promise<MateTurnResult> {
  const completion = await getGroqClient().chat.completions.create({
    model: GROQ_MODELS.chat,
    messages: [
      { role: "system", content: MATE_SYSTEM_PROMPT },
      ...conversationMessages,
      { role: "user", content: pendingTranscript },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "mate_turn_result",
        strict: true,
        schema: z.toJSONSchema(MateTurnEnvelopeSchema),
      },
    },
  });

  const { result } = await parseCompletion(
    completion,
    MateTurnEnvelopeSchema,
    "Mate turn",
  );
  return MateTurnResultSchema.parse(result);
}
