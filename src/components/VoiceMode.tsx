"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/client/store";
import { sendMessage, stopStreaming } from "@/lib/client/chat-client";
import {
  FATAL_STT_ERRORS,
  browserSttSupported,
  createRecognizer,
  fetchSpeech,
  getMic,
  levelMeter,
  playBlob,
  speakBrowser,
  stopSpeaking,
  transcribeBlob,
} from "@/lib/client/voice";
import { plainForSpeech, threadFor, cn } from "@/lib/client/utils";
import { CaptionsIcon, CloseIcon, MicIcon, MicOffIcon } from "./icons";
import { Portal } from "./ui";

type Phase = "starting" | "listening" | "hearing" | "thinking" | "speaking" | "error";

/** Splits streamed text into speakable sentences. */
function takeSentences(buffer: string, force: boolean): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  const re = /^([\s\S]{12,}?[.!?…])(\s+|$)|^([\s\S]*?\n{2,})/;
  for (;;) {
    const m = re.exec(rest);
    if (!m) break;
    const s = (m[1] ?? m[3]).trim();
    if (s) sentences.push(s);
    rest = rest.slice(m[0].length);
  }
  if (force && rest.trim()) {
    sentences.push(rest.trim());
    rest = "";
  }
  return { sentences, rest };
}

export function VoiceMode() {
  const open = useApp((s) => s.voiceOpen);
  const voiceCfg = useApp((s) => s.voiceCfg);
  if (!open) return null;
  // If the voice settings arrive after voice mode opened (e.g. tapped right after page load),
  // restart the session so it uses the right speech-to-text / text-to-speech.
  return <VoiceSession key={`${voiceCfg.stt}:${voiceCfg.tts}`} />;
}

function VoiceSession() {
  const ctx = useApp((s) => s.voiceContext);
  const voiceCfg = useApp((s) => s.voiceCfg);
  const prefs = useApp((s) => s.user?.prefs);
  const set = useApp((s) => s.set);
  const [phase, setPhase] = useState<Phase>("starting");
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);
  // Captions: the conversation so far (you on the right, LuckyGPT on the left) + what's being heard right now.
  const [turns, setTurns] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);

  const keyRef = useRef(ctx?.sessionKey ?? "new");
  const phaseRef = useRef<Phase>("starting");
  const mutedRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<ReturnType<typeof levelMeter> | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speakAbort = useRef<AbortController | null>(null);
  const closedRef = useRef(false);
  const recognizerRef = useRef<ReturnType<typeof createRecognizer>>(null);
  // Set when the person taps the orb to send what they said right away.
  const forceEndRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  // Browser speech recognition restarts itself after each reply; kept in a ref to avoid a circular dependency.
  const listenRef = useRef<() => void>(() => {});

  const useServerStt = voiceCfg.stt === "server";
  const useServerTts = voiceCfg.tts === "server";
  const voice = prefs?.voice && prefs.voice !== "default" ? prefs.voice : undefined;

  const setP = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  // ---------- recording helpers (server STT) ----------
  const startRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.start(200);
    recRef.current = rec;
  }, []);

  const stopRecorder = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const rec = recRef.current;
      recRef.current = null;
      if (!rec || rec.state === "inactive") return resolve(new Blob(chunksRef.current));
      rec.onstop = () => resolve(new Blob(chunksRef.current, { type: rec.mimeType }));
      rec.stop();
    });
  }, []);

  // ---------- speaking ----------
  const speakQueue = useRef<string[]>([]);
  const speakingLoop = useRef<Promise<void> | null>(null);
  const streamDone = useRef(true);

  const runSpeaker = useCallback(async () => {
    const abort = speakAbort.current!;
    // Fetch the audio for the next sentence while the current one plays.
    const take = () => {
      const text = speakQueue.current.shift();
      if (!text) return null;
      const audio = useServerTts
        ? fetchSpeech(text, voice, abort.signal).catch((e: Error) => {
            if (!abort.signal.aborted) setError(`${e.message} Using the browser's voice instead.`);
            return null;
          })
        : null;
      return { text, audio };
    };
    let pending: ReturnType<typeof take> = null;
    while (!abort.signal.aborted) {
      const cur = pending ?? take();
      pending = null;
      if (!cur) {
        if (streamDone.current) break;
        await new Promise((r) => setTimeout(r, 60));
        continue;
      }
      if (phaseRef.current !== "speaking") setP("speaking");
      setTurns((t) => {
        const last = t[t.length - 1];
        return last?.role === "assistant"
          ? [...t.slice(0, -1), { role: "assistant", text: `${last.text} ${cur.text}` }]
          : [...t, { role: "assistant", text: cur.text }];
      });
      if (useServerTts) {
        const blob = await cur.audio;
        if (abort.signal.aborted) break;
        pending = take();
        const played = blob ? await playBlob(blob, abort.signal) : false;
        // Server voice failed or was blocked: say it with the browser's voice so the conversation keeps going.
        if (!played && !abort.signal.aborted) await speakBrowser(cur.text, { lang: prefs?.spokenLanguage }, abort.signal);
      } else {
        await speakBrowser(cur.text, { lang: prefs?.spokenLanguage, voiceName: voice }, abort.signal);
      }
    }
  }, [useServerTts, voice, prefs?.spokenLanguage]);

  const interrupt = useCallback(() => {
    speakAbort.current?.abort();
    stopSpeaking();
    speakQueue.current = [];
    streamDone.current = true;
    stopStreaming(keyRef.current);
  }, []);

  // ---------- one conversational turn ----------
  const respond = useCallback(
    async (text: string) => {
      if (!text.trim() || closedRef.current) {
        setP("listening");
        return;
      }
      setHeard("");
      setTurns((t) => [...t, { role: "user", text: text.trim() }]);
      setP("thinking");
      const st = useApp.getState();
      const session = st.session(keyRef.current);
      const thread = threadFor(session.messages, session.currentLeaf);
      const parentId = thread[thread.length - 1]?.id ?? null;

      speakAbort.current = new AbortController();
      speakQueue.current = [];
      streamDone.current = false;
      let buffer = "";
      speakingLoop.current = runSpeaker();

      const result = await sendMessage({
        key: keyRef.current,
        content: text,
        parentId,
        voice: true,
        gptId: ctx?.gptId,
        projectId: ctx?.projectId,
        onChatCreated: (id) => {
          keyRef.current = id;
          if (window.location.pathname !== `/c/${id}`) window.history.replaceState(null, "", `/c/${id}`);
        },
        onEvent: (ev) => {
          if (ev.type === "text") {
            buffer += ev.delta;
            const { sentences, rest } = takeSentences(buffer, false);
            buffer = rest;
            speakQueue.current.push(...sentences.map(plainForSpeech).filter(Boolean));
          } else if (ev.type === "reset") {
            // The server is retrying the reply: forget the unsent part.
            buffer = "";
            speakQueue.current = [];
          } else if (ev.type === "error") {
            speakQueue.current.push("Sorry, something went wrong. " + ev.message);
          }
        },
      });
      keyRef.current = result.key;
      const { sentences } = takeSentences(buffer, true);
      speakQueue.current.push(...sentences.map(plainForSpeech).filter(Boolean));
      streamDone.current = true;
      await speakingLoop.current;
      if (!closedRef.current) {
        setP("listening");
        if (useServerStt) startRecorder();
        else listenRef.current();
      }
    },
    [ctx, runSpeaker, startRecorder, useServerStt],
  );

  // ---------- browser speech recognition path ----------
  const startBrowserListening = useCallback(() => {
    if (closedRef.current || mutedRef.current) return;
    // Only one recognizer may run: starting a second one makes the browser abort the first,
    // and two of them restarting each other would leave voice mode stuck on "Listening".
    const previous = recognizerRef.current;
    recognizerRef.current = null;
    previous?.abort();
    let finalText = "";
    let fatal = false;
    const r = createRecognizer({
      lang: prefs?.spokenLanguage,
      continuous: false,
      onText: (f, interim) => {
        if (recognizerRef.current !== r) return;
        finalText = f;
        setHeard(f + interim);
        if (phaseRef.current === "listening") setP("hearing");
      },
      onError: (m, code) => {
        if (recognizerRef.current !== r) return;
        if (FATAL_STT_ERRORS.has(code)) fatal = true;
        setError(m);
      },
      onEnd: () => {
        if (closedRef.current || recognizerRef.current !== r) return; // replaced or closed
        recognizerRef.current = null;
        if (fatal) {
          setHeard("");
          setP("error");
        } else if (finalText.trim()) void respond(finalText.trim());
        else if (phaseRef.current === "listening" || phaseRef.current === "hearing") {
          setHeard("");
          setP("listening");
          setTimeout(() => listenRef.current(), 150);
        }
      },
    });
    recognizerRef.current = r;
    try {
      r?.start();
    } catch {
      /* already started */
    }
  }, [prefs?.spokenLanguage, respond]);

  useEffect(() => {
    listenRef.current = startBrowserListening;
  }, [startBrowserListening]);

  // ---------- setup & VAD loop ----------
  useEffect(() => {
    // `alive` belongs to this mount only. In development React mounts twice; a stale first mount
    // must never start a second microphone/recognizer session alongside the real one.
    let alive = true;
    closedRef.current = false;
    let raf = 0;
    let noiseFloor = 0.01;
    let calibrated = 0;
    let speechMs = 0;
    let silenceMs = 0;
    let hearingSince = 0;
    let recorderStarted = 0;
    let last = performance.now();

    const restartListening = () => {
      setHeard("");
      setP("listening");
      startRecorder();
      recorderStarted = performance.now();
    };

    const loop = async () => {
      if (!alive) return;
      const now = performance.now();
      const dt = now - last;
      last = now;
      const lvl = meterRef.current?.level() ?? 0;
      setLevel(lvl);
      const p = phaseRef.current;
      if (calibrated < 20) {
        noiseFloor = noiseFloor * 0.8 + lvl * 0.2;
        calibrated++;
      } else if (p === "listening") {
        noiseFloor = noiseFloor * 0.995 + Math.min(lvl, noiseFloor * 2) * 0.005;
      }
      const threshold = Math.max(0.012, noiseFloor * 2.5);

      if (!mutedRef.current && useServerStt) {
        // Tapping the orb sends what was said right away.
        const force = forceEndRef.current && (p === "listening" || p === "hearing");
        forceEndRef.current = false;
        if (p === "listening" && !force) {
          if (lvl > threshold) speechMs += dt;
          else speechMs = Math.max(0, speechMs - dt);
          if (speechMs > 120) {
            setP("hearing");
            hearingSince = now;
            silenceMs = 0;
          } else if (now - recorderStarted > 12_000) {
            // Drop long silent recordings so uploads stay small.
            await stopRecorder();
            startRecorder();
            recorderStarted = now;
          }
        } else if (p === "hearing" || force) {
          if (lvl < threshold * 0.8) silenceMs += dt;
          else silenceMs = 0;
          if (force || silenceMs > 900 || now - hearingSince > 45_000) {
            speechMs = 0;
            setP("thinking");
            setHeard("…");
            const blob = await stopRecorder();
            try {
              const text = await transcribeBlob(blob);
              if (!alive) return;
              if (text && text.replace(/[^\p{L}\p{N}]/gu, "").length > 1) void respond(text);
              else restartListening();
            } catch (e) {
              if (!alive) return;
              setError((e as Error).message);
              restartListening();
            }
          }
        } else if (p === "speaking") {
          // Barge-in: the user starts talking while LuckyGPT speaks.
          if (lvl > threshold * 2.2) speechMs += dt;
          else speechMs = Math.max(0, speechMs - dt * 0.5);
          if (speechMs > 280) {
            speechMs = 0;
            interrupt();
            startRecorder();
            recorderStarted = now;
            hearingSince = now;
            silenceMs = 0;
            setP("hearing");
          }
        }
      }
      if (alive) raf = requestAnimationFrame(() => void loop());
    };

    (async () => {
      try {
        if (!useServerStt && !browserSttSupported()) {
          throw new Error("Voice mode needs speech recognition. Use Chrome, Edge or Safari, or ask your admin to set up a speech-to-text provider.");
        }
        const stream = await getMic();
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        meterRef.current = levelMeter(stream);
        setP("listening");
        if (useServerStt) {
          startRecorder();
          recorderStarted = performance.now();
        } else {
          listenRef.current();
        }
        raf = requestAnimationFrame(() => void loop());
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
        setP("error");
      }
    })();

    return () => {
      alive = false;
      closedRef.current = true;
      cancelAnimationFrame(raf);
      speakAbort.current?.abort();
      stopSpeaking();
      const r = recognizerRef.current;
      recognizerRef.current = null;
      r?.abort();
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
      meterRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, heard, captions]);

  const close = () => {
    interrupt();
    set({ voiceOpen: false, voiceContext: null });
  };

  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    if (!useServerStt) {
      if (next) recognizerRef.current?.abort();
      else if (phaseRef.current === "listening") listenRef.current();
    }
  };

  const status =
    phase === "starting"
      ? "Connecting…"
      : phase === "error"
        ? "Voice mode couldn't start"
        : muted
          ? "Microphone is off"
          : phase === "listening"
            ? "Listening"
            : phase === "hearing"
              ? "Listening · tap to send"
              : phase === "thinking"
                ? "Thinking"
                : "Tap to interrupt";

  const showTranscript = captions && (turns.length > 0 || !!heard);
  const scale = phase === "hearing" || phase === "listening" ? 1 + Math.min(0.25, level * 4) : phase === "speaking" ? 1.06 : 1;

  return (
    <Portal>
      <div className="safe-area fixed inset-0 z-[60] flex flex-col items-center bg-surface text-fg fade-in">
        <div className="flex w-full items-center justify-between p-4">
          <span className="text-sm text-fg-3">{useServerTts ? "Voice mode" : "Voice mode · browser voice"}</span>
          <span />
        </div>
        <div className={cn("flex min-h-0 w-full flex-1 flex-col items-center gap-6 px-6", showTranscript ? "pt-2" : "justify-center")}>
          <button
            onClick={() => {
              const p = phaseRef.current;
              if (p === "speaking" || p === "thinking") {
                interrupt();
                setHeard("");
                setP("listening");
                if (useServerStt) startRecorder();
                else listenRef.current();
              } else if (p === "listening" || p === "hearing") {
                // Send what was said now instead of waiting for a pause.
                if (useServerStt) forceEndRef.current = true;
                else recognizerRef.current?.stop();
              }
            }}
            className={cn(
              "relative shrink-0 rounded-full transition-[transform,width,height] duration-200",
              showTranscript ? "h-32 w-32 sm:h-40 sm:w-40" : "h-56 w-56 sm:h-64 sm:w-64",
            )}
            style={{ transform: `scale(${scale})` }}
            aria-label={status}
          >
            <div className={cn("voice-orb absolute inset-0 rounded-full", phase === "thinking" && "animate-pulse", muted && "grayscale")} />
            <div className="voice-orb-swirl absolute inset-0 rounded-full" />
          </button>
          <div className="text-center">
            <div className={cn("text-lg font-medium", (phase === "thinking" || phase === "starting") && "shimmer")}>{status}</div>
            {error && <div className="mt-2 max-w-sm text-sm text-danger">{error}</div>}
          </div>
          {showTranscript && (
            <div ref={transcriptRef} className="scroll-thin min-h-0 w-full max-w-2xl flex-1 overflow-y-auto" aria-live="polite">
              <div className="flex flex-col gap-3 pb-2">
                {turns.map((t, i) =>
                  t.role === "user" ? (
                    <div key={i} data-turn="user" className="flex justify-end">
                      <div className="max-w-[80%] whitespace-pre-wrap rounded-3xl bg-bubble px-4 py-2 text-[15px] leading-6">{t.text}</div>
                    </div>
                  ) : (
                    <div key={i} data-turn="assistant" className="flex justify-start">
                      <div className="max-w-[90%] text-[15px] leading-7">{t.text}</div>
                    </div>
                  ),
                )}
                {heard && (
                  <div data-turn="user-live" className="flex justify-end">
                    <div className="max-w-[80%] rounded-3xl bg-bubble px-4 py-2 text-[15px] leading-6 text-fg-2 opacity-80">{heard}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 pb-10">
          <button
            onClick={() => setCaptions((c) => !c)}
            className={cn("flex h-14 w-14 items-center justify-center rounded-full bg-muted text-fg hover:opacity-80", !captions && "opacity-60")}
            aria-label={captions ? "Hide captions" : "Show captions"}
          >
            <CaptionsIcon size={24} />
          </button>
          <button
            onClick={toggleMute}
            className={cn("flex h-14 w-14 items-center justify-center rounded-full", muted ? "bg-danger text-white" : "bg-muted text-fg hover:opacity-80")}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          >
            {muted ? <MicOffIcon size={24} /> : <MicIcon size={24} />}
          </button>
          <button onClick={close} className="flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white hover:opacity-90" aria-label="End voice mode">
            <CloseIcon size={24} />
          </button>
        </div>
      </div>
    </Portal>
  );
}
