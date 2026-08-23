import { firestore, getAuthenticatedUserId } from "@/lib/firebase-admin";
import { generateMateSpeech } from "@/lib/groq";

type RouteContext = {
  params: Promise<{ conversationId: string; messageId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  let userId: string;

  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "غير مصرح." }, { status: 401 });
  }

  const { conversationId, messageId } = await context.params;
  const snapshot = await firestore
    .collection("users")
    .doc(userId)
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .doc(messageId)
    .get();
  const message = snapshot.data();

  if (!snapshot.exists || message?.sender !== "mate") {
    return Response.json({ error: "الرسالة غير موجودة." }, { status: 404 });
  }

  try {
    const audio = await generateMateSpeech(message.text);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Failed to regenerate Mate speech", error);
    return Response.json(
      { error: "الصوت غير متاح مؤقتًا. حاول مرة أخرى لاحقًا." },
      { status: 503 },
    );
  }
}
