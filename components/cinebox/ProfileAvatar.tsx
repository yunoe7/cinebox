import type { CSSProperties } from "react";

export const avatarCategories = ["Crunchyroll", "Netflix", "HBO", "Prime Video", "Disney+", "Animés"] as const;

export const profileAvatars = [
  { id: "golden-reel", name: "Bobine dorée", category: "Crunchyroll", glyph: "◉", colors: ["#d4b77f", "#765d39"] },
  { id: "amber-comet", name: "Comète ambrée", category: "Crunchyroll", glyph: "✦", colors: ["#e0a45f", "#7c4635"] },
  { id: "violet-moon", name: "Lune violette", category: "Crunchyroll", glyph: "☾", colors: ["#8d7fc4", "#342e58"] },
  { id: "coral-star", name: "Étoile corail", category: "Crunchyroll", glyph: "✧", colors: ["#db8972", "#673f49"] },
  { id: "ruby-mask", name: "Masque rubis", category: "Netflix", glyph: "◈", colors: ["#b86a68", "#4a272c"] },
  { id: "silver-eye", name: "Œil argent", category: "Netflix", glyph: "◉", colors: ["#a8b2bd", "#46505c"] },
  { id: "copper-fox", name: "Renard cuivré", category: "Netflix", glyph: "⌁", colors: ["#d38a57", "#684235"] },
  { id: "night-owl", name: "Hibou nocturne", category: "Netflix", glyph: "◒", colors: ["#9a8d75", "#3b3943"] },
  { id: "onyx-crown", name: "Couronne d’onyx", category: "HBO", glyph: "♛", colors: ["#a795d0", "#3a3154"] },
  { id: "indigo-orbit", name: "Orbite indigo", category: "HBO", glyph: "◎", colors: ["#8294c5", "#303956"] },
  { id: "pearl-comet", name: "Comète nacrée", category: "HBO", glyph: "✧", colors: ["#c7b9a9", "#655d62"] },
  { id: "forest-cat", name: "Chat des bois", category: "Prime Video", glyph: "⌃", colors: ["#779486", "#31443e"] },
  { id: "blue-planet", name: "Planète bleue", category: "Prime Video", glyph: "◌", colors: ["#70a3b7", "#314858"] },
  { id: "amber-owl", name: "Hibou ambré", category: "Prime Video", glyph: "◉", colors: ["#d1a56a", "#62503d"] },
  { id: "starlight", name: "Poussière d’étoiles", category: "Disney+", glyph: "✦", colors: ["#7891c0", "#303b62"] },
  { id: "rose-cloud", name: "Nuage rose", category: "Disney+", glyph: "☁", colors: ["#d29eaa", "#694651"] },
  { id: "golden-comet", name: "Comète dorée", category: "Disney+", glyph: "☄", colors: ["#d1aa6f", "#57452f"] },
  { id: "star-fox", name: "Renard étoilé", category: "Animés", glyph: "✦", colors: ["#bd7770", "#59394b"] },
  { id: "moon-cat", name: "Chat lunaire", category: "Animés", glyph: "☾", colors: ["#8582b0", "#373752"] },
  { id: "paper-crane", name: "Grue de papier", category: "Animés", glyph: "⌁", colors: ["#82a9a1", "#36534f"] },
  { id: "winter-star", name: "Étoile d’hiver", category: "Animés", glyph: "❋", colors: ["#83a4c4", "#3d4d68"] },
] as const;

export function ProfileAvatar({ avatarId, className = "", label, size }: { avatarId: string; className?: string; label?: string; size?: number }) {
  const avatar = profileAvatars.find((item) => item.id === avatarId) || profileAvatars[0];
  const style = { "--avatar-from": avatar.colors[0], "--avatar-to": avatar.colors[1], ...(size ? { width: size, height: size } : {}) } as CSSProperties;
  return <span className={`cinebox-profile-avatar ${className}`.trim()} style={style} role="img" aria-label={label || avatar.name}><span aria-hidden="true">{avatar.glyph}</span></span>;
}
