import "server-only";

import Groq from "groq-sdk";
import { z } from "zod";

import {
  MaharatResponseSchema,
  WhisperResponseSchema,
  type MaharatResponse,
  type WhisperResponse,
} from "@/lib/conversation-schema";

const GROQ_MODELS = {
  chat: "openai/gpt-oss-20b",
  speechToText: "whisper-large-v3",
  textToSpeech: "canopylabs/orpheus-arabic-saudi",
} as const;

const SAUDI_VOICE = "noura";

const STT_PROMPT = `
Transcribe the English speech exactly as spoken. Preserve filler words,
repetitions, incomplete sentences, hesitations, and grammatical mistakes.
Do not correct, rewrite, summarize, or complete the speaker's sentences.
`.trim();

const LLM_SYSTEM_PROMPT = `
You are Maharat, a calm English conversation partner for Arabic-speaking learners.

Your purpose is to help the learner become comfortable speaking English through natural conversation. This is a spoken conversation, not a lesson.

Conversation rules:
- Speak in simple, natural English.
- Adapt your vocabulary and sentence length to the learner's demonstrated level.
- Keep every reply short and comfortable to hear.
- Ask only one clear question at a time.
- Encourage the learner to speak more than you.
- Respond naturally to what the learner just said.
- Never correct, rewrite, explain, score, or mention the learner's mistakes.
- Do not use lists, headings, markdown, emojis, or written exercises.
- Do not mention that you are an AI or language model.
- Never invent personal facts about the learner.

Speech rules:
- Write for text-to-speech, not for reading.
- Use short sentences and natural punctuation.
- Write all numbers as English words. Never use numeric digits.
- Avoid abbreviations, symbols, parentheses, and unusual formatting.
- Do not include stage directions or text that should not be spoken.
- Keep the response under two hundred characters.

Return JSON that exactly matches the provided schema.
The text value must contain only the words Maharat should speak.
`.trim();

export type GroqConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  return new Groq({ apiKey });
}

export async function transcribeRecording(
  recording: File,
): Promise<WhisperResponse> {
  const transcription = await getGroqClient().audio.transcriptions.create({
    file: recording,
    model: GROQ_MODELS.speechToText,
    language: "en",
    temperature: 0,
    response_format: "verbose_json",
    prompt: STT_PROMPT,
  });

  return WhisperResponseSchema.parse(JSON.parse(JSON.stringify(transcription)));
}

export async function generateMaharatResponse(
  conversationMessages: GroqConversationMessage[],
): Promise<MaharatResponse> {
  const completion = await getGroqClient().chat.completions.create({
    model: GROQ_MODELS.chat,
    messages: [
      { role: "system", content: LLM_SYSTEM_PROMPT },
      ...conversationMessages,
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "maharat_response",
        strict: true,
        schema: z.toJSONSchema(MaharatResponseSchema),
      },
    },
  });

  const content = completion.choices[0]?.message.content;

  if (!content) {
    throw new Error("Groq returned an empty Maharat response.");
  }

  return MaharatResponseSchema.parse(JSON.parse(content));
}

export async function generateMaharatSpeech(text: string) {
  const validatedText = MaharatResponseSchema.shape.text.parse(text);
  const response = await getGroqClient().audio.speech.create({
    model: GROQ_MODELS.textToSpeech,
    voice: SAUDI_VOICE,
    input: validatedText,
    response_format: "wav",
  });

  return response.arrayBuffer();
}
