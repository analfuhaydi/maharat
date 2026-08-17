import { Timestamp } from "firebase-admin/firestore";

import { PlaybackUpdateSchema } from "@/lib/conversation-schema";
import { firestore, getAuthenticatedUserId } from "@/lib/firebase-admin";

type RouteContext = {
  params: Promise<{ conversationId: string; messageId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  let userId: string;

  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "غير مصرح." }, { status: 401 });
  }

  const { conversationId, messageId } = await context.params;
  const result = PlaybackUpdateSchema.safeParse(await request.json());

  if (!result.success) {
    return Response.json({ error: "وقت التشغيل غير صالح." }, { status: 400 });
  }

  const messageReference = firestore
    .collection("users")
    .doc(userId)
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .doc(messageId);
  const messageSnapshot = await messageReference.get();

  if (!messageSnapshot.exists || messageSnapshot.data()?.sender !== "maharat") {
    return Response.json({ error: "الرسالة غير موجودة." }, { status: 404 });
  }

  const update: Record<string, Timestamp> = {};

  if (result.data.playbackStartedAt) {
    update.playbackStartedAt = Timestamp.fromDate(
      new Date(result.data.playbackStartedAt),
    );
  }

  if (result.data.playbackEndedAt) {
    update.playbackEndedAt = Timestamp.fromDate(
      new Date(result.data.playbackEndedAt),
    );
  }

  await messageReference.update(update);

  return new Response(null, { status: 204 });
}
