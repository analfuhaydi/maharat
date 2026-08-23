import type {
  DocumentData,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";

import {
  ConversationStreamEventSchema,
  MessageSchema,
  MessagesResponseSchema,
  RecordingRequestSchema,
  RetryContextSchema,
  type Message,
  type MateMessage,
  type UserMessage,
} from "@/lib/conversation-schema";
import {
  firestore,
  getAuthenticatedUserId,
  getNextMessageReference,
} from "@/lib/firebase-admin";
import {
  generateCoachResponse,
  generateMateResponse,
  generateMateSpeech,
  generateSpeech,
  transcribeRecording,
  type ConversationMessage,
} from "@/lib/groq";

type RouteContext = { params: Promise<{ conversationId: string }> };

function timestampToIso(value: unknown) {
  if (!(value instanceof Timestamp)) throw new Error("Invalid timestamp.");
  return value.toDate().toISOString();
}

function documentToMessage(
  document: QueryDocumentSnapshot<DocumentData>,
): Message {
  const data = document.data();

  if (data.sender === "mate") {
    return MessageSchema.parse({
      id: document.id,
      sender: "mate",
      text: data.text,
      arabicTranslation: data.arabicTranslation,
      createdAt: timestampToIso(data.createdAt),
    });
  }

  return MessageSchema.parse({
    id: document.id,
    sender: "user",
    transcript: data.transcript,
    createdAt: timestampToIso(data.createdAt),
    recordingStartedAt: timestampToIso(data.recordingStartedAt),
    recordingEndedAt: timestampToIso(data.recordingEndedAt),
  });
}

function conversationReference(userId: string, conversationId: string) {
  return firestore
    .collection("users")
    .doc(userId)
    .collection("conversations")
    .doc(conversationId);
}

function toConversationHistory(messages: Message[]): ConversationMessage[] {
  return messages.map((message) =>
    message.sender === "mate"
      ? { role: "assistant", content: message.text }
      : { role: "user", content: message.transcript },
  );
}

async function readMessages(reference: FirebaseFirestore.DocumentReference) {
  const snapshot = await reference
    .collection("messages")
    .orderBy("createdAt", "asc")
    .get();
  return snapshot.docs.map(documentToMessage);
}

export async function GET(request: Request, context: RouteContext) {
  let userId: string;

  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "غير مصرح." }, { status: 401 });
  }

  const { conversationId } = await context.params;
  const reference = conversationReference(userId, conversationId);

  if (!(await reference.get()).exists) {
    return Response.json({ error: "المحادثة غير موجودة." }, { status: 404 });
  }

  return Response.json(
    MessagesResponseSchema.parse({ messages: await readMessages(reference) }),
  );
}

export async function POST(request: Request, context: RouteContext) {
  let userId: string;

  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "غير مصرح." }, { status: 401 });
  }

  const { conversationId } = await context.params;
  const reference = conversationReference(userId, conversationId);

  if (!(await reference.get()).exists) {
    return Response.json({ error: "المحادثة غير موجودة." }, { status: 404 });
  }

  const formData = await request.formData();
  const recording = formData.get("recording");
  const timing = RecordingRequestSchema.safeParse({
    recordingStartedAt: formData.get("recordingStartedAt"),
    recordingEndedAt: formData.get("recordingEndedAt"),
    attemptKind: formData.get("attemptKind"),
    retryContext: formData.get("retryContext") ?? undefined,
  });

  if (!(recording instanceof File) || !timing.success) {
    return Response.json({ error: "التسجيل غير صالح." }, { status: 400 });
  }

  let retryContext: ReturnType<typeof RetryContextSchema.parse> | undefined;

  if (timing.data.attemptKind === "retry") {
    const rawRetryContext = timing.data.retryContext;

    if (!rawRetryContext) {
      return Response.json(
        { error: "بيانات المحاولة غير صالحة." },
        { status: 400 },
      );
    }

    try {
      retryContext = RetryContextSchema.parse(JSON.parse(rawRetryContext));
    } catch {
      return Response.json(
        { error: "بيانات المحاولة غير صالحة." },
        { status: 400 },
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(
          encoder.encode(
            JSON.stringify(ConversationStreamEventSchema.parse(event)) + "\n",
          ),
        );

      try {
        const [whisperResponse, messages] = await Promise.all([
          transcribeRecording(recording),
          readMessages(reference),
        ]);

        if (!whisperResponse.text.trim())
          throw new Error("Empty transcription.");

        const coach = await generateCoachResponse({
          pendingTranscript: whisperResponse.text,
          attemptKind: timing.data.attemptKind,
          retryContext,
        });

        if (!coach.accepted) {
          if (timing.data.attemptKind === "initial") {
            if (!coach.suggestedSpokenVersion) {
              throw new Error("Initial rejection is missing a suggestion.");
            }

            let suggestedSpokenVersionAudioBase64: string | null = null;

            try {
              suggestedSpokenVersionAudioBase64 = Buffer.from(
                await generateSpeech(coach.suggestedSpokenVersion),
              ).toString("base64");
            } catch (error) {
              console.warn(
                "Coach suggested version audio is temporarily unavailable",
                error,
              );
            }

            send({
              type: "coachFeedback",
              accepted: false,
              transcript: whisperResponse.text,
              suggestedSpokenVersion: coach.suggestedSpokenVersion,
              suggestedSpokenVersionAudioBase64,
            });
          } else {
            send({
              type: "coachRetryRejected",
              transcript: whisperResponse.text,
            });
          }

          return;
        }

        send({ type: "coachFeedback", accepted: true });

        const userCreatedAt = Timestamp.now();
        const userMessageReference = getNextMessageReference(reference);
        const userMessage: UserMessage = {
          id: userMessageReference.id,
          sender: "user",
          transcript: whisperResponse.text,
          createdAt: userCreatedAt.toDate().toISOString(),
          recordingStartedAt: Timestamp.fromMillis(
            timing.data.recordingStartedAt,
          )
            .toDate()
            .toISOString(),
          recordingEndedAt: Timestamp.fromMillis(timing.data.recordingEndedAt)
            .toDate()
            .toISOString(),
        };

        await userMessageReference.create({
          sender: "user",
          transcript: whisperResponse.text,
          createdAt: userCreatedAt,
          recordingStartedAt: Timestamp.fromMillis(
            timing.data.recordingStartedAt,
          ),
          recordingEndedAt: Timestamp.fromMillis(timing.data.recordingEndedAt),
        });
        send({ type: "userMessage", message: userMessage });
        send({ type: "mateThinking" });

        const mate = await generateMateResponse(
          toConversationHistory([...messages, userMessage]),
        );

        let audioBase64: string | null = null;

        try {
          audioBase64 = Buffer.from(
            await generateMateSpeech(mate.text),
          ).toString("base64");
        } catch (error) {
          console.warn("Mate reply audio is temporarily unavailable", error);
        }

        const mateCreatedAt = Timestamp.now();
        const mateMessageReference = getNextMessageReference(reference);
        const mateMessage: MateMessage = {
          id: mateMessageReference.id,
          sender: "mate",
          text: mate.text,
          arabicTranslation: mate.arabicTranslation,
          createdAt: mateCreatedAt.toDate().toISOString(),
        };

        await mateMessageReference.create({
          sender: "mate",
          text: mate.text,
          arabicTranslation: mate.arabicTranslation,
          createdAt: mateCreatedAt,
        });

        send({
          type: "mateMessage",
          message: mateMessage,
          audioBase64,
        });

        if (!audioBase64) {
          send({
            type: "error",
            message: "ردّ مهارات جاهز، لكن الصوت غير متاح مؤقتًا.",
          });
        }
      } catch (error) {
        console.error("Failed to process conversation message", error);
        send({ type: "error", message: "تعذر إكمال المحادثة. حاول مرة أخرى." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
