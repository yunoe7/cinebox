import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CinéBox — Votre cinéma personnel",
  description: "Votre collection de films, séries et vidéos, réunie dans un seul espace.",
  applicationName: "CinéBox"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}