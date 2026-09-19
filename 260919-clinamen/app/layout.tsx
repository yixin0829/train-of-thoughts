import type { Metadata } from "next";
import { Cormorant_Garamond, Karla } from "next/font/google";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  weight: ["500"],
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const karla = Karla({
  variable: "--font-karla",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "clinamen",
  description: "Porcelain bowls drift on a pool of blue water and ring when they meet. Size sets the note.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${cormorant.variable} ${karla.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
