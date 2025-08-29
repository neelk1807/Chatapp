/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  getDoc,
  deleteField,
} from "firebase/firestore";
import { db } from "../app/lib/firebase";
import { useAuth } from "./AuthProvider";
import VideoCallOverlay from "@/component/VideoCallOverlay";

/* Emoji picker (Google style) */
import dynamic from "next/dynamic";
import type { EmojiClickData } from "emoji-picker-react";
import { EmojiStyle, Theme } from "emoji-picker-react";
const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });

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
  startedAt?: any;
  expiresAt?: any;
  endedAt?: any | null;
};

type Msg = {
  id: string;
  text: string;
  senderId: string;
  createdAt?: any;
  editedAt?: any;
  readBy?: string[];
  deliveredTo?: string[];
  replyToId?: string | null;
  replyPreview?: { text: string; senderId: string } | null;
  starredBy?: string[];
  deletedFor?: string[];
  attachment?: Attachment | null;

  kind?: "text" | "location" | "live-location";
  location?: GeoPointLite | null;
  live?: LiveMeta | null;

  //  Pinned
  pinnedAt?: any | null;
  pinnedBy?: string | null;
};

type UserLite = {
  uid: string;
  displayName?: string;
  photoURL?: string;
  about?: string;

  //  Presence
  online?: boolean;
  lastSeen?: any;
};

type ConvoMeta = {
  members: string[];
  mutedBy?: string[];
  lastMessage?: any;
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

/* -------------- Peer Profile side panel ----------- */
function PeerPanel({
  peer,
  isMuted,
  iBlockedThem,
  amBlocked,
  onClose,
  onToggleMute,
  onToggleBlock,
}: {
  peer: UserLite | null;
  isMuted: boolean;
  iBlockedThem: boolean;
  amBlocked: boolean;
  onClose: () => void;
  onToggleMute: () => void;
  onToggleBlock: () => void;
}) {
  const lastSeenText = useMemo(() => {
    if (peer?.online) return "Online";
    if (!peer?.lastSeen?.toMillis) return "Last seen: unknown";
    const ms = Date.now() - peer.lastSeen.toMillis();
    const m = Math.max(0, Math.floor(ms / 60000));
    if (m < 1) return "Last seen: just now";
    if (m < 60) return `Last seen: ${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `Last seen: ${h} hr ago`;
    const d = Math.floor(h / 24);
    return `Last seen: ${d} day${d > 1 ? "s" : ""} ago`;
  }, [peer?.online, peer?.lastSeen]);

  return (
    <div className="absolute inset-0 bg-white/95 backdrop-blur border-l z-40">
      <div className="p-3 flex items-center justify-between border-b">
        <div className="font-semibold">Profile</div>
        <button className="text-sm   cursor-pointer" onClick={onClose}>
          🗙
        </button>
      </div>

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={
              peer?.photoURL ||
              "https://ui-avatars.com/api/?name=" +
                encodeURIComponent(peer?.displayName || "User")
            }
            alt=""
            className="w-16 h-16 rounded-full border object-cover"
          />
          <div>
            <div className="text-xl font-semibold">
              {peer?.displayName || "Unknown"}
            </div>
            <div
              className={`text-xs ${
                peer?.online ? "text-green-700" : "text-gray-500"
              }`}
            >
              {lastSeenText}
            </div>
            {peer?.uid && (
              <div className="text-[11px] text-gray-400 mt-1">
                UID: {peer.uid}
              </div>
            )}
          </div>
        </div>

        {peer?.about && (
          <div className="text-sm text-gray-700">
            <span className="font-medium">About: </span>
            {peer.about}
          </div>
        )}

        <div className="pt-2 border-t space-y-2">
          <button
            className="w-full border px-3 py-2 rounded hover:bg-gray-50 text-left cursor-pointer"
            onClick={onToggleMute}
          >
            {isMuted ? "Unmute conversation" : "Mute conversation"}
          </button>

          <button
            className={`w-full border px-3 py-2 rounded cursor-pointer text-left ${
              iBlockedThem ? "text-red-700" : ""
            }`}
            onClick={onToggleBlock}
          >
            {iBlockedThem ? "Unblock user" : "Block user"}
          </button>

          {amBlocked && (
            <div className="text-xs text-red-600">
              This user has blocked you. You won’t be able to send messages.
            </div>
          )}
        </div>
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

  // Attachment
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickFile = () => fileInputRef.current?.click();

  // Location menu
  const [locMenuOpen, setLocMenuOpen] = useState(false);

  // Convo + peer
  const [convo, setConvo] = useState<ConvoMeta | null>(null);
  const [peer, setPeer] = useState<UserLite | null>(null);
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerLastSeen, setPeerLastSeen] = useState<any>(null);
  const [showPeerPanel, setShowPeerPanel] = useState(false);

  // Block / mute
  const [isMuted, setIsMuted] = useState(false);
  const [iBlockedThem, setIBlockedThem] = useState(false);
  const [amBlocked, setAmBlocked] = useState(false);

  // Live location refs
  const liveWatchIdRef = useRef<number | null>(null);
  const liveMsgIdRef = useRef<string | null>(null);
  const liveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Refs to scroll to pinned
  const msgRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Emoji picker state (composer)
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<DOMRect | null>(null);

  // Emoji picker state (edit bubble)
  const [editEmojiForId, setEditEmojiForId] = useState<string | null>(null);
  const [editEmojiAnchor, setEditEmojiAnchor] = useState<DOMRect | null>(null);

  const isImage = (ct?: string) => !!ct && ct.startsWith("image/");
  const isVideo = (ct?: string) => !!ct && ct.startsWith("video/");
  const mapEmbed = (p: GeoPointLite, z = 15) =>
    `https://maps.google.com/maps?q=${p.lat},${p.lng}&z=${z}&output=embed`;
  const mapsLink = (p: GeoPointLite) =>
    `https://maps.google.com/?q=${p.lat},${p.lng}`;
  const nowMs = () => Date.now();

  /* -------------------- Call watcher ------------------- */
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

  /* -------------------- Conversation + peer ----------------------- */
  useEffect(() => {
    if (!user) return;
    const convoRef = doc(db, "conversations", convoId);
    let unsubPeer: (() => void) | null = null;
    let unsubIBlocked: (() => void) | null = null;
    let unsubAmBlocked: (() => void) | null = null;

    const unsubConvo = onSnapshot(convoRef, async (snap) => {
      const data = (snap.data() as ConvoMeta) || null;
      setConvo(data);

      const mutedBy = data?.mutedBy || [];
      setIsMuted(!!user && mutedBy.includes(user.uid));

      const other = (data?.members || []).find((m) => m !== user.uid) || null;
      if (!other) {
        setPeer(null);
        setPeerOnline(false);
        setPeerLastSeen(null);
        unsubPeer?.();
        unsubIBlocked?.();
        unsubAmBlocked?.();
        return;
      }

      // Peer profile + presence
      unsubPeer?.();
      unsubPeer = onSnapshot(doc(db, "users", other), (s) => {
        const u = s.data() || {};
        setPeer({
          uid: other,
          displayName: (u as any).displayName,
          photoURL: (u as any).photoURL,
          about: (u as any).about,
          online: (u as any).online,
          lastSeen: (u as any).lastSeen,
        });
        setPeerOnline(!!(u as any).online);
        setPeerLastSeen((u as any).lastSeen);
      });

      // I blocked them?
      unsubIBlocked?.();
      unsubIBlocked = onSnapshot(
        doc(db, "users", user.uid, "blocks", other),
        (s) => {
          setIBlockedThem(s.exists());
        }
      );

      // They blocked me?
      unsubAmBlocked?.();
      unsubAmBlocked = onSnapshot(
        doc(db, "users", other, "blocks", user.uid),
        (s) => {
          setAmBlocked(s.exists());
        }
      );
    });

    return () => {
      unsubConvo();
      unsubPeer?.();
      unsubIBlocked?.();
      unsubAmBlocked?.();
    };
  }, [convoId, user?.uid]);

  /* ------------------------ Messages listener ---------------------- */
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

  // Close menu on outside click
  useEffect(() => {
    const handler = () => {
      setMenuOpen(null);
      setEmojiOpen(false);
      setEditEmojiForId(null);
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  // live sharing on unmount / convo switch
  useEffect(() => {
    return () => {
      void stopLiveSharing("component-unmount");
    };
  }, [convoId]);

  /* ------------------- Attach (upload to Blob) --------------------- */
  const handleAttachChange: React.ChangeEventHandler<HTMLInputElement> = (
    e
  ) => {
    const input = e.currentTarget;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;
    void uploadAndSend(file);
  };

  const blockedBanner = iBlockedThem
    ? `You blocked ${peer?.displayName || "this user"}. Unblock to chat.`
    : amBlocked
    ? `${
        peer?.displayName || "This user"
      } has blocked you. You can’t send messages.`
    : "";

  const guardBlocked = (): boolean => {
    if (iBlockedThem) {
      alert("You blocked this user. Unblock to send messages.");
      return true;
    }
    if (amBlocked) {
      alert("This user has blocked you. You can’t send messages.");
      return true;
    }
    return false;
  };

  const uploadAndSend = async (file: File) => {
    if (!user) return;
    if (guardBlocked()) return;

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
        deliveredTo: [user.uid],
        replyToId: replyTo?.id ?? null,
        replyPreview: replyTo
          ? {
              text: replyTo.text?.slice(0, 140) ?? "",
              senderId: replyTo.senderId,
            }
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
        pinnedAt: null,
        pinnedBy: null,
      });

      setText("");
      setReplyTo(null);

      await updateDoc(doc(db, "conversations", convoId), {
        updatedAt: serverTimestamp(),
        lastMessage: {
          text: uploaded.name,
          by: user.uid,
          at: serverTimestamp(),
        },
      });
    } catch (e: any) {
      alert("Failed to send attachment: " + (e?.message || e));
    } finally {
      setSending(false);
    }
  };

  /* ------------------- Text send / edit / star --------------------- */
  const send = async () => {
    if (!user || !text.trim() || sending) return;
    if (guardBlocked()) return;

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
          ? {
              text: replyTo.text?.slice(0, 140) ?? "",
              senderId: replyTo.senderId,
            }
          : null,
        starredBy: [],
        deletedFor: [],
        attachment: null,
        pinnedAt: null,
        pinnedBy: null,
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
      m.senderId === user.uid &&
      m.createdAt?.toMillis &&
      Date.now() - m.createdAt.toMillis() <= 30_000;
    if (!canEdit) {
      alert("You can edit only your own message within 30 seconds.");
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

  /* ---------------------- Pin / Unpin ------------------- */
  const togglePin = async (m: Msg) => {
    if (!user) return;
    const ref = doc(db, "conversations", convoId, "messages", m.id);
    try {
      if (m.pinnedAt) {
        await updateDoc(ref, {
          pinnedAt: deleteField(),
          pinnedBy: deleteField(),
        } as any);
      } else {
        await updateDoc(ref, {
          pinnedAt: serverTimestamp(),
          pinnedBy: user.uid,
        });
      }
    } catch (e: any) {
      alert("Failed to toggle pin: " + (e?.message || e));
    } finally {
      closeMenu();
    }
  };

  const pinnedMsgs = useMemo(() => msgs.filter((m) => !!m.pinnedAt), [msgs]);

  /* ---------------------- Delete for me/everyone ------------------- */
  const deleteForMe = async (m: Msg) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, "conversations", convoId, "messages", m.id), {
        deletedFor: arrayUnion(user.uid),
      });
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
    } catch (e: any) {
      alert("Failed to delete for everyone: " + (e.code || e.message || e));
    } finally {
      closeMenu();
    }
  };

  /* ------------------------- Clear chat ---------------------------- */
  const clearChat = async () => {
    if (
      !confirm(
        "Clear all messages in this conversation? (Starred messages will be kept)"
      )
    )
      return;
    setClearing(true);
    try {
      const messagesCol = collection(db, "conversations", convoId, "messages");
      let last: any = null;
      while (true) {
        let qy = query(messagesCol, orderBy("createdAt"), limit(400));
        if (last)
          qy = query(
            messagesCol,
            orderBy("createdAt"),
            startAfter(last),
            limit(400)
          );
        const snap = await getDocs(qy);
        if (snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach((d) => {
          const data = d.data() as Msg;
          if ((data.starredBy || []).length === 0) batch.delete(d.ref);
        });
        await batch.commit();
        last = snap.docs[snap.docs.length - 1];
      }
      await updateDoc(doc(db, "conversations", convoId), {
        updatedAt: serverTimestamp(),
      });
      alert("Chat cleared (starred messages kept).");
    } catch (e: any) {
      alert("Failed to clear chat: " + (e.code || e.message || e));
    } finally {
      setClearing(false);
    }
  };

  /* ---------------------------- Floating menu ---------------------- */
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

  /* ======================= Location features ======================= */
  const ensureGeo = (): Geolocation => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      throw new Error(
        "Location requires HTTPS (or http://localhost). Open the app via HTTPS."
      );
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

  const sendCurrentLocation = async () => {
    if (!user) return;
    if (guardBlocked()) return;

    try {
      const p = await getOnce();
      await addDoc(collection(db, "conversations", convoId, "messages"), {
        kind: "location",
        text: text.trim() || "",
        senderId: user.uid,
        createdAt: serverTimestamp(),
        replyToId: replyTo?.id ?? null,
        replyPreview: replyTo
          ? {
              text: replyTo.text?.slice(0, 140) ?? "",
              senderId: replyTo.senderId,
            }
          : null,
        location: p,
        live: null,
        starredBy: [],
        deletedFor: [],
        attachment: null,
        pinnedAt: null,
        pinnedBy: null,
      });
      setText("");
      setReplyTo(null);
    } catch (e: any) {
      alert(e?.message || "Failed to get location.");
    } finally {
      setLocMenuOpen(false);
    }
  };

  const startLiveLocation = async (minutes: 10 | 20 | 30) => {
    if (!user) return;
    if (guardBlocked()) return;

    try {
      const p = await getOnce();
      const ref = await addDoc(
        collection(db, "conversations", convoId, "messages"),
        {
          kind: "live-location",
          text: text.trim() || "",
          senderId: user.uid,
          createdAt: serverTimestamp(),
          replyToId: replyTo?.id ?? null,
          replyPreview: replyTo
            ? {
                text: replyTo.text?.slice(0, 140) ?? "",
                senderId: replyTo.senderId,
              }
            : null,
          location: p,
          live: {
            isActive: true,
            minutes,
            startedAt: serverTimestamp(),
            expiresAt: serverTimestamp(),
            endedAt: null,
          } as LiveMeta,
          starredBy: [],
          deletedFor: [],
          attachment: null,
          pinnedAt: null,
          pinnedBy: null,
        }
      );

      setText("");
      setReplyTo(null);
      setLocMenuOpen(false);

      liveMsgIdRef.current = ref.id;
      const g = ensureGeo();
      const endAtMs = nowMs() + minutes * 60_000;

      await updateDoc(ref, { "live.expiresAt": new Date(endAtMs) } as any);

      liveWatchIdRef.current = g.watchPosition(
        async (pos) => {
          if (!liveMsgIdRef.current) return;
          try {
            await updateDoc(
              doc(
                db,
                "conversations",
                convoId,
                "messages",
                liveMsgIdRef.current
              ),
              {
                location: {
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude,
                  accuracy: pos.coords.accuracy,
                },
                updatedAt: serverTimestamp(),
              }
            );
          } catch {}
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 }
      );

      liveTimerRef.current = setTimeout(
        () => stopLiveSharing("auto-expire"),
        endAtMs - nowMs()
      );
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
      if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
      liveWatchIdRef.current = null;
      liveTimerRef.current = null;

      if (liveMsgIdRef.current) {
        try {
          await updateDoc(
            doc(db, "conversations", convoId, "messages", liveMsgIdRef.current),
            {
              "live.isActive": false,
              "live.endedAt": serverTimestamp(),
            } as any
          );
        } catch {}
      }
    } finally {
      liveMsgIdRef.current = null;
    }
  };

  const msLeft = (m: Msg): number => {
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

  /* ------------------------------ Helpers ------------------------------- */
  const otherUid = useMemo(
    () => (convo?.members || []).find((m) => m !== user?.uid) || null,
    [convo?.members, user?.uid]
  );

  const presenceText = useMemo(() => {
    if (peerOnline) return "Online";
    if (!peerLastSeen?.toMillis) return "Last seen: unknown";
    const ms = Date.now() - peerLastSeen.toMillis();
    const m = Math.max(0, Math.floor(ms / 60000));
    if (m < 1) return "Last seen: just now";
    if (m < 60) return `Last seen: ${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `Last seen: ${h} hr ago`;
    const d = Math.floor(h / 24);
    return `Last seen: ${d} day${d > 1 ? "s" : ""} ago`;
  }, [peerOnline, peerLastSeen]);

  /* ------------------------------ UI -------------------------------- */
  const myUid = user?.uid;
  const canType = !(iBlockedThem || amBlocked);

  const toggleMuteConversation = async () => {
    if (!user) return;
    try {
      const ref = doc(db, "conversations", convoId);
      await updateDoc(ref, {
        mutedBy: isMuted ? arrayRemove(user.uid) : arrayUnion(user.uid),
      });
    } catch (e: any) {
      alert("Failed to toggle mute: " + (e?.message || e));
    }
  };

  const toggleBlockUser = async () => {
    if (!user || !peer) return;
    try {
      const ref = doc(db, "users", user.uid, "blocks", peer.uid);
      if (iBlockedThem) {
        await deleteDoc(ref);
      } else {
        await updateDoc(ref, { blocked: true }).catch(async () => {
          // create if missing
          await (
            await import("firebase/firestore")
          ).setDoc(ref, { blocked: true, at: serverTimestamp() });
        });
      }
    } catch (e: any) {
      alert("Failed to toggle block: " + (e?.message || e));
    }
  };

  return (
    <div className="flex flex-col h-full relative" onClick={closeMenu}>
      {/* Header with presence */}
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={
              peer?.photoURL ||
              "https://ui-avatars.com/api/?name=" +
                encodeURIComponent(peer?.displayName || "User")
            }
            alt=""
            className="w-8 h-8 rounded-full border object-cover"
          />
          <div>
            <div className="font-semibold">{peer?.displayName || "Chat"}</div>
            <div
              className={`text-[11px] ${
                peerOnline ? "text-green-700" : "text-gray-500"
              }`}
            >
              {presenceText}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="text-xl   cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setShowPeerPanel(true);
            }}
          >
            👁
          </button>
          <button
            className="border px-3 py-1 rounded bg-green-900 text-white cursor-pointer"
            onClick={() => setShowVideo(true)}
          >
            Video
          </button>
          <button
            className="text-xl disabled:opacity-50 cursor-pointer"
            onClick={clearChat}
            disabled={clearing}
            title="Delete all non-starred messages"
          >
            {clearing ? "Clearing…" : "🗑"}
          </button>
        </div>
      </div>

      {/* Block banners */}
      {(iBlockedThem || amBlocked) && (
        <div className="px-3 py-2 text-xs text-white bg-red-600">
          {blockedBanner}
        </div>
      )}

      {/* Pinned bar */}
      {pinnedMsgs.length > 0 && (
        <div className="px-3 py-2 border-b bg-amber-50 text-[12px] flex items-center gap-2 overflow-x-auto">
          <span className="font-medium">Pinned:</span>
          <div className="flex gap-2">
            {pinnedMsgs.map((pm) => (
              <button
                key={pm.id}
                className="px-2 py-1 rounded bg-white border hover:bg-gray-50 whitespace-nowrap cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  msgRefs.current[pm.id]?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                }}
                title={pm.text || pm.attachment?.name || "Pinned message"}
              >
                {(pm.text && pm.text.slice(0, 40)) ||
                  pm.attachment?.name ||
                  "Pinned"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {msgs
          .filter((m) => (myUid ? !(m.deletedFor || []).includes(myUid) : true))
          .map((m) => {
            const mine = m.senderId === user?.uid;
            const isEditing = editingId === m.id;
            const isStarredByMe =
              !!user && (m.starredBy || []).includes(user.uid);
            const isLive =
              m.kind === "live-location" && m.live?.isActive && msLeft(m) > 0;

            return (
              <div
                key={m.id}
                ref={(el) => {
                  msgRefs.current[m.id] = el;
                }}
                className={`max-w-max ${mine ? "ml-auto" : ""} relative group`}
              >
                <div
                  className={`px-6 py-4 rounded ${
                    mine ? "bg-blue-100" : "bg-gray-100"
                  }`}
                >
                  {/* reply preview */}
                  {m.replyPreview && (
                    <div className="mb-1 text-[11px] px-2 py-1 rounded bg-white/60 border">
                      Replying to{" "}
                      {m.replyPreview.senderId === user?.uid ? "you" : "them"}:
                      “{m.replyPreview.text}”
                    </div>
                  )}

                  {/* location */}
                  {m.kind === "location" && m.location ? (
                    <div className="space-y-1">
                      <iframe
                        className="rounded w-full max-w-md h-44"
                        src={mapEmbed(m.location)}
                        loading="lazy"
                      />
                      <a
                        className="text-blue-600 underline text-sm"
                        target="_blank"
                        rel="noreferrer"
                        href={mapsLink(m.location)}
                      >
                        Open in Maps
                      </a>
                      {m.text && (
                        <div className="whitespace-pre-wrap">{m.text}</div>
                      )}
                    </div>
                  ) : m.kind === "live-location" && m.location ? (
                    <div className="space-y-1">
                      <div
                        className={`text-xs ${
                          isLive ? "text-green-700" : "text-gray-500"
                        }`}
                      >
                        {isLive ? liveBadge(m) : "Live location ended"}
                        {mine && isLive && (
                          <button
                            className="ml-2 underline cursor-pointer"
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
                        className="rounded  w-full max-w-md h-44"
                        src={mapEmbed(m.location)}
                        loading="lazy"
                        key={`${m.location.lat.toFixed(
                          5
                        )}-${m.location.lng.toFixed(5)}`}
                      />
                      <a
                        className="text-blue-600 underline text-sm"
                        target="_blank"
                        rel="noreferrer"
                        href={mapsLink(m.location)}
                      >
                        Open in Maps
                      </a>
                      {m.text && (
                        <div className="whitespace-pre-wrap">{m.text}</div>
                      )}
                    </div>
                  ) : m.attachment ? (
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
                        <video
                          src={m.attachment.url}
                          controls
                          className="max-h-64 rounded"
                        />
                      )}
                      {!isImage(m.attachment.contentType) &&
                        !isVideo(m.attachment.contentType) && (
                          <a
                            href={m.attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 underline text-blue-600"
                          >
                            📎 {m.attachment.name}
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
                        {/* pin indicator */}
                        {m.pinnedAt && (
                          <span className="ml-2 text-amber-700">📌</span>
                        )}
                      </div>
                    </>
                  ) : null}

                  {/* editor */}
                  {isEditing && (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={2}
                        className="w-full border rounded p-2"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex items-center gap-2">
                        {/* 🔹 Emoji button for editor */}
                        <button
                          className="px-2 py-1 border rounded text-xs cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditEmojiForId(m.id);
                            setEditEmojiAnchor(
                              (
                                e.currentTarget as HTMLElement
                              ).getBoundingClientRect()
                            );
                          }}
                          title="Add emoji"
                        >
                          😊
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            saveEdit(m);
                          }}
                          className="px-2 py-1 border rounded bg-blue-600 text-white text-xs cursor-pointer"
                        >
                          Save
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelEdit();
                          }}
                          className="px-2 py-1 border rounded text-xs cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* menu trigger */}
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

      {/* floating menu */}
      {menuOpen && selectedMsg && menuAnchor && (
        <FloatingMenu anchor={menuAnchor} onClose={closeMenu}>
          {/* Star / Unstar */}
          <button
            onClick={() => toggleStar(selectedMsg)}
            className="block w-full text-left hover:bg-gray-100 px-3 py-2 cursor-pointer"
          >
            {(selectedMsg.starredBy || []).includes(user!.uid)
              ? "Unstar"
              : "Star"}
          </button>
          {/* Pin / Unpin */}
          <button
            onClick={() => togglePin(selectedMsg)}
            className="block w-full text-left hover:bg-gray-100 px-3 py-2 cursor-pointer"
          >
            {selectedMsg.pinnedAt ? "Unpin" : "Pin"}
          </button>

          <button
            onClick={() => {
              setReplyTo(selectedMsg);
              closeMenu();
            }}
            className="block w-full text-left hover:bg-gray-100 px-3 py-2 cursor-pointer"
          >
            Reply
          </button>

          {selectedMsg.senderId === user?.uid &&
            selectedMsg.kind !== "live-location" &&
            editingId !== selectedMsg.id && (
              <button
                onClick={() => startEdit(selectedMsg)}
                className="block w-full text-left hover:bg-gray-100 px-3 py-2 cursor-pointer"
              >
                Edit
              </button>
            )}

          <button
            onClick={() => deleteForMe(selectedMsg)}
            className="block w-full text-left hover:bg-gray-100 px-3 py-2 cursor-pointer"
          >
            Delete for me
          </button>

          {selectedMsg.senderId === user?.uid && (
            <button
              onClick={() => deleteForEveryone(selectedMsg)}
              className="block w-full text-left hover:bg-gray-100 px-3 py-2 text-red-600 cursor-pointer"
            >
              Delete for everyone
            </button>
          )}
        </FloatingMenu>
      )}

      {/* 🔹 Emoji picker for the editor bubble */}
      {editEmojiForId && editEmojiAnchor && (
        <FloatingMenu
          anchor={editEmojiAnchor}
          width={330}
          onClose={() => setEditEmojiForId(null)}
        >
          <div className="p-1" onClick={(e) => e.stopPropagation()}>
            <EmojiPicker
              onEmojiClick={(data: EmojiClickData) => {
                setEditText((t) => t + data.emoji);
              }}
              emojiStyle={EmojiStyle.GOOGLE}
              theme={Theme.AUTO}
              lazyLoadEmojis
              height={360}
            />
          </div>
        </FloatingMenu>
      )}

      {/* Reply banner */}
      {replyTo && (
        <div className="px-3 py-2 border-t bg-yellow-50 text-[12px] flex items-center justify-between gap-3">
          <div className="truncate">
            Replying to:{" "}
            <span className="italic">“{replyTo.text?.slice(0, 140)}”</span>
          </div>
          <button
            className="underline cursor-pointer"
            onClick={() => setReplyTo(null)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Peer side panel */}
      {showPeerPanel && (
        <PeerPanel
          peer={peer}
          isMuted={isMuted}
          iBlockedThem={iBlockedThem}
          amBlocked={amBlocked}
          onClose={() => setShowPeerPanel(false)}
          onToggleMute={toggleMuteConversation}
          onToggleBlock={toggleBlockUser}
        />
      )}

      {/* Video Overlay */}
      {showVideo && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50">
          <VideoCallOverlay
            convoId={convoId}
            onClose={() => setShowVideo(false)}
          />
        </div>
      )}

      {/* Composer */}
      <div className="p-3 border-t flex gap-2 items-end">
        <button
          type="button"
          onClick={pickFile}
          className="border px-3 py-2 rounded cursor-pointer disabled:opacity-50"
          title="Attach a file"
          disabled={!canType}
        >
          <img
            src="./attachment-svgrepo-com.svg"
            className="w-12 md:w-7 sm:w-9"
          />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip"
          className="hidden"
          onChange={handleAttachChange}
        />

        {/* Location button + menu */}
        <div className="relative">
          <button
            type="button"
            className="border px-3 py-2 rounded cursor-pointer disabled:opacity-50"
            onClick={(e) => {
              e.stopPropagation();
              if (canType) setLocMenuOpen((v) => !v);
            }}
            title="Share location"
            disabled={!canType}
          >
            📍
          </button>
          {locMenuOpen && canType && (
            <div
              className="absolute left-0 bottom-[50px] mt-2 bg-white rounded shadow z-20 w-44"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="block w-full text-left px-3 py-2 hover:bg-gray-100 cursor-pointer"
                onClick={sendCurrentLocation}
              >
                Send current location
              </button>
              <div className="px-3 pt-2 pb-1 text-[14px] text-white bg-black">
                Share live location for
              </div>
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

        <div className="message border w-full flex rounded">
          <textarea
            className="flex-1 w-full p-2  resize-none disabled:opacity-50"
            rows={1}
            placeholder="Type a message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (!canType) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={!canType}
            onClick={closeMenu}
          />
          {/* 🔹 Emoji button for composer */}
          <button
            type="button"
            ref={emojiBtnRef}
            className=" px-3 py-2 rounded cursor-pointer disabled:opacity-50 "
            onClick={(e) => {
              e.stopPropagation();
              if (!canType) return;
              setEmojiAnchor(
                (e.currentTarget as HTMLElement).getBoundingClientRect()
              );
              setEmojiOpen((v) => !v);
            }}
            title="Add emoji"
            disabled={!canType}
          >
            😊
          </button>

          {/* Emoji picker popover (composer) */}
          {emojiOpen && emojiAnchor && (
            <FloatingMenu
              anchor={emojiAnchor}
              width={330}
              onClose={() => setEmojiOpen(false)}
            >
              <div className="p-1" onClick={(e) => e.stopPropagation()}>
                <EmojiPicker
                  onEmojiClick={(data: EmojiClickData) => {
                    setText((t) => t + data.emoji);
                  }}
                  emojiStyle={EmojiStyle.GOOGLE}
                  theme={Theme.AUTO}
                  lazyLoadEmojis
                  height={360}
                />
              </div>
            </FloatingMenu>
          )}
        </div>
        <button
          className="border px-4 py-2 rounded disabled:opacity-50 cursor-pointer"
          onClick={send}
          disabled={sending || !text.trim() || !canType}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
