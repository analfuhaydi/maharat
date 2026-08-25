import "server-only";

import Groq from "groq-sdk";
import { z } from "zod";

import {
  MateOpeningEnvelopeSchema,
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
  textToSpeech: "canopylabs/orpheus-arabic-saudi",
} as const;

const GROQ_TTS_VOICE = "noura";

const STT_PROMPT =
  "Transcribe the English speech exactly as spoken. Preserve filler words, repetitions, incomplete sentences, hesitations, and grammatical mistakes. Do not correct, rewrite, summarize, or complete the speaker's sentences.";

const MATE_JSON_FORMAT_PROMPT = `
Return only one valid JSON object. Do not include reasoning, commentary, markdown, or tool calls.

For a correction, use exactly:
{"result":{"outcome":"correction","suggestedSpokenVersion":"..."}}

For a reply, use exactly:
{"result":{"outcome":"reply","text":"...","arabicTranslation":"...","helpAnswer":"..."}}
`.trim();

const MATE_OPENING_JSON_FORMAT_PROMPT = `
Return only one valid JSON object. Do not include reasoning, commentary, markdown, or tool calls.

Use exactly:
{"result":{"outcome":"reply","text":"...","arabicTranslation":"...","helpAnswer":"..."}}
`.trim();

const MATE_SYSTEM_PROMPT = `
You are Maharat Mate, a calm and attentive English conversation partner for an Arabic-speaking learner.

Help the learner become comfortable speaking clear, natural, professional English through an open conversation.

Before responding, silently read the whole conversation and understand what the learner means. Then review the learner's latest message as spoken English captured by speech-to-text.

Ignore harmless spoken imperfections, including fillers, repetition, hesitation, punctuation, capitalization, spelling, and transcript formatting.

Accept the message when it is clear, natural to say aloud, and appropriate professional spoken English. Reject only an obvious English mistake that meaningfully weakens grammar, phrasing, clarity, or professional communication. Do not reject a message merely because you could make it more polished or formal.

If the message needs correction, return outcome "correction" with one suggestedSpokenVersion. Preserve the learner's intended meaning and use only information the learner provided. Make the suggestion natural and comfortable to say aloud. Do not explain the correction or continue the conversation.

In every English output, write numbers in words. For example, write "three" instead of "3".

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
- Ask exactly one question that is easy to answer aloud.
- Provide helpAnswer as a complete, natural example answer to that question. Keep it to one or two short sentences that are easy to say aloud.
- The learner may say helpAnswer as written or adapt it. Do not use names or specific personal details that may be false for the learner.

If the conversation is empty, greet the learner naturally, ask one easy question, and return a reply. Do not introduce a prepared lesson.

Place one valid correction or reply in the required result field. Never return your reasoning or fields from the other outcome.
`.trim();

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

function getGroqClients() {
  const apiKeys = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_FALLBACK_API_KEY,
    process.env.GROQ_FALLBACK_TWO_API_KEY,
  ].filter((apiKey): apiKey is string => Boolean(apiKey));

  if (!apiKeys.length) throw new Error("No Groq API key is configured.");
  return [...new Set(apiKeys)].map((apiKey) => new Groq({ apiKey }));
}

async function withGroqFallback<T>(
  operation: (client: Groq) => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (const client of getGroqClients()) {
    try {
      return await operation(client);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
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

type MatePromptMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

async function generateMateEnvelope<T>(
  messages: MatePromptMessage[],
  label: string,
  schema: z.ZodType<T>,
  formatPrompt = MATE_JSON_FORMAT_PROMPT,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const completion = await withGroqFallback((client) =>
        client.chat.completions.create({
          model: GROQ_MODELS.chat,
          messages: [
            { role: "system", content: MATE_SYSTEM_PROMPT },
            { role: "system", content: formatPrompt },
            ...messages,
            ...(attempt === 1
              ? [
                  {
                    role: "system" as const,
                    content:
                      "The previous response was invalid. Return only the required JSON object now, with no reasoning or extra fields.",
                  },
                ]
              : []),
          ],
          response_format: { type: "json_object" },
        }),
      );

      return await parseCompletion(completion, schema, label);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export async function transcribeRecording(
  recording: File,
): Promise<WhisperResponse> {
  const transcription = await withGroqFallback((client) =>
    client.audio.transcriptions.create({
      file: recording,
      model: GROQ_MODELS.speechToText,
      language: "en",
      temperature: 0,
      response_format: "json",
      prompt: STT_PROMPT,
    }),
  );

  return WhisperResponseSchema.parse(JSON.parse(JSON.stringify(transcription)));
}

export async function generateSpeech(text: string): Promise<string> {
  const audio = await withGroqFallback(async (client) => {
    const response = await client.audio.speech.create({
      model: GROQ_MODELS.textToSpeech,
      voice: GROQ_TTS_VOICE,
      input: text,
      response_format: "wav",
    });
    return Buffer.from(await response.arrayBuffer()).toString("base64");
  });
  return `data:audio/wav;base64,${audio}`;
}

export async function generateMateOpening(
  timeOfDay?: TimeOfDay,
): Promise<MateResponse> {
  const { result } = await generateMateEnvelope(
    [
      ...(timeOfDay
        ? [
            {
              role: "system" as const,
              content: `The learner's local time of day is ${timeOfDay}. Use this only to make an empty-history greeting sound natural.`,
            },
          ]
        : []),
      {
        role: "user",
        content:
          "Begin this new conversation now. There is no learner message to review, so return a reply greeting and never a correction.",
      },
    ],
    "Mate opening",
    MateOpeningEnvelopeSchema,
    MATE_OPENING_JSON_FORMAT_PROMPT,
  );
  return MateResponseSchema.parse(result);
}

export async function generateMateTurn(
  conversationMessages: ConversationMessage[],
  pendingTranscript: string,
): Promise<MateTurnResult> {
  const { result } = await generateMateEnvelope(
    [...conversationMessages, { role: "user", content: pendingTranscript }],
    "Mate turn",
    MateTurnEnvelopeSchema,
  );
  return MateTurnResultSchema.parse(result);
}
