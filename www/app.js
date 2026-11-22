import { LyricsEngine } from "./lyrics.js";\nconst $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const audio=$("#audio");
const LocalMusic=window.JerryLocalMusic||null;
const NativeCapacitor=window.JerryCapacitor||window.Capacitor||null;
const state={
  results:[],queue:[],index:-1,current:null,libraryTab:"favorites",searchSource:"online",
  favorites:JSON.parse(localStorage.getItem("jm_favorites")||"[]"),
  playlists:JSON.parse(localStorage.getItem("jm_playlists")||"[]"),
  recent:JSON.parse(localStorage.getItem("jm_recent")||"[]"),
  localFolder:null,selectionTarget:null,selectedIds:new Set(),activePlaylistId:null,homeLocalTracks:JSON.parse(localStorage.getItem("jm_local_tracks")||"[]")
};
let playRequest=0;
const save=()=>{localStorage.setItem("jm_favorites",JSON.stringify(state.favorites));localStorage.setItem("jm_playlists",JSON.stringify(state.playlists));localStorage.setItem("jm_recent",JSON.stringify(state.recent))};
const esc=s=>String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const toast=s=>{const t=$("#toast");t.textContent=s;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800)};
const fmt=n=>{if(!Number.isFinite(n))return"0:00";return Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0")};
function switchTab(tab){$(".view").forEach(v=>v.classList.toggle("active",v.id===tab+"-view"));$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));if(tab==="library")renderLibrary();if(tab==="home"){renderRecent();renderLocalHome()}}
$$(".nav-item").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
$$("[data-tab]").filter(b=>!b.classList.contains("nav-item")).forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
$("#search-focus").onclick=()=>{switchTab("search");$("#search-input").focus()};
$("#local-home-more").onclick=()=>{switchTab("search");setSearchSource("local");if(state.localFolder)searchLocal("");else chooseLocalFolder()};
$("#discover-btn").onclick=()=>{switchTab("search");setSearchSource("online");$("#search-input").value="indie music";searchOnline("indie music")};

function setSearchSource(source){
  state.searchSource=source;
  $$("[data-source]").forEach(b=>b.classList.toggle("selected",b.dataset.source===source));
  $("#online-panel").hidden=source!=="online";
  $("#local-panel").hidden=source!=="local";
  $("#search-status").textContent=source==="online"?"搜索 Internet Archive 中可在线播放的开放音频":"搜索你授权文件夹中的本地音乐";
  $("#results-list").innerHTML="";
}
$$("[data-source]").forEach(b=>b.addEventListener("click",()=>setSearchSource(b.dataset.source)));

async function searchOnline(q){
  if(!q.trim())return;
  $("#search-status").textContent="正在开放音乐档案中寻找…";$("#results-list").innerHTML="";
  try{
    const url="https://archive.org/advancedsearch.php?"+new URLSearchParams({q:q+" AND mediatype:audio",fl:"identifier,title,creator,year,licenseurl",rows:"30",page:"1",output:"json"});
    const res=await fetch(url);if(!res.ok)throw Error("搜索服务暂时不可用");
    const data=await res.json(),docs=data.response?.docs||[];
    const details=await Promise.all(docs.slice(0,20).map(async d=>{
      try{
        const m=await fetch("https://archive.org/metadata/"+encodeURIComponent(d.identifier)),j=await m.json();
        const fs=(j.files||[]).filter(f=>f.name&&/\.(mp3|ogg|flac|m4a|wav)$/i.test(f.name)&&!f.name.includes("__MACOSX"));
        const f=fs.find(x=>x.source==="original"&&(!x.format||/mp3|ogg|flac|mpeg|wave/i.test(x.format)))||fs[0];
        if(!f)return null;
        const filePath=f.name.split("/").map(encodeURIComponent).join("/");
        return{id:d.identifier,title:d.title||f.title||d.identifier,artist:d.creator||"Internet Archive",year:d.year||"",license:d.licenseurl||j.metadata?.licenseurl||"",url:"https://archive.org/download/"+encodeURIComponent(d.identifier)+"/"+filePath,identifier:d.identifier,source:"online"};
      }catch{return null}
    }));
    state.results=details.filter(Boolean);renderTracks(state.results,"results-list");
    $("#search-status").textContent=state.results.length?("找到 "+state.results.length+" 首可播放音频 · 请留意每个作品的授权说明"):"没有找到可播放音频，换个关键词试试";
  }catch(e){$("#search-status").textContent="搜索失败："+e.message+"。请检查网络后重试。"}
}
$("#search-form").addEventListener("submit",e=>{e.preventDefault();searchOnline($("#search-input").value)});
$$(".mood").forEach(b=>b.onclick=()=>{switchTab("search");setSearchSource("online");$("#search-input").value=b.dataset.query;searchOnline(b.dataset.query)});

async function chooseLocalFolder(){
  if(!LocalMusic){toast("本地文件夹功能需要安装新版 APK");return}
  try{
    const result=await LocalMusic.chooseFolder();
    state.localFolder=result;
    renderLocalFolder();
    $("#search-status").textContent="文件夹已授权，现在可以搜索本地音乐";
    $("#results-list").innerHTML="";
    toast("已记住音乐文件夹");
  }catch(e){if(!String(e?.message||e).toLowerCase().includes("cancel"))toast("选择文件夹失败："+(e.message||e))}
}
function renderLocalFolder(){
  $("#local-folder-name").textContent=state.localFolder?.name||"尚未选择文件夹";
  $("#choose-local-folder").textContent=state.localFolder?.name?"更换文件夹":"选择文件夹";
}
$("#choose-local-folder").onclick=chooseLocalFolder;
async function loadSavedLocalFolder(){
  if(!LocalMusic)return;
  try{const result=await LocalMusic.getFolder();if(result?.uri){state.localFolder=result;renderLocalFolder()}}
  catch{state.localFolder=null;renderLocalFolder()}
}
async function searchLocal(q){
  if(!LocalMusic){$("#search-status").textContent="本地音乐功能尚未包含在当前 APK 中，请安装最新构建";return}
  if(!state.localFolder){$("#search-status").textContent="请先选择手机中的音乐文件夹";return}
  $("#search-status").textContent="正在扫描已授权文件夹…";$("#results-list").innerHTML="";
  try{
    const result=await LocalMusic.searchLocalMusic({query:q||""});
    const items=(result.tracks||[]).map(t=>({...t,source:"local"}));
    state.results=items;renderTracks(items,"results-list");
    if(!q.trim()&&items.length){state.homeLocalTracks=items;try{localStorage.setItem("jm_local_tracks",JSON.stringify(items))}catch(e){toast("本地推荐缓存空间不足")}}
    const detail="已检查 "+(result.audioScanned??items.length)+" 个音频文件";
    const limit=result.truncated?" · 本次结果达到扫描上限，缩小文件夹范围或增加关键词可继续查找":"";
    $("#search-status").textContent=items.length?("找到 "+items.length+" 首本地音乐 · "+detail+limit):("没有找到匹配音乐 · "+detail+"；支持 MP3、M4A、AAC、FLAC、WAV、OGG");
  }catch(e){$("#search-status").textContent="读取本地音乐失败："+(e.message||e)}
}
$("#local-search-form").addEventListener("submit",e=>{e.preventDefault();searchLocal($("#local-search-input").value.trim())});

function renderTracks(items,target){
  const el=$("#"+target);
  if(!items.length){el.innerHTML='<div class="empty-note">这里暂时还没有内容</div>';return}
  const selected=state.selectionTarget===target?state.selectedIds:new Set();
  const allSelected=items.length>0&&items.every(t=>selected.has(String(t.id)));
  const toolbar='<div class="bulk-toolbar"><button data-bulk="toggle">'+(state.selectionTarget===target?'退出多选':'多选')+'</button>'+(state.selectionTarget===target?'<button data-bulk="all">'+(allSelected?'取消全选':'全选')+'</button><button data-bulk="fav">批量收藏</button><button data-bulk="playlist">加入歌单</button><button data-bulk="remove">移出列表</button><span>已选 '+selected.size+'</span>':'')+'</div>';
  el.innerHTML=toolbar+items.map((t,i)=>'<div class="track '+(selected.has(String(t.id))?'is-selected':'')+'" data-row-index="'+i+'"><button class="track-select" data-action="select" data-index="'+i+'" aria-label="选择歌曲">'+(selected.has(String(t.id))?'✓':'')+'</button><div class="track-cover">♫</div><div class="track-info"><strong>'+esc(t.title)+'</strong><small>'+esc(t.artist)+(t.year?" · "+esc(t.year):"")+(t.source==="local"?" · 本地":"")+'</small></div><div class="track-actions"><button data-action="play" data-index="'+i+'" title="播放">▶</button><button data-action="fav" data-index="'+i+'" title="收藏">'+(isFav(t)?"♥":"♡")+'</button><button data-action="add" data-index="'+i+'" title="加入歌单">＋</button></div></div>').join("");
  el.querySelectorAll("[data-bulk]").forEach(b=>b.onclick=()=>{
    const action=b.dataset.bulk;
    if(action==="toggle"){state.selectionTarget=state.selectionTarget===target?null:target;state.selectedIds=new Set();renderTracks(items,target);return}
    if(state.selectionTarget!==target)return;
    if(action==="all"){state.selectedIds=allSelected?new Set():new Set(items.map(t=>String(t.id)));renderTracks(items,target);return}
    const chosen=items.filter(t=>state.selectedIds.has(String(t.id)));
    if(!chosen.length){toast("先选择歌曲");return}
    if(action==="fav"){chosen.forEach(t=>{if(!isFav(t))state.favorites.unshift(t)});save();toast("已收藏 "+chosen.length+" 首");renderTracks(items,target)}
    if(action==="playlist"){addManyToPlaylist(chosen);return}
    if(action==="remove"){
      if(target==="library-content")state.favorites=state.favorites.filter(t=>!state.selectedIds.has(String(t.id)));
      else if(target==="playlist-tracks"&&state.activePlaylistId){const p=state.playlists.find(x=>x.id===state.activePlaylistId);if(p)p.tracks=p.tracks.filter(t=>!state.selectedIds.has(String(t.id)))}
      else if(target==="recent-list")state.recent=state.recent.filter(t=>!state.selectedIds.has(String(t.id)));
      else if(target==="results-list")state.results=state.results.filter(t=>!state.selectedIds.has(String(t.id)));
      else {toast("此列表暂不支持移除");return}
      save();toast("已从当前列表移除 "+chosen.length+" 首")
    }
    state.selectedIds=new Set();state.selectionTarget=null;
    if(target==="library-content")renderLibrary();else if(target==="recent-list")renderRecent();
    else if(target==="playlist-tracks"){const p=state.playlists.find(x=>x.id===state.activePlaylistId);renderTracks(p?.tracks||[],target)}
    else renderTracks(target==="results-list"?state.results:items.filter(t=>!chosen.includes(t)),target);
  });
  el.querySelectorAll(".track").forEach(row=>row.onclick=e=>{
    if(e.target.closest("button"))return;
    const i=+row.dataset.rowIndex;
    if(state.selectionTarget===target){const id=String(items[i].id);state.selectedIds.has(id)?state.selectedIds.delete(id):state.selectedIds.add(id);renderTracks(items,target)}
    else playFrom(items,i);
  });
  el.querySelectorAll(".track-actions button,.track-select").forEach(b=>b.onclick=e=>{
    e.stopPropagation();const t=items[+b.dataset.index];
    if(b.dataset.action==="play")playFrom(items,+b.dataset.index);
    if(b.dataset.action==="fav")toggleFav(t);
    if(b.dataset.action==="add")addToPlaylist(t);
    if(b.dataset.action==="select"){if(state.selectionTarget!==target){state.selectionTarget=target;state.selectedIds=new Set()}const id=String(t.id);state.selectedIds.has(id)?state.selectedIds.delete(id):state.selectedIds.add(id);renderTracks(items,target)}
  });
}
function addManyToPlaylist(items){
  if(!state.playlists.length)state.playlists.push({id:Date.now().toString(),name:"稍后再听",tracks:[]});
  const modal=document.createElement("div");modal.className="playlist-picker-overlay";
  modal.innerHTML='<div class="playlist-picker" role="dialog" aria-modal="true" aria-label="选择目标歌单"><div class="picker-head"><strong>加入到歌单</strong><button type="button" data-picker-close aria-label="关闭">×</button></div><p>已选择 '+items.length+' 首歌曲</p><select aria-label="目标歌单">'+state.playlists.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join("")+'</select><div class="picker-actions"><button type="button" data-picker-close>取消</button><button type="button" data-picker-confirm>确认加入</button></div></div>';
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelectorAll("[data-picker-close]").forEach(b=>b.onclick=close);
  modal.onclick=e=>{if(e.target===modal)close()};
  modal.querySelector("[data-picker-confirm]").onclick=()=>{
    const p=state.playlists.find(x=>x.id===modal.querySelector("select").value);if(!p)return;
    items.forEach(t=>{if(!p.tracks.some(x=>x.id===t.id))p.tracks.push(t)});
    save();close();toast("已加入「"+p.name+"」 "+items.length+" 首");
  };
}
function isFav(t){return state.favorites.some(x=>x.id===t.id)}
function toggleFav(t){state.favorites=isFav(t)?state.favorites.filter(x=>x.id!==t.id):[t,...state.favorites];save();renderLibrary();if(state.current?.id===t.id)$("#player-fav").textContent=isFav(t)?"♥":"♡";toast(isFav(t)?"已加入收藏":"已取消收藏")}
function playFrom(items,i){state.queue=[...items];state.index=i;loadCurrent()}
async function loadCurrent(){
  const t=state.queue[state.index];if(!t)return;
  if(typeof renderQueue==="function")renderQueue();
  const request=++playRequest;state.current=t;
  $("#now-title").textContent=t.title;$("#now-artist").textContent=t.artist+(t.source==="local"?" · 本地音乐":"");
  $("#player-fav").textContent=isFav(t)?"♥":"♡";
  state.recent=[t,...state.recent.filter(x=>x.id!==t.id)].slice(0,20);save();renderRecent();
  try{
    let source=t.url;
    if(t.source==="local"){
      if(!LocalMusic)throw Error("本地音乐插件不可用");
      const prepared=await LocalMusic.prepareTrack({uri:t.uri});
      if(request!==playRequest)return;
      source=NativeCapacitor?.convertFileSrc?NativeCapacitor.convertFileSrc(prepared.path):prepared.path;
    }
    if(request!==playRequest)return;
    audio.src=source;await audio.play();
  }catch(e){if(request===playRequest)toast("播放失败："+(e.message||"音源不可用"))}
}
function next(){if(state.queue.length){state.index=(state.index+1)%state.queue.length;loadCurrent()}}
function prev(){if(audio.currentTime>3){audio.currentTime=0;return}if(state.queue.length){state.index=(state.index-1+state.queue.length)%state.queue.length;loadCurrent()}}
$("#play-btn").onclick=()=>{if(!state.current){toast("先去发现页选择一首歌");return}if(audio.paused)audio.play().catch(()=>toast("无法播放此音源"));else audio.pause()};
$("#next-btn").onclick=next;$("#prev-btn").onclick=prev;audio.onended=next;
audio.onplay=()=>$("#play-btn").textContent="Ⅱ";audio.onpause=()=>$("#play-btn").textContent="▶";
audio.ontimeupdate=()=>{if(audio.duration){$("#seek").value=audio.currentTime/audio.duration*1000;$("#current-time").textContent=fmt(audio.currentTime);$("#duration").textContent=fmt(audio.duration)}syncLyrics(audio.currentTime)};
$("#seek").oninput=()=>{if(audio.duration)audio.currentTime=audio.duration*(+$("#seek").value/1000)};
$("#player-fav").onclick=()=>state.current&&toggleFav(state.current);
function renderQueue(){
  $("#queue-count").textContent=state.queue.length+" 首";
  const root=$("#queue-items");
  if(!state.queue.length){root.innerHTML='<div class="empty-note">播放队列还是空的，先选几首喜欢的音乐吧。</div>';return}
  root.innerHTML=state.queue.map((t,i)=>'<div class="queue-track '+(i===state.index?'playing':'')+'" data-queue-index="'+i+'"><span class="queue-number">'+(i===state.index?'♫':String(i+1).padStart(2,'0'))+'</span><div class="queue-track-info"><strong>'+esc(t.title)+'</strong><small>'+esc(t.artist)+'</small></div><button data-queue-remove="'+i+'" aria-label="移除歌曲">×</button></div>').join("");
  root.querySelectorAll(".queue-track").forEach(row=>row.onclick=e=>{if(e.target.closest("[data-queue-remove]"))return;state.index=+row.dataset.queueIndex;loadCurrent();renderQueue()});
  root.querySelectorAll("[data-queue-remove]").forEach(b=>b.onclick=e=>{e.stopPropagation();const i=+b.dataset.queueRemove;state.queue.splice(i,1);if(i<state.index)state.index--;else if(i===state.index){if(state.queue.length){state.index=Math.min(i,state.queue.length-1);loadCurrent()}else{state.index=-1;state.current=null;audio.pause();audio.removeAttribute("src");$("#now-title").textContent="还没有播放歌曲";$("#now-artist").textContent="去发现页找点音乐"}}renderQueue()});
}
function openQueue(){renderQueue();$("#queue-overlay").classList.add("show");$("#queue-drawer").classList.add("show");$("#queue-drawer").setAttribute("aria-hidden","false");$("#queue-overlay").setAttribute("aria-hidden","false")}
function closeQueue(){$("#queue-overlay").classList.remove("show");$("#queue-drawer").classList.remove("show");$("#queue-drawer").setAttribute("aria-hidden","true");$("#queue-overlay").setAttribute("aria-hidden","true")}
$("#queue-btn").onclick=openQueue;$("#queue-close").onclick=closeQueue;$("#queue-overlay").onclick=closeQueue;
$("#queue-clear").onclick=()=>{state.queue=[];state.index=-1;state.current=null;audio.pause();audio.removeAttribute("src");$("#now-title").textContent="还没有播放歌曲";$("#now-artist").textContent="去发现页找点音乐";renderQueue();toast("播放队列已清空")};
let touchStartY=0;$("#queue-drawer").addEventListener("touchstart",e=>{touchStartY=e.touches[0].clientY},{passive:true});
$("#queue-drawer").addEventListener("touchend",e=>{const delta=e.changedTouches[0].clientY-touchStartY;if(delta>75)closeQueue()},{passive:true});
function renderRecent(){renderTracks(state.recent.slice(0,5),"recent-list")}
function renderLocalHome(){
  const root=$("#local-home-list");if(!root)return;
  if(!state.homeLocalTracks.length){root.innerHTML='<div class="local-home-empty"><span>♫</span><div><strong>你的本地音乐还没登场</strong><small>选一次音乐文件夹，之后打开首页就能看到最近扫描的歌曲。</small></div><button id="local-home-action" type="button">选择音乐</button></div>';$("#local-home-action").onclick=()=>{switchTab("search");setSearchSource("local");if(!state.localFolder)chooseLocalFolder();else searchLocal("")};return}
  renderTracks(state.homeLocalTracks.slice(0,6),"local-home-list");
}
function renderLibrary(){
  const root=$("#library-content");$$("[data-library]").forEach(b=>b.classList.toggle("selected",b.dataset.library===state.libraryTab));
  if(state.libraryTab==="favorites"){root.innerHTML="";renderTracks(state.favorites,"library-content");return}
  root.innerHTML='<div class="create-row"><input id="playlist-name" maxlength="24" placeholder="给新歌单起个名字"><button id="create-playlist">创建歌单</button></div><div id="playlist-items"></div>';
  $("#create-playlist").onclick=()=>{const name=$("#playlist-name").value.trim();if(!name){toast("先给歌单起个名字");return}state.playlists.push({id:Date.now().toString(),name,tracks:[]});save();renderLibrary();toast("歌单已创建")};
  const list=$("#playlist-items");if(!state.playlists.length){list.innerHTML='<div class="empty-note">还没有歌单，创建一个自己的音乐角落</div>';return}
  list.innerHTML=state.playlists.map(p=>'<div class="playlist-card"><div><strong>'+esc(p.name)+'</strong><small>'+p.tracks.length+' 首歌曲</small></div><div><button class="text-btn" data-open="'+p.id+'">打开</button> <button class="text-btn" data-delete="'+p.id+'">删除</button></div></div>').join("");
  list.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openPlaylist(b.dataset.open));
  list.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>{state.playlists=state.playlists.filter(p=>p.id!==b.dataset.delete);save();renderLibrary()});
}
$$("[data-library]").forEach(b=>b.onclick=()=>{state.libraryTab=b.dataset.library;renderLibrary()});
function addToPlaylist(t){if(!state.playlists.length)state.playlists.push({id:Date.now().toString(),name:"稍后再听",tracks:[]});const p=state.playlists[state.playlists.length-1];if(!p.tracks.some(x=>x.id===t.id))p.tracks.push(t);save();toast("已加入「"+p.name+"」")}
function openPlaylist(id){const p=state.playlists.find(x=>x.id===id);if(!p)return;state.activePlaylistId=id;state.selectionTarget=null;state.selectedIds=new Set();$("#library-content").innerHTML='<div class="section-head"><h2>'+esc(p.name)+'</h2><button class="text-btn" id="back-playlists">返回</button></div><div id="playlist-tracks"></div>';$("#back-playlists").onclick=renderLibrary;renderTracks(p.tracks,"playlist-tracks")}
renderRecent();renderLibrary();renderLocalFolder();renderLocalHome();loadSavedLocalFolder();
