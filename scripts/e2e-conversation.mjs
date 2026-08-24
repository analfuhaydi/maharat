import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const port = Number(process.env.E2E_PORT || 3100);
const baseUrl = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;
const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const groqApiKey =
  process.env.GROQ_E2E_API_KEY ||
  process.env.GROQ_FALLBACK_API_KEY ||
  process.env.GROQ_API_KEY;

if (!firebaseApiKey || !groqApiKey) {
  throw new Error(
    "NEXT_PUBLIC_FIREBASE_API_KEY and a Groq API key are required for E2E.",
  );
}

function getAdminApp() {
  const existingApp = getApps()[0];
  if (existingApp) return existingApp;

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n",
  );

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin credentials are required for E2E.");
  }

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

const adminAuth = getAuth(getAdminApp());
const firestore = getFirestore(getAdminApp());
let devServer;
let userId;
let conversationId;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Development server did not start at ${baseUrl}.`);
}

function startServer() {
  if (process.env.E2E_BASE_URL) return;

  const nextBin = fileURLToPath(
    new URL("../node_modules/next/dist/bin/next", import.meta.url),
  );
  devServer = spawn(
    process.execPath,
    [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      stdio: "inherit",
      env: { ...process.env, GROQ_API_KEY: groqApiKey },
    },
  );
}

async function authenticateAnonymously() {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );
  if (!response.ok) {
    throw new Error(`Anonymous auth failed: ${await response.text()}`);
  }
  return response.json();
}

async function createConversation(idToken) {
  const response = await fetch(`${baseUrl}/api/conversations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ timeOfDay: "afternoon" }),
  });
  if (!response.ok) {
    throw new Error(`Conversation creation failed: ${await response.text()}`);
  }
  return { payload: await response.json() };
}

async function readAudioFixture(name) {
  return readFile(new URL(`fixtures/${name}`, import.meta.url));
}

async function submitRecording(idToken, audio) {
  const form = new FormData();
  form.set(
    "recording",
    new File([audio], "recording.wav", { type: "audio/wav" }),
  );
  const response = await fetch(
    `${baseUrl}/api/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
      body: form,
    },
  );
  if (!response.ok) {
    throw new Error(`Recording submission failed: ${await response.text()}`);
  }

  return { payload: await response.json() };
}

async function readMessages(idToken) {
  const response = await fetch(
    `${baseUrl}/api/conversations/${conversationId}/messages`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  if (!response.ok) {
    throw new Error(`History read failed: ${await response.text()}`);
  }
  return response.json();
}

async function cleanup() {
  if (userId && conversationId) {
    const conversationReference = firestore
      .collection("users")
      .doc(userId)
      .collection("conversations")
      .doc(conversationId);
    const messages = await conversationReference.collection("messages").get();
    const batch = firestore.batch();
    messages.docs.forEach((document) => batch.delete(document.ref));
    batch.delete(conversationReference);
    await batch.commit();
    await firestore.collection("users").doc(userId).delete();
  }

  if (userId) {
    try {
      await adminAuth.deleteUser(userId);
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }
}

async function run() {
  startServer();
  await waitForServer();

  const auth = await authenticateAnonymously();
  userId = auth.localId;
  const openingResponse = await createConversation(auth.idToken);
  const opening = openingResponse.payload;
  conversationId = opening.conversationId;

  assert(opening.message.sender === "mate", "Opening sender was not Mate.");
  assert(
    opening.message.arabicTranslation,
    "Opening Arabic translation was missing.",
  );

  const weakAudio = await readAudioFixture("weak-response.wav");
  const firstResponse = await submitRecording(auth.idToken, weakAudio);
  const firstCorrection = firstResponse.payload;
  assert(
    firstCorrection.outcome === "correction",
    `Weak response was accepted as ${firstCorrection.outcome}.`,
  );
  assert(
    firstCorrection.suggestedSpokenVersion,
    "Suggested spoken version was missing.",
  );
  assert(!("lesson" in firstCorrection), "Correction included a lesson.");
  assert(
    !("mateMessage" in firstCorrection),
    "Mate replied to a rejected answer.",
  );

  const afterFirstRejection = await readMessages(auth.idToken);
  assert(
    afterFirstRejection.messages.every((message) => message.sender !== "user"),
    "A rejected answer was persisted.",
  );

  const secondRejectedResponse = await submitRecording(auth.idToken, weakAudio);
  assert(
    secondRejectedResponse.payload.outcome === "correction",
    "A new rejected recording did not return its own correction.",
  );
  assert(
    !("userMessage" in secondRejectedResponse.payload) &&
      !("mateMessage" in secondRejectedResponse.payload),
    "A rejected recording produced conversation messages.",
  );

  const strongAudio = await readAudioFixture("corrected-response.wav");
  const acceptedResponse = await submitRecording(auth.idToken, strongAudio);
  assert(
    acceptedResponse.payload.outcome === "reply" &&
      acceptedResponse.payload.userMessage,
    "A clear professional answer was not accepted.",
  );
  const mateMessage = acceptedResponse.payload.mateMessage;
  assert(mateMessage, "Mate did not reply after acceptance.");
  assert(mateMessage.arabicTranslation, "Mate Arabic translation was missing.");
  assert(
    !JSON.stringify(acceptedResponse.payload).includes(
      "suggestedSpokenVersion",
    ),
    "Correction data leaked into Mate output.",
  );

  const afterAcceptance = await readMessages(auth.idToken);
  const userMessages = afterAcceptance.messages.filter(
    (message) => message.sender === "user",
  );
  const mateMessages = afterAcceptance.messages.filter(
    (message) => message.sender === "mate",
  );
  assert(
    userMessages.length === 1,
    "The saved user message count was incorrect.",
  );
  assert(
    mateMessages.length === 2,
    "The saved Mate message count was incorrect.",
  );
  assert(
    userMessages.every(
      (message) => "text" in message && !("transcript" in message),
    ),
    "User messages did not use the text field.",
  );
  assert(
    afterAcceptance.messages.every(
      (message) =>
        !("recordingStartedAt" in message) && !("recordingEndedAt" in message),
    ),
    "Recording timestamps leaked into saved messages.",
  );
  assert(
    afterAcceptance.messages.every(
      (message) => !("suggestedSpokenVersion" in message),
    ),
    "Correction data leaked into saved messages.",
  );
  const secondAudio = await readAudioFixture("accepted-response.wav");
  const secondResponse = await submitRecording(auth.idToken, secondAudio);
  assert(
    secondResponse.payload.outcome === "reply" &&
      secondResponse.payload.userMessage,
    "A clear answer was not accepted.",
  );
  assert(
    secondResponse.payload.mateMessage,
    "Mate did not reply to the second accepted answer.",
  );

  const afterSecondAcceptance = await readMessages(auth.idToken);
  assert(
    afterSecondAcceptance.messages.filter(
      (message) => message.sender === "user",
    ).length === 2,
    "The saved user message count after the second turn was incorrect.",
  );
  assert(
    afterSecondAcceptance.messages.filter(
      (message) => message.sender === "mate",
    ).length === 3,
    "The saved Mate message count after the second turn was incorrect.",
  );
  assert(
    afterSecondAcceptance.messages.map((message) => message.id).join(",") ===
      "maharat-turn-001,user-turn-002,maharat-turn-003,user-turn-004,maharat-turn-005",
    "Message IDs did not use the expected turn prefixes.",
  );

  console.log("E2E conversation flow passed.");
}

try {
  await run();
} finally {
  await cleanup();
  if (devServer) devServer.kill("SIGTERM");
}
