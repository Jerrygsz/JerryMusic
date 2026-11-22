const CACHE_KEY = "jm_lyrics_cache_v2";
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL = 6 * 60 * 60 * 1000;
const MAX_CACHE_ITEMS = 80;
const PROVIDER_COOLDOWNS = new Map();
let lastRequestAt = 0;

function normalize(value) {
  return String(value || "").toLowerCase()
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】/g, " ")
    .replace(/\b(feat\.?|featuring|ft\.?|with)\b/gi, " ")
    .replace(/\b(official|audio|video|music video|lyrics|lyric|remastered|live|demo|完整版|官方版|伴奏|纯音乐)\b/gi, " ")
    .replace(/[\s_]+/g, " ").replace(/[^\p{L}\p{N}]+/gu, "");
}
function titleVariants(value) {
  const raw=String(value||"").trim();
  const cleaned=raw.replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】/g," ")
    .replace(/\b(official|audio|video|lyrics|lyric|remastered|live|demo)\b/gi," ")
    .replace(/\s+/g," ").trim();
  const dash=raw.split(/\s[-–—]\s/)[0].trim();
  return [...new Set([raw,cleaned,dash].filter(Boolean))];
}

function similarity(a, b) {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return Math.min(x.length, y.length) / Math.max(x.length, y.length) * 0.25 + 0.72;
  const grams = value => {
    if (value.length < 2) return new Set([value]);
    const out = new Set();
    for (let i = 0; i < value.length - 1; i++) out.add(value.slice(i, i + 2));
    return out;
  };
  const left = grams(x), right = grams(y);
  let common = 0;
  for (const item of left) if (right.has(item)) common++;
  return (2 * common) / (left.size + right.size);
}

export function parseLrc(input) {
  const text = String(input || "");
  const offsetMatch = text.match(/\[offset:([+-]?\d+)\]/i);
  const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  const lines = [];
  const stamp = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of text.split(/\r?\n/)) {
    const matches = [...raw.matchAll(stamp)];
    const content = raw.replace(stamp, "").trim();
    if (!content || /^\[(ar|ti|al|by|re|ve|length|offset|kana|la|tool):/i.test(raw)) continue;
    if (!matches.length) continue;
    for (const match of matches) {
      const fraction = match[3] || "0";
      const millis = fraction.length === 1 ? Number(fraction) * 100 : fraction.length === 2 ? Number(fraction) * 10 : Number(fraction);
      const seconds = Math.max(0, Number(match[1]) * 60 + Number(match[2]) + millis / 1000 + offset);
      lines.push({ time: seconds, text: content });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines.filter((line, index) => index === 0 || line.time !== lines[index - 1].time || line.text !== lines[index - 1].text);
}

function plainLines(value) {
  return String(value || "").split(/\r?\n/).map(text => text.trim()).filter(Boolean).map(text => ({ time: null, text }));
}

function readCache() {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
}

function writeCache(cache) {
  try {
    const entries = Object.entries(cache).sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0)).slice(0, MAX_CACHE_ITEMS);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* Lyrics cache is optional; playback must never depend on storage. */ }
}

function cacheKey(track) {
  const duration = durationSeconds(track);
  return [track.title, track.artist, track.album || "", duration ? Math.round(duration) : "", track.lyricsUri ? "sidecar" : ""].map(normalize).join("|");
}

function durationSeconds(track) {
  const raw = Number(track.durationMs ?? track.duration ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 10000 ? raw / 1000 : raw;
}

function candidateScore(candidate, track) {
  const titleScore = similarity(candidate.trackName || candidate.name || candidate.title, track.title);
  const artistScore = track.artist && track.artist !== "本地音乐"
    ? similarity(candidate.artistName || candidate.artist, track.artist)
    : 0.55;
  const targetDuration = durationSeconds(track);
  const foundDuration = Number(candidate.duration || 0);
  let durationScore = 0.5;
  if (targetDuration && foundDuration) {
    const diff = Math.abs(targetDuration - foundDuration);
    durationScore = diff <= 2 ? 1 : diff <= 8 ? 0.8 : diff <= 20 ? 0.45 : 0;
  }
  return { score: titleScore * 0.58 + artistScore * 0.32 + durationScore * 0.10, titleScore, artistScore, durationScore };
}

function resultFrom(record, provider) {
  const synced = record.syncedLyrics || record.lyrics || "";
  const plain = record.plainLyrics || "";
  const lines = parseLrc(synced);
  const fallback = lines.length ? lines : plainLines(plain || synced);
  if (!fallback.length) return null;
  return {
    lines: fallback,
    synced: lines.length > 0,
    plainLyrics: plain || fallback.map(line => line.text).join("\n"),
    source: provider,
    instrumental: !!record.instrumental
  };
}

async function request(url, timeoutMs = 7000) {
  const host = new URL(url).host;
  const cooldownUntil = PROVIDER_COOLDOWNS.get(host) || 0;
  const waitForCooldown = Math.max(0, cooldownUntil - Date.now());
  const waitForPacing = Math.max(0, 300 - (Date.now() - lastRequestAt));
  const wait = Math.max(waitForCooldown, waitForPacing);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = url.startsWith("https://lrclib.net/")
      ? { "Lrclib-Client": "JerryMusic/1.1 (https://github.com/Jerrygsz/JerryMusic)" }
      : undefined;
    const response = await fetch(url, { signal: controller.signal, headers });
    if (response.status === 429) {
      const retryHeader = Number(response.headers.get("Retry-After") || 30);
      const retry = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : 30;
      PROVIDER_COOLDOWNS.set(host, Date.now() + retry * 1000);
      throw new Error("歌词服务触发限流，已暂停请求约 " + retry + " 秒");
    }
    if (!response.ok) throw new Error("Lyrics provider returned " + response.status);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fromLocalSidecar(track) {
  if (!track.lyricsUri || !window.JerryLocalMusic?.readLyricsFile) return null;
  const response = await window.JerryLocalMusic.readLyricsFile({ uri: track.lyricsUri });
  const text = String(response?.text || "");
  const lines = parseLrc(text);
  return lines.length
    ? { lines, synced: true, plainLyrics: lines.map(line => line.text).join("\n"), source: "本地 LRC 文件", instrumental: false }
    : null;
}

async function fromLrclib(track) {
  const titles=titleVariants(track.title), artist=track.artist && track.artist !== "本地音乐" ? track.artist : "", duration=durationSeconds(track);
  const queries=[]; for(const title of titles){if(artist)queries.push({track_name:title,artist_name:artist});queries.push({track_name:title});}
  const seen=new Set();
  for(const query of queries){const key=JSON.stringify(query);if(seen.has(key))continue;seen.add(key);
    try{const response=await request("https://lrclib.net/api/search?"+new URLSearchParams(query).toString(),7000);const records=await response.json();if(!Array.isArray(records)||!records.length)continue;
      const ranked=records.map(record=>({record,...candidateScore(record,track)})).sort((a,b)=>b.score-a.score);const best=ranked[0];
      if(best&&best.titleScore>=0.68&&(!artist||best.artistScore>=0.30)&&best.durationScore!==0){const result=resultFrom(best.record,"LRCLIB");if(result)return result;}
    }catch(error){if(String(error.message).includes("限流"))throw error;}
  }
  if(artist)for(const title of titles){const params=new URLSearchParams({track_name:title,artist_name:artist});if(track.album)params.set("album_name",track.album);if(duration)params.set("duration",String(Math.round(duration)));
    try{const response=await request("https://lrclib.net/api/get?"+params.toString(),7000);const result=resultFrom(await response.json(),"LRCLIB");if(result)return result;}catch(error){if(String(error.message).includes("限流"))throw error;}}
  return null;
}

async function fromLrcCx(track) {
  for(const title of titleVariants(track.title)){const params=new URLSearchParams({title,artist:track.artist==="本地音乐"?"":(track.artist||""),album:track.album||""});
    try{const response=await request("https://api.lrc.cx/api/v1/lyrics/advance?"+params.toString(),8000);const records=await response.json();
      if(Array.isArray(records)&&records.length){const ranked=records.map(record=>({record,...candidateScore(record,track)})).sort((a,b)=>b.score-a.score);const best=ranked[0];
        if(best&&best.titleScore>=0.65&&(!track.artist||track.artist==="本地音乐"||best.artistScore>=0.30)){const result=resultFrom({lyrics:best.record.lyrics},"LrcAPI");if(result)return result;}}
    }catch(error){console.warn("[JerryMusic lyrics] LrcAPI search failed:",error?.message||error)}
    try{const single=await request("https://api.lrc.cx/api/v1/lyrics/single?"+params.toString(),8000);const lines=parseLrc((await single.text()).trim());if(lines.length)return {lines,synced:true,plainLyrics:lines.map(line=>line.text).join("\n"),source:"LrcAPI",instrumental:false};}catch(error){console.warn("[JerryMusic lyrics] LrcAPI single failed:",error?.message||error)}
  }return null;
}

async function fromLyricsOvh(track) {
  if(!track.artist||track.artist==="本地音乐")return null;
  for(const title of titleVariants(track.title)){const url="https://api.lyrics.ovh/v1/"+encodeURIComponent(track.artist)+"/"+encodeURIComponent(title);
    try{const response=await request(url,6000);const data=await response.json();const lines=plainLines(data.lyrics||"");if(lines.length)return {lines,synced:false,plainLyrics:data.lyrics,source:"lyrics.ovh",instrumental:false};}catch(error){console.warn("[JerryMusic lyrics] lyrics.ovh failed:",error?.message||error)}}
  return null;
}

export class LyricsEngine {
  async get(track) {
    if (!track?.title) return null;
    const key = cacheKey(track);
    const cache = readCache();
    const cached = cache[key];
    if (cached && Date.now() - cached.savedAt < (cached.value ? CACHE_TTL : NEGATIVE_CACHE_TTL)) return cached.value || null;

    if (track.source === "local" && track.lyricsUri) {
      try {
        const local = await fromLocalSidecar(track);
        if (local) {
          cache[key] = { savedAt: Date.now(), value: local };
          writeCache(cache);
          return local;
        }
      } catch (error) {
        console.warn("[JerryMusic lyrics] local LRC failed:", error?.message || error);
      }
    }

    const providers = [
      ["LRCLIB", () => fromLrclib(track)],
      ["LrcAPI", () => fromLrcCx(track)],
      ["lyrics.ovh", () => fromLyricsOvh(track)]
    ];
    for (const [name, lookup] of providers) {
      try {
        const value = await lookup();
        if (value?.lines?.length) {
          cache[key] = { savedAt: Date.now(), value };
          writeCache(cache);
          return value;
        }
      } catch (error) {
        console.warn("[JerryMusic lyrics] " + name + " failed:", error?.message || error);
      }
    }
    cache[key] = { savedAt: Date.now(), value: null };
    writeCache(cache);
    return null;
  }
}
