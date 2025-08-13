"use client";
import { useState } from "react";
import { auth, db, storage } from "../app/lib/firebase";
import { updateProfile, updateEmail } from "firebase/auth";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export default function Profile() {
  const user = auth.currentUser!;
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [email, setEmail] = useState(user.email || "");
  const [file, setFile] = useState<File | null>(null);

  const save = async () => {
    let photoURL = user.photoURL || "";
    if (file) {
      const r = ref(storage, `avatars/${user.uid}.jpg`);
      await uploadBytes(r, file);
      photoURL = await getDownloadURL(r);
    }
    // Auth profile
    await updateProfile(user, { displayName, photoURL });
    if (email && email !== user.email) {
      // May require recent login for sensitive change
      await updateEmail(user, email);
    }
    // Mirror to Firestore
    await updateDoc(doc(db, "users", user.uid), {
      displayName, photoURL, email,
      updatedAt: serverTimestamp()
    });
    alert("Profile updated");
  };

  return (
    <div className="p-4 space-y-3">
      <img src={user.photoURL || "/avatar.png"} alt="" className="size-16 rounded-full object-cover" />
      <input className="border p-2 w-full rounded" value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Your name" />
      <input className="border p-2 w-full rounded" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" />
      <input type="file" accept="image/*" onChange={e=>setFile(e.target.files?.[0] || null)} />
      <button className="border px-4 py-2 rounded" onClick={save}>Save</button>
    </div>
  );
}
