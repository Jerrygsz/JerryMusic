import { LyricsEngine, parseLrc } from "./lyrics.js";
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const audio=$("#audio");
const LocalMusic=window.JerryLocalMusic||null;
const NativeCapacitor=window.JerryCapacitor||window.Capacitor||null;
const lyricsEngine=new LyricsEngine();
let lyricsRequest=0;
let lyricLines=[];
let activeLyricIndex=-1;
let lyricOffsetByTrack={};
try{lyricOffsetByTrack=JSON.parse(localStorage.getItem('jm_lyrics_offsets_v1')||'{}')||{}}catch{lyricOffsetByTrack={}}
const lyricOffsetStep=0.5;
function currentLyricOffset(){return state.current?Number(lyricOffsetByTrack[String(state.current.id)]||0):0}
function renderLyricOffset(){const label=$('#lyrics-offset-value');if(label){const value=currentLyricOffset();label.textContent=(value>0?'+':'')+value.toFixed(1)+'s'}}
function adjustLyricOffset(delta){if(!state.current){toast('请先播放歌曲');return}const id=String(state.current.id);const next=Math.max(-15,Math.min(15,Math.round((currentLyricOffset()+delta)*10)/10));lyricOffsetByTrack[id]=next;try{localStorage.setItem('jm_lyrics_offsets_v1',JSON.stringify(lyricOffsetByTrack))}catch{}renderLyricOffset();activeLyricIndex=-1;syncLyrics(audio.currentTime||0,true);toast('歌词同步 '+(next>0?'+':'')+next.toFixed(1)+' 秒')}
function readStoredArray(key){
  try{
    const raw=localStorage.getItem(key);
    if(!raw)return [];
    const value=JSON.parse(raw);
    if(Array.isArray(value))return value;
    console.warn("[JerryMusic] Ignoring invalid stored array:",key);
    return [];
  }catch(error){
    console.warn("[JerryMusic] Could not read stored data:",key,error);
    return [];
  }
}
const state={
  results:[],queue:[],index:-1,current:null,libraryTab:"favorites",
  favorites:readStoredArray("jm_favorites"),
  playlists:readStoredArray("jm_playlists"),
  recent:readStoredArray("jm_recent"),
  localFolder:null,selectionTarget:null,selectedIds:new Set(),activePlaylistId:null,homeLocalTracks:readStoredArray("jm_local_tracks")
};
let playRequest=0;
const save=()=>{localStorage.setItem("jm_favorites",JSON.stringify(state.favorites));localStorage.setItem("jm_playlists",JSON.stringify(state.playlists));localStorage.setItem("jm_recent",JSON.stringify(state.recent))};
const esc=s=>String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function trackArtworkUrl(track){
  if(!track?.artworkPath||!NativeCapacitor?.convertFileSrc)return "";
  try{return NativeCapacitor.convertFileSrc(track.artworkPath)||""}catch{return ""}
}
function renderPlayerArtwork(track){
  const cover=$(".cover-mini"),src=trackArtworkUrl(track);
  cover.innerHTML=src?'<img src="'+esc(src)+'" alt="" decoding="async">':"♫";
}
const toast=s=>{const t=$("#toast");t.textContent=s;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800)};
function hapticFeedback(kind="light"){
  const native=window.JerryHaptics;
  if(native){
    try{
      if(kind==="success"&&typeof native.success==="function")native.success();
      else if(typeof native.tap==="function")native.tap();
      return;
    }catch(error){console.debug("[JerryMusic] Haptics unavailable:",error)}
  }
  if(typeof navigator!=="undefined"&&typeof navigator.vibrate==="function")navigator.vibrate(kind==="success"?14:8);
}
document.addEventListener("click",event=>{
  const target=event.target instanceof Element?event.target.closest("button,.track,.playlist-card,.queue-track"):null;
  if(!target||target.disabled||target.dataset.haptic==="none")return;
  hapticFeedback("light");
},{passive:true});
const fmt=n=>{if(!Number.isFinite(n))return"0:00";return Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0")};
const readStoredObject=key=>{try{const value=JSON.parse(localStorage.getItem(key)||"{}");return value&&typeof value==="object"&&!Array.isArray(value)?value:{}}catch{return{}}};
const PLAY_STATS_KEY="jm_play_stats_v1",PLAY_HISTORY_KEY="jm_play_history_v1",LISTEN_TOTAL_KEY="jm_listen_seconds_v1";
let playStats=readStoredObject(PLAY_STATS_KEY),playHistory=readStoredArray(PLAY_HISTORY_KEY),totalListenSeconds=Number(localStorage.getItem(LISTEN_TOTAL_KEY)||0)||0;
let currentPlayRecorded=false,lastStatsTick=0,lastStatsPersistAt=0;
function statsKey(track){return String(track?.id||track?.uri||track?.fileName||track?.title||"")}
function persistStats(){try{localStorage.setItem(PLAY_STATS_KEY,JSON.stringify(playStats));localStorage.setItem(PLAY_HISTORY_KEY,JSON.stringify(playHistory.slice(0,2000)));localStorage.setItem(LISTEN_TOTAL_KEY,String(Math.floor(totalListenSeconds)))}catch(error){console.warn("[JerryMusic] Could not persist listening statistics:",error)}}
function recordTrackPlay(track){if(!track)return;const key=statsKey(track),now=Date.now(),entry=playStats[key]||{track:{id:track.id,uri:track.uri,fileName:track.fileName,title:track.title,artist:track.artist,source:"local"},playCount:0,listenedSeconds:0,firstPlayedAt:now,lastPlayedAt:0};entry.track={...entry.track,...track,source:"local"};entry.playCount=(entry.playCount||0)+1;entry.lastPlayedAt=now;if(!entry.firstPlayedAt)entry.firstPlayedAt=now;playStats[key]=entry;playHistory.unshift({key,title:track.title||"未知歌曲",artist:track.artist||"",playedAt:now});if(playHistory.length>2000)playHistory.length=2000;persistStats();renderHomeDashboard()}
function formatListeningTime(seconds){const total=Math.max(0,Math.floor(seconds||0)),hours=Math.floor(total/3600),minutes=Math.floor(total%3600/60);return hours?hours+"小时"+minutes+"分":minutes+"分钟"}
function renderHomeDashboard(){
  const stats=Object.values(playStats),count=stats.reduce((sum,item)=>sum+(item.playCount||0),0),unique=stats.length;
  const set=(id,value)=>{const node=$("#"+id);if(node)node.textContent=value};
  set("home-track-count",state.homeLocalTracks.length);
  set("home-play-count",count);
  set("home-listen-time",formatListeningTime(totalListenSeconds));
  set("home-unique-count",unique);
  const rankedAll=stats.filter(item=>item.track?.title).sort((a,b)=>(b.playCount||0)-(a.playCount||0)).slice(0,10).map(item=>({...item.track,source:"local"}));
  const now=Date.now(),weekCounts={},monthCounts={};
  for(const event of playHistory){if(!event?.key||!event.playedAt)continue;const age=now-event.playedAt;if(age<=7*86400000)weekCounts[event.key]=(weekCounts[event.key]||0)+1;if(age<=30*86400000)monthCounts[event.key]=(monthCounts[event.key]||0)+1}
  const buildRank=counts=>Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([key])=>playStats[key]?.track).filter(Boolean).map(track=>({...track,source:"local"}));
  const renderRank=(id,tracks,empty)=>{const root=$("#"+id);if(!root)return;if(tracks.length)renderTracks(tracks,id);else root.innerHTML='<div class="empty-note">'+empty+'</div>'};
  renderRank("top-played-list",rankedAll,"开始播放本地音乐，这里会慢慢形成你的私人排行榜。");
  renderRank("top-played-week-list",buildRank(weekCounts),"最近 7 天还没有足够的播放记录。");
  renderRank("top-played-month-list",buildRank(monthCounts),"最近 30 天还没有足够的播放记录。");
}
function switchTab(tab){$$(".view").forEach(v=>v.classList.toggle("active",v.id===tab+"-view"));$$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));if(tab==="library")renderLibrary();if(tab==="home"){renderRecent();renderLocalHome();renderHomeDashboard()}}
$$(".nav-item").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
$$("[data-tab]").filter(b=>!b.classList.contains("nav-item")).forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
$("#search-focus").onclick=()=>{switchTab("search");$("#local-search-input").focus()};
$("#local-home-more").onclick=()=>{switchTab("search");if(state.localFolder)searchLocal("");else chooseLocalFolder()};
$("#local-home-more-alt").onclick=()=>$("#local-home-more").click();

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
const onlineEnrichmentInFlight=new Set();
let localSearchSequence=0;
function applyEnrichedTrack(track,remote){
  const fields=["album","albumArtist","year","genre","artworkPath","musicBrainzRecordingId","musicBrainzReleaseId"];
  const merge=item=>{
    if(!item||item.id!==track.id)return item;
    const next={...item};
    for(const field of fields){
      if(remote[field] && (!next[field] || field==="artworkPath")) next[field]=remote[field];
    }
    return next;
  };
  state.results=state.results.map(merge);
  state.homeLocalTracks=state.homeLocalTracks.map(merge);
  state.recent=state.recent.map(merge);
  state.favorites=state.favorites.map(merge);
  state.playlists=state.playlists.map(p=>({...p,tracks:(p.tracks||[]).map(merge)}));
  state.queue=state.queue.map(merge);
  if(state.current?.id===track.id){
    state.current=merge(state.current);
    $("#now-artist").textContent=state.current.artist+(state.current.album?" · "+state.current.album:"")+" · 本地音乐";
    renderPlayerArtwork(state.current);
    updateMediaSession(state.current);
  }
  try{localStorage.setItem("jm_local_tracks",JSON.stringify(state.homeLocalTracks))}catch{}
  save();
  if($("#results-list"))renderTracks(state.results,"results-list");
  if($("#local-home-list"))renderLocalHome();
  if($("#recent-list"))renderRecent();
  renderHomeDashboard();
  if(state.libraryTab==="favorites"&&$("#library-content"))renderLibrary();
}
async function enrichMissingTracks(items,sequence){
  if(!LocalMusic||!items?.length)return;
  let newLookups=0,changed=0;
  for(const track of items){
    if(newLookups>=5)break;
    if(!track?.uri||!track.title||!track.artist||track.artist==="本地音乐")continue;
    if(track.artworkPath&&track.album&&track.albumArtist&&track.year&&track.genre)continue;
    if(onlineEnrichmentInFlight.has(track.id))continue;
    onlineEnrichmentInFlight.add(track.id);
    try{
      const result=await LocalMusic.enrichTrack({
        uri:track.uri,title:track.title,artist:track.artist,
        album:track.album||"",durationMs:String(track.durationMs||"")
      });
      if(result?.reason==="recently_checked"||result?.reason==="already_complete")continue;
      if(result?.reason==="no_confident_match"||result?.reason==="no_matching_release"||result?.updated)newLookups++;
      if(result?.updated){
        applyEnrichedTrack(track,result);
        changed++;
      }
    }catch(error){
      console.debug("[JerryMusic] Online metadata lookup paused:",error);
      break;
    }finally{
      onlineEnrichmentInFlight.delete(track.id);
    }
    if(sequence===localSearchSequence){
      $("#search-status").textContent="本地扫描完成 · 在线资料匹配 "+newLookups+"/5"+(changed?" · 已补全 "+changed+" 首":"");
    }
  }
  if(sequence===localSearchSequence&&newLookups>0){
    $("#search-status").textContent="本地扫描完成 · 本轮在线检查 "+newLookups+" 首"+(changed?"，成功补全 "+changed+" 首":"，未找到足够可靠的匹配");
  }
}
async function searchLocal(q){
  if(!LocalMusic){$("#search-status").textContent="本地音乐功能尚未包含在当前 APK 中，请安装最新构建";return}
  if(!state.localFolder){$("#search-status").textContent="请先选择手机中的音乐文件夹";return}
  const sequence=++localSearchSequence;
  $("#search-status").textContent="正在扫描已授权文件夹…";$("#results-list").innerHTML="";
  try{
    const result=await LocalMusic.searchLocalMusic({query:q||""});
    const items=(result.tracks||[]).map(t=>({...t,source:"local"}));
    state.results=items;renderTracks(items,"results-list");
    if(!q.trim()&&items.length){state.homeLocalTracks=items;try{localStorage.setItem("jm_local_tracks",JSON.stringify(items))}catch(e){toast("本地推荐缓存空间不足")}}
    const detail="已检查 "+(result.audioScanned??items.length)+" 个音频文件";
    const limit=result.truncated?" · 本次结果达到扫描上限，缩小文件夹范围或增加关键词可继续查找":"";
    $("#search-status").textContent=items.length?("找到 "+items.length+" 首本地音乐 · "+detail+limit):("没有找到匹配音乐 · "+detail+"；支持 MP3、M4A、AAC、FLAC、WAV、OGG");
    if(!q.trim()&&items.length)void enrichMissingTracks(items,sequence);
  }catch(e){$("#search-status").textContent="读取本地音乐失败："+(e.message||e)}
}
$("#local-search-form").addEventListener("submit",e=>{e.preventDefault();searchLocal($("#local-search-input").value.trim())});

function renderTracks(items,target){
  const el=$("#"+target);
  if(!items.length){el.innerHTML='<div class="empty-note">这里暂时还没有内容</div>';return}
  const selected=state.selectionTarget===target?state.selectedIds:new Set();
  const allSelected=items.length>0&&items.every(t=>selected.has(String(t.id)));
  const toolbar='<div class="bulk-toolbar"><button data-bulk="toggle">'+(state.selectionTarget===target?'退出多选':'多选')+'</button>'+(state.selectionTarget===target?'<button data-bulk="all">'+(allSelected?'取消全选':'全选')+'</button><button data-bulk="fav">批量收藏</button><button data-bulk="playlist">加入歌单</button><button data-bulk="remove">移出列表</button><span>已选 '+selected.size+'</span>':'')+'</div>';
  el.innerHTML=toolbar+items.map((t,i)=>'<div class="track '+(selected.has(String(t.id))?'is-selected':'')+'" data-row-index="'+i+'"><button class="track-select" data-action="select" data-index="'+i+'" aria-label="选择歌曲">'+(selected.has(String(t.id))?'✓':'')+'</button><div class="track-cover">'+(trackArtworkUrl(t)?'<img src="'+esc(trackArtworkUrl(t))+'" alt="" loading="lazy" decoding="async">':'♫')+'</div><div class="track-info"><strong>'+esc(t.title)+'</strong><small>'+esc(t.artist)+(t.album?" · "+esc(t.album):"")+(t.year?" · "+esc(t.year):"")+(t.source==="local"?" · 本地":"")+'</small></div><div class="track-actions"><button data-action="play" data-index="'+i+'" title="播放">▶</button><button data-action="fav" data-index="'+i+'" title="收藏">'+(isFav(t)?"♥":"♡")+'</button><button data-action="add" data-index="'+i+'" title="加入歌单">＋</button></div></div>').join("");
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
let trackChangeTimer=null;
function animateTrackChange(){
  clearTimeout(trackChangeTimer);
  player.classList.remove("is-changing-track");
  void player.offsetWidth;
  player.classList.add("is-changing-track");
  trackChangeTimer=setTimeout(()=>player.classList.remove("is-changing-track"),460);
}
function setTrackLoading(loading){
  player.classList.toggle("is-loading",loading);
  const button=$("#play-btn");
  button.classList.toggle("is-loading",loading);
  button.setAttribute("aria-busy",String(loading));
  button.disabled=loading;
  syncPlaybackButton();
}
async function loadCurrent(){
  const t=state.queue[state.index];if(!t)return;if(t.source!=="local"||!t.uri){toast("这是旧版本的在线曲目记录；JerryMusic 现在只播放本地音乐");return;}
  if(typeof renderQueue==="function")renderQueue();
  const request=++playRequest;
  audio.pause();
  state.current=t;
  setTrackLoading(true);
  $("#current-time").textContent="0:00";$("#duration").textContent="0:00";seek.value=0;
  loadLyricsForCurrent(t);
  $("#now-title").textContent=t.title;$("#now-artist").textContent=t.artist+(t.album?" · "+t.album:"")+(t.source==="local"?" · 本地音乐":"");renderPlayerArtwork(t);animateTrackChange();updateMediaSession(t);
  $("#player-fav").textContent=isFav(t)?"♥":"♡";
  state.recent=[t,...state.recent.filter(x=>x.id!==t.id)].slice(0,500);save();renderRecent();currentPlayRecorded=false;lastStatsTick=0;
  try{
    if(!LocalMusic)throw Error("本地音乐插件不可用");
    const prepared=await LocalMusic.prepareTrack({uri:t.uri});
    if(request!==playRequest)return;
    const source=NativeCapacitor?.convertFileSrc?NativeCapacitor.convertFileSrc(prepared.path):prepared.path;
    if(request!==playRequest)return;
    audio.src=source;
    setTrackLoading(false);
    await audio.play();
  }catch(e){if(request===playRequest){setTrackLoading(false);toast("播放失败："+(e.message||"音源不可用"))}}
}
function next(){if(state.queue.length){state.index=(state.index+1)%state.queue.length;loadCurrent()}}
function prev(){if(audio.currentTime>3){audio.currentTime=0;return}if(state.queue.length){state.index=(state.index-1+state.queue.length)%state.queue.length;loadCurrent()}}
$("#play-btn").onclick=()=>{if(!state.current){toast("先去发现页选择一首歌");return}if(audio.paused)audio.play().catch(()=>toast("无法播放此音源"));else audio.pause()};
$("#next-btn").onclick=next;$("#prev-btn").onclick=prev;audio.onended=()=>{persistStats();next()};
function syncPlaybackButton(){
  const button=$("#play-btn"),loading=button.classList.contains("is-loading"),playing=!audio.paused;
  button.textContent=loading?"…":playing?"Ⅱ":"▶";
  button.setAttribute("aria-label",loading?"正在加载歌曲":playing?"暂停":"播放");
  button.setAttribute("aria-pressed",String(playing));
  button.classList.toggle("is-playing",playing&&!loading);
}
audio.onplay=()=>{syncPlaybackButton();if(!currentPlayRecorded){currentPlayRecorded=true;recordTrackPlay(state.current)}lastStatsTick=audio.currentTime||0};
audio.onpause=()=>{syncPlaybackButton();lastStatsTick=0;persistStats();lastStatsPersistAt=Date.now()};
const seek=$("#seek");
let isSeeking=false;
function updateSeekLabel(){
  seek.setAttribute("aria-valuetext",fmt(audio.currentTime||0)+" / "+fmt(audio.duration||0));
}
seek.addEventListener("pointerdown",()=>{isSeeking=true;$("#player .progress-wrap").classList.add("is-seeking")});
seek.addEventListener("pointercancel",()=>{isSeeking=false;$("#player .progress-wrap").classList.remove("is-seeking")});
seek.addEventListener("change",()=>{isSeeking=false;$("#player .progress-wrap").classList.remove("is-seeking");updateSeekLabel()});
audio.ontimeupdate=()=>{if(audio.duration){if(!isSeeking)seek.value=audio.currentTime/audio.duration*1000;$("#current-time").textContent=fmt(audio.currentTime);$("#duration").textContent=fmt(audio.duration);updateSeekLabel()}if(!audio.paused&&state.current){const now=audio.currentTime||0,delta=now-lastStatsTick;if(delta>0&&delta<=5){totalListenSeconds+=delta;const entry=playStats[statsKey(state.current)];if(entry)entry.listenedSeconds=(entry.listenedSeconds||0)+delta;if(Date.now()-lastStatsPersistAt>=10000){persistStats();lastStatsPersistAt=Date.now()}}lastStatsTick=now}syncLyrics(audio.currentTime)};
seek.oninput=()=>{if(audio.duration){isSeeking=true;audio.currentTime=audio.duration*(+seek.value/1000);updateSeekLabel()}};
$("#player-fav").onclick=()=>state.current&&toggleFav(state.current);
function setLyricsStatus(message){$("#lyrics-status").textContent=message}
function renderLyrics(result){
  const root=$("#lyrics-lines");
  root.replaceChildren();
  lyricLines=result?.lines||[];
  activeLyricIndex=-1;
  if(!lyricLines.length){root.innerHTML='<div class="lyrics-empty">暂时没有找到匹配歌词</div>';const expanded=$("#expanded-lyrics");if(expanded)expanded.innerHTML=root.innerHTML;return}
  lyricLines.forEach((line,index)=>{
    const row=document.createElement("div");
    row.className="lyric-line";
    row.dataset.index=String(index);
    row.textContent=line.text;
    root.appendChild(row);
  });
  const expanded=$("#expanded-lyrics");if(expanded)expanded.innerHTML=root.innerHTML;
}
const manualLyricsKey="jm_manual_lyrics_v1";
function trackLyricsKey(track){return String(track?.id||track?.uri||track?.fileName||track?.title||"")}
function readManualLyrics(track){try{const data=JSON.parse(localStorage.getItem(manualLyricsKey)||"{}");return data[trackLyricsKey(track)]||null}catch{return null}}
function saveManualLyrics(track,result){try{const data=JSON.parse(localStorage.getItem(manualLyricsKey)||"{}");data[trackLyricsKey(track)]=result;localStorage.setItem(manualLyricsKey,JSON.stringify(data))}catch(error){toast("歌词保存失败，存储空间可能不足")}}
function loadManualLyrics(track,result){renderLyrics(result);setLyricsStatus("手动导入歌词 · 已保存");syncLyrics(audio.currentTime||0,true)}
$("#lyrics-import-btn").onclick=()=>$("#lyrics-file-input").click();
$("#lyrics-file-input").addEventListener("change",async event=>{
 const file=event.target.files?.[0];event.target.value="";if(!file||!state.current)return;
 try{
  let text=await file.text();if(text.charCodeAt(0)===0xFEFF)text=text.slice(1);
  const lines=parseLrc(text),timed=lines.length>0,plain=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(s=>({time:null,text:s}));
  if(!timed&&!plain.length){toast("文件中没有可显示的歌词");return}
  const result={lines:timed?lines:plain,synced:timed,plainLyrics:text,source:"手动导入",instrumental:false};
  saveManualLyrics(state.current,result);loadManualLyrics(state.current,result);toast("已加载："+file.name);
 }catch(error){toast("读取歌词失败："+(error?.message||"未知错误"))}
});
async function loadLyricsForCurrent(track){
  const token=++lyricsRequest;
  lyricLines=[];activeLyricIndex=-1;
  $("#lyrics-track").textContent=(track.title||"")+(track.artist?" · "+track.artist:"");
  $("#lyrics-lines").innerHTML='<div class="lyrics-empty">正在匹配歌词…</div>';
  const manual=readManualLyrics(track);
  if(manual){loadManualLyrics(track,manual);return;}
  setLyricsStatus("正在依次尝试多个歌词源");
  const result=await lyricsEngine.get(track);
  if(token!==lyricsRequest||state.current?.id!==track.id)return;
  if(!result){
    renderLyrics(null);
    setLyricsStatus("已尝试 LRCLIB、LrcAPI 和备用纯歌词源");
    return;
  }
  renderLyrics(result);
  setLyricsStatus((result.synced?"逐行同步":"纯文本歌词")+" · 来源："+result.source);
  syncLyrics(audio.currentTime||0,true);
}
function syncLyrics(seconds,force=false){
  if(!lyricLines.length||!lyricLines[0]||lyricLines[0].time===null)return;
  seconds+=currentLyricOffset();
  let low=0,high=lyricLines.length-1,found=-1;
  while(low<=high){
    const mid=(low+high)>>1;
    if(lyricLines[mid].time<=seconds){found=mid;low=mid+1}else high=mid-1;
  }
  if(found<0)return;
  if(found===activeLyricIndex){if(force){const current=$("#lyrics-lines").querySelector('[data-index="'+found+'"]');if(current&&$("#lyrics-panel").classList.contains("show"))current.scrollIntoView({block:"center",behavior:"auto"})}return}
  const previous=activeLyricIndex;
  activeLyricIndex=found;
  const oldRow=previous>=0?$("#lyrics-lines").querySelector('[data-index="'+previous+'"]'):null;
  const row=$("#lyrics-lines").querySelector('[data-index="'+found+'"]');
  if(oldRow)oldRow.classList.remove("active");
  if(row){row.classList.add("active");if($("#lyrics-panel").classList.contains("show"))row.scrollIntoView({block:"center",behavior:force?"auto":"smooth"})}
  const expanded=$("#expanded-lyrics");if(expanded){expanded.querySelectorAll(".lyric-line.active").forEach(x=>x.classList.remove("active"));const mirror=expanded.querySelector('[data-index="'+found+'"]');if(mirror){mirror.classList.add("active");mirror.scrollIntoView({block:"center",behavior:force?"auto":"smooth"})}}
}
function openLyrics(){
  $("#lyrics-panel").classList.add("show");
  $("#lyrics-panel").setAttribute("aria-hidden","false");
  renderLyricOffset();
  if(!state.current)setLyricsStatus("先播放一首歌曲，再自动匹配歌词");
  else syncLyrics(audio.currentTime||0,true);
}
function closeLyrics(){
  $("#lyrics-panel").classList.remove("show");
  $("#lyrics-panel").setAttribute("aria-hidden","true");
}
$("#lyrics-btn").onclick=e=>{e.stopPropagation();$("#lyrics-panel").classList.contains("show")?closeLyrics():openLyrics()};
$("#lyrics-close").onclick=closeLyrics;
$("#lyrics-offset-minus").onclick=()=>adjustLyricOffset(-lyricOffsetStep);
$("#lyrics-offset-plus").onclick=()=>adjustLyricOffset(lyricOffsetStep);
$("#lyrics-offset-reset").onclick=()=>{if(!state.current)return;lyricOffsetByTrack[String(state.current.id)]=0;try{localStorage.setItem("jm_lyrics_offsets_v1",JSON.stringify(lyricOffsetByTrack))}catch{}renderLyricOffset();activeLyricIndex=-1;syncLyrics(audio.currentTime||0,true);toast("已重置歌词时间")};
let lyricTouchStartY=0;
const lyricsPanel=$("#lyrics-panel");
lyricsPanel.addEventListener("touchstart",e=>{lyricTouchStartY=e.touches[0].clientY},{passive:true});
lyricsPanel.addEventListener("touchend",e=>{if(e.changedTouches[0].clientY-lyricTouchStartY>85)closeLyrics()},{passive:true});
document.addEventListener("pointerdown",e=>{if(lyricsPanel.classList.contains("show")&&!lyricsPanel.contains(e.target)&&!$("#lyrics-btn").contains(e.target))closeLyrics()});
function renderQueue(){
  $("#queue-count").textContent=state.queue.length+" 首";
  const root=$("#queue-items");
  if(!state.queue.length){root.innerHTML='<div class="empty-note">播放队列还是空的，先选几首喜欢的音乐吧。</div>';return}
  root.innerHTML=state.queue.map((t,i)=>'<div class="queue-track '+(i===state.index?'playing':'')+'" data-queue-index="'+i+'"><span class="queue-number">'+(i===state.index?'♫':String(i+1).padStart(2,'0'))+'</span><div class="queue-track-info"><strong>'+esc(t.title)+'</strong><small>'+esc(t.artist)+'</small></div><button data-queue-remove="'+i+'" aria-label="移除歌曲">×</button></div>').join("");
  root.querySelectorAll(".queue-track").forEach(row=>row.onclick=e=>{if(e.target.closest("[data-queue-remove]"))return;state.index=+row.dataset.queueIndex;loadCurrent();renderQueue()});
  root.querySelectorAll("[data-queue-remove]").forEach(b=>b.onclick=e=>{e.stopPropagation();const i=+b.dataset.queueRemove;state.queue.splice(i,1);if(i<state.index)state.index--;else if(i===state.index){if(state.queue.length){state.index=Math.min(i,state.queue.length-1);loadCurrent()}else{state.index=-1;state.current=null;audio.pause();audio.removeAttribute("src");$("#now-title").textContent="还没有播放歌曲";$("#now-artist").textContent="去发现页找点音乐";lyricsRequest++;renderLyrics(null);$("#lyrics-track").textContent="歌词";setLyricsStatus("等待播放")}}renderQueue()});
}
function openQueue(){renderQueue();$("#queue-overlay").classList.add("show");$("#queue-drawer").classList.add("show");$("#queue-drawer").setAttribute("aria-hidden","false");$("#queue-overlay").setAttribute("aria-hidden","false")}
function closeQueue(){$("#queue-overlay").classList.remove("show");$("#queue-drawer").classList.remove("show");$("#queue-drawer").setAttribute("aria-hidden","true");$("#queue-overlay").setAttribute("aria-hidden","true")}
$("#queue-btn").onclick=openQueue;$("#queue-close").onclick=closeQueue;$("#queue-overlay").onclick=closeQueue;
$("#queue-clear").onclick=()=>{state.queue=[];state.index=-1;state.current=null;audio.pause();audio.removeAttribute("src");$("#now-title").textContent="还没有播放歌曲";$("#now-artist").textContent="去发现页找点音乐";lyricsRequest++;renderLyrics(null);$("#lyrics-track").textContent="歌词";setLyricsStatus("等待播放");renderQueue();toast("播放队列已清空")};
let touchStartY=0;$("#queue-drawer").addEventListener("touchstart",e=>{touchStartY=e.touches[0].clientY},{passive:true});
$("#queue-drawer").addEventListener("touchend",e=>{const delta=e.changedTouches[0].clientY-touchStartY;if(delta>75)closeQueue()},{passive:true});
function renderRecent(){renderTracks(state.recent.slice(0,20),"recent-list")}
function renderLocalHome(){const root=$("#local-home-list");if(!root)return;if(!state.homeLocalTracks.length){root.innerHTML='<div class="local-home-empty"><span>♫</span><div><strong>你的音乐库还没登场</strong><small>选择一次手机音乐文件夹，扫描后就能建立自己的音乐档案。</small></div><button id="local-home-action" type="button">导入音乐</button></div>';$("#local-home-action").onclick=()=>{switchTab("search");if(!state.localFolder)chooseLocalFolder();else searchLocal("")};return}renderTracks(state.homeLocalTracks.slice(0,6),"local-home-list")}
function renderLibrary(){
  const root=$("#library-content");$$("[data-library]").forEach(b=>b.classList.toggle("selected",b.dataset.library===state.libraryTab));
  if(state.libraryTab==="favorites"){root.innerHTML="";renderTracks(state.favorites,"library-content");return}
  root.innerHTML='<div class="create-row"><input id="playlist-name" maxlength="24" placeholder="给新歌单起个名字"><button id="create-playlist">创建歌单</button></div><div id="playlist-items"></div>';
  $("#create-playlist").onclick=()=>{const name=$("#playlist-name").value.trim();if(!name){toast("先给歌单起个名字");return}state.playlists.push({id:Date.now().toString(),name,tracks:[]});save();renderLibrary();toast("歌单已创建")};
  const list=$("#playlist-items");if(!state.playlists.length){list.innerHTML='<div class="empty-note">还没有歌单，创建一个自己的音乐角落</div>';return}
  list.innerHTML=state.playlists.map(p=>'<div class="playlist-card" data-playlist-card="'+p.id+'" tabindex="0"><div class="playlist-card-info"><strong>'+esc(p.name)+'</strong><small>'+p.tracks.length+' 首歌曲</small></div><button class="text-btn" data-delete="'+p.id+'">删除</button></div>').join("");
  list.querySelectorAll("[data-playlist-card]").forEach(card=>{card.onclick=e=>{if(e.target.closest("[data-delete]"))return;openPlaylist(card.dataset.playlistCard)};card.onkeydown=e=>{if((e.key==="Enter"||e.key===" ")&&!e.target.closest("[data-delete]")){e.preventDefault();openPlaylist(card.dataset.playlistCard)}}});
  list.querySelectorAll("[data-delete]").forEach(b=>b.onclick=e=>{e.stopPropagation();state.playlists=state.playlists.filter(p=>p.id!==b.dataset.delete);save();renderLibrary()});
}
$$("[data-library]").forEach(b=>b.onclick=()=>{state.libraryTab=b.dataset.library;renderLibrary()});
function addToPlaylist(t){if(!state.playlists.length)state.playlists.push({id:Date.now().toString(),name:"稍后再听",tracks:[]});const p=state.playlists[state.playlists.length-1];if(!p.tracks.some(x=>x.id===t.id))p.tracks.push(t);save();toast("已加入「"+p.name+"」")}
function openPlaylist(id){const p=state.playlists.find(x=>x.id===id);if(!p)return;state.activePlaylistId=id;state.selectionTarget=null;state.selectedIds=new Set();$("#library-content").innerHTML='<div class="section-head"><h2>'+esc(p.name)+'</h2><button class="text-btn" id="back-playlists">返回</button></div><div id="playlist-tracks"></div>';$("#back-playlists").onclick=renderLibrary;renderTracks(p.tracks,"playlist-tracks")}

/* Expandable player and Android Bluetooth/media-key integration */
const player=$("#player");
let playerTransitionAnimation=null;
function transitionPlayer(expanded){
  if(player.classList.contains("expanded")===expanded)return;
  if(playerTransitionAnimation){playerTransitionAnimation.cancel();playerTransitionAnimation=null}
  player.style.transform="";
  player.style.transformOrigin="";
  const first=player.getBoundingClientRect();
  player.classList.toggle("expanded",expanded);
  player.setAttribute("aria-expanded",String(expanded));
  const last=player.getBoundingClientRect();
  if(!first.width||!first.height||!last.width||!last.height||typeof player.animate!=="function"||window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)return;
  const dx=first.left-last.left,dy=first.top-last.top;
  const sx=first.width/last.width,sy=first.height/last.height;
  const from=`translate(${dx}px,${dy}px) scale(${sx},${sy})`;
  player.style.transformOrigin="top left";
  player.style.transform=from;
  playerTransitionAnimation=player.animate(
    [{transform:from},{transform:"none"}],
    {duration:expanded?460:380,easing:"cubic-bezier(.22,.8,.22,1)",fill:"both"}
  );
  const animation=playerTransitionAnimation;
  animation.onfinish=()=>{
    if(playerTransitionAnimation!==animation)return;
    player.style.transform="";
    player.style.transformOrigin="";
    playerTransitionAnimation=null;
    animation.cancel();
  };
}
function expandPlayer(){closeLyrics();closeQueue();transitionPlayer(true)}
function collapsePlayer(){transitionPlayer(false)}
/* Taps open the mini player; expanded-player gestures are zone-specific. */
player.addEventListener("click",e=>{
  if(player.classList.contains("expanded")||e.target.closest("button,input,select,a"))return;
  expandPlayer();
});
let playerGesture=null;
player.addEventListener("touchstart",e=>{
  const touch=e.touches[0];
  const expanded=player.classList.contains("expanded");
  const target=e.target;
  const interactive=target.closest("button,input,select,a,[role='button']");
  const zone=expanded
    ? (target.closest(".player-meta")?"meta":target.closest(".expanded-lyrics")?"lyrics":null)
    : (!interactive&&target.closest("#player")?"mini":null);
  playerGesture=zone?{y:touch.clientY,x:touch.clientX,zone,expanded}:null;
},{passive:true});
player.addEventListener("touchend",e=>{
  if(!playerGesture)return;
  const start=playerGesture;playerGesture=null;
  const touch=e.changedTouches[0];
  const deltaY=touch.clientY-start.y;
  const deltaX=touch.clientX-start.x;
  if(Math.abs(deltaY)<65||Math.abs(deltaY)<Math.abs(deltaX)*1.2)return;
  if(start.expanded){
    /* Only a downward swipe that starts in the left metadata column collapses. */
    if(start.zone==="meta"&&deltaY>80)collapsePlayer();
    /* The lyrics column is reserved for native vertical scrolling. */
    return;
  }
  /* Keep the existing swipe-up-to-expand gesture on the compact player. */
  if(start.zone==="mini"&&deltaY<-60)expandPlayer();
},{passive:true});
player.addEventListener("touchcancel",()=>{playerGesture=null},{passive:true});
window.jerryNativeMediaControl=function(action){if(action==="play")audio.play().catch(()=>{});else if(action==="pause")audio.pause();else if(action==="toggle")audio.paused?audio.play().catch(()=>{}):audio.pause();else if(action==="next")next();else if(action==="previous")prev();};
function updateMediaSession(track){
 if(!("mediaSession" in navigator))return;
 try{const artwork=trackArtworkUrl(track);navigator.mediaSession.metadata=new MediaMetadata({title:track.title||"JerryMusic",artist:track.artist||"",album:track.album||"JerryMusic",artwork:artwork?[{src:artwork,sizes:"512x512",type:"image/jpeg"}]:[]})}catch{}
 const actions={play:()=>audio.play().catch(()=>{}),pause:()=>audio.pause(),previoustrack:()=>prev(),nexttrack:()=>next(),seekbackward:()=>{audio.currentTime=Math.max(0,audio.currentTime-10)},seekforward:()=>{audio.currentTime=Math.min(audio.duration||Infinity,audio.currentTime+10)},seekto:d=>{if(Number.isFinite(d.seekTime)&&audio.duration)audio.currentTime=Math.max(0,Math.min(audio.duration,d.seekTime))}};
 for(const [name,fn] of Object.entries(actions)){try{navigator.mediaSession.setActionHandler(name,fn)}catch{}}
}
function updateMediaPlaybackState(){if("mediaSession" in navigator)try{navigator.mediaSession.playbackState=audio.paused?"paused":"playing"}catch{}}
audio.addEventListener("play",updateMediaPlaybackState);audio.addEventListener("pause",updateMediaPlaybackState);
window.addEventListener("pagehide",persistStats);syncPlaybackButton();updateSeekLabel();renderRecent();renderLibrary();renderLocalFolder();renderLocalHome();renderHomeDashboard();loadSavedLocalFolder();
