"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

type AccountUser = { id: string; displayName: string; email?: string | null; role: string };
export default function ConnexionPage() {
  const [mode,setMode]=useState<"login"|"register">("login");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [displayName,setDisplayName]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [user,setUser]=useState<AccountUser|null>(null);
  useEffect(()=>{ fetch("/api/account/session",{cache:"no-store"}).then(r=>r.json()).then(data=>{if(data.authenticated)setUser(data.user)}).catch(()=>{}); },[]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response=await fetch(`/api/account/${mode}`,{method:"POST",headers:{"content-type":"application/json","x-cinebox-request":"1"},body:JSON.stringify({email,password,displayName})});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||"Connexion impossible.");
      setUser(data.user); setPassword("");
    } catch(e) { setError(e instanceof Error?e.message:"Une erreur est survenue."); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { await fetch("/api/account/logout",{method:"POST",headers:{"x-cinebox-request":"1"}}); setUser(null); }
    catch { setError("Déconnexion impossible."); }
    finally { setBusy(false); }
  }
  return <main className="account-page">
    <section className="account-card">
      <Link href="/" className="account-back">← Retour à CinéBox</Link>
      <div className="account-kicker">VOTRE CINÉMA PERSONNEL</div>
      <h1>{user ? "Votre compte" : mode==="login"?"Bon retour parmi nous.":"Rejoignez CinéBox."}</h1>
      <p className="account-intro">{user?"Votre session CinéBox est active.":"Connectez-vous avec Discord ou votre adresse e-mail."}</p>
      {user ? <div className="account-logged">
        <strong>{user.displayName}</strong><span>{user.email||"Compte lié à Discord"}</span>
        <button disabled={busy} onClick={logout}>Se déconnecter</button>
        <a href="/api/auth/discord/start?mode=link">Lier mon compte Discord</a>
      </div> : <>
        <a className="account-discord" href="/api/auth/discord/start"><span>◉</span> Continuer avec Discord</a>
        <div className="account-separator"><span>ou avec votre e-mail</span></div>
        <div className="account-tabs">
          <button className={mode==="login"?"active":""} onClick={()=>{setMode("login");setError("")}}>Connexion</button>
          <button className={mode==="register"?"active":""} onClick={()=>{setMode("register");setError("")}}>Créer un compte</button>
        </div>
        <form onSubmit={submit}>
          {mode==="register"&&<label>Nom affiché<input autoComplete="nickname" value={displayName} onChange={e=>setDisplayName(e.target.value)} required maxLength={80}/></label>}
          <label>Adresse e-mail<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254}/></label>
          <label>Mot de passe<input type="password" autoComplete={mode==="login"?"current-password":"new-password"} value={password} onChange={e=>setPassword(e.target.value)} required minLength={mode==="register"?12:1} maxLength={256}/>{mode==="register"&&<small>12 caractères minimum.</small>}</label>
          {error&&<p className="account-error" role="alert">{error}</p>}
          <button className="account-submit" disabled={busy}>{busy?"Patientez…":mode==="login"?"Se connecter":"Créer mon compte"}</button>
        </form>
        <p className="account-note">La liaison entre Discord et un compte e-mail se fait uniquement à votre demande. Aucune fusion automatique par adresse e-mail.</p>
      </>}
      <p className="account-legal">En continuant, vous utilisez un compte personnel CinéBox.</p>
    </section>
  </main>;
}
