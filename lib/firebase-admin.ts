import "server-only";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function getFirebaseAdminApp() {
  const existingApp = getApps()[0];

  if (existingApp) {
    return existingApp;
  }

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

type MessageSender = "maharat" | "user";

export async function getNextMessageReference(
  conversationReference: FirebaseFirestore.DocumentReference,
  sender: MessageSender,
) {
  const messagesReference = conversationReference.collection("messages");
  const messageCountSnapshot = await messagesReference.count().get();
  const messageNumber = messageCountSnapshot.data().count + 1;
  const formattedMessageNumber = String(messageNumber).padStart(3, "0");

  return messagesReference.doc(`${sender}-turn-${formattedMessageNumber}`);
}

export async function getAuthenticatedUserId(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("UNAUTHORIZED");
  }

  const token = authorization.slice("Bearer ".length);

  try {
    const decodedToken = await firebaseAdminAuth.verifyIdToken(token);
    return decodedToken.uid;
  } catch {
    throw new Error("UNAUTHORIZED");
  }
}
