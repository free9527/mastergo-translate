import { TextItem } from '@messages/types'

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

  const availableMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(container))
    .filter(function (k) { return typeof (container as Record<string, unknown>)[k] === 'function' && k.includes('find') })
  console.log('[translate] available find methods:', availableMethods)

  // 策略1: findAllWithCriteria
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

  // 策略2: findAll 回调
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

  // 策略3: 手动递归遍历
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
  console.log('[translate] manual walk found', results.length, 'TEXT nodes')
  return results
}

// 合并重复文本
export function mergeDuplicates(nodes: TextNode[]): TextItem[] {
  const map = new Map<string, TextNode[]>()
  for (const node of nodes) {
    const normalized = node.characters.replace(/\n/g, ' ').trim()
    if (!normalized) continue
    const key = normalized
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
      sourceText: text,
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
