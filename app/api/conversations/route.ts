import { Timestamp } from "firebase-admin/firestore";

import { ConversationCreatedResponseSchema } from "@/lib/conversation-schema";
import {
  firestore,
  getAuthenticatedUserId,
  getNextMessageReference,
} from "@/lib/firebase-admin";
import { generateMaharatResponse, generateMaharatSpeech } from "@/lib/groq";

export async function POST(request: Request) {
  let userId: string;

  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "غير مصرح." }, { status: 401 });
  }

  try {
    const maharatResponse = await generateMaharatResponse([
      {
        role: "user",
        content:
          "Begin the English speaking conversation with a short, friendly opening question.",
      },
    ]);
    const audio = await generateMaharatSpeech(maharatResponse.text);
    const userReference = firestore.collection("users").doc(userId);
    const conversationReference = userReference
      .collection("conversations")
      .doc();
    const messageReference = await getNextMessageReference(
      conversationReference,
      "maharat",
    );
    const createdAt = Timestamp.now();

    await firestore.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userReference);

      if (!userSnapshot.exists) {
        transaction.create(userReference, { createdAt });
      }

      transaction.create(conversationReference, { createdAt });
      transaction.create(messageReference, {
        sender: "maharat",
        text: maharatResponse.text,
        createdAt,
        playbackStartedAt: null,
        playbackEndedAt: null,
      });
    });

    const response = ConversationCreatedResponseSchema.parse({
      conversationId: conversationReference.id,
      message: {
        id: messageReference.id,
        sender: "maharat",
        text: maharatResponse.text,
        createdAt: createdAt.toDate().toISOString(),
        playbackStartedAt: null,
        playbackEndedAt: null,
      },
      audioBase64: Buffer.from(audio).toString("base64"),
    });

    return Response.json(response);
  } catch (error) {
    console.error("Failed to create conversation", error);
    return Response.json(
      { error: "تعذر بدء المحادثة. حاول مرة أخرى." },
      { status: 500 },
    );
  }
}
