import { SpeechRequestSchema } from "@/lib/conversation-schema";
import { getAuthenticatedUserId } from "@/lib/firebase-admin";
import { synthesizeSpeech } from "@/lib/groq";

export async function POST(request: Request) {
  try {
    await getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "غير مصرح." }, { status: 401 });
  }

  const speechRequest = SpeechRequestSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!speechRequest.success) {
    return Response.json({ error: "النص غير صالح." }, { status: 400 });
  }

  try {
    const speech = await synthesizeSpeech(speechRequest.data.text);
    return new Response(speech.body, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Failed to synthesize speech", error);
    return Response.json(
      { error: "تعذر إنشاء الصوت. حاول مرة أخرى." },
      { status: 500 },
    );
  }
}
