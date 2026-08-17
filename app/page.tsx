"use client";

import { useState } from "react";
import { signInAnonymously } from "firebase/auth";
import { LoaderCircle } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { ConversationCreatedResponseSchema } from "@/lib/conversation-schema";
import { firebaseAuth } from "@/lib/firebase-client";

const CONVERSATION_ID_KEY = "maharatConversationId";
const OPENING_MESSAGE_KEY = "maharatOpeningMessage";

export default function Home() {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState("");

  async function startConversation() {
    if (isStarting) {
      return;
    }

    setIsStarting(true);
    setError("");

    try {
      const credential = await signInAnonymously(firebaseAuth);
      const token = await credential.user.getIdToken();
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error("Failed to create conversation.");
      }

      const conversation = ConversationCreatedResponseSchema.parse(
        await response.json(),
      );

      sessionStorage.setItem(CONVERSATION_ID_KEY, conversation.conversationId);
      sessionStorage.setItem(OPENING_MESSAGE_KEY, JSON.stringify(conversation));
      router.push("/conversation");
    } catch (startError) {
      console.error("Failed to start conversation", startError);
      setError("تعذر بدء المحادثة. حاول مرة أخرى.");
      setIsStarting(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12 text-foreground">
      <section className="flex w-full max-w-2xl flex-col items-center text-center">
        <Image
          src="/maharat-logo.svg"
          alt="مهارات"
          width={88}
          height={88}
          priority
          className="mb-12 size-20 sm:mb-14 sm:size-22"
        />

        <h1 className="max-w-xl text-[2rem] leading-[1.4] font-semibold tracking-[-0.03em] text-balance sm:text-5xl sm:leading-[1.3]">
          تعرف إنجليزي…
          <br />
          بس وقت الكلام يختفي؟
        </h1>

        <p className="mt-7 max-w-md text-lg leading-8 text-secondary sm:text-xl">
          ما لك إلا تمارس السبيكنق، ومع الوقت بتتطور.
        </p>

        <button
          type="button"
          onClick={startConversation}
          disabled={isStarting}
          className="mt-10 inline-flex min-h-14 min-w-40 items-center justify-center gap-2 rounded-xl bg-brand px-9 text-lg font-semibold text-[#332d3b] transition-colors hover:bg-[#ffc954] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-70 sm:mt-12"
        >
          {isStarting ? (
            <>
              <LoaderCircle
                className="size-5 animate-spin"
                aria-hidden="true"
              />
              جاري البدء
            </>
          ) : (
            "يلا نتكلم"
          )}
        </button>

        {error ? (
          <p className="mt-4 text-sm text-[#ef9a9a]" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
