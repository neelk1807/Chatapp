

/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  where,
  arrayUnion,
  arrayRemove,
  deleteDoc,
} from "firebase/firestore";
import { useAuth } from "./AuthProvider";
import VideoCallOverlay from "@/component/VideoCallOverlay";

/* ----------------------------- Types ----------------------------- */
type Attachment = {
  url: string;
  pathname: string;
  name: string;
  size: number;
  contentType: string;
};

type GeoPointLite = { lat: number; lng: number; accuracy?: number };

type LiveMeta = {
  isActive: boolean;
  minutes: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  startedAt?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expiresAt?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  endedAt?: any | null;
};

type Msg = {
  id: string;
  text: string;
  senderId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createdAt?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editedAt?: any;
  readBy?: string[];
  replyToId?: string | null;
  replyPreview?: { text: string; senderId: string } | null;
  starredBy?: string[];
  deletedFor?: string[];
  attachment?: Attachment | null;

  /* 🧭 Location: */
  kind?: "text" | "location" | "live-location";
  location?: GeoPointLite | null;
  live?: LiveMeta | null;
};

/* ---------------------- Floating menu helper --------------------- */
function FloatingMenu({
  anchor,
  width = 200,
  onClose,
  children,
}: {
  anchor: DOMRect;
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    left: 0,
    top: 0,
    width,
  });

  useLayoutEffect(() => {
    const MARGIN = 8;

    const place = () => {
      const menuW = width;
      const openRight = anchor.right + MARGIN + menuW <= window.innerWidth;
      const left = openRight
        ? Math.min(anchor.right + MARGIN, window.innerWidth - menuW - MARGIN)
        : Math.max(MARGIN, anchor.left - menuW - MARGIN);

      const menuH = ref.current?.offsetHeight ?? 0;
      let top = anchor.top;
      if (top + menuH + MARGIN > window.innerHeight) {
        top = Math.max(MARGIN, window.innerHeight - menuH - MARGIN);
      }
      setStyle({ position: "fixed", left, top, width });
    };

    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    const onResize = () => place();
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [anchor, width]);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        ref={ref}
        style={style}
        className="bg-white border rounded shadow-md overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------------------------- Component -------------------------- */
export default function ChatWindow({ convoId }: { convoId: string }) {
  const { user } = useAuth();

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Video overlay
  const [showVideo, setShowVideo] = useState(false);

  // Reply/Edit/menu state
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // Floating menu state
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [selectedMsg, setSelectedMsg] = useState<Msg | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Attachment picker
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickFile = () => fileInputRef.current?.click();

  // 🧭 Location: picker/menu
  const [locMenuOpen, setLocMenuOpen] = useState(false);
  const locBtnRef = useRef<HTMLButtonElement>(null);

  // 🧭 Location: live sharing session
  const liveWatchIdRef = useRef<number | null>(null);
  const liveMsgIdRef = useRef<string | null>(null);
  const liveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isImage = (ct?: string) => !!ct && ct.startsWith("image/");
  const isVideo = (ct?: string) => !!ct && ct.startsWith("video/");

  const mapEmbed = (p: GeoPointLite, z = 15) =>
    `https://maps.google.com/maps?q=${p.lat},${p.lng}&z=${z}&output=embed`;
  const mapsLink = (p: GeoPointLite) => `https://maps.google.com/?q=${p.lat},${p.lng}`;

  const nowMs = () => Date.now();

  // Auto-open overlay on incoming ringing call
  useEffect(() => {
    if (!convoId || !user) return;
    const callsCol = collection(db, "conversations", convoId, "calls");
    const qy = query(callsCol, where("status", "==", "ringing"));
    const unsub = onSnapshot(qy, (snap) => {
      const inc = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .find((c: any) => c.createdBy !== user.uid);
      if (inc) setShowVideo(true);
    });
    return () => unsub();
  }, [convoId, user?.uid]);

  // Messages listener
  useEffect(() => {
    if (!convoId) return;
    const q = query(collection(db, "conversations", convoId, "messages"), orderBy("createdAt"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Msg[];
        setMsgs(rows);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
      },
      (err) => console.error("messages listener error:", err)
    );
    return () => unsub();
  }, [convoId]);

  // Close floating menu on outside click
  useEffect(() => {
    const handler = () => setMenuOpen(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  // Cleanup live sharing on unmount / convo switch
  useEffect(() => {
    return () => {
      // Call stopLiveSharing but do not await it, so the cleanup is synchronous
      void stopLiveSharing("component-unmount");
    };
  }, [convoId]);

  /* -------------------- Attach (kept from before) -------------------- */
  const handleAttachChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const input = e.currentTarget;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;
    void uploadAndSend(file);
  };

  const uploadAndSend = async (file: File) => {
    if (!user) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("convoId", convoId);
      const res = await fetch("/api/blob-upload", { method: "POST", body: fd });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert("Upload failed: " + (e.error || res.statusText));
        return;
      }
      const uploaded = await res.json();

      const caption = text.trim();
      setSending(true);

      await addDoc(collection(db, "conversations", convoId, "messages"), {
        kind: "text",
        text: caption,
        senderId: user.uid,
        createdAt: serverTimestamp(),
        readBy: [user.uid],
        replyToId: replyTo?.id ?? null,
        replyPreview: replyTo
          ? { text: replyTo.text?.slice(0, 140) ?? "", senderId: replyTo.senderId }
          : null,
        starredBy: [],
        deletedFor: [],
        attachment: {
          url: uploaded.url,
          pathname: uploaded.pathname,
          name: uploaded.name,
          size: uploaded.size,
          contentType: uploaded.contentType,
        } as Attachment,
      });

      setText("");
      setReplyTo(null);

      await updateDoc(doc(db, "conversations", convoId), {
        updatedAt: serverTimestamp(),
        lastMessage: { text: uploaded.name, by: user.uid, at: serverTimestamp() },
      });
    } catch (e: any) {
      alert("Failed to send attachment: " + (e?.message || e));
    } finally {
      setSending(false);
    }
  };

  /* ------------------- Sending text / edit / star ------------------- */
  const send = async () => {
    if (!user || !text.trim() || sending) return;
    setSending(true);
    const value = text.trim();

    try {
      await addDoc(collection(db, "conversations", convoId, "messages"), {
        kind: "text",
        text: value,
        senderId: user.uid,
        createdAt: serverTimestamp(),
        readBy: [user.uid],
        replyToId: replyTo?.id ?? null,
        replyPreview: replyTo
          ? { text: replyTo.text?.slice(0, 140) ?? "", senderId: replyTo.senderId }
          : null,
        starredBy: [],
        deletedFor: [],
        attachment: null,
      });

      setText("");
      setReplyTo(null);

      await updateDoc(doc(db, "conversations", convoId), {
        updatedAt: serverTimestamp(),
        lastMessage: { text: value, by: user.uid, at: serverTimestamp() },
      });
    } catch (e: any) {
      alert("Failed to send: " + (e.code || e.message || e));
    } finally {
      setSending(false);
    }
  };

  const startEdit = (m: Msg) => {
    setEditingId(m.id);
    setEditText(m.text);
    closeMenu();
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };
  const saveEdit = async (m: Msg) => {
    if (!user) return;
    const canEdit =
      m.senderId === user.uid && m.createdAt?.toMillis && Date.now() - m.createdAt.toMillis() <= 10_000;
    if (!canEdit) {
      alert("You can edit only your own message within 10 seconds.");
      return;
    }
    try {
      await updateDoc(doc(db, "conversations", convoId, "messages", m.id), {
        text: editText.trim(),
        editedAt: serverTimestamp(),
      });
      cancelEdit();
    } catch (e: any) {
      alert("Failed to edit: " + (e.code || e.message || e));
    }
  };

  const toggleStar = async (m: Msg) => {
    if (!user) return;
    const ref = doc(db, "conversations", convoId, "messages", m.id);
    const isStarredByMe = (m.starredBy || []).includes(user.uid);
    try {
      await updateDoc(ref, {
        starredBy: isStarredByMe ? arrayRemove(user.uid) : arrayUnion(user.uid),
      });
    } catch (e: any) {
      alert("Failed to toggle star: " + (e.code || e.message || e));
    } finally {
      closeMenu();
    }
  };

  /* ---------------------- Delete for me/everyone ---------------------- */
  const deleteForMe = async (m: Msg) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, "conversations", convoId, "messages", m.id), {
        deletedFor: arrayUnion(user.uid),
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      alert("Failed to delete for me: " + (e.code || e.message || e));
    } finally {
      closeMenu();
    }
  };

  const deleteForEveryone = async (m: Msg) => {
    if (!user) return;
    if (m.senderId !== user.uid) {
      alert("Only the sender can delete for everyone.");
      return;
    }
    if (!confirm("Delete this message for everyone?")) return;
    try {
      await deleteDoc(doc(db, "conversations", convoId, "messages", m.id));
      if (m.attachment?.pathname) {
        await fetch("/api/blob-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pathname: m.attachment.pathname }),
        });
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      alert("Failed to delete for everyone: " + (e.code || e.message || e));
    } finally {
      closeMenu();
    }
  };

  /* ------------------------- Clear chat (starred kept) ------------------------- */
  const clearChat = async () => {
    if (!confirm("Clear all messages in this conversation? (Starred messages will be kept)")) return;
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
        snap.docs.forEach((d) => {
          const data = d.data() as Msg;
          const starredCount = (data.starredBy || []).length;
          if (starredCount === 0) batch.delete(d.ref);
        });
        await batch.commit();
        last = snap.docs[snap.docs.length - 1];
      }
      await updateDoc(doc(db, "conversations", convoId), { updatedAt: serverTimestamp() });
      alert("Chat cleared (starred messages kept).");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      alert("Failed to clear chat: " + (e.code || e.message || e));
    } finally {
      setClearing(false);
    }
  };

  /* ---------------------------- Floating menu ---------------------------- */
  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, m: Msg) => {
    e.stopPropagation();
    setSelectedMsg(m);
    setMenuOpen(m.id);
    setMenuAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
  };
  const closeMenu = () => {
    setMenuOpen(null);
    setSelectedMsg(null);
    setMenuAnchor(null);
  };

  /* ======================= 🧭 Location features ======================= */

  const ensureGeo = (): Geolocation => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      throw new Error("Location requires HTTPS (or http://localhost). Open the app via HTTPS.");
    }
    return navigator.geolocation;
  };

  const getOnce = (): Promise<GeoPointLite> =>
    new Promise((resolve, reject) => {
      try {
        const g = ensureGeo();
        g.getCurrentPosition(
          (pos) =>
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            }),
          (err) => reject(err),
          { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
        );
      } catch (e) {
        reject(e);
      }
    });

  // Send current location
  const sendCurrentLocation = async () => {
    if (!user) return;
    try {
      const p = await getOnce();
      await addDoc(collection(db, "conversations", convoId, "messages"), {
        kind: "location",
        text: text.trim() || "", // optional caption
        senderId: user.uid,
        createdAt: serverTimestamp(),
        readBy: [user.uid],
        replyToId: replyTo?.id ?? null,
        replyPreview: replyTo
          ? { text: replyTo.text?.slice(0, 140) ?? "", senderId: replyTo.senderId }
          : null,
        location: p,
        live: null,
        starredBy: [],
        deletedFor: [],
        attachment: null,
      });
      setText("");
      setReplyTo(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      alert(e?.message || "Failed to get location.");
    } finally {
      setLocMenuOpen(false);
    }
  };

  // Start live sharing for N minutes
  const startLiveLocation = async (minutes: 10 | 20 | 30) => {
    if (!user) return;
    try {
      const p = await getOnce();
      // create the message
      const ref = await addDoc(collection(db, "conversations", convoId, "messages"), {
        kind: "live-location",
        text: text.trim() || "",
        senderId: user.uid,
        createdAt: serverTimestamp(),
        readBy: [user.uid],
        replyToId: replyTo?.id ?? null,
        replyPreview: replyTo
          ? { text: replyTo.text?.slice(0, 140) ?? "", senderId: replyTo.senderId }
          : null,
        location: p,
        live: {
          isActive: true,
          minutes,
          startedAt: serverTimestamp(),
          // we'll compute expiresAt on client; server value is informative
          expiresAt: serverTimestamp(),
          endedAt: null,
        } as LiveMeta,
        starredBy: [],
        deletedFor: [],
        attachment: null,
      });

      setText("");
      setReplyTo(null);
      setLocMenuOpen(false);

      liveMsgIdRef.current = ref.id;

      // Setup watch + timer
      const g = ensureGeo();
      const endAtMs = nowMs() + minutes * 60_000;

      // update expiresAt immediately (nice to have)
      await updateDoc(ref, {
        "live.expiresAt": new Date(endAtMs),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      liveWatchIdRef.current = g.watchPosition(
        async (pos) => {
          if (!liveMsgIdRef.current) return;
          try {
            await updateDoc(doc(db, "conversations", convoId, "messages", liveMsgIdRef.current), {
              location: {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              },
              // touch updatedAt for UI freshness (optional)
              updatedAt: serverTimestamp(),
            });
          } catch {}
        },
        (err) => {
          console.warn("live watch error", err);
        },
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 }
      );

      // auto-stop timer
      liveTimerRef.current = setTimeout(() => stopLiveSharing("auto-expire"), endAtMs - nowMs());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      alert(e?.message || "Failed to start live location.");
    }
  };

  const stopLiveSharing = async (_why: string) => {
    try {
      if (liveWatchIdRef.current != null) {
        try {
          navigator.geolocation?.clearWatch(liveWatchIdRef.current);
        } catch {}
      }
      if (liveTimerRef.current) {
        clearTimeout(liveTimerRef.current);
      }
      liveWatchIdRef.current = null;
      liveTimerRef.current = null;

      if (liveMsgIdRef.current) {
        try {
          await updateDoc(doc(db, "conversations", convoId, "messages", liveMsgIdRef.current), {
            "live.isActive": false,
            "live.endedAt": serverTimestamp(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
        } catch {}
      }
    } finally {
      liveMsgIdRef.current = null;
    }
  };

  const msLeft = (m: Msg): number => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exp = m.live?.expiresAt as any;
    if (!exp?.toMillis) return 0;
    return Math.max(0, exp.toMillis() - nowMs());
  };

  const liveBadge = (m: Msg) => {
    const left = msLeft(m);
    if (!left) return "Live location ended";
    const mins = Math.floor(left / 60_000);
    const secs = Math.floor((left % 60_000) / 1000);
    return `Live location • ${mins}m ${secs}s left`;
  };

  /* ------------------------------ UI -------------------------------- */
  const myUid = user?.uid;

  return (
    <div className="flex flex-col h-full relative" onClick={closeMenu}>
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <div className="font-semibold">Chat</div>
        <div className="flex items-center gap-3">
          <button
            className="border px-3 py-1 rounded bg-green-900 text-white cursor-pointer"
            onClick={() => setShowVideo(true)}
          >
            Video
          </button>
          <button
            className="text-xs underline disabled:opacity-50"
            onClick={clearChat}
            disabled={clearing}
            title="Delete all non-starred messages"
          >
            {clearing ? "Clearing…" : "Clear chat"}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {msgs
          .filter((m) => (myUid ? !(m.deletedFor || []).includes(myUid) : true))
          .map((m) => {
            const mine = m.senderId === user?.uid;
            const isEditing = editingId === m.id;
            const isStarredByMe = !!user && (m.starredBy || []).includes(user.uid);
            const isLive = m.kind === "live-location" && m.live?.isActive && msLeft(m) > 0;

            return (
              <div key={m.id} className={`max-w-max ${mine ? "ml-auto" : ""} relative group`}>
                <div className={`px-6 py-4 rounded ${mine ? "bg-blue-100" : "bg-gray-100"}`}>
                  {/* Reply preview */}
                  {m.replyPreview && (
                    <div className="mb-1 text-[11px] px-2 py-1 rounded bg-white/60 border">
                      Replying to {m.replyPreview.senderId === user?.uid ? "you" : "them"}: “
                      {m.replyPreview.text}”
                    </div>
                  )}

                  {/* 🧭 Location rendering */}
                  {m.kind === "location" && m.location ? (
                    <div className="space-y-1">
                      <iframe
                        className="rounded w-full max-w-md h-44"
                        src={mapEmbed(m.location)}
                        loading="lazy"
                      />
                      <a className="text-blue-600 underline text-sm" target="_blank" rel="noreferrer" href={mapsLink(m.location)}>
                        Open in Maps
                      </a>
                      {m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
                    </div>
                  ) : m.kind === "live-location" && m.location ? (
                    <div className="space-y-1">
                      <div className={`text-xs ${isLive ? "text-green-700" : "text-gray-500"}`}>
                        {isLive ? liveBadge(m) : "Live location ended"}
                        {mine && isLive && (
                          <button
                            className="ml-2 underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              stopLiveSharing("user-stop");
                            }}
                          >
                            Stop sharing
                          </button>
                        )}
                      </div>
                      <iframe
                        className="rounded border w-full max-w-md h-44"
                        src={mapEmbed(m.location)}
                        loading="lazy"
                        key={`${m.location.lat.toFixed(5)}-${m.location.lng.toFixed(5)}`}
                      />
                      <a className="text-blue-600 underline text-sm" target="_blank" rel="noreferrer" href={mapsLink(m.location)}>
                        Open in Maps
                      </a>
                      {m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
                    </div>
                  ) : /* Attachments / text (existing) */ m.attachment ? (
                    <div className="space-y-1">
                      {isImage(m.attachment.contentType) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.attachment.url} alt={m.attachment.name} className="max-h-64 rounded" loading="lazy" />
                      )}
                      {isVideo(m.attachment.contentType) && (
                        <video src={m.attachment.url} controls className="max-h-64 rounded" />
                      )}
                      {!isImage(m.attachment.contentType) && !isVideo(m.attachment.contentType) && (
                        <a
                          href={m.attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 underline text-blue-600"
                        >
                          📎 {m.attachment.name}
                        </a>
                      )}
                      {!isEditing && m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
                    </div>
                  ) : !isEditing ? (
                    <>
                      <div className="whitespace-pre-wrap">{m.text}</div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-500">
                        {m.editedAt && <span>edited</span>}
                        {isStarredByMe && <span>★ starred</span>}
                      </div>
                    </>
                  ) : null}

                  {/* Editor */}
                  {isEditing && (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={2}
                        className="w-full border rounded p-2"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            saveEdit(m);
                          }}
                          className="px-2 py-1 border rounded bg-blue-600 text-white text-xs"
                        >
                          Save
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelEdit();
                          }}
                          className="px-2 py-1 border rounded text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3-dots trigger */}
                <button
                  className="absolute -bottom-2 -right-1 h-8 w-8 place-items-center text-black opacity-70 hover:opacity-100 cursor-pointer"
                  onClick={(e) => openMenu(e, m)}
                  title="Message actions"
                >
                  ⋯
                </button>
              </div>
            );
          })}
        <div ref={bottomRef} />
      </div>

      {/* Floating actions menu */}
      {menuOpen && selectedMsg && menuAnchor && (
        <FloatingMenu anchor={menuAnchor} onClose={closeMenu}>
          <button onClick={() => toggleStar(selectedMsg)} className="block w-full text-left hover:bg-gray-100 px-3 py-2">
            {(selectedMsg.starredBy || []).includes(user!.uid) ? "Unstar" : "Star"}
          </button>

          <button
            onClick={() => {
              setReplyTo(selectedMsg);
              closeMenu();
            }}
            className="block w-full text-left hover:bg-gray-100 px-3 py-2"
          >
            Reply
          </button>

          {selectedMsg.senderId === user?.uid && selectedMsg.kind !== "live-location" && editingId !== selectedMsg.id && (
            <button onClick={() => startEdit(selectedMsg)} className="block w-full text-left hover:bg-gray-100 px-3 py-2">
              Edit
            </button>
          )}

          {/* Stop live from menu if it's your live message */}
          {selectedMsg.kind === "live-location" &&
            selectedMsg.senderId === user?.uid &&
            selectedMsg.live?.isActive && (
              <button
                onClick={() => {
                  stopLiveSharing("menu-stop");
                }}
                className="block w-full text-left hover:bg-gray-100 px-3 py-2"
              >
                Stop live location
              </button>
            )}

          <button onClick={() => deleteForMe(selectedMsg)} className="block w-full text-left hover:bg-gray-100 px-3 py-2">
            Delete for me
          </button>

          {selectedMsg.senderId === user?.uid && (
            <button
              onClick={() => deleteForEveryone(selectedMsg)}
              className="block w-full text-left hover:bg-gray-100 px-3 py-2 text-red-600"
            >
              Delete for everyone
            </button>
          )}
        </FloatingMenu>
      )}

      {/* Reply banner */}
      {replyTo && (
        <div className="px-3 py-2 border-t bg-yellow-50 text-[12px] flex items-center justify-between gap-3">
          <div className="truncate">
            Replying to: <span className="italic">“{replyTo.text?.slice(0, 140)}”</span>
          </div>
          <button className="underline" onClick={() => setReplyTo(null)}>
            Cancel
          </button>
        </div>
      )}

      {/* Video Overlay */}
      {showVideo && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50">
          <VideoCallOverlay convoId={convoId} onClose={() => setShowVideo(false)} />
        </div>
      )}

      {/* Composer */}
      <div className="p-3 border-t flex gap-2 items-end">
        {/* Attach */}
        <button
          type="button"
          onClick={pickFile}
          className="border px-3 py-2 rounded cursor-pointer"
          title="Attach a file"
        >
          <img src="./attachment-svgrepo-com.svg" className="w-6" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip"
          className="hidden"
          onChange={handleAttachChange}
        />

        {/* 🧭 Location button + menu */}
        <div className="relative">
          <button
            ref={locBtnRef}
            type="button"
            className="border px-3 py-2 rounded cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setLocMenuOpen((v) => !v);
            }}
            title="Share location"
          >
            📍 Location
          </button>
          {locMenuOpen && (
            <div
              className="absolute left-0 bottom-[50px] mt-2 bg-white border rounded shadow z-20 w-44"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="block w-full text-left px-3 py-2 hover:bg-gray-100 cursor-pointer" 
                onClick={sendCurrentLocation}
              >
                Send current location
              </button>
              <div className="px-3 pt-2 pb-1 text-[14px] text-white bg-black">Share live location for</div>
              <button
                className="block w-full text-left px-3 py-2 hover:bg-gray-100 cursor-pointer"
                onClick={() => startLiveLocation(10)}
              >
                10 minutes
              </button>
              <button
                className="block w-full text-left px-3 py-2 hover:bg-gray-100 cursor-pointer"
                onClick={() => startLiveLocation(20)}
              >
                20 minutes
              </button>
              <button
                className="block w-full text-left px-3 py-2 hover:bg-gray-100 cursor-pointer"
                onClick={() => startLiveLocation(30)}
              >
                30 minutes
              </button>
            </div>
          )}
        </div>

        <textarea
          className="flex-1 border p-2 rounded resize-none"
          rows={1}
          placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          onClick={closeMenu}
        />
        <button
          className="border px-4 py-2 rounded disabled:opacity-50 cursor-pointer"
          onClick={send}
          disabled={sending || !text.trim()}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
