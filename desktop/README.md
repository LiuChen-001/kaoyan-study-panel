# 考研综合面板 · 桌面源码

本目录是 Tauri 2 Windows 桌面程序源码，前端使用原生 JavaScript 和 Vite，Rust负责本地文件保存。当前正式版为 **1.12.0**，学习记录格式为 **version 14**。

使用者请从[日常使用 README](../README.md)和[面板构建底层逻辑](../面板构建底层逻辑.md)开始。已构建的程序位于[桌面应用目录](../桌面应用/)，无需安装开发工具即可使用。

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
npm run test:evaluation
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

`src/data.json` 保留从原综合工作簿提取的基线内容，个人学习记录单独存储。综合源工作簿已移除，日常开发和构建直接使用现有JSON。只有自行准备好源工作簿并放回原路径后，才能执行 `npm run extract`；重新提取不会自动解决节点ID或个人记录映射。

所有分数和掌握度计算使用原始双精度，展示格式不回流计算。节点ID依赖原工作簿坐标，不能为了调整界面随意更改。跨日查询不改写学习起点；只改文档或显示时，也不应改动用户的曲线参数。


1.12.0只将初学p改为0.55；复习更新公式完全不变，包括其中的0.5基准。v11/v12/v13升级到v14时，仅调整已初学未复习的顶层p并从原日期预测，已复习节点及文章的全部曲线和origin保持原值。


1.12.0：新初学及尚未复习曲线的记忆率为55%；v11/v12/v13升级到v14仅修改这类曲线顶层p并按原日期预测。已复习曲线、origin和复习更新公式保持原状，升级备份progress-before-initial-fifty-five-v<旧版本>.json。当前评测以初始0.55的forgetting-evaluation.json为准，历史50%/60%结果不作为当前目标。
