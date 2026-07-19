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
    "Build, fight, and deploy the Solar Spear against a rules-legal Normal AI.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    title: "Aurelia Falling — Feature-Complete v1",
    description:
      "Command the Golden Scar with persistent settings, onboarding, and the Solar Spear.",
    images: [
      {
        url: "/og-phase-four.png",
        width: 1731,
        height: 909,
        alt: "Aurelia Falling skirmish with Gold and Cyan forces divided by fog of war",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Aurelia Falling — Feature-Complete v1",
    description:
      "Command the Golden Scar with persistent settings, onboarding, and the Solar Spear.",
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
