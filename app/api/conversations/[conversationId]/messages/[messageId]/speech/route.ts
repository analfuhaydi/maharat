import { firestore, getAuthenticatedUserId } from "@/lib/firebase-admin";
import { generateMaharatSpeech } from "@/lib/groq";

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
  const messageSnapshot = await firestore
    .collection("users")
    .doc(userId)
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .doc(messageId)
    .get();
  const message = messageSnapshot.data();

  if (!messageSnapshot.exists || message?.sender !== "maharat") {
    return Response.json({ error: "الرسالة غير موجودة." }, { status: 404 });
  }

  try {
    const audio = await generateMaharatSpeech(message.text);

    return new Response(audio, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Failed to regenerate Maharat speech", error);
    return Response.json(
      { error: "تعذر إنشاء الصوت. حاول مرة أخرى." },
      { status: 500 },
    );
  }
}
