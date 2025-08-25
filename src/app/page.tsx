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

type Pane = "list" | "chat" | "profile";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [openConvo, setOpenConvo] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("list");

  // If you navigate to the page while logged out
  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  if (loading || !user) return <div className="p-6">Loading…</div>;

  // Navigation helpers
  const openChat = (id: string) => {
    setOpenConvo(id);
    setPane("chat");
  };
  const openProfile = () => setPane("profile");
  const backToList = () => setPane("list");
  const closeProfile = () => setPane(openConvo ? "chat" : "list");

  return (
    <main className="h-screen">
      {/* Desktop/tablet: two columns; Mobile: we show one pane at a time */}
      <div className="h-full md:grid md:grid-cols-[320px_1fr]">
        {/* LEFT PANE (list) */}
        <aside
          className={`border-r flex flex-col h-full ${
            pane === "list" ? "block" : "hidden"
          } md:block`}
        >
          <div className="p-3 flex items-center justify-between border-b">
            <div className="font-bold">Chats</div>
            <button className="text-sm underline" onClick={openProfile}>
              Profile
            </button>
          </div>

          {/* New chat & chats */}
          <PeoplePicker onOpen={openChat} />
          <Conversations onOpen={openChat} />

          <div className="mt-auto p-3">
            <button className="text-sm underline" onClick={() => signOut(auth)}>
              Sign out
            </button>
          </div>
        </aside>

        {/* RIGHT PANE (chat) */}
        <section
          className={`relative h-full ${
            pane === "chat" ? "block" : "hidden"
          } md:block`}
        >
          {/* Mobile-only top bar with Back to list */}
          <div className="md:hidden sticky top-0 z-20 bg-white border-b flex items-center justify-between px-3 py-2">
            <button onClick={backToList} className="text-sm underline">
              Back
            </button>
            {/* If your ChatWindow shows the peer name itself, great;
                otherwise this label is a generic fallback */}
            <div className="font-semibold truncate">Chat</div>
            <span className="w-10" />
          </div>

          {openConvo ? (
            <ChatWindow convoId={openConvo} />
          ) : (
            <div className="h-full grid place-items-center text-gray-500">
              Select a conversation
            </div>
          )}

          {/* DESKTOP: Profile overlay (when opened) */}
          {pane === "profile" && (
            <div className="hidden md:block absolute inset-0 bg-white/95 backdrop-blur border-l z-30">
              <div className="p-3 flex items-center justify-between border-b">
                <div className="font-semibold">Your Profile</div>
                <button className="text-sm underline" onClick={closeProfile}>
                  Close
                </button>
              </div>
              <Profile />
            </div>
          )}
        </section>
      </div>

      {/* MOBILE: Fullscreen Profile pane */}
      {pane === "profile" && (
        <div className="md:hidden fixed inset-0 z-30 bg-white">
          <div className="sticky top-0 bg-white border-b flex items-center justify-between px-3 py-2">
            <button onClick={backToList} className="text-sm underline">
              Back
            </button>
            <div className="font-semibold">Your Profile</div>
            <span className="w-10" />
          </div>
          <Profile />
        </div>
      )}
    </main>
  );
}
