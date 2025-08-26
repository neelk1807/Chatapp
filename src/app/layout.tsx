import "./globals.css";
import { SpeedInsights } from "@vercel/speed-insights/next"
import AuthProvider from "../component/AuthProvider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><AuthProvider>{children}</AuthProvider></body>
      <SpeedInsights />
    </html>
  );
}
