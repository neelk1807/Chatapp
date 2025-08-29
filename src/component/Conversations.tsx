"use client";
import { useEffect, useMemo, useState } from "react";
import { db } from "../app/lib/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useAuth } from "./AuthProvider";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Conversation = {
  id: string;
  members: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updatedAt?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lastMessage?: any;
};

export default function Conversations({
  onOpen,
}: {
  onOpen: (id: string) => void;
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<Conversation[]>([]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "conversations"),
      where("members", "array-contains", user.uid),
      orderBy("updatedAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, [user]);

  const startChat = async (otherUid: string) => {
    if (!user || otherUid === user.uid) return;
    const docRef = await addDoc(collection(db, "conversations"), {
      members: [user.uid, otherUid],
      updatedAt: serverTimestamp(),
      lastMessage: null,
    });
    onOpen(docRef.id);
  };

  return (
    <div className="p-3 space-y-2">
      <div className="font-semibold">Conversations</div>
      <ul className="space-y-1">
        {items.map((c) => (
          <li key={c.id}>
            <button
              className="w-full text-left p-2 hover:bg-gray-100 rounded cursor-pointer"
              onClick={() => onOpen(c.id)}
            >
              {c.lastMessage?.text ? c.lastMessage.text : "New chat"}{" "}
              <span className="opacity-60">· {c.members.length} members</span>
            </button>
          </li>
        ))}
      </ul>
      {/* Example: quick start chat with a known uid */}
      {/* <button onClick={()=>startChat("OTHER_UID_HERE")} className="btn">Start Chat</button> */}
    </div>
  );
}
