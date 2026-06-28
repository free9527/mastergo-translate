import { TextItem } from '@messages/types'
import { normalizeText } from '@lib/constants'

export interface TraversableNode {
  type?: string
  isVisible?: boolean
  parent?: TraversableNode | null
  children?: ReadonlyArray<TraversableNode>
  findAllWithCriteria?(criteria: { types: string[] }): TraversableNode[]
  findAll?(callback?: (node: TraversableNode) => boolean): ReadonlyArray<TraversableNode>
}

function isEffectivelyVisible(node: TraversableNode): boolean {
  let current: TraversableNode | undefined | null = node
  while (current) {
    if (current.isVisible === false) return false
    current = current.parent
  }
  return true
}

function filterVisible(nodes: TextNode[]): TextNode[] {
  return nodes.filter(function (n) { return isEffectivelyVisible(n) })
}

export function collectTextNodes(container: TraversableNode): TextNode[] {
  if (!container) {
    console.error('[translate] container is null/undefined')
    return []
  }

  const containerType = container.type || 'unknown'
  console.log('[translate] collectTextNodes called, container.type =', containerType)

  // 策略1: 手动递归遍历（children 数组顺序 = 图层面板顺序，文档明确保证）
  const results: TextNode[] = []
  function walk(node: TraversableNode) {
    if (!node) return
    if (node.isVisible === false) return
    if (node.type === 'TEXT' && isEffectivelyVisible(node)) {
      results.push(node as unknown as TextNode)
    }
    const children = node.children
    if (children && typeof children.length === 'number') {
      for (let i = 0; i < children.length; i++) {
        walk(children[i])
      }
    }
  }
  walk(container)
  if (results.length > 0) {
    console.log('[translate] manual walk found', results.length, 'TEXT nodes (layer order)')
    return results
  }

  // 策略2: findAllWithCriteria（MasterGo API，返回顺序文档未明确说明，仅作兜底）
  if (typeof container.findAllWithCriteria === 'function') {
    try {
      const result = container.findAllWithCriteria({ types: ['TEXT'] })
      console.log('[translate] findAllWithCriteria returned', result ? result.length : 0, 'nodes')
      const visible = filterVisible(result as TextNode[])
      if (visible.length > 0) return visible
    } catch (e) {
      console.error('[translate] findAllWithCriteria failed:', e)
    }
  } else {
    console.log('[translate] findAllWithCriteria is not a function')
  }

  // 策略3: findAll 回调（兜底）
  if (typeof container.findAll === 'function') {
    try {
      const result = container.findAll(function (node: TraversableNode) {
        return node.type === 'TEXT' && isEffectivelyVisible(node)
      })
      console.log('[translate] findAll returned', result ? result.length : 0, 'nodes')
      if (result && result.length > 0) return result as TextNode[]
    } catch (e) {
      console.error('[translate] findAll failed:', e)
    }
  } else {
    console.log('[translate] findAll is not a function')
  }

  console.log('[translate] all strategies returned 0 TEXT nodes')
  return results
}

// 合并重复文本
export function mergeDuplicates(nodes: TextNode[]): TextItem[] {
  // 规范化键：保留 ®™© 符号（避免 "Lexar®" 和 "Lexar" 被错误合并丢失商标）
  function mergeKey(text: string): string {
    return text
      .replace(/[\n\r]+/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim()
  }

  const map = new Map<string, TextNode[]>()
  for (const node of nodes) {
    const key = mergeKey(node.characters)
    if (!key) continue
    const group = map.get(key)
    if (group) {
      group.push(node)
    } else {
      map.set(key, [node])
    }
  }

  const items: TextItem[] = []
  for (const [text, group] of map) {
    const first = group[0]
    const firstStyle = first.textStyles?.[0]
    const lineHeight = firstStyle?.textStyle?.lineHeight
    const letterSpacing = firstStyle?.textStyle?.letterSpacing
    items.push({
      nodeIds: group.map(function (n) { return n.id }),
      nodeNames: group.map(function (n) { return n.name }),
      pageName: mg.document.currentPage.name,
      sourceText: first.characters,
      translatedText: '',
      proofreadText: '',
      proofreadReason: '',
      corrected: false,
      fontSize: firstStyle?.textStyle?.fontSize ?? 12,
      fontFamily: firstStyle?.textStyle?.fontName?.family ?? 'Inter',
      fontStyle: firstStyle?.textStyle?.fontName?.style ?? 'Regular',
      lineHeight: lineHeight && typeof lineHeight === 'object' && 'value' in lineHeight ? (lineHeight as LineHeight).value : null,
      letterSpacing: letterSpacing && typeof letterSpacing === 'object' && 'value' in letterSpacing ? (letterSpacing as LetterSpacing).value : null,
      textAlignHorizontal: first.textAlignHorizontal ?? 'LEFT',
      targetFontFamily: '',
      targetFontStyle: '',
      targetFontSize: 0,
      targetLineHeight: null,
      targetLetterSpacing: null,
      targetTextAlign: '',
    })
  }
  return items
}
