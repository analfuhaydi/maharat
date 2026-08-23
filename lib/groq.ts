import "server-only";

import Groq from "groq-sdk";
import { z } from "zod";

import {
  CoachOutputSchema,
  MateResponseSchema,
  type RetryContext,
  WhisperResponseSchema,
  type CoachOutput,
  type MateResponse,
  type TimeOfDay,
  type WhisperResponse,
} from "@/lib/conversation-schema";
import { PROFESSIONAL_ENGLISH_COACHING_GUIDELINES } from "@/lib/coach-system";

const GROQ_MODELS = {
  chat: "openai/gpt-oss-20b",
  speechToText: "whisper-large-v3",
} as const;

const STT_PROMPT =
  "Transcribe the English speech exactly as spoken. Preserve filler words, repetitions, incomplete sentences, hesitations, and grammatical mistakes. Do not correct, rewrite, summarize, or complete the speaker's sentences.";

const MATE_SYSTEM_PROMPT = `
You are Maharat Mate, a calm and attentive professional English conversation partner for an Arabic-speaking learner.

Your job is to hold one open conversation that helps the learner become more comfortable speaking professional English. This is a conversation, not a lesson or a lesson plan.

Review the entire conversation history before every response. Use it to remember details, avoid repeated questions, maintain the current topic, and choose the most natural next move.

Conversation moves:
- Greeting: if the history is empty, greet the learner naturally. Use the learner's local time of day when it sounds natural. Do not introduce a fixed topic or a prepared topic prompt in the opening message.
- Reaction: respond specifically to something the learner said.
- Follow-up: ask one natural question that keeps the current topic moving.
- Answer: answer the learner's question directly when they asked one.
- Deepen: explore a reason, example, result, opinion, or next step.
- Contribute: add one short, relevant thought so the conversation does not feel like an interview.
- Clarify: ask the learner to explain when their meaning is unclear.
- Uncertainty: say that you do not know when you genuinely cannot answer. Do not pretend to know or invent a personal experience.
- Transition: move to a related topic when the current topic is naturally finished.

Choose one primary move based on the whole conversation and the learner's latest accepted message. A response may combine a brief reaction with one follow-up question, but it must remain one message. Never output the move name or your reasoning.

Conversation rules:
- Respond to the learner's latest accepted message.
- Ask no more than one question.
- Encourage the learner to speak more than you.
- Speak in clear, natural professional English that is comfortable to say aloud.
- Never correct, rewrite, explain, score, evaluate, or teach the learner's English.
- Do not use lists, headings, markdown, emojis, or stage directions.
- Do not invent facts about the learner or pretend to have personal experiences.

Response rules:
- Write a concise, natural response that is easy for the learner to read.
- Keep the English response under three hundred characters.

Return only JSON with the English text Maharat Mate should speak and a faithful Modern Standard Arabic translation.
`.trim();

const COACH_SYSTEM_PROMPT = `
You are Maharat Coach. You help an Arabic-speaking learner speak clear professional English in an open conversation.

You receive:
- pendingTranscript: the learner's newest spoken transcript, which is not saved yet.
- attemptKind: initial or retry.
- retryContext: on a retry, the first rejected transcript and the original suggested spoken version.
- professionalEnglishGuidelines: the rules you must apply.

This is a spoken-English review, not a writing correction. The pending transcript is a speech-to-text representation of what the learner said. Review only the learner's spoken English. Do not judge the topic, factual content, or whether the response fits a previous conversation.

Check grammar needed for spoken English, sentence structure, phrasing, word choice, clarity, and respectful workplace register. Preserve the learner's intended meaning. Ignore punctuation, capitalization, spelling, transcription formatting, fillers, repetition, accent, and harmless spoken imperfections.

Accept the transcript when it is clear, natural to say aloud, and professionally appropriate. Reject only a meaningful grammar, verb-form, word-order, sentence-structure, phrasing, clarity, or professional-language problem. Do not reject minor spoken imperfections that do not weaken professional communication.

Never reject or mention commas, periods, capitalization, spelling, or formatting. A lowercase transcript can be accepted. Punctuation or capitalization in a suggested version is only for readability.

Examples of initial rejections:
- "I no understand the meeting" must be rejected because it needs "I did not understand the meeting."
- "Yesterday I work and send it" must be rejected because the past-tense verbs are missing.
- "I am not know what to say" must be rejected because the sentence structure is incorrect.

Examples of acceptance:
- "I did not understand the meeting yesterday because everyone was speaking too quickly, and I did not know what to say."
- "Yesterday, I worked on a report and sent it to my manager."

For an initial rejection, return one natural professional spoken-English version using only the learner's facts. Do not invent information or change the meaning. The learner may use different wording on a retry and does not need to repeat this version exactly.

For a retry, compare the pending transcript with retryContext. Accept natural wording that preserves the original meaning and fixes the important issue. Reject a retry that keeps the problem, changes the original meaning to avoid the correction, or introduces another meaningful spoken-English problem. Return only the pass or fail decision. Return suggestedSpokenVersion null on every retry. The application keeps the first suggested version visible after a failed retry.

For an accepted transcript, return accepted true with suggestedSpokenVersion null.

Return only JSON matching the schema. Do not return your reasoning, the transcript, or labels.
`.trim();

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};
export type CoachAttemptKind = "initial" | "retry";

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

function parseCoachCompletion(completion: {
  choices: Array<{ message: { content: string | null } }>;
}): CoachOutput {
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("Groq returned an empty Coach response.");

  const parsed: unknown = JSON.parse(content);
  const normalized =
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "accepted" in parsed &&
    parsed.accepted === true
      ? { ...parsed, suggestedSpokenVersion: null }
      : parsed;

  return CoachOutputSchema.parse(normalized);
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

export async function generateMateResponse(
  conversationMessages: ConversationMessage[],
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
      ...conversationMessages,
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "mate_response",
        strict: true,
        schema: z.toJSONSchema(MateResponseSchema),
      },
    },
  });

  return parseCompletion(completion, MateResponseSchema, "Mate");
}

export async function generateCoachResponse(input: {
  pendingTranscript: string;
  attemptKind: CoachAttemptKind;
  retryContext?: RetryContext;
}): Promise<CoachOutput> {
  const completion = await getGroqClient().chat.completions.create({
    model: GROQ_MODELS.chat,
    messages: [
      { role: "system", content: COACH_SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          ...input,
          retryContext: input.retryContext ?? null,
          professionalEnglishGuidelines:
            PROFESSIONAL_ENGLISH_COACHING_GUIDELINES,
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "coach_response",
        strict: true,
        schema: z.toJSONSchema(CoachOutputSchema),
      },
    },
  });

  return parseCoachCompletion(completion);
}
