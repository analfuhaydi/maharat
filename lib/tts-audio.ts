import "client-only";

const SILENT_WAV_URL =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA";

let ttsAudio: HTMLAudioElement | null = null;
let isUnlocked = false;
let playbackGeneration = 0;

function getTtsAudio() {
  if (!ttsAudio) {
    ttsAudio = new Audio();
    ttsAudio.preload = "auto";
  }

  return ttsAudio;
}

export function unlockTtsAudio() {
  if (isUnlocked) {
    return;
  }

  const audio = getTtsAudio();
  const unlockGeneration = ++playbackGeneration;
  audio.muted = true;
  audio.src = SILENT_WAV_URL;
  audio.load();

  void audio
    .play()
    .then(() => {
      if (unlockGeneration !== playbackGeneration) return;

      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      isUnlocked = true;
    })
    .catch(() => {
      if (unlockGeneration !== playbackGeneration) return;

      audio.muted = false;
      // A later direct play-button tap can still unlock playback.
    });
}

export async function playTtsAudio(
  audioUrl: string,
  callbacks: { onPlay: () => void; onEnded: () => void },
) {
  const audio = getTtsAudio();
  playbackGeneration += 1;
  audio.pause();
  audio.currentTime = 0;
  audio.onplay = callbacks.onPlay;
  audio.onended = callbacks.onEnded;
  audio.onerror = callbacks.onEnded;
  audio.muted = false;
  audio.src = audioUrl;
  audio.load();
  await audio.play();
  isUnlocked = true;
}

export function stopTtsAudio() {
  playbackGeneration += 1;
  ttsAudio?.pause();
}
