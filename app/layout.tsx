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
    "Command Meridian Coalition formations across the deterministic Golden Scar movement sandbox.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    title: "Aurelia Falling",
    description:
      "Command two Meridian formations through the Golden Scar Movement Sandbox.",
    images: [
      {
        url: "/og.png",
        width: 1672,
        height: 941,
        alt: "Aurelia Falling — Movement Sandbox",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Aurelia Falling",
    description:
      "Command two Meridian formations through the Golden Scar Movement Sandbox.",
    images: ["/og.png"],
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
