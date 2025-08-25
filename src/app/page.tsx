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

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  if (loading || !user) return <div className="p-6">Loading…</div>;

  const openChat = (id: string) => {
    setOpenConvo(id);
    setPane("chat");
  };
  const openProfile = () => setPane("profile");
  const backToList = () => setPane("list");
  const closeProfile = () => setPane(openConvo ? "chat" : "list");

  return (
    <main className="h-screen overflow-hidden">
      {/* Desktop/tablet: two columns; Mobile: show one pane at a time */}
      <div className="h-full overflow-hidden md:grid md:grid-cols-[320px_1fr]">
        {/* LEFT PANE (list) */}
        <aside
          className={`border-r h-full flex flex-col overflow-hidden ${
            pane === "list" ? "block" : "hidden"
          } md:block`}
        >
          {/* fixed header */}
          <div className="shrink-0 p-3 flex items-center justify-between border-b">
            <div className="font-bold">Chats</div>
            <button className="text-sm underline" onClick={openProfile}>
              Profile
            </button>
          </div>

          {/* scrollable content (people picker + conversations) */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <PeoplePicker onOpen={openChat} />
            <Conversations onOpen={openChat} />
          </div>

          {/* fixed footer */}
          <div className="shrink-0 p-3 border-t">
            <button className="text-sm underline" onClick={() => signOut(auth)}>
              Sign out
            </button>
          </div>
        </aside>

        {/* RIGHT PANE (chat) – container fixed, ChatWindow handles its own scroll */}
        <section
          className={`relative h-full overflow-hidden ${
            pane === "chat" ? "block" : "hidden"
          } md:block`}
        >
          {/* Mobile-only top bar */}
          <div className="md:hidden sticky top-0 z-20 bg-white border-b flex items-center justify-between px-3 py-2">
            <button onClick={backToList} className="text-sm underline">
              Back
            </button>
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

          {/* DESKTOP profile overlay – fills pane, scrolls internally */}
          {pane === "profile" && (
            <div className="hidden md:flex absolute inset-0 z-30 bg-white">
              <div className="flex flex-col w-full h-full">
                <div className="shrink-0 p-3 flex items-center justify-between border-b">
                  <div className="font-semibold">Your Profile</div>
                  <button className="text-sm underline" onClick={closeProfile}>
                    Close
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <Profile />
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* MOBILE: Fullscreen profile pane – scrolls internally */}
      {pane === "profile" && (
        <div className="md:hidden fixed inset-0 z-30 bg-white">
          <div className="flex flex-col w-full h-full">
            <div className="shrink-0 sticky top-0 bg-white border-b flex items-center justify-between px-3 py-2">
              <button onClick={backToList} className="text-sm underline">
                Back
              </button>
              <div className="font-semibold">Your Profile</div>
              <span className="w-10" />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Profile />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
