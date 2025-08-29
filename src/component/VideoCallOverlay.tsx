"use client";
import { useEffect, useRef, useState } from "react";
import { db } from "../app/lib/firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  query,
  where,
} from "firebase/firestore";
import { useAuth } from "./AuthProvider";

type Step = "idle" | "preview" | "calling" | "incoming" | "in-call";
type CallDoc = {
  createdBy: string;
  status: "ringing" | "active" | "ended" | "rejected" | "not-answered";
  offer?: RTCSessionDescriptionInit | null;
  answer?: RTCSessionDescriptionInit | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createdAt?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updatedAt?: any;
};

export default function VideoCallOverlay({
  convoId,
  onClose,
}: {
  convoId: string;
  onClose: () => void;
}) {
  const { user } = useAuth();

  // Call state
  const [step, setStep] = useState<Step>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Media/toggles
  const [hasCam, setHasCam] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);

  // Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream>(new MediaStream());
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);

  const callsCol = collection(db, "conversations", convoId, "calls");

  // ---- helpers: WebRTC -----------------------------------------------------

  const newPeer = () =>
    new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

  async function getMediaSmart(): Promise<MediaStream> {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      throw new Error(
        "Camera & mic require HTTPS (or localhost). Open over HTTPS or http://localhost."
      );
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cam = devices.some((d) => d.kind === "videoinput");
    const mic = devices.some((d) => d.kind === "audioinput");
    setHasCam(cam);
    setHasMic(mic);

    if (!cam && !mic) {
      throw new Error("No camera or microphone found on this device.");
    }

    const constraints =
      cam && mic
        ? { video: { facingMode: "user" }, audio: true }
        : { video: cam ? { facingMode: "user" } : false, audio: mic };

    try {
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      return s;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e?.name === "NotAllowedError")
        throw new Error("Permission blocked. Allow camera/mic in the browser.");
      if (e?.name === "NotReadableError")
        throw new Error("Camera or mic is in use by another app.");
      throw e;
    }
  }

  async function ensureLocalStream() {
    if (!localStreamRef.current) {
      const s = await getMediaSmart();
      localStreamRef.current = s;

      // init toggle state from tracks
      const a = s.getAudioTracks();
      const v = s.getVideoTracks();
      setHasMic(a.length > 0);
      setHasCam(v.length > 0);
      setMicOn(a.every((t) => t.enabled !== false));
      setCamOn(v.every((t) => t.enabled !== false));

      if (localVideoRef.current) localVideoRef.current.srcObject = s;
    }
  }

  const addLocalTracks = () => {
    const pc = pcRef.current!;
    const s = localStreamRef.current!;
    s.getTracks().forEach((t) => pc.addTrack(t, s));
  };

  const wireRemote = () => {
    const pc = pcRef.current!;
    pc.ontrack = async (ev) => {
      ev.streams[0].getTracks().forEach((track) => {
        remoteStreamRef.current?.addTrack(track);
      });

      // attach once the stream has tracks
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current!;
        try {
          await remoteVideoRef.current.play();
        } catch {}
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStreamRef.current!;
        try {
          await remoteAudioRef.current.play();
        } catch {}
      }

      // set video flag properly
      const hasVid =
        (remoteStreamRef.current?.getVideoTracks()?.length ?? 0) > 0;
      setRemoteHasVideo(hasVid);
    };
  };

  const cleanup = (_why: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pcRef.current as any)?._unsubs?.forEach((u: any) => u && u());
    } catch {}
    try {
      pcRef.current?.getSenders().forEach((s) => {
        try {
          s.track?.stop();
        } catch {}
      });
      pcRef.current?.close();
    } catch {}
    localStreamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {}
    });
    remoteStreamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {}
    });
    localStreamRef.current = null;
    remoteStreamRef.current = new MediaStream();
    pcRef.current = null;
  };

  // ---- toggles -----------

  const toggleMic = () => {
    const tracks = localStreamRef.current?.getAudioTracks() || [];
    const next = !micOn;
    tracks.forEach((t) => (t.enabled = next));
    setMicOn(next);
  };

  const toggleCam = () => {
    const tracks = localStreamRef.current?.getVideoTracks() || [];
    const next = !camOn;
    tracks.forEach((t) => (t.enabled = next));
    setCamOn(next);
  };

  // ---- effects ------------
  // media preview on mount
  useEffect(() => {
    (async () => {
      try {
        await ensureLocalStream();
        setStep("preview");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
    return () => cleanup("unmount");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // auto-pop when someone else starts ringing
  useEffect(() => {
    const qy = query(callsCol, where("status", "in", ["ringing", "active"]));
    const unsub = onSnapshot(qy, (snap) => {
      const incoming = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as CallDoc) }))
        .find((c) => c.createdBy !== user?.uid && c.status !== "ended");
      if (incoming && (step === "idle" || step === "preview")) {
        setCallId(incoming.id);
        setStep("incoming");
      }
    });
    return () => unsub();
  }, [convoId, step, user?.uid]);

  // ---- call flows ----------------------------------------------------------

  const startCall = async () => {
    try {
      setError(null);
      setStatusMessage(null);
      await ensureLocalStream();
      setStep("calling");

      const pc = newPeer();
      pcRef.current = pc;
      addLocalTracks();
      wireRemote();

      const callDocRef = await addDoc(callsCol, {
        createdBy: user!.uid,
        status: "ringing",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        offer: null,
        answer: null,
      } as CallDoc);
      setCallId(callDocRef.id);

      const offerCandidates = collection(callDocRef, "offerCandidates");
      const answerCandidates = collection(callDocRef, "answerCandidates");

      pc.onicecandidate = async (ev) => {
        if (ev.candidate) await addDoc(offerCandidates, ev.candidate.toJSON());
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await updateDoc(callDocRef, { offer, updatedAt: serverTimestamp() });

      // 30s unanswered timeout
      timeoutRef.current = setTimeout(async () => {
        await updateDoc(callDocRef, {
          status: "not-answered",
          updatedAt: serverTimestamp(),
        });
        cleanup("no-answer");
        setStatusMessage("Call not answered");
        setStep("preview");
      }, 30000);

      const stopCallWatch = onSnapshot(callDocRef, async (snap) => {
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

      const stopAnsWatch = onSnapshot(
        collection(callDocRef, "answerCandidates"),
        (snap) => {
          snap.docChanges().forEach(async (c) => {
            if (c.type === "added") {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await pc.addIceCandidate(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  new RTCIceCandidate(c.doc.data() as any)
                );
              } catch {}
            }
          });
        }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pc as any)._unsubs = [stopCallWatch, stopAnsWatch];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message || String(e));
      setStep("preview");
    }
  };

  const acceptCall = async () => {
    try {
      setError(null);
      setStatusMessage(null);
      await ensureLocalStream();

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

      const offerCandidates = collection(callDocRef, "offerCandidates");
      const answerCandidates = collection(callDocRef, "answerCandidates");

      pc.onicecandidate = async (ev) => {
        if (ev.candidate) await addDoc(answerCandidates, ev.candidate.toJSON());
      };

      await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await updateDoc(callDocRef, {
        answer,
        status: "active",
        updatedAt: serverTimestamp(),
      });

      const stopOfferWatch = onSnapshot(offerCandidates, (snap) => {
        snap.docChanges().forEach(async (c) => {
          if (c.type === "added") {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await pc.addIceCandidate(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                new RTCIceCandidate(c.doc.data() as any)
              );
            } catch {}
          }
        });
      });

      const stopCallWatch = onSnapshot(callDocRef, (snap) => {
        const data = snap.data() as CallDoc | undefined;
        if (data?.status === "ended") {
          cleanup("ended-by-remote");
          setStep("preview");
        }
        if (data?.status === "not-answered" || data?.status === "rejected") {
          cleanup("remote-ended-before-accept");
          setStep("preview");
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pc as any)._unsubs = [stopOfferWatch, stopCallWatch];
      setStep("in-call");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message || String(e));
      setStep("preview");
    }
  };

  const rejectCall = async () => {
    if (callId) {
      const callDocRef = doc(db, "conversations", convoId, "calls", callId);
      try {
        await updateDoc(callDocRef, {
          status: "rejected",
          updatedAt: serverTimestamp(),
        });
      } catch {}
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

  // ---- UI ------------------------------------------------------------------

  const showControls =
    step === "preview" ||
    step === "calling" ||
    step === "incoming" ||
    step === "in-call";
  const canToggleMic = hasMic && !!localStreamRef.current;
  const canToggleCam = hasCam && !!localStreamRef.current;

  return (
    <div className="absolute inset-0 bg-white/95 backdrop-blur border-l z-20 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <div className="font-semibold">Video Call</div>
        <div className="flex items-center gap-2">
          {step === "preview" && (
            <button
              className="border px-3 py-1  bg-green-500 text-white rounded cursor-pointer"
              onClick={startCall}
            >
              Start call
            </button>
          )}
          {step === "calling" && (
            <button
              className="border px-3 py-1 rounded bg-red-500 text-white cursor-pointer"
              onClick={endCall}
            >
              Cancel
            </button>
          )}
          {step === "incoming" && (
            <>
              <span className="text-sm">Incoming call…</span>
              <button
                className="border px-3 py-1 rounded bg-green-500 text-white cursor-pointer"
                onClick={acceptCall}
              >
                Accept
              </button>
              <button
                className="border px-3 py-1 rounded bg-red-500 text-white cursor-pointer"
                onClick={rejectCall}
              >
                Reject
              </button>
            </>
          )}
          {step === "in-call" && (
            <button
              className="border px-3 py-1 rounded bg-red-500 text-white cursor-pointer"
              onClick={endCall}
            >
              End
            </button>
          )}
          <button className="text-sm underline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {/* Videos */}
      <div className="flex-1 grid place-items-center relative">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className={`absolute bottom-4 right-4 w-48 h-36 rounded-lg border shadow bg-black/10 ${
            !camOn ? "opacity-40" : ""
          }`}
        />
        {!camOn && (
          <div className="absolute bottom-4 right-4 w-48 h-36 rounded-lg border shadow grid place-items-center text-xs bg-black/30 text-white">
            Camera off
          </div>
        )}
      </div>

      {/* Controls + status */}
      <div className="p-3 border-t space-y-2">
        {showControls && (
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={toggleMic}
              disabled={!canToggleMic}
              className={`px-3 py-1 rounded border cursor-pointer bg-blue-400 text-white ${
                micOn ? "" : "bg-blue-600"
              }`}
              title={micOn ? "Mute microphone" : "Unmute microphone"}
            >
              {micOn ? "Mute mic" : "Unmute mic"}
            </button>
            <button
              onClick={toggleCam}
              disabled={!canToggleCam}
              className={`px-3 py-1 rounded border cursor-pointer bg-blue-400 text-white ${
                camOn ? "" : "bg-blue-600"
              }`}
              title={camOn ? "Turn video off" : "Turn video on"}
            >
              {camOn ? "Video off" : "Video on"}
            </button>
          </div>
        )}

        {/* Status / errors */}
        <div className="text-sm text-gray-700">
          {step === "idle" && "Preparing media…"}
          {step === "preview" &&
            (hasCam
              ? "Camera ready."
              : hasMic
              ? "No camera — audio-only."
              : "Checking devices…")}
          {step === "calling" && "Calling… waiting for answer."}
          {step === "incoming" && "You have an incoming call."}
          {step === "in-call" &&
            (hasCam ? "Connected." : "Connected (audio-only).")}
          {statusMessage && (
            <div className="text-blue-600">{statusMessage}</div>
          )}
          {error && <div className="text-red-600">{error}</div>}
        </div>
      </div>
    </div>
  );
}