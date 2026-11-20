package com.jerrymusic.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import com.getcapacitor.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.util.ArrayDeque
import java.util.Locale

@CapacitorPlugin(name = "LocalMusic")
class LocalMusicPlugin : Plugin() {
    private val prefs by lazy {
        context.getSharedPreferences("jerrymusic_local_music", Context.MODE_PRIVATE)
    }

    @PluginMethod
    fun chooseFolder(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        startActivityForResult(call, intent, "folderPicked")
    }

    @ActivityCallback
    private fun folderPicked(call: PluginCall, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("Folder selection cancelled")
            return
        }
        val uri = result.data?.data
        if (uri == null) {
            call.reject("No folder was selected")
            return
        }
        try {
            val returnedFlags = result.data?.flags ?: Intent.FLAG_GRANT_READ_URI_PERMISSION
            val grantFlags = returnedFlags and
                (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            context.contentResolver.takePersistableUriPermission(uri, grantFlags)
            val folder = DocumentFile.fromTreeUri(context, uri)
            val name = folder?.name ?: "本地音乐文件夹"
            prefs.edit()
                .putString("tree_uri", uri.toString())
                .putString("folder_name", name)
                .apply()
            val response = JSObject()
            response.put("uri", uri.toString())
            response.put("name", name)
            call.resolve(response)
        } catch (e: Exception) {
            call.reject("Unable to keep folder access: \${e.message}", e)
        }
    }

    @PluginMethod
    fun getFolder(call: PluginCall) {
        val uri = prefs.getString("tree_uri", null)
        if (uri.isNullOrBlank()) {
            call.resolve(JSObject())
            return
        }
        val response = JSObject()
        response.put("uri", uri)
        response.put("name", prefs.getString("folder_name", "本地音乐文件夹"))
        call.resolve(response)
    }

    @PluginMethod
    fun searchLocalMusic(call: PluginCall) {
        val treeUri = prefs.getString("tree_uri", null)
        if (treeUri.isNullOrBlank()) {
            call.reject("Please choose a music folder first")
            return
        }
        val query = call.getString("query", "")?.trim()?.lowercase(Locale.ROOT) ?: ""
        try {
            val root = DocumentFile.fromTreeUri(context, Uri.parse(treeUri))
            if (root == null || !root.canRead()) {
                call.reject("The selected folder is no longer accessible. Please choose it again.")
                return
            }

            val found = JSArray()
            val stack = ArrayDeque<DocumentFile>()
            stack.add(root)
            var visited = 0
            var matches = 0
            while (stack.isNotEmpty() && visited < 10000 && matches < 200) {
                val current = stack.removeLast()
                visited++
                if (current.isDirectory) {
                    current.listFiles().forEach { child ->
                        if (child.isDirectory) {
                            stack.add(child)
                        } else if (child.isFile && isAudioFile(child)) {
                            val name = child.name ?: "未知音频"
                            val metadata = readMetadata(child.uri, name)
                            val title = metadata.first
                            val artist = metadata.second
                            val searchable = "$title $artist $name".lowercase(Locale.ROOT)
                            if (query.isEmpty() || searchable.contains(query)) {
                                val item = JSObject()
                                item.put("id", "local:\${child.uri}")
                                item.put("uri", child.uri.toString())
                                item.put("title", title)
                                item.put("artist", artist)
                                item.put("fileName", name)
                                item.put("durationMs", metadata.third)
                                item.put("source", "local")
                                found.put(item)
                                matches++
                            }
                        }
                    }
                }
            }
            val response = JSObject()
            response.put("tracks", found)
            response.put("scanned", visited)
            response.put("truncated", stack.isNotEmpty() || matches >= 200)
            call.resolve(response)
        } catch (e: SecurityException) {
            call.reject("Folder permission expired. Please choose the folder again.", e)
        } catch (e: Exception) {
            call.reject("Could not scan this folder: \${e.message}", e)
        }
    }

    @PluginMethod
    fun prepareTrack(call: PluginCall) {
        val rawUri = call.getString("uri")
        if (rawUri.isNullOrBlank()) {
            call.reject("Missing local music URI")
            return
        }
        try {
            val uri = Uri.parse(rawUri)
            val cacheDir = File(context.cacheDir, "jerrymusic-local").apply { mkdirs() }
            val displayName = queryDisplayName(uri) ?: uri.lastPathSegment ?: "track.mp3"
            val extension = displayName.substringAfterLast('.', "mp3")
                .lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]"), "").take(8).ifBlank { "mp3" }
            val target = File(cacheDir, "\${rawUri.hashCode().toUInt().toString(16)}.$extension")
            if (!target.exists() || target.length() == 0L) {
                context.contentResolver.openInputStream(uri).use { input ->
                    if (input == null) throw IllegalStateException("Cannot open selected audio file")
                    FileOutputStream(target).use { output -> input.copyTo(output) }
                }
            }
            val response = JSObject()
            response.put("path", target.absolutePath)
            response.put("name", displayName)
            call.resolve(response)
        } catch (e: SecurityException) {
            call.reject("No permission to read this audio file. Select the folder again.", e)
        } catch (e: Exception) {
            call.reject("Could not prepare this audio file: \${e.message}", e)
        }
    }

    private fun isAudioFile(file: DocumentFile): Boolean {
        val mime = file.type ?: ""
        val name = file.name ?: ""
        return mime.startsWith("audio/") ||
            name.matches(Regex("(?i).+\\.(mp3|m4a|aac|flac|wav|ogg|opus|wma|aiff?)$"))
    }

    private fun readMetadata(uri: Uri, fallbackName: String): Triple<String, String, String> {
        var title = fallbackName.substringBeforeLast('.')
        var artist = "本地音乐"
        var duration = ""
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(context, uri)
            title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)?.takeIf { it.isNotBlank() } ?: title
            artist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)?.takeIf { it.isNotBlank() } ?: artist
            duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION) ?: ""
        } catch (_: Exception) {
            // Some formats do not expose embedded tags; filename remains searchable.
        } finally {
            try { retriever.release() } catch (_: Exception) {}
        }
        return Triple(title, artist, duration)
    }

    private fun queryDisplayName(uri: Uri): String? {
        val cursor = context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
        cursor?.use {
            if (it.moveToFirst()) {
                val index = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (index >= 0) return it.getString(index)
            }
        }
        return null
    }
}
