package com.jerrymusic.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.MediaMetadataRetriever;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.documentfile.provider.DocumentFile;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.ArrayDeque;
import java.util.Locale;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import org.json.JSONObject;
import org.json.JSONArray;

@CapacitorPlugin(name = "LocalMusic")
public class LocalMusicPlugin extends Plugin {
    private static final String PREFS = "jerrymusic_local_music";

    @PluginMethod
    public void chooseFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("Folder selection cancelled");
            return;
        }
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (uri == null) {
            call.reject("No folder was selected");
            return;
        }
        try {
            int returnedFlags = data.getFlags();
            int grantFlags = returnedFlags & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if (grantFlags == 0) grantFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
            getContext().getContentResolver().takePersistableUriPermission(uri, grantFlags);
            DocumentFile folder = DocumentFile.fromTreeUri(getContext(), uri);
            String name = folder != null && folder.getName() != null ? folder.getName() : "本地音乐文件夹";
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("tree_uri", uri.toString())
                .putString("folder_name", name)
                .apply();
            JSObject response = new JSObject();
            response.put("uri", uri.toString());
            response.put("name", name);
            call.resolve(response);
        } catch (Exception e) {
            call.reject("Unable to keep folder access: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void getFolder(PluginCall call) {
        String uri = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("tree_uri", null);
        if (uri == null || uri.isEmpty()) {
            call.resolve(new JSObject());
            return;
        }
        JSObject response = new JSObject();
        try {
            response.put("uri", uri);
            response.put("name", getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("folder_name", "本地音乐文件夹"));
            call.resolve(response);
        } catch (Exception e) {
            call.reject("Could not read selected folder", e);
        }
    }

    @PluginMethod
    public void searchLocalMusic(PluginCall call) {
        String treeUri = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("tree_uri", null);
        if (treeUri == null || treeUri.isEmpty()) {
            call.reject("Please choose a music folder first");
            return;
        }
        String query = call.getString("query", "").trim().toLowerCase(Locale.ROOT);
        try {
            DocumentFile root = DocumentFile.fromTreeUri(getContext(), Uri.parse(treeUri));
            if (root == null || !root.canRead()) {
                call.reject("The selected folder is no longer accessible. Please choose it again.");
                return;
            }
            JSArray found = new JSArray();
            ArrayDeque<DocumentFile> stack = new ArrayDeque<>();
            stack.add(root);
            int visited = 0, audioScanned = 0, matches = 0;
            while (!stack.isEmpty() && visited < 10000 && matches < 200) {
                DocumentFile current = stack.removeLast();
                visited++;
                if (!current.isDirectory()) continue;
                DocumentFile[] children = current.listFiles();
                Map<String, DocumentFile> sidecarLyrics = new HashMap<>();
                for (DocumentFile child : children) {
                    if (child.isFile() && child.getName() != null && child.getName().toLowerCase(Locale.ROOT).endsWith(".lrc")) {
                        String lrcName = child.getName();
                        String lrcBase = lrcName.substring(0, lrcName.length() - 4).toLowerCase(Locale.ROOT);
                        if (!sidecarLyrics.containsKey(lrcBase)) sidecarLyrics.put(lrcBase, child);
                        int audioExtensionAt = lrcBase.lastIndexOf('.');
                        if (audioExtensionAt > 0) {
                            String withoutAudioExtension = lrcBase.substring(0, audioExtensionAt);
                            if (!sidecarLyrics.containsKey(withoutAudioExtension)) sidecarLyrics.put(withoutAudioExtension, child);
                        }
                    }
                }
                for (DocumentFile child : children) {
                    if (child.isDirectory()) {
                        stack.add(child);
                    } else if (child.isFile() && isAudioFile(child)) {
                        audioScanned++;
                        String name = child.getName() == null ? "未知音频" : child.getName();
                        String[] metadata = getCachedMetadata(child, name);
                        String searchable = (metadata[0] + " " + metadata[1] + " " + name).toLowerCase(Locale.ROOT);
                        if (query.isEmpty() || searchable.contains(query)) {
                            JSObject item = new JSObject();
                            item.put("id", "local:" + child.getUri().toString());
                            item.put("uri", child.getUri().toString());
                            item.put("title", metadata[0]);
                            item.put("artist", metadata[1]);
                            item.put("fileName", name);
                            item.put("durationMs", metadata[2]);
                            item.put("album", metadata[3]);
                            item.put("albumArtist", metadata[4]);
                            item.put("year", metadata[5]);
                            item.put("genre", metadata[6]);
                            item.put("trackNumber", metadata[7]);
                            item.put("discNumber", metadata[8]);
                            if (!metadata[9].isEmpty()) item.put("artworkPath", metadata[9]);
                            item.put("source", "local");
                            item.put("size", child.length());
                            String audioName = name;
                            int extensionAt = audioName.lastIndexOf('.');
                            String audioBase = (extensionAt > 0 ? audioName.substring(0, extensionAt) : audioName).toLowerCase(Locale.ROOT);
                            DocumentFile sidecar = sidecarLyrics.get(audioBase);
                            if (sidecar != null) item.put("lyricsUri", sidecar.getUri().toString());
                            found.put(item);
                            matches++;
                        }
                    }
                }
            }
            JSObject response = new JSObject();
            response.put("tracks", found);
            response.put("scanned", visited);
            response.put("audioScanned", audioScanned);
            response.put("truncated", !stack.isEmpty() || matches >= 200 || visited >= 10000);
            call.resolve(response);
        } catch (SecurityException e) {
            call.reject("Folder permission expired. Please choose the folder again.", e);
        } catch (Exception e) {
            call.reject("Could not scan this folder: " + e.getMessage(), e);
        }
    }

    private static long lastMusicBrainzRequestAt = 0L;

    private static synchronized void waitForMusicBrainzSlot() throws InterruptedException {
        long wait = 1100L - (System.currentTimeMillis() - lastMusicBrainzRequestAt);
        if (wait > 0L) Thread.sleep(wait);
        lastMusicBrainzRequestAt = System.currentTimeMillis();
    }

    private String readHttpText(String rawUrl, boolean musicBrainz) throws Exception {
        if (musicBrainz) waitForMusicBrainzSlot();
        HttpURLConnection connection = (HttpURLConnection) new URL(rawUrl).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(15000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "JerryMusic/1.0 (https://github.com/Jerrygsz/JerryMusic)");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) return null;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count, total = 0;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > 4 * 1024 * 1024) throw new IllegalStateException("Music metadata response too large");
                    output.write(buffer, 0, count);
                }
                return output.toString("UTF-8");
            }
        } finally {
            connection.disconnect();
        }
    }

    private String downloadCoverArt(String releaseId, String fingerprint) {
        HttpURLConnection connection = null;
        try {
            String endpoint = "https://coverartarchive.org/release/" + releaseId + "/front-500";
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(20000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", "JerryMusic/1.0 (https://github.com/Jerrygsz/JerryMusic)");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) return "";
            String contentType = connection.getContentType();
            if (contentType == null || !contentType.toLowerCase(Locale.ROOT).startsWith("image/")) return "";
            byte[] bytes;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count, total = 0;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > 10 * 1024 * 1024) return "";
                    output.write(buffer, 0, count);
                }
                bytes = output.toByteArray();
            }
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return "";
            int sample = 1;
            while (Math.max(bounds.outWidth / sample, bounds.outHeight / sample) > 1000) sample *= 2;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sample;
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            if (bitmap == null) return "";
            Bitmap scaled = bitmap;
            int maxSide = Math.max(bitmap.getWidth(), bitmap.getHeight());
            if (maxSide > 1000) {
                float ratio = 1000f / maxSide;
                scaled = Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(bitmap.getWidth() * ratio)), Math.max(1, Math.round(bitmap.getHeight() * ratio)), true);
                if (scaled != bitmap) bitmap.recycle();
            }
            File artworkDir = new File(getContext().getFilesDir(), "jerrymusic-artwork");
            if (!artworkDir.exists() && !artworkDir.mkdirs()) { scaled.recycle(); return ""; }
            File target = new File(artworkDir, "mb_" + Integer.toHexString(releaseId.hashCode()) + ".jpg");
            File temporary = new File(artworkDir, target.getName() + ".part");
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                if (!scaled.compress(Bitmap.CompressFormat.JPEG, 88, output)) throw new IllegalStateException("Cover compression failed");
                output.getFD().sync();
            } finally {
                scaled.recycle();
            }
            if (target.exists()) target.delete();
            if (!temporary.renameTo(target)) { temporary.delete(); return ""; }
            return target.getAbsolutePath();
        } catch (Exception ignored) {
            return "";
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private String normalizeMusicText(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]", "");
    }

    private String artistCreditName(JSONArray credits) {
        if (credits == null) return "";
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < credits.length(); i++) {
            JSONObject credit = credits.optJSONObject(i);
            if (credit == null) continue;
            String name = credit.optString("name", "");
            if (name.isEmpty()) {
                JSONObject artist = credit.optJSONObject("artist");
                if (artist != null) name = artist.optString("name", "");
            }
            result.append(name).append(credit.optString("joinphrase", ""));
        }
        return result.toString().trim();
    }

    @PluginMethod
    public void enrichTrack(PluginCall call) {
        final String rawUri = call.getString("uri", "");
        final String title = call.getString("title", "").trim();
        final String artist = call.getString("artist", "").trim();
        final String album = call.getString("album", "").trim();
        final String durationRaw = call.getString("durationMs", "");
        if (rawUri.isEmpty() || title.isEmpty() || artist.isEmpty() || artist.equals("本地音乐")) {
            call.reject("Missing reliable track title or artist");
            return;
        }
        new Thread(() -> {
            try {
                Uri uri = Uri.parse(rawUri);
                DocumentFile source = DocumentFile.fromSingleUri(getContext(), uri);
                long size = source == null ? 0L : source.length();
                long modified = source == null ? 0L : source.lastModified();
                String fingerprint = Integer.toHexString(rawUri.hashCode()) + "_" + size + "_" + modified;
                String metadataKey = "meta_v2_" + fingerprint;
                String attemptKey = "online_attempt_v1_" + fingerprint;
                android.content.SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                String cached = prefs.getString(metadataKey, "{}");
                JSONObject metadata = new JSONObject(cached);
                String existingArtwork = metadata.optString("artworkPath", "");
                if (!existingArtwork.isEmpty() && new File(existingArtwork).isFile()) {
                    JSObject already = new JSObject();
                    already.put("updated", false);
                    already.put("reason", "already_has_artwork");
                    call.resolve(already);
                    return;
                }
                long attemptedAt = prefs.getLong(attemptKey, 0L);
                if (attemptedAt > 0L && System.currentTimeMillis() - attemptedAt < 30L * 24L * 60L * 60L * 1000L) {
                    JSObject skipped = new JSObject();
                    skipped.put("updated", false);
                    skipped.put("reason", "recently_checked");
                    call.resolve(skipped);
                    return;
                }

                String query = "recording:\"" + title.replace("\"", "") + "\" AND artist:\"" + artist.replace("\"", "") + "\"";
                String searchUrl = "https://musicbrainz.org/ws/2/recording/?query=" + URLEncoder.encode(query, "UTF-8") + "&fmt=json&limit=5";
                String searchText = readHttpText(searchUrl, true);
                if (searchText == null) throw new IllegalStateException("MusicBrainz search unavailable");
                JSONObject searchJson = new JSONObject(searchText);
                JSONArray recordings = searchJson.optJSONArray("recordings");
                JSONObject chosen = null;
                String normalizedTitle = normalizeMusicText(title);
                String normalizedArtist = normalizeMusicText(artist);
                long localDuration = 0L;
                try { localDuration = Long.parseLong(durationRaw); } catch (Exception ignored) {}
                if (recordings != null) {
                    for (int i = 0; i < recordings.length(); i++) {
                        JSONObject candidate = recordings.optJSONObject(i);
                        if (candidate == null || candidate.optInt("score", 0) < 95) continue;
                        if (!normalizeMusicText(candidate.optString("title", "")).equals(normalizedTitle)) continue;
                        String candidateArtist = normalizeMusicText(artistCreditName(candidate.optJSONArray("artist-credit")));
                        if (candidateArtist.isEmpty() || (!candidateArtist.contains(normalizedArtist) && !normalizedArtist.contains(candidateArtist))) continue;
                        long candidateDuration = candidate.optLong("length", 0L);
                        if (localDuration > 0L && candidateDuration > 0L) {
                            long difference = Math.abs(localDuration - candidateDuration);
                            if (difference > Math.max(12000L, localDuration / 12L)) continue;
                        }
                        chosen = candidate;
                        break;
                    }
                }
                if (chosen == null) {
                    prefs.edit().putLong(attemptKey, System.currentTimeMillis()).apply();
                    JSObject noMatch = new JSObject();
                    noMatch.put("updated", false);
                    noMatch.put("reason", "no_confident_match");
                    call.resolve(noMatch);
                    return;
                }

                String recordingId = chosen.optString("id", "");
                String detailUrl = "https://musicbrainz.org/ws/2/recording/" + recordingId + "?inc=releases+artist-credits+tags&fmt=json";
                String detailText = readHttpText(detailUrl, true);
                if (detailText == null) throw new IllegalStateException("MusicBrainz detail unavailable");
                JSONObject detail = new JSONObject(detailText);
                JSONArray releases = detail.optJSONArray("releases");
                JSONObject selectedRelease = null;
                String normalizedAlbum = normalizeMusicText(album);
                if (releases != null) {
                    for (int i = 0; i < releases.length(); i++) {
                        JSONObject release = releases.optJSONObject(i);
                        if (release == null) continue;
                        String status = release.optString("status", "");
                        if (!status.isEmpty() && !status.equalsIgnoreCase("official")) continue;
                        String releaseTitle = release.optString("title", "");
                        if (!normalizedAlbum.isEmpty() && !normalizeMusicText(releaseTitle).equals(normalizedAlbum)) continue;
                        if (selectedRelease == null) selectedRelease = release;
                        if (!normalizedAlbum.isEmpty()) { selectedRelease = release; break; }
                    }
                }
                if (selectedRelease == null) {
                    prefs.edit().putLong(attemptKey, System.currentTimeMillis()).apply();
                    JSObject noRelease = new JSObject();
                    noRelease.put("updated", false);
                    noRelease.put("reason", "no_matching_release");
                    call.resolve(noRelease);
                    return;
                }

                String releaseId = selectedRelease.optString("id", "");
                if (releaseId.isEmpty()) throw new IllegalStateException("Missing MusicBrainz release id");
                String remoteAlbum = selectedRelease.optString("title", "");
                String remoteAlbumArtist = artistCreditName(selectedRelease.optJSONArray("artist-credit"));
                String remoteDate = selectedRelease.optString("date", "");
                String remoteYear = remoteDate.length() >= 4 ? remoteDate.substring(0, 4) : "";
                String remoteGenre = "";
                JSONArray tags = detail.optJSONArray("tags");
                if (tags != null && tags.length() > 0) {
                    JSONObject bestTag = tags.optJSONObject(0);
                    if (bestTag != null) remoteGenre = bestTag.optString("name", "");
                }
                String artworkPath = downloadCoverArt(releaseId, fingerprint);

                if (metadata.optString("album", "").trim().isEmpty() && !remoteAlbum.isEmpty()) metadata.put("album", remoteAlbum);
                if (metadata.optString("albumArtist", "").trim().isEmpty() && !remoteAlbumArtist.isEmpty()) metadata.put("albumArtist", remoteAlbumArtist);
                if (metadata.optString("year", "").trim().isEmpty() && !remoteYear.isEmpty()) metadata.put("year", remoteYear);
                if (metadata.optString("genre", "").trim().isEmpty() && !remoteGenre.isEmpty()) metadata.put("genre", remoteGenre);
                if (metadata.optString("artworkPath", "").trim().isEmpty() && !artworkPath.isEmpty()) metadata.put("artworkPath", artworkPath);
                metadata.put("musicBrainzRecordingId", recordingId);
                metadata.put("musicBrainzReleaseId", releaseId);
                prefs.edit().putString(metadataKey, metadata.toString()).putLong(attemptKey, System.currentTimeMillis()).apply();

                JSObject response = new JSObject();
                response.put("updated", !artworkPath.isEmpty() || !remoteAlbum.isEmpty() || !remoteYear.isEmpty() || !remoteGenre.isEmpty());
                response.put("album", remoteAlbum);
                response.put("albumArtist", remoteAlbumArtist);
                response.put("year", remoteYear);
                response.put("genre", remoteGenre);
                if (!artworkPath.isEmpty()) response.put("artworkPath", artworkPath);
                response.put("musicBrainzRecordingId", recordingId);
                response.put("musicBrainzReleaseId", releaseId);
                call.resolve(response);
            } catch (Exception e) {
                call.reject("Online music matching failed: " + e.getMessage(), e);
            }
        }, "JerryMusicMetadata").start();
    }

    @PluginMethod
    public void readLyricsFile(PluginCall call) {
        String rawUri = call.getString("uri");
        if (rawUri == null || rawUri.isEmpty()) {
            call.reject("Missing lyrics file URI");
            return;
        }
        try (InputStream input = getContext().getContentResolver().openInputStream(Uri.parse(rawUri));
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) {
                call.reject("Cannot open local lyrics file");
                return;
            }
            byte[] buffer = new byte[8192];
            int count;
            int total = 0;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > 512 * 1024) {
                    call.reject("Lyrics file is larger than 512 KB");
                    return;
                }
                output.write(buffer, 0, count);
            }
            byte[] bytes = output.toByteArray();
            String lyrics = new String(bytes, StandardCharsets.UTF_8);
            if (lyrics.indexOf('\uFFFD') >= 0) lyrics = new String(bytes, Charset.forName("GB18030"));
            JSObject response = new JSObject();
            response.put("text", lyrics);
            call.resolve(response);
        } catch (Exception e) {
            call.reject("Could not read local lyrics file: " + e.getMessage(), e);
        }
    }

    private String[] getCachedMetadata(DocumentFile file, String fallbackName) {
        String uri = file.getUri().toString();
        long size = file.length();
        long modified = file.lastModified();
        String fingerprint = Integer.toHexString(uri.hashCode()) + "_" + size + "_" + modified;
        String key = "meta_v2_" + fingerprint;
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String cached = prefs.getString(key, null);
        if (cached != null) {
            try {
                JSONObject json = new JSONObject(cached);
                String artworkPath = json.optString("artworkPath", "");
                if (!artworkPath.isEmpty() && !new File(artworkPath).isFile()) artworkPath = "";
                return new String[]{
                    json.optString("title", fallbackName),
                    json.optString("artist", "本地音乐"),
                    json.optString("duration", ""),
                    json.optString("album", ""),
                    json.optString("albumArtist", ""),
                    json.optString("year", ""),
                    json.optString("genre", ""),
                    json.optString("trackNumber", ""),
                    json.optString("discNumber", ""),
                    artworkPath
                };
            } catch (Exception ignored) {}
        }
        String[] metadata = readMetadata(file.getUri(), fallbackName, fingerprint);
        try {
            JSONObject json = new JSONObject();
            json.put("title", metadata[0]);
            json.put("artist", metadata[1]);
            json.put("duration", metadata[2]);
            json.put("album", metadata[3]);
            json.put("albumArtist", metadata[4]);
            json.put("year", metadata[5]);
            json.put("genre", metadata[6]);
            json.put("trackNumber", metadata[7]);
            json.put("discNumber", metadata[8]);
            json.put("artworkPath", metadata[9]);
            prefs.edit().putString(key, json.toString()).apply();
        } catch (Exception ignored) {}
        return metadata;
    }

    private String cacheEmbeddedArtwork(MediaMetadataRetriever retriever, String fingerprint) {
        try {
            File artworkDir = new File(getContext().getFilesDir(), "jerrymusic-artwork");
            if (!artworkDir.exists() && !artworkDir.mkdirs()) return "";
            File target = new File(artworkDir, fingerprint + ".jpg");
            if (target.isFile() && target.length() > 0) return target.getAbsolutePath();
            byte[] embedded = retriever.getEmbeddedPicture();
            if (embedded == null || embedded.length == 0 || embedded.length > 12 * 1024 * 1024) return "";
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(embedded, 0, embedded.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return "";
            int sample = 1;
            while (Math.max(bounds.outWidth / sample, bounds.outHeight / sample) > 1000) sample *= 2;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sample;
            Bitmap bitmap = BitmapFactory.decodeByteArray(embedded, 0, embedded.length, options);
            if (bitmap == null) return "";
            Bitmap scaled = bitmap;
            int maxSide = Math.max(bitmap.getWidth(), bitmap.getHeight());
            if (maxSide > 1000) {
                float ratio = 1000f / maxSide;
                scaled = Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(bitmap.getWidth() * ratio)), Math.max(1, Math.round(bitmap.getHeight() * ratio)), true);
                if (scaled != bitmap) bitmap.recycle();
            }
            File temporary = new File(artworkDir, fingerprint + ".part");
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                if (!scaled.compress(Bitmap.CompressFormat.JPEG, 88, output)) throw new IllegalStateException("Artwork compression failed");
                output.getFD().sync();
            } finally {
                scaled.recycle();
            }
            if (target.exists()) target.delete();
            if (!temporary.renameTo(target)) {
                temporary.delete();
                return "";
            }
            return target.getAbsolutePath();
        } catch (Exception ignored) {
            return "";
        }
    }

    @PluginMethod
    public void prepareTrack(PluginCall call) {
        String rawUri = call.getString("uri");
        if (rawUri == null || rawUri.isEmpty()) {
            call.reject("Missing local music URI");
            return;
        }
        File temporary = null;
        try {
            Uri uri = Uri.parse(rawUri);
            File cacheDir = new File(getContext().getCacheDir(), "jerrymusic-local");
            if (!cacheDir.exists() && !cacheDir.mkdirs()) throw new IllegalStateException("Cannot create music cache");
            String displayName = queryDisplayName(uri);
            if (displayName == null) displayName = uri.getLastPathSegment() == null ? "track.mp3" : uri.getLastPathSegment();
            String extension = displayName.contains(".") ? displayName.substring(displayName.lastIndexOf('.') + 1) : "mp3";
            extension = extension.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
            if (extension.isEmpty() || extension.length() > 8) extension = "mp3";
            DocumentFile source = DocumentFile.fromSingleUri(getContext(), uri);
            long sourceSize = source == null ? -1L : source.length();
            long sourceModified = source == null ? 0L : source.lastModified();
            String cacheKey = Integer.toHexString((rawUri + ":" + sourceSize + ":" + sourceModified).hashCode());
            File target = new File(cacheDir, cacheKey + "." + extension);
            if (!target.exists() || target.length() == 0L || (sourceSize > 0L && target.length() != sourceSize)) {
                temporary = new File(cacheDir, cacheKey + ".part");
                if (temporary.exists()) temporary.delete();
                try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                     FileOutputStream output = new FileOutputStream(temporary)) {
                    if (input == null) throw new IllegalStateException("Cannot open selected audio file");
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    output.getFD().sync();
                }
                if (temporary.length() == 0L || (sourceSize > 0L && temporary.length() != sourceSize)) {
                    throw new IllegalStateException("Audio cache copy is incomplete");
                }
                if (target.exists() && !target.delete()) throw new IllegalStateException("Cannot replace old audio cache");
                if (!temporary.renameTo(target)) throw new IllegalStateException("Cannot finalize audio cache");
                temporary = null;
            }
            trimMusicCache(cacheDir, target);
            JSObject response = new JSObject();
            response.put("path", target.getAbsolutePath());
            response.put("name", displayName);
            call.resolve(response);
        } catch (SecurityException e) {
            call.reject("No permission to read this audio file. Select the folder again.", e);
        } catch (Exception e) {
            call.reject("Could not prepare this audio file: " + e.getMessage(), e);
        } finally {
            if (temporary != null && temporary.exists()) temporary.delete();
        }
    }

    private void trimMusicCache(File cacheDir, File keep) {
        File[] files = cacheDir.listFiles();
        if (files == null) return;
        long total = 0L;
        for (File file : files) if (file.isFile() && !file.getName().endsWith(".part")) total += file.length();
        if (total <= 300L * 1024L * 1024L) return;
        java.util.Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (File file : files) {
            if (total <= 250L * 1024L * 1024L) break;
            if (!file.equals(keep) && file.isFile() && !file.getName().endsWith(".part")) {
                long size = file.length();
                if (file.delete()) total -= size;
            }
        }
    }

    private boolean isAudioFile(DocumentFile file) {
        String mime = file.getType() == null ? "" : file.getType();
        String name = file.getName() == null ? "" : file.getName();
        return mime.startsWith("audio/") || name.matches("(?i).+\\.(mp3|m4a|aac|flac|wav|ogg|opus|wma|aiff?)$");
    }

    private String[] readMetadata(Uri uri, String fallbackName, String fingerprint) {
        String title = fallbackName.contains(".") ? fallbackName.substring(0, fallbackName.lastIndexOf('.')) : fallbackName;
        String artist = "本地音乐";
        String duration = "";
        String album = "", albumArtist = "", year = "", genre = "", trackNumber = "", discNumber = "", artworkPath = "";
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(getContext(), uri);
            String value = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            if (value != null && !value.trim().isEmpty()) title = value.trim();
            value = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            if (value != null && !value.trim().isEmpty()) artist = value.trim();
            duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (duration == null) duration = "";
            value = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
            if (value != null) album = value.trim();
            value = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST);
            if (value != null) albumArtist = value.trim();
            value = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR);
            if (value != null) year = value.trim();
            value = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE);
            if (value != null) genre = value.trim();
            value = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER);
            if (value != null) trackNumber = value.trim();
            value = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER);
            if (value != null) discNumber = value.trim();
            artworkPath = cacheEmbeddedArtwork(retriever, fingerprint);
        } catch (Exception ignored) {
            // Fall back to the filename when embedded tags are unavailable.
        } finally {
            try { retriever.release(); } catch (Exception ignored) {}
        }
        return new String[]{title, artist, duration, album, albumArtist, year, genre, trackNumber, discNumber, artworkPath};
    }

    private String queryDisplayName(Uri uri) {
        try (android.database.Cursor cursor = getContext().getContentResolver().query(
            uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) {}
        return null;
    }
}
