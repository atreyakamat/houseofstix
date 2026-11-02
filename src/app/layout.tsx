import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "House of Stix",
  description: "The Stix control room: open, watch and operate every tool from one screen.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#070707" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
