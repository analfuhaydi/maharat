"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { Languages, LoaderCircle, Pause, Play, Volume2, X } from "lucide-react";
import Image from "next/image";

import {
  ConversationCreatedResponseSchema,
  ConversationTurnResponseSchema,
  MessagesResponseSchema,
  SpeechResponseSchema,
  type TimeOfDay,
  type Message,
} from "@/lib/conversation-schema";
import { firebaseAuth } from "@/lib/firebase-client";

const CONVERSATION_ID_KEY = "maharatConversationId";

type Phase =
  | "ready"
  | "joining"
  | "restoring"
  | "idle"
  | "recording"
  | "reviewing"
  | "correcting";
type CorrectionState = {
  transcript: string;
  suggestedSpokenVersion: string;
  recordingUrl: string;
  audioUrl: string;
};

type PlaybackStatus = "idle" | "loading" | "playing";

function AudioButton({
  label,
  status,
  onClick,
}: {
  label: string;
  status: PlaybackStatus;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid size-9 shrink-0 place-items-center rounded-full bg-[#ef9a9a]/15 text-[#ef9a9a] transition-colors hover:bg-[#ef9a9a]/25 hover:text-[#ffc1c1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      aria-label={status === "playing" ? "إيقاف الصوت" : label}
      aria-pressed={status === "playing"}
    >
      {status === "loading" ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : status === "playing" ? (
        <Pause className="size-4" fill="currentColor" aria-hidden="true" />
      ) : (
        <Play className="size-4" fill="currentColor" aria-hidden="true" />
      )}
    </button>
  );
}

function CorrectedAudioButton({
  status,
  onClick,
}: {
  status: PlaybackStatus;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 grid size-9 place-items-center rounded-full text-[#8fce9f] hover:bg-[#8fce9f]/10 hover:text-[#b2e5bd] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      aria-label={
        status === "playing" ? "إيقاف الصوت" : "تشغيل الصياغة المقترحة"
      }
      aria-pressed={status === "playing"}
    >
      {status === "loading" ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : status === "playing" ? (
        <Pause className="size-4" fill="currentColor" aria-hidden="true" />
      ) : (
        <Play className="size-4" fill="currentColor" aria-hidden="true" />
      )}
    </button>
  );
}

function getLocalTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();

  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function MessageBubble({
  message,
  playbackStatus,
  onReplay,
}: {
  message: Message;
  playbackStatus: PlaybackStatus;
  onReplay: () => void;
}) {
  const isMate = message.sender === "mate";
  const text = message.text;
  const [showTranslation, setShowTranslation] = useState(false);
  const [showHelpAnswer, setShowHelpAnswer] = useState(false);

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
        {isMate && showTranslation ? (
          <p className="mt-2 text-xs text-secondary" dir="rtl" lang="ar">
            {message.arabicTranslation}
          </p>
        ) : null}
      </div>
      {isMate ? (
        <div className="mt-1 flex flex-wrap justify-start gap-1" dir="ltr">
          <button
            type="button"
            onClick={onReplay}
            className="grid size-8 place-items-center rounded-full text-brand hover:bg-brand/10 hover:text-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label={
              playbackStatus === "playing" ? "إيقاف الصوت" : "إعادة تشغيل الصوت"
            }
            aria-pressed={playbackStatus === "playing"}
          >
            {playbackStatus === "loading" ? (
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
            ) : playbackStatus === "playing" ? (
              <Pause
                className="size-4"
                fill="currentColor"
                aria-hidden="true"
              />
            ) : (
              <Volume2 className="size-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowTranslation((current) => !current)}
            className="grid size-8 place-items-center rounded-full text-brand hover:bg-brand/10 hover:text-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label={showTranslation ? "إخفاء الترجمة" : "عرض الترجمة"}
            aria-pressed={showTranslation}
          >
            <Languages className="size-4" aria-hidden="true" />
          </button>
          {message.helpAnswer ? (
            <button
              type="button"
              onClick={() => setShowHelpAnswer((current) => !current)}
              className="min-h-8 rounded-full px-2.5 text-xs font-medium text-brand hover:bg-brand/10 hover:text-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              aria-expanded={showHelpAnswer}
            >
              {showHelpAnswer ? "إخفاء المساعدة" : "ساعدني أرد"}
            </button>
          ) : null}
        </div>
      ) : null}
      {isMate && message.helpAnswer && showHelpAnswer ? (
        <div className="mt-2 rounded-2xl border border-brand/20 bg-brand/5 px-4 py-3">
          <p className="text-xs text-secondary" dir="rtl" lang="ar">
            إجابة مقترحة، قلها كما هي أو غيّرها
          </p>
          <p className="mt-2 leading-7" dir="ltr" lang="en">
            {message.helpAnswer}
          </p>
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

function CorrectionSheet({
  correction,
  onRecordAgain,
  onDeleteRecording,
  onSendRecording,
  phase,
  recordingElapsedSeconds,
  recordingPlaybackStatus,
  correctedPlaybackStatus,
  onPlayRecording,
  onPlayCorrected,
}: {
  correction: CorrectionState;
  onRecordAgain: () => void;
  onDeleteRecording: () => void;
  onSendRecording: () => void;
  phase: Phase;
  recordingElapsedSeconds: number;
  recordingPlaybackStatus: PlaybackStatus;
  correctedPlaybackStatus: PlaybackStatus;
  onPlayRecording: () => void;
  onPlayCorrected: () => void;
}) {
  return (
    <section
      className="correction-sheet scrollbar-hidden fixed inset-x-0 bottom-0 z-30 mx-auto max-h-[82svh] max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-[#191b1d] p-5"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="مراجعة التسجيل"
    >
      <div className="space-y-5 text-sm leading-7">
        <div>
          <p className="mb-1 text-xs text-[#ef9a9a]">أنت قلت</p>
          <div
            className="mt-2 flex items-start gap-2 rounded-2xl bg-[#272a2d] py-2 pr-2 pl-4 text-[#ef9a9a]"
            dir="ltr"
            lang="en"
          >
            <p className="min-w-0 flex-1 py-1 text-left text-sm leading-6 whitespace-pre-wrap">
              {correction.transcript}
            </p>
            <AudioButton
              label="تشغيل تسجيلك"
              status={recordingPlaybackStatus}
              onClick={onPlayRecording}
            />
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-[#8fce9f]">صياغة مقترحة</p>
          <div
            className="rounded-2xl bg-[#272a2d] px-4 py-2 text-[#8fce9f]"
            dir="ltr"
            lang="en"
          >
            <p className="py-1 text-left text-sm leading-6 whitespace-pre-wrap">
              {correction.suggestedSpokenVersion}
            </p>
            <CorrectedAudioButton
              status={correctedPlaybackStatus}
              onClick={onPlayCorrected}
            />
          </div>
        </div>
      </div>
      <div className="mt-6">
        {phase === "correcting" ? (
          <button
            type="button"
            onClick={onRecordAgain}
            className="flex min-h-12 w-full touch-manipulation items-center justify-center rounded-full bg-brand px-5 font-medium text-[#332d3b] transition-colors hover:bg-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          >
            سجل ردك
          </button>
        ) : null}
        {phase === "recording" ? (
          <div className="space-y-3">
            <div className="flex justify-center">
              <RecordingTray elapsedSeconds={recordingElapsedSeconds} />
            </div>
            <RecordingActions
              onDelete={onDeleteRecording}
              onSend={onSendRecording}
            />
          </div>
        ) : null}
        {phase === "reviewing" ? (
          <button
            type="button"
            disabled
            className="flex min-h-14 w-full cursor-wait items-center justify-center gap-2 rounded-xl bg-[#272a2d] px-5 font-semibold text-brand"
          >
            <LoaderCircle
              className="size-5 shrink-0 origin-center animate-spin"
              aria-hidden="true"
            />
            <span>نراجع ردك</span>
          </button>
        ) : null}
      </div>
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
  const [correction, setCorrection] = useState<CorrectionState | null>(null);
  const [isRetryingCorrection, setIsRetryingCorrection] = useState(false);
  const [error, setError] = useState("");
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const conversationId = useRef<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordingStartedAt = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const pendingRecording = useRef<Blob | null>(null);
  const correctionRecordingUrl = useRef<string | null>(null);
  const mateAudioUrls = useRef(new Map<string, string>());
  const activePlaybackKey = useRef<string | null>(null);
  const [playback, setPlayback] = useState<{
    key: string | null;
    status: PlaybackStatus;
  }>({ key: null, status: "idle" });

  function stopPlayback() {
    audio.current?.pause();
    audio.current = null;
    activePlaybackKey.current = null;
    setPlayback({ key: null, status: "idle" });
  }

  async function playUrl(key: string, url: string) {
    if (activePlaybackKey.current === key) {
      stopPlayback();
      return;
    }

    stopPlayback();
    activePlaybackKey.current = key;
    setPlayback({ key, status: "loading" });

    const nextAudio = new Audio(url);
    audio.current = nextAudio;
    nextAudio.onplay = () => setPlayback({ key, status: "playing" });
    nextAudio.onended = stopPlayback;
    nextAudio.onerror = stopPlayback;

    try {
      await nextAudio.play();
    } catch (playbackError) {
      console.warn("Audio playback was blocked", playbackError);
      stopPlayback();
    }
  }

  function getPlaybackStatus(key: string): PlaybackStatus {
    return playback.key === key ? playback.status : "idle";
  }

  async function replayMateMessage(messageId: string) {
    const key = `mate-${messageId}`;
    const cachedAudioUrl = mateAudioUrls.current.get(messageId);

    if (cachedAudioUrl) {
      await playUrl(key, cachedAudioUrl);
      return;
    }

    if (!conversationId.current || activePlaybackKey.current === key) {
      stopPlayback();
      return;
    }

    const user = firebaseAuth.currentUser;
    if (!user) return;

    stopPlayback();
    activePlaybackKey.current = key;
    setPlayback({ key, status: "loading" });

    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/conversations/${conversationId.current}/messages/${messageId}/speech`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok) throw new Error("Message speech generation failed.");

      const { audioUrl } = SpeechResponseSchema.parse(await response.json());
      mateAudioUrls.current.set(messageId, audioUrl);
      if (activePlaybackKey.current !== key) return;
      stopPlayback();
      await playUrl(key, audioUrl);
    } catch (speechError) {
      console.error("Failed to replay Mate message", speechError);
      stopPlayback();
      setError("تعذر تشغيل الرسالة. حاول مرة أخرى.");
    }
  }

  function clearCorrection() {
    if (correctionRecordingUrl.current) {
      URL.revokeObjectURL(correctionRecordingUrl.current);
      correctionRecordingUrl.current = null;
    }
    setCorrection(null);
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
    };
  }, []);

  useEffect(() => {
    return () => {
      mediaStream.current?.getTracks().forEach((track) => track.stop());
      audio.current?.pause();
      if (correctionRecordingUrl.current) {
        URL.revokeObjectURL(correctionRecordingUrl.current);
      }
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages]);

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
      mateAudioUrls.current.set(conversation.message.id, conversation.audioUrl);
      void playUrl(`mate-${conversation.message.id}`, conversation.audioUrl);
      clearCorrection();
      setPhase("idle");
    } catch (joinError) {
      console.error("Failed to join conversation", joinError);
      conversationId.current = null;
      sessionStorage.removeItem(CONVERSATION_ID_KEY);
      setError("تعذر بدء المحادثة. حاول مرة أخرى.");
      setPhase("ready");
    }
  }

  async function startRecording() {
    if (phase !== "idle" && phase !== "correcting") return;

    const retryingCorrection = phase === "correcting";
    stopPlayback();
    if (!retryingCorrection) clearCorrection();
    setIsRetryingCorrection(retryingCorrection);
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
      // This timestamp belongs to the user-triggered recording event.
      // eslint-disable-next-line react-hooks/purity -- The event handler needs the actual recording start time.
      recordingStartedAt.current = Date.now();
      recording.start();
      setPhase("recording");
    } catch (recordingError) {
      console.error("Failed to start recording", recordingError);
      setError("تعذر تشغيل الميكروفون.");
      setPhase(retryingCorrection ? "correcting" : "idle");
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
    setPhase(isRetryingCorrection ? "correcting" : "idle");
  }

  async function submitRecording(blob: Blob) {
    if (!conversationId.current) return;

    const user = firebaseAuth.currentUser;
    if (!user) throw new Error("The conversation user is unavailable.");

    pendingRecording.current = blob;
    const form = new FormData();
    form.set("recording", blob, "recording.webm");

    const token = await user.getIdToken();
    const response = await fetch(
      `/api/conversations/${conversationId.current}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
    );

    if (!response.ok) throw new Error("The conversation turn failed.");

    const turn = ConversationTurnResponseSchema.parse(await response.json());

    if (turn.outcome === "correction") {
      const recordingUrl = pendingRecording.current
        ? URL.createObjectURL(pendingRecording.current)
        : "";
      correctionRecordingUrl.current = recordingUrl;
      setCorrection({
        transcript: turn.transcript,
        suggestedSpokenVersion: turn.suggestedSpokenVersion,
        recordingUrl,
        audioUrl: turn.audioUrl,
      });
      setIsRetryingCorrection(false);
      setPhase("correcting");
    } else {
      clearCorrection();
      setIsRetryingCorrection(false);
      setMessages((current) => [
        ...current,
        turn.userMessage,
        turn.mateMessage,
      ]);
      mateAudioUrls.current.set(turn.mateMessage.id, turn.audioUrl);
      void playUrl(`mate-${turn.mateMessage.id}`, turn.audioUrl);
      setPhase("idle");
    }
    pendingRecording.current = null;
  }

  async function sendRecording() {
    if (phase !== "recording" || !recorder.current) return;

    const currentRecorder = recorder.current;
    setPhase("reviewing");
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
      await submitRecording(blob);
    } catch (sendError) {
      console.error("Failed to submit recording", sendError);
      setError("تعذر إرسال التسجيل. حاول مرة أخرى.");
      setPhase(isRetryingCorrection ? "correcting" : "idle");
    }
  }

  function finishConversation() {
    setShowEndConfirmation(false);
    deleteRecording();
    stopMediaStream();
    clearCorrection();
    sessionStorage.removeItem(CONVERSATION_ID_KEY);
    conversationId.current = null;
    setMessages([]);
    mateAudioUrls.current.clear();
    setError("");
    setPhase("ready");
  }

  const showCorrection =
    correction !== null &&
    (phase === "correcting" ||
      (isRetryingCorrection &&
        (phase === "recording" || phase === "reviewing")));
  const isReviewing = phase === "reviewing";

  return (
    <main className="mx-auto flex h-svh min-h-0 w-full max-w-lg flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-20 shrink-0 items-center justify-center">
        <Image src="/maharat-logo.svg" alt="مهارات" width={48} height={48} />
      </header>
      <div className="scrollbar-hidden flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-6">
        {messages.length === 0 ? <ReadyPrompt /> : null}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            playbackStatus={getPlaybackStatus(`mate-${message.id}`)}
            onReplay={() => void replayMateMessage(message.id)}
          />
        ))}
        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

      {showCorrection ? (
        <>
          <div
            className="correction-sheet-backdrop fixed inset-0 z-20 bg-black/20"
            aria-hidden="true"
          />
          <CorrectionSheet
            correction={correction}
            onRecordAgain={() => void startRecording()}
            onDeleteRecording={deleteRecording}
            onSendRecording={() => void sendRecording()}
            phase={phase}
            recordingElapsedSeconds={recordingElapsedSeconds}
            recordingPlaybackStatus={getPlaybackStatus("correction-recording")}
            correctedPlaybackStatus={getPlaybackStatus("correction-corrected")}
            onPlayRecording={() =>
              void playUrl("correction-recording", correction.recordingUrl)
            }
            onPlayCorrected={() =>
              void playUrl("correction-corrected", correction.audioUrl)
            }
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

      {!showCorrection ? (
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
                  onClick={() => void startRecording()}
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

            {isReviewing ? (
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
