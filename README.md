# How It Works

这个仓库用来记录一些值得深入理解的工具、框架和工程项目：**不只介绍它能做什么，而是尽量从源码、运行时、协议和真实执行链路解释它到底是怎么工作的。**

重点不是复述官方 README，而是回答这类问题：

- 一个功能真正从哪个入口开始执行？
- 中间经过哪些 Runtime / Provider / Protocol / Process？
- 哪些能力是 Prompt 引导，哪些是类型系统或运行时真正提供的？
- 为什么它会更快、更省 context，或者为什么某些场景反而不会？
- 宣传中的概念（例如 Agent、RLM、Code Mode）在源码里最终对应什么实现？
- 它和更简单的实现方式，例如直接写 Python / Shell，有什么工程层面的差异？

## 阅读方式

GitHub 仍然是这个仓库唯一的 Source of Truth；VitePress 只负责把现有 Markdown 渲染成更适合桌面和手机阅读的文档站。

文档站具备：

- 自动扫描专题目录和 Markdown 文件生成侧栏，不需要手工维护导航。
- VitePress 本地全文搜索。
- 手机端阅读样式优化，包括正文宽度、标题、代码块和表格横向滚动。
- PWA 支持，可在 Android / iOS 的浏览器中添加到主屏幕。
- Vercel 部署配置，GitHub push / PR 可以直接生成 Production / Preview 部署。

本地运行：

```bash
pnpm install
pnpm docs:dev
```

构建和本地预览：

```bash
pnpm docs:build
pnpm docs:preview
```

Vercel 导入这个 GitHub 仓库后会读取 `vercel.json`：

- Build Command：`npm run docs:build`
- Output Directory：`.vitepress/dist`
- Install Command：`npm install`
- Node.js：`24.x`

本地开发仍然使用 `pnpm`；Vercel 构建故意使用 npm，避免部署环境对 pnpm / Corepack 版本探测造成不稳定。

因此不需要额外维护 GitHub Pages workflow。

## Topics

| 主题 | 内容 |
|---|---|
| [Pi Fabric](./pi-fabric/) | 从源码拆解 `fabric_exec`、QuickJS、Host Bridge、ActionRegistry、MCP、Agent、RLM，以及 Context Economy |

后续会继续增加其他项目，每个项目原则上使用独立目录，并在目录内提供自己的 `README.md` 作为专题入口。

## 文档原则

这个仓库里的分析尽量遵循几个原则：

1. **源码优先**：关键结论尽量能追到具体文件、函数、类或协议。
2. **固定源码快照**：容易随版本变化的分析尽量引用具体 commit，而不是只链接 `main`。
3. **区分事实与判断**：源码能直接确认的事实，与基于源码做出的架构理解或评价尽量分开表达。
4. **解释执行链路**：相比功能清单，更关注数据和控制流究竟怎么走。
5. **保留边界条件**：不把“某些场景更快/更省 token”写成无条件结论。
6. **链接原始资料**：尽量附上源码、官方文档、论文和相关项目链接，方便继续深入。

## 维护约定

仓库更新时，**文档索引也要同步更新**，避免新增内容存在但入口 README 已经过期。

具体约定：

- 新增一个专题目录时，同步更新根目录 `README.md` 的 Topics。
- 在现有专题新增、删除或重命名主要文档时，同步更新该专题的 `README.md`。
- VitePress 侧栏会自动发现 Markdown，因此通常不需要额外修改 `.vitepress` 导航配置。
- 如果新增内容改变了专题的核心结论、推荐阅读顺序、源码快照或重要引用，也同步修正对应 README / references。
- 如果上游项目版本变化导致已有结论失效，应标明新的分析 commit，或者明确说明旧文档对应的历史快照。
- README 只保留导航和核心结论；细节尽量拆到专题文档，避免 README 变成不可维护的超长文章。

换句话说，每次修改这个仓库时，不只检查“正文有没有更新”，也要检查：

```text
root README
    ↓
topic README
    ↓
references / navigation
    ↓
具体分析文档
```

它们是否仍然彼此一致。

## 当前专题

### Pi Fabric

目录：[pi-fabric](./pi-fabric/)

当前主要覆盖：

- 整体架构和 Provider system
- `fabric_exec` 的完整执行链路
- TypeScript guest code 与 QuickJS sandbox
- `__fabricHostCall` Host Bridge
- `read / grep / MCP` 的串并行执行
- 中间态、`return` 与 Main LLM context 的边界
- Prompt Guidance + TypeScript declarations + Runtime 三层关系
- Agent / recursive agent / RLM / Council / Workflow
- 源码引用与相关论文

建议从 [pi-fabric/README.md](./pi-fabric/README.md) 开始阅读。
