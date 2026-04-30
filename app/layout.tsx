import type { Metadata, Viewport } from "next";
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

export const viewport: Viewport = {
  themeColor: "#0F6E56",
};

export const metadata: Metadata = {
  title: "fixmysite.in — Your website, finally well-behaved.",
  description:
    "Bugbite scans your website and tells you exactly what's broken — in plain language, no jargon. Built for Indian small businesses.",
  metadataBase: new URL("https://fixmysite.in"),
  applicationName: "fixmysite.in",
  openGraph: {
    title: "fixmysite.in — Your website, finally well-behaved.",
    description:
      "Bugbite scans your website and tells you exactly what's broken — in plain language, no jargon.",
    url: "https://fixmysite.in",
    siteName: "fixmysite.in",
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "fixmysite.in — Your website, finally well-behaved.",
    description:
      "Bugbite scans your website and tells you exactly what's broken — in plain language, no jargon.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
