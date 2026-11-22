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
const java = "package " + packageName + ";\n\n" +
  "import android.os.Bundle;\n" +
  "import com.getcapacitor.BridgeActivity;\n" +
  "import " + appId + ".LocalMusicPlugin;\n\n" +
  "public class MainActivity extends BridgeActivity {\n" +
  "    @Override\n" +
  "    public void onCreate(Bundle savedInstanceState) {\n" +
  "        registerPlugin(LocalMusicPlugin.class);\n" +
  "        super.onCreate(savedInstanceState);\n" +
  "    }\n" +
  "}\n";
fs.writeFileSync(mainActivity, java, "utf8");

const gradlePath = path.join("android", "app", "build.gradle");
let gradle = fs.readFileSync(gradlePath, "utf8");
if (!gradle.includes("androidx.documentfile:documentfile")) {
  const dependencyBlock = /dependencies\s*\{/;
  if (!dependencyBlock.test(gradle)) throw new Error("Could not find app dependencies block in build.gradle");
  gradle = gradle.replace(dependencyBlock, match => match + "\n    implementation \"androidx.documentfile:documentfile:1.0.1\"");
  fs.writeFileSync(gradlePath, gradle, "utf8");
}
console.log("Registered LocalMusic Capacitor plugin and added DocumentFile dependency.");
