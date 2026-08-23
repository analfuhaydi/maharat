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

export function getNextMessageReference(
  conversationReference: FirebaseFirestore.DocumentReference,
) {
  return conversationReference.collection("messages").doc();
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
