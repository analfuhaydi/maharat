import type {
  DocumentData,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";

import {
  ConversationTurnResponseSchema,
  MessageSchema,
  MessagesResponseSchema,
  type Message,
  type MateMessage,
  type UserMessage,
} from "@/lib/conversation-schema";
import {
  createConversationTurn,
  firestore,
  getAuthenticatedUserId,
} from "@/lib/firebase-admin";
import {
  generateMateTurn,
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

  if (!(recording instanceof File)) {
    return Response.json({ error: "التسجيل غير صالح." }, { status: 400 });
  }

  try {
    const [whisperResponse, messages] = await Promise.all([
      transcribeRecording(recording),
      readMessages(reference),
    ]);

    if (!whisperResponse.text.trim()) throw new Error("Empty transcription.");

    const mate = await generateMateTurn(
      toConversationHistory(messages),
      whisperResponse.text,
    );

    if (mate.outcome === "correction") {
      return Response.json(
        ConversationTurnResponseSchema.parse({
          outcome: "correction",
          transcript: whisperResponse.text,
          suggestedSpokenVersion: mate.suggestedSpokenVersion,
        }),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const userCreatedAt = Timestamp.now();
    const mateCreatedAt = Timestamp.fromMillis(userCreatedAt.toMillis() + 1);
    const userMessageData = {
      sender: "user",
      text: whisperResponse.text,
      createdAt: userCreatedAt,
    };
    const mateMessageData = {
      sender: "mate",
      text: mate.text,
      arabicTranslation: mate.arabicTranslation,
      createdAt: mateCreatedAt,
    };
    const { userMessageReference, mateMessageReference } =
      await createConversationTurn(reference, userMessageData, mateMessageData);
    const userMessage: UserMessage = {
      id: userMessageReference.id,
      sender: "user",
      text: whisperResponse.text,
      createdAt: userCreatedAt.toDate().toISOString(),
    };
    const mateMessage: MateMessage = {
      id: mateMessageReference.id,
      sender: "mate",
      text: mate.text,
      arabicTranslation: mate.arabicTranslation,
      createdAt: mateCreatedAt.toDate().toISOString(),
    };

    return Response.json(
      ConversationTurnResponseSchema.parse({
        outcome: "reply",
        userMessage,
        mateMessage,
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Failed to process conversation message", error);
    return Response.json(
      { error: "تعذر إكمال المحادثة. حاول مرة أخرى." },
      { status: 500 },
    );
  }
}
