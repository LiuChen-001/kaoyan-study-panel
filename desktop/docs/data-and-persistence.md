# 数据结构、持久化与迁移

适用应用 1.8.0 / 学习记录 version 11。算法数学定义见[遗忘曲线算法说明](../../遗忘曲线算法说明.md)，应用计算链见[构建说明](../../面板构建doc.md)第 13 节。

## 1. 三种不同的数据版本

| 标识 | 当前值 | 用途 |
| --- | --- | --- |
| exe / 包版本 | `1.8.0` | 发布标识；package、Cargo、Tauri 配置一致 |
| `data.json.schemaVersion` | `1` | 内置工作簿内容结构 |
| `progress.json.version` | `11` | v2 最小值；v3 平均值；v4 英语；v5 未发布的同日覆盖；v6 前后平均r及日期窗口；v7纯预测r、均值排除零；v8节点错题文本；v9累积复习；v10按复习前掌握度回拉；v11折减长间隔增益 |

`data.json.sha256` 是源工作簿二进制的 SHA-256，供导入导出校验，非个人学习记录摘要。仅改 Excel 格式也可能改变该指纹。

## 2. 内置源数据

顶层字段为 `schemaVersion`、`source`、`sha256`、`sheetNames`、`subjects`、`styles`、`sheets`。科目下有 `blocks → sections → nodes`、`weights`、`exams`。小节包含年度输入、原公式和缓存值；`sheets` 按原表名保存单元格值/公式/样式索引、合并、列宽、行高、冻结信息。

| ID 示例 | 含义 |
| --- | --- |
| `math` / `cs` | 科目 |
| `math:block:2` | 数学第 2 行的板块标题 |
| `math:4` | 数学第 4 行开始的小节 |
| `math:F5` | 数学 F5 掌握度对应的节点 |

这些是当前坐标编码，不是跨布局稳定的 UUID。提取产生的 `initial`、`cachedScore`、`cachedUnit` 不作为新版曲线初始化和得分计算的依据。

## 3. 学习记录字典

以下是类型描述，不是可直接导入的 JSON 文件；实际记录必须覆盖全部节点、年度项与科目权重，且包含英语列表（可以为空）。英语列表的 ID 与显示行号解耦，详见 [英语工作表](english.md)。

```ts
type MemoryState = {
  initialLearnedDate: string; // YYYY-MM-DD，初学日期，后续不重置
  lastInterventionDate: string; // 当前曲线起始日期
  baseMastery: number; // R，0 < R <= 1
  retentionPerDay: number; // p，0 < p < 1
  recentPreInterventionMasteries: [number, number, number, number, number];
  // 0～1 的 r，旧数值不改，新值为复习前预测，本次预测r还参与强度回拉，旧数组不改；不足 5 次补零，初学不入队
  recentReviewDates: string[]; // 最近至多 5 个有效复习日，倒序且不同日
  reviewOrigin: Omit<MemoryState, "reviewOrigin"> | null; // 当天首次复习前快照，不嵌套
};
type ProgressV11 = {
  version: 11;
  english: { articles: Array<{ id: string; title: string; memory: MemoryState | null }> };
  memory: Record<string, MemoryState | null>;
  wrongQuestions: Record<string, string>; // 492 个原节点 ID，初始空文本，保留资料名/页码/前导零
  annual: Record<string, Record<string, number | null>>;
  weights: Record<string, Record<string, number>>;
};
```

未初学保存 `null`，预测为 0；首次输入大于 0 才创建曲线。没有单独存“今日掌握度”。`annual` 为按小节 ID、年份索引的非负有限分数；仅未参与权重的预留年份允许 `null`。`weights` 为按科目 ID、年份索引的非负有限相对权重，每科合计必须大于 0。

日期必须是真实公历日期，初学日期不晚于最后学习日期。内部 0～1 与输入 0～100 转换后仍须满足严格提升；数据校验在前端完成。Rust 只校验 JSON 语法，不是独立的业务校验器。

## 4. 存储位置与 IPC

| 运行方式 | 正式状态与备份 |
| --- | --- |
| Windows 正式应用 | `%APPDATA%\cn.kaoyan.study-panel\progress.json` |
| 原生隔离验证 | `%APPDATA%\cn.kaoyan.study-panel.verification\progress.json` |
| 浏览器预览 | 当前 origin 的 localStorage，键 `kaoyan-panel-v1`；键名不随 schema 变化 |

正式程序基于应用标识寻址，移动 exe 不移动个人记录。普通 `npm run desktop:dev` 使用正式标识，可能读写真实记录；验证优先使用浏览器或隔离配置。

| Tauri 命令 | 请求 | 返回与错误 |
| --- | --- | --- |
| `load_state` | 无业务参数 | `string` 或文件不存在时 `null`；其他 I/O 错误拒绝调用 |
| `load_migration_history` | 无业务参数 | 同目录 progress.bak 和 progress-before-*.json 可读内容的数组，前端再逐节点核验 |
| `save_state` | `{ content: JSON字符串 }` | 成功无业务返回值；JSON/I/O 错误拒绝调用 |

原生保存顺序：获取进程内 Mutex → 校验 JSON → 必要时建立独立迁移备份 → 写 `progress.tmp` 并 `sync_all` → 将现有正式文件复制为 `progress.bak` → 重命名临时文件替换正式文件。Windows 错误 17（重定向目录无法同设备重命名）时改为复制、刷新文件、删除临时文件。

复制回退不是原子替换；`progress.bak` 是替换前的原文件，并未在 Rust 中做业务校验，不能保证它一定有效。出现故障应保留现场并验证候选记录，不自动取默认状态覆盖。

迁移备份仅首次创建，存在则保留：

| 旧状态 | 原生备份 | 浏览器键 |
| --- | --- | --- |
| v1～v10 升级到 v11 | `progress-before-spacing-v<旧版本>.json` | `kaoyan-panel-before-spacing-v<旧版本>` |

历史升级留下的 progress-before-forgetting-v1.json、progress-before-mean-v2.json、progress-before-english-v3.json 继续保留，可用作还原参数的候选来源。

历史 1.4.0 的 v7→v8 新增备份 progress-before-wrong-index-v7.json（浏览器键 kaoyan-panel-before-wrong-index-v7）。错题按稳定节点 ID 寻址；三行显示不会移动已保存节点 ID。编辑题号不改变日期、曲线或分数。

这些文件不是逐次归档：已有同名迁移备份不会因为再次导入旧数据而更新。迁移备份保护被替换的本地原文件；应用导入的备份文件应由用户继续保留。

## 5. 迁移合同

入口是 `model.js:migrateState(data, state, backups)` 和 `memory-migration.js`。先整体校验，成功后写 version 11。任何节点无法准确重算则整体失败，不部分覆盖正式文件。

| 来源 | 行为 |
| --- | --- |
| 无记录 | 全节点 null，内置年度输入和权重，空英语列表，保存 v11 |
| v1 无日期 | 按用户此前决定节点未初学，保留年度输入与权重 |
| v2 最小值 | 先由 migrateMinimumMemory 验证可恢复的单次复习并转换旧平均值口径，再执行累积算法迁移；复杂缺历史则报错 |
| v3/v4/v5 平均值 | 保留旧 r、输入、日期，补齐可验证的日期窗口和起点，仅重算最近一次 p；v3 增加空英语列表 |
| v6/v7 | 使用原 reviewOrigin 的 p、相邻间隔和最后输入重算最近一次 p，保留旧 r，增加空题号 |
| v8 | 同样重算最近一次 p，并保留全部已有错题题号 |
| v9 | 用原reviewOrigin预测r，保留全部旧历史，仅重算最近一次p |
| v10 | 按原reviewOrigin重算最近一次p，保留全部历史 |
| v11 | 原样读取，只按今天预测，不重复迁移 |
| 不支持版本或非法数据 | 报错停用编辑，原文件不覆盖 |

还原最近一次复习前状态时，候选必须同初学日且日期更早，满足旧预测值、r 窗口移位、旧 0.2 公式计算的 p，数值校验容差为 1e-14。单次复习可由 pre/0.5^日期差逆推初学掌握度并校验；多次复习需要已保存的前一份快照，逐层验证日期。不会从当前 p 猜测任意复习日期。程序读取本机旧备份作为候选，导入旧备份也执行同样的验证。

即时修正沿用已确认口径：保持旧 r、输入、日期和 reviewOrigin；用旧起点 p、相邻间隔 tau、最后输入 u 计算 `S旧=ln(0.5)/ln(p旧)、G=1+C×tau/(tau+B)×u×d(tau)、S新=1+sqrt(r)×(S旧×G-1)、p新=0.5^(1/S新)`，其中r由旧快照预测。只更新最近一次 p，不回放全部历史、不新增今天复习；较早效果通过原 p旧承接。掌握度从原最近复习日用新 p 预测，面板立即变化。常量和推导以算法说明为准。

初学当天重复旧修改按同日合并规则令 p=0.5、日期列表为空，旧 r 数值仍保留。以后真实的新复习才将纯预测 r 推入数组。同日重改使用持久化 reviewOrigin，从当天修改前曲线重算，r 和日期窗口只保留当天一次。快照不含 reviewOrigin 字段；相邻有效复习日必须至少相隔 1 天。

v6 数组首项可能是旧平均样本，不能当作复习前预测。新记忆率更新不使用历史数组，原样保留即可；未初学继续 null，初学曲线继续 p=0.5。

原生升级先建立独立旧版本备份。恢复和重开不重置初学日；年度数据、权重和文章名称不会随算法迁移改变。v6～v9 备份包含继续精确计算所需的日期窗口与起点，当前有限窗口不能重建任意久远的完整学习流水。

## 6. 文件备份和故障恢复

1.6.0 已按用户要求删除导出备份、恢复备份、重新保存三个按钮及对应界面事件。自动保存、progress.bak 与独立算法迁移备份仍保留。显示记忆率只控制当前运行中的视图开关，模型和学习记录 version 9 不变，升级不重算已有曲线。

需要恢复文件时：

1. 关闭面板所有实例，保留当前 progress.json 与候选文件的额外副本。
2. 校验候选裸状态的节点标识、来源和 validateState/migrateState 结果，优先使用隔离验证目录，不在正式记录上试错。
3. 将有效裸状态复制到正式 progress.json，再打开程序核对节点、日期、题号和保存状态。progress.bak 是上次保存，不保证一定有效。
4. 历史导出格式为 {app, source, savedAt, state}；必须核对 app/source，并提取 state 才能作为裸状态文件恢复。更早且缺历史的记录仍可能无法准确迁移，不能猜测日期或清空节点绕过。

保存失败会显示原因并阻止正常关闭。检查目录权限、占用和空间后再次提交编辑会重新尝试保存；切勿用默认空记录覆盖原文件。

不得把新版记录直接交给旧 exe 使用，或把新文件的 `version` 手工降级。若确需回退，保留新版完整副本，使用匹配旧程序的旧版备份；升级后新增的学习记录不能靠回退自动合并。


历史1.7.0算法（已由1.8.0修正）：按复习前预测r的平方根将有效强度向初学回拉，C=28.711284228111044、B=20.164273571058075。长期未复习后新p接近0.5，仍保留90%/96%校准目标。旧r、日期、输入和文本不改，只按原reviewOrigin修正最近一次p并立即刷新预测。记录v10，升级备份progress-before-spacing-v<旧版本>.json，重开不重复迁移。公式及边界以[算法说明](../../遗忘曲线算法说明.md)为准。


1.8.0：在G的额外增益中乘d(τ)=0.2+0.8×exp(−max(0,τ−5)²)，保留90%/96%目标；初学100%、每天检查且低于50%复习至100%的前六次间隔为2、3、8、14、32、100天。记录v11，独立备份progress-before-spacing-v<旧版本>.json，仅从原reviewOrigin重算最新p，历史不改。详细公式、例子和远期局限以算法说明为准。
