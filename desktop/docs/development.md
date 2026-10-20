# 开发、测试与发布

除特别注明，以下命令都在 `考研面板/desktop/` 下用 PowerShell 执行。日常用户运行 exe，不需要安装开发工具。

## 1. 环境与首次启动

| 工具 | 要求与作用 |
| --- | --- |
| Node.js / npm | 本地 Vite 7.3.6 声明 Node `^20.19.0 || >=22.12.0`；安装前端及 Tauri CLI |
| Rust / Cargo | Windows MSVC 工具链，用于 Tauri；项目没有指定固定 Rust 版本文件 |
| Microsoft C++ Build Tools / Windows SDK | Windows 原生编译与链接 |
| WebView2 Runtime | 正式应用与原生验证的 WebView |
| Microsoft Edge | Playwright 配置使用 `channel: msedge` |
| Python 3 | 仅重新提取工作簿时需要；脚本只用标准库 |

2026-10-07 本机核对环境：Node 24.11.1、npm 11.6.2、Rust/Cargo 1.95.0、Python 3.14.0。这是本机实测记录，不是跨平台支持承诺。依赖精确版本由 `package-lock.json` 和 `src-tauri/Cargo.lock` 决定。

```powershell
npm ci
npm run dev
```

预览地址 `http://127.0.0.1:1420`，严格占用此端口；数据保存在当前 origin 的 localStorage，与正式 Windows 记录分离。不要混用 `localhost` 与 `127.0.0.1` 判断数据是否丢失。

```powershell
npm run desktop:dev
```

此命令启动正式标识的 Tauri 开发实例，可能读取及修改真实学习记录。调试保存、迁移等场景优先使用以下隔离配置：

```powershell
npm run tauri -- dev --config src-tauri/verification.conf.json
```

该配置窗口默认为隐藏，适合自动验证；如需交互调试，应在专用验证配置中调整可见性，保持 `.verification` 标识，不把验证配置作为正式发布配置。

## 2. 目录与生成文件

| 路径 | 管理方式 |
| --- | --- |
| `src/`、`scripts/`、`tests/`、`src-tauri/src/` | 源码，修改后按影响运行测试 |
| `src/data.json` | 提取产物，也是构建输入；需随源码保存与审核 |
| `package-lock.json`、`src-tauri/Cargo.lock` | 锁文件；升级依赖应审核差异 |
| `dist/`、`src-tauri/target/` | 构建产物，不是源数据 |
| `test-results/` | Playwright 截图及原生验证 WebView 临时数据 |
| `node_modules/`、`.npm-cache/`、`src-tauri/gen/` | 依赖/工具生成目录 |
| `../桌面应用/` | 用户交付目录，仅保留经验证的最新 exe |

本地 `.gitignore` 已排除依赖、构建和测试产物。当前工作区未建立 Git 仓库，也没有 CI 配置；需要协作时先纳入版本控制，并使用下面的门禁建立 CI，不能把现有命令存在写成“已自动执行”。

## 3. 测试分层与验收

```powershell
npm test
npm run test:ui
npm run build
```

| 验证 | 当前覆盖 | 不能证明什么 |
| --- | --- | --- |
| `tests/english.test.js` / `tests/english.spec.js` | 新增文章、精度截断、旧记录升级、改名、跨日与恢复 | Windows 文件系统故障 |
| `tests/retention.spec.js` | 红黑双色、完整精度输入、跨日刷新、固定列宽、三行/英语兼容、移除三个按钮 | Windows 文件系统故障 |
| `tests/model.test.js` | 表/节点数量、年度分摊、权重、全精度、两科全掌握 150、空白年份 | 原生文件保存 |
| `tests/wrong-index.test.js` / `tests/wrong-index.spec.js` | 492 空记录迁移、稳定 ID、三行地址/公式、文本精度、同行填充及纵向拒绝、清空、自动保存和重启 | 实机文件系统故障 |
| `tests/memory.test.js` | 日期、初学、原始预测历史、五次记录窗口、不规则间隔、跨日和精度边界 | 用户真实历史是否完整 |
| `tests/cumulative.test.js` | 90%/96% 拟合目标、多轮累计、末次条件相同仍区分历史、间隔与掌握度独立作用、v6～v8 保留历史与题号迁移 | 个体真实记忆表现 |
| `tests/migration.test.js` | v2 可还原曲线重算、保留日期/输入、幂等、拒绝不可还原记录 | 任意复杂旧历史的回放 |
| `tests/ui.spec.js` | 表格布局、408 密度、节点展开、编辑栏、精度、所有工作表、损坏记录保护 | Rust IPC 与 Windows 关闭事件 |
| `tests/forgetting.spec.js` | 模拟北京时间午夜、禁止降低、未编辑不复习、离线重开、浏览器自动保存与迁移 | 实机时钟故障、断电写入恢复 |
| `scripts/native-smoke.mjs` | 隔离 WebView、v10 → v11 算法迁移与题号保留、独立备份、横向填充及重启、英语精度与 Rust 保存、关闭提交、重开不重置 | 多进程并发及所有文件系统故障 |

1.8.0 当前有 37 项 Node 测试和 24 项 Playwright 测试；增删用例后更新覆盖说明，不把固定数量当作唯一验收标准。Playwright 会启动/复用 1420 端口服务，运行前确认复用的是本项目。

原生验证必须按顺序执行，并逐步确认退出码成功：

```powershell
npm run tauri -- build --no-bundle --config src-tauri/verification.conf.json
node scripts/native-smoke.mjs
npm run desktop:build
```

隔离标识是 `cn.kaoyan.study-panel.verification`，脚本使用 CDP 端口 9423 和 `test-results/native-webview`，结束后恢复它接触的验证目录记录。脚本会先启动目标 exe 再断言标识，因此不能省略第一步、直接拿正式构建运行脚本。不要并行运行多个原生验证。

**两种构建写到同一个 target exe。** 最后一步重新生成正式标识 `cn.kaoyan.study-panel`，是交付前必做操作，不能把隔离验证版复制给用户。

## 4. 维护源工作簿与内容

只有明确需要更新内置内容时执行：

```powershell
npm run extract
```

该命令只读上一级综合工作簿，覆盖 `src/data.json`，不会自动迁移已有学习记录。操作前后审核：源文件指纹、工作表顺序、科目/板块/小节/节点数量、年度分摊、布局、绑定坐标和 ID 语义。

当前脚本不是通用导入器：数学/408、年度范围和权重区间有固定约定。新大纲或移动节点必须先形成旧 ID 到新 ID 的映射、源指纹备份兼容策略及迁移测试。新增年份要同时更新年度提取、权重、表映射与空白年规则。运行 model 测试后再核对界面，不能仅凭提取脚本退出成功交付。

## 5. 发布步骤

1. 核对最终需求、源码和文档；算法变更同时更新[算法说明](../../遗忘曲线算法说明.md)、[构建说明](../../面板构建doc.md)、状态迁移和测试。数据语义改变时评估学习记录版本；普通显示修改不要求递增 schema。
2. 同步 `package.json`、`package-lock.json` 根包版本、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`；Cargo 构建会更新锁文件中的本项目版本。勿批量修改依赖版本字符串。
3. 完成相关单元、界面与必要的原生验证；失败时先修复，不通过删除断言获得成功。
4. 执行 `npm run desktop:build`。该脚本使用 `tauri build --no-bundle`，只交付 `src-tauri/target/release/kaoyan-panel-desktop.exe`；配置虽保留 NSIS 配置，当前发布命令不生成安装包。
5. 关闭运行中的旧面板，优先正常关闭并等待保存完成。用户已授权更新时直接关闭旧版，无需重复确认；不得按模糊名称关闭其他程序或用户的 Excel。
6. 复制到 `../桌面应用/考研综合面板-<版本>.exe`，核对文件版本及 SHA-256 与正式构建一致。确认新版可用后移除交付目录中的旧版 exe，保留学习记录和备份。每次发布同时在系统实际桌面目录创建/更新“考研综合面板.lnk”，目标指向最新 exe，并回读验证目标和工作目录。
7. 有数据迁移时，先保留旧记录，再验证新记录版本、预测值、原日期和最后输入、再次打开不重复迁移。只做源码/文档更新时不要借机重置用户记录。
8. 更新使用入口、版本说明与验证证据；交付说明写清变更、测试及实际限制。

可在复制后校验以下文件，不需要启动应用或改写数据：

```powershell
Get-FileHash -LiteralPath 'src-tauri/target/release/kaoyan-panel-desktop.exe'
Get-FileHash -LiteralPath '../桌面应用/考研综合面板-1.8.0.exe'
(Get-Item -LiteralPath '../桌面应用/考研综合面板-1.8.0.exe').VersionInfo.ProductVersion
```

不要用单元测试通过替代 exe 启动/存盘验证，也不要把生成 exe 等同于安装包、代码签名、自动更新或跨系统兼容性已完成。

## 6. 故障定位

| 表现 | 检查顺序 |
| --- | --- |
| 1420 端口冲突 | 确认占用进程所属项目；关闭自己的旧预览服务后重试 |
| Edge / WebView 启动失败 | 分别检查测试用 Edge 与原生 WebView2；它们不是同一个依赖 |
| Rust 编译或链接失败 | 核对 MSVC 工具链、C++ Build Tools、SDK 及完整构建日志 |
| 重开后看似空白 | 核对正式/验证应用标识及 browser origin，勿先清空数据 |
| 读取失败、编辑停用 | 保留文件；按[数据文档](data-and-persistence.md)核验版本、日期、字段、迁移条件和恢复方式 |
| 保存失败 | 检查数据目录权限/占用/空间；保留实例，检查原因后再提交编辑重试，勿直接杀掉尚未保存的实例 |
| 旧备份文件恢复 | 当前无导入界面，按数据文档核对 source/state 后在关闭程序时恢复文件 |
| 更新算法后不能迁移 | 检查是否缺少完整旧历史；不要篡改版本号或猜测日期 |
| 全科分数高于一个小节分数 | 全科还包含其他节点；对照各节点当天的未舍入预测值 |

## 7. 文档维护门禁

- 文档命令必须能在标明的目录找到对应脚本；相对文件链接必须存在。
- 算法变更核对定义、示例、补零、时间口径、持久字段、迁移及边界，不能只替换变量名。
- Excel 的数学逐级舍入与桌面全精度计算必须分别标注；原工作簿未接入遗忘，不能混称。
- 原生截图及测试临时目录是验证现场，不是业务资料。仅文档任务不执行缓存清理或删除用户文件。
- 没有自动化覆盖的限制如多实例、断电、任意复杂旧历史应如实记录，不写成保证。

1.6.1 的 wrong-index 界面用例另验证选中长题号完整展开、点击覆盖处选中相邻格、Esc 收起、固定尺寸与展开状态下的填充。原生脚本核验所用 WebView 的文本尺寸与填充。


历史1.7.0算法（已由1.8.0修正）：按复习前预测r的平方根将有效强度向初学回拉，C=28.711284228111044、B=20.164273571058075。长期未复习后新p接近0.5，仍保留90%/96%校准目标。旧r、日期、输入和文本不改，只按原reviewOrigin修正最近一次p并立即刷新预测。记录v10，升级备份progress-before-recall-v<旧版本>.json，重开不重复迁移。公式及边界以[算法说明](../../遗忘曲线算法说明.md)为准。


1.8.0：在G的额外增益中乘d(τ)=0.2+0.8×exp(−max(0,τ−5)²)，保留90%/96%目标；初学100%、每天检查且低于50%复习至100%的前六次间隔为2、3、8、14、32、100天。记录v11，独立备份progress-before-spacing-v<旧版本>.json，仅从原reviewOrigin重算最新p，历史不改。详细公式、例子和远期局限以算法说明为准。


### 发布后固定到“开始”（2026-10-20用户要求）

以后每次生成正式exe并交付，更新桌面快捷方式后，将最新版固定到Windows“开始”。通过Shell.Application读取新exe的Verbs：存在“从开始菜单取消固定”等取消固定项即已固定；否则执行对应“固定到开始”项，再重新读取菜单确认。不要误执行取消固定项。删除旧exe前取消旧版本的固定，防止残留失效入口。若系统未提供可执行的固定操作，则报告实际状态，不以创建普通开始菜单快捷方式冒充固定成功。当前1.8.0已通过取消固定菜单项确认处于固定状态。
