const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const audio=$("#audio"),LocalMusic=window.JerryLocalMusic||null,NativeCapacitor=window.JerryCapacitor||window.Capacitor||null;
const state={
 results:[],localTracks:[],queue:[],index:-1,current:null,libraryTab:"favorites",searchSource:"online",
 favorites:JSON.parse(localStorage.getItem("jm_favorites")||"[]"),
 playlists:JSON.parse(localStorage.getItem("jm_playlists")||"[]"),
 recent:JSON.parse(localStorage.getItem("jm_recent")||"[]"),localFolder:null,
 selectedIds:[],selectionTarget:null,currentPlaylistId:null,shuffle:false,repeat:"all"
};
let playRequest=0,onlineSearchSeq=0,onlineSearchController=null;
const save=()=>{localStorage.setItem("jm_favorites",JSON.stringify(state.favorites));localStorage.setItem("jm_playlists",JSON.stringify(state.playlists));localStorage.setItem("jm_recent",JSON.stringify(state.recent))};
const saveRecent=()=>localStorage.setItem("jm_recent",JSON.stringify(state.recent));
const esc=s=>String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const toast=s=>{const t=$("#toast");t.textContent=s;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800)};
const fmt=n=>{if(!Number.isFinite(n))return"0:00";return Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0")};
function switchTab(tab){$$(".view").forEach(v=>v.classList.toggle("active",v.id===tab+"-view"));$$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));clearSelection();if(tab==="library")renderLibrary();if(tab==="search"&&state.results.length)renderTracks(state.results,"results-list","results");if(tab==="home"){renderRecent();renderHomeLocal()}}
$$(".nav-item").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
$$("[data-tab]").filter(b=>!b.classList.contains("nav-item")).forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
$("#search-focus").onclick=()=>{switchTab("search");$("#search-input").focus()};
$("#discover-btn").onclick=()=>{switchTab("search");setSearchSource("online");$("#search-input").value="indie music";searchOnline("indie music")};
function setSearchSource(source){state.searchSource=source;clearSelection();$$("[data-source]").forEach(b=>b.classList.toggle("selected",b.dataset.source===source));$("#online-panel").hidden=source!=="online";$("#local-panel").hidden=source!=="local";$("#search-status").textContent=source==="online"?"搜索 Internet Archive 中可在线播放的开放音频":"搜索你授权文件夹中的本地音乐";$("#results-list").innerHTML=""}
$$("[data-source]").forEach(b=>b.addEventListener("click",()=>setSearchSource(b.dataset.source)));
async function searchOnline(q){
 if(!q.trim())return;
 const seq=++onlineSearchSeq;
 if(onlineSearchController)onlineSearchController.abort();
 onlineSearchController=new AbortController();const signal=onlineSearchController.signal;
 $("#search-status").textContent="正在开放音乐档案中寻找…";$("#results-list").innerHTML="";
 try{
  const url="https://archive.org/advancedsearch.php?"+new URLSearchParams({q:q+" AND mediatype:audio",fl:"identifier,title,creator,year,licenseurl",rows:"30",page:"1",output:"json"});
  const res=await fetch(url,{signal});if(!res.ok)throw Error("搜索服务暂时不可用");
  const data=await res.json(),docs=data.response?.docs||[],candidates=docs.slice(0,20),details=new Array(candidates.length);let cursor=0;
  const worker=async()=>{while(cursor<candidates.length&&!signal.aborted){const i=cursor++,d=candidates[i];try{
   const m=await fetch("https://archive.org/metadata/"+encodeURIComponent(d.identifier),{signal});if(!m.ok)continue;
   const j=await m.json(),fs=(j.files||[]).filter(f=>f.name&&/\.(mp3|ogg|flac|m4a|wav)$/i.test(f.name)&&!f.name.includes("__MACOSX"));
   const f=fs.find(x=>x.source==="original"&&(!x.format||/mp3|ogg|flac|mpeg|wave/i.test(x.format)))||fs[0];if(!f)continue;
   const filePath=f.name.split("/").map(encodeURIComponent).join("/");
   details[i]={id:d.identifier,title:d.title||f.title||d.identifier,artist:d.creator||"Internet Archive",year:d.year||"",license:d.licenseurl||j.metadata?.licenseurl||"",url:"https://archive.org/download/"+encodeURIComponent(d.identifier)+"/"+filePath,identifier:d.identifier,source:"online"};
  }catch(e){if(signal.aborted)return}}};
  await Promise.all(Array.from({length:Math.min(4,candidates.length)},worker));if(seq!==onlineSearchSeq)return;
  state.results=details.filter(Boolean);renderTracks(state.results,"results-list","results");
  $("#search-status").textContent=state.results.length?("找到 "+state.results.length+" 首可播放音频 · 请留意每个作品的授权说明"):"没有找到可播放音频，换个关键词试试";
 }catch(e){if(seq===onlineSearchSeq&&!signal.aborted)$("#search-status").textContent="搜索失败："+e.message+"。请检查网络后重试。"}
}
$("#search-form").addEventListener("submit",e=>{e.preventDefault();searchOnline($("#search-input").value)});
$$(".mood").forEach(b=>b.onclick=()=>{switchTab("search");setSearchSource("online");$("#search-input").value=b.dataset.query;searchOnline(b.dataset.query)});
async function chooseLocalFolder(){if(!LocalMusic){toast("本地文件夹功能需要安装新版 APK");return}try{state.localFolder=await LocalMusic.chooseFolder();state.localTracks=[];renderLocalFolder();$("#search-status").textContent="文件夹已授权";toast("已记住音乐文件夹");await loadLocalTracks()}catch(e){if(!String(e?.message||e).toLowerCase().includes("cancel"))toast("选择文件夹失败："+(e.message||e))}}
function renderLocalFolder(){$("#local-folder-name").textContent=state.localFolder?.name||"尚未选择文件夹";$("#choose-local-folder").textContent=state.localFolder?.name?"更换文件夹":"选择文件夹"}
$("#choose-local-folder").onclick=chooseLocalFolder;
$("#home-choose-folder").onclick=chooseLocalFolder;
$("#home-local-open").onclick=()=>{switchTab("search");setSearchSource("local");$("#local-search-input").value="";searchLocal("")};
async function loadSavedLocalFolder(){
 if(!LocalMusic)return;
 try{
  const r=await LocalMusic.getFolder();
  if(!r?.uri){state.localFolder=null;renderLocalFolder();return}
  state.localFolder=r;renderLocalFolder();
  // Cached index is shown before any Storage Access Framework traversal begins.
  if(LocalMusic.getCachedLocalMusic){
   const cached=await LocalMusic.getCachedLocalMusic();
   if(cached?.cached&&Array.isArray(cached.tracks)&&cached.tracks.length){
    state.localTracks=cached.tracks.map(t=>({...t,source:"local"}));renderHomeLocal();
    $("#home-local-count").textContent=state.localTracks.length+" 首 · 已从缓存恢复";
   }
  }
  if(!cached?.cached||!Array.isArray(cached.tracks)||!cached.tracks.length)loadLocalTracks({refresh:true,quiet:true});
 }catch{state.localFolder=null;renderLocalFolder()}
}
async function loadLocalTracks(options={}){
 if(!LocalMusic||!state.localFolder)return [];
 try{
  const r=await LocalMusic.searchLocalMusic({query:"",forceRefresh:!!options.refresh});
  state.localTracks=(r.tracks||[]).map(t=>({...t,source:"local"}));renderHomeLocal();
  $("#home-local-count").textContent=state.localTracks.length+" 首本地音乐";
  return state.localTracks;
 }catch(e){if(!options.quiet)toast("读取本地曲库失败："+(e.message||e));return state.localTracks}
}
async function searchLocal(q){
 if(!LocalMusic){$("#search-status").textContent="请安装包含本地音乐功能的新版 APK";return}
 if(!state.localFolder){$("#search-status").textContent="请先选择手机中的音乐文件夹";return}
 if(!state.localTracks.length){$("#search-status").textContent="首次读取本地曲库…";await loadLocalTracks()}
 const term=(q||"").trim().toLocaleLowerCase();
 state.results=state.localTracks.filter(t=>(t.title+" "+t.artist+" "+t.fileName).toLocaleLowerCase().includes(term));
 renderTracks(state.results,"results-list","results");
 $("#search-status").textContent=state.results.length?"找到 "+state.results.length+" 首本地音乐 · "+(term?"来自已建立的曲库索引":"文件只保留在你的手机上"):"没有找到匹配音乐";
}
$("#local-search-form").addEventListener("submit",e=>{e.preventDefault();searchLocal($("#local-search-input").value.trim())});
function isFav(t){return state.favorites.some(x=>x.id===t.id)}
function clearSelection(){state.selectedIds=[];state.selectionTarget=null}
function toggleSelected(id,target){if(state.selectionTarget!==target){state.selectionTarget=target;state.selectedIds=[]}state.selectedIds=state.selectedIds.includes(id)?state.selectedIds.filter(x=>x!==id):[...state.selectedIds,id]}
function renderTracks(items,target,context="view"){
 const el=$("#"+target);if(!el)return;
 if(!items.length){el.innerHTML='<div class="empty-note">这里暂时还没有内容</div>';return}
 const active=state.selectionTarget===target;
 el.classList.toggle("selection-mode",active);
 const toolbar='<div class="bulk-toolbar"><div class="bulk-left"><button class="text-btn" data-bulk="select">'+(active?"继续选择":"多选")+'</button><span class="bulk-count">'+(active?state.selectedIds.length+" 首已选":"")+'</span></div><div class="bulk-actions" '+(active?"":"hidden")+'><button data-bulk="all">全选</button><button data-bulk="fav">收藏</button><select data-bulk="playlist" aria-label="选择歌单"><option value="">选择歌单</option>'+state.playlists.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join("")+'</select><button data-bulk="add">加入</button><button data-bulk="remove">移除</button><button data-bulk="cancel">取消</button></div></div>';
 el.innerHTML=toolbar+items.map((t,i)=>{const chosen=active&&state.selectedIds.includes(t.id);return '<div class="track '+(chosen?"is-selected":"")+'" data-track-row="'+i+'"><button class="select-dot" data-select="'+i+'" aria-label="选择歌曲">'+(chosen?"✓":"")+'</button><div class="track-cover">♫</div><div class="track-info"><strong>'+esc(t.title)+'</strong><small>'+esc(t.artist)+(t.year?" · "+esc(t.year):"")+(t.source==="local"?" · 本地":"")+'</small></div><div class="track-actions"><button data-action="play" data-index="'+i+'" title="播放">▶</button><button data-action="fav" data-index="'+i+'" title="收藏">'+(isFav(t)?"♥":"♡")+'</button><button data-action="add" data-index="'+i+'" title="加入歌单">＋</button></div></div>'}).join("");
 el.querySelectorAll("[data-track-row]").forEach(row=>row.onclick=e=>{if(e.target.closest("button")||e.target.closest("select"))return;const i=+row.dataset.trackRow;if(state.selectionTarget===target){toggleSelected(items[i].id,target);renderTracks(items,target,context)}else playFrom(items,i)});
 el.querySelectorAll("[data-select]").forEach(b=>b.onclick=e=>{e.stopPropagation();const i=+b.dataset.select;if(state.selectionTarget!==target)state.selectedIds=[];state.selectionTarget=target;toggleSelected(items[i].id,target);renderTracks(items,target,context)});
 el.querySelectorAll("[data-action]").forEach(b=>b.onclick=e=>{e.stopPropagation();const t=items[+b.dataset.index];if(b.dataset.action==="play")playFrom(items,+b.dataset.index);if(b.dataset.action==="fav"){toggleFav(t);if(context!=="favorites")renderTracks(items,target,context)}if(b.dataset.action==="add")addToPlaylist(t)});
 el.querySelectorAll("[data-bulk]").forEach(b=>b.onclick=e=>{e.stopPropagation();const action=b.dataset.bulk;if(action==="select"){state.selectionTarget=target;state.selectedIds=state.selectedIds.length?state.selectedIds:[];renderTracks(items,target,context)}if(action==="all"){state.selectionTarget=target;state.selectedIds=items.map(x=>x.id);renderTracks(items,target,context)}if(action==="cancel"){clearSelection();renderTracks(items,target,context)}if(action==="fav"){const chosen=items.filter(x=>state.selectedIds.includes(x.id));for(const t of chosen)if(!isFav(t))state.favorites.unshift(t);save();toast("已收藏 "+chosen.length+" 首");clearSelection();renderTracks(items,target,context);renderLibrary()}if(action==="remove"){const ids=new Set(state.selectedIds);if(context==="favorites")state.favorites=state.favorites.filter(x=>!ids.has(x.id));else if(context==="playlist"&&state.currentPlaylistId){const p=state.playlists.find(x=>x.id===state.currentPlaylistId);if(p)p.tracks=p.tracks.filter(x=>!ids.has(x.id))}else if(context==="recent")state.recent=state.recent.filter(x=>!ids.has(x.id));else if(context==="home-local")state.localTracks=state.localTracks.filter(x=>!ids.has(x.id));else state.results=state.results.filter(x=>!ids.has(x.id));save();toast("已从当前列表移除 "+ids.size+" 首");clearSelection();if(context==="favorites")renderLibrary();else if(context==="playlist")openPlaylist(state.currentPlaylistId);else if(context==="home-local")renderHomeLocal();else if(context==="recent")renderRecent();else renderTracks(state.results,"results-list","results")}if(action==="add"){const id=b.parentElement.querySelector("[data-bulk=playlist]").value;if(!id){toast("请先选择一个歌单");return}const p=state.playlists.find(x=>x.id===id);const chosen=items.filter(x=>state.selectedIds.includes(x.id));if(p){for(const t of chosen)if(!p.tracks.some(x=>x.id===t.id))p.tracks.push(t);save();toast("已加入「"+p.name+"」 · "+chosen.length+" 首");clearSelection();renderTracks(items,target,context)}}});
}
function toggleFav(t){state.favorites=isFav(t)?state.favorites.filter(x=>x.id!==t.id):[t,...state.favorites];save();if(state.current?.id===t.id)$("#player-fav").textContent=isFav(t)?"♥":"♡";toast(isFav(t)?"已加入收藏":"已取消收藏");if($("#library-view").classList.contains("active"))renderLibrary()}
function playFrom(items,i){state.queue=[...items];state.index=i;loadCurrent();}
async function loadCurrent(){const t=state.queue[state.index];if(!t)return;const request=++playRequest;state.current=t;$("#now-title").textContent=t.title;$("#now-artist").textContent=t.artist+(t.source==="local"?" · 本地音乐":"");$("#full-title").textContent=t.title;$("#full-artist").textContent=t.artist+(t.source==="local"?" · 本地音乐":"");$("#player-fav").textContent=isFav(t)?"♥":"♡";$("#full-fav").textContent=isFav(t)?"♥":"♡";$("#lyrics-panel").innerHTML='<div class="lyrics-placeholder">正在匹配歌曲信息与歌词…</div>';lookupLyrics(t);state.recent=[t,...state.recent.filter(x=>x.id!==t.id)].slice(0,30);saveRecent();if($("#home-view").classList.contains("active"))renderRecent();try{let source=t.url;if(t.source==="local"){if(!LocalMusic)throw Error("本地音乐插件不可用");const prepared=await LocalMusic.prepareTrack({uri:t.uri});if(request!==playRequest)return;source=NativeCapacitor?.convertFileSrc?NativeCapacitor.convertFileSrc(prepared.path):prepared.path}if(request!==playRequest)return;audio.src=source;await audio.play();renderQueue()}catch(e){if(request===playRequest)toast("播放失败："+(e.message||"音源不可用"))}}
function next(){if(!state.queue.length)return;if(state.repeat==="one"){audio.currentTime=0;audio.play();return}if(state.shuffle&&state.queue.length>1){let n=state.index;while(n===state.index)n=Math.floor(Math.random()*state.queue.length);state.index=n}else state.index=state.index+1>=state.queue.length?(state.repeat==="all"?0:-1):state.index+1;if(state.index>=0)loadCurrent();else{audio.pause();audio.currentTime=0}}
function prev(){if(audio.currentTime>3){audio.currentTime=0;return}if(state.queue.length){state.index=(state.index-1+state.queue.length)%state.queue.length;loadCurrent()}}
$("#play-btn").onclick=()=>{if(!state.current){toast("先去本地曲库或发现页选择一首歌");return}if(audio.paused)audio.play().catch(()=>toast("无法播放此音源"));else audio.pause()};
$("#next-btn").onclick=next;$("#prev-btn").onclick=prev;audio.onended=next;audio.onplay=()=>{$("#play-btn").textContent="Ⅱ";$("#full-play").textContent="Ⅱ"};audio.onpause=()=>{$("#play-btn").textContent="▶";$("#full-play").textContent="▶"};
let progressFrame=0;
audio.ontimeupdate=()=>{if(progressFrame)return;progressFrame=requestAnimationFrame(()=>{
 progressFrame=0;if(!audio.duration)return;const p=audio.currentTime/audio.duration*1000;$("#seek").value=p;$("#full-seek").value=p;
 const current=fmt(audio.currentTime),duration=fmt(audio.duration);
 if($("#current-time").textContent!==current)$("#current-time").textContent=current;
 if($("#duration").textContent!==duration)$("#duration").textContent=duration;
 if($("#full-current").textContent!==current)$("#full-current").textContent=current;
 if($("#full-duration").textContent!==duration)$("#full-duration").textContent=duration;syncLyrics(audio.currentTime);});};
$("#seek").oninput=()=>{if(audio.duration)audio.currentTime=audio.duration*(+$("#seek").value/1000)};
$("#full-seek").oninput=()=>{if(audio.duration)audio.currentTime=audio.duration*(+$("#full-seek").value/1000)};
const openFull=()=>{$("#full-player").classList.add("open");$("#full-player").setAttribute("aria-hidden","false")};
$("#mini-player-open").onclick=e=>{if(e.target.closest("#player-fav"))return;openFull()};
$("#player").addEventListener("click",e=>{if(!e.target.closest("button,input"))openFull()});
$("#full-close").onclick=()=>{$("#full-player").classList.remove("open");$("#full-player").setAttribute("aria-hidden","true")};
$("#full-queue").onclick=()=>openQueue();
$("#full-play").onclick=()=>$("#play-btn").click();
$("#full-prev").onclick=prev;$("#full-next").onclick=next;
$("#full-shuffle").onclick=()=>$("#shuffle-btn").click();$("#full-repeat").onclick=()=>$("#repeat-btn").click();
$("#full-fav").onclick=()=>state.current&&toggleFav(state.current);
$("#queue-btn").onclick=()=>{$("#queue-panel").classList.contains("open")?closeQueue():openQueue()};
$("#eq-open").onclick=()=>$("#eq-panel").classList.add("open");$("#eq-close").onclick=()=>$("#eq-panel").classList.remove("open");
let eqContext=null,eqSource=null,eqLow=null,eqMid=null,eqHigh=null;
function setupEQ(){
 if(eqContext)return;
 try{
  eqContext=new (window.AudioContext||window.webkitAudioContext)();
  eqSource=eqContext.createMediaElementSource(audio);
  eqLow=eqContext.createBiquadFilter();eqLow.type="lowshelf";eqLow.frequency.value=180;
  eqMid=eqContext.createBiquadFilter();eqMid.type="peaking";eqMid.frequency.value=1000;eqMid.Q.value=0.8;
  eqHigh=eqContext.createBiquadFilter();eqHigh.type="highshelf";eqHigh.frequency.value=5000;
  eqSource.connect(eqLow);eqLow.connect(eqMid);eqMid.connect(eqHigh);eqHigh.connect(eqContext.destination);
 }catch(e){toast("当前设备暂不支持 EQ："+e.message)}
}
function setEQ(low,mid,high){setupEQ();if(!eqContext)return;if(eqContext.state==="suspended")eqContext.resume();eqLow.gain.value=low;eqMid.gain.value=mid;eqHigh.gain.value=high;$("#eq-low").value=low;$("#eq-mid").value=mid;$("#eq-high").value=high}
["low","mid","high"].forEach(k=>$("#eq-"+k).oninput=()=>setEQ(+$("#eq-low").value,+$("#eq-mid").value,+$("#eq-high").value));
$("[data-eq]").forEach(b=>b.onclick=()=>{const p=b.dataset.eq;const v=p==="bass"?[8,3,0]:p==="vocal"?[-3,6,2]:p==="treble"?[0,2,8]:[0,0,0];setEQ(...v);$("[data-eq]").forEach(x=>x.classList.toggle("eq-selected",x===b));toast(({flat:"原声",bass:"低音增强",vocal:"人声增强",treble:"高音增强"})[p]+" 已应用")});
let lyricLines=[],lyricRequest=0,lastActiveLyric=-1;
async function lookupLyrics(track){
 const id=++lyricRequest,panel=$("#lyrics-panel");panel.innerHTML='<div class="lyrics-placeholder">正在匹配国内歌词源…</div>';lyricLines=[];
 const renderLrc=lrc=>{lastActiveLyric=-1;lyricLines=(lrc||"").split(/\r?\n/).flatMap(line=>{const m=[...line.matchAll(/\[(\\d{2}):(\\d{2})(?:\.(\\d{1,3}))?\]/g)],text=line.replace(/\[[^\]]+\]/g,"").trim();return m.map(x=>({time:+x[1]*60 + +x[2] + (x[3]?+(x[3].padEnd(3,"0"))/1000:0),text}))}).filter(x=>x.text).sort((x,y)=>x.time-y.time);panel.innerHTML=lyricLines.length?lyricLines.map((l,i)=>'<p data-lyric="'+i+'">'+esc(l.text)+'</p>').join(""):'<div class="lyrics-placeholder">歌词未含时间轴</div>'};
 const get=async url=>{const c=new AbortController(),timer=setTimeout(()=>c.abort(),6500);try{const r=await fetch(url,{signal:c.signal});if(!r.ok)throw Error();return await r.json()}finally{clearTimeout(timer)}};
 try{
  // 优先网易云公开检索接口，按歌名搜索后取对应 LRC
  const data=await get("https://music.163.com/api/search/get?"+new URLSearchParams({s:(track.title||"")+" "+(track.artist||""),type:"1",limit:"6"}));if(id!==lyricRequest)return;
  const songs=data?.result?.songs||[],song=songs.find(x=>(x.name||"").toLowerCase()===(track.title||"").toLowerCase())||songs[0];
  if(song?.id){const lyric=await get("https://music.163.com/api/song/lyric?"+new URLSearchParams({id:String(song.id),lv:"1",kv:"1",tv:"1"}));if(id!==lyricRequest)return;if(lyric?.lrc?.lyric){$("#full-title").textContent=song.name||track.title;$("#full-artist").textContent=(song.artists||[]).map(x=>x.name).join("/")||track.artist;renderLrc(lyric.lrc.lyric);return}}
 }catch(e){}
 // fallback
 try{const hits=await get("https://lrclib.net/api/search?"+new URLSearchParams({track_name:track.title||"",artist_name:track.artist||""}));if(id!==lyricRequest)return;const best=(hits||[]).find(x=>x.syncedLyrics)||(hits||[])[0];if(best){$("#full-title").textContent=best.trackName||track.title;$("#full-artist").textContent=best.artistName||track.artist;if(best.syncedLyrics)renderLrc(best.syncedLyrics);else panel.innerHTML='<div class="lyrics-placeholder">'+esc(best.plainLyrics||"未找到歌词")+'</div>';return}}catch(e){}
 if(id===lyricRequest)panel.innerHTML='<div class="lyrics-placeholder">歌词获取失败，可能受网络或接口跨域限制。请重试。</div>';
}
function syncLyrics(time){
 if(!lyricLines.length)return;let lo=0,hi=lyricLines.length-1,active=-1;
 while(lo<=hi){const mid=(lo+hi)>>1;if(lyricLines[mid].time<=time){active=mid;lo=mid+1}else hi=mid-1}
 if(active===lastActiveLyric)return;const panel=$("#lyrics-panel");
 if(lastActiveLyric>=0){const previous=panel.querySelector('[data-lyric="'+lastActiveLyric+'"]');if(previous)previous.classList.remove("active")}
 lastActiveLyric=active;const current=active>=0?panel.querySelector('[data-lyric="'+active+'"]'):null;
 if(current){current.classList.add("active");const target=Math.max(0,current.offsetTop-panel.clientHeight/2+current.clientHeight/2);panel.scrollTo({top:target,behavior:"smooth"})}
}
$("#lyrics-retry").onclick=()=>state.current&&lookupLyrics(state.current);
$("#player-fav").onclick=()=>state.current&&toggleFav(state.current);
$("#shuffle-btn").onclick=()=>{state.shuffle=!state.shuffle;$("#shuffle-btn").classList.toggle("control-active",state.shuffle);toast(state.shuffle?"随机播放已开启":"随机播放已关闭")};
$("#repeat-btn").onclick=()=>{state.repeat=state.repeat==="all"?"one":state.repeat==="one"?"off":"all";$("#repeat-btn").classList.toggle("control-active",state.repeat!=="off");$("#repeat-btn").textContent=state.repeat==="one"?"↻¹":"↻";toast(state.repeat==="all"?"列表循环":state.repeat==="one"?"单曲循环":"关闭循环")};
function renderQueue(){const el=$("#queue-list");if(!el)return;el.innerHTML=state.queue.length?state.queue.map((t,i)=>'<div class="queue-track '+(i===state.index?"playing":"")+'" data-q="'+i+'"><span>'+(i===state.index?"♫":i+1)+'</span><div><strong>'+esc(t.title)+'</strong><small>'+esc(t.artist)+'</small></div></div>').join(""):'<div class="empty-note">播放队列为空</div>';el.querySelectorAll("[data-q]").forEach(x=>x.onclick=()=>{state.index=+x.dataset.q;loadCurrent()})}
function openQueue(){$("#queue-panel").classList.add("open");renderQueue()}
function closeQueue(){$("#queue-panel").classList.remove("open")}
const queuePanel=$("#queue-panel");document.addEventListener("pointerdown",e=>{if(queuePanel.classList.contains("open")&&!queuePanel.contains(e.target)&&!e.target.closest("#queue-btn")&&!e.target.closest("#full-queue"))closeQueue()});let qTouchX=0,qTouchY=0;queuePanel.addEventListener("touchstart",e=>{qTouchX=e.changedTouches[0].clientX;qTouchY=e.changedTouches[0].clientY},{passive:true});queuePanel.addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-qTouchX,dy=e.changedTouches[0].clientY-qTouchY;if(dx>65&&Math.abs(dx)>Math.abs(dy))closeQueue()},{passive:true});\n$("#queue-close").onclick=closeQueue;
function renderRecent(){if(!$("#home-view").classList.contains("active"))return;renderTracks(state.recent.slice(0,8),"recent-list","recent")}
function renderHomeLocal(){const el=$("#home-local-list");if(!el)return;$("#home-local-count").textContent=state.localTracks.length?state.localTracks.length+" 首已读取":"选择文件夹后自动读取";if(!$("#home-view").classList.contains("active"))return;const tracks=state.localTracks.slice(0,8);renderTracks(tracks,"home-local-list","home-local")}
function renderLibrary(){const root=$("#library-content");$$("[data-library]").forEach(b=>b.classList.toggle("selected",b.dataset.library===state.libraryTab));if(state.libraryTab==="favorites"){root.innerHTML="";renderTracks(state.favorites,"library-content","favorites");return}root.innerHTML='<div class="create-row"><input id="playlist-name" maxlength="24" placeholder="给新歌单起个名字"><button id="create-playlist">创建歌单</button></div><div id="playlist-items"></div>';$("#create-playlist").onclick=()=>{const name=$("#playlist-name").value.trim();if(!name){toast("先给歌单起个名字");return}state.playlists.push({id:Date.now().toString(),name,tracks:[]});save();renderLibrary();toast("歌单已创建")};const list=$("#playlist-items");if(!state.playlists.length){list.innerHTML='<div class="empty-note">还没有歌单，创建一个自己的音乐角落</div>';return}list.innerHTML=state.playlists.map(p=>'<div class="playlist-card" data-open="'+p.id+'"><div><strong>'+esc(p.name)+'</strong><small>'+p.tracks.length+' 首歌曲</small></div><div><button class="text-btn" data-open-btn="'+p.id+'">打开</button> <button class="text-btn" data-delete="'+p.id+'">删除</button></div></div>').join("");list.querySelectorAll("[data-open-btn]").forEach(b=>b.onclick=e=>{e.stopPropagation();openPlaylist(b.dataset.openBtn)});list.querySelectorAll(".playlist-card").forEach(b=>b.onclick=e=>{if(!e.target.closest("[data-delete]"))openPlaylist(b.dataset.open)});list.querySelectorAll("[data-delete]").forEach(b=>b.onclick=e=>{e.stopPropagation();state.playlists=state.playlists.filter(p=>p.id!==b.dataset.delete);save();renderLibrary()})}
$$("[data-library]").forEach(b=>b.onclick=()=>{state.libraryTab=b.dataset.library;clearSelection();renderLibrary()});
function addToPlaylist(t){if(!state.playlists.length)state.playlists.push({id:Date.now().toString(),name:"稍后再听",tracks:[]});const p=state.playlists[state.playlists.length-1];if(!p.tracks.some(x=>x.id===t.id))p.tracks.push(t);save();toast("已加入「"+p.name+"」")}
function openPlaylist(id){const p=state.playlists.find(x=>x.id===id);if(!p)return;state.currentPlaylistId=id;$("#library-content").innerHTML='<div class="section-head"><h2>'+esc(p.name)+'</h2><button class="text-btn" id="back-playlists">返回歌单</button></div><div id="playlist-tracks"></div>';$("#back-playlists").onclick=()=>{state.currentPlaylistId=null;renderLibrary()};renderTracks(p.tracks,"playlist-tracks","playlist")}
renderRecent();renderLibrary();renderLocalFolder();loadSavedLocalFolder();