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
};

/* ---------------------- Floating menu helper --------------------- */
/** Renders a floating menu next to an anchor rect, auto-flipping left/right. */
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
      // Prefer opening to the right; flip to left if not enough space
      const openRight = anchor.right + MARGIN + width <= window.innerWidth;
      const left = openRight
        ? Math.min(anchor.right + MARGIN, window.innerWidth - width - MARGIN)
        : Math.max(MARGIN, anchor.left - width - MARGIN);

      // Vertical position: try below; clamp to viewport
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

  // Helpers for rendering
  const isImage = (ct?: string) => !!ct && ct.startsWith("image/");
  const isVideo = (ct?: string) => !!ct && ct.startsWith("video/");

  // Auto-open overlay on incoming ringing call
  useEffect(() => {
    if (!convoId || !user) return;
    const callsCol = collection(db, "conversations", convoId, "calls");
    const qy = query(callsCol, where("status", "==", "ringing"));
    const unsub = onSnapshot(qy, (snap) => {
      const inc = snap.docs
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .find((c: any) => c.createdBy !== user.uid);
      if (inc) setShowVideo(true);
    });
    return () => unsub();
  }, [convoId, user?.uid]);

  // Messages listener
  useEffect(() => {
    if (!convoId) return;
    const q = query(
      collection(db, "conversations", convoId, "messages"),
      orderBy("createdAt")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(d.data() as any),
        })) as Msg[];
        setMsgs(rows);
        setTimeout(
          () => bottomRef.current?.scrollIntoView({ behavior: "smooth" }),
          0
        );
      },
      (err) => console.error("messages listener error:", err)
    );
    return () => unsub();
  }, [convoId]);

  // ---------- Attach: upload to Vercel Blob then send message ----------
  const handleAttachChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const input = e.currentTarget;
    const file = input.files?.[0] ?? null;
    input.value = ""; // reset immediately
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
      const uploaded = await res.json(); // { url, pathname, name, size, contentType }

      const caption = text.trim();
      setSending(true);

      await addDoc(collection(db, "conversations", convoId, "messages"), {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      alert("Failed to send attachment: " + (e?.message || e));
    } finally {
      setSending(false);
    }
  };

  // ------------------- Send / Reply / Edit / Star -------------------
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      m.senderId === user.uid &&
      m.createdAt?.toMillis &&
      Date.now() - m.createdAt.toMillis() <= 10_000;

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      alert("Failed to toggle star: " + (e.code || e.message || e));
    } finally {
      closeMenu();
    }
  };

  // ---- Delete options ----
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

  // ------------------- Clear chat (keep starred) -------------------
  const clearChat = async () => {
    if (
      !confirm("Clear all messages in this conversation? (Starred messages will be kept)")
    )
      return;
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

      await updateDoc(doc(db, "conversations", convoId), {
        updatedAt: serverTimestamp(),
      });
      alert("Chat cleared (starred messages kept).");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      alert("Failed to clear chat: " + (e.code || e.message || e));
    } finally {
      setClearing(false);
    }
  };

  /* -------------------------- Render helpers -------------------------- */
  const canEdit = (m: Msg) =>
    m.senderId === user?.uid &&
    m.createdAt?.toMillis &&
    Date.now() - m.createdAt.toMillis() <= 10_000;

  const ReplyPreviewInBubble = ({ m }: { m: Msg }) =>
    m.replyPreview ? (
      <div className="mb-1 text-[11px] px-2 py-1 rounded bg-white/60 border">
        Replying to {m.replyPreview.senderId === user?.uid ? "you" : "them"}: “{m.replyPreview.text}”
      </div>
    ) : null;

  // Floating menu handlers
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

  const myUid = user?.uid;

  /* ------------------------------ UI -------------------------------- */
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

            return (
              <div key={m.id} className={`max-w-max ${mine ? "ml-auto" : ""} relative group`}>
                <div className={`px-6 py-4 rounded ${mine ? "bg-blue-100" : "bg-gray-100"}`}>
                  {/* Reply preview */}
                  <ReplyPreviewInBubble m={m} />

                  {/* Attachment preview */}
                  {m.attachment ? (
                    <div className="space-y-1">
                      {isImage(m.attachment.contentType) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.attachment.url}
                          alt={m.attachment.name}
                          className="max-h-64 rounded"
                          loading="lazy"
                        />
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
                          <img src="fileicon.svg"></img> {m.attachment.name}
                        </a>
                      )}

                      {!isEditing && m.text && (
                        <div className="whitespace-pre-wrap">{m.text}</div>
                      )}
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

      {/* Floating actions menu (single instance) */}
      {menuOpen && selectedMsg && menuAnchor && (
        <FloatingMenu anchor={menuAnchor} onClose={closeMenu}>
          <button
            onClick={() => toggleStar(selectedMsg)}
            className="block w-full text-left hover:bg-gray-100 px-3 py-2"
          >
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

          {selectedMsg.senderId === user?.uid &&
            canEdit(selectedMsg) &&
            editingId !== selectedMsg.id && (
              <button
                onClick={() => startEdit(selectedMsg)}
                className="block w-full text-left hover:bg-gray-100 px-3 py-2"
              >
                Edit
              </button>
            )}

          <button
            onClick={() => deleteForMe(selectedMsg)}
            className="block w-full text-left hover:bg-gray-100 px-3 py-2"
          >
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

      {/* Reply banner in composer */}
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
          <img src="./attachment-svgrepo-com.svg" className="w-7" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip"
          className="hidden"
          onChange={handleAttachChange}
        />

        <textarea
          className="flex-1 border p-2 rounded resize-none"
          rows={2}
          placeholder={
            replyTo
              ? "Write a reply… (Enter to send, Shift+Enter for new line)"
              : "Type a message… (Enter to send, Shift+Enter for new line)"
          }
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
