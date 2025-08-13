"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../app/lib/firebase";
import { useAuth } from "../component/AuthProvider";
import Conversations from "@/component/Conversations";
import ChatWindow from "@/component/ChatWindow";
import PeoplePicker from "@/component/PeoplePicker";
import Profile from "@/component/Profile";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [openConvo, setOpenConvo] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);
  if (loading || !user) return <div className="p-6">Loading…</div>;

  return (
    <main className="h-screen grid grid-cols-[320px_1fr]">
      <aside className="border-r flex flex-col">
        <div className="p-3 flex items-center justify-between border-b">
          <div className="font-bold">Chats</div>
          <button
            className="text-sm underline"
            onClick={() => setShowProfile((v) => !v)}
          >
            Profile
          </button>
        </div>
        <PeoplePicker onOpen={(id) => setOpenConvo(id)} />
        <Conversations onOpen={(id) => setOpenConvo(id)} />
        <div className="mt-auto p-3">
          <button className="text-sm underline" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>
      </aside>
      <section className="relative">
        {openConvo ? (
          <ChatWindow convoId={openConvo} />
        ) : (
          <div className="h-full grid place-items-center text-gray-500">
            Select a conversation
          </div>
        )}

        {/* Profile panel overlays chat; "back side" you still see conversation list */}
        {showProfile && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur border-l">
            <div className="p-3 flex items-center justify-between border-b">
              <div className="font-semibold">Your Profile</div>
              <button
                className="text-sm underline"
                onClick={() => setShowProfile(false)}
              >
                Close
              </button>
            </div>
            <Profile />
          </div>
        )}
      </section>
    </main>
  );
}
