import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DiffGuard — Evidence-first AI code review",
  description:
    "Review pull requests with deterministic checks, trusted line evidence, and validated AI findings.",
};

const themeInitializer = `
  (() => {
    try {
      const savedTheme = window.localStorage.getItem("diffguard-theme");
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const theme = savedTheme === "light" || savedTheme === "dark"
        ? savedTheme
        : prefersDark ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch {
      document.documentElement.dataset.theme = "light";
    }
  })();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitializer }} /></head>
      <body>{children}</body>
    </html>
  );
}
