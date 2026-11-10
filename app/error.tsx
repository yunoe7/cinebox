"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log diagnostic info without exposing secrets or user data.
    console.error("[CineBox] Unhandled error:", error?.name, error?.message, error?.digest);
  }, [error]);

  return (
    <main className="app-error-screen" role="alert" aria-live="assertive">
      <div className="app-error-card">
        <div className="app-error-mark"><AlertTriangle size={22} /></div>
        <div className="eyebrow">ERREUR INATTENDUE</div>
        <h1>Quelque chose s’est mal passé</h1>
        <p>Une erreur inattendue est survenue dans l’interface. Vos données locales n’ont pas été modifiées. Réessayez ou rechargez la page.</p>
        {error?.digest && <small className="app-error-digest">Référence : {error.digest}</small>}
        <button type="button" className="gold-btn" onClick={() => reset()}>
          <RefreshCw size={15} /> Réessayer
        </button>
      </div>
    </main>
  );
}