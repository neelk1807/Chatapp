"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "../lib/firebase";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");      // e.g. +919900112233
  const [code, setCode] = useState("");        // e.g. 123456 (your TEST code)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [confirmRes, setConfirmRes] = useState<any>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const recaptchaDiv = useRef<HTMLDivElement>(null);

  // Init invisible reCAPTCHA exactly once
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(window as any).recaptchaVerifier && recaptchaDiv.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).recaptchaVerifier = new RecaptchaVerifier(
        auth,
        recaptchaDiv.current,
        { size: "invisible" }
      );
    }
  }, []);

  const sendOTP = async () => {
    setMsg(null);
    setSending(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const appVerifier = (window as any).recaptchaVerifier;
      if (!appVerifier) throw new Error("reCAPTCHA not ready");
      // IMPORTANT: phone must include +country code and must match your test entry
      const res = await signInWithPhoneNumber(auth, phone.trim(), appVerifier);
      setConfirmRes(res);
      setMsg("OTP sent. Enter the code you configured in Firebase → Auth → Phone → Test numbers.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setMsg(`Failed to send OTP: ${e?.message || e}`);
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    setMsg(null);
    setVerifying(true);
    try {
      if (!confirmRes) throw new Error("No OTP session. Click 'Send OTP' first.");
      const cred = await confirmRes.confirm(code.trim()); // throws on wrong code
      const u = cred.user;

      // Ensure user doc exists/updated
      await setDoc(
        doc(db, "users", u.uid),
        {
          uid: u.uid,
          phoneNumber: u.phoneNumber || "",
          displayName: u.displayName || "",
          photoURL: u.photoURL || "",
          email: u.email || "",
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      setMsg("Verified! Redirecting…");
      router.push("/"); // move off /login
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      // common codes: auth/invalid-verification-code, auth/code-expired
      setMsg(`Verification failed: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-sm space-y-3">
        <h1 className="text-2xl font-semibold">Login with OTP</h1>

        <input
          className="input w-full border p-2 rounded"
          placeholder="+91XXXXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <button
          className="btn border p-2 rounded w-full disabled:opacity-50"
          disabled={sending || !phone}
          onClick={sendOTP}
        >
          {sending ? "Sending…" : "Send OTP"}
        </button>

        {confirmRes && (
          <>
            <input
              className="input w-full border p-2 rounded"
              placeholder="Enter OTP code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              className="btn border p-2 rounded w-full disabled:opacity-50"
              disabled={verifying || !code}
              onClick={verify}
            >
              {verifying ? "Verifying…" : "Verify & Continue"}
            </button>
          </>
        )}

        {msg && <p className="text-sm text-gray-700">{msg}</p>}
        <div ref={recaptchaDiv} />
      </div>
    </main>
  );
}
