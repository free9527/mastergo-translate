# Lexar 翻译插件 · 项目级规则

全局 CLAUDE.md 已加载，本文件只声明本项目覆盖项与指针（全局「项目覆盖全局」原则的落地）。

## 覆盖全局规则的项

1. **Tool Preference 覆盖**：本项目用 **npm/yarn**（package.json scripts + lock 文件为准；typecheck/build/test 全套铁律命令都是 npm 生态），不切换 bun/pnpm。
2. **File Rules 3 豁免**（新建文件先确认）：
   - `tests/` 下新建测试文件（test-v*.ts）与临时输出（tmp-*.txt）直建不确认——测试驱动开发的日常节奏
   - `术语素材/`、`测试文本素材/` 下中文文件名合法（业务数据惯例，不受 kebab-case 约束）
   - `dist/` 构建产物不受文件规则约束
3. **新建 lib/ 模块仍需先确认**（全局 File Rules 3 保持生效——新承重墙要先对齐架构）。

## 项目指针（单一事实源）

- **HANDOFF.md**（项目根）：版本史/架构/踩坑清单/后续建议/去机翻感长期方向（八点五节）——项目知识主文档
- **项目记忆**：`~/.claude/projects/C--Users-Administrator-Desktop-materGO-translate/memory/MEMORY.md`（索引 + 每事件一文件）
- **铁律**：每次改代码后 `npm run typecheck` + `npm run build`（build 过 ≠ tsc 过）；措辞一律称 MasterGo 插件（非 Figma）
