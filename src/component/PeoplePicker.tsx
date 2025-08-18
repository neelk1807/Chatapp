"use client";
import { useEffect, useState } from "react";
import { db } from "../app/lib/firebase";
import { collection, getDocs, addDoc, serverTimestamp, query, where } from "firebase/firestore";
import { useAuth } from "./AuthProvider";

export default function PeoplePicker({ onOpen }: { onOpen: (id: string)=>void }) {
  const { user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "users"));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setAllUsers(list.filter(u => u.uid !== user?.uid)); // exclude me
      setLoading(false);
    })();
  }, [user]);

  const startChat = async (otherUid: string) => {
    if (!user) return;
    // Check if a conversation already exists (simple client-side check)
    // In production, consider a deterministic id or a cloud function.
    const existingQ = query(collection(db, "conversations"),
      where("members", "array-contains", user.uid));
    const existingSnap = await getDocs(existingQ);
    const existing = existingSnap.docs.find(d => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (d.data() as any).members || [];
      return m.length === 2 && m.includes(otherUid);
    });
    if (existing) {
      onOpen(existing.id);
      return;
    }

    const docRef = await addDoc(collection(db, "conversations"), {
      members: [user.uid, otherUid],
      updatedAt: serverTimestamp(),
      lastMessage: null,
    });
    onOpen(docRef.id);
  };

  if (loading) return <div className="p-2 text-sm">Loading people…</div>;

  return (
    <div className="p-2 space-y-2">
      <div className="text-sm font-semibold">Start new chat</div>
      <ul className="space-y-1 max-h-48 overflow-y-auto">
        {allUsers.map(u => (
          <li key={u.uid}>
            <button
              className="w-full text-left p-2 hover:bg-gray-100 rounded flex items-center gap-2 cursor-pointer"
              onClick={() => startChat(u.uid)}
              title={u.email || u.phoneNumber}
            >
              <img src={u.photoURL || "/avatar.png"} className="size-6 rounded-full object-cover" />
              <span className="truncate">{u.displayName || u.phoneNumber || u.email || u.uid}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
