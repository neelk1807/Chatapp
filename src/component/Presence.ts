// component/presence.ts
import {
  onDisconnect,
  onValue,
  ref,
  serverTimestamp as rtdbServerTime,
  set,
} from "firebase/database";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { rtdb, db } from "@/app/lib/firebase";

/** Call this once after sign-in. Keeps online/lastSeen up to date. */
export function setupPresence(uid: string) {
  const connectedRef = ref(rtdb, ".info/connected");
  const statusRef = ref(rtdb, `status/${uid}`);

  onValue(connectedRef, async (snap) => {
    if (snap.val() === false) return;

    // When we connect, mark online, and schedule offline on disconnect
    try {
      await onDisconnect(statusRef).set({
        state: "offline",
        lastChanged: rtdbServerTime(),
      });

      await set(statusRef, {
        state: "online",
        lastChanged: rtdbServerTime(),
      });

      // Mirror to Firestore for easy reads in UI
      const userRef = doc(db, "users", uid);
      await setDoc(
        userRef,
        {
          online: true,
          lastSeen: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch {}
  });

  // When the RTDB status flips to offline (browser closes), Firestore mirror:
  onValue(statusRef, async (snap) => {
    const v = snap.val();
    if (!v) return;
    try {
      const userRef = doc(db, "users", uid);
      if (v.state === "online") {
        await updateDoc(userRef, { online: true, lastSeen: serverTimestamp() });
      } else {
        await updateDoc(userRef, {
          online: false,
          lastSeen: serverTimestamp(),
        });
      }
    } catch {}
  });
}
