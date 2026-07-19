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
    "Command the Meridian Coalition through fog of war against a rules-legal Normal AI.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    title: "Aurelia Falling — Complete Skirmish",
    description:
      "Build, scout, and fight through the Golden Scar against a deterministic Normal AI.",
    images: [
      {
        url: "/og-phase-four.png",
        width: 1731,
        height: 909,
        alt: "Aurelia Falling Phase 4 skirmish with Gold and Cyan forces divided by fog of war",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Aurelia Falling — Complete Skirmish",
    description:
      "Build, scout, and fight through the Golden Scar against a deterministic Normal AI.",
    images: ["/og-phase-four.png"],
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
