import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const appFont = Manrope({
  variable: "--font-app",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Weekly Tasks",
  description: "Shared weekly task tracking for the team",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${appFont.variable} antialiased`}>{children}</body>
    </html>
  );
}
