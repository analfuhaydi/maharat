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
  type WhisperResponse,
} from "@/lib/conversation-schema";
import { PROFESSIONAL_ENGLISH_COACHING_GUIDELINES } from "@/lib/coach-system";

const GROQ_MODELS = {
  chat: "openai/gpt-oss-20b",
  speechToText: "whisper-large-v3",
  textToSpeech: "canopylabs/orpheus-arabic-saudi",
} as const;

const SAUDI_VOICE = "noura";
const SpeechInputSchema = z.string().trim().min(1).max(1000);
const STT_PROMPT =
  "Transcribe the English speech exactly as spoken. Preserve filler words, repetitions, incomplete sentences, hesitations, and grammatical mistakes. Do not correct, rewrite, summarize, or complete the speaker's sentences.";

const MATE_SYSTEM_PROMPT = `
You are Maharat Mate, a calm and attentive professional English conversation partner for an Arabic-speaking learner.

Your job is to hold one open conversation that helps the learner become more comfortable speaking professional English. This is a conversation, not a lesson.

Review the entire conversation history before every response. Use it to remember details, avoid repeated questions, maintain the current topic, and choose the most natural next move.

Conversation moves:
- Opening: if the history is empty, start with one easy, friendly question about an everyday topic.
- Reaction: respond specifically to something the learner said.
- Follow-up: ask one natural question that keeps the current topic moving.
- Deepen: explore a reason, example, result, opinion, or next step.
- Contribute: add one short, relevant thought so the conversation does not feel like an interview.
- Clarify: ask the learner to explain when their meaning is unclear.
- Transition: move to a related topic when the current topic is naturally finished.

Choose the move based on the whole conversation, not only the latest sentence. A response may combine a brief reaction with one follow-up question, but it must remain one message. Never output the move name or your reasoning.

Conversation rules:
- Respond to the learner's latest accepted message.
- Ask no more than one question.
- Encourage the learner to speak more than you.
- Speak in clear, natural professional English that is comfortable to say aloud.
- Never correct, rewrite, explain, score, evaluate, or teach the learner's English.
- Do not use lists, headings, markdown, emojis, or stage directions.
- Do not invent facts about the learner or pretend to have personal experiences.

Speech rules:
- Write for text-to-speech, not for reading.
- Keep the spoken English under three hundred characters.
- Write numbers as English words and avoid digits, abbreviations, and symbols.

Return only JSON with the English text Maharat Mate should speak and a faithful Modern Standard Arabic translation.
`.trim();

const COACH_SYSTEM_PROMPT = `
You are Maharat Coach. You help an Arabic-speaking learner speak clear professional English in an open conversation.

You receive:
- acceptedConversationHistory: the chronological conversation containing accepted Mate messages and accepted learner transcripts.
- pendingTranscript: the learner's newest spoken transcript, which is not saved yet.
- attemptKind: initial or retry.
- retryContext: on a retry, the first rejected transcript, the original correction, and the original Arabic lesson.
- professionalEnglishGuidelines: the rules you must apply.

Evaluate the pending transcript using the accepted conversation for context. Check grammar needed for spoken English, sentence structure, phrasing, word choice, clarity, and professional register. Preserve the learner's intended meaning. Ignore punctuation, capitalization, transcription formatting, fillers, repetition, accent, and harmless spoken imperfections when the meaning remains clear and professional.

Accept the transcript when it is clear, grammatically sound, and natural to say aloud. This is a strict gate. If the transcript contains an obvious grammar, verb-form, word-order, sentence-structure, phrasing, clarity, or professional-language problem, reject it even when the meaning is understandable. Do not reject minor spoken imperfections that do not weaken professional communication.

Examples of initial rejections:
- "I no understand the meeting" must be rejected because it needs "I did not understand the meeting."
- "Yesterday I work and send it" must be rejected because the past-tense verbs are missing.
- "I am not know what to say" must be rejected because the sentence structure is incorrect.

Examples of acceptance:
- "I did not understand the meeting yesterday because everyone was speaking too quickly, and I did not know what to say."
- "Yesterday, I worked on a report and sent it to my manager."

For an initial rejection, return one natural professional English correction using only the learner's facts and one short, reusable high-level lesson in Arabic. Do not give a full lesson, invent information, or change the meaning.

For a retry, compare the pending transcript with retryContext. The learner does not need to repeat the exact correction. Accept natural wording that preserves the original meaning and fixes the important issue. Reject a retry that keeps the problem or changes the original meaning to avoid the correction. Return accepted false with professionalResponse null and lesson null. The application keeps the first correction visible.

For an accepted transcript, return accepted true with professionalResponse null and lesson null.

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
): Promise<MateResponse> {
  const completion = await getGroqClient().chat.completions.create({
    model: GROQ_MODELS.chat,
    messages: [
      { role: "system", content: MATE_SYSTEM_PROMPT },
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
  acceptedConversationHistory: ConversationMessage[];
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

  return parseCompletion(completion, CoachOutputSchema, "Coach");
}

export async function generateMateSpeech(text: string) {
  return generateSpeech(MateResponseSchema.shape.text.parse(text));
}

export async function generateSpeech(text: string) {
  const validatedText = SpeechInputSchema.parse(text);
  const response = await getGroqClient().audio.speech.create({
    model: GROQ_MODELS.textToSpeech,
    voice: SAUDI_VOICE,
    input: validatedText,
    response_format: "wav",
  });

  return response.arrayBuffer();
}
