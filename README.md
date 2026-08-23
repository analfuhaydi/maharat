# Maharat

Maharat helps Arabic-speaking learners become more comfortable speaking professional English.

Maharat opens directly into a conversation. The learner joins when ready, records one answer at a time, and passes Maharat Coach's review before the answer is saved or Maharat Mate replies. Rejected recordings stay in the correction sheet until the learner records an accepted retry. A retry can use different wording when it keeps the same meaning and fixes the issue.

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

The E2E test creates a fresh anonymous Firebase user, uploads fixed WAV fixtures through the conversation recording endpoint, checks initial rejection, repeated retry rejection, paraphrased retry acceptance, a fresh accepted turn, saved messages, and deletes its own test data.
