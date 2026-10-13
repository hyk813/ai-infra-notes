# AI Infra Notes

一个本地优先的个人资料站，用来整理 **知识笔记、面试复盘和技术文章**。内容是普通 Markdown 文件，界面参考 AIInfraGuide 的分类入口、文档导航与博客列表形式，自行实现站点代码和示例内容。

## 本地运行

需要 Node.js **22.12 或更高版本**，推荐 Node.js 24。

```bash
cd ai-infra-notes
npm ci
npm run dev
```

打开 <http://127.0.0.1:4321/>。开发模式支持热更新和草稿预览。

开发服务通常在前台运行，可用 `Ctrl+C` 停止；也支持后台运行。后台模式的启动、查看和停止方式：

```bash
npm run dev -- --background
npm run astro -- dev status
npm run astro -- dev stop
```

首次安装依赖需要网络；安装完成后，本地站点浏览、全文搜索、主题切换、收藏、公式和代码高亮不依赖在线服务。`.npmrc` 将 npm 缓存放在仓库的 `.npm-cache/`；Astro 命令包装器关闭遥测，不修改用户全局偏好。

## 日常写作

```bash
npm run new -- knowledge "KV Cache 容量计算" --category inference --slug kv-cache-size
npm run new -- interviews "某公司一面复盘" --slug first-interview
npm run new -- articles "一次 I/O 性能分析" --slug io-analysis
```

新文档默认 `draft: true`，开发模式可预览。完成后改成 `draft: false`，正式构建才会收录。脚本不会覆盖已有文件，也可以直接复制 `templates/` 下的模板。

| 内容 | 存放目录 |
| --- | --- |
| 八股、知识与常见追问 | `content/knowledge/` |
| 面试记录与复盘 | `content/interviews/` |
| 技术文档、实践记录和文章 | `content/articles/` |
| 新建文档模板 | `templates/` |

开头的 YAML 信息决定分类、标签、更新时间和状态：

```yaml
---
title: "笔记标题"
description: "一句话摘要"
category: inference
tags: [KV Cache, GQA]
date: 2026-10-13
updated: 2026-10-13
order: 10
status: review
draft: false
---
```

- `category`：`inference`、`models`、`systems`、`programming`。
- `status`：`ready` 表示已整理，`review` 表示待复习。
- `order`：章节导航顺序，列表页仍按更新时间排列。
- `isExample: true`：示例会被明确标注；实际面经不需要此字段。
- 面经还可填写 `company`、`role`、`round`。
- 两级、三级标题生成正文目录；代码块带高亮和复制按钮；支持 KaTeX 数学公式。
- 支持相对 Markdown 内链，例如 `[容量计算](../knowledge/kv-cache-size.md)`，生成时转换成阅读页链接。

详细说明也可以在站点的 **写作指南** 页面查看。

## 浏览功能

- 首页：三类入口、知识分类、最近更新。
- 列表：按方向、标签及关键词筛选，筛选状态可保存在 URL 中。
- 阅读：章节侧栏、本文目录、阅读进度、代码复制与关联阅读。
- 搜索：`Ctrl/⌘ + K` 打开，搜索标题、标签与完整正文；支持中文关键词。
- 收藏：阅读页点击收藏，保存在当前浏览器的 localStorage 中。
- 深浅主题：尊重首次打开时的系统偏好，手动切换后记住选择。
- 手机端：导航、列表、阅读与搜索有独立适配。

开发模式的搜索包含草稿；正式构建会排除草稿。示例面经是模拟内容，不代表真实面试经历。初始知识笔记可以直接修改或删除，不需要改页面代码。

## 检查与静态预览

```bash
npm run check
npm run build
npm run preview
```

`dist/` 是完整静态站点，必须通过本地 HTTP 服务访问；不能直接双击 HTML，因为搜索需要读取本地 JSON 索引。`npm run preview` 是推荐方式。

## 仓库结构

```text
content/              Markdown 资料
templates/            三类写作模板
scripts/              新建文档、Markdown 内链和 Astro 启动脚本
src/config.ts         站点名称、作者、导航与分类
src/content.config.ts 内容信息校验
src/pages/            首页、分类列表、阅读页、收藏与搜索索引
src/components/       图标、资料卡片
src/styles/           页面与正文样式
src/scripts/          搜索、筛选、主题、收藏与代码复制
public/               网站图标等静态资源
```

## 后续放到 GitHub

这是一个独立 Git 仓库，上传时在本目录内配置自己的远程地址并推送。依赖、构建产物和缓存已被忽略；保留 `package-lock.json` 以锁定依赖。没有自动部署或推送行为。

如果未来需要 GitHub Pages 等子路径部署，可以指定路径再构建：

```bash
SITE_BASE=/ai-infra-notes npm run build
```

默认路径为 `/`，适合当前本地使用。图片建议使用 Markdown 相对路径，使 Astro 在构建中处理。

## 呈现参考

- [AIInfraGuide 仓库](https://github.com/caomaolufei/AIInfraGuide)
- [AIInfraGuide 站点](https://caomaolufei.github.io/AIInfraGuide/)

参考其信息组织形式；本站没有复制其教程文章、品牌素材或站点源代码。
