package com.jerrymusic.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.ActivityResult;
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
import java.util.ArrayDeque;
import java.util.Locale;

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
            int visited = 0;
            int matches = 0;
            while (!stack.isEmpty() && visited < 10000 && matches < 200) {
                DocumentFile current = stack.removeLast();
                visited++;
                if (!current.isDirectory()) continue;
                for (DocumentFile child : current.listFiles()) {
                    if (child.isDirectory()) {
                        stack.add(child);
                    } else if (child.isFile() && isAudioFile(child)) {
                        String name = child.getName() == null ? "未知音频" : child.getName();
                        String[] metadata = readMetadata(child.getUri(), name);
                        String searchable = (metadata[0] + " " + metadata[1] + " " + name).toLowerCase(Locale.ROOT);
                        if (query.isEmpty() || searchable.contains(query)) {
                            JSObject item = new JSObject();
                            item.put("id", "local:" + child.getUri().toString());
                            item.put("uri", child.getUri().toString());
                            item.put("title", metadata[0]);
                            item.put("artist", metadata[1]);
                            item.put("fileName", name);
                            item.put("durationMs", metadata[2]);
                            item.put("source", "local");
                            found.put(item);
                            matches++;
                        }
                    }
                }
            }
            JSObject response = new JSObject();
            response.put("tracks", found);
            response.put("scanned", visited);
            response.put("truncated", !stack.isEmpty() || matches >= 200);
            call.resolve(response);
        } catch (SecurityException e) {
            call.reject("Folder permission expired. Please choose the folder again.", e);
        } catch (Exception e) {
            call.reject("Could not scan this folder: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void prepareTrack(PluginCall call) {
        String rawUri = call.getString("uri");
        if (rawUri == null || rawUri.isEmpty()) {
            call.reject("Missing local music URI");
            return;
        }
        try {
            Uri uri = Uri.parse(rawUri);
            File cacheDir = new File(getContext().getCacheDir(), "jerrymusic-local");
            if (!cacheDir.exists() && !cacheDir.mkdirs()) throw new IllegalStateException("Cannot create music cache");
            String displayName = queryDisplayName(uri);
            if (displayName == null) displayName = uri.getLastPathSegment() == null ? "track.mp3" : uri.getLastPathSegment();
            String extension = displayName.contains(".") ? displayName.substring(displayName.lastIndexOf('.') + 1) : "mp3";
            extension = extension.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
            if (extension.isEmpty() || extension.length() > 8) extension = "mp3";
            File target = new File(cacheDir, Integer.toHexString(rawUri.hashCode()) + "." + extension);
            if (!target.exists() || target.length() == 0L) {
                try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                     FileOutputStream output = new FileOutputStream(target)) {
                    if (input == null) throw new IllegalStateException("Cannot open selected audio file");
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                }
            }
            JSObject response = new JSObject();
            response.put("path", target.getAbsolutePath());
            response.put("name", displayName);
            call.resolve(response);
        } catch (SecurityException e) {
            call.reject("No permission to read this audio file. Select the folder again.", e);
        } catch (Exception e) {
            call.reject("Could not prepare this audio file: " + e.getMessage(), e);
        }
    }

    private boolean isAudioFile(DocumentFile file) {
        String mime = file.getType() == null ? "" : file.getType();
        String name = file.getName() == null ? "" : file.getName();
        return mime.startsWith("audio/") || name.matches("(?i).+\\.(mp3|m4a|aac|flac|wav|ogg|opus|wma|aiff?)$");
    }

    private String[] readMetadata(Uri uri, String fallbackName) {
        String title = fallbackName.contains(".") ? fallbackName.substring(0, fallbackName.lastIndexOf('.')) : fallbackName;
        String artist = "本地音乐";
        String duration = "";
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(getContext(), uri);
            String value = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            if (value != null && !value.trim().isEmpty()) title = value;
            value = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            if (value != null && !value.trim().isEmpty()) artist = value;
            duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (duration == null) duration = "";
        } catch (Exception ignored) {
            // Fall back to the filename when embedded tags are unavailable.
        } finally {
            try { retriever.release(); } catch (Exception ignored) {}
        }
        return new String[]{title, artist, duration};
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
