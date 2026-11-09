import type { Metadata } from "next";
import { Libre_Franklin } from "next/font/google";
import "./globals.css";

// americaneagle.com's typeface, and the only one the app uses.
const sans = Libre_Franklin({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-libre-franklin",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ReleaseGuard — Americaneagle.com",
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
