import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Tensi Drawing Extraction",
  description: "AI-powered construction drawing metadata extraction",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900" suppressHydrationWarning>
        <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6 shrink-0">
          <Link href="/" className="font-semibold text-gray-900 text-lg tracking-tight">
            Tensi
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/" className="text-gray-600 hover:text-gray-900">Projects</Link>
            <Link href="/templates" className="text-gray-600 hover:text-gray-900">Templates</Link>
            <Link href="/stats" className="text-gray-600 hover:text-gray-900">Stats</Link>
            <Link href="/finops" className="text-gray-600 hover:text-gray-900">FinOps</Link>
            <Link href="/rules" className="text-gray-600 hover:text-gray-900">Rules</Link>
            <Link href="/settings" className="text-gray-600 hover:text-gray-900">Settings</Link>
          </div>
        </nav>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
