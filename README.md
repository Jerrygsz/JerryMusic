# JerryMusic

JerryMusic 是一个面向 Android / HarmonyOS 兼容 Android APK 环境的在线音乐播放器原型。

## 当前功能

- 推荐首页、音乐搜索、最近播放
- 从 Internet Archive 搜索可播放的开放音频
- 播放控制、上一首/下一首与播放进度
- 本机收藏与自建歌单（LocalStorage）
- 深色界面与移动端布局

## 在线音乐与版权

音源来自 Internet Archive 的公开音频条目。Internet Archive 上的内容不等于全部属于公版或可自由下载；使用者应逐项查看作品页面及授权信息。本项目当前以在线播放和个人收藏为主，不提供绕过付费平台或 DRM 的功能。缓存/离线下载功能尚未开放，待逐曲授权核验后再实现。

## 生成 Android APK

GitHub Actions 会在向 `main` 或 `feature/android-apk` 推送代码、向 `main` 发起 Pull Request，或手动触发时自动构建。

1. 打开仓库的 **Actions** 页面。
2. 选择 **Build JerryMusic Android APK**。
3. 等待 **Build debug APK** 任务变为绿色成功。
4. 在该次运行页面底部的 **Artifacts** 下载 `JerryMusic-debug-apk`。
5. 解压 ZIP，得到 `app-debug.apk`。

本工作流使用 Node.js 20、JDK 21 和 Capacitor 7。产物为 debug APK，适合测试安装，不是面向应用市场发布的正式签名包。

## 安装

将 APK 下载到设备，在文件管理器中打开并按系统提示安装。HarmonyOS 4.2 的实际兼容性仍需在 Mate 60 Pro 真机验证。

## 当前限制

- 在线音源可用性、播放稳定性取决于 Internet Archive 条目及网络环境。
- 后台持续播放和锁屏媒体控制尚未通过真机验证；当前版本不承诺完整的原生后台媒体服务体验。
- 尚未实现离线缓存。
- 推荐内容目前为探索入口，后续可接入经过授权的精选曲库。
