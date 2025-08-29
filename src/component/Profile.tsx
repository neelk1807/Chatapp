"use client";
import { useEffect, useRef, useState } from "react";
import { auth, db } from "@/app/lib/firebase";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { useAuth } from "./AuthProvider";
import Avatar from "./Avatar";

type UserDoc = {
  displayName?: string | null;
  photoURL?: string | null;
  photoPathname?: string | null;
  updatedAt?: unknown;
};

export default function Profile() {
  const { user } = useAuth();
  const [me, setMe] = useState<UserDoc | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    const ref = doc(db, "users", user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      const data = (snap.data() as UserDoc) || null;
      setMe(data);
      setName(data?.displayName || user.displayName || "");
    });
    return () => unsub();
  }, [user?.uid]);

  const pickPhoto = () => fileRef.current?.click();

  const onPhotoChange: React.ChangeEventHandler<HTMLInputElement> = async (
    e
  ) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ""; // reset input
    if (!file || !user) return;

    try {
      // Validate basic image size/type if you want
      if (!file.type.startsWith("image/")) {
        alert("Please choose an image file.");
        return;
      }

      const fd = new FormData();
      fd.append("file", file);
      fd.append("convoId", "avatar"); // not required; just reusing your route

      const res = await fetch("/api/blob-upload", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
      }
      const uploaded = await res.json(); // { url, pathname, name, size, contentType }

      // Remove old photo from blob (optional)
      if (me?.photoPathname) {
        try {
          await fetch("/api/blob-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pathname: me.photoPathname }),
          });
        } catch {
          /* ignore */
        }
      }

      // Save to Firestore
      const uref = doc(db, "users", user.uid);
      await setDoc(
        uref,
        {
          displayName: name || user.displayName || null,
          photoURL: uploaded.url,
          photoPathname: uploaded.pathname,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // Also update Firebase Auth profile (handy for other SDKs)
      await updateProfile(auth.currentUser!, { photoURL: uploaded.url });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      alert(`Failed to upload avatar: ${err.message || err}`);
    }
  };

  const removePhoto = async () => {
    if (!user) return;
    try {
      if (me?.photoPathname) {
        await fetch("/api/blob-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pathname: me.photoPathname }),
        });
      }
    } catch {
      /* ignore */
    }

    try {
      const uref = doc(db, "users", user.uid);
      await updateDoc(uref, {
        photoURL: null,
        photoPathname: null,
        updatedAt: serverTimestamp(),
      });
      await updateProfile(auth.currentUser!, { photoURL: "" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      alert(`Failed to remove photo: ${err.message || err}`);
    }
  };

  const saveName = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const uref = doc(db, "users", user.uid);
      await setDoc(
        uref,
        { displayName: name || null, updatedAt: serverTimestamp() },
        { merge: true }
      );
      await updateProfile(auth.currentUser!, { displayName: name || "" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      alert(`Failed to save profile: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-4 max-w-xl">
      <div className="flex items-center gap-4">
        <Avatar
          src={me?.photoURL || user?.photoURL || null}
          name={me?.displayName || user?.displayName || user?.email || "You"}
          size={72}
        />
        <div className="flex gap-2">
          <button onClick={pickPhoto} className="border px-3 py-1 rounded">
            Change photo
          </button>
          {(me?.photoURL || user?.photoURL) && (
            <button onClick={removePhoto} className="border px-3 py-1 rounded">
              Remove
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          className="hidden"
          type="file"
          accept="image/*"
          onChange={onPhotoChange}
        />
      </div>

      <label className="block">
        <div className="text-sm text-gray-600 mb-1">Display name</div>
        <input
          className="border rounded px-3 py-2 w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
        />
      </label>

      <button
        onClick={saveName}
        disabled={saving}
        className="border px-4 py-2 rounded"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
