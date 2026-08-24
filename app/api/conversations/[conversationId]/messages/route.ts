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
  createNextMessage,
  firestore,
  getAuthenticatedUserId,
} from "@/lib/firebase-admin";
import {
  generateCoachResponse,
  generateMateResponse,
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
    text: data.text,
    createdAt: timestampToIso(data.createdAt),
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
      : { role: "user", content: message.text },
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

            send({
              type: "coachFeedback",
              accepted: false,
              transcript: whisperResponse.text,
              suggestedSpokenVersion: coach.suggestedSpokenVersion,
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
        const userMessageData = {
          sender: "user",
          text: whisperResponse.text,
          createdAt: userCreatedAt,
        };
        const userMessageReference = await createNextMessage(
          reference,
          "user",
          userMessageData,
        );
        const userMessage: UserMessage = {
          id: userMessageReference.id,
          sender: "user",
          text: whisperResponse.text,
          createdAt: userCreatedAt.toDate().toISOString(),
        };

        send({ type: "userMessage", message: userMessage });
        send({ type: "mateThinking" });

        const mate = await generateMateResponse(
          toConversationHistory([...messages, userMessage]),
        );

        const mateCreatedAt = Timestamp.now();
        const mateMessageReference = await createNextMessage(
          reference,
          "mate",
          {
            sender: "mate",
            text: mate.text,
            arabicTranslation: mate.arabicTranslation,
            createdAt: mateCreatedAt,
          },
        );
        const mateMessage: MateMessage = {
          id: mateMessageReference.id,
          sender: "mate",
          text: mate.text,
          arabicTranslation: mate.arabicTranslation,
          createdAt: mateCreatedAt.toDate().toISOString(),
        };

        send({
          type: "mateMessage",
          message: mateMessage,
        });
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
