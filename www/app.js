const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const audio=$("#audio");
const state={results:[],queue:[],index:-1,current:null,libraryTab:"favorites",playlistId:null,favorites:JSON.parse(localStorage.getItem("jm_favorites")||"[]"),playlists:JSON.parse(localStorage.getItem("jm_playlists")||"[]"),recent:JSON.parse(localStorage.getItem("jm_recent")||"[]")};
const save=()=>{localStorage.setItem("jm_favorites",JSON.stringify(state.favorites));localStorage.setItem("jm_playlists",JSON.stringify(state.playlists));localStorage.setItem("jm_recent",JSON.stringify(state.recent))};
const esc=s=>String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const toast=s=>{const t=$("#toast");t.textContent=s;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800)};
const fmt=n=>{if(!Number.isFinite(n))return"0:00";return Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0")};
function switchTab(tab){$$(".view").forEach(v=>v.classList.toggle("active",v.id===tab+"-view"));$$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));if(tab==="library")renderLibrary();if(tab==="home")renderRecent()}
$$(".nav-item").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
$$("[data-tab]").filter(b=>!b.classList.contains("nav-item")).forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
$("#search-focus").onclick=()=>{switchTab("search");$("#search-input").focus()};
$("#discover-btn").onclick=()=>{switchTab("search");searchMusic("indie music")};
async function searchMusic(q){if(!q.trim())return;$("#search-status").textContent="正在开放音乐档案中寻找…";$("#results-list").innerHTML="";
 try{const url="https://archive.org/advancedsearch.php?"+new URLSearchParams({q:q+" AND mediatype:audio",fl:"identifier,title,creator,year,licenseurl",rows:"30",page:"1",output:"json"});
 const res=await fetch(url);if(!res.ok)throw Error("搜索服务暂时不可用");const data=await res.json();const docs=data.response?.docs||[];
 const details=await Promise.all(docs.slice(0,20).map(async d=>{try{const m=await fetch("https://archive.org/metadata/"+encodeURIComponent(d.identifier));const j=await m.json();const fs=(j.files||[]).filter(f=>f.name&&/\.(mp3|ogg|flac|m4a|wav)$/i.test(f.name)&&!f.name.includes("__MACOSX"));const f=fs.find(x=>x.source==="original"&&(!x.format||/mp3|ogg|flac|mpeg|wave/i.test(x.format)))||fs[0];if(!f)return null;return{id:d.identifier,title:d.title||f.title||d.identifier,artist:d.creator||"Internet Archive",year:d.year||"",license:d.licenseurl||j.metadata?.licenseurl||"",url:"https://archive.org/download/"+encodeURIComponent(d.identifier)+"/"+f.name,identifier:d.identifier}}catch{return null}}));
 state.results=details.filter(Boolean);renderTracks(state.results,"results-list");$("#search-status").textContent=state.results.length?("找到 "+state.results.length+" 首可播放音频 · 请留意每个作品的授权说明"):"没有找到可播放音频，换个关键词试试";
 }catch(e){$("#search-status").textContent="搜索失败："+e.message+"。请检查网络后重试。"}}
$("#search-form").addEventListener("submit",e=>{e.preventDefault();searchMusic($("#search-input").value)});
$$(".mood").forEach(b=>b.onclick=()=>{switchTab("search");$("#search-input").value=b.dataset.query;searchMusic(b.dataset.query)});
function renderTracks(items,target){const el=$("#"+target);if(!items.length){el.innerHTML='<div class="empty-note">这里暂时还没有内容</div>';return}
 el.innerHTML=items.map((t,i)=>'<div class="track"><div class="track-cover">♫</div><div class="track-info"><strong>'+esc(t.title)+'</strong><small>'+esc(t.artist)+(t.year?" · "+esc(t.year):"")+'</small></div><div class="track-actions"><button data-action="play" data-index="'+i+'" title="播放">▶</button><button data-action="fav" data-index="'+i+'" title="收藏">'+(isFav(t)?"♥":"♡")+'</button><button data-action="add" data-index="'+i+'" title="加入歌单">＋</button></div></div>').join("");
 el.querySelectorAll("button").forEach(b=>b.onclick=()=>{const t=items[+b.dataset.index];if(b.dataset.action==="play")playFrom(items,+b.dataset.index);if(b.dataset.action==="fav")toggleFav(t);if(b.dataset.action==="add")addToPlaylist(t)})}
function isFav(t){return state.favorites.some(x=>x.id===t.id)}
function toggleFav(t){state.favorites=isFav(t)?state.favorites.filter(x=>x.id!==t.id):[t,...state.favorites];save();renderLibrary();if(state.current?.id===t.id)$("#player-fav").textContent=isFav(t)?"♥":"♡";toast(isFav(t)?"已加入收藏":"已取消收藏")}
function playFrom(items,i){state.queue=[...items];state.index=i;loadCurrent()}
function loadCurrent(){const t=state.queue[state.index];if(!t)return;state.current=t;audio.src=t.url;audio.play().catch(()=>toast("播放失败：音源可能不可用或网络受限"));$("#now-title").textContent=t.title;$("#now-artist").textContent=t.artist;$("#player-fav").textContent=isFav(t)?"♥":"♡";state.recent=[t,...state.recent.filter(x=>x.id!==t.id)].slice(0,12);save();renderRecent()}
function next(){if(state.queue.length){state.index=(state.index+1)%state.queue.length;loadCurrent()}}
function prev(){if(audio.currentTime>3){audio.currentTime=0;return}if(state.queue.length){state.index=(state.index-1+state.queue.length)%state.queue.length;loadCurrent()}}
$("#play-btn").onclick=()=>{if(!state.current){toast("先去发现页选择一首歌");return}if(audio.paused)audio.play().catch(()=>toast("无法播放此音源"));else audio.pause()};
$("#next-btn").onclick=next;$("#prev-btn").onclick=prev;audio.onended=next;
audio.onplay=()=>$("#play-btn").textContent="Ⅱ";audio.onpause=()=>$("#play-btn").textContent="▶";
audio.ontimeupdate=()=>{if(audio.duration){$("#seek").value=audio.currentTime/audio.duration*1000;$("#current-time").textContent=fmt(audio.currentTime);$("#duration").textContent=fmt(audio.duration)}};
$("#seek").oninput=()=>{if(audio.duration)audio.currentTime=audio.duration*(+$("#seek").value/1000)};
$("#player-fav").onclick=()=>state.current&&toggleFav(state.current);
$("#queue-btn").onclick=()=>toast(state.queue.length?"当前队列 "+(state.index+1)+"/"+state.queue.length:"播放队列为空");
function renderRecent(){renderTracks(state.recent.slice(0,5),"recent-list")}
function renderLibrary(){const root=$("#library-content");$$("[data-library]").forEach(b=>b.classList.toggle("selected",b.dataset.library===state.libraryTab));
 if(state.libraryTab==="favorites"){root.innerHTML="";renderTracks(state.favorites,"library-content");return}
 root.innerHTML='<div class="create-row"><input id="playlist-name" maxlength="24" placeholder="给新歌单起个名字"><button id="create-playlist">创建歌单</button></div><div id="playlist-items"></div>';
 $("#create-playlist").onclick=()=>{const name=$("#playlist-name").value.trim();if(!name){toast("先给歌单起个名字");return}state.playlists.push({id:Date.now().toString(),name,tracks:[]});save();renderLibrary();toast("歌单已创建")};
 const list=$("#playlist-items");if(!state.playlists.length){list.innerHTML='<div class="empty-note">还没有歌单，创建一个自己的音乐角落</div>';return}
 list.innerHTML=state.playlists.map(p=>'<div class="playlist-card"><div><strong>'+esc(p.name)+'</strong><small>'+p.tracks.length+' 首歌曲</small></div><div><button class="text-btn" data-open="'+p.id+'">打开</button> <button class="text-btn" data-delete="'+p.id+'">删除</button></div></div>').join("");
 list.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openPlaylist(b.dataset.open));list.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>{state.playlists=state.playlists.filter(p=>p.id!==b.dataset.delete);save();renderLibrary()})}
$$("[data-library]").forEach(b=>b.onclick=()=>{state.libraryTab=b.dataset.library;renderLibrary()});
function addToPlaylist(t){if(!state.playlists.length){state.playlists.push({id:Date.now().toString(),name:"稍后再听",tracks:[]})}const p=state.playlists[state.playlists.length-1];if(!p.tracks.some(x=>x.id===t.id))p.tracks.push(t);save();toast("已加入「"+p.name+"」")}
function openPlaylist(id){const p=state.playlists.find(x=>x.id===id);if(!p)return;$("#library-content").innerHTML='<div class="section-head"><h2>'+esc(p.name)+'</h2><button class="text-btn" id="back-playlists">返回</button></div><div id="playlist-tracks"></div>';$("#back-playlists").onclick=renderLibrary;renderTracks(p.tracks,"playlist-tracks")}
renderRecent();renderLibrary();
