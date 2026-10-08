# v12.45 术语库迭代流程（自动搜集 → 待审核池 → 审核入库 → 后台重新生成 → 发版）

## 核心原则

**术语库是「公司级钦定资产」，不是「用户级散落积累」**——所有「自动搜集」的术语（v11.2 新产品名规则检测 / v11.3 LLM 兜底）**不再静默入库**，而是自动收录进「待审核池」（clientStorage），设计经理固定时间审核后，有价值的才更新到 `术语素材/Lexar术语库_专属.csv`，后台重新生成默认库后发版。

**根治事故**（2026-09-29 PLAY X 实机）：v11.2 代码生成的 es 译名 `Unidad de estado sólido (SSD) Lexar PLAY X PCIe 4.0 M.2 NVMe` ≠ 人工钦定 `SSD NVMe M.2 PCIe 4.0 Lexar PLAY X`，静默入库后 S1 短路锁死，人工钦定永远没有出场机会。

## 完整链路

```
插件自动搜集（v11.2 规则检测 / v11.3 LLM 兜底）
        ↓ 自动收录（不静默入库）
待审核池（clientStorage，跨会话保留）
        ↓ 设计经理固定时间审核（插件内「术语审核」面板）
  ├─ 「入库」→ 直接加入专属术语库（glossaryExclusive，立即生效）
  ├─ 「导出」→ 复制 CSV 行到剪贴板 → 粘贴到 术语素材/Lexar术语库_专属.csv
  └─ 「删除」→ 无价值条目从池删除
        ↓ 审核后更新 CSV
双击 update-glossary.ps1（半自动脚本）
  ├─ 1. merge_glossary.py → 重新生成 lib/default-glossary.ts
  ├─ 2. gen-corpus-inline.ts → 重新生成 lib/human-corpus-data.ts
  └─ 3. npm run typecheck + npm run build → 新 dist
        ↓
发版（MasterGo 插件市场 / 内部渠道）
        ↓
全公司同事升级 → 获得最新钦定术语库+语料库
```

## 审核节奏建议

- **每周五下午**固定审核一次（或每两周一次，按积累量定）
- 审核入口：插件 → 高级 → 术语库 → 「待审核（自动搜集）」面板

## 三个按钮的区别

| 按钮 | 作用 | 适用场景 |
|---|---|---|
| **入库** | 直接加入专属术语库（`glossaryExclusive`，当前插件立即生效，**但不进后台默认库**——同事升级插件后拿不到） | 当前项目急需这条术语，且确认代码生成值 OK |
| **导出** | 复制 CSV 行到剪贴板 → 你粘贴到 `术语素材/Lexar术语库_专属.csv` → 后台重新生成默认库 → 发版 | 这条术语应该成为**公司级钦定**（推荐主路径） |
| **删除** | 从待审核池删除（无价值/误判条目） | 代码生成值明显不对/不是产品名 |

## 注意事项

1. **「入库」vs「导出」的区别**：
   - 「入库」= 只进你本机的专属库（`glossaryExclusive`，clientStorage），**同事升级插件拿不到**
   - 「导出」= 进后台 CSV → 重新生成默认库 → 发版 → **全公司同事升级后都能拿到**
   - **推荐主路径是「导出」**（公司级钦定）；「入库」只用于当前项目急需但还没审核完的临时场景

2. **待审核池与翻译管道隔离**：
   - 待审核池条目**不进 S1 短路/遮蔽/合规锁**（与 `glossaryExclusive` 严格隔离）
   - 但**本批次翻译照常用代码生成值**（`App.vue:1708-1711` 并入 `glossaryMap` 的逻辑保留）——用户工作流不打断

3. **待审核池跨会话保留**（clientStorage）——关闭插件/重启 MasterGo 后仍在，审核权在你，不急

## 后台重新生成脚本（update-glossary.ps1）

**前提**：你已完成「导出」→ 粘贴到 `术语素材/Lexar术语库_专属.csv`

**操作**：双击项目根目录的 `update-glossary.ps1`，自动执行：
1. `python scripts/merge-glossary.py` → 重新生成 `lib/default-glossary.ts`（术语库）
2. `npx tsx claude-tmp/gen-corpus-inline.ts` → 重新生成 `lib/human-corpus-data.ts`（语料库）
3. `npm run typecheck` + `npm run build` → 新 dist

**完成后**：你确认 `dist/` 更新，然后发版（MasterGo 插件市场 / 内部渠道）。

## 历史遗留清理

**已污染的 `glossaryExclusive` 条目**（2026-09-29 之前 v11.2 静默入库的代码生成值）：
- 比如 `Lexar PLAY X PCIe 4.0 M.2 NVMe SSD`（es 值 `Unidad de estado sólido (SSD) Lexar PLAY X PCIe 4.0 M.2 NVMe` ≠ 人工钦定）
- **需要你手动删除**：插件 → 高级 → 术语库 → 专属术语 → 下载 CSV → 删除错误行 → 替换上传
- 或者告诉我具体条目，我帮你写清理逻辑（但删用户数据需要你确认）
