import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "edge";
export const maxDuration = 60;

const SERVER_UPLOAD_LIMIT = 4.5 * 1024 * 1024; 

export async function POST(req: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "Missing BLOB_READ_WRITE_TOKEN env var" },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const convoId = (form.get("convoId") as string) || "general";
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    if (file.size > SERVER_UPLOAD_LIMIT) {
      return NextResponse.json(
        { error: "File > 4.5MB. Switch to client-upload flow." },
        { status: 413 }
      );
    }

    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const key = `chat/${convoId}/${Date.now()}-${safe}`;

    const blob = await put(key, file, {
      access: "public",
      contentType: file.type || "application/octet-stream",
      addRandomSuffix: false,
      token,
    });

    return NextResponse.json({
      url: blob.url,
      pathname: blob.pathname,
      name: file.name,
      size: file.size,
      contentType: file.type,
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("blob-upload error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
