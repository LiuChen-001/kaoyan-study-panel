# 考研综合面板 · 桌面源码

本目录是 Tauri 2 Windows 桌面程序源码，前端使用原生 JavaScript 和 Vite，Rust负责本地文件保存。当前正式版为 **1.10.0**，学习记录格式为 **version 12**。

使用者请从[日常使用 README](../README.md)和[用户必读](../用户必读.md)开始。已构建的程序位于[桌面应用目录](../桌面应用/)，无需安装开发工具即可使用。

## 开发入口

完整说明见[开发文档索引](docs/README.md)：

- [架构与运行过程](docs/architecture.md)
- [数据、持久化、迁移与恢复](docs/data-and-persistence.md)
- [开发、测试与发布流程](docs/development.md)
- [英语精读工作表](docs/english.md)
- [错题索引](docs/wrong-index.md)

节点架构和分数来源见[面板构建说明](../面板构建doc.md)，当前算法见[遗忘曲线算法说明](../遗忘曲线算法说明.md)。协作与发布约定见[AGENTS.md](../AGENTS.md)。

## 常用命令

在本目录执行：

```powershell
npm ci
npm test
npm run test:ui
npm run dev
```

Windows原生开发和构建还需要Rust MSVC工具链、C++构建工具、Windows SDK及WebView2。具体环境要求见开发文档。

```powershell
npm run desktop:dev
npm run desktop:build
```

普通 `desktop:dev` 使用正式应用标识，可能读写真实学习记录。涉及原生存盘或迁移的验证应按开发文档使用隔离配置；隔离与正式构建共用输出路径，验证后必须重新正式构建再交付。

## 数据边界

`src/data.json` 是从原综合工作簿提取的基线内容，个人学习记录单独存储。`npm run extract` 只在明确更新工作簿内容时执行；重新提取不会自动解决节点ID或个人记录映射。

所有分数和掌握度计算使用原始双精度，展示格式不回流计算。节点ID依赖原工作簿坐标，不能为了调整界面随意更改。跨日查询不改写学习起点；只改文档或显示时，也不应改动用户的曲线参数。
