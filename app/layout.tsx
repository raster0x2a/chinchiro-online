import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "チンチロ 卓 | 友達とオンライン対戦",
  description: "サイコロを振って、役で勝負。友達と遊べるオンラインチンチロ。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
