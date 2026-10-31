# NewsNook 浏览器看图模式 · 大图与移动端资源预算修复

日期：2026-10-25 · 基线 `origin/beta` (`4da821c`) · 分支 `fix/browser-image-large-preview`。

**交付范围：独立分支，不合并 beta/master、不发版、不触碰已连接的个人手机。**

## 根因

此前原图加载前，HTTP / blob / data 三条路径都使用固定 **6 MiB** 的源字节上限，导致原本在网页中可显示的高分辨率图片被前置拒绝。此外前端 `browserImageBlob` 同样拒绝超过 6 MiB 的桥接数据。单纯改成更大的常量会让大文件在 Java byte[]、Base64 字符串、JS Blob 和 Bitmap 中同时存在，导致手机内存峰值上升。

## 保留与删除

- **删除**：预览必须先把整个原图读进 Java Heap 的约束，以及源文件超过 6 MiB 就让用户返回网页的逻辑。
- **保留**：原网页点击逻辑不被拦截、扫描需要用户主动进入看图模式、跨页和跨标签隔离、私密模式导出确认、原始文件在保存/分享时不被画质压缩。
- **保留并收窄**：使用清晰的设备保护预算约束瞬时内存、Bitmap 解码像素、并发与磁盘流量。缩略图预算绝不影响大图能否打开。

## 数据流 / 移动端架构

### HTTP 原图

1. 沿用已有的页面请求信息、Cookie、UA、Same-Origin 及重定向鉴权隔离机制。
2. 图片体按 32 KiB 缓冲区流式写入应用私有临时文件（不创建整个源文件 Java byte[]），先验证 `Content-Length`，缺失或不可信时仍通过实时计数约束。
3. 使用 `BitmapFactory.Options.inJustDecodeBounds` 仅读取宽高和格式；按目标像素预算计算 `inSampleSize` 再解码。只有一个 Bitmap 解码许可，避免并行解码叠加峰值。
4. 预览经过采样、WebP 压缩和必要的逐步缩小后，才作为受控的 Base64 结果返回 WebView。图片灯箱仍使用原有 Blob URL 和手势。
5. 保存/分享时返回临时 **`file://` URI**，通过 FileSystem/Media/Share 直接处理文件；不把几十 MiB 的原图放进 JS 桥接。源文件未被其他请求使用时优先重命名转移所有权，减少磁盘复制。

### Blob / data 原图

- 在源网页的 JS 上下文启动 Fetch；支持 `ReadableStream` 时只在原生层确认收到上一块后读取下一块。跨桥单块最大 **192 KiB**，不会将整个文件组装成 JS 数组再转成 Base64。
- 较旧、未提供流接口的 WebView 使用受源文件预算约束的 Blob 分片兜底。
- Native 端收到分片后追加到专属临时文件，校验总大小、格式一致性、传输完成后的实际字节数；取消、页面变化或读取错误时关闭流、释放文件。
- 不为查看图片安装网站点击钩子；不会把来源域名或带签名的图片 URL 暴露到应用图片 `src`。

### 预算与性能策略

| 资源 | 限制与原因 |
|---|---|
| 原图下载/导出 | 每次最大 128 MiB 的**设备保护边界**；超出时返回准确错误，不会尝试耗尽磁盘和内存 |
| 后台缩略图源 | 每次最多 16 MiB；超出只显示“点击查看大图”，用户仍可正常打开大图 |
| HTTP 下载任务 | 最多 2 个 worker；Bitmap 解码通过 semaphore 串行为 **1 个** |
| 显示解码目标 | 最多 2.56M 像素，约 9.8 MiB ARGB_8888 像素缓冲（不含 Android/Skia 临时分配） |
| 缩略图解码 | 最多 102,400 像素；单张预览传输最多 128 KiB |
| 大图预览跨桥 | 每张最多 2 MiB，压缩质量与尺寸根据预算自适应；原图不受这一预览传输上限影响 |
| 页面源缓存 | 最多 12 MiB Java Heap / 40 MiB 磁盘且最多 2 个源文件，LRU 淘汰；同图缩略图→大图可复用已下载字节 |
| React 图片 URL 缓存 | 沿用 48 项缩略图/4 MiB、3 项展示图/12 MiB；退出时撤销 Blob URL |
| 相邻图片预取 | 当前图片优先；稳定 350ms 后最多预取 **1 张不超过 2MP** 的相邻图片；快速翻图取消旧任务，不同时下载左右两张大图 |
| 超时/取消 | 缩略图/展示图/原图各有时间预算；离开、切页、重扫、失去原生页面时取消在途网络与转换任务 |

这些是代码中的安全上限与并发约束，**不是实测的全进程峰值 RSS、功耗或帧率**。

### 生命周期与隐私

- 原始下载写到应用沙盒临时目录，不进入应用图片相册，不进入浏览记录；清理发生在源缓存淘汰、看图模式退出、网页导航、标签页关闭。
- 保存只在用户操作时拷贝到相册；私密模式沿用“导出会话”二次确认。
- 分享使用独立缓存副本，允许接收方在选择完成后短时间内读取；约 60 秒后清理。原始来源文件可以立即释放。
- 上次进程异常终止留下的临时图片和分享文件，在浏览器图片子系统下一次初始化时清理。
- 这些短期文件会落到应用私有存储，因此不会宣称“浏览过程中原图从不写入磁盘”；它们不参与持久缓存、同步、历史或用户内容库。

## 验收与证据

1. Robolectric Android 34 Native Graphics：在单测中生成超过 6 MiB 的高熵 PNG，调用实际 `BitmapFactory` 解码/采样/WebP 压缩链，验证跨桥输出最大 2 MiB。
2. Android JVM：7 MiB 原始数据无需整块 Heap 缓冲即可流式写入；超预算被拒绝；非常大宽高的采样计算受像素预算约束；磁盘源缓存 LRU / 引用计数 / 淘汰 / 释放验证。
3. 网页资源探针：7 MiB `blob:` 分块传输字节逐块对齐；一块 600 KiB 的上游流拆成多次不超过 192 KiB 的跨桥回调；Native 不请求时 JS 不预先读完流；无 `Content-Length` 也保持预算。
4. React 看图面板：背景缩略图超预算时显示点击打开大图，真正的大图正常进入灯箱；懒加载、快速翻图、隐私导出审批、缓存释放与取消通过。
5. 原图保存/分享：覆盖文件 URI、目录已存在、用户取消分享、复制失败时清理路径。无大原图 Base64 回传。
6. 整套浏览器测试（含 Browser Agent）、TypeScript、ESLint、WebView CSS/JS 兼容检查和 Android Cloud Debug 构建。

### 最终验收命令

```sh
npm run test:browser-images
npm run test:browser
npx tsc -b --pretty false
npm run lint
npm run test:webview-css-compat
npm run test:webview-runtime-compat
npm run build
npx cap copy android
cd android
./gradlew.bat :app:testCloudDebugUnitTest --tests 'com.aizeek.newsnook.BrowserImageCaptureLifecycleTest' --offline
./gradlew.bat :app:assembleCloudDebug --offline
```

### 后续仅在有设备证据时进行

当前验证能证明相对于旧版移除了 6 MiB 的前置拒绝、建立了有界的 CPU/网络/内存/磁盘处理路径。**未针对真实手机给出稳定 FPS、峰值 RSS、发热或电量数字。** 要做硬件性能准入，应另行在低内存 Android 设备上实际测量 Android Studio Memory Profiler、`dumpsys meminfo` 和长图/多张连续切换的帧时间，不依赖估算数字。
