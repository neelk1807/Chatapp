/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useRef, useState } from "react";
import { db } from "../app/lib/firebase";
import {
  addDoc, collection, doc, getDoc, onSnapshot,
  query, where, serverTimestamp, updateDoc
} from "firebase/firestore";
import { useAuth } from "./AuthProvider";

type CallDoc = {
  createdBy: string;
  status: "ringing" | "active" | "ended" | "rejected" | "not-answered";
  offer?: RTCSessionDescriptionInit | null;
  answer?: RTCSessionDescriptionInit | null;
  createdAt?: any;
  updatedAt?: any;
};

export default function VideoCallOverlay({
  convoId,
  onClose,
}: { convoId: string; onClose: () => void }) {
  const { user } = useAuth();

  type Step = "idle" | "preview" | "calling" | "incoming" | "in-call";
  const [step, setStep] = useState<Step>("idle");

  const [callId, setCallId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // device/track state
  const [hasCam, setHasCam] = useState<boolean | null>(null);
  const [hasMic, setHasMic] = useState<boolean | null>(null);
  const [localHasVideo, setLocalHasVideo] = useState(false);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);

  // refs
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(new MediaStream());
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const callsCol = collection(db, "conversations", convoId, "calls");

  // ---------- Media helpers (mic-only & Vercel-friendly) ----------
  const mediaAPI = () =>
    typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;

  async function getMediaSmart(): Promise<MediaStream> {
    const m = mediaAPI();
    if (!m || !m.getUserMedia) {
      throw new Error("Camera & mic require HTTPS (Vercel is OK) or localhost.");
    }
    const devices = await m.enumerateDevices();
    const cam = devices.some((d) => d.kind === "videoinput");
    const mic = devices.some((d) => d.kind === "audioinput");
    setHasCam(cam);
    setHasMic(mic);
    if (!cam && !mic) throw new Error("No camera or microphone found.");

    // Desktop-friendly constraints (avoid forcing facingMode)
    const constraints =
      cam && mic
        ? { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }
        : { video: cam ? true : false, audio: mic };

    try {
      const stream = await m.getUserMedia(constraints);
      return stream;
    } catch (e: any) {
      // fallback to audio-only if camera denied/not present
      if (mic) return await m.getUserMedia({ video: false, audio: true });
      throw e;
    }
  }

  async function attachVideo(el: HTMLVideoElement, stream: MediaStream) {
    el.srcObject = stream;
    try { await el.play(); } catch {}
  }

  async function ensureLocalStream() {
    if (!localStreamRef.current) {
      const s = await getMediaSmart();
      localStreamRef.current = s;
    }
    // derive flags from the actual stream (don’t rely on previous state)
    const s = localStreamRef.current!;
    const hasVid = s.getVideoTracks().length > 0;
    setLocalHasVideo(hasVid);

    // always attach immediately if we have a video track
    if (localVideoRef.current && hasVid) {
      await attachVideo(localVideoRef.current, s);
    }
  }

  const newPeer = () =>
    new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

  const addLocalTracks = () => {
    const pc = pcRef.current!;
    const s = localStreamRef.current!;
    s.getTracks().forEach((t) => pc.addTrack(t, s));
  };

  const wireRemote = () => {
  const pc = pcRef.current!;
  pc.ontrack = async (ev) => {
    ev.streams[0].getTracks().forEach(track => {
      remoteStreamRef.current?.addTrack(track);
    });

    // attach once the stream has tracks
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current!;
      try { await remoteVideoRef.current.play(); } catch {}
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current!;
      try { await remoteAudioRef.current.play(); } catch {}
    }

    // set video flag properly
    const hasVid = remoteStreamRef.current?.getVideoTracks().length > 0;
    setRemoteHasVideo(hasVid);
  };
};

  const cleanup = (_why: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;

    try { (pcRef.current as any)?._unsubs?.forEach((u: any) => u && u()); } catch {}
    try {
      pcRef.current?.getSenders().forEach((s) => { try { s.track?.stop(); } catch {} });
      pcRef.current?.close();
    } catch {}

    localStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    remoteStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch {} });

    localStreamRef.current = null;
    remoteStreamRef.current = new MediaStream();
    pcRef.current = null;
    setRemoteHasVideo(false);
  };

  // ---------- Effects ----------
  // prepare preview (mic-only safe)
  useEffect(() => {
    (async () => {
      try {
        await ensureLocalStream();
        setStep("preview");
      } catch (e: any) {
        setError(e?.message || String(e));
        setStep("preview"); // still open overlay for audio-only
      }
    })();
    return () => cleanup("unmount");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // auto-popup for incoming calls (works in idle/preview)
  useEffect(() => {
    const qy = query(callsCol, where("status", "in", ["ringing", "active"]));
    const unsub = onSnapshot(qy, (snap) => {
      const inc = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as CallDoc) }))
        .find((c) => c.createdBy !== user?.uid && c.status !== "ended");
      if (inc && (step === "idle" || step === "preview")) {
        setCallId(inc.id);
        setStep("incoming");
        setStatusMessage(null);
      }
    });
    return () => unsub();
  }, [convoId, step, user?.uid]);

  // ---------- Flows ----------
  const startCall = async () => {
    try {
      setError(null);
      setStatusMessage(null);
      await ensureLocalStream(); // ensures local video binding NOW
      setStep("calling");

      const pc = newPeer();
      pcRef.current = pc;
      addLocalTracks();
      wireRemote();

      const callRef = await addDoc(callsCol, {
        createdBy: user!.uid,
        status: "ringing",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        offer: null,
        answer: null,
      } as CallDoc);
      setCallId(callRef.id);

      const offerCands = collection(callRef, "offerCandidates");
      const answerCands = collection(callRef, "answerCandidates");

      pc.onicecandidate = async (ev) => {
        if (ev.candidate) await addDoc(offerCands, ev.candidate.toJSON());
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await updateDoc(callRef, { offer, updatedAt: serverTimestamp() });

      // 30s timeout if nobody answers
      timeoutRef.current = setTimeout(async () => {
        await updateDoc(callRef, { status: "not-answered", updatedAt: serverTimestamp() });
        cleanup("no-answer");
        setStatusMessage("Call not answered");
        setStep("preview");
      }, 30000);

      const stopCallWatch = onSnapshot(callRef, async (snap) => {
        const data = snap.data() as CallDoc | undefined;
        if (!pc.currentRemoteDescription && data?.answer) {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          setStep("in-call");
        }
        if (data?.status === "ended") {
          cleanup("ended-by-remote");
          setStep("preview");
        }
        if (data?.status === "rejected") {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          cleanup("rejected-by-remote");
          setStatusMessage("Call declined");
          setStep("preview");
        }
        if (data?.status === "not-answered") {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          cleanup("no-answer");
          setStatusMessage("Call not answered");
          setStep("preview");
        }
      });

      const stopAnsWatch = onSnapshot(collection(callRef, "answerCandidates"), (snap) => {
        snap.docChanges().forEach(async (c) => {
          if (c.type === "added") {
            try { await pc.addIceCandidate(new RTCIceCandidate(c.doc.data() as any)); } catch {}
          }
        });
      });

      (pc as any)._unsubs = [stopCallWatch, stopAnsWatch];
    } catch (e: any) {
      setError(e?.message || String(e));
      setStep("preview");
    }
  };

  const acceptCall = async () => {
    try {
      setError(null);
      setStatusMessage(null);
      await ensureLocalStream(); // ensures local video binding NOW

      const callDocRef = doc(db, "conversations", convoId, "calls", callId!);
      const callSnap = await getDoc(callDocRef);
      const call = callSnap.data() as CallDoc | undefined;
      if (!call?.offer) {
        setError("Call no longer available.");
        setStep("preview");
        return;
      }

      const pc = newPeer();
      pcRef.current = pc;
      addLocalTracks();
      wireRemote();

      const offerCands = collection(callDocRef, "offerCandidates");
      const answerCands = collection(callDocRef, "answerCandidates");

      pc.onicecandidate = async (ev) => {
        if (ev.candidate) await addDoc(answerCands, ev.candidate.toJSON());
      };

      await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await updateDoc(callDocRef, {
        answer,
        status: "active",
        updatedAt: serverTimestamp(),
      });

      const stopOfferWatch = onSnapshot(offerCands, (snap) => {
        snap.docChanges().forEach(async (c) => {
          if (c.type === "added") {
            try { await pc.addIceCandidate(new RTCIceCandidate(c.doc.data() as any)); } catch {}
          }
        });
      });

      const stopCallWatch = onSnapshot(callDocRef, (snap) => {
        const data = snap.data() as CallDoc | undefined;
        if (data?.status === "ended") {
          cleanup("ended-by-remote");
          setStep("preview");
        }
      });

      (pc as any)._unsubs = [stopOfferWatch, stopCallWatch];
      setStep("in-call");
    } catch (e: any) {
      setError(e?.message || String(e));
      setStep("preview");
    }
  };

  const rejectCall = async () => {
    if (callId) {
      const callDocRef = doc(db, "conversations", convoId, "calls", callId);
      try { await updateDoc(callDocRef, { status: "rejected", updatedAt: serverTimestamp() }); } catch {}
    }
    cleanup("rejected");
    setStep("preview");
  };

  const endCall = async () => {
    if (callId) {
      try {
        await updateDoc(doc(db, "conversations", convoId, "calls", callId), {
          status: "ended",
          updatedAt: serverTimestamp(),
        });
      } catch {}
    }
    cleanup("local-end");
    setStep("preview");
  };

  // ---------- UI ----------
  return (
    <div className="absolute inset-0 bg-white/95 backdrop-blur border-l z-20 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <div className="font-semibold">Call</div>
        <div className="flex items-center gap-2">
          {step === "preview" && (
            <button className="border px-3 py-1 rounded bg-green-500 text-white cursor-pointer" onClick={startCall}>
              Start Call
            </button>
          )}
          {step === "calling" && (
            <button className="border px-3 py-1 rounded bg-red-500 text-white cursor-pointer" onClick={endCall}>
              Cancel
            </button>
          )}
          {step === "incoming" && (
            <>
              <button className="border px-3 py-1 rounded bg-green-500 text-white cursor-pointer" onClick={acceptCall}>
                Accept
              </button>
              <button className="border px-3 py-1 rounded bg-red-500 text-white cursor-pointer" onClick={rejectCall}>
                Reject
              </button>
            </>
          )}
          {step === "in-call" && (
            <button className="border px-3 py-1 rounded bg-red-500 text-white cursor-pointer" onClick={endCall}>
              End
            </button>
          )}
          <button className="text-sm underline cursor-pointer" onClick={onClose}>Close</button>
        </div>
      </div>

      {/* Media area */}
      <div className="flex-1 grid place-items-center relative p-4">
        {/* Remote (big) */}
        {remoteHasVideo ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover rounded-lg bg-black"
          />
        ) : (
          <div className="w-full h-full rounded-lg bg-black grid place-items-center text-gray-300 text-lg">
            <span>Waiting for remote video…</span>
            {/* Hidden audio so you still hear them */}
            <audio ref={remoteAudioRef} autoPlay />
          </div>
        )}

        {/* Local PIP */}
        <div className="absolute bottom-4 right-4">
          {localHasVideo ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-48 h-36 rounded-lg border shadow bg-black object-cover"
              onLoadedMetadata={async (e) => { try { await (e.currentTarget as HTMLVideoElement).play(); } catch {} }}
            />
          ) : (
            <div className="w-40 h-28 rounded-lg border shadow bg-white/90 grid place-items-center text-sm text-gray-600">
              Mic only
            </div>
          )}
        </div>
      </div>

      {/* Status / errors */}
      <div className="p-3 text-sm text-gray-700">
        {step === "preview" && (hasCam ? "Camera ready." : hasMic ? "No camera — audio-only." : "Checking devices…")}
        {step === "calling" && "Calling… waiting for answer (auto-cancel in 30s)."}
        {step === "incoming" && "Incoming call."}
        {step === "in-call" && (remoteHasVideo || localHasVideo ? "Connected." : "Connected (audio-only).")}
        {statusMessage && <div className="text-blue-600">{statusMessage}</div>}
        {error && <div className="text-red-600">{error}</div>}
      </div>
    </div>
  );
}
