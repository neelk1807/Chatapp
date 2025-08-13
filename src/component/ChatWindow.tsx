"use client";
import { useEffect, useRef, useState } from "react";
import { db } from "../app/lib/firebase";
import {
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  orderBy,
  query,
  doc,
  updateDoc,
  getDocs,
  writeBatch,
  limit,
  startAfter,
  where,              // ✅ NEW
} from "firebase/firestore";
import { useAuth } from "./AuthProvider";
import VideoCallOverlay from "@/component/VideoCallOverlay";

export default function ChatWindow({ convoId }: { convoId: string }) {
  const { user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 🔔 Auto-open video overlay on incoming call
  useEffect(() => {
    if (!convoId || !user) return;
    const callsCol = collection(db, "conversations", convoId, "calls");
    const qy = query(callsCol, where("status", "==", "ringing"));
    const unsub = onSnapshot(qy, (snap) => {
      const inc = snap.docs
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .find((c) => c.createdBy !== user.uid);
      if (inc) {
        setShowVideo(true); // 👉 mounts the overlay so it can show "Incoming call"
      }
    });
    return () => unsub();
  }, [convoId, user?.uid]);

  useEffect(() => {
    if (!convoId) return;
    const q = query(
      collection(db, "conversations", convoId, "messages"),
      orderBy("createdAt")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setMsgs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
      },
      (err) => console.error("messages listener error:", err)
    );
    return () => unsub();
  }, [convoId]);

  const send = async () => {
    if (!user || !text.trim() || sending) return;
    setSending(true);
    const value = text.trim();
    try {
      await addDoc(collection(db, "conversations", convoId, "messages"), {
        text: value,
        senderId: user.uid,
        createdAt: serverTimestamp(),
        readBy: [user.uid],
      });
      setText("");
      await updateDoc(doc(db, "conversations", convoId), {
        updatedAt: serverTimestamp(),
        lastMessage: { text: value, by: user.uid, at: serverTimestamp() },
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      alert("Failed to send: " + (e.code || e.message || e));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const clearChat = async () => {
    if (!confirm("Clear all messages in this conversation for everyone?")) return;
    setClearing(true);
    try {
      const messagesCol = collection(db, "conversations", convoId, "messages");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let last: any = null;
      while (true) {
        let q = query(messagesCol, orderBy("createdAt"), limit(400));
        if (last) q = query(messagesCol, orderBy("createdAt"), startAfter(last), limit(400));
        const snap = await getDocs(q);
        if (snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        last = snap.docs[snap.docs.length - 1];
      }
      await updateDoc(doc(db, "conversations", convoId), {
        lastMessage: null,
        updatedAt: serverTimestamp(),
      });
      alert("Chat cleared.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      alert("Failed to clear chat: " + (e.code || e.message || e));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <div className="font-semibold">Chat</div>
        <div className="flex items-center gap-3">
          <button className="border px-3 py-1 rounded bg-green-900 text-white cursor-pointer" onClick={() => setShowVideo(true)}>
            Video Call
          </button>
          <button
            className="text-xs underline disabled:opacity-50 cursor-pointer"
            onClick={clearChat}
            disabled={clearing}
            title="Delete all messages in this conversation"
          >
            {clearing ? "Clearing…" : "Clear Chat"}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {msgs.map((m) => (
          <div
            key={m.id}
            className={`max-w-[70%] p-2 rounded ${
              m.senderId === user?.uid ? "ml-auto bg-blue-100" : "bg-gray-100"
            }`}
          >
            {m.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Video Overlay */}
      {showVideo && (
        <div className="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
          <VideoCallOverlay
            convoId={convoId}
            onClose={() => setShowVideo(false)}
          />
        </div>
      )}

      {/* Composer */}
      <div className="p-3 border-t flex gap-2 items-end">
        <textarea
          className="flex-1 border p-2 rounded resize-none"
          rows={2}
          placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          className="border px-4 py-2 rounded disabled:opacity-50"
          onClick={send}
          disabled={sending || !text.trim()}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
