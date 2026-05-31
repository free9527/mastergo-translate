<template>
  <div class="app" :class="{ dark: isDark }">
    <!-- 状态栏 -->
    <div class="statusbar">
      <div class="sb-left">
        <span class="sb-dot" :class="statusClass"></span>
        <span class="sb-title">翻译</span>
      </div>
      <div class="sb-right">
        <span class="sb-badge" v-if="items.length" :class="{ active: hasTranslation }">
          {{ items.length }} 条{{ hasTranslation ? ' · 已翻译' : '' }}
        </span>
      </div>
    </div>

    <!-- 主操作区 -->
    <div class="toolbar">
      <div class="toolbar-row">
        <button class="btn btn-primary" @click="scanAll" :disabled="scanning">
          <span class="btn-icon">⌘</span>{{ scanning ? '扫描中...' : '全页扫描' }}
        </button>
        <button class="btn btn-secondary" @click="scanSelection" :disabled="scanning">
          选中扫描
        </button>
        <select v-model="targetLang" class="lang-select">
          <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.name }}</option>
        </select>
      </div>
      <div class="toolbar-row">
        <button class="btn btn-accent flex-1" @click="startTranslate" :disabled="translating || proofreading || items.length === 0">
          {{ translating ? `翻译中 ${Math.floor(translateProgressPercent)}%...` : '翻译' }}
        </button>
        <button class="btn btn-primary flex-1" @click="applyTranslations" :disabled="applying || translating || proofreading || !hasTranslation">
          {{ applying ? `应用 ${Math.floor(applyingProgressPercent)}%...` : '应用' }}
        </button>
        <button class="btn btn-ghost flex-1" @click="undoAll" :disabled="undoing || translating || proofreading || applying">
          撤销
        </button>
      </div>
      <div class="toolbar-row" v-if="translating || proofreading">
        <button class="btn btn-warning flex-1" @click="cancelOperation">
          取消{{ translating ? '翻译' : '校对' }}
        </button>
      </div>
      <div class="toolbar-row" v-if="failedNodeIds.length > 0">
        <button class="btn btn-warning flex-1" @click="retryFailed" :disabled="applying || translating || proofreading">
          重试失败 ({{ failedNodeIds.length }})
        </button>
      </div>
    </div>

    <!-- 翻译进度条 -->
    <div class="progress-wrap" v-if="translating">
      <div class="progress-track">
        <div class="progress-fill" :style="{ width: translateProgressPercent + '%' }"></div>
      </div>
      <span class="progress-label">{{ Math.floor(translateProgressPercent) }}%</span>
    </div>
    <!-- 校对进度条 -->
    <div class="progress-wrap" v-if="proofreading">
      <div class="progress-track">
        <div class="progress-fill proofread-fill" :style="{ width: proofreadProgressPercent + '%' }"></div>
      </div>
      <span class="progress-label">{{ Math.floor(proofreadProgressPercent) }}% - 校对中</span>
    </div>

    <!-- 应用进度条 -->
    <div class="progress-wrap" v-if="applying">
      <div class="progress-track">
        <div class="progress-fill apply-fill" :style="{ width: applyingProgressPercent + '%' }"></div>
      </div>
      <span class="progress-label">{{ Math.floor(applyingProgressPercent) }}% - 应用译文到画布</span>
    </div>

    <!-- 翻译结果 -->
    <div class="section">
      <div class="section-header" @click="showTexts = !showTexts">
        <svg class="chevron" :class="{ open: showTexts }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span>翻译结果</span>
        <span class="section-count">{{ items.length }}</span>
      </div>
      <div class="section-body" v-if="showTexts">
        <div class="empty-state" v-if="items.length === 0">
          <div class="empty-icon">⇧</div>
          <p>点击"全页扫描"采集文本</p>
          <p class="empty-sub">或先选中图层后点击"选中扫描"</p>
        </div>
        <div class="text-item" :class="{ corrected: item.corrected, 'csv-changed': csvChangedIds.has(item.nodeIds[0]), 'trans-error': translateErrors.has(item.nodeIds[0]) }" v-for="(item, idx) in items" :key="item.nodeIds[0] || idx">
          <div class="item-row">
            <div class="item-source">
              <div class="item-label">
                原文
                <span class="merge-badge" v-if="item.nodeIds.length > 1">×{{ item.nodeIds.length }}</span>
              </div>
              <div class="source-box">{{ item.sourceText }}</div>
            </div>
            <div class="item-target">
              <div class="item-label">
                译文
                <span class="error-badge" v-if="translateErrors.has(item.nodeIds[0])">翻译失败</span>
                <span class="proof-badge" v-if="item.corrected">校正</span>
                <span class="csv-badge" v-if="csvChangedIds.has(item.nodeIds[0])">导入变更</span>
              </div>
              <textarea
                class="trans-input"
                :class="{ proofread: item.corrected }"
                v-model="item.translatedText"
                rows="1"
                :placeholder="translating ? '翻译中...' : '待翻译'"
                @input="autoResize($event)"
                @focus="autoResize($event); onTransInputFocus(item)"
                @blur="onTransInputBlur(item)"
              ></textarea>
              <div class="proof-hint" v-if="item.corrected">
                <div class="proof-hint-body">
                  <span class="proof-reason" v-if="item.proofreadReason">{{ item.proofreadReason }}</span>
                  <span class="proof-original">原译文：{{ item.proofreadText }}</span>
                </div>
                <button class="btn-revert-proof" @click="item.translatedText = item.proofreadText; item.proofreadText = ''; item.proofreadReason = ''; item.corrected = false">恢复</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- CSV -->
    <div class="inline-actions">
      <button class="btn btn-sm btn-secondary" @click="exportCSV" :disabled="items.length === 0">导出 CSV</button>
      <button class="btn btn-sm btn-secondary" @click="triggerImport">导入 CSV</button>
      <input ref="csvInput" type="file" accept=".csv" style="display:none" @change="handleCSVImport" />
    </div>

    <!-- 字体替换 -->
    <div class="section" v-if="fontMappings.length > 0">
      <div class="section-header" @click="showFontMap = !showFontMap">
        <svg class="chevron" :class="{ open: showFontMap }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span>字体替换</span>
        <span class="section-count">{{ fontMappings.length }}</span>
      </div>
      <div class="section-body" v-if="showFontMap">
        <p class="field-hint">左侧为原文使用的字体属性，右侧选择替换后的目标字体</p>
        <div class="font-card" v-for="f in fontMappings" :key="f.key">
          <!-- 左栏：源字体 -->
          <div class="font-col font-col-source">
            <div class="font-col-label">原文</div>
            <div class="font-preview" :style="{ fontFamily: f.sourceFamily }">
              <span class="font-preview-name">{{ f.sourceFamily }}</span>
              <span class="font-preview-style">{{ f.sourceStyle }}</span>
            </div>
            <div class="font-attrs">
              <div class="font-attr">
                <span class="font-attr-val">{{ fmtNum(f.sourceFontSize) }}</span>
                <span class="font-attr-unit">px</span>
                <span class="font-attr-label">字号</span>
              </div>
              <div class="font-attr">
                <span class="font-attr-val">{{ f.sourceLineHeight !== null ? fmtNum(f.sourceLineHeight) : 'AUTO' }}</span>
                <span class="font-attr-unit" v-if="f.sourceLineHeight !== null">px</span>
                <span class="font-attr-label">行距</span>
              </div>
              <div class="font-attr">
                <span class="font-attr-val">{{ f.sourceLetterSpacing !== null ? fmtNum(f.sourceLetterSpacing) : '—' }}</span>
                <span class="font-attr-unit" v-if="f.sourceLetterSpacing !== null">px</span>
                <span class="font-attr-label">字距</span>
              </div>
              <div class="font-attr">
                <span class="font-attr-val">{{ ALIGN_LABELS[f.sourceTextAlign] || f.sourceTextAlign }}</span>
                <span class="font-attr-label">对齐</span>
              </div>
            </div>
          </div>

          <!-- 中间箭头 -->
          <div class="font-arrow-col">
            <svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 10h14M13 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>

          <!-- 右栏：目标字体 -->
          <div class="font-col font-col-target">
            <div class="font-col-label">替换为</div>
            <input
              class="font-search-input"
              type="text"
              placeholder="搜索字体..."
              :value="fontSearchMap[f.key] || ''"
              @input="fontSearchMap = { ...fontSearchMap, [f.key]: ($event.target as HTMLInputElement).value }"
            />
            <select class="font-family-select" v-model="f.selectedFont" @change="onFontSelected(f)">
              <option value="">继承原字体</option>
              <optgroup v-for="group in groupedFontOptions(filteredFontOptions(f))" :key="group[0]" :label="group[0]">
                <option v-for="fs in group[1]" :key="fs.key" :value="fs.key">{{ fs.style }}</option>
              </optgroup>
            </select>
            <div class="font-preview" v-if="f.selectedFont" :style="{ fontFamily: f.targetFamily || f.sourceFamily }">
              <span class="font-preview-name">{{ f.targetFamily || '—' }}</span>
              <span class="font-preview-style">{{ f.targetStyle || '—' }}</span>
            </div>
            <div class="font-attrs font-attrs-target">
              <div class="font-attr">
                <input class="font-attr-input" type="number" :value="fmtNum(f.targetFontSize)" @input="f.targetFontSize = ($event.target as HTMLInputElement).valueAsNumber || 0" placeholder="继承" />
                <span class="font-attr-label">字号</span>
              </div>
              <div class="font-attr">
                <input class="font-attr-input" type="number" :value="fmtNum(f.targetLineHeight)" @input="f.targetLineHeight = ($event.target as HTMLInputElement).valueAsNumber || null" placeholder="继承" />
                <span class="font-attr-label">行距</span>
              </div>
              <div class="font-attr">
                <input class="font-attr-input" type="number" :value="fmtNum(f.targetLetterSpacing)" @input="f.targetLetterSpacing = ($event.target as HTMLInputElement).valueAsNumber || null" placeholder="继承" />
                <span class="font-attr-label">字距</span>
              </div>
              <div class="font-attr">
                <select class="font-attr-select" v-model="f.targetTextAlign">
                  <option value="">继承</option>
                  <option value="LEFT">左</option>
                  <option value="CENTER">中</option>
                  <option value="RIGHT">右</option>
                  <option value="JUSTIFIED">两端</option>
                </select>
                <span class="font-attr-label">对齐</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 术语库 -->
    <div class="section">
      <div class="section-header" @click="showGlossary = !showGlossary">
        <svg class="chevron" :class="{ open: showGlossary }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span>术语库</span>
        <span class="section-count">{{ glossary.length }}</span>
      </div>
      <div class="section-body" v-if="showGlossary">
        <div class="inline-actions">
          <button class="btn btn-sm btn-secondary" @click="downloadGlossaryTemplate">模板</button>
          <button class="btn btn-sm btn-secondary" @click="triggerGlossaryUpload">上传</button>
          <button class="btn btn-sm btn-ghost" @click="clearGlossary" v-if="glossary.length">清空</button>
          <input ref="glossaryInput" type="file" accept=".csv" style="display:none" @change="handleGlossaryUpload" />
        </div>
        <div class="glossary-list" v-if="glossary.length">
          <div class="glossary-card" v-for="(g, i) in glossary" :key="i">
            <div class="gc-head">
              <span class="gc-source">{{ g.source }}</span>
              <button class="btn-del" @click="glossary.splice(i, 1); saveGlossary()">
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              </button>
            </div>
            <div class="gc-tags">
              <span class="gc-tag" v-for="l in activeGlossaryLangs" :key="l.code">
                <b>{{ l.code }}</b>&nbsp;{{ g.translations[l.code] || '-' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 设置 -->
    <div class="section">
      <div class="section-header" @click="showSettings = !showSettings">
        <svg class="chevron" :class="{ open: showSettings }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span>大模型配置</span>
      </div>
      <div class="section-body" v-if="showSettings">
        <div class="field-group">
          <label class="field-label">API Key</label>
          <input class="field" type="password" v-model="llmConfig.apiKey" placeholder="sk-..." />
        </div>
        <div class="field-group">
          <label class="field-label">API 地址</label>
          <input class="field" v-model="llmConfig.apiUrl" placeholder="https://api.openai.com/v1/chat/completions" />
        </div>
        <div class="field-group">
          <label class="field-label">模型</label>
          <input class="field" v-model="llmConfig.model" placeholder="gpt-4o" />
        </div>
        <div class="field-group">
          <label class="field-label">行业翻译提示</label>
          <div class="preset-row">
            <select class="field preset-select" v-model="selectedPreset" @change="applyPreset">
              <option value="">自定义</option>
              <option value="standard">通用标准版</option>
              <option value="technical">严谨专业版</option>
              <option value="marketing">电商营销版</option>
              <option value="taiwan">台湾繁体版（3C/存储）</option>
            </select>
          </div>
          <textarea class="field" v-model="llmConfig.industryContext" rows="4"
            placeholder='例如：这是3C数码产品详情页，"刷新率"而非"更新率"'></textarea>
        </div>
        <div class="field-group">
          <label class="toggle-label" @click="llmConfig.enableProofread = !llmConfig.enableProofread">
            <span class="toggle" :class="{ on: llmConfig.enableProofread }">
              <span class="toggle-knob"></span>
            </span>
            AI 校对（翻译后自动二次审查）
          </label>
        </div>
        <template v-if="llmConfig.enableProofread">
          <div class="proof-section-label">校对模型配置</div>
          <div class="field-group">
            <label class="field-label">校对 API Key（空则复用翻译）</label>
            <input class="field" type="password" v-model="llmConfig.proofreadApiKey" placeholder="sk-..." />
          </div>
          <div class="field-group">
            <label class="field-label">校对 API 地址</label>
            <input class="field" v-model="llmConfig.proofreadApiUrl" placeholder="与翻译相同" />
          </div>
          <div class="field-group">
            <label class="field-label">校对模型</label>
            <input class="field" v-model="llmConfig.proofreadModel" placeholder="与翻译相同" />
          </div>
        </template>
        <div class="btn-row">
          <button class="btn btn-primary flex-1" @click="saveSettings" :disabled="saving">
            {{ saving ? '保存中...' : '保存配置' }}
          </button>
          <button class="btn btn-secondary flex-1" @click="testTranslationConnection" :disabled="testingTrans">
            {{ testingTrans ? '测试中...' : '测试翻译' }}
          </button>
          <button v-if="llmConfig.enableProofread" class="btn btn-secondary flex-1" @click="testProofConnection" :disabled="testingProof">
            {{ testingProof ? '测试中...' : '测试校对' }}
          </button>
        </div>
        <div class="test-result" v-if="testResultTrans" :class="{ success: testResultTrans.success, fail: !testResultTrans.success }">
          <span class="test-icon">{{ testResultTrans.success ? '✓' : '✗' }}</span>
          <span>翻译: {{ testResultTrans.message }}</span>
        </div>
        <div class="test-result" v-if="testResultProof" :class="{ success: testResultProof.success, fail: !testResultProof.success }">
          <span class="test-icon">{{ testResultProof.success ? '✓' : '✗' }}</span>
          <span>校对: {{ testResultProof.message }}</span>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <transition name="fade">
      <div class="toast" v-if="toastMsg" :class="toastType">{{ toastMsg }}</div>
    </transition>

    <div class="footer">by Lexar Design Team</div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { UIMessage, PluginMessage, TextItem, LLMConfig, GlossaryEntry, TranslationCorrection, LANGUAGES, TestConnectionResult } from '@messages/types'
import { sendMsgToPlugin } from '@messages/ui-sender'
import { parseCSVRow, csvEncodeCell } from '@lib/parse-csv'
import { formatCJKSpace } from '@lib/format-text'
import { postProcessTranslation } from '@lib/post-process'
import { translateBatch, proofreadBatch, fetchWithRetry } from '@lib/llm-api'
import { DEFAULT_GLOSSARY_CSV } from '@lib/default-glossary'
import { TRANSLATE_BATCH_SIZE, PROOFREAD_BATCH_SIZE, TOAST_DURATION_MS, CORRECTION_THRESHOLD, makeFontKey, parseFontKey } from '@lib/constants'

// ============================================================
// 响应式状态
// ============================================================
const items = ref<TextItem[]>([])
const targetLang = ref('en')
const glossary = ref<GlossaryEntry[]>([])
const translationCache = ref<Record<string, string>>({})
const llmConfig = ref<LLMConfig>({ apiKey: '', apiUrl: '', model: 'gpt-4o', industryContext: '', enableProofread: false, proofreadApiKey: '', proofreadApiUrl: '', proofreadModel: '' })

const scanning = ref(false)
const translating = ref(false)
const proofreading = ref(false)
const applying = ref(false)
const undoing = ref(false)
const cancelFlag = ref(false)
const failedNodeIds = ref<string[]>([])
const translateErrors = ref<Set<string>>(new Set())

const translateProgress = ref({ current: 0, total: 0 })
const translateProgressPercent = computed(() =>
  translateProgress.value.total > 0 ? (translateProgress.value.current / translateProgress.value.total) * 100 : 0
)

const proofreadProgress = ref({ current: 0, total: 0 })
const proofreadProgressPercent = computed(() =>
  proofreadProgress.value.total > 0 ? (proofreadProgress.value.current / proofreadProgress.value.total) * 100 : 0
)

const applyingProgress = ref({ current: 0, total: 0 })
const applyingProgressPercent = computed(() =>
  applyingProgress.value.total > 0 ? (applyingProgress.value.current / applyingProgress.value.total) * 100 : 0
)

const showTexts = ref(true)
const showGlossary = ref(false)
const showFontMap = ref(false)
const showSettings = ref(false)
const isDark = ref(false)

const testingTrans = ref(false)
const testingProof = ref(false)
const saving = ref(false)
const testResultTrans = ref<TestConnectionResult | null>(null)
const testResultProof = ref<TestConnectionResult | null>(null)

interface FontMapping {
  key: string
  sourceFamily: string; sourceStyle: string; sourceFontSize: number
  sourceLineHeight: number | null; sourceLetterSpacing: number | null
  sourceTextAlign: string
  targetFamily: string; targetStyle: string
  targetFontSize: number; targetLineHeight: number | null
  targetLetterSpacing: number | null; targetTextAlign: string
  selectedFont: string
}

const ALIGN_LABELS: Record<string, string> = { LEFT: '左', CENTER: '居中', RIGHT: '右', JUSTIFIED: '两端' }

function fmtNum(n: number | null | undefined, fallback = ''): string {
  if (n === null || n === undefined || n === 0) return fallback
  const r = Math.round(n * 10) / 10
  return String(r)
}

const fontMappings = computed(() => {
  const map = new Map<string, FontMapping>()
  for (const item of items.value) {
    const key = makeFontKey(item.fontFamily, item.fontStyle)
    if (!map.has(key)) {
      map.set(key, {
        key,
        sourceFamily: item.fontFamily,
        sourceStyle: item.fontStyle,
        sourceFontSize: item.fontSize,
        sourceLineHeight: item.lineHeight,
        sourceLetterSpacing: item.letterSpacing,
        sourceTextAlign: item.textAlignHorizontal || 'LEFT',
        targetFamily: item.targetFontFamily || '',
        targetStyle: item.targetFontStyle || '',
        targetFontSize: item.targetFontSize || 0,
        targetLineHeight: item.targetLineHeight,
        targetLetterSpacing: item.targetLetterSpacing,
        targetTextAlign: item.targetTextAlign || '',
        selectedFont: item.targetFontFamily ? makeFontKey(item.targetFontFamily, item.targetFontStyle || 'Regular') : '',
      })
    }
  }
  return Array.from(map.values())
})

const availableFonts = ref<{ family: string; style: string }[]>([])

const STYLE_WEIGHT: Record<string, number> = {
  Thin: 0, ThinItalic: 1, ExtraLight: 2, ExtraLightItalic: 3, Light: 4, LightItalic: 5,
  Regular: 6, Italic: 7, Medium: 8, MediumItalic: 9, Semibold: 10, SemiboldItalic: 11,
  Bold: 12, BoldItalic: 13, ExtraBold: 14, ExtraBoldItalic: 15, Black: 16, BlackItalic: 17,
  Heavy: 18, HeavyItalic: 19,
}

function styleWeight(style: string): number {
  const key = style.replace(/ /g, '')
  return STYLE_WEIGHT[key] ?? 99
}

interface FontOption { key: string; family: string; style: string }

const fontStyleOptions = computed(() => {
  const list: FontOption[] = availableFonts.value.map(function (f) {
    return { key: makeFontKey(f.family, f.style), family: f.family, style: f.style }
  })
  list.sort(function (a, b) {
    const fam = a.family.localeCompare(b.family)
    if (fam !== 0) return fam
    return styleWeight(a.style) - styleWeight(b.style)
  })
  return list
})

const fontSearchMap = ref<Record<string, string>>({})

function filteredFontOptions(fm: FontMapping): FontOption[] {
  const q = (fontSearchMap.value[fm.key] || '').trim().toLowerCase()
  if (!q) return fontStyleOptions.value
  return fontStyleOptions.value.filter(function (f) {
    return f.family.toLowerCase().includes(q) || f.style.toLowerCase().includes(q)
  })
}

function groupedFontOptions(options: FontOption[]): Array<[string, FontOption[]]> {
  const map = new Map<string, FontOption[]>()
  for (const opt of options) {
    const group = map.get(opt.family)
    if (group) {
      group.push(opt)
    } else {
      map.set(opt.family, [opt])
    }
  }
  return Array.from(map.entries())
}

function onFontSelected(f: FontMapping) {
  if (f.selectedFont) {
    const parsed = parseFontKey(f.selectedFont)
    f.targetFamily = parsed.family
    f.targetStyle = parsed.style
  } else {
    f.targetFamily = ''
    f.targetStyle = ''
    f.selectedFont = ''
  }
}


const toastMsg = ref('')
const toastType = ref('info')
let toastTimer = 0

const csvInput = ref<HTMLInputElement | null>(null)
const glossaryInput = ref<HTMLInputElement | null>(null)

const activeGlossaryLangs = computed(() => {
  const set = new Set<string>()
  for (const g of glossary.value) {
    for (const code of Object.keys(g.translations)) {
      if (g.translations[code]) set.add(code)
    }
  }
  return Array.from(set).map(function (code) {
    return { code, name: LANGUAGES.find(function (l) { return l.code === code })?.name || code }
  }).sort(function (a, b) { return a.code.localeCompare(b.code) })
})

const hasTranslation = computed(() => items.value.some(it => it.translatedText))

const statusClass = computed(() => {
  if (translating.value || proofreading.value) return 'busy'
  if (hasTranslation.value) return 'done'
  return 'idle'
})

function resizeTextareaEl(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

function autoResize(e: Event) {
  resizeTextareaEl(e.target as HTMLTextAreaElement)
}

function resizeAllTextareas() {
  nextTick(function () {
    const list = document.querySelectorAll('.trans-input')
    for (let i = 0; i < list.length; i++) {
      resizeTextareaEl(list[i] as HTMLTextAreaElement)
    }
  })
}

function showToast(msg: string, type = 'info') {
  toastMsg.value = msg
  toastType.value = type
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, TOAST_DURATION_MS) as unknown as number
}

// ============================================================
// 用户修正跟踪
// ============================================================
const editingOriginal = ref<{ item: TextItem; originalTranslation: string } | null>(null)
const corrections = ref<TranslationCorrection[]>([])

function onTransInputFocus(item: TextItem) {
  // 记录编辑前的译文，用于后续比对
  editingOriginal.value = { item, originalTranslation: item.translatedText }
}

function onTransInputBlur(item: TextItem) {
  if (!editingOriginal.value || editingOriginal.value.item !== item) return
  const before = editingOriginal.value.originalTranslation
  const after = item.translatedText
  editingOriginal.value = null

  // 仅记录有实质性差异的修改
  if (before !== after && before.trim() && after.trim()) {
    const correction: TranslationCorrection = {
      source: item.sourceText,
      targetLang: targetLang.value,
      originalTranslation: before,
      correctedTranslation: after,
      correctedAt: Date.now(),
    }
    corrections.value.push(correction)
    sendMsgToPlugin(UIMessage.SAVE_CORRECTION, JSON.parse(JSON.stringify(correction)))
  }
}

// ============================================================
// 扫描
// ============================================================
function scanAll() {
  scanning.value = true
  items.value = []
  sendMsgToPlugin(UIMessage.SCAN_ALL)
  // scanning state reset by SCAN_RESULT message
}

function scanSelection() {
  scanning.value = true
  items.value = []
  sendMsgToPlugin(UIMessage.SCAN_SELECTION)
  // scanning state reset by SCAN_RESULT message
}

// ============================================================
// 取消操作
// ============================================================
function cancelOperation() {
  cancelFlag.value = true
  showToast('正在取消...', 'warning')
}

// ============================================================
// 翻译
// ============================================================
async function startTranslate() {
  if (!settingsReady || !glossaryReady) {
    showToast('插件正在初始化，请稍后再试...', 'warning')
    return
  }
  if (!llmConfig.value.apiKey || !llmConfig.value.apiUrl) {
    showToast('请先展开下方"大模型配置"并填写 API Key 和 API 地址', 'error')
    showSettings.value = true
    return
  }

  translating.value = true
  cancelFlag.value = false
  translateErrors.value = new Set()
  translateProgress.value = { current: 0, total: 0 }

  try {
    const glossaryMap = new Map<string, string>()
  for (const g of glossary.value) {
    const t = g.translations[targetLang.value]
    if (t) glossaryMap.set(g.source, t)
  }

  const toTranslate = items.value.filter(it => it.sourceText.trim())
  const total = toTranslate.length

  if (total === 0) {
    translating.value = false
    showToast('没有待翻译的文本', 'info')
    return
  }

  // 纯数字、单字符文本直接沿用原文，不请求 API
  let autoSkipped = 0
  for (const item of toTranslate) {
    const trimmed = item.sourceText.trim()
    if (/^\d+(\.\d+)?$/.test(trimmed) || (trimmed.length === 1 && !/[一-鿿぀-ヿ가-힯]/.test(trimmed))) {
      item.translatedText = trimmed
      autoSkipped++
    }
  }

  // 分离需要 API 翻译和已自动沿用的
  const needApi = toTranslate.filter(it => !it.translatedText)
  const apiTotal = needApi.length

  if (apiTotal === 0) {
    translating.value = false
    resizeAllTextareas()
    if (autoSkipped === total) {
      showToast(`已沿用 ${autoSkipped} 条文本（数字/单字符无需翻译）`, 'success')
      return
    }
    // 全部已翻译：如果开启了校对，直接执行校对（支持校对失败后重试）
    if (llmConfig.value.enableProofread) {
      showToast('翻译已完成，执行 AI 校对...', 'info')
      try {
        await startProofread()
      } catch (e) {
        console.error('[translate] standalone proofread crashed', e)
        showToast('校对异常: ' + (e instanceof Error ? e.message : String(e)), 'error')
      }
    } else {
      showToast(`所有 ${total} 条文本均已翻译，无需重复翻译。如需重译请重新扫描`, 'info')
    }
    return
  }

  const cache = translationCache.value
  const cacheKey = (text: string) => text + '\x00' + targetLang.value
  let cacheHits = 0

  let failedBatches = 0
  let lastErrorMsg = ''
  let cursor = autoSkipped
  translateProgress.value = { current: cursor, total }
  for (let i = 0; i < apiTotal; i += TRANSLATE_BATCH_SIZE) {
    if (cancelFlag.value) break
    const batch = needApi.slice(i, i + TRANSLATE_BATCH_SIZE)
    const texts = batch.map(it => it.sourceText)

    try {
      // 检查缓存：分离已缓存和未缓存的文本
      const uncachedIndices: number[] = []
      const cachedResult: (string | null)[] = texts.map((t, idx) => {
        const hit = cache[cacheKey(t)]
        if (hit !== undefined) {
          cacheHits++
          return hit
        }
        uncachedIndices.push(idx)
        return null
      })

      let translated: string[] = []
      if (uncachedIndices.length > 0) {
        const uncachedTexts = uncachedIndices.map(idx => texts[idx])
        const apiResult = await translateBatch(uncachedTexts, targetLang.value, glossaryMap, llmConfig.value)
        // 合并缓存+API结果
        translated = texts.map((_, idx) => {
          if (cachedResult[idx] !== null) return cachedResult[idx]!
          const apiIdx = uncachedIndices.indexOf(idx)
          return apiResult[apiIdx] || ''
        })
        // 更新缓存
        for (let j = 0; j < uncachedIndices.length; j++) {
          const srcIdx = uncachedIndices[j]
          cache[cacheKey(texts[srcIdx])] = apiResult[j] || ''
        }
      } else {
        translated = cachedResult as string[]
      }

      for (let j = 0; j < batch.length; j++) {
        batch[j].translatedText = formatCJKSpace(translated[j] || '', targetLang.value)
        cursor++
      }
    } catch (e) {
      failedBatches++
      lastErrorMsg = e instanceof Error ? e.message : String(e)
      for (const item of batch) {
        translateErrors.value.add(item.nodeIds[0])
      }
      cursor += batch.length
      console.error('[translate] batch failed', i, lastErrorMsg)
    }
    translateProgress.value = { current: cursor, total }
  }

  translating.value = false
  resizeAllTextareas()

  // 翻译结束后统一持久化缓存
  // 注意：Vue3 ref 值是 Proxy 对象，postMessage 无法克隆，需展开为纯对象
  if (Object.keys(cache).length > 0) {
    sendMsgToPlugin(UIMessage.SAVE_TRANSLATION_CACHE, { ...cache })
  }

  if (cancelFlag.value) {
    const count = toTranslate.filter(it => it.translatedText).length
    showToast(`翻译已取消，已完成 ${count} 条`, 'warning')
    return
  }

  const count = toTranslate.filter(it => it.translatedText).length
  const cacheMsg = cacheHits > 0 ? ` (缓存命中 ${cacheHits} 条)` : ''
  const failMsg = failedBatches > 0 ? `，${failedBatches} 个批次失败` : ''
  const skipMsg = autoSkipped > 0 ? `，${autoSkipped} 条沿用原文` : ''
  if (count === 0 && failedBatches > 0) {
    const errDetail = lastErrorMsg ? ' — ' + lastErrorMsg.slice(0, 80) : ''
    showToast('翻译失败：所有批次请求失败' + errDetail, 'error')
  } else {
    showToast('翻译完成: ' + count + ' 条' + cacheMsg + skipMsg + failMsg, failedBatches > 0 ? 'warning' : 'success')
  }

  if (llmConfig.value.enableProofread && count > 0) {
    showToast('翻译完成，即将开始校对...', 'info')
    await new Promise(r => setTimeout(r, 1500))  // 避免翻译 API 调用刚结束立即触发频率限制
    try {
      await startProofread()
    } catch (e) {
      console.error('[translate] proofread crashed', e)
      showToast('校对异常: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }
  } catch (e) {
    translating.value = false
    console.error('[translate] fatal error', e)
    showToast('翻译异常: ' + (e instanceof Error ? e.message : String(e)), 'error')
  }
}

async function startProofread() {
  proofreading.value = true
  cancelFlag.value = false
  proofreadProgress.value = { current: 0, total: 0 }

  const toCheck = items.value.filter(it => it.translatedText.trim())
  const total = toCheck.length

  if (total === 0) {
    proofreading.value = false
    showToast('没有可校对的译文', 'info')
    return
  }

  try {
    const glossaryMap = new Map<string, string>()
    for (const g of glossary.value) {
      const t = g.translations[targetLang.value]
      if (t) glossaryMap.set(g.source, t)
    }

    let correctedCount = 0
    let cursor = 0
    let failedBatches = 0
    let proofLastError = ''
    for (let i = 0; i < total; i += PROOFREAD_BATCH_SIZE) {
      if (cancelFlag.value) break
      const batch = toCheck.slice(i, i + PROOFREAD_BATCH_SIZE)
      try {
        const batchResults = await proofreadBatch(
          batch.map(it => ({ sourceText: it.sourceText, translatedText: it.translatedText })),
          targetLang.value,
          glossaryMap,
          llmConfig.value,
        )
        for (let j = 0; j < batch.length; j++) {
          const proofed = batchResults[j]
          if (proofed.text && proofed.text !== 'OK' && proofed.text !== batch[j].translatedText) {
            let fixed = postProcessTranslation(proofed.text, targetLang.value)
            fixed = formatCJKSpace(fixed, targetLang.value)
            // 后处理后若与原译文一致则跳过（API 可能仅修正了空格/标点等被后处理吞掉的差异）
            if (fixed === batch[j].translatedText) { cursor++; continue }
            batch[j].proofreadText = batch[j].translatedText
            batch[j].translatedText = fixed
            batch[j].proofreadReason = (proofed.reason || '').slice(0, 40)
            batch[j].corrected = true
            correctedCount++
          }
          cursor++
        }
      } catch (e) {
        failedBatches++
        proofLastError = e instanceof Error ? e.message : String(e)
        cursor += batch.length
        console.error('[translate] proofread batch failed', i, proofLastError)
      }
      proofreadProgress.value = { current: cursor, total }
    }

    proofreading.value = false
    resizeAllTextareas()
    if (cancelFlag.value) {
      showToast(`校对已取消，已修正 ${correctedCount} 处`, 'warning')
      return
    }
    if (correctedCount === 0 && failedBatches === total / PROOFREAD_BATCH_SIZE && failedBatches > 0) {
      showToast('校对全部失败: ' + proofLastError.slice(0, 80), 'error')
    } else {
      const failMsg = failedBatches > 0 ? `，${failedBatches} 批次校对失败` : ''
      showToast('校对完成: ' + correctedCount + ' 处被修正' + failMsg, correctedCount > 0 ? 'success' : 'info')
    }
  } catch (e) {
    proofreading.value = false
    showToast('校对失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
  }
}

// ============================================================
// 应用 & 撤销
// ============================================================
function applyTranslations() {
  if (items.value.length === 0) return
  applying.value = true
  syncFontMappings()
  const payload = items.value.map(function (it) {
    return {
      ...it,
      proofreadText: '',
      proofreadReason: '',
      corrected: false,
    }
  })
  sendMsgToPlugin(UIMessage.APPLY_TRANSLATIONS, JSON.parse(JSON.stringify(payload)))
  // applying state reset by APPLY_DONE message
}

function syncFontMappings() {
  const lookup = new Map(fontMappings.value.map(f => [f.key, f]))
  for (const item of items.value) {
    const f = lookup.get(makeFontKey(item.fontFamily, item.fontStyle))
    if (!f) continue
    item.targetFontFamily = f.targetFamily
    item.targetFontStyle = f.targetStyle
    item.targetFontSize = f.targetFontSize || 0
    item.targetLineHeight = f.targetLineHeight
    item.targetLetterSpacing = f.targetLetterSpacing
    item.targetTextAlign = f.targetTextAlign || ''
  }
}

function undoAll() {
  undoing.value = true
  sendMsgToPlugin(UIMessage.UNDO_ALL)
  // undoing state reset by UNDO_DONE message
}

function retryFailed() {
  if (failedNodeIds.value.length === 0) return
  const failedSet = new Set(failedNodeIds.value)
  const retryItems = items.value
    .filter(it => it.nodeIds.some(nid => failedSet.has(nid)))
    .map(it => ({
      ...it,
      proofreadText: '',
      proofreadReason: '',
      corrected: false,
    }))
  if (retryItems.length === 0) {
    showToast('未找到失败节点对应的条目', 'error')
    return
  }
  applying.value = true
  failedNodeIds.value = []
  sendMsgToPlugin(UIMessage.APPLY_TRANSLATIONS, JSON.parse(JSON.stringify(retryItems)))
}

// ============================================================
// CSV 导入导出
// ============================================================
function exportCSV() {
  sendMsgToPlugin(UIMessage.EXPORT_CSV, JSON.parse(JSON.stringify(items.value)))
}

function triggerImport() {
  csvInput.value?.click()
}

function handleCSVImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    sendMsgToPlugin(UIMessage.IMPORT_CSV, reader.result as string)
  }
  reader.readAsText(file)
  csvInput.value!.value = ''
}

// ============================================================
// 术语库管理
// ============================================================
function triggerDownload(csv: string, filename: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadGlossaryTemplate() {
  triggerDownload(DEFAULT_GLOSSARY_CSV, 'Lexar术语库模板.csv')
}

function triggerGlossaryUpload() {
  glossaryInput.value?.click()
}

function handleGlossaryUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const text = (reader.result as string).replace(/^﻿/, '').trim()
    const rows = text.split('\n')
    const headerCells = parseCSVRow(rows[0])
    const langCols: string[] = []
    for (let i = 1; i < headerCells.length; i++) {
      langCols.push(headerCells[i].trim())
    }

    const entries: GlossaryEntry[] = []
    for (let i = 1; i < rows.length; i++) {
      const cells = parseCSVRow(rows[i])
      const source = (cells[0] || '').trim()
      if (!source) continue
      const translations: Record<string, string> = {}
      for (let j = 0; j < langCols.length; j++) {
        const val = (cells[j + 1] || '').trim()
        if (val) translations[langCols[j]] = val
      }
      entries.push({ source, translations })
    }
    // 合并而非替换：已有条目更新翻译，新条目追加
    const existingMap = new Map(glossary.value.map(g => [g.source, g]))
    let added = 0
    let updated = 0
    for (const entry of entries) {
      const existing = existingMap.get(entry.source)
      if (existing) {
        let changed = false
        for (const [lang, val] of Object.entries(entry.translations)) {
          if (val && existing.translations[lang] !== val) {
            existing.translations[lang] = val
            changed = true
          }
        }
        if (changed) updated++
      } else {
        glossary.value.push(entry)
        added++
      }
    }
    saveGlossary()
    showToast(`已导入：新增 ${added} 条，更新 ${updated} 条`, 'success')
  }
  reader.readAsText(file)
  glossaryInput.value!.value = ''
}

function clearGlossary() {
  glossary.value = []
  saveGlossary()
}

function saveGlossary() {
  translationCache.value = {}  // 术语库变更后清除缓存
  sendMsgToPlugin(UIMessage.SAVE_GLOSSARY, JSON.parse(JSON.stringify(glossary.value)))
}

// ============================================================
// 行业翻译提示预设
// ============================================================
const PRESETS: Record<string, string> = {
  standard: `你是Lexar（雷克沙）的专业翻译，专注SSD固态硬盘、HDD机械硬盘、内存条、U盘、存储卡、PSSD移动固态硬盘、NAS、硬盘盒等存储全品类商品详情页翻译。
翻译严格遵守以下规则：
1. 术语库中的固定译法为最高翻译标准，必须严格使用，不得自创替代；
2. 专业术语绝对标准化，存储行业固定名词统一业内通用译法，不随意直译、不自创词汇；
3. 保持电商详情页原有排版、分段、换行，不要打乱原文结构；
4. 句式贴合海外电商平台表达习惯，通顺自然，不生硬机翻；
5. 保留产品参数、规格、接口型号、容量参数（如1TB、PCIe 4.0、NVMe、SATA、USB3.2）原样不动；
6. 营销文案保留原有卖点气场，不删减亮点、不夸大、不曲解原意；
7. 禁止口语化、网络俚语，用词正式符合3C数码电商文案风格；
8. 只输出翻译结果，不要额外解释、不要多余话术。`,

  technical: `角色：Lexar（雷克沙）资深技术翻译+跨境电商文案专家
服务品类：SSD固态硬盘、HDD机械硬盘、台式机/笔记本内存DDR4/DDR5、TF/SD存储卡、移动固态硬盘PSSD、U盘、NAS硬盘、硬盘阵列盒、存储扩展配件等全品类。

翻译硬性规则：
1. 术语库固定译法为强制标准，全文严格统一，不允许任何变体或自创；
2. 所有技术参数、接口协议、颗粒类型、主控型号、读写速度、协议标准严格遵循国际存储行业官方标准术语，统一规范译法；
3. 技术语句严谨客观，不美化、不夸张，忠于原文技术含义；
4. 数字、单位、型号、版本、接口标识（NVMe/PCIe/SATA/USB/CFexpress等）完全保留不翻译、不改动；
5. 保留原文表格、分段、项目符号、换行结构，格式完全对齐；
6. 避免中式英语/中式外文，适配亚马逊、独立站、跨境平台官方商品文案风格；
7. 专业词汇固定统一，全文前后译法保持一致；
8. 仅输出精准译文，无多余解释、无补充说明、无格式冗余。`,

  marketing: `你是Lexar（雷克沙）跨境3C数码存储类爆款详情页文案翻译专家，精通海外消费者阅读习惯。
翻译要求：
1. 术语库译法为标准底线，在此基础之上进行营销文案优化，不可偏离术语库原意；
2. 覆盖SSD、内存、U盘、移动硬盘、存储卡、NAS等存储全品类；
3. 专业术语标准不变，营销语句优化得更有吸引力，符合海外电商种草文案风格；
4. 保留原有产品卖点、功能亮点、场景描述（办公、游戏、摄影、装机、存储备份）；
5. 不改变原意，适当润色句式，流畅高级，不生硬机翻；
6. 保留原文分段排版，参数型号容量原样保留；
7. 不用口语化低俗表达，保持高端数码产品文案质感；
8. 直接输出翻译结果，无需额外备注和解释。`,

  taiwan: `你是Lexar（雷克沙）的專業用語在地化轉換專家。你正在將大陸簡體中文（數位3C/存儲行業文案）轉換為台灣繁體中文。這不是簡單的簡轉繁，而是必須做完整的用語本地化（在地化）。

轉換重點：
1. 詞彙本地化：所有大陸用語必須改為台灣慣用詞彙（如：硬盤→硬碟、U盤→隨身碟、內存→記憶體、顯卡→顯示卡、鼠標→滑鼠、充電寶→行動電源、筆記本→筆記型電腦、台式機→桌上型電腦、服務器→伺服器、芯片→晶片、傳感器→感測器、軟件→軟體、硬件→硬體、文件→檔案、數據→資料、網絡→網路、視頻→影片、音頻→音訊、默認→預設、點擊→點選、搜索→搜尋、支持→支援、優化→最佳化、智能→智慧、數字→數位、賬號→帳號、權限→權限、插件→外掛程式、菜單→選單、配置→設定、兼容→相容、加載→載入）
2. 存儲行業術語標準：NVMe/PCIe/SATA/USB/Thunderbolt保留不翻譯、固件→韌體、閃存→快閃記憶體、主控→主控晶片、緩存→快取、帶寬→頻寬、協議→協定、接口→連接埠/介面
3. 容量參數型號（1TB、PCIe 4.0、NVMe、USB 3.2、Type-C）保留原樣不動
4. 保留原文排版分段，使用全形標點（，。！？：「」）
5. 語氣符合台灣閱讀習慣，不使用大陸慣用書面語（如"從而"、"進而"、"通過"表示"透過"、"您"的泛化使用）
6. 專有名詞和產品型號保留原文不翻譯
7. 禁止僅做字符簡轉繁而不轉換詞彙，必須做到讓台灣讀者閱讀時感覺是本地撰寫的文案`,
}

const selectedPreset = ref('')

function applyPreset() {
  if (selectedPreset.value && PRESETS[selectedPreset.value]) {
    llmConfig.value.industryContext = PRESETS[selectedPreset.value]
  }
}

// ============================================================
// 设置
// ============================================================
function saveSettings() {
  saving.value = true
  translationCache.value = {}  // 设置变更后清除缓存
  sendMsgToPlugin(UIMessage.SAVE_SETTINGS, JSON.parse(JSON.stringify(llmConfig.value)))
}

async function testTranslationConnection() {
  if (!llmConfig.value.apiKey || !llmConfig.value.apiUrl) {
    showToast('请先填写 API Key 和 API 地址', 'error')
    return
  }
  testingTrans.value = true
  testResultTrans.value = null

  const startedAt = Date.now()
  try {
    const res = await fetchWithRetry(llmConfig.value.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + llmConfig.value.apiKey,
      },
      body: JSON.stringify({
        model: llmConfig.value.model,
        messages: [
          { role: 'system', content: 'Reply with exactly: OK' },
          { role: 'user', content: 'Hi' },
        ],
        temperature: 0,
      }),
    }, 1, 0)
    const latencyMs = Date.now() - startedAt
    if (!res.ok) {
      testResultTrans.value = { success: false, message: 'HTTP ' + res.status + ': ' + res.text.slice(0, 200), latencyMs }
      testingTrans.value = false
      return
    }
    const json = res.json as Record<string, unknown>
    const model = (json.model as string) || llmConfig.value.model
    testResultTrans.value = { success: true, message: '连接成功，模型: ' + model + '，耗时 ' + latencyMs + 'ms', model, latencyMs }
  } catch (e) {
    testResultTrans.value = { success: false, message: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - startedAt }
  }
  testingTrans.value = false
}

async function testProofConnection() {
  const apiKey = llmConfig.value.proofreadApiKey || llmConfig.value.apiKey
  const apiUrl = llmConfig.value.proofreadApiUrl || llmConfig.value.apiUrl
  const model = llmConfig.value.proofreadModel || llmConfig.value.model

  if (!apiKey || !apiUrl) {
    showToast('请先填写校对的 API Key 和 API 地址（或翻译配置）', 'error')
    return
  }
  testingProof.value = true
  testResultProof.value = null

  const startedAt = Date.now()
  try {
    const res = await fetchWithRetry(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Reply with exactly: OK' },
          { role: 'user', content: 'Hi' },
        ],
        temperature: 0,
      }),
    }, 1, 0)
    const latencyMs = Date.now() - startedAt
    if (!res.ok) {
      testResultProof.value = { success: false, message: 'HTTP ' + res.status + ': ' + res.text.slice(0, 200), latencyMs }
      testingProof.value = false
      return
    }
    const json = res.json as Record<string, unknown>
    const actualModel = (json.model as string) || model
    testResultProof.value = { success: true, message: '连接成功，模型: ' + actualModel + '，耗时 ' + latencyMs + 'ms', model: actualModel, latencyMs }
  } catch (e) {
    testResultProof.value = { success: false, message: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - startedAt }
  }
  testingProof.value = false
}

// ============================================================
// 消息监听
// ============================================================
let settingsReady = false
let glossaryReady = false

onMounted(() => {
  // 先注册监听器，再发请求，避免任何竞态
  window.addEventListener('message', (e) => {
    const msg = e.data?.pluginMessage ?? e.data
    if (!msg?.type) return

    const { type, data } = msg

    switch (type) {
      case PluginMessage.SCAN_RESULT:
        scanning.value = false
        items.value = data as TextItem[]
        resizeAllTextareas()
        showToast(`扫描到 ${(data as TextItem[]).length} 个文本节点`, 'success')
        break

      case PluginMessage.TRANSLATION_CACHE_LOADED:
        translationCache.value = (data as Record<string, string>) || {}
        break

      case PluginMessage.APPLY_PROGRESS: {
        const p = data as { current: number; total: number }
        applyingProgress.value.current = p.current
        applyingProgress.value.total = p.total
        break
      }

      case PluginMessage.APPLY_DONE: {
        applying.value = false
        applyingProgress.value.current = 0
        applyingProgress.value.total = 0
        const d = data as { count: number; failed?: number; failedNodeIds?: string[] }
        failedNodeIds.value = d.failedNodeIds || []
        const msg = d.failed
          ? `已应用 ${d.count} 条，${d.failed} 处失败`
          : `已应用 ${d.count} 条译文到画布`
        showToast(msg, d.failed ? 'error' : 'success')
        break
      }

      case PluginMessage.UNDO_DONE:
        undoing.value = false
        showToast(`已恢复 ${(data as { count: number }).count} 条原文`, 'success')
        break

      case PluginMessage.GLOSSARY_LOADED:
        glossary.value = ((data as GlossaryEntry[]) || []).map(function (g: GlossaryEntry) {
          if (g.translations) return g
          return { source: g.source, translations: (g as Record<string, unknown>).target ? { en: (g as Record<string, unknown>).target as string } : {} }
        })
        glossaryReady = true
        break

      case PluginMessage.SETTINGS_LOADED:
        if (data) {
          llmConfig.value = { industryContext: '', enableProofread: false, proofreadApiKey: '', proofreadApiUrl: '', proofreadModel: '', ...(data as LLMConfig) }
        }
        settingsReady = true
        break

      case PluginMessage.SETTINGS_SAVED:
        saving.value = false
        showToast('配置已保存，可跨客户端同步', 'success')
        break

      case PluginMessage.CSV_EXPORT_READY:
        downloadCSV(data as string)
        break

      case PluginMessage.CSV_IMPORT_DONE:
        handleCSVImportDone(data as { nodeIds: string[]; translatedText: string }[])
        break

      case PluginMessage.ERROR:
        scanning.value = false
        translating.value = false
        proofreading.value = false
        applying.value = false
        testingTrans.value = false
        testingProof.value = false
        saving.value = false
        showToast(data as string, 'error')
        break

      case PluginMessage.STATUS:
        showToast(data as string, 'info')
        break


      case PluginMessage.FONTS_LOADED:
        availableFonts.value = (data as { family: string; style: string }[]) || []
        break

      case PluginMessage.CORRECTIONS_LOADED:
        corrections.value = (data as TranslationCorrection[]) || []
        break

      case PluginMessage.CORRECTION_SAVED:
        // 静默保存，不需要提示
        break

      case PluginMessage.CORRECTION_SUGGESTION: {
        const sug = data as { source: string; targetLang: string; correctedTranslation: string; count: number }
        showToast(`"${sug.source}" 已被手动修正 ${sug.count} 次，是否加入术语库？`, 'info')
        // 自动将修正加入术语库
        const existing = glossary.value.find(g => g.source === sug.source)
        if (existing) {
          existing.translations[sug.targetLang] = sug.correctedTranslation
        } else {
          glossary.value.push({
            source: sug.source,
            translations: { [sug.targetLang]: sug.correctedTranslation },
          })
        }
        saveGlossary()
        showToast(`已自动将"${sug.source}"的修正加入术语库`, 'success')
        break
      }
    }
  })

  // 监听器注册完毕后，发送初始化请求
  sendMsgToPlugin(UIMessage.LOAD_SETTINGS)
  sendMsgToPlugin(UIMessage.LOAD_GLOSSARY)
  sendMsgToPlugin(UIMessage.LOAD_FONTS)
  sendMsgToPlugin(UIMessage.LOAD_TRANSLATION_CACHE)

  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    isDark.value = mq.matches
    mq.addEventListener('change', e => { isDark.value = e.matches })
  }
})

// ============================================================
// CSV 辅助
// ============================================================
function downloadCSV(csv: string) {
  triggerDownload(csv, '翻译导出.csv')
  showToast('CSV 已导出', 'success')
}

const csvChangedIds = ref<Set<string>>(new Set())

function handleCSVImportDone(data: { nodeIds: string[]; translatedText: string }[]) {
  csvChangedIds.value = new Set()  // 重置上次导入的高亮
  const nodeToItem = new Map<string, TextItem>()
  for (const item of items.value) {
    for (const nid of item.nodeIds) {
      nodeToItem.set(nid, item)
    }
  }

  let count = 0
  let changed = 0
  const seen = new Set<TextItem>()
  for (const row of data) {
    for (const nid of row.nodeIds) {
      const item = nodeToItem.get(nid)
      if (item && !seen.has(item)) {
        seen.add(item)
        if (item.translatedText && item.translatedText !== row.translatedText) {
          changed++
          csvChangedIds.value.add(item.nodeIds[0])
        }
        item.translatedText = row.translatedText
        count++
        break
      }
    }
  }
  resizeAllTextareas()
  showToast(`已导入 ${count} 条译文` + (changed > 0 ? `，${changed} 条有变更已高亮` : ''), 'success')
}
</script>

<style>
/* ============================================================
   Apple 风格设计系统
   ============================================================ */
* { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --blue: #007AFF;
  --blue-hover: #0062CC;
  --green: #34C759;
  --green-hover: #2DA64A;
  --orange: #FF9500;
  --red: #FF3B30;
  --gray-50: #F5F5F7;
  --gray-100: #E5E5EA;
  --gray-200: #D1D1D6;
  --gray-400: #86868B;
  --gray-600: #636366;
  --gray-800: #2C2C2E;
  --gray-900: #1D1D1F;
  --radius-sm: 8px;
  --radius: 10px;
  --radius-lg: 14px;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
  --shadow: 0 4px 12px rgba(0,0,0,0.08);
  --transition: 0.2s cubic-bezier(0.25, 0.1, 0.25, 1);
}

body {
  font-family: -apple-system, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Helvetica, sans-serif;
  font-size: 13px;
  background: var(--gray-50);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.app {
  padding: 16px;
  color: var(--gray-900);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.app.dark {
  --gray-50: #1C1C1E;
  --gray-100: #2C2C2E;
  --gray-200: #3A3A3C;
  --gray-400: #8E8E93;
  --gray-600: #AEAEB2;
  --gray-800: #E5E5EA;
  --gray-900: #F5F5F7;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
  --shadow: 0 4px 12px rgba(0,0,0,0.4);
  background: #000;
  color: var(--gray-900);
}

/* ---- 状态栏 ---- */
.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
}
.sb-left { display: flex; align-items: center; gap: 8px; }
.sb-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--gray-200);
  transition: background var(--transition);
}
.sb-dot.busy { background: var(--orange); animation: pulse 1.2s infinite; }
.sb-dot.done { background: var(--green); }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
.sb-title { font-size: 15px; font-weight: 600; letter-spacing: -0.02em; }
.sb-badge {
  font-size: 11px; color: var(--gray-400); background: var(--gray-100);
  padding: 3px 8px; border-radius: 20px; font-weight: 500;
}
.sb-badge.active { color: var(--blue); background: rgba(0,122,255,0.1); }

/* ---- 工具栏 ---- */
.toolbar {
  background: #fff;
  border-radius: var(--radius-lg);
  padding: 12px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.app.dark .toolbar { background: var(--gray-100); }
.toolbar-row { display: flex; gap: 6px; align-items: center; }

/* ---- 按钮 ---- */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  padding: 7px 14px; border: none; border-radius: var(--radius);
  font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap;
  transition: all var(--transition); font-family: inherit;
  letter-spacing: -0.01em;
}
.btn:disabled { opacity: 0.35; cursor: not-allowed; }
.btn-icon { font-size: 11px; opacity: 0.7; }
.btn-primary { background: var(--blue); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--blue-hover); }
.btn-secondary { background: var(--gray-100); color: var(--gray-800); }
.btn-secondary:hover:not(:disabled) { background: var(--gray-200); }
.btn-accent { background: var(--green); color: #fff; }
.btn-accent:hover:not(:disabled) { background: var(--green-hover); }
.btn-warning { background: var(--orange); color: #fff; }
.btn-warning:hover:not(:disabled) { background: #e68600; }
.btn-ghost { background: transparent; color: var(--gray-600); }
.btn-ghost:hover:not(:disabled) { background: var(--gray-100); }
.btn-sm { padding: 4px 10px; font-size: 12px; border-radius: var(--radius-sm); }
.btn-block { width: 100%; }
.flex-1 { flex: 1; }

.app.dark .btn-secondary { background: var(--gray-200); }
.app.dark .btn-ghost { color: var(--gray-400); }
.app.dark .btn-ghost:hover:not(:disabled) { background: var(--gray-200); }

/* ---- 语言选择 ---- */
.lang-select {
  flex: 1; padding: 7px 10px; border: 1px solid var(--gray-100);
  border-radius: var(--radius); font-size: 13px; background: #fff;
  color: var(--gray-800); cursor: pointer; font-family: inherit;
  transition: border-color var(--transition);
}
.lang-select:focus { outline: none; border-color: var(--blue); }
.app.dark .lang-select { background: var(--gray-200); border-color: var(--gray-200); color: var(--gray-900); }

/* ---- 进度条 ---- */
.progress-wrap { display: flex; align-items: center; gap: 10px; padding: 0 4px; }
.progress-track {
  flex: 1; height: 4px; background: var(--gray-100);
  border-radius: 2px; overflow: hidden;
}
.progress-fill {
  height: 100%; background: var(--blue); border-radius: 2px;
  transition: width 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
}
.proofread-fill { background: var(--orange); }
.apply-fill { background: var(--green); }
.progress-label { font-size: 11px; color: var(--gray-400); font-weight: 500; min-width: 28px; text-align: right; }

/* ---- 面板 ---- */
.section {
  background: #fff; border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm); overflow: hidden;
}
.app.dark .section { background: var(--gray-100); }
.section-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; cursor: pointer; user-select: none;
  font-size: 13px; font-weight: 600;
  transition: background var(--transition);
}
.section-header:hover { background: rgba(0,0,0,0.02); }
.section-count {
  font-size: 11px; color: var(--gray-400); background: var(--gray-50);
  padding: 1px 7px; border-radius: 10px; font-weight: 500; margin-left: auto;
}
.app.dark .section-count { background: var(--gray-200); }
.chevron {
  color: var(--gray-400); flex-shrink: 0;
  transition: transform var(--transition);
}
.chevron.open { transform: rotate(90deg); }
.section-body { padding: 0 14px 12px 14px; }

/* ---- 空状态 ---- */
.empty-state { text-align: center; padding: 28px 0; color: var(--gray-400); }
.empty-icon { font-size: 32px; margin-bottom: 8px; opacity: 0.3; }
.empty-state p { font-size: 13px; line-height: 1.6; }
.empty-sub { font-size: 12px !important; opacity: 0.6; }

/* ---- 文本项 ---- */
.text-item {
  border: 1px solid var(--gray-100); border-radius: var(--radius);
  padding: 10px; margin-bottom: 8px;
  transition: all var(--transition);
}
.text-item:hover { box-shadow: var(--shadow-sm); }
.app.dark .text-item { border-color: var(--gray-200); }
.item-row { display: flex; gap: 10px; }
.item-source, .item-target { flex: 1; min-width: 0; }
.item-label {
  font-size: 10px; font-weight: 600; color: var(--gray-400);
  text-transform: uppercase; letter-spacing: 0.04em;
  margin-bottom: 4px; display: flex; align-items: center; gap: 6px;
}
.merge-badge {
  font-size: 10px; background: rgba(0,122,255,0.1); color: var(--blue);
  padding: 1px 6px; border-radius: 8px; font-weight: 500;
  text-transform: none; letter-spacing: 0;
}
.app.dark .merge-badge { background: rgba(0,122,255,0.2); }
.source-box {
  font-size: 13px; padding: 8px 10px; background: var(--gray-50);
  border-radius: var(--radius-sm); word-break: break-all;
  line-height: 1.5; min-height: 44px; color: var(--gray-800);
}
.app.dark .source-box { background: var(--gray-200); }
.trans-input {
  width: 100%; padding: 8px 10px; border: 1px solid var(--gray-200); border-radius: var(--radius-sm);
  font-size: 13px; resize: none; font-family: inherit; line-height: 1.5;
  color: var(--gray-900); overflow: hidden;
  transition: border-color var(--transition), box-shadow var(--transition), height 0.15s;
}
.trans-input:focus { outline: none; border-color: var(--blue); box-shadow: 0 0 0 3px rgba(0,122,255,0.12); }
.trans-input::placeholder { color: var(--gray-200); }
.app.dark .trans-input { background: var(--gray-200); border-color: var(--gray-400); color: var(--gray-900); }

/* 校对 */
.text-item.corrected { border-color: var(--orange); background: rgba(255,149,0,0.03); }
.app.dark .text-item.corrected { background: rgba(255,149,0,0.06); }
.proof-badge {
  font-size: 10px; background: var(--orange); color: #fff;
  padding: 1px 5px; border-radius: 4px; font-weight: 600;
  text-transform: none; letter-spacing: 0;
}
.trans-input.proofread { border-color: var(--orange); }
.trans-input.proofread:focus { box-shadow: 0 0 0 3px rgba(255,149,0,0.12); }
.proof-hint {
  font-size: 11px; color: var(--orange); margin-top: 4px;
  padding: 4px 8px; background: rgba(255,149,0,0.07); border-radius: 6px; word-break: break-all;
  display: flex; align-items: flex-start; gap: 6px; justify-content: space-between;
}
/* CSV 导入变更 */
.text-item.csv-changed { border-color: #8B5CF6; background: rgba(139,92,246,0.03); }
.app.dark .text-item.csv-changed { background: rgba(139,92,246,0.08); }
.csv-badge {
  font-size: 10px; background: #8B5CF6; color: #fff;
  padding: 1px 5px; border-radius: 4px; font-weight: 600;
  text-transform: none; letter-spacing: 0;
}

/* 翻译失败条目 */
.text-item.trans-error { border-color: var(--red); background: rgba(255,59,48,0.03); }
.app.dark .text-item.trans-error { background: rgba(255,59,48,0.08); }
.error-badge {
  font-size: 10px; background: var(--red); color: #fff;
  padding: 1px 5px; border-radius: 4px; font-weight: 600;
  text-transform: none; letter-spacing: 0;
}

.proof-hint-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.proof-reason {
  font-size: 10px; color: #c77d00; font-weight: 400;
  background: rgba(255,149,0,0.1); padding: 1px 6px; border-radius: 3px;
  display: inline-block; align-self: flex-start;
}
.proof-original {
  font-size: 11px; color: var(--gray-400); word-break: break-all;
  padding: 2px 0; line-height: 1.4;
}
.btn-revert-proof {
  flex-shrink: 0; padding: 3px 8px; border: 1px solid var(--gray-200); border-radius: 4px;
  background: transparent; color: var(--gray-400); font-size: 11px; font-weight: 500;
  cursor: pointer; font-family: inherit; white-space: nowrap;
  transition: all var(--transition);
}
.btn-revert-proof:hover { border-color: var(--orange); color: var(--orange); }

/* ---- 字体映射 ---- */
.field-hint { font-size: 11px; color: var(--gray-400); padding: 0 0 8px; }

.font-card {
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 0;
  margin-bottom: 8px;
  background: #fff;
  border-radius: var(--radius);
  border: 1px solid var(--gray-100);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}
.app.dark .font-card { background: var(--gray-100); border-color: var(--gray-400); }

.font-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}
.font-col-source {
  flex: 1;
  min-width: 0;
  background: var(--gray-50);
  border-right: 1px solid var(--gray-100);
}
.app.dark .font-col-source { background: rgba(0,0,0,0.15); border-color: var(--gray-200); }
.font-col-target { flex: 1.15; min-width: 0; }

.font-col-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--gray-400);
}
.font-col-target .font-col-label { color: var(--blue); }

.font-arrow-col {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 2px;
  color: var(--gray-200);
  flex-shrink: 0;
  background: #fff;
}
.app.dark .font-arrow-col { background: var(--gray-100); }

.font-preview {
  padding: 10px 12px;
  background: #fff;
  border-radius: var(--radius-sm);
  border: 1px solid var(--gray-100);
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 42px;
  justify-content: center;
}
.app.dark .font-preview { background: var(--gray-200); border-color: var(--gray-400); }
.font-preview-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--gray-900);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.font-preview-style {
  font-size: 11px;
  color: var(--gray-400);
  font-weight: 500;
}

.font-attrs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px 8px;
}
.font-attr {
  display: flex;
  align-items: baseline;
  gap: 2px;
  padding: 2px 0;
}
.font-attr-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--gray-800);
}
.app.dark .font-attr-val { color: var(--gray-900); }
.font-attr-unit {
  font-size: 10px;
  color: var(--gray-400);
  font-weight: 400;
}
.font-attr-label {
  font-size: 10px;
  color: var(--gray-400);
  margin-left: 4px;
  font-weight: 400;
}

.font-attr-input {
  width: 48px;
  padding: 4px 6px;
  border: 1px solid var(--gray-200);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  color: var(--gray-800);
  background: #fff;
  text-align: center;
  transition: border-color var(--transition), box-shadow var(--transition);
}
.font-attr-input:focus { outline: none; border-color: var(--blue); box-shadow: 0 0 0 3px rgba(0,122,255,0.12); }
.font-attr-input::placeholder { color: var(--gray-200); font-weight: 400; font-size: 10px; }
.app.dark .font-attr-input { background: var(--gray-200); border-color: var(--gray-400); color: var(--gray-900); }

.font-attr-select {
  padding: 4px 4px;
  border: 1px solid var(--gray-200);
  border-radius: 6px;
  font-size: 11px;
  font-family: inherit;
  color: var(--gray-800);
  background: #fff;
  cursor: pointer;
  transition: border-color var(--transition);
}
.font-attr-select:focus { outline: none; border-color: var(--blue); }
.app.dark .font-attr-select { background: var(--gray-200); border-color: var(--gray-400); color: var(--gray-900); }

.font-search-input {
  padding: 6px 10px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: inherit;
  color: var(--gray-900);
  background: var(--gray-50);
  transition: background var(--transition);
}
.font-search-input:focus { outline: none; background: #fff; box-shadow: 0 0 0 3px rgba(0,122,255,0.12); }
.font-search-input::placeholder { color: var(--gray-400); font-size: 12px; }
.app.dark .font-search-input { background: var(--gray-200); color: var(--gray-900); }
.app.dark .font-search-input:focus { background: var(--gray-100); }

.font-family-select {
  padding: 7px 10px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: inherit;
  color: var(--gray-900);
  background: #fff;
  cursor: pointer;
  transition: border-color var(--transition);
}
.font-family-select:focus { outline: none; border-color: var(--blue); }
.app.dark .font-family-select { background: var(--gray-200); border-color: var(--gray-400); }
.field { width: 100%; padding: 7px 10px; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); font-size: 13px; font-family: inherit; color: var(--gray-900); background: #fff; transition: border-color var(--transition); }
.field:focus { outline: none; border-color: var(--blue); }
.field::placeholder { color: var(--gray-200); }
.app.dark .field { background: var(--gray-200); border-color: var(--gray-400); }
.field-sm { flex: 1; min-width: 80px; padding: 5px 8px; font-size: 12px; }
.field-xs { flex: 0.8; min-width: 50px; padding: 5px 8px; font-size: 12px; }

/* ---- 内联操作 ---- */
.inline-actions { display: flex; gap: 6px; padding: 4px 0; flex-wrap: wrap; }
.btn-row { display: flex; gap: 8px; margin-top: 4px; }

/* ---- 测试结果 ---- */
.test-result {
  display: flex; align-items: center; gap: 8px; margin-top: 10px;
  padding: 10px 12px; border-radius: var(--radius-sm); font-size: 13px; line-height: 1.5;
}
.test-result.success { background: rgba(52,199,89,0.1); color: var(--green); }
.test-result.fail { background: rgba(255,59,48,0.1); color: var(--red); }
.test-icon { font-size: 16px; font-weight: 700; flex-shrink: 0; }

/* ---- 表单 ---- */
.field-group { margin-bottom: 10px; }
.field-label { display: block; font-size: 11px; font-weight: 600; color: var(--gray-400); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 4px; }
textarea.field { resize: vertical; }
.preset-row { margin-bottom: 6px; }
.preset-select {
  color: var(--blue); font-weight: 500; cursor: pointer;
  font-size: 12px; padding: 5px 8px;
}
.preset-select option { color: var(--gray-900); font-weight: 400; }

/* ---- 校对模型 ---- */
.proof-section-label {
  font-size: 11px; font-weight: 600; color: var(--orange);
  text-transform: uppercase; letter-spacing: 0.03em;
  padding: 6px 0 4px; border-top: 1px solid rgba(255,149,0,0.15);
  margin-top: 4px;
}

/* ---- Toggle 开关 ---- */
.toggle-label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--gray-800); }
.toggle {
  width: 40px; height: 24px; background: var(--gray-200); border-radius: 12px;
  position: relative; transition: background var(--transition); flex-shrink: 0;
}
.toggle.on { background: var(--green); }
.toggle-knob {
  position: absolute; top: 2px; left: 2px;
  width: 20px; height: 20px; background: #fff; border-radius: 50%;
  transition: transform var(--transition); box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
.toggle.on .toggle-knob { transform: translateX(16px); }

/* ---- 术语库 ---- */
.glossary-list { display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; }
.glossary-card { padding: 8px 10px; border: 1px solid var(--gray-100); border-radius: var(--radius-sm); transition: border-color var(--transition); }
.glossary-card:hover { border-color: var(--gray-200); }
.app.dark .glossary-card { border-color: var(--gray-200); }
.gc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.gc-source { font-size: 13px; font-weight: 500; color: var(--blue); }
.gc-tags { display: flex; flex-wrap: wrap; gap: 3px; }
.gc-tag { font-size: 11px; padding: 1px 6px; background: var(--gray-50); border-radius: 4px; color: var(--gray-600); }
.gc-tag b { color: var(--gray-400); font-weight: 500; }
.app.dark .gc-tag { background: var(--gray-200); }
.btn-del {
  background: none; border: none; color: var(--gray-400); cursor: pointer;
  padding: 2px; border-radius: 4px; display: flex; transition: all var(--transition);
}
.btn-del:hover { color: var(--red); background: rgba(255,59,48,0.08); }

/* ---- Toast ---- */
.toast {
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
  padding: 10px 20px; border-radius: 20px; font-size: 13px; font-weight: 500;
  z-index: 100; pointer-events: none;
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  box-shadow: var(--shadow);
}
.toast.info { background: rgba(0,0,0,0.8); color: #fff; }
.toast.success { background: rgba(52,199,89,0.9); color: #fff; }
.toast.error { background: rgba(255,59,48,0.9); color: #fff; }
.app.dark .toast.info { background: rgba(255,255,255,0.15); }

.fade-enter-active { transition: opacity 0.3s, transform 0.3s; }
.fade-leave-active { transition: opacity 0.2s, transform 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

/* ---- 滚动条 ---- */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--gray-200); border-radius: 2px; }
.app.dark ::-webkit-scrollbar-thumb { background: var(--gray-400); }

.footer { text-align: center; padding: 12px 0 4px; font-size: 11px; color: var(--gray-200); letter-spacing: 0.5px; }
.app.dark .footer { color: var(--gray-400); }
</style>
