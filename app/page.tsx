"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { Languages, LoaderCircle, Pause, Play, Volume2, X } from "lucide-react";
import Image from "next/image";

import {
  ConversationCreatedResponseSchema,
  ConversationStreamEventSchema,
  MessagesResponseSchema,
  type Message,
  type RetryContext,
} from "@/lib/conversation-schema";
import { firebaseAuth } from "@/lib/firebase-client";
import { playTtsAudio, stopTtsAudio, unlockTtsAudio } from "@/lib/tts-audio";

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
  | "mate-thinking"
  | "mate-speaking";
type AttemptKind = "initial" | "retry";
type CoachState = RetryContext & {
  audioUrl: string;
  professionalResponseAudioUrl: string | null;
};

function base64ToAudioUrl(audioBase64: string) {
  const bytes = Uint8Array.from(atob(audioBase64), (character) =>
    character.charCodeAt(0),
  );
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

function MessageBubble({
  message,
  translated,
  loadingAudio,
  onTranslate,
  onPlay,
}: {
  message: Message;
  translated: boolean;
  loadingAudio: boolean;
  onTranslate: () => void;
  onPlay: () => void;
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
        <div className="mt-1 flex items-center gap-1 text-secondary" dir="ltr">
          <button
            type="button"
            onClick={onPlay}
            disabled={loadingAudio}
            className="grid size-8 place-items-center rounded-full hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-60"
            aria-label="تشغيل الرسالة"
          >
            {loadingAudio ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Volume2 className="size-4" />
            )}
          </button>
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
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        <span>مهارات يفكر</span>
      </div>
    </article>
  );
}

function AudioPlayback({
  url,
  label,
  transcript,
  tone,
}: {
  url: string;
  label: string;
  transcript: string;
  tone: "correction" | "positive";
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const isPositive = tone === "positive";

  return (
    <div
      className="flex items-center gap-3 rounded-2xl bg-[#272a2d] px-3 py-3 text-foreground"
      dir="ltr"
    >
      <audio
        ref={audioRef}
        src={url}
        className="sr-only"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) void audio.play();
          else audio.pause();
        }}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[#363a3e] hover:bg-[#42474c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        aria-label={label}
      >
        {playing ? (
          <Pause
            className={
              isPositive ? "size-4 text-[#8fce9f]" : "size-4 text-[#ef9a9a]"
            }
          />
        ) : (
          <Play
            className={
              isPositive
                ? "size-4 fill-current text-[#8fce9f]"
                : "size-4 fill-current text-[#ef9a9a]"
            }
          />
        )}
      </button>
      <p
        className="min-w-0 flex-1 text-left text-sm leading-6 whitespace-pre-wrap"
        lang="en"
      >
        {transcript}
      </p>
    </div>
  );
}

function CoachSheet({
  coach,
  phase,
  onDelete,
  onRetry,
  onSend,
}: {
  coach: CoachState;
  phase: Extract<Phase, "correcting" | "recording" | "coaching">;
  onDelete: () => void;
  onRetry: () => void;
  onSend: () => void;
}) {
  return (
    <section
      className="fixed inset-x-0 bottom-0 z-30 mx-auto max-h-[82svh] max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-[#191b1d] p-5"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coach-sheet-title"
    >
      <div className="mb-5">
        <p id="coach-sheet-title" className="text-sm font-semibold text-brand">
          تصحيح
        </p>
      </div>
      <div className="space-y-5 text-sm leading-7">
        <div>
          <p className="mb-1 text-xs text-[#ef9a9a]">أنت قلت</p>
          <div className="mt-2">
            <AudioPlayback
              key={coach.audioUrl}
              url={coach.audioUrl}
              label="استمع لتسجيلك"
              transcript={coach.transcript}
              tone="correction"
            />
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-[#8fce9f]">صياغة مهنية أفضل</p>
          {coach.professionalResponseAudioUrl ? (
            <AudioPlayback
              key={coach.professionalResponseAudioUrl}
              url={coach.professionalResponseAudioUrl}
              label="استمع للصياغة المهنية الأفضل"
              transcript={coach.professionalResponse}
              tone="positive"
            />
          ) : (
            <p
              className="rounded-2xl bg-[#272a2d] px-3 py-3 whitespace-pre-wrap"
              dir="ltr"
              lang="en"
            >
              {coach.professionalResponse}
            </p>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs text-secondary">درس سريع</p>
          <p className="whitespace-pre-wrap" dir="rtl" lang="ar">
            {coach.lesson}
          </p>
        </div>
      </div>
      {phase === "correcting" ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-5 font-medium text-[#332d3b] transition-colors hover:bg-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
        >
          سجّل محاولة أخرى
        </button>
      ) : null}

      {phase === "recording" ? (
        <div className="mt-6 flex gap-2" dir="ltr">
          <button
            type="button"
            onClick={onDelete}
            className="flex min-h-14 basis-1/5 items-center justify-center rounded-xl bg-[#7d3439] px-2 text-sm font-medium text-[#fff4f0] transition-colors hover:bg-[#914047] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand sm:px-4"
            aria-label="حذف التسجيل"
          >
            <span>حذف</span>
          </button>
          <button
            type="button"
            onClick={onSend}
            className="flex min-h-14 basis-4/5 items-center justify-center rounded-xl bg-brand px-5 font-semibold text-[#332d3b] transition-colors hover:bg-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            aria-label="إرسال التسجيل"
          >
            إرسال
          </button>
        </div>
      ) : null}

      {phase === "coaching" ? (
        <div className="mt-6 flex gap-2" dir="ltr">
          <button
            type="button"
            disabled
            className="flex min-h-14 basis-1/5 cursor-wait items-center justify-center rounded-xl bg-[#7d3439] px-2 text-sm font-medium text-[#fff4f0] opacity-50 sm:px-4"
          >
            <span>حذف</span>
          </button>
          <button
            type="button"
            disabled
            className="flex min-h-14 basis-4/5 cursor-wait items-center justify-center rounded-xl bg-[#191b1d] px-5 font-semibold opacity-70"
          >
            جاري مراجعة التسجيل
          </button>
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
            <X className="size-5" />
          </button>
        </div>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 flex-1 rounded-xl bg-[#272a2d] px-4 font-medium hover:bg-[#303438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-12 flex-1 rounded-xl bg-[#7d3439] px-4 font-medium text-[#fff4f0] hover:bg-[#914047] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
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
  const [coach, setCoach] = useState<CoachState | null>(null);
  const [error, setError] = useState("");
  const [translatedMessages, setTranslatedMessages] = useState<string[]>([]);
  const [loadingAudioMessageId, setLoadingAudioMessageId] = useState<
    string | null
  >(null);
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const conversationId = useRef<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordingStartedAt = useRef(0);
  const attemptKind = useRef<AttemptKind>("initial");
  const coachAudioUrl = useRef<string | null>(null);
  const coachProfessionalResponseAudioUrl = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isMateThinking = phase === "mate-thinking";

  function releaseCoachAudio() {
    if (coachAudioUrl.current) {
      URL.revokeObjectURL(coachAudioUrl.current);
      coachAudioUrl.current = null;
    }

    if (coachProfessionalResponseAudioUrl.current) {
      URL.revokeObjectURL(coachProfessionalResponseAudioUrl.current);
      coachProfessionalResponseAudioUrl.current = null;
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

  function keepCoachProfessionalResponseAudio(url: string | null) {
    if (coachProfessionalResponseAudioUrl.current) {
      URL.revokeObjectURL(coachProfessionalResponseAudioUrl.current);
    }
    coachProfessionalResponseAudioUrl.current = url;
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
      stopTtsAudio();
      releaseCoachAudio();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, isMateThinking]);

  async function joinConversation() {
    if (phase !== "ready") return;

    setPhase("joining");
    setError("");
    unlockTtsAudio();

    try {
      const user =
        firebaseAuth.currentUser ??
        (await signInAnonymously(firebaseAuth)).user;
      const token = await user.getIdToken();
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Failed to create conversation.");

      const conversation = ConversationCreatedResponseSchema.parse(
        await response.json(),
      );
      conversationId.current = conversation.conversationId;
      sessionStorage.setItem(CONVERSATION_ID_KEY, conversation.conversationId);
      setMessages([conversation.message]);
      clearCoach();

      if (!conversation.audioBase64) {
        setError("ردّ مهارات جاهز، لكن الصوت غير متاح مؤقتًا.");
        setPhase("idle");
        return;
      }

      setPhase("mate-speaking");
      const url = base64ToAudioUrl(conversation.audioBase64);
      void playTtsAudio(url, {
        onPlay: () => undefined,
        onEnded: () => {
          URL.revokeObjectURL(url);
          setPhase("idle");
        },
      }).catch(() => {
        URL.revokeObjectURL(url);
        setError("تعذر تشغيل صوت مهارات. يمكنك قراءة الرسالة والبدء.");
        setPhase("idle");
      });
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
    setError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = "audio/webm;codecs=opus";
      const recording = MediaRecorder.isTypeSupported(preferredMimeType)
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      mediaStream.current = stream;
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
    stopMediaStream();
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
      form.set(
        "retryContext",
        JSON.stringify({
          transcript: coach.transcript,
          professionalResponse: coach.professionalResponse,
          lesson: coach.lesson,
        } satisfies RetryContext),
      );
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
            const professionalResponseAudioUrl =
              event.professionalResponseAudioBase64
                ? base64ToAudioUrl(event.professionalResponseAudioBase64)
                : null;
            keepCoachProfessionalResponseAudio(professionalResponseAudioUrl);
            setCoach({
              transcript: event.transcript,
              professionalResponse: event.professionalResponse,
              lesson: event.lesson,
              audioUrl: recordingUrl,
              professionalResponseAudioUrl,
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
                  transcript: event.transcript,
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

          if (event.audioBase64) {
            setPhase("mate-speaking");
            const url = base64ToAudioUrl(event.audioBase64);
            void playTtsAudio(url, {
              onPlay: () => undefined,
              onEnded: () => {
                URL.revokeObjectURL(url);
                setPhase("idle");
              },
            }).catch(() => {
              URL.revokeObjectURL(url);
              setError("تعذر تشغيل صوت مهارات. يمكنك قراءة الرسالة والرد.");
              setPhase("idle");
            });
          } else {
            setError("ردّ مهارات جاهز، لكن الصوت غير متاح مؤقتًا.");
            setPhase("idle");
          }
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
      stopMediaStream();
      await submitRecording(blob, kind, endedAt);
    } catch (sendError) {
      console.error("Failed to submit recording", sendError);
      setError("تعذر إرسال التسجيل. حاول مرة أخرى.");
      setPhase(kind === "retry" ? "correcting" : "idle");
    }
  }

  async function playMessage(message: Message) {
    if (message.sender !== "mate" || !conversationId.current) return;

    setLoadingAudioMessageId(message.id);
    try {
      unlockTtsAudio();
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error("المستخدم غير متاح.");
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/conversations/${conversationId.current}/messages/${message.id}/speech`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "تعذر تشغيل الصوت. حاول مرة أخرى.");
      }
      const url = URL.createObjectURL(await response.blob());
      await playTtsAudio(url, {
        onPlay: () => undefined,
        onEnded: () => URL.revokeObjectURL(url),
      });
    } catch (playError) {
      setError(
        playError instanceof Error
          ? playError.message
          : "تعذر تشغيل الصوت. حاول مرة أخرى.",
      );
    } finally {
      setLoadingAudioMessageId(null);
    }
  }

  function finishConversation() {
    setShowEndConfirmation(false);
    stopTtsAudio();
    deleteRecording();
    clearCoach();
    sessionStorage.removeItem(CONVERSATION_ID_KEY);
    conversationId.current = null;
    attemptKind.current = "initial";
    setMessages([]);
    setTranslatedMessages([]);
    setLoadingAudioMessageId(null);
    setError("");
    setPhase("ready");
  }

  const showCoach =
    coach !== null &&
    (phase === "correcting" || phase === "recording" || phase === "coaching");
  const isCoachProcessing = phase === "coaching";
  const isResponseProcessing =
    phase === "accepted" ||
    phase === "mate-thinking" ||
    phase === "mate-speaking";

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
            loadingAudio={loadingAudioMessageId === message.id}
            onPlay={() => void playMessage(message)}
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
        <CoachSheet
          coach={coach}
          phase={phase}
          onDelete={deleteRecording}
          onRetry={() => void startRecording("retry")}
          onSend={() => void sendRecording()}
        />
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
              <LoaderCircle className="size-5 animate-spin" />
              جاري البدء
            </button>
          ) : null}

          {phase === "restoring" ? (
            <button
              type="button"
              disabled
              className="flex min-h-14 w-full cursor-wait items-center justify-center gap-2 rounded-xl bg-[#191b1d] px-6 text-lg font-semibold opacity-70"
            >
              <LoaderCircle className="size-5 animate-spin" />
              جاري استعادة المحادثة
            </button>
          ) : null}

          {phase === "idle" ? (
            <div className="flex gap-2" dir="ltr">
              <button
                type="button"
                onClick={() => setShowEndConfirmation(true)}
                className="flex min-h-14 basis-1/5 items-center justify-center rounded-xl bg-[#7d3439] px-2 text-sm font-medium text-[#fff4f0] transition-colors hover:bg-[#914047] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand sm:px-4"
              >
                <span>إنهاء</span>
              </button>
              <button
                type="button"
                onClick={() => void startRecording("initial")}
                className="flex min-h-14 basis-4/5 items-center justify-center rounded-xl bg-brand px-5 font-semibold text-[#332d3b] transition-colors hover:bg-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
              >
                سجّل ردك
              </button>
            </div>
          ) : null}

          {phase === "recording" ? (
            <div className="flex gap-2" dir="ltr">
              <button
                type="button"
                onClick={deleteRecording}
                className="flex min-h-14 basis-1/5 items-center justify-center rounded-xl bg-[#7d3439] px-2 text-sm font-medium text-[#fff4f0] transition-colors hover:bg-[#914047] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand sm:px-4"
                aria-label="حذف التسجيل"
              >
                <span>حذف</span>
              </button>
              <button
                type="button"
                onClick={() => void sendRecording()}
                className="flex min-h-14 basis-4/5 items-center justify-center rounded-xl bg-brand px-5 font-semibold text-[#332d3b] transition-colors hover:bg-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
                aria-label="إرسال التسجيل"
              >
                إرسال
              </button>
            </div>
          ) : null}

          {isCoachProcessing || isResponseProcessing ? (
            <div className="flex gap-2" dir="ltr">
              <button
                type="button"
                disabled
                className="flex min-h-14 basis-1/5 cursor-wait items-center justify-center rounded-xl bg-[#7d3439] px-2 text-sm font-medium text-[#fff4f0] opacity-50 sm:px-4"
              >
                <span>إنهاء</span>
              </button>
              <button
                type="button"
                disabled
                className={
                  isCoachProcessing
                    ? "flex min-h-14 basis-4/5 cursor-wait items-center justify-center rounded-xl bg-[#191b1d] px-5 font-semibold opacity-70"
                    : "flex min-h-14 basis-4/5 cursor-wait items-center justify-center rounded-xl bg-brand px-5 font-semibold text-[#332d3b] opacity-70"
                }
              >
                {isCoachProcessing ? <>جاري مراجعة التسجيل</> : <>سجّل ردك</>}
              </button>
            </div>
          ) : null}
        </footer>
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
