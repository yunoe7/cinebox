import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./mobile-polish.css";

export const metadata: Metadata = {
  title: "CinéBox — Votre cinéma personnel",
  description: "Votre collection de films, séries et vidéos, réunie dans un seul espace.",
  applicationName: "CinéBox",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "CinéBox" }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#090a0d"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}