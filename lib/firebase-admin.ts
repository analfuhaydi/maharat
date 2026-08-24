import "server-only";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function getFirebaseAdminApp() {
  const existingApp = getApps()[0];

  if (existingApp) return existingApp;

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n",
  );

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin credentials are not configured.");
  }

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

const firebaseAdminApp = getFirebaseAdminApp();

export const firebaseAdminAuth = getAuth(firebaseAdminApp);
export const firestore = getFirestore(firebaseAdminApp);

type MessageSender = "mate" | "user";

export function getMessageId(sender: MessageSender, turnNumber: number) {
  const prefix = sender === "mate" ? "maharat" : "user";
  return `${prefix}-turn-${String(turnNumber).padStart(3, "0")}`;
}

export function getMessageReference(
  conversationReference: FirebaseFirestore.DocumentReference,
  sender: MessageSender,
  turnNumber: number,
) {
  return conversationReference
    .collection("messages")
    .doc(getMessageId(sender, turnNumber));
}

export async function createConversationTurn(
  conversationReference: FirebaseFirestore.DocumentReference,
  userMessage: FirebaseFirestore.DocumentData,
  mateMessage: FirebaseFirestore.DocumentData,
) {
  const messagesReference = conversationReference.collection("messages");
  let userMessageReference: FirebaseFirestore.DocumentReference | undefined;
  let mateMessageReference: FirebaseFirestore.DocumentReference | undefined;

  await firestore.runTransaction(async (transaction) => {
    const messagesSnapshot = await transaction.get(messagesReference);
    const nextTurnNumber =
      messagesSnapshot.docs.reduce((highestTurnNumber, document) => {
        const match = document.id.match(/-turn-(\d+)$/);
        return Math.max(
          highestTurnNumber,
          match ? Number(match[1]) : highestTurnNumber,
        );
      }, 0) + 1;

    userMessageReference = messagesReference.doc(
      getMessageId("user", nextTurnNumber),
    );
    mateMessageReference = messagesReference.doc(
      getMessageId("mate", nextTurnNumber + 1),
    );
    transaction.create(userMessageReference, userMessage);
    transaction.create(mateMessageReference, mateMessage);
  });

  if (!userMessageReference || !mateMessageReference) {
    throw new Error("Conversation turn references were not created.");
  }

  return { userMessageReference, mateMessageReference };
}

export async function getAuthenticatedUserId(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");

  try {
    const decodedToken = await firebaseAdminAuth.verifyIdToken(
      authorization.slice("Bearer ".length),
    );
    return decodedToken.uid;
  } catch (error) {
    console.error("Firebase ID token verification failed", error);
    throw new Error("UNAUTHORIZED");
  }
}
