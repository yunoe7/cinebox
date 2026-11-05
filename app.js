const seed=[
{id:1,title:"Les heures dorées",type:"Film",year:2025,genre:"Drame",desc:"Une photographe revient dans sa ville natale et découvre les secrets de sa famille.",progress:62,fav:false,image:"https://images.unsplash.com/photo-1478720568477-152d9b164e26?auto=format&fit=crop&w=700&q=80",art:"linear-gradient(145deg,#a47b50,#34251f)"},
{id:2,title:"Dernier signal",type:"Série",year:2026,genre:"Thriller",desc:"Une opératrice de nuit reçoit un appel qui ne devrait pas exister.",progress:28,fav:true,image:"https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=700&q=80",art:"linear-gradient(145deg,#52616b,#18212b)"},
{id:3,title:"Là où la mer commence",type:"Film",year:2024,genre:"Aventure",desc:"Deux frères traversent la côte à la recherche du phare de leur grand-père.",progress:0,fav:false,image:"https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=700&q=80",art:"linear-gradient(145deg,#739d9a,#243d45)"},
{id:4,title:"Les invisibles",type:"Série",year:2025,genre:"Policier",desc:"Une équipe reprend des affaires classées et fait émerger des vérités oubliées.",progress:0,fav:false,image:"https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=700&q=80",art:"linear-gradient(145deg,#90665e,#2e2025)"},
{id:5,title:"Minuit à Kyoto",type:"Film",year:2023,genre:"Romance",desc:"Une rencontre inattendue transforme un voyage solitaire.",progress:0,fav:true,image:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=700&q=80",art:"linear-gradient(145deg,#b57c55,#452b2d)"},
{id:6,title:"Fragments",type:"Vidéo",year:2026,genre:"Documentaire",desc:"Un court documentaire sur les lieux que l’on garde en mémoire.",progress:0,fav:false,image:"https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=700&q=80",art:"linear-gradient(145deg,#9c9a70,#40412f)"},
{id:7,title:"Le grand silence",type:"Film",year:2022,genre:"Science-fiction",desc:"Après la disparition des étoiles, une communauté cherche le dernier signal.",progress:0,fav:false,image:"https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=700&q=80",art:"linear-gradient(145deg,#647b9a,#20283c)"},
{id:8,title:"À contre-jour",type:"Série",year:2026,genre:"Drame",desc:"Trois destins se croisent dans une ville en pleine transformation.",progress:0,fav:false,image:"https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=700&q=80",art:"linear-gradient(145deg,#a17e67,#41302c)"}
];
let items=JSON.parse(localStorage.getItem("cinebox-items-v2")||"null")||seed;
let favorites=JSON.parse(localStorage.getItem("cinebox-favs-v2")||"null")||[2,5];
let page="Accueil",filter="Tout",query="";
const $=id=>document.getElementById(id);
const save=()=>{localStorage.setItem("cinebox-items-v2",JSON.stringify(items));localStorage.setItem("cinebox-favs-v2",JSON.stringify(favorites));};
const posterStyle=item=>item.image?"background-image:url('"+item.image+"')":"background:"+item.art;
function card(item){return '<article class="poster-card" data-id="'+item.id+'"><div class="poster-art" style="'+posterStyle(item)+'"><span class="poster-type">'+item.type.toUpperCase()+'</span><button class="favorite-button '+(favorites.includes(item.id)?"active":"")+'" data-fav="'+item.id+'" aria-label="Ajouter aux favoris">'+(favorites.includes(item.id)?"♥":"♡")+'</button><div class="poster-bottom">'+item.title+'</div></div><div class="poster-meta"><span>'+item.genre+'</span><span>'+item.year+'</span></div><div class="poster-title">'+item.title+'</div></article>';}
function render(){const filtered=items.filter(x=>(filter==="Tout"||x.type===filter)&&(page!=="Films"||x.type==="Film")&&(page!=="Séries"||x.type==="Série")&&(page!=="Vidéos"||x.type==="Vidéo")&&(page!=="Ma liste"||favorites.includes(x.id))&&((x.title+" "+x.genre+" "+x.type).toLowerCase().includes(query)));
$("catalogGrid").innerHTML=filtered.map(card).join("");$("emptyState").hidden=filtered.length>0;
$("catalogTitle").innerHTML=page==="Ma liste"?'Vos favoris <span>précieusement gardés</span>':page==="Accueil"?'À découvrir <span>maintenant</span>':page+' <span>de votre collection</span>';
$("pageName").textContent=page.toUpperCase();$("favCount").textContent=String(favorites.length).padStart(2,"0");
$("filters").style.display=["Accueil","Ma liste"].includes(page)?"flex":"none";
const ongoing=items.filter(x=>x.progress>0);$("continueGrid").innerHTML=ongoing.length?ongoing.map(x=>'<article class="continue-card" data-play="'+x.id+'"><div class="mini-poster" style="'+posterStyle(x)+'"></div><div class="continue-info"><span class="type-label">'+x.type+' · '+x.year+'</span><strong>'+x.title+'</strong><small>'+x.progress+'% regardé</small><div class="progress-track"><div class="progress-fill" style="width:'+x.progress+'%"></div></div></div></article>').join(""):'<div class="empty-state">Vos lectures en cours apparaîtront ici.</div>';
$("continueSection").style.display=page==="Accueil"?"block":"none";
}
function setPage(next){page=next;document.querySelectorAll(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.page===next));$("welcomeTitle").innerHTML=next==="Accueil"?'Le plaisir de <em>choisir.</em>':next==='Ma liste'?'Vos histoires <em>préférées.</em>':'Explorez les <em>'+next.toLowerCase()+'.</em>';render();}
document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>setPage(b.dataset.page)));
document.querySelectorAll("[data-filter]").forEach(b=>b.addEventListener("click",()=>{filter=b.dataset.filter;document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x===b));render();}));
$("searchInput").addEventListener("input",e=>{query=e.target.value.toLowerCase();render();});
$("catalogGrid").addEventListener("click",e=>{const fav=e.target.closest("[data-fav]");if(fav){const id=Number(fav.dataset.fav);favorites=favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id];save();render();return;}const c=e.target.closest("[data-id]");if(c)openPlayer(Number(c.dataset.id));});
$("continueGrid").addEventListener("click",e=>{const c=e.target.closest("[data-play]");if(c)openPlayer(Number(c.dataset.play));});
function openPlayer(id){const item=items.find(x=>x.id===id);if(!item)return;$("playerTitle").textContent=item.title;$("playerModal").classList.add("open");}
$("exploreBtn").addEventListener("click",()=>$("catalogSection").scrollIntoView({behavior:"smooth"}));
$("heroInfo").addEventListener("click",()=>$("catalogSection").scrollIntoView({behavior:"smooth"}));
$("openAdd").addEventListener("click",()=>$("addModal").classList.add("open"));
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>b.closest(".modal-backdrop").classList.remove("open")));
document.querySelectorAll(".modal-backdrop").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.remove("open");}));
$("addForm").addEventListener("submit",e=>{e.preventDefault();const d=new FormData(e.target);items.unshift({id:Date.now(),title:d.get("title"),type:d.get("type"),year:Number(d.get("year")),genre:d.get("genre")||"À découvrir",desc:d.get("desc"),progress:0,fav:false,art:"linear-gradient(145deg,#a78b68,#29231d)"});save();e.target.reset();$("addModal").classList.remove("open");filter="Tout";setPage("Accueil");});
render();