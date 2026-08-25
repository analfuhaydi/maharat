import { Timestamp } from "firebase-admin/firestore";

import {
  ConversationCreatedResponseSchema,
  ConversationStartRequestSchema,
  type MateMessage,
} from "@/lib/conversation-schema";
import {
  firestore,
  getAuthenticatedUserId,
  getMessageReference,
} from "@/lib/firebase-admin";
import { generateMateOpening, generateSpeech } from "@/lib/groq";

export async function POST(request: Request) {
  let userId: string;

  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "غير مصرح." }, { status: 401 });
  }

  try {
    const startRequest = ConversationStartRequestSchema.safeParse(
      await request.json().catch(() => ({})),
    );

    if (!startRequest.success) {
      return Response.json(
        { error: "بيانات بدء المحادثة غير صالحة." },
        { status: 400 },
      );
    }

    const mate = await generateMateOpening(startRequest.data.timeOfDay);
    const audioUrl = await generateSpeech(mate.text);
    const createdAt = Timestamp.now();
    const userReference = firestore.collection("users").doc(userId);
    const conversationReference = userReference
      .collection("conversations")
      .doc();
    const messageReference = getMessageReference(
      conversationReference,
      "mate",
      1,
    );
    const message: MateMessage = {
      id: messageReference.id,
      sender: "mate",
      text: mate.text,
      arabicTranslation: mate.arabicTranslation,
      helpAnswer: mate.helpAnswer,
      createdAt: createdAt.toDate().toISOString(),
    };

    await firestore.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userReference);

      if (!userSnapshot.exists)
        transaction.create(userReference, { createdAt });

      transaction.create(conversationReference, { createdAt });
      transaction.create(messageReference, {
        sender: "mate",
        text: mate.text,
        arabicTranslation: mate.arabicTranslation,
        helpAnswer: mate.helpAnswer,
        createdAt,
      });
    });

    return Response.json(
      ConversationCreatedResponseSchema.parse({
        conversationId: conversationReference.id,
        message,
        audioUrl,
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Failed to create conversation", error);
    return Response.json(
      { error: "تعذر بدء المحادثة. حاول مرة أخرى." },
      { status: 500 },
    );
  }
}
