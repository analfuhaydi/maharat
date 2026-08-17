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
  type Message,
} from "@/lib/conversation-schema";
import {
  firestore,
  getAuthenticatedUserId,
  getNextMessageReference,
} from "@/lib/firebase-admin";
import {
  generateMaharatResponse,
  generateMaharatSpeech,
  transcribeRecording,
  type GroqConversationMessage,
} from "@/lib/groq";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

function timestampToIso(value: unknown) {
  if (!(value instanceof Timestamp)) {
    throw new Error("Invalid Firestore timestamp.");
  }

  return value.toDate().toISOString();
}

function documentToMessage(
  document: QueryDocumentSnapshot<DocumentData>,
): Message {
  const data = document.data();

  if (data.sender === "maharat") {
    return MessageSchema.parse({
      id: document.id,
      sender: "maharat",
      text: data.text,
      createdAt: timestampToIso(data.createdAt),
      playbackStartedAt: data.playbackStartedAt
        ? timestampToIso(data.playbackStartedAt)
        : null,
      playbackEndedAt: data.playbackEndedAt
        ? timestampToIso(data.playbackEndedAt)
        : null,
    });
  }

  return MessageSchema.parse({
    id: document.id,
    sender: "user",
    createdAt: timestampToIso(data.createdAt),
    recordingStartedAt: timestampToIso(data.recordingStartedAt),
    recordingEndedAt: timestampToIso(data.recordingEndedAt),
    whisperResponse: data.whisperResponse,
  });
}

async function getConversation(userId: string, conversationId: string) {
  const reference = firestore
    .collection("users")
    .doc(userId)
    .collection("conversations")
    .doc(conversationId);
  const snapshot = await reference.get();

  return snapshot.exists ? reference : null;
}

export async function GET(request: Request, context: RouteContext) {
  let userId: string;

  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "غير مصرح." }, { status: 401 });
  }

  const { conversationId } = await context.params;
  const conversationReference = await getConversation(userId, conversationId);

  if (!conversationReference) {
    return Response.json({ error: "المحادثة غير موجودة." }, { status: 404 });
  }

  const snapshot = await conversationReference
    .collection("messages")
    .orderBy("createdAt", "asc")
    .get();
  const response = MessagesResponseSchema.parse({
    messages: snapshot.docs.map(documentToMessage),
  });

  return Response.json(response);
}

export async function POST(request: Request, context: RouteContext) {
  let userId: string;

  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "غير مصرح." }, { status: 401 });
  }

  const { conversationId } = await context.params;
  const conversationReference = await getConversation(userId, conversationId);

  if (!conversationReference) {
    return Response.json({ error: "المحادثة غير موجودة." }, { status: 404 });
  }

  const formData = await request.formData();
  const recording = formData.get("recording");
  const timingResult = RecordingRequestSchema.safeParse({
    recordingStartedAt: formData.get("recordingStartedAt"),
    recordingEndedAt: formData.get("recordingEndedAt"),
  });

  if (!(recording instanceof File) || !timingResult.success) {
    return Response.json({ error: "التسجيل غير صالح." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        const validatedEvent = ConversationStreamEventSchema.parse(event);
        controller.enqueue(
          encoder.encode(`${JSON.stringify(validatedEvent)}\n`),
        );
      };

      try {
        const whisperResponse = await transcribeRecording(recording);
        const userMessageReference = await getNextMessageReference(
          conversationReference,
          "user",
        );
        const userMessageCreatedAt = Timestamp.now();

        await userMessageReference.create({
          sender: "user",
          createdAt: userMessageCreatedAt,
          recordingStartedAt: Timestamp.fromMillis(
            timingResult.data.recordingStartedAt,
          ),
          recordingEndedAt: Timestamp.fromMillis(
            timingResult.data.recordingEndedAt,
          ),
          whisperResponse,
        });

        send({
          type: "userMessage",
          message: {
            id: userMessageReference.id,
            sender: "user",
            createdAt: userMessageCreatedAt.toDate().toISOString(),
            recordingStartedAt: new Date(
              timingResult.data.recordingStartedAt,
            ).toISOString(),
            recordingEndedAt: new Date(
              timingResult.data.recordingEndedAt,
            ).toISOString(),
            whisperResponse,
          },
        });
        send({ type: "maharatThinking" });

        const messagesSnapshot = await conversationReference
          .collection("messages")
          .orderBy("createdAt", "asc")
          .get();
        const conversationMessages: GroqConversationMessage[] =
          messagesSnapshot.docs.map((document) => {
            const message = documentToMessage(document);

            return message.sender === "maharat"
              ? { role: "assistant", content: message.text }
              : { role: "user", content: message.whisperResponse.text };
          });
        const maharatResponse =
          await generateMaharatResponse(conversationMessages);

        send({ type: "maharatGeneratingSpeech" });
        const audio = await generateMaharatSpeech(maharatResponse.text);
        const maharatMessageReference = await getNextMessageReference(
          conversationReference,
          "maharat",
        );
        const maharatMessageCreatedAt = Timestamp.now();

        await maharatMessageReference.create({
          sender: "maharat",
          text: maharatResponse.text,
          createdAt: maharatMessageCreatedAt,
          playbackStartedAt: null,
          playbackEndedAt: null,
        });

        send({
          type: "maharatMessage",
          message: {
            id: maharatMessageReference.id,
            sender: "maharat",
            text: maharatResponse.text,
            createdAt: maharatMessageCreatedAt.toDate().toISOString(),
            playbackStartedAt: null,
            playbackEndedAt: null,
          },
          audioBase64: Buffer.from(audio).toString("base64"),
        });
      } catch (error) {
        console.error("Failed to process conversation message", error);
        send({
          type: "error",
          message: "تعذر إكمال المحادثة. حاول مرة أخرى.",
        });
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
