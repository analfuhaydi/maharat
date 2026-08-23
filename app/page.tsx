"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { Languages, LoaderCircle, Pause, Play, X } from "lucide-react";
import Image from "next/image";

import {
  ConversationCreatedResponseSchema,
  ConversationStreamEventSchema,
  MessagesResponseSchema,
  type TimeOfDay,
  type Message,
  type RetryContext,
} from "@/lib/conversation-schema";
import { firebaseAuth } from "@/lib/firebase-client";

const CONVERSATION_ID_KEY = "maharatConversationId";

type Phase =
  | "ready"
  | "joining"
  | "restoring"
  | "idle"
  | "recording"
  | "coaching"
  | "correcting"
  | "accepted"
  | "mate-thinking";
type AttemptKind = "initial" | "retry";
type CoachState = {
  retryContext: RetryContext;
  currentTranscript: string;
  audioUrl: string;
};

function getLocalTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();

  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function MessageBubble({
  message,
  translated,
  onTranslate,
}: {
  message: Message;
  translated: boolean;
  onTranslate: () => void;
}) {
  const isMate = message.sender === "mate";
  const text = isMate ? message.text : message.transcript;

  return (
    <article
      className={isMate ? "max-w-[86%] self-start" : "max-w-[86%] self-end"}
    >
      <div
        className={
          isMate
            ? "rounded-2xl rounded-tr-md bg-[#191b1d] px-4 py-3 leading-7"
            : "rounded-2xl rounded-tl-md bg-brand px-4 py-3 leading-7 text-[#332d3b]"
        }
        dir="ltr"
        lang="en"
      >
        <p>{text}</p>
        {isMate && translated ? (
          <p className="mt-2 text-xs text-secondary" dir="rtl" lang="ar">
            {message.arabicTranslation}
          </p>
        ) : null}
      </div>
      {isMate ? (
        <div className="mt-1 flex items-center text-secondary" dir="ltr">
          <button
            type="button"
            onClick={onTranslate}
            className="grid size-8 place-items-center rounded-full hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label="ترجمة الرسالة"
          >
            <Languages className="size-4" />
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ReadyPrompt() {
  return (
    <article className="max-w-[86%] self-start">
      <div
        className="rounded-2xl rounded-tr-md bg-[#191b1d] px-4 py-3 leading-7"
        dir="ltr"
        lang="en"
        aria-live="polite"
      >
        <p>Click Join when you&apos;re ready.</p>
      </div>
    </article>
  );
}

function MateLoadingBubble() {
  return (
    <article className="max-w-[86%] self-start">
      <div
        className="flex items-center gap-2 rounded-2xl rounded-tr-md bg-[#191b1d] px-4 py-3 text-secondary"
        dir="rtl"
        role="status"
        aria-live="polite"
      >
        <LoaderCircle
          className="size-4 shrink-0 origin-center animate-spin"
          aria-hidden="true"
        />
        <span>مهارات يكتب رده</span>
      </div>
    </article>
  );
}

function RecordingPlayback({
  url,
  transcript,
}: {
  url: string;
  transcript: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }

  return (
    <div
      className="flex items-center gap-3 rounded-2xl bg-[#272a2d] px-3 py-3 text-foreground"
      dir="ltr"
    >
      <audio
        ref={audioRef}
        src={url}
        preload="auto"
        className="sr-only"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setPlaying(false)}
      />
      <button
        type="button"
        onClick={togglePlayback}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[#363a3e] hover:bg-[#42474c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        aria-label="استمع لتسجيلك"
      >
        {playing ? (
          <Pause className="size-4 text-[#ef9a9a]" />
        ) : (
          <Play className="size-4 fill-current text-[#ef9a9a]" />
        )}
      </button>
      <p
        className="min-w-0 flex-1 text-left text-sm leading-6 whitespace-pre-wrap text-[#ef9a9a]"
        lang="en"
      >
        {transcript}
      </p>
    </div>
  );
}

function formatRecordingTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = String(seconds % 60).padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

function RecordingTray({ elapsedSeconds }: { elapsedSeconds: number }) {
  const waveformHeights = [8, 13, 17, 11, 19, 14, 9, 16, 12, 7, 15, 10];

  return (
    <div
      className="flex min-h-9 w-fit items-center justify-center gap-0 rounded-full bg-brand/10 px-2 text-sm text-foreground"
      dir="ltr"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only" dir="rtl">
        جارٍ تسجيل ردّك
      </span>
      <span className="px-1.5 font-medium tabular-nums" aria-hidden="true">
        {formatRecordingTime(elapsedSeconds)}
      </span>
      <span
        className="flex min-h-5 items-center border-l border-white/15 pr-1.5 pl-2 text-brand"
        aria-hidden="true"
      >
        <span className="recording-waveform">
          {waveformHeights.map((height, index) => (
            <span
              key={`${height}-${index}`}
              className="recording-waveform-bar"
              style={{
                height: `${height}px`,
                animationDelay: `${index * -90}ms`,
              }}
            />
          ))}
        </span>
      </span>
    </div>
  );
}

function RecordingActions({
  onDelete,
  onSend,
}: {
  onDelete: () => void;
  onSend: () => void;
}) {
  return (
    <div className="flex gap-2" dir="ltr">
      <button
        type="button"
        onClick={onDelete}
        className="flex min-h-14 min-w-0 flex-[0.3] touch-manipulation items-center justify-center rounded-xl bg-[#7d3439] px-3 text-sm font-medium text-[#fff4f0] transition-colors hover:bg-[#914047] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        حذف
      </button>
      <button
        type="button"
        onClick={onSend}
        className="flex min-h-14 min-w-0 flex-[0.7] touch-manipulation items-center justify-center rounded-xl bg-brand px-5 font-semibold text-[#332d3b] transition-colors hover:bg-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        إرسال
      </button>
    </div>
  );
}

function ReviewStatus() {
  return (
    <div
      className="flex min-h-14 w-full cursor-wait items-center justify-center gap-2 rounded-xl bg-[#272a2d] px-5 font-semibold text-brand"
      dir="rtl"
      role="status"
      aria-live="polite"
    >
      <LoaderCircle
        className="size-4 shrink-0 origin-center animate-spin"
        aria-hidden="true"
      />
      <span>نراجع ردك</span>
    </div>
  );
}

function CoachSheet({
  coach,
  phase,
  recordingElapsedSeconds,
  onDelete,
  onRetry,
  onSend,
}: {
  coach: CoachState;
  phase: Extract<Phase, "correcting" | "recording" | "coaching">;
  recordingElapsedSeconds: number;
  onDelete: () => void;
  onRetry: () => void;
  onSend: () => void;
}) {
  return (
    <section
      className="coach-sheet fixed inset-x-0 bottom-0 z-30 mx-auto max-h-[82svh] max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-[#191b1d] p-5"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="مراجعة التسجيل"
    >
      <div className="space-y-5 text-sm leading-7">
        <div>
          <p className="mb-1 text-xs text-[#ef9a9a]">أنت قلت</p>
          <div className="mt-2">
            <RecordingPlayback
              key={coach.audioUrl}
              url={coach.audioUrl}
              transcript={coach.currentTranscript}
            />
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-[#8fce9f]">صياغة مقترحة</p>
          <p
            className="rounded-2xl bg-[#272a2d] px-4 py-3 text-left text-sm leading-6 whitespace-pre-wrap text-[#8fce9f]"
            dir="ltr"
            lang="en"
          >
            {coach.retryContext.suggestedSpokenVersion}
          </p>
        </div>
      </div>
      {phase === "correcting" ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 flex min-h-12 w-full touch-manipulation items-center justify-center rounded-full bg-brand px-5 font-medium text-[#332d3b] transition-colors hover:bg-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
        >
          سجل ردك
        </button>
      ) : null}

      {phase === "recording" ? (
        <div className="mt-6 space-y-3">
          <div className="flex justify-center">
            <RecordingTray elapsedSeconds={recordingElapsedSeconds} />
          </div>
          <RecordingActions onDelete={onDelete} onSend={onSend} />
        </div>
      ) : null}

      {phase === "coaching" ? (
        <div className="mt-6">
          <ReviewStatus />
        </div>
      ) : null}
    </section>
  );
}

function EndConversationDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/65 p-4"
      role="presentation"
    >
      <section
        className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#191b1d] p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-conversation-title"
        dir="rtl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="end-conversation-title" className="font-semibold">
              تنهي المحادثة؟
            </h2>
            <p className="mt-2 text-sm leading-7 text-secondary">
              يمكنك بدء محادثة جديدة في أي وقت.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="grid size-9 shrink-0 place-items-center rounded-full text-secondary hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label="إلغاء"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-5">
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-12 w-full touch-manipulation rounded-xl bg-[#7d3439] px-4 font-medium text-[#fff4f0] hover:bg-[#914047] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          >
            إنهاء المحادثة
          </button>
        </div>
      </section>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [phase, setPhase] = useState<Phase>("ready");
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const [coach, setCoach] = useState<CoachState | null>(null);
  const [error, setError] = useState("");
  const [translatedMessages, setTranslatedMessages] = useState<string[]>([]);
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const conversationId = useRef<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordingStartedAt = useRef(0);
  const attemptKind = useRef<AttemptKind>("initial");
  const coachAudioUrl = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isMateThinking = phase === "mate-thinking";

  function releaseCoachAudio() {
    if (coachAudioUrl.current) {
      URL.revokeObjectURL(coachAudioUrl.current);
      coachAudioUrl.current = null;
    }
  }

  function clearCoach() {
    releaseCoachAudio();
    setCoach(null);
  }

  function keepCoachAudio(url: string) {
    if (coachAudioUrl.current) URL.revokeObjectURL(coachAudioUrl.current);
    coachAudioUrl.current = url;
  }

  function stopMediaStream() {
    mediaStream.current?.getTracks().forEach((track) => track.stop());
    mediaStream.current = null;
  }

  useEffect(() => {
    const storedConversationId = sessionStorage.getItem(CONVERSATION_ID_KEY);

    if (!storedConversationId) return;

    let cancelled = false;

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      if (!user) {
        sessionStorage.removeItem(CONVERSATION_ID_KEY);
        conversationId.current = null;
        if (!cancelled) setPhase("ready");
        return;
      }

      setPhase("restoring");
      conversationId.current = storedConversationId;

      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/conversations/${storedConversationId}/messages`,
          { headers: { Authorization: `Bearer ${token}` } },
        );

        if (!response.ok)
          throw new Error("Conversation could not be restored.");

        const data = MessagesResponseSchema.parse(await response.json());

        if (!cancelled) {
          setMessages(data.messages);
          setPhase("idle");
        }
      } catch (restoreError) {
        console.error("Failed to restore conversation", restoreError);
        sessionStorage.removeItem(CONVERSATION_ID_KEY);
        conversationId.current = null;
        if (!cancelled) {
          setError("تعذر استعادة المحادثة. ابدأ محادثة جديدة.");
          setPhase("ready");
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
      stopMediaStream();
      releaseCoachAudio();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, isMateThinking]);

  useEffect(() => {
    if (phase !== "recording") return;

    const updateElapsedTime = () => {
      setRecordingElapsedSeconds(
        Math.max(
          0,
          Math.floor((Date.now() - recordingStartedAt.current) / 1000),
        ),
      );
    };

    const intervalId = window.setInterval(updateElapsedTime, 1000);

    return () => window.clearInterval(intervalId);
  }, [phase]);

  async function joinConversation() {
    if (phase !== "ready") return;

    setPhase("joining");
    setError("");
    try {
      const user =
        firebaseAuth.currentUser ??
        (await signInAnonymously(firebaseAuth)).user;
      const token = await user.getIdToken();
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ timeOfDay: getLocalTimeOfDay() }),
      });

      if (!response.ok) throw new Error("Failed to create conversation.");

      const conversation = ConversationCreatedResponseSchema.parse(
        await response.json(),
      );
      conversationId.current = conversation.conversationId;
      sessionStorage.setItem(CONVERSATION_ID_KEY, conversation.conversationId);
      setMessages([conversation.message]);
      clearCoach();
      setPhase("idle");
    } catch (joinError) {
      console.error("Failed to join conversation", joinError);
      conversationId.current = null;
      sessionStorage.removeItem(CONVERSATION_ID_KEY);
      setError("تعذر بدء المحادثة. حاول مرة أخرى.");
      setPhase("ready");
    }
  }

  async function startRecording(kind: AttemptKind) {
    const canStart =
      kind === "retry" ? phase === "correcting" : phase === "idle";
    if (!canStart) return;

    attemptKind.current = kind;
    setRecordingElapsedSeconds(0);
    setError("");

    try {
      const stream = mediaStream.current?.active
        ? mediaStream.current
        : await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStream.current = stream;
      const preferredMimeType = "audio/webm;codecs=opus";
      const recording = MediaRecorder.isTypeSupported(preferredMimeType)
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      recorder.current = recording;
      chunks.current = [];
      recording.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      recordingStartedAt.current = Date.now();
      recording.start();
      setPhase("recording");
    } catch (recordingError) {
      console.error("Failed to start recording", recordingError);
      setError("تعذر تشغيل الميكروفون.");
      setPhase(kind === "retry" ? "correcting" : "idle");
    }
  }

  function deleteRecording() {
    const currentRecorder = recorder.current;

    if (currentRecorder && currentRecorder.state !== "inactive") {
      currentRecorder.onstop = null;
      currentRecorder.stop();
    }

    recorder.current = null;
    chunks.current = [];
    setError("");
    setPhase(attemptKind.current === "retry" ? "correcting" : "idle");
  }

  async function submitRecording(
    blob: Blob,
    kind: AttemptKind,
    recordingEndedAt: number,
  ) {
    if (!conversationId.current) return;

    const user = firebaseAuth.currentUser;
    if (!user) throw new Error("The conversation user is unavailable.");

    const form = new FormData();
    form.set("recording", blob, "recording.webm");
    form.set("recordingStartedAt", String(recordingStartedAt.current));
    form.set("recordingEndedAt", String(recordingEndedAt));
    form.set("attemptKind", kind);

    if (kind === "retry" && coach) {
      form.set("retryContext", JSON.stringify(coach.retryContext));
    }

    const recordingUrl = URL.createObjectURL(blob);
    let keepRecordingUrl = false;

    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/conversations/${conversationId.current}/messages`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        },
      );

      if (!response.ok || !response.body) throw new Error("No response");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processLine = (line: string) => {
        const event = ConversationStreamEventSchema.parse(JSON.parse(line));

        if (event.type === "coachFeedback") {
          if (event.accepted) {
            attemptKind.current = "initial";
            clearCoach();
            setPhase("accepted");
          } else {
            keepRecordingUrl = true;
            keepCoachAudio(recordingUrl);
            setCoach({
              retryContext: {
                transcript: event.transcript,
                suggestedSpokenVersion: event.suggestedSpokenVersion,
              },
              currentTranscript: event.transcript,
              audioUrl: recordingUrl,
            });
            attemptKind.current = "retry";
            setPhase("correcting");
          }
        }

        if (event.type === "coachRetryRejected") {
          keepRecordingUrl = true;
          keepCoachAudio(recordingUrl);
          setCoach((current) =>
            current
              ? {
                  ...current,
                  currentTranscript: event.transcript,
                  audioUrl: recordingUrl,
                }
              : current,
          );
          setPhase("correcting");
        }

        if (event.type === "mateThinking") setPhase("mate-thinking");

        if (event.type === "userMessage") {
          setMessages((current) => [...current, event.message]);
        }

        if (event.type === "mateMessage") {
          setMessages((current) => [...current, event.message]);
          setPhase("idle");
        }

        if (event.type === "error") {
          setError(event.message);
          setPhase(attemptKind.current === "retry" ? "correcting" : "idle");
        }
      };

      while (true) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines.filter(Boolean)) processLine(line);
      }

      if (buffer.trim()) processLine(buffer);
    } finally {
      if (!keepRecordingUrl) URL.revokeObjectURL(recordingUrl);
    }
  }

  async function sendRecording() {
    if (phase !== "recording" || !recorder.current) return;

    const currentRecorder = recorder.current;
    const kind = attemptKind.current;
    const endedAt = Date.now();
    setPhase("coaching");
    setError("");

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        currentRecorder.onstop = () => {
          resolve(
            new Blob(chunks.current, {
              type: currentRecorder.mimeType || "audio/webm",
            }),
          );
        };
        currentRecorder.onerror = () => reject(new Error("Recording failed."));
        currentRecorder.stop();
      });

      recorder.current = null;
      chunks.current = [];
      await submitRecording(blob, kind, endedAt);
    } catch (sendError) {
      console.error("Failed to submit recording", sendError);
      setError("تعذر إرسال التسجيل. حاول مرة أخرى.");
      setPhase(kind === "retry" ? "correcting" : "idle");
    }
  }

  function finishConversation() {
    setShowEndConfirmation(false);
    deleteRecording();
    stopMediaStream();
    clearCoach();
    sessionStorage.removeItem(CONVERSATION_ID_KEY);
    conversationId.current = null;
    attemptKind.current = "initial";
    setMessages([]);
    setTranslatedMessages([]);
    setError("");
    setPhase("ready");
  }

  const showCoach =
    coach !== null &&
    (phase === "correcting" || phase === "recording" || phase === "coaching");
  const isCoachProcessing = phase === "coaching";
  const isResponseProcessing =
    phase === "accepted" || phase === "mate-thinking";

  return (
    <main className="flex h-svh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-20 shrink-0 items-center justify-center">
        <Image src="/maharat-logo.svg" alt="مهارات" width={48} height={48} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-6">
        {messages.length === 0 ? <ReadyPrompt /> : null}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            translated={translatedMessages.includes(message.id)}
            onTranslate={() =>
              setTranslatedMessages((current) =>
                current.includes(message.id)
                  ? current.filter((id) => id !== message.id)
                  : [...current, message.id],
              )
            }
          />
        ))}
        {isMateThinking ? <MateLoadingBubble /> : null}
        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

      {showCoach ? (
        <>
          <div
            className="coach-sheet-backdrop fixed inset-0 z-20 bg-black/20"
            aria-hidden="true"
          />
          <CoachSheet
            coach={coach}
            phase={phase}
            recordingElapsedSeconds={recordingElapsedSeconds}
            onDelete={deleteRecording}
            onRetry={() => void startRecording("retry")}
            onSend={() => void sendRecording()}
          />
        </>
      ) : null}

      {error ? (
        <p
          className="px-5 pb-3 text-center text-sm text-[#ef9a9a]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {!showCoach ? (
        <div className="relative shrink-0">
          {phase === "recording" ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-full z-10 flex justify-center px-5 pb-2">
              <RecordingTray elapsedSeconds={recordingElapsedSeconds} />
            </div>
          ) : null}

          <footer className="shrink-0 border-t border-white/10 px-5 py-5">
            {phase === "ready" ? (
              <button
                type="button"
                onClick={() => void joinConversation()}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand px-6 text-lg font-semibold text-[#332d3b] transition-colors hover:bg-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
              >
                انضمام
              </button>
            ) : null}

            {phase === "joining" ? (
              <button
                type="button"
                disabled
                className="flex min-h-14 w-full cursor-wait items-center justify-center gap-2 rounded-xl bg-brand px-6 text-lg font-semibold text-[#332d3b] opacity-70"
              >
                <LoaderCircle className="size-5 shrink-0 origin-center animate-spin" />
                نجهز المحادثة
              </button>
            ) : null}

            {phase === "restoring" ? (
              <button
                type="button"
                disabled
                className="flex min-h-14 w-full cursor-wait items-center justify-center gap-2 rounded-xl bg-[#191b1d] px-6 text-lg font-semibold opacity-70"
              >
                <LoaderCircle className="size-5 shrink-0 origin-center animate-spin" />
                نستكمل المحادثة
              </button>
            ) : null}

            {phase === "idle" ? (
              <div className="flex gap-2" dir="ltr">
                <button
                  type="button"
                  onClick={() => setShowEndConfirmation(true)}
                  className="flex min-h-14 min-w-0 flex-[0.3] touch-manipulation items-center justify-center rounded-xl bg-[#7d3439] px-3 text-sm font-medium text-[#fff4f0] transition-colors hover:bg-[#914047] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
                >
                  إنهاء
                </button>
                <button
                  type="button"
                  onClick={() => void startRecording("initial")}
                  className="flex min-h-14 min-w-0 flex-[0.7] touch-manipulation items-center justify-center rounded-xl bg-brand px-5 font-semibold text-[#332d3b] transition-colors hover:bg-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
                >
                  سجل ردك
                </button>
              </div>
            ) : null}

            {phase === "recording" ? (
              <RecordingActions
                onDelete={deleteRecording}
                onSend={() => void sendRecording()}
              />
            ) : null}

            {isCoachProcessing ? (
              <div className="flex" dir="ltr">
                <button
                  type="button"
                  disabled
                  dir="rtl"
                  className="flex min-h-14 w-full cursor-wait items-center justify-center gap-2 rounded-xl bg-[#272a2d] px-5 font-semibold text-brand"
                >
                  <LoaderCircle
                    className="size-5 shrink-0 origin-center animate-spin"
                    aria-hidden="true"
                  />
                  <span>نراجع ردك</span>
                </button>
              </div>
            ) : null}

            {isResponseProcessing ? (
              <div className="flex gap-2" dir="ltr">
                <button
                  type="button"
                  disabled
                  className="flex min-h-14 min-w-0 flex-[0.3] cursor-wait items-center justify-center rounded-xl bg-[#7d3439] px-3 text-sm font-medium text-[#fff4f0]"
                >
                  إنهاء
                </button>
                <button
                  type="button"
                  disabled
                  dir="rtl"
                  className="flex min-h-14 min-w-0 flex-[0.7] cursor-wait items-center justify-center gap-2 rounded-xl bg-brand px-5 font-semibold text-[#332d3b]"
                >
                  سجل ردك
                </button>
              </div>
            ) : null}
          </footer>
        </div>
      ) : null}

      {showEndConfirmation ? (
        <EndConversationDialog
          onCancel={() => setShowEndConfirmation(false)}
          onConfirm={finishConversation}
        />
      ) : null}
    </main>
  );
}
