# JerryMusic

JerryMusic 是一个面向 Android / HarmonyOS 兼容 Android APK 环境的音乐播放器原型。

## 当前功能

- 推荐首页、音乐搜索、最近播放
- 在线搜索 Internet Archive 中可在线播放的开放音频
- 发现页支持切换「在线音乐」与「手机本地」
- 手机本地音乐：通过 Android 系统文件夹选择器授权一个目录，递归搜索其中的音频文件
- 本地音频支持读取内嵌标题、艺术家和时长信息；没有标签时回退到文件名
- 在线与本地歌曲共用播放队列、上一首/下一首、进度控制、收藏和自建歌单
- 本地文件夹授权保存在设备上，应用重启后可继续访问

## 本地音乐隐私与文件访问

本地文件夹通过 Android Storage Access Framework（系统文件夹选择器）授权。应用只访问用户明确选择的文件夹及其子目录，不申请读取整个手机存储空间的广泛权限，也不会将本地音乐上传到服务器。

本地歌曲在播放前会复制到应用私有缓存目录，再由播放器读取；缓存位于应用私有空间，不是导出到公共音乐目录。卸载应用或系统清理应用缓存后，可能需要重新选择文件夹或重新准备歌曲。

Android 系统对部分特殊目录（例如 Android/data、Android/obb 和存储根目录）有访问限制。若系统文件选择器不允许选择某个目录，请改选 Music 或你自己创建的普通音乐文件夹。

## 在线音乐与版权

在线音源来自 Internet Archive 的公开音频条目。Internet Archive 上的内容不等于全部属于公版或可自由下载；使用者应逐项查看作品页面及授权信息。本项目当前以在线播放和个人收藏为主，不提供绕过付费平台或 DRM 的功能。离线缓存/下载功能尚未开放。

## 生成 Android APK

GitHub Actions 会在向 main 或 feature/android-apk 推送代码、向 main 发起 Pull Request，或手动触发时自动构建。

1. 打开仓库的 Actions 页面。
2. 选择 Build JerryMusic Android APK。
3. 等待 Build debug APK 任务变为绿色成功。
4. 在该次运行页面底部的 Artifacts 下载 JerryMusic-debug-apk。
5. 解压 ZIP，得到 app-debug.apk。

工作流使用 Node.js 20、JDK 21 和 Capacitor 7。构建时会生成一个 Android 原生 Capacitor 插件，用于 SAF 文件夹授权、扫描本地音频和准备本地播放文件。产物为 debug APK，适合测试安装，不是面向应用市场发布的正式签名包。

## 安装与测试

将 APK 下载到设备，在文件管理器中打开并按系统提示安装。HarmonyOS 4.2 的实际兼容性仍需在 Mate 60 Pro 真机验证。建议重点测试：

1. 打开「发现音乐」→「手机本地」。
2. 选择手机中自己创建的普通音乐文件夹（例如 Music）。
3. 搜索歌曲名、艺术家或文件名。
4. 点击本地歌曲播放，检查进度、上一首/下一首、收藏和歌单。
5. 退出并重新打开应用，确认文件夹授权仍然有效。

## 当前限制

- 在线音源可用性、播放稳定性取决于 Internet Archive 条目及网络环境。
- 本地扫描最多遍历 10,000 个目录节点、最多返回 200 首匹配歌曲，避免一次扫描过大的文件夹拖慢手机。
- 本地播放会先把所选歌曲复制到应用私有缓存，再交给 WebView 播放；首次播放较大的文件会有准备时间。
- 后台持续播放和锁屏媒体控制尚未通过真机验证；当前版本不承诺完整的原生后台媒体服务体验。
- HarmonyOS 4.2 的系统文件夹选择器行为与实际音频格式兼容性，仍需在 Mate 60 Pro 真机验证。


## Product direction

JerryMusic is a local-first Android music player. Online music discovery and streaming have been removed; network access is retained for lyric lookup only when local lyrics are unavailable. Listening history and play statistics are stored locally on the device.
