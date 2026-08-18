import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DiffGuard — Evidence-first AI code review",
  description:
    "Review pull requests with deterministic checks, trusted line evidence, and validated AI findings.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
