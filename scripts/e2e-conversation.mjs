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
  return response.json();
}

async function readAudioFixture(name) {
  return readFile(new URL(`fixtures/${name}`, import.meta.url));
}

async function submitRecording(idToken, audio, attemptKind, retryContext) {
  const now = Date.now();
  const form = new FormData();
  form.set(
    "recording",
    new File([audio], "recording.wav", { type: "audio/wav" }),
  );
  form.set("recordingStartedAt", String(now - 5000));
  form.set("recordingEndedAt", String(now));
  form.set("attemptKind", attemptKind);
  if (retryContext) form.set("retryContext", JSON.stringify(retryContext));

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

  return (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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
  const opening = await createConversation(auth.idToken);
  conversationId = opening.conversationId;

  assert(opening.message.sender === "mate", "Opening sender was not Mate.");
  assert(
    opening.message.arabicTranslation,
    "Opening Arabic translation was missing.",
  );
  assert(!("audioBase64" in opening), "Opening response included TTS audio.");

  const weakAudio = await readAudioFixture("weak-response.wav");
  const firstEvents = await submitRecording(auth.idToken, weakAudio, "initial");
  const firstFeedback = firstEvents.find(
    (event) => event.type === "coachFeedback",
  );
  if (firstFeedback?.accepted !== false) {
    const eventTypes = firstEvents.map((event) => event.type).join(", ");
    throw new Error(`Weak initial answer was accepted. Events: ${eventTypes}`);
  }
  assert(
    firstFeedback.suggestedSpokenVersion,
    "Suggested spoken version was missing.",
  );
  assert(
    !("suggestedSpokenVersionAudioBase64" in firstFeedback),
    "Coach feedback included TTS audio.",
  );
  assert(!("lesson" in firstFeedback), "Coach lesson should be removed.");
  assert(
    firstEvents.every((event) => event.type !== "mateMessage"),
    "Mate replied to a rejected initial answer.",
  );

  const afterFirstRejection = await readMessages(auth.idToken);
  assert(
    afterFirstRejection.messages.every((message) => message.sender !== "user"),
    "A rejected initial answer was persisted.",
  );

  const retryContext = {
    transcript: firstFeedback.transcript,
    suggestedSpokenVersion: firstFeedback.suggestedSpokenVersion,
  };
  const retryEvents = await submitRecording(
    auth.idToken,
    weakAudio,
    "retry",
    retryContext,
  );
  assert(
    retryEvents.some((event) => event.type === "coachRetryRejected"),
    "Rejected retry did not return the retry event.",
  );
  assert(
    retryEvents.every((event) => event.type !== "mateMessage"),
    "Mate replied to a rejected retry.",
  );

  const strongAudio = await readAudioFixture("corrected-response.wav");
  const acceptedEvents = await submitRecording(
    auth.idToken,
    strongAudio,
    "retry",
    retryContext,
  );
  assert(
    acceptedEvents.some(
      (event) => event.type === "coachFeedback" && event.accepted === true,
    ),
    "A clear professional answer was not accepted.",
  );
  const mateEvent = acceptedEvents.find(
    (event) => event.type === "mateMessage",
  );
  assert(mateEvent, "Mate did not reply after acceptance.");
  assert(
    mateEvent.message.arabicTranslation,
    "Mate Arabic translation was missing.",
  );
  assert(!("audioBase64" in mateEvent), "Mate response included TTS audio.");
  assert(
    !JSON.stringify(mateEvent).includes("suggestedSpokenVersion"),
    "Coach feedback leaked into Mate output.",
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
  const secondAudio = await readAudioFixture("accepted-response.wav");
  const secondEvents = await submitRecording(
    auth.idToken,
    secondAudio,
    "initial",
  );
  assert(
    secondEvents.some(
      (event) => event.type === "coachFeedback" && event.accepted === true,
    ),
    "A clear initial answer was not accepted.",
  );
  const secondMateEvent = secondEvents.find(
    (event) => event.type === "mateMessage",
  );
  assert(secondMateEvent, "Mate did not reply to the second accepted answer.");

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

  console.log("E2E conversation flow passed.");
}

try {
  await run();
} finally {
  await cleanup();
  if (devServer) devServer.kill("SIGTERM");
}
