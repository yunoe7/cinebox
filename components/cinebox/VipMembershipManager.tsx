"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Crown, Search, ShieldCheck, Clock3, UserRound, CalendarClock, X, RefreshCw, LoaderCircle } from "lucide-react";

type Membership = { userId:string; displayName:string; expiresAt:string; grantedBy:string|null; createdAt:string; active:boolean };
type UserMatch = { userId:string; displayName:string; discordUsername:string|null; discordName:string|null; expiresAt:string|null; active:boolean };
const durations = [{label:"7 jours",days:7},{label:"30 jours",days:30},{label:"90 jours",days:90},{label:"1 an",days:365}];
function dateLabel(value:string|null) {
  if(!value) return "Aucune expiration";
  const date=new Date(value);
  return Number.isNaN(date.getTime()) ? "Date invalide" : new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(date);
}

export function VipMembershipManager() {
  const [members,setMembers]=useState<Membership[]>([]);
  const [matches,setMatches]=useState<UserMatch[]>([]);
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState<UserMatch|null>(null);
  const [duration,setDuration]=useState("30");
  const [customDate,setCustomDate]=useState("");
  const [loading,setLoading]=useState(true);
  const [searching,setSearching]=useState(false);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState<{kind:"success"|"error";text:string}|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);
    try {
      const response=await fetch("/api/admin/vip",{cache:"no-store"});
      const payload=await response.json();
      if(!response.ok) throw new Error(payload.error||"Impossible de charger les membres VIP.");
      setMembers(Array.isArray(payload.memberships)?payload.memberships:[]);
    } catch(error) { setMessage({kind:"error",text:error instanceof Error?error.message:"Erreur de chargement."}); }
    finally { setLoading(false); }
  },[]);
  useEffect(()=>{void load();},[load]);

  useEffect(()=>{
    const term=query.trim();
    if(term.length<2){setMatches([]);setSearching(false);return;}
    let alive=true;
    setSearching(true);
    const controller=new AbortController();
    const handle=window.setTimeout(async()=>{
      try {
        const response=await fetch("/api/admin/vip?search="+encodeURIComponent(term),{cache:"no-store",signal:controller.signal});
        const payload=await response.json();
        if(!response.ok) throw new Error(payload.error||"Recherche impossible.");
        if(alive) setMatches(Array.isArray(payload.users)?payload.users:[]);
      } catch(error) { if(alive && !(error instanceof DOMException && error.name==="AbortError")) setMessage({kind:"error",text:error instanceof Error?error.message:"Recherche impossible."}); }
      finally { if(alive) setSearching(false); }
    },250);
    return ()=>{alive=false;controller.abort();window.clearTimeout(handle);};
  },[query]);

  const grant=async(user:UserMatch)=>{
    const parsedExpiry=duration==="custom" ? Date.parse(customDate) : Date.now()+Number(duration)*86400000;
    if(!Number.isFinite(parsedExpiry) || parsedExpiry<=Date.now()){setMessage({kind:"error",text:"Choisis une date d’expiration future."});return;}
    const expiry=new Date(parsedExpiry).toISOString();
    setSaving(true);setMessage(null);
    try {
      const response=await fetch("/api/admin/vip",{method:"POST",headers:{"content-type":"application/json","x-cinebox-request":"1"},body:JSON.stringify({userId:user.userId,expiresAt:expiry})});
      const payload=await response.json();
      if(!response.ok) throw new Error(payload.error||"Impossible d’activer le VIP.");
      setMessage({kind:"success",text:`Le statut VIP de ${user.displayName} est actif jusqu’au ${dateLabel(payload.expiresAt)}. Le rôle Discord sera synchronisé au prochain passage automatique du bot (toutes les 5 minutes).`});
      setSelected(null);setQuery("");setMatches([]);await load();
    } catch(error) {setMessage({kind:"error",text:error instanceof Error?error.message:"Erreur inattendue."});}
    finally {setSaving(false);}
  };

  const revoke=async(userId:string,name:string)=>{
    if(!window.confirm(`Retirer immédiatement le statut VIP de ${name} ?`)) return;
    setSaving(true);setMessage(null);
    try {
      const response=await fetch("/api/admin/vip",{method:"DELETE",headers:{"content-type":"application/json","x-cinebox-request":"1"},body:JSON.stringify({userId})});
      const payload=await response.json();
      if(!response.ok) throw new Error(payload.error||"Impossible de retirer le VIP.");
      setMessage({kind:"success",text:`Le statut VIP de ${name} a été retiré. Le bot synchronisera le rôle Discord au prochain passage automatique (toutes les 5 minutes).`});await load();
    } catch(error) {setMessage({kind:"error",text:error instanceof Error?error.message:"Erreur inattendue."});}
    finally {setSaving(false);}
  };

  const active=members.filter(member=>member.active);
  const expired=members.length-active.length;
  return <section className="admin-vip-manager" aria-labelledby="admin-vip-title">
    <header className="admin-page-heading admin-section-hero">
      <span className="admin-section-hero-icon"><Crown size={21}/></span>
      <div className="admin-section-hero-copy"><div className="eyebrow">GESTION DES ABONNEMENTS · COMPTES</div><h2 id="admin-vip-title">Membres VIP <span className="admin-source-badge is-d1">D1</span></h2><p>Attribue, prolonge ou révoque les accès VIP de ta communauté.</p></div>
      <button className="admin-vip-refresh" type="button" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Actualiser</button>
    </header>

    <div className="admin-vip-stats">
      <article><span><BadgeCheck size={15}/> VIP ACTIFS</span><strong>{active.length}</strong><small>Accès actuellement ouverts</small></article>
      <article><span><Clock3 size={15}/> EXPIRÉS</span><strong>{expired}</strong><small>Adhésions arrivées à échéance</small></article>
      <article><span><UserRound size={15}/> COMPTES SUIVIS</span><strong>{members.length}</strong><small>Adhésions enregistrées</small></article>
    </div>

    <div className="admin-vip-grant">
      <div className="admin-vip-panel-title"><span className="admin-vip-panel-icon"><Crown size={17}/></span><div><h3>Offrir un accès VIP</h3><p>Recherche le compte puis choisis la durée de son accès.</p></div></div>
      <label className="admin-vip-search"><Search size={16}/><input value={query} onChange={event=>{setQuery(event.target.value);setSelected(null);}} placeholder="Pseudo CinéBox ou nom Discord…" aria-label="Rechercher un membre"/>{query&&<button type="button" onClick={()=>{setQuery("");setSelected(null);setMatches([]);}} aria-label="Effacer"><X size={14}/></button>}{searching&&<LoaderCircle size={15} className="admin-spin"/>}</label>
      {query.trim().length>=2&&<div className="admin-vip-results">{matches.length?matches.map(user=><button type="button" key={user.userId} className={selected?.userId===user.userId?"is-selected":""} onClick={()=>setSelected(user)}><span className="admin-vip-avatar"><UserRound size={16}/></span><span><strong>{user.displayName}</strong><small>{user.discordName||user.discordUsername||"Compte CinéBox"} · {user.active?"VIP actif":user.expiresAt?"VIP expiré":"Non VIP"}</small></span><span className="admin-vip-pick">{selected?.userId===user.userId?"Sélectionné":"Choisir"}</span></button>):!searching&&<p>Aucun compte trouvé. Vérifie le pseudo ou le nom Discord.</p>}</div>}
      {selected&&<div className="admin-vip-selected"><div><strong>{selected.displayName}</strong><span>{selected.discordName||selected.discordUsername||"Compte CinéBox"}</span></div><label>Durée<select value={duration} onChange={event=>setDuration(event.target.value)}>{durations.map(item=><option key={item.days} value={item.days}>{item.label}</option>)}<option value="custom">Date personnalisée</option></select></label>{duration==="custom"&&<label>Expiration<input type="datetime-local" value={customDate} onChange={event=>setCustomDate(event.target.value)}/></label>}<button type="button" disabled={saving||(duration==="custom"&&!customDate)} onClick={()=>void grant(selected)}>{saving?<LoaderCircle size={15} className="admin-spin"/>:<Crown size={15}/>} Activer le VIP</button></div>}
    </div>

    {message&&<div className={`admin-vip-message is-${message.kind}`} role={message.kind==="error"?"alert":"status"}>{message.text}</div>}

    <div className="admin-vip-list-head"><div><h3>Adhésions VIP</h3><p>Les accès expirent automatiquement à la date indiquée.</p></div><span>{members.length} compte{members.length===1?"":"s"}</span></div>
    <div className="admin-vip-members">
      {loading?<div className="admin-vip-empty"><LoaderCircle size={18} className="admin-spin"/> Chargement des adhésions…</div>:members.length===0?<div className="admin-vip-empty"><ShieldCheck size={20}/> Aucun membre VIP enregistré pour le moment.</div>:members.map(member=><article key={member.userId} className={`admin-vip-member ${member.active?"is-active":"is-expired"}`}>
        <span className="admin-vip-avatar"><UserRound size={17}/></span><div className="admin-vip-member-copy"><strong>{member.displayName}</strong><small>{member.active?"Expire le":"Expiré le"} {dateLabel(member.expiresAt)}</small></div><span className={`admin-vip-state ${member.active?"is-active":"is-expired"}`}>{member.active?"Actif":"Expiré"}</span><button type="button" disabled={saving} onClick={()=>void revoke(member.userId,member.displayName)} title="Retirer le statut VIP">Retirer</button>
      </article>)}
    </div>
    <p className="admin-vip-footnote"><ShieldCheck size={13}/> Les droits sont vérifiés côté serveur à chaque requête. Un retrait ou une expiration prend effet sans attendre une modification manuelle du compte.</p>
  </section>;
}
