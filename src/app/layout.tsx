import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shorts AI - Crie shorts automaticamente",
  description: "Transforme vídeos do YouTube em shorts com IA",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
