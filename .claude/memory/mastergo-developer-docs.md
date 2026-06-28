---
name: mastergo-developer-docs
description: MasterGo 开发者文档地址和关键 API 发现，所有功能修改必须基于此文档
metadata:
  type: reference
---

# MasterGo 开发者文档

## 文档地址
- 主站: https://developers.mastergo.com/
- API Reference: https://developers.mastergo.com/apis/
- TypeScript 类型: https://developers.mastergo.com/types/index
- Plugin Typings: https://developers.mastergo.com/plugin-typings/

## NPM 包
- `@mastergo/plugin-typings` (当前版本 2.18.4)
- 仓库: https://github.com/mastergo-design/plugin-typings

## 关键 API 发现

### ChildrenMixin 接口
```ts
interface ChildrenMixin<ChildrenNode = SceneNode> {
    readonly children: ReadonlyArray<ChildrenNode>  // 图层面板顺序
    appendChild(child: SceneNode): void
    insertChild(index: number, child: SceneNode): void
    findChildren(callback?: ...): ReadonlyArray<SceneNode>
    findChild(callback: ...): SceneNode | null
    findAll(callback?: ...): ReadonlyArray<SceneNode>
    findOne(callback: ...): SceneNode | null
    findAllWithCriteria<T extends NodeType[]>(criteria: { types: T }): Array<{ type: T[number] } & SceneNode>
}
```

### 节点遍历顺序
- `children` 明确按图层面板顺序排列
- `findAllWithCriteria` 是 MasterGo 特有的 API，返回顺序文档未明确说明
- 当前采用三层策略: findAllWithCriteria → findAll → 手动递归 children

## 规则
**所有功能修改和接口调用必须在 https://developers.mastergo.com/ 开发者文档中找到依据后才能执行。**

## 存储 API 与跨客户端同步

### 三种存储机制对比

| API | 绑定对象 | 跨客户端同步 | 跨文档 | 数据可见性 |
|-----|---------|:-----------:|:-----:|-----------|
| `clientStorage` | 插件+用户 | ❌ 实测不支持 | ✅ | 仅自己 |
| `PluginData` | 节点 | ❌ 本地 | ✅ | 仅自己 |
| `SharedPluginData` | 文档 | ✅ 文档存云端 | ❌ | 有文件权限的所有人 |

### 当前实现
- `clientStorage` 为主存储（读写快，同客户端同文档可用）
- `SharedPluginData('translate', key, value)` 为跨客户端恢复兜底
- 换设计文件仍需重新配置（SharedPluginData 跟文档不跟账户）
- Figma 的 `clientStorage` 跨客户端自动同步，MasterGo 尚未支持，这是平台差异

### 影响
- 设置和术语库在同一文档内换客户端可恢复
- 换文档需重新配置
- API Key 对文档协作者可见（SharedPluginData 特性）