import { NextResponse } from "next/server";
import { del } from "@vercel/blob";

export const runtime = "edge";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing BLOB_READ_WRITE_TOKEN" },
        { status: 500 }
      );
    }
    const { pathname } = await req.json();
    if (!pathname) return NextResponse.json({ ok: false, error: "No pathname" }, { status: 400 });

    await del(pathname, { token }); // 👈 pass token explicitly
    return NextResponse.json({ ok: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("blob-delete error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
