import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "That's A Flag",
  description: "Flags passages in a student paper that look AI-generated, plagiarized, or copy-pasted.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
