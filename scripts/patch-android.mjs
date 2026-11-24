import fs from "node:fs";
import path from "node:path";

const appId = "com.jerrymusic.app";
const packageDir = path.join("android", "app", "src", "main", "java", ...appId.split("."));
fs.mkdirSync(packageDir, { recursive: true });
fs.copyFileSync("native/LocalMusicPlugin.java", path.join(packageDir, "LocalMusicPlugin.java"));

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const mainActivity = walk(path.join("android", "app", "src", "main", "java"))
  .find(file => path.basename(file) === "MainActivity.java");
if (!mainActivity) throw new Error("Capacitor MainActivity.java was not found");

const original = fs.readFileSync(mainActivity, "utf8");
const packageMatch = original.match(/^package\s+([a-zA-Z0-9_.]+)\s*;/m);
if (!packageMatch) throw new Error("Could not detect MainActivity package");
const packageName = packageMatch[1];
const java = "package ${packageName};\n\nimport android.os.Bundle;\nimport android.media.session.MediaSession;\nimport android.media.session.PlaybackState;\nimport android.media.MediaMetadata;\nimport android.content.Intent;\nimport android.view.KeyEvent;\nimport com.getcapacitor.BridgeActivity;\nimport ${appId}.LocalMusicPlugin;\n\npublic class MainActivity extends BridgeActivity {\n    private MediaSession mediaSession;\n    private void sendControl(String action) {\n        if (bridge != null && bridge.getWebView() != null) {\n            bridge.getWebView().evaluateJavascript(\"window.jerryNativeMediaControl && window.jerryNativeMediaControl('\"+action+\"')\", null);\n        }\n    }\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(LocalMusicPlugin.class);\n        super.onCreate(savedInstanceState);\n        mediaSession = new MediaSession(this, \"JerryMusic\");\n        mediaSession.setCallback(new MediaSession.Callback() {\n            @Override public void onPlay() { sendControl(\"play\"); }\n            @Override public void onPause() { sendControl(\"pause\"); }\n            @Override public void onSkipToNext() { sendControl(\"next\"); }\n            @Override public void onSkipToPrevious() { sendControl(\"previous\"); }\n            @Override public boolean onMediaButtonEvent(Intent intent) {\n                KeyEvent event = intent == null ? null : intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);\n                if (event != null && event.getAction() == KeyEvent.ACTION_DOWN) {\n                    switch (event.getKeyCode()) {\n                        case KeyEvent.KEYCODE_MEDIA_PLAY: sendControl(\"play\"); return true;\n                        case KeyEvent.KEYCODE_MEDIA_PAUSE: sendControl(\"pause\"); return true;\n                        case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: sendControl(\"toggle\"); return true;\n                        case KeyEvent.KEYCODE_MEDIA_NEXT: sendControl(\"next\"); return true;\n                        case KeyEvent.KEYCODE_MEDIA_PREVIOUS: sendControl(\"previous\"); return true;\n                    }\n                }\n                return super.onMediaButtonEvent(intent);\n            }\n        });\n        mediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);\n        mediaSession.setPlaybackState(new PlaybackState.Builder().setActions(\n            PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE |\n            PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS).setState(PlaybackState.STATE_PAUSED, 0, 1).build());\n        mediaSession.setActive(true);\n    }\n    @Override\n    public void onDestroy() {\n        if (mediaSession != null) { mediaSession.setActive(false); mediaSession.release(); }\n        super.onDestroy();\n    }\n}\n";
const resolvedJava = java.replace("${packageName}", packageName).replace("${appId}", appId);
fs.writeFileSync(mainActivity, resolvedJava, "utf8");

const gradlePath = path.join("android", "app", "build.gradle");
let gradle = fs.readFileSync(gradlePath, "utf8");
if (!gradle.includes("androidx.documentfile:documentfile")) {
  const dependencyBlock = /dependencies\s*\{/;
  if (!dependencyBlock.test(gradle)) throw new Error("Could not find app dependencies block in build.gradle");
  gradle = gradle.replace(dependencyBlock, match => match + "\n    implementation \"androidx.documentfile:documentfile:1.0.1\"");
  fs.writeFileSync(gradlePath, gradle, "utf8");
}
console.log("Registered LocalMusic Capacitor plugin and added DocumentFile dependency.");
