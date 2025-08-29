"use client";
import * as React from "react";

export default function Avatar({
  src,
  name,
  size = 32,
  className = "",
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const initials = (name || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name || "User"}
      width={size}
      height={size}
      className={`rounded-full object-cover border ${className}`}
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      className={`rounded-full grid place-items-center bg-gray-200 text-gray-700 border ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(12, Math.floor(size * 0.4)),
      }}
      aria-label={name || "User"}
      title={name || "User"}
    >
      {initials || "?"}
    </div>
  );
}
