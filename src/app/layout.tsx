import type { Metadata, Viewport } from "next";
import "./globals.css";
import TopNav from "@/components/shell/TopNav";
import BottomTabBar from "@/components/shell/BottomTabBar";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

export const metadata: Metadata = {
  title: "Body Watcher",
  description: "个人力量训练分析工具",
};

export const viewport: Viewport = {
  themeColor: "#0c0c0b",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh bg-bg font-sans text-ink antialiased">
        <a
          href="#main"
          className="btn btn-secondary sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
        >
          跳到正文
        </a>
        <TopNav />
        <main
          id="main"
          className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+2rem)] md:px-6 md:pt-10 md:pb-16 lg:px-8"
        >
          {children}
        </main>
        <BottomTabBar />
      </body>
    </html>
  );
}
