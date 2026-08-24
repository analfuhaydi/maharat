# Maharat

Maharat helps Arabic-speaking learners become more comfortable speaking professional English.

Maharat opens directly into a conversation. The learner joins when ready and records one response at a time. Maharat Mate privately reviews each response before continuing. If it finds an obvious mistake that weakens professional spoken English, the app shows a suggested version and discards the recording. The learner's next recording starts fresh.

## Development

```bash
npm install
npm run dev
```

The app uses Firebase Authentication and Firestore, plus Groq for speech-to-text and chat. Copy the required Firebase, Firebase Admin, and Groq values into `.env.local`.

## Checks

```bash
npm run check
npm run build
npm run test:e2e
```

The E2E test creates a fresh anonymous Firebase user, uploads fixed WAV fixtures through the conversation recording endpoint, checks independent rejections, accepted turns, atomic message pairs, and saved message data, then deletes its test data.
