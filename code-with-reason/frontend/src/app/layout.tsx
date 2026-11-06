import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SocraGate — Think it through",
  description: "An execution-grounded Socratic workspace for building better algorithmic reasoning.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
