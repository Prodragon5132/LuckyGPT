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

export function levelMeter(stream: MediaStream): { level: () => number; close: () => void } {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
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
      ctx.close().catch(() => {});
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
  onError?: (msg: string) => void;
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
    opts.onError?.(e.error === "not-allowed" ? "Microphone permission was denied." : `Speech recognition error: ${e.error}`);
  };
  r.onend = () => opts.onEnd?.();
  return r;
}

// ---------- Text to speech ----------

let currentAudio: HTMLAudioElement | null = null;
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
    currentAudio.src = "";
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

export function playBlob(blob: Blob, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    const done = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    signal?.addEventListener("abort", () => {
      audio.pause();
      done();
    });
    audio.play().catch(done);
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
    u.rate = 1.02;
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

/** "Read aloud" for a whole message. */
export async function readAloud(
  id: string,
  markdown: string,
  cfg: { tts: "browser" | "server"; voice?: string; lang?: string },
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
      let next: Promise<Blob> | null = parts.length ? fetchSpeech(parts[0], cfg.voice, abort.signal) : null;
      for (let i = 0; i < parts.length && !abort.signal.aborted; i++) {
        const blob = await next!;
        next = i + 1 < parts.length ? fetchSpeech(parts[i + 1], cfg.voice, abort.signal) : null;
        await playBlob(blob, abort.signal);
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
