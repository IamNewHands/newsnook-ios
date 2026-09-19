# NewsNook 发布通道

NewsNook 使用两个长期分支承载两套代码状态，但不在业务代码中维护 Beta 功能开关。

## 分支职责

| 分支 | 发布通道 | 版本格式 | GitHub Release |
| --- | --- | --- | --- |
| `main` | Stable 正式版 | `X.Y.Z` | 正式 Release |
| `beta` | Beta 内测版 | `X.Y.Z-beta.N` | Pre-release |

业务功能差异由 Git 分支本身承载。除应用更新基础设施外，业务模块不应读取 `stable/beta` 状态来决定功能是否显示。

## 开发流程

1. 正式版代码位于 `main`。
2. 下一版本开发在 `beta` 上进行；功能分支合并到 `beta`。
3. Beta 发布时更新版本，例如 `1.8.7-beta.1`，然后创建同名 tag：`v1.8.7-beta.1`。
4. 验证稳定后，将 `beta` 合并到 `main`。
5. 将版本改为正式版本，例如 `1.8.7`，在 `main` 创建 `v1.8.7`。
6. 正式发布完成后，将 `main` 合并回 `beta`，开始下一版本，例如 `1.8.8-beta.1`。

不要直接在 `main` 开发尚未准备正式发布的新功能。

## Tag 与 CI 防误发

`.github/workflows/android-release.yml` 会在任何 `v*` tag 推送时启动，但发布前会执行强校验：

- `vX.Y.Z` 只能作为 Stable 发布，tag 提交必须属于 `main`。
- `vX.Y.Z-beta.N` 只能作为 Beta 发布，tag 提交必须属于 `beta`。
- tag 版本必须与 `package.json` 完全一致，`package-lock.json` 顶层与根 package 版本也必须一致。
- CI 会验证 cloud/local APK 的 `versionName` 与计算得到的 `versionCode`，防止构建覆盖变量产生元数据漂移。
- Beta Release 自动设置为 GitHub Pre-release。
- Stable Release 为普通 GitHub Release。
- Actions 运行标题会明确显示 Stable / Beta。

因此，仅仅“打了一个 tag”不再等于向所有用户正式发布。

## R2 目录

新客户端使用独立发布通道：

```text
newsnook/
├── stable/
│   ├── latest.json
│   ├── latest-cloud.apk
│   ├── latest-local.apk
│   ├── newsnook-X.Y.Z-cloud-release.apk
│   └── newsnook-X.Y.Z-local-release.apk
└── beta/
    ├── latest.json
    ├── latest-cloud.apk
    ├── latest-local.apk
    ├── newsnook-X.Y.Z-beta.N-cloud-release.apk
    └── newsnook-X.Y.Z-beta.N-local-release.apk
```

每次发布只清理当前通道目录，Beta 不允许删除 Stable 对象，Stable 也不允许删除 Beta 对象。所有 Android Release workflow 全局串行执行，并在写入 R2 前与当前通道 `latest.json` 比较版本；低于当前版本的 tag 会被拒绝，避免并发、重跑或旧 tag 把 `latest.json` 回滚。

### 旧客户端兼容

1.8.6 及更早客户端只认识：

```text
/newsnook/latest.json
/newsnook/latest-cloud.apk
```

因此 Stable 发布暂时继续同步一份 schema v1 根目录兼容清单和 APK。Beta 从不写入这些兼容入口。

等旧版本存量足够低后，才可以单独评估移除兼容发布；不要在 Beta 发布流程中删除它。

## 客户端设置

“更新通道”和“安装包类型”是两个独立维度：

- 更新通道：`stable | beta`
- 安装包类型：`cloud | local`

默认更新通道始终为 Stable。普通用户只读取 Stable：

```text
https://news-update.aizeek.com/newsnook/stable/latest.json
```

只有用户在“设置 → 关于 → 更新通道”主动选择“内测版”后，才拥有 Beta 资格。Beta 订阅会同时检查 Stable 与 Beta：

```text
https://news-update.aizeek.com/newsnook/stable/latest.json
https://news-update.aizeek.com/newsnook/beta/latest.json
```

客户端选择其中**可安装且 SemVer 更高**的版本。因此正式 `1.8.8` 会自然取代 `1.8.8-beta.N`，而下一版 `1.8.9-beta.1` 又可以高于 `1.8.8`。

Web 官网下载入口继续使用历史兼容地址 `https://news-update.aizeek.com/newsnook/latest-cloud.apk`。该根目录对象只由 Stable 发布更新，所以不会向普通访客分发 Beta，同时避免双通道迁移首发前 `/stable/` 对象尚不存在造成 404。

## 从 Beta 切回 Stable

切回 Stable 只改变后续更新订阅，不进行 APK 降级。

例如：

```text
当前：1.8.8-beta.3
Stable 最新：1.8.7
```

客户端应显示当前无需更新。等 `1.8.8` 正式发布后：

```text
1.8.8-beta.3 -> 1.8.8
```

正常升级回正式版。

## Android versionCode

版本名和 Android versionCode 使用固定规则：

```text
core = major * 10000 + minor * 100 + patch
beta.N = core * 1000 + N
stable = core * 1000 + 999
```

例如：

```text
1.8.7-beta.1 -> 10807001
1.8.7-beta.2 -> 10807002
1.8.7          -> 10807999
1.8.8-beta.1 -> 10808001
```

这保证 Android 始终认为：

```text
beta.1 < beta.2 < ... < stable < 下一版本 beta.1
```

Beta 序号限制为 1..998。

## 发布前检查

至少执行：

```bash
npm run test:app-update
npm run lint
npm run build
git diff --check
```

发布工作流自身还会再次运行更新系统测试并检查生成产物。

## 首次启用双分支

首次迁移时，先把双通道基础设施作为一个 Stable 版本发布到 `main`，让现有旧客户端通过根目录兼容清单升级到支持通道选择的新客户端。确认该 Stable 发布成功后，再从最新 `main` 创建长期 `beta`：

```bash
git switch main
git pull --ff-only
git switch -c beta
git push -u origin beta
```

之后按本文流程开发和发布。
