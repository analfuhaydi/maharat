import "client-only";

const SILENT_WAV_URL =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA";

let ttsAudio: HTMLAudioElement | null = null;
let isUnlocked = false;

function getTtsAudio() {
  ttsAudio ??= new Audio();
  return ttsAudio;
}

export function unlockTtsAudio() {
  if (isUnlocked) {
    return;
  }

  const audio = getTtsAudio();
  audio.src = SILENT_WAV_URL;

  void audio
    .play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
      isUnlocked = true;
    })
    .catch(() => {
      // A later direct play-button tap can still unlock playback.
    });
}

export async function playTtsAudio(
  audioUrl: string,
  callbacks: { onPlay: () => void; onEnded: () => void },
) {
  const audio = getTtsAudio();
  audio.pause();
  audio.onplay = callbacks.onPlay;
  audio.onended = callbacks.onEnded;
  audio.src = audioUrl;
  await audio.play();
  isUnlocked = true;
}

export function stopTtsAudio() {
  ttsAudio?.pause();
}
