import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "ReleaseGuard",
  description: "Bulk content quality and pre-publishing audit for SitecoreAI.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} h-full`} suppressHydrationWarning>
      {/* SitecoreAI hosts the app in a fixed-height iframe; panels scroll internally. */}
      <body className="flex h-full flex-col overflow-hidden" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
