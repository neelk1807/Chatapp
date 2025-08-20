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
    // ✅ Window won’t scroll; only inner panes can
    <main className="h-dvh grid grid-cols-[320px_1fr] overflow-hidden">
      {/* Sidebar */}
      <aside className="border-r flex flex-col min-h-0">
        <div className="p-3 flex items-center justify-between border-b">
          <div className="font-bold">Chats</div>
          <button
            className="text-sm underline"
            onClick={() => setShowProfile((v) => !v)}
          >
            Profile
          </button>
        </div>

        {/* ✅ Make the list area the scroller */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <PeoplePicker onOpen={(id) => setOpenConvo(id)} />
          <Conversations onOpen={(id) => setOpenConvo(id)} />
        </div>

        <div className="p-3 border-t">
          <button className="text-sm underline" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Chat column */}
      {/* ✅ Allow child (ChatWindow) to control scrolling */}
      <section className="relative min-h-0 overflow-hidden">
        {openConvo ? (
          <ChatWindow convoId={openConvo} />
        ) : (
          <div className="h-full grid place-items-center text-gray-500">
            Select a conversation
          </div>
        )}

        {/* Profile overlay (scrolls inside if needed) */}
        {showProfile && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur border-l flex flex-col">
            <div className="p-3 flex items-center justify-between border-b">
              <div className="font-semibold">Your Profile</div>
              <button
                className="text-sm underline"
                onClick={() => setShowProfile(false)}
              >
                Close
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Profile />
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
