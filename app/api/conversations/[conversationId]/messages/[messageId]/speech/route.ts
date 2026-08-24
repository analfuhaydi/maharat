import { firestore, getAuthenticatedUserId } from "@/lib/firebase-admin";
import { generateSpeech } from "@/lib/groq";
import { SpeechResponseSchema } from "@/lib/conversation-schema";

type RouteContext = {
  params: Promise<{ conversationId: string; messageId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  let userId: string;

  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "غير مصرح." }, { status: 401 });
  }

  try {
    const { conversationId, messageId } = await context.params;
    const message = await firestore
      .collection("users")
      .doc(userId)
      .collection("conversations")
      .doc(conversationId)
      .collection("messages")
      .doc(messageId)
      .get();

    if (!message.exists || message.data()?.sender !== "mate") {
      return Response.json({ error: "الرسالة غير موجودة." }, { status: 404 });
    }

    const text = message.data()?.text;
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("Mate message text is invalid.");
    }

    return Response.json(
      SpeechResponseSchema.parse({ audioUrl: await generateSpeech(text) }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Failed to generate message speech", error);
    return Response.json(
      { error: "تعذر تشغيل الرسالة. حاول مرة أخرى." },
      { status: 500 },
    );
  }
}
