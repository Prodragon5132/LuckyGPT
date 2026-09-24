"use client";

import { apiRaw } from "./api";
import { plainForSpeech } from "./utils";

// ---------- Microphone recording ----------

export interface Recorder {
  stop(): Promise<Blob>;
  cancel(): void;
  level(): number;
  stream: MediaStream;
}

function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const m of options) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export async function getMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Your browser can't use the microphone here. Make sure the site is opened over https.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    throw new Error("Microphone permission was denied. Allow microphone access in your browser settings.");
  }
}

// ---------- iPhone/Safari audio unlock ----------
// iOS only lets audio play if it was started by a tap. We "unlock" one shared <audio> element,
// the speech synthesizer and an AudioContext on the first tap, then reuse them for every reply.

let sharedAudio: HTMLAudioElement | null = null;
let sharedCtx: AudioContext | null = null;
// 0.1s of silence (tiny valid WAV)
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

function audioEl(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.setAttribute("playsinline", "");
    sharedAudio.preload = "auto";
  }
  return sharedAudio;
}

export function audioContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === "closed") {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx = new Ctx();
  }
  if (sharedCtx.state === "suspended") sharedCtx.resume().catch(() => {});
  return sharedCtx;
}

/** Call from a tap/click handler. Safe to call many times. */
export function unlockAudio() {
  try {
    const a = audioEl();
    if (!audioUnlocked && (!a.src || a.src === SILENCE)) {
      a.src = SILENCE;
      a.play()
        .then(() => {
          audioUnlocked = true;
          // Only stop the silent clip — never real speech that may have started since.
          if (a.src === SILENCE) a.pause();
        })
        .catch(() => {});
    }
    audioContext();
    if (typeof speechSynthesis !== "undefined" && !speechUnlocked) {
      speechUnlocked = true;
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch {
    /* ignore */
  }
}
let speechUnlocked = false;
let audioUnlocked = false;

export function levelMeter(stream: MediaStream): { level: () => number; close: () => void } {
  const ctx = audioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  return {
    level() {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      return Math.sqrt(sum / data.length);
    },
    close() {
      src.disconnect();
      analyser.disconnect();
    },
  };
}

export async function startRecorder(existing?: MediaStream): Promise<Recorder> {
  const stream = existing ?? (await getMic());
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(250);
  const meter = levelMeter(stream);
  const release = () => {
    meter.close();
    if (!existing) stream.getTracks().forEach((t) => t.stop());
  };
  return {
    stream,
    level: meter.level,
    stop() {
      return new Promise((resolve) => {
        rec.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }));
        };
        if (rec.state !== "inactive") rec.stop();
        else {
          release();
          resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        }
      });
    },
    cancel() {
      rec.onstop = null;
      if (rec.state !== "inactive") rec.stop();
      release();
    },
  };
}

export async function transcribeBlob(blob: Blob, signal?: AbortSignal): Promise<string> {
  const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("audio", blob, `speech.${ext}`);
  const res = await apiRaw("/api/voice/transcribe", { method: "POST", body: form, signal });
  const data = (await res.json()) as { text: string };
  return data.text;
}

// ---------- Browser speech recognition (free fallback) ----------

const SERVER_STT_HINT = "An admin can switch Settings → Voice → Speech to text to OpenRouter, OpenAI or Groq so it works everywhere.";

/** Errors that won't fix themselves by retrying, so voice mode stops and explains instead of looping. */
export const FATAL_STT_ERRORS = new Set(["not-allowed", "service-not-allowed", "network", "audio-capture", "language-not-supported"]);

function browserSttError(code: string): string {
  switch (code) {
    case "not-allowed":
      return "Microphone permission was denied. Allow the microphone for this site in your browser settings.";
    case "service-not-allowed":
      return `This browser (or iPhone home-screen app) doesn't allow its built-in speech recognition here. ${SERVER_STT_HINT}`;
    case "network":
      return `Your browser's built-in speech recognition isn't working (it only works in Chrome, Edge and Safari, and needs internet). ${SERVER_STT_HINT}`;
    case "audio-capture":
      return "No microphone was found. Check that one is connected and allowed.";
    case "language-not-supported":
      return "Your spoken language isn't supported by the browser's speech recognition. Change it in Settings → General.";
    default:
      return `Speech recognition error (${code}). ${SERVER_STT_HINT}`;
  }
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export function browserSttSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function createRecognizer(opts: {
  lang?: string;
  continuous?: boolean;
  onText: (finalText: string, interim: string) => void;
  onEnd?: () => void;
  /** code is the browser's error code, e.g. "network" or "not-allowed". */
  onError?: (msg: string, code: string) => void;
}): SpeechRecognitionLike | null {
  const w = window as unknown as Record<string, new () => SpeechRecognitionLike>;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = opts.lang && opts.lang !== "auto" ? opts.lang : navigator.language || "en-US";
  r.continuous = opts.continuous ?? true;
  r.interimResults = true;
  let finalText = "";
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    opts.onText(finalText, interim);
  };
  r.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    opts.onError?.(browserSttError(e.error), e.error);
  };
  r.onend = () => opts.onEnd?.();
  return r;
}

// ---------- Text to speech ----------

let currentAudio: HTMLAudioElement | null = null;

// Speaking speed (Settings → General → Voice speed). Applied while playing, so it works with every
// voice provider (OpenAI, Gemini, Fish Audio, ElevenLabs…) and the browser's voices.
let voiceSpeed = 1.3;
export function setVoiceSpeed(speed: number | undefined) {
  voiceSpeed = speed && speed >= 0.5 && speed <= 2.5 ? speed : 1.3;
}
let currentAbort: AbortController | null = null;
const speakingListeners = new Set<(id: string | null) => void>();
let speakingId: string | null = null;

function setSpeaking(id: string | null) {
  speakingId = id;
  speakingListeners.forEach((l) => l(id));
}

export function onSpeakingChange(fn: (id: string | null) => void) {
  speakingListeners.add(fn);
  fn(speakingId);
  return () => {
    speakingListeners.delete(fn);
  };
}

export function stopSpeaking() {
  currentAbort?.abort();
  currentAbort = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  setSpeaking(null);
}

export async function fetchSpeech(text: string, voice: string | undefined, signal?: AbortSignal): Promise<Blob> {
  const res = await apiRaw("/api/voice/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 4000), voice }),
    signal,
  });
  return res.blob();
}

/** Plays audio on the shared element. Resolves true if it played, false if the browser refused. */
export function playBlob(blob: Blob, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = audioEl();
    currentAudio = audio;
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      audio.onended = null;
      audio.onerror = null;
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      resolve(ok);
    };
    audio.onended = () => done(true);
    audio.onerror = () => done(false);
    signal?.addEventListener("abort", () => {
      audio.pause();
      done(true);
    });
    audio.src = url;
    audio.preservesPitch = true;
    audio.defaultPlaybackRate = voiceSpeed;
    audio.playbackRate = voiceSpeed;
    audio.play().catch(() => done(false));
  });
}

export function speakBrowser(text: string, opts: { lang?: string; voiceName?: string } = {}, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined") return resolve();
    const u = new SpeechSynthesisUtterance(text);
    if (opts.lang && opts.lang !== "auto") u.lang = opts.lang;
    const voices = speechSynthesis.getVoices();
    const v = voices.find((x) => x.name === opts.voiceName) ?? voices.find((x) => x.default && x.lang.startsWith((u.lang || navigator.language).slice(0, 2)));
    if (v) u.voice = v;
    u.rate = Math.min(2.5, 1.02 * voiceSpeed);
    u.onend = () => resolve();
    u.onerror = () => resolve();
    signal?.addEventListener("abort", () => {
      speechSynthesis.cancel();
      resolve();
    });
    speechSynthesis.speak(u);
  });
}

function chunkText(text: string, max = 1200): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

let lastVoiceWarning = 0;
/** Tells the person (at most once a minute) why the server voice failed; speech falls back to the browser voice. */
function warnVoice(onError: ((msg: string) => void) | undefined, msg: string) {
  if (!onError || Date.now() - lastVoiceWarning < 60_000) return;
  lastVoiceWarning = Date.now();
  onError(`${msg} Using the browser's voice instead.`);
}

/** "Read aloud" for a whole message. */
export async function readAloud(
  id: string,
  markdown: string,
  cfg: { tts: "browser" | "server"; voice?: string; lang?: string; onError?: (msg: string) => void },
): Promise<void> {
  stopSpeaking();
  const abort = new AbortController();
  currentAbort = abort;
  setSpeaking(id);
  const text = plainForSpeech(markdown);
  const parts = chunkText(text);
  try {
    if (cfg.tts === "server") {
      // Fetch the next chunk while the current one plays.
      const get = (i: number) =>
        fetchSpeech(parts[i], cfg.voice, abort.signal).catch((e: Error) => {
          if (!abort.signal.aborted) warnVoice(cfg.onError, e.message);
          return null;
        });
      let next: Promise<Blob | null> | null = parts.length ? get(0) : null;
      for (let i = 0; i < parts.length && !abort.signal.aborted; i++) {
        const blob = await next!;
        next = i + 1 < parts.length ? get(i + 1) : null;
        const played = blob ? await playBlob(blob, abort.signal) : false;
        if (!played && !abort.signal.aborted) {
          if (blob) warnVoice(cfg.onError, "The browser blocked audio playback.");
          await speakBrowser(parts[i], { lang: cfg.lang }, abort.signal);
        }
      }
    } else {
      for (const p of parts) {
        if (abort.signal.aborted) break;
        await speakBrowser(p, { lang: cfg.lang, voiceName: cfg.voice }, abort.signal);
      }
    }
  } catch {
    /* aborted or failed */
  } finally {
    if (currentAbort === abort) {
      currentAbort = null;
      setSpeaking(null);
    }
  }
}

export function browserVoices(): { id: string; name: string }[] {
  if (typeof speechSynthesis === "undefined") return [];
  return speechSynthesis.getVoices().map((v) => ({ id: v.name, name: `${v.name} (${v.lang})` }));
}
