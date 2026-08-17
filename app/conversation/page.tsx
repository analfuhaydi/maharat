"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import { LoaderCircle, Mic, Pause, Play } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import {
  ConversationCreatedResponseSchema,
  ConversationStreamEventSchema,
  MessagesResponseSchema,
  type MaharatMessage,
  type Message,
} from "@/lib/conversation-schema";
import { firebaseAuth } from "@/lib/firebase-client";

const CONVERSATION_ID_KEY = "maharatConversationId";
const OPENING_MESSAGE_KEY = "maharatOpeningMessage";

type ConversationPhase =
  | "idle"
  | "recording"
  | "paused"
  | "transcribing"
  | "thinking"
  | "generatingSpeech"
  | "playing";

type AudioUrls = Record<string, string>;

function formatMessageTime(createdAt: string) {
  return new Intl.DateTimeFormat("ar-SA", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(createdAt));
}

function base64ToAudioUrl(audioBase64: string) {
  const bytes = Uint8Array.from(atob(audioBase64), (character) =>
    character.charCodeAt(0),
  );
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

function appendMessage(messages: Message[], message: Message) {
  return messages.some((existingMessage) => existingMessage.id === message.id)
    ? messages
    : [...messages, message];
}

function ConversationHeader() {
  return (
    <header className="flex h-20 shrink-0 items-center justify-center border-b border-white/8 bg-background px-5">
      <Image src="/maharat-logo.svg" alt="مهارات" width={48} height={48} />
    </header>
  );
}

function MessageBubble({
  message,
  audioUrl,
  onPlay,
}: {
  message: Message;
  audioUrl?: string;
  onPlay: (message: MaharatMessage, audioUrl: string) => void;
}) {
  const isMaharat = message.sender === "maharat";
  const text = isMaharat ? message.text : message.whisperResponse.text;

  return (
    <article
      className={`flex max-w-[86%] flex-col gap-1.5 ${
        isMaharat ? "items-start self-start" : "items-end self-end"
      }`}
    >
      <div
        className={`flex items-end gap-2 rounded-2xl px-4 py-3 text-[0.98rem] leading-7 ${
          isMaharat
            ? "rounded-tr-md bg-[#191b1d] text-foreground"
            : "rounded-tl-md bg-brand text-[#332d3b]"
        }`}
        dir="ltr"
      >
        <p>{text}</p>
        {isMaharat && audioUrl ? (
          <button
            type="button"
            onClick={() => onPlay(message, audioUrl)}
            className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-full text-brand transition-colors hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label="تشغيل الرسالة"
          >
            <Play className="size-4 fill-current" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <time
        dateTime={message.createdAt}
        className="px-1 text-xs text-secondary"
      >
        {formatMessageTime(message.createdAt)}
      </time>
    </article>
  );
}

function ConversationHistory({
  messages,
  phase,
  audioUrls,
  historyRef,
  onScroll,
  onPlay,
}: {
  messages: Message[];
  phase: ConversationPhase;
  audioUrls: AudioUrls;
  historyRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onPlay: (message: MaharatMessage, audioUrl: string) => void;
}) {
  const pendingLabel =
    phase === "thinking" || phase === "generatingSpeech" ? "يسجل.." : null;

  return (
    <div
      ref={historyRef}
      onScroll={onScroll}
      className="message-history flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8"
      aria-live="polite"
    >
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          audioUrl={audioUrls[message.id]}
          onPlay={onPlay}
        />
      ))}

      {pendingLabel ? (
        <div className="flex items-center gap-2 self-start rounded-2xl rounded-tr-md bg-[#191b1d] px-4 py-3 text-sm text-secondary">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          {pendingLabel}
        </div>
      ) : null}
    </div>
  );
}

function IconButton({
  label,
  children,
  onClick,
  emphasis = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  emphasis?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid size-12 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand ${
        emphasis
          ? "bg-brand text-[#332d3b] hover:bg-[#ffc954]"
          : "bg-[#272a2d] text-foreground hover:bg-[#303438]"
      }`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function ConversationRecorder({
  phase,
  previewUrl,
  onStart,
  onPause,
  onDelete,
  onSend,
  previewAudioRef,
  onPreviewError,
}: {
  phase: ConversationPhase;
  previewUrl: string | null;
  onStart: () => void;
  onPause: () => void;
  onDelete: () => void;
  onSend: () => void;
  previewAudioRef: RefObject<HTMLAudioElement | null>;
  onPreviewError: () => void;
}) {
  return (
    <footer className="safe-area-pb shrink-0 border-t border-white/8 bg-background px-5 py-5">
      <div className="mx-auto flex min-h-14 max-w-lg flex-col gap-4">
        {phase === "paused" && previewUrl ? (
          <audio
            ref={previewAudioRef}
            src={previewUrl}
            controls
            preload="metadata"
            onError={onPreviewError}
            className="preview-audio h-12 w-full"
            aria-label="استمع إلى تسجيلك"
          />
        ) : null}

        <div className="flex items-center justify-center">
          {phase === "idle" || phase === "playing" ? (
            <button
              type="button"
              onClick={onStart}
              disabled={phase === "playing"}
              className="grid size-16 place-items-center rounded-full bg-brand text-[#332d3b] transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="ابدأ التسجيل"
            >
              <Mic className="size-7" aria-hidden="true" />
            </button>
          ) : null}

          {phase === "recording" ? (
            <IconButton label="إيقاف مؤقت" onClick={onPause} emphasis>
              <Pause className="size-5 fill-current" aria-hidden="true" />
            </IconButton>
          ) : null}

          {phase === "paused" ? (
            <div className="flex w-full items-center gap-2" dir="ltr">
              <button
                type="button"
                onClick={onDelete}
                className="min-h-11 basis-1/5 rounded-full bg-red-500/15 px-3 text-sm text-red-300 transition-colors hover:bg-red-500/25 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-red-300"
                dir="rtl"
              >
                احذف
              </button>
              <button
                type="button"
                onClick={onSend}
                className="min-h-11 basis-4/5 rounded-full bg-brand px-5 text-sm font-medium text-[#332d3b] transition-colors hover:bg-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand"
                dir="rtl"
              >
                ارسل
              </button>
            </div>
          ) : null}

          {phase === "transcribing" ? (
            <div
              className="grid size-16 place-items-center rounded-full bg-brand text-[#332d3b]"
              role="status"
              aria-label="جاري تحويل التسجيل إلى نص"
            >
              <LoaderCircle
                className="size-7 animate-spin"
                aria-hidden="true"
              />
            </div>
          ) : null}

          {phase === "thinking" || phase === "generatingSpeech" ? (
            <div className="grid size-16 place-items-center rounded-full bg-[#272a2d] text-secondary">
              <Mic className="size-7" aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

export default function ConversationPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [phase, setPhase] = useState<ConversationPhase>("idle");
  const [audioUrls, setAudioUrls] = useState<AudioUrls>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const historyRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const conversationIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const messageAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlsRef = useRef<AudioUrls>({});

  const getToken = useCallback(async () => {
    await firebaseAuth.authStateReady();
    const user = firebaseAuth.currentUser;

    if (!user) {
      throw new Error("UNAUTHORIZED");
    }

    return user.getIdToken();
  }, []);

  const updatePlayback = useCallback(
    async (messageId: string, update: Record<string, string>) => {
      const conversationId = conversationIdRef.current;

      if (!conversationId) {
        return;
      }

      try {
        const token = await getToken();
        await fetch(
          `/api/conversations/${conversationId}/messages/${messageId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(update),
          },
        );
      } catch (playbackError) {
        console.error("Failed to update playback time", playbackError);
      }
    },
    [getToken],
  );

  const playMessage = useCallback(
    async (message: MaharatMessage, audioUrl: string) => {
      messageAudioRef.current?.pause();
      const audio = new Audio(audioUrl);
      messageAudioRef.current = audio;
      setPhase("playing");
      setError("");

      audio.addEventListener(
        "play",
        () => {
          void updatePlayback(message.id, {
            playbackStartedAt: new Date().toISOString(),
          });
        },
        { once: true },
      );
      audio.addEventListener(
        "ended",
        () => {
          setPhase("idle");
          void updatePlayback(message.id, {
            playbackEndedAt: new Date().toISOString(),
          });
        },
        { once: true },
      );

      try {
        await audio.play();
      } catch {
        setPhase("idle");
        setError("اضغط زر التشغيل للاستماع للرسالة.");
      }
    },
    [updatePlayback],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadConversation() {
      const conversationId = sessionStorage.getItem(CONVERSATION_ID_KEY);

      if (!conversationId) {
        router.replace("/");
        return;
      }

      conversationIdRef.current = conversationId;

      try {
        const token = await getToken();
        const response = await fetch(
          `/api/conversations/${conversationId}/messages`,
          { headers: { Authorization: `Bearer ${token}` } },
        );

        if (!response.ok) {
          throw new Error("Failed to load conversation.");
        }

        const result = MessagesResponseSchema.parse(await response.json());

        if (cancelled) {
          return;
        }

        setMessages(result.messages);
        const openingValue = sessionStorage.getItem(OPENING_MESSAGE_KEY);

        if (openingValue) {
          const opening = ConversationCreatedResponseSchema.parse(
            JSON.parse(openingValue),
          );

          if (opening.conversationId === conversationId) {
            const audioUrl = base64ToAudioUrl(opening.audioBase64);
            audioUrlsRef.current = {
              ...audioUrlsRef.current,
              [opening.message.id]: audioUrl,
            };
            setAudioUrls(audioUrlsRef.current);
            window.setTimeout(() => {
              sessionStorage.removeItem(OPENING_MESSAGE_KEY);
            }, 0);
            void playMessage(opening.message, audioUrl);
          }
        }
      } catch (loadError) {
        console.error("Failed to load conversation", loadError);
        sessionStorage.removeItem(CONVERSATION_ID_KEY);
        router.replace("/");
      }
    }

    void loadConversation();

    return () => {
      cancelled = true;
    };
  }, [getToken, playMessage, router]);

  useEffect(() => {
    if (!isNearBottomRef.current) {
      return;
    }

    const history = historyRef.current;
    history?.scrollTo({ top: history.scrollHeight, behavior: "smooth" });
  }, [messages, phase]);

  useEffect(() => {
    return () => {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      previewAudioRef.current?.pause();
      messageAudioRef.current?.pause();
      Object.values(audioUrlsRef.current).forEach(URL.revokeObjectURL);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  function handleHistoryScroll() {
    const history = historyRef.current;

    if (!history) {
      return;
    }

    isNearBottomRef.current =
      history.scrollHeight - history.scrollTop - history.clientHeight < 80;
  }

  function clearPreview() {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setPreviewUrl(null);
    }
  }

  function stopMediaStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  async function startRecording() {
    setError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = "audio/webm;codecs=opus";
      const recorder = MediaRecorder.isTypeSupported(preferredMimeType)
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      });
      recorder.start(250);
      setPhase("recording");
    } catch (recordingError) {
      console.error("Failed to start recording", recordingError);
      setError("اسمح بالوصول للمايكروفون حتى تبدأ المحادثة.");
    }
  }

  async function pauseRecording() {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state !== "recording") {
      return;
    }

    recorder.pause();
    await new Promise<void>((resolve) => {
      recorder.addEventListener("dataavailable", () => resolve(), {
        once: true,
      });
      recorder.requestData();
    });

    const blob = new Blob(recordingChunksRef.current, {
      type: recorder.mimeType || "audio/webm",
    });
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setPhase("paused");
  }

  function deleteRecording() {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    clearPreview();
    stopMediaStream();
    recordingChunksRef.current = [];
    mediaRecorderRef.current = null;
    setPhase("idle");
  }

  async function finalizeRecording() {
    const recorder = mediaRecorderRef.current;

    if (!recorder) {
      throw new Error("No recording is available.");
    }

    if (recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }

    return new Blob(recordingChunksRef.current, {
      type: recorder.mimeType || "audio/webm",
    });
  }

  async function sendRecording() {
    const conversationId = conversationIdRef.current;

    if (!conversationId) {
      return;
    }

    previewAudioRef.current?.pause();
    setPhase("transcribing");
    setError("");

    try {
      const recordingEndedAt = Date.now();
      const [recording, token] = await Promise.all([
        finalizeRecording(),
        getToken(),
      ]);
      clearPreview();
      stopMediaStream();
      const formData = new FormData();
      formData.set("recording", recording, "recording.webm");
      formData.set("recordingStartedAt", String(recordingStartedAtRef.current));
      formData.set("recordingEndedAt", String(recordingEndedAt));
      const response = await fetch(
        `/api/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        },
      );

      if (!response.ok || !response.body) {
        throw new Error("Failed to send recording.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const event = ConversationStreamEventSchema.parse(JSON.parse(line));

          if (event.type === "userMessage") {
            setMessages((current) => appendMessage(current, event.message));
            setPhase("thinking");
          } else if (event.type === "maharatThinking") {
            setPhase("thinking");
          } else if (event.type === "maharatGeneratingSpeech") {
            setPhase("generatingSpeech");
          } else if (event.type === "maharatMessage") {
            const audioUrl = base64ToAudioUrl(event.audioBase64);
            audioUrlsRef.current = {
              ...audioUrlsRef.current,
              [event.message.id]: audioUrl,
            };
            setAudioUrls(audioUrlsRef.current);
            setMessages((current) => appendMessage(current, event.message));
            void playMessage(event.message, audioUrl);
          } else {
            throw new Error(event.message);
          }
        }

        if (done) {
          break;
        }
      }

      recordingChunksRef.current = [];
      mediaRecorderRef.current = null;
    } catch (sendError) {
      console.error("Failed to send recording", sendError);
      stopMediaStream();
      setPhase("idle");
      setError("تعذر إرسال التسجيل. حاول مرة أخرى.");
    }
  }

  return (
    <main className="mx-auto flex h-svh w-full max-w-3xl flex-col overflow-hidden bg-background text-foreground">
      <ConversationHeader />
      <ConversationHistory
        messages={messages}
        phase={phase}
        audioUrls={audioUrls}
        historyRef={historyRef}
        onScroll={handleHistoryScroll}
        onPlay={playMessage}
      />
      {error ? (
        <p
          className="shrink-0 px-5 pb-2 text-center text-sm text-[#ef9a9a]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <ConversationRecorder
        phase={phase}
        previewUrl={previewUrl}
        onStart={startRecording}
        onPause={pauseRecording}
        onDelete={deleteRecording}
        onSend={sendRecording}
        previewAudioRef={previewAudioRef}
        onPreviewError={() => setError("تعذر تشغيل التسجيل.")}
      />
    </main>
  );
}
