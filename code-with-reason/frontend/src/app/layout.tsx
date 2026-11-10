import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const editorial = Newsreader({
  subsets: ["latin"],
  display: "swap",
  weight: "variable",
  variable: "--font-editorial",
});
const body = Inter({
  subsets: ["latin"],
  display: "swap",
  weight: "variable",
  variable: "--font-body",
});
const code = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: "variable",
  variable: "--font-code",
});

export const metadata: Metadata = {
  title: "Code With Reason — The algorithmic sparring club",
  description:
    "Build the invariant. Challenge the edge case. An execution-grounded Socratic workspace for algorithmic thinkers, powered by the SocraGate Engine.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={[editorial.variable, body.variable, code.variable].join(" ")}
    >
      <body>{children}</body>
    </html>
  );
}
