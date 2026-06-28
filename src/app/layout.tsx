import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TraceJudge — agent flight recorder",
  description:
    "Aurora PostgreSQL-powered audit layer that proves whether an AI agent did what it was assigned to do.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
