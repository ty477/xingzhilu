# 行知录 · 个人旅行相册 Wiki

一个部署在 GitHub Pages 上的个人旅行相册：每个地方一页——照片相册 + AI 写的「风景介绍」+ 自己写的「自我感受」。上传新照片、添加新地方，全部在浏览器里完成。

## 网站结构

| 页面 | 地址 | 用途 |
|---|---|---|
| 首页 | `#/` | 所有去过的地方（大图卡片墙） |
| 地方页 | `#/place/敦煌的slug` | 相册 / 风景介绍 / 自我感受 |
| 管理页 | `#/admin` | 连接 GitHub、上传新地方、查看 AI 状态 |

## 首次配置（一次性，约 10 分钟）

### 1. 让网站能写数据：GitHub 令牌（PAT）

1. 登录 GitHub → 打开 [创建细粒度令牌](https://github.com/settings/personal-access-tokens/new)
2. Token name 填 `album`；Expiration 选较长有效期
3. **Repository access** 选 `Only select repositories` → 选中本仓库
4. **Permissions → Repository permissions → Contents → Read and write**（其它权限一律不给）
5. Generate token → 复制那串 `github_pat_...`（只显示一次）
6. 打开网站 `#/admin` → 粘贴到「连接 GitHub」面板 → 保存并测试连接

> 令牌只存在你这台设备的浏览器 localStorage 里，不会发给任何第三方（除了 GitHub 官方 API）。

### 2. 让 AI 会写介绍：智谱 API Key

1. 注册 [智谱开放平台](https://open.bigmodel.cn) → 「API Keys」→ 创建（新用户有免费额度）
2. GitHub 仓库 → `Settings` → `Secrets and variables` → `Actions` → `New repository secret`
3. Name：`AI_API_KEY`，Value：你的 Key
4. 完成。想换模型：仓库 `Settings → Secrets and variables → Actions → Variables` 加 `AI_MODEL`（如 `glm-4.6`）、`AI_BASE_URL`（任何 OpenAI 兼容服务）

## 日常使用

- **写感受**：进入地方页 → 「✍️ 写下我的感受」→ 保存（几秒后生效）
- **补照片**：进入地方页 → 「📷 添加照片」→ 多选上传（自动压缩到最长边 2560px）
- **新地方**：`#/admin` → 「添加一个新地方」→ 填地名、拖照片 → 上传后 AI 约 1 分钟写好介绍
- **页面没更新？** GitHub Pages 有约 10 分钟 CDN 缓存，强制刷新（Ctrl+F5）或稍等

## iPhone 用户注意

iPhone 默认拍照是 HEIC 格式，浏览器无法处理。两个解决办法任选：

- 设置 → 相机 → 格式 → 选「兼容性最佳」（以后拍照就是 JPG）
- 或上传前：照片 → 分享 → 选项 → 格式选「最兼容」导出

## 文件结构（给未来的你或 AI 助手）

```
index.html                  # 单页应用入口（无构建步骤，纯静态）
assets/                     # 样式与脚本（app/github/markdown）
content/site.json           # 站点名称等配置
content/places.json         # 地方索引（首页卡片数据）
content/places/<slug>.json  # 每个地方的完整数据（照片清单/介绍/感受/状态）
photos/<slug>/NN.jpg        # 照片（浏览器压缩后直传）
placeholder/                # 占位图（有真照片后自动被替换）
.github/workflows/generate.yml   # AI 生成工作流
.github/scripts/generate.py      # 生成脚本（可本地手跑：AI_API_KEY=xxx python generate.py）
```

## 隐私说明

仓库为 public（GitHub Pages 免费托管的条件），即照片与文字 **任何人可通过网址看到**。若某张照片不想公开，就不要上传它；也可以以后迁移到付费私有仓库方案。

## 重新生成某地的介绍

把 `content/places/<slug>.json` 里的 `status` 改成 `"pending"`，再到仓库 `Actions` → 「生成风景介绍」→ `Run workflow`。
