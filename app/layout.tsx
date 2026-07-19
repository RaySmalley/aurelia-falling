import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Aurelia Falling",
    template: "%s — Aurelia Falling",
  },
  description:
    "Lead six Meridian Coalition unit classes through a deterministic Golden Scar combat exercise.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    title: "Aurelia Falling — Combat Slice",
    description:
      "Lead six unit classes through a seeded Gold-versus-Cyan combat exercise.",
    images: [
      {
        url: "/og-phase-two.png",
        width: 1733,
        height: 909,
        alt: "Aurelia Falling Phase 2 combat slice with opposing amber and cyan armies",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Aurelia Falling — Combat Slice",
    description:
      "Lead six unit classes through a seeded Gold-versus-Cyan combat exercise.",
    images: ["/og-phase-two.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
