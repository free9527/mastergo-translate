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
      <!-- 翻译范围 -->
      <div class="field-label">翻译范围</div>
      <div class="toolbar-row">
        <button class="btn btn-primary flex-1" @click="scanAll" :disabled="scanning">
          {{ scanning ? '扫描中...' : '当前页扫描' }}
        </button>
        <button class="btn btn-secondary flex-1" @click="scanSelection" :disabled="scanning">
          选中内容扫描
        </button>
      </div>
      <!-- 语言选择 -->
      <div class="lang-row">
        <div class="lang-col">
          <div class="field-label">源语言</div>
          <select v-model="sourceLang" class="lang-select">
            <option value="auto">自动检测</option>
            <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.name }}</option>
          </select>
        </div>
        <div class="lang-arrow">
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 8h10M11 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="lang-col">
          <div class="field-label">目标语言</div>
          <select v-model="targetLang" class="lang-select">
            <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.name }}</option>
          </select>
        </div>
      </div>

      <!-- 统计 -->
      <div class="stats-row" v-if="items.length > 0">
        <div class="stat-item">
          <span class="stat-value">{{ items.length }}</span>
          <span class="stat-label">文本数</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <span class="stat-value">{{ charCount }}</span>
          <span class="stat-label">字符数</span>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="toolbar-row">
        <button class="btn btn-accent flex-1" @click="startTranslate" :disabled="translating || proofreading || items.length === 0">
          {{ translating ? `翻译中 ${Math.floor(translateProgressPercent)}%...` : '翻译' }}
        </button>
        <button class="btn btn-primary flex-1" @click="applyTranslations" :disabled="applying || translating || proofreading || !hasTranslation">
          {{ applying ? `应用 ${Math.floor(applyingProgressPercent)}%...` : '应用' }}
        </button>
        <button v-if="translating || proofreading" class="btn btn-warning flex-1" @click="cancelOperation">
          取消
        </button>
        <button v-else class="btn btn-ghost flex-1" @click="undoAll" :disabled="undoing || applying">
          撤销
        </button>
      </div>
      <div class="toolbar-row" v-if="translateErrors.size > 0">
        <button class="btn btn-warning flex-1" @click="retryFailedTranslations" :disabled="applying || translating || proofreading">
          重翻失败 ({{ translateErrors.size }})
        </button>
      </div>
      <div class="toolbar-row" v-if="failedNodeIds.length > 0">
        <button class="btn btn-secondary flex-1" @click="retryFailedApply" :disabled="applying || translating || proofreading">
          重试应用 ({{ failedNodeIds.length }})
        </button>
      </div>
    </div>

    <!-- 翻译风格 & 场景 -->
    <div class="style-bar">
      <div class="style-row">
        <div class="style-field">
          <label class="field-label">翻译风格</label>
          <select class="style-select" v-model="selectedPreset" @change="applyPreset" :disabled="isStyleLocked">
            <option value="custom">自定义</option>
            <option value="standard">通用标准版</option>
            <option value="professional">{{ isStyleLocked ? '严谨专业版（场景锁定）' : '严谨专业版' }}</option>
            <option value="marketing" v-if="!isStyleLocked">电商营销版</option>
          </select>
        </div>
        <div class="style-field">
          <label class="field-label">场景</label>
          <select class="style-select" v-model="llmConfig.scenePreset" @change="onSceneChange">
            <option value="ecommerce">电商详情页</option>
            <option value="technical_params">技术参数表</option>
            <option value="packaging">包装印刷</option>
            <option value="ui">软件UI</option>
            <option value="after_sales">售后/保修卡</option>
          </select>
        </div>
        <div class="style-field">
          <label class="field-label">产品线</label>
          <select class="style-select" v-model="manualProductLine" @change="onProductLineChange">
            <option v-for="opt in productLineOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <span v-if="effectiveProductLine && manualProductLine === ''" class="auto-badge">自动</span>
          <span v-if="manualProductLine !== ''" class="manual-badge">手动</span>
        </div>
      </div>
      <textarea
        v-if="selectedPreset === 'custom'"
        class="style-textarea"
        v-model="llmConfig.translationStyleCustom"
        rows="3"
        placeholder="自定义翻译风格，如：语气轻松活泼，适合年轻用户..."
      ></textarea>
      <div v-if="selectedPreset === 'custom'" class="style-ref-toggle" @click="showRef = !showRef">
        <svg class="chevron" :class="{ open: showRef }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span>参考格式（点击展开）</span>
      </div>
      <textarea
        v-if="selectedPreset === 'custom' && showRef"
        class="style-prompt"
        :value="styleReference"
        readonly
        rows="8"
      ></textarea>
      <textarea
        v-if="selectedPreset !== 'custom'"
        class="style-prompt"
        :value="currentStylePrompt"
        readonly
        rows="10"
      ></textarea>
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
          <p>点击"当前页扫描"采集文本</p>
          <p class="empty-sub">或先选中图层后点击"选中内容扫描"</p>
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
        <span class="section-count">{{ glossaryProducts.length + glossaryExclusive.length }}</span>
      </div>
      <div class="section-body" v-if="showGlossary">
        <!-- 产品名术语库 -->
        <div class="glossary-sub">
          <div class="glossary-sub-head">
            <span class="glossary-sub-title">产品名</span>
            <span class="glossary-sub-count">{{ glossaryProducts.length }} 条</span>
          </div>
          <div class="inline-actions">
            <button class="btn btn-sm btn-secondary" @click="downloadGlossaryProducts">下载</button>
            <button class="btn btn-sm btn-secondary" @click="triggerGlossaryProductsUpload">替换</button>
            <input ref="glossaryProductsInput" type="file" accept=".csv" style="display:none" @change="handleGlossaryProductsUpload" />
          </div>
          <p class="glossary-hint">上传将完全替换现有产品名术语库，而非合并。</p>
        </div>
        <!-- 专属术语术语库 -->
        <div class="glossary-sub">
          <div class="glossary-sub-head">
            <span class="glossary-sub-title">专属术语</span>
            <span class="glossary-sub-count">{{ glossaryExclusive.length }} 条</span>
          </div>
          <div class="inline-actions">
            <button class="btn btn-sm btn-secondary" @click="downloadGlossaryExclusive">下载</button>
            <button class="btn btn-sm btn-secondary" @click="triggerGlossaryExclusiveUpload">替换</button>
            <input ref="glossaryExclusiveInput" type="file" accept=".csv" style="display:none" @change="handleGlossaryExclusiveUpload" />
          </div>
          <p class="glossary-hint">上传将完全替换现有专属术语术语库，而非合并。</p>
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
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { UIMessage, PluginMessage, TextItem, LLMConfig, GlossaryEntry, TranslationCorrection, LANGUAGES, TestConnectionResult } from '@messages/types'
import { sendMsgToPlugin } from '@messages/ui-sender'
import { parseCSVRow, csvEncodeCell } from '@lib/parse-csv'
import { formatCJKSpace } from '@lib/format-text'
import { postProcessTranslation, restoreTrademarkSymbols, restoreStorageUnitFormatting, enforceGlossaryTerms } from '@lib/post-process'
import { translateBatch, proofreadBatch, fetchWithRetry, isProofreadScriptMismatch, STYLE_PRESETS, SCENE_PRESETS, detectProductLine } from '@lib/llm-api'
import { DEFAULT_GLOSSARY_PRODUCTS_CSV, DEFAULT_GLOSSARY_EXCLUSIVE_CSV } from '@lib/default-glossary'
import { TRANSLATE_BATCH_SIZE, PROOFREAD_BATCH_SIZE, TOAST_DURATION_MS, CORRECTION_THRESHOLD, makeFontKey, parseFontKey, normalizeText } from '@lib/constants'
import { convertStorageUnit } from '@lib/unit-convert'

// ============================================================
// 响应式状态
// ============================================================
const items = ref<TextItem[]>([])
const targetLang = ref('en')
const sourceLang = ref('auto')
const glossaryProducts = ref<GlossaryEntry[]>([])
const glossaryExclusive = ref<GlossaryEntry[]>([])
const glossary = computed(() => [...glossaryProducts.value, ...glossaryExclusive.value])
const translationCache = ref<Record<string, string>>({})
const llmConfig = ref<LLMConfig>({ apiKey: '', apiUrl: '', model: 'gpt-4o', translationStyle: 'standard', translationStyleCustom: '', scenePreset: 'ecommerce', enableProofread: false, proofreadApiKey: '', proofreadApiUrl: '', proofreadModel: '' })

const scanning = ref(false)
const pageName = ref('')
const fileName = ref('')
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

const charCount = computed(() => {
  let count = 0
  for (const item of items.value) {
    count += item.sourceText.length
  }
  return count
})

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
// ============================================================
// 相同源文本强制一致
// ============================================================
function enforceSameSourceConsistency() {
  const seen = new Map<string, string>()
  let unified = 0
  for (const item of items.value) {
    if (!item.translatedText) continue
    const key = normalizeText(item.sourceText)
    if (!key) continue
    if (seen.has(key)) {
      const first = seen.get(key)!
      if (item.translatedText !== first) {
        item.translatedText = first
        unified++
      }
    } else {
      seen.set(key, item.translatedText)
    }
  }
  if (unified > 0) {
    console.log('[translate] 一致化: ' + unified + ' 条相同源文本的译文被统一')
  }
}

// 取消操作
// ============================================================
function cancelOperation() {
  cancelFlag.value = true
  showToast('正在取消...', 'warning')
}

// ============================================================
// 翻译
// ============================================================
// 跨批次术语一致性辅助
// ============================================================

/** 扫描全页文本，找出在术语库中出现 2 次以上的高频术语 */
function findHighFreqGlossaryTerms(
  allTexts: string[],
  glossaryMap: Map<string, string>,
): string[] {
  const wordCounts = new Map<string, number>()
  for (const text of allTexts) {
    const words = text.toLowerCase().split(/[\s,.;:!?()\[\]{}<>]+/)
    for (const w of words) {
      if (w.length < 3) continue
      wordCounts.set(w, (wordCounts.get(w) || 0) + 1)
    }
  }
  const result: string[] = []
  for (const [word, count] of wordCounts) {
    if (count >= 2 && glossaryMap.has(word)) {
      result.push(word)
    }
  }
  return result
}

/** 从多个候选译文中选出最佳译文 */
function pickBestTranslation(translations: string[], glossaryTarget: string): string {
  // 1. 与术语库完全匹配的优先
  const exact = translations.find(t => t === glossaryTarget)
  if (exact) return exact

  // 2. 较长的译文通常信息更完整
  const avgLen = translations.reduce((s, t) => s + t.length, 0) / translations.length
  const reasonable = translations.filter(t => t.length >= avgLen * 0.5)
  reasonable.sort((a, b) => b.length - a.length)

  // 3. 排除空/单字译文
  const valid = reasonable.filter(t => t.length > 1)
  return valid.length > 0 ? valid[0] : translations[0]
}

/** 跨批次术语统一：同一术语在不同文本中出现多种译法时，统一为最佳译法 */
function unifyTerminologyAcrossBatches(
  items: TextItem[],
  glossaryMap: Map<string, string>,
): number {
  // 收集每个术语源文本对应的所有译文变体
  const termVariants = new Map<string, string[]>()
  for (const item of items) {
    if (!item.translatedText) continue
    const normSource = normalizeText(item.sourceText)
    for (const [glossSource, glossTarget] of glossaryMap) {
      const normGloss = normalizeText(glossSource)
      if (normSource.includes(normGloss) && normGloss.length >= 4) {
        const existing = termVariants.get(glossSource)
        if (existing) {
          if (!existing.includes(item.translatedText)) {
            existing.push(item.translatedText)
          }
        } else {
          termVariants.set(glossSource, [item.translatedText])
        }
      }
    }
  }

  // 对每个有多种译法的术语，选出最佳译文并统一
  let changed = 0
  for (const [term, variants] of termVariants) {
    if (variants.length <= 1) continue
    const best = pickBestTranslation(variants, glossaryMap.get(term) || '')
    for (const item of items) {
      if (item.translatedText && variants.includes(item.translatedText) && item.translatedText !== best) {
        item.translatedText = best
        changed++
      }
    }
  }
  if (changed > 0) {
    console.log('[translate] 跨批次术语统一: ' + changed + ' 条译文被统一为最佳译法')
  }
  return changed
}

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
    const runtimeProductLines: Record<string, string> = {}
    const runtimeTermTypes: Record<string, string> = {}
    for (const g of glossary.value) {
      const t = g.translations[targetLang.value]
      if (t) glossaryMap.set(g.source, t)
      if (g.productLine) runtimeProductLines[g.source] = g.productLine
      if (g.termType) runtimeTermTypes[g.source] = g.termType
    }

  // 跨批次术语预扫描：找出全页高频术语，提前注入每个批次确保译文一致
  const allSourceTexts = items.value.map(it => it.sourceText)
  const crossBatchTerms = findHighFreqGlossaryTerms(allSourceTexts, glossaryMap)

  const toTranslate = items.value.filter(it => it.sourceText.trim())
  const total = toTranslate.length

  if (total === 0) {
    translating.value = false
    showToast('没有待翻译的文本', 'info')
    return
  }

  // 纯数字、单字符、纯存储规格文本直接沿用/本地转换，不请求 API
  let autoSkipped = 0
  for (const item of toTranslate) {
    const trimmed = item.sourceText.trim()
    if (/^\d+(\.\d+)?$/.test(trimmed) || (trimmed.length === 1 && !/[一-鿿぀-ヿ가-힯]/.test(trimmed))) {
      item.translatedText = trimmed
      autoSkipped++
    } else {
      // 检测纯存储规格（如 128GB、256MB/s），本地做单位转换
      const unitConverted = convertStorageUnit(trimmed, targetLang.value)
      if (unitConverted !== trimmed) {
        item.translatedText = unitConverted
        autoSkipped++
      }
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
  // 术语库hash：术语库更新后缓存自动失效
  const glossaryHash = glossary.value.map(g => g.source + '|' + (g.translations[targetLang.value] || '')).join(',').slice(0, 200).split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0).toString(36)
  const cacheKey = (text: string) => normalizeText(text) + '\x00' + targetLang.value + '\x00' + glossaryHash
  let cacheHits = 0
  let failedBatches = 0
  const lastErrors: string[] = []

  let cursor = autoSkipped
  translateProgress.value = { current: cursor, total }

  // 并发批次处理：每次并发 CONCURRENCY 个批次，大幅提速
  const CONCURRENCY = 3
  for (let i = 0; i < apiTotal; i += TRANSLATE_BATCH_SIZE * CONCURRENCY) {
    if (cancelFlag.value) break

    const concurrentBatchPromises: Promise<void>[] = []

    for (let k = 0; k < CONCURRENCY; k++) {
      const batchStart = i + k * TRANSLATE_BATCH_SIZE
      if (batchStart >= apiTotal || cancelFlag.value) break
      const batch = needApi.slice(batchStart, batchStart + TRANSLATE_BATCH_SIZE)

      concurrentBatchPromises.push((async () => {
        if (cancelFlag.value) return
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
            const apiResult = await translateBatch(uncachedTexts, targetLang.value, glossaryMap, llmConfig.value, sourceLang.value === 'auto' ? undefined : sourceLang.value, items.value.map(it => it.sourceText), runtimeProductLines, runtimeTermTypes, pageName.value || undefined, fileName.value || undefined, crossBatchTerms)
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
          }
        } catch (e) {
          failedBatches++
          lastErrors.push(e instanceof Error ? e.message : String(e))
          for (const item of batch) {
            translateErrors.value.add(item.nodeIds[0])
          }
          console.error('[translate] batch failed', batchStart, lastErrors[lastErrors.length - 1])
        }
      })())
    }

    await Promise.allSettled(concurrentBatchPromises)
    // 每轮并发结束后更新进度
    const processedSoFar = toTranslate.filter(it => it.translatedText || translateErrors.value.has(it.nodeIds[0])).length
    translateProgress.value = { current: processedSoFar, total }
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
    const errDetail = lastErrors.length > 0 ? ' — ' + lastErrors[lastErrors.length - 1].slice(0, 80) : ''
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

  // 跨批次术语统一：从同一术语的多个候选译文中选择最佳译法
  unifyTerminologyAcrossBatches(items.value, glossaryMap)
  // 同源一致化：无论是否开启校对都执行，确保相同源文本译文一致
  enforceSameSourceConsistency()
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

  // 提前构建 glossaryMap，供校对后 enforceGlossaryTerms 兜底使用
  const glossaryMap = new Map<string, string>()
  const runtimeProductLines: Record<string, string> = {}
  for (const g of glossary.value) {
    const t = g.translations[targetLang.value]
    if (t) glossaryMap.set(g.source, t)
    if (g.productLine) runtimeProductLines[g.source] = g.productLine
  }

  try {
    let correctedCount = 0
    let failedBatches = 0
    let proofLastError = ''

    // 并发校对：大幅提速
    const P_CONCURRENCY = 3
    for (let i = 0; i < total; i += PROOFREAD_BATCH_SIZE * P_CONCURRENCY) {
      if (cancelFlag.value) break

      const concurrentBatchPromises: Promise<void>[] = []

      for (let k = 0; k < P_CONCURRENCY; k++) {
        const batchStart = i + k * PROOFREAD_BATCH_SIZE
        if (batchStart >= total || cancelFlag.value) break
        const batch = toCheck.slice(batchStart, batchStart + PROOFREAD_BATCH_SIZE)

        concurrentBatchPromises.push((async () => {
          if (cancelFlag.value) return
          try {
            const batchResults = await proofreadBatch(
              batch.map(it => ({ sourceText: it.sourceText, translatedText: it.translatedText })),
              targetLang.value,
              glossaryMap,
              llmConfig.value,
              runtimeProductLines,
              undefined,
              pageName.value || undefined,
              fileName.value || undefined,
            )
            for (let j = 0; j < batch.length; j++) {
              const proofed = batchResults[j]
              if (proofed.text && proofed.text !== 'OK' && proofed.text !== batch[j].translatedText) {
                if (isProofreadScriptMismatch(proofed.text, targetLang.value)) {
                  console.warn('[translate] proofread script mismatch, rejected:', proofed.text)
                  continue
                }
                let fixed = postProcessTranslation(proofed.text, targetLang.value)
                fixed = formatCJKSpace(fixed, targetLang.value)
                if (fixed === batch[j].translatedText) continue
                batch[j].proofreadText = batch[j].translatedText
                batch[j].translatedText = fixed
                batch[j].proofreadReason = (proofed.reason || '').slice(0, 40)
                batch[j].corrected = true
                correctedCount++
              }
            }
          } catch (e) {
            failedBatches++
            proofLastError = e instanceof Error ? e.message : String(e)
            console.error('[translate] proofread batch failed', batchStart, proofLastError)
          }
        })())
      }

      await Promise.allSettled(concurrentBatchPromises)
      const doneSoFar = toCheck.filter(it => it.corrected || (it.translatedText && !it.proofreadText)).length + toCheck.filter(it => !it.translatedText).length
      proofreadProgress.value = { current: toCheck.filter(it => it.corrected || it.translatedText).length, total }
    }

    proofreading.value = false
    resizeAllTextareas()

    // 校对后兜底：术语库强制校准 → 语言后处理 → CJK格式 → 商标符号还原
    // 注意：首字母大写翻译管道已处理，校对后不重复执行
    const allSourceTexts = items.value.map(it => it.sourceText)
    let allTranslatedTexts = items.value.map(it => it.translatedText)
    allTranslatedTexts = enforceGlossaryTerms(allSourceTexts, allTranslatedTexts, glossaryMap)
    allTranslatedTexts = allTranslatedTexts.map(t => postProcessTranslation(t, targetLang.value))
    allTranslatedTexts = allTranslatedTexts.map(t => formatCJKSpace(t, targetLang.value))
    allTranslatedTexts = restoreStorageUnitFormatting(allSourceTexts, allTranslatedTexts)
    allTranslatedTexts = restoreTrademarkSymbols(allSourceTexts, allTranslatedTexts)
    for (let i = 0; i < items.value.length; i++) {
      if (allTranslatedTexts[i] !== items.value[i].translatedText) {
        items.value[i].translatedText = allTranslatedTexts[i]
      }
    }

    enforceSameSourceConsistency()
    if (cancelFlag.value) {
      showToast(`校对已取消，已修正 ${correctedCount} 处`, 'warning')
      return
    }
    const totalBatches = Math.ceil(total / PROOFREAD_BATCH_SIZE)
    if (correctedCount === 0 && failedBatches >= totalBatches && failedBatches > 0) {
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

function retryFailedApply() {
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

// 重试翻译失败的条目（不清除已成功的，只翻失败的）
async function retryFailedTranslations() {
  if (translateErrors.value.size === 0) return
  if (translating.value || proofreading.value) {
    showToast('翻译或校对进行中，请稍后再试', 'warning')
    return
  }
  const errorSet = new Set(translateErrors.value)
  const failedItems = items.value.filter(it => it.nodeIds.some(nid => errorSet.has(nid)))
  if (failedItems.length === 0) return

  // 清除之前的翻译结果和错误标记
  for (const item of failedItems) {
    item.translatedText = ''
    for (const nid of item.nodeIds) {
      translateErrors.value.delete(nid)
    }
  }

  // 构建术语库并调用翻译
  const glossaryMap = new Map<string, string>()
  const runtimeProductLines: Record<string, string> = {}
  const runtimeTermTypes: Record<string, string> = {}
  for (const g of glossary.value) {
    const t = g.translations[targetLang.value]
    if (t) glossaryMap.set(g.source, t)
    if (g.productLine) runtimeProductLines[g.source] = g.productLine
    if (g.termType) runtimeTermTypes[g.source] = g.termType
  }

  const crossBatchTerms = findHighFreqGlossaryTerms(
    items.value.map(it => it.sourceText), glossaryMap,
  )

  translating.value = true
  cancelFlag.value = false
  translateProgress.value = { current: 0, total: failedItems.length }

  // 分批处理失败项
  for (let i = 0; i < failedItems.length; i += TRANSLATE_BATCH_SIZE) {
    if (cancelFlag.value) break
    const batch = failedItems.slice(i, i + TRANSLATE_BATCH_SIZE)
    const texts = batch.map(it => it.sourceText)

    try {
      const apiResult = await translateBatch(
        texts, targetLang.value, glossaryMap, llmConfig.value,
        sourceLang.value === 'auto' ? undefined : sourceLang.value,
        items.value.map(it => it.sourceText),
        runtimeProductLines, runtimeTermTypes,
        pageName.value || undefined, fileName.value || undefined,
        crossBatchTerms,
      )
      for (let j = 0; j < batch.length; j++) {
        batch[j].translatedText = formatCJKSpace(apiResult[j] || '', targetLang.value)
      }
    } catch (e) {
      for (const item of batch) {
        translateErrors.value.add(item.nodeIds[0])
      }
      console.error('[translate] retry batch failed', e)
    }
    translateProgress.value = { current: Math.min(i + TRANSLATE_BATCH_SIZE, failedItems.length), total: failedItems.length }
  }

  translating.value = false
  resizeAllTextareas()
  enforceSameSourceConsistency()

  const succeeded = failedItems.filter(it => it.translatedText && !translateErrors.value.has(it.nodeIds[0])).length
  const stillFailed = translateErrors.value.size
  if (succeeded > 0 && stillFailed === 0) {
    showToast(`重翻成功 ${succeeded} 条`, 'success')
  } else if (succeeded > 0) {
    showToast(`重翻完成：${succeeded} 条成功，${stillFailed} 条仍失败`, 'warning')
  } else {
    showToast('重翻全部失败，请检查 API 配置', 'error')
  }
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

// 已知的有效语言代码（与 LANGUAGES 常量保持一致）
const VALID_LANG_CODES = new Set(LANGUAGES.map(l => l.code))

function parseGlossaryCSV(text: string): GlossaryEntry[] {
  const rows = text.replace(/^﻿/, '').trim().split('\n')
  const headerCells = parseCSVRow(rows[0])
  // 检测「术语类型」「产品线」列
  const termTypeIdx = headerCells.findIndex((h: string) => h.trim() === '术语类型')
  const productLineIdx = headerCells.findIndex((h: string) => h.trim() === '产品线')
  const skippedCols = new Set([termTypeIdx, productLineIdx].filter(i => i >= 0))
  const langCols: string[] = []
  const dataCols: number[] = []  // 实际在 CSV 行中的列索引
  for (let i = 1; i < headerCells.length; i++) {
    if (skippedCols.has(i)) continue
    const colName = headerCells[i].trim()
    if (VALID_LANG_CODES.has(colName)) {
      dataCols.push(i)
      langCols.push(colName)
    }
  }
  const entries: GlossaryEntry[] = []
  for (let i = 1; i < rows.length; i++) {
    const cells = parseCSVRow(rows[i])
    const source = (cells[0] || '').trim()
    if (!source) continue
    const translations: Record<string, string> = {}
    for (let j = 0; j < langCols.length; j++) {
      const val = (cells[dataCols[j]] || '').trim()
      if (val) translations[langCols[j]] = val
    }
    const entry: GlossaryEntry = { source, translations }
    if (termTypeIdx >= 0 && termTypeIdx < cells.length) {
      const tt = cells[termTypeIdx].trim()
      if (tt) entry.termType = tt
    }
    if (productLineIdx >= 0 && productLineIdx < cells.length) {
      const pl = cells[productLineIdx].trim()
      if (pl) entry.productLine = pl
    }
    entries.push(entry)
  }
  return entries
}

// ---- 产品名术语库 ----
function downloadGlossaryProducts() {
  triggerDownload(DEFAULT_GLOSSARY_PRODUCTS_CSV, 'Lexar术语库_产品名.csv')
}

const glossaryProductsInput = ref<HTMLInputElement | null>(null)
function triggerGlossaryProductsUpload() {
  glossaryProductsInput.value?.click()
}

function handleGlossaryProductsUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const entries = parseGlossaryCSV(reader.result as string)
    glossaryProducts.value = entries
    saveGlossaryProducts()
    showToast(`已替换产品名术语库（${entries.length} 条）`, 'success')
  }
  reader.readAsText(file)
  glossaryProductsInput.value!.value = ''
}

// ---- 专属术语术语库 ----
function downloadGlossaryExclusive() {
  triggerDownload(DEFAULT_GLOSSARY_EXCLUSIVE_CSV, 'Lexar术语库_专属.csv')
}

const glossaryExclusiveInput = ref<HTMLInputElement | null>(null)
function triggerGlossaryExclusiveUpload() {
  glossaryExclusiveInput.value?.click()
}

function handleGlossaryExclusiveUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const entries = parseGlossaryCSV(reader.result as string)
    glossaryExclusive.value = entries
    saveGlossaryExclusive()
    showToast(`已替换专属术语术语库（${entries.length} 条）`, 'success')
  }
  reader.readAsText(file)
  glossaryExclusiveInput.value!.value = ''
}

function saveGlossaryProducts() {
  translationCache.value = {}
  sendMsgToPlugin(UIMessage.SAVE_GLOSSARY_PRODUCTS, JSON.parse(JSON.stringify(glossaryProducts.value)))
}
function saveGlossaryExclusive() {
  translationCache.value = {}
  sendMsgToPlugin(UIMessage.SAVE_GLOSSARY_EXCLUSIVE, JSON.parse(JSON.stringify(glossaryExclusive.value)))
}

// ============================================================
// 翻译风格预设
// ============================================================
const selectedPreset = ref('standard')

// 场景锁定：非电商场景强制严谨专业版
const isStyleLocked = computed(() => llmConfig.value.scenePreset !== 'ecommerce')
const previousStyle = ref('marketing')
const showRef = ref(false)

// 自动检测的产品线
const detectedProductLine = computed(() => {
  if (items.value.length === 0) return null
  return detectProductLine(items.value.map(it => it.sourceText), pageName.value || undefined, fileName.value || undefined)
})

// 手动覆盖产品线（空字符串=不覆盖, 'none'=强制关闭）
const manualProductLine = ref('')
const effectiveProductLine = computed(() => {
  if (manualProductLine.value === 'none') return null
  if (manualProductLine.value) return manualProductLine.value
  return detectedProductLine.value
})

// 产品线选项
const productLineOptions = [
  { value: '', label: '自动检测' },
  { value: 'professional_imaging', label: '专业影像' },
  { value: 'consumer_cards', label: '消费存储卡' },
  { value: 'gaming_card', label: '游戏存储卡' },
  { value: 'gaming_ssd', label: '电竞SSD' },
  { value: 'gaming_dimm', label: '电竞内存' },
  { value: 'pc_productivity', label: 'PC生产力' },
  { value: 'portable_storage', label: '移动存储' },
  { value: 'innovation_lifestyle', label: '创新生活' },
  { value: 'none', label: '不注入' },
]

const currentStylePrompt = computed(() => {
  if (selectedPreset.value === 'custom') return ''
  const effectiveStyle = isStyleLocked.value ? 'professional' : selectedPreset.value
  let content = STYLE_PRESETS[effectiveStyle] || ''

  // 拼接场景提示词
  const sceneKey = llmConfig.value.scenePreset
  if (sceneKey && SCENE_PRESETS[sceneKey]) {
    content += '\n\n' + SCENE_PRESETS[sceneKey]
  }

  // 拼接产品线策略（如有）
  if (effectiveProductLine.value) {
    const lineKey = effectiveProductLine.value
    const strategies: Record<string, string> = {
      professional_imaging: '【产品线：专业影像】受众为职业摄影师/影视团队。"高速"→8K不掉帧、连拍不卡顿。',
      consumer_cards: '【产品线：消费存储卡】受众为vlog/旅拍/家庭用户。"高速"→4K畅拍不中断。',
      gaming_card: '【产品线：游戏存储卡】受众为掌机/主机玩家。"游戏性能"→海量扩容、游戏秒下载。',
      gaming_ssd: '【产品线：电竞SSD】受众为3A玩家。"游戏性能"→3A秒加载、DirectStorage潜能释放。',
      gaming_dimm: '【产品线：电竞内存】受众为电竞发烧友。"游戏性能"→提升1% Low帧、突破超频极限。',
      pc_productivity: '【产品线：PC/AI生产力】受众为AI PC用户/创作者。"高速"→AI秒级响应、工程文件秒传。',
      portable_storage: '【产品线：移动存储】受众为商务/学生/移动创作者。"高速"→移动办公、即拍即传。',
      innovation_lifestyle: '【产品线：创新生活】受众为家庭用户。"分享"→跨越距离陪伴家人。',
    }
    if (strategies[lineKey]) {
      content += '\n\n' + strategies[lineKey]
    }
  }

  return content
})

// 自定义模式下的范文参考
const styleReference = computed(() => {
  const preset = STYLE_PRESETS['professional'] || ''
  const sceneKey = llmConfig.value.scenePreset
  const scene = sceneKey && SCENE_PRESETS[sceneKey] ? '\n\n' + SCENE_PRESETS[sceneKey] : ''
  return preset + scene
})

function detectPreset(): string {
  const style = (llmConfig.value.translationStyle || '').trim()
  if (!style) return 'standard'
  if (style === 'custom') return 'custom'
  if (style === 'standard' || style === 'professional' || style === 'marketing') return style
  // 向后兼容：如果存储的是旧预设文本，检测匹配
  if (style.includes('通用标准版') || style.includes('自然流畅')) return 'standard'
  if (style.includes('严谨专业版') || style.includes('技术文档')) return 'professional'
  if (style.includes('电商营销版') || style.includes('种草文案')) return 'marketing'
  return 'custom'
}

function applyPreset() {
  if (selectedPreset.value && selectedPreset.value !== 'custom') {
    llmConfig.value.translationStyle = selectedPreset.value
  } else {
    llmConfig.value.translationStyle = 'custom'
  }
}

function onSceneChange() {
  if (isStyleLocked.value) {
    // 切换到非电商场景：保存当前风格，锁定为严谨专业版
    previousStyle.value = selectedPreset.value
    selectedPreset.value = 'professional'
    llmConfig.value.translationStyle = 'professional'
  } else {
    // 切换回电商详情页：恢复之前的风格
    if (previousStyle.value && previousStyle.value !== 'professional') {
      selectedPreset.value = previousStyle.value
      llmConfig.value.translationStyle = previousStyle.value
    }
  }
}

function onProductLineChange() {
  llmConfig.value.manualProductLine = manualProductLine.value || undefined
}

// 初始化时同步产品线到 llmConfig
watch(manualProductLine, (val) => {
  llmConfig.value.manualProductLine = val || undefined
}, { immediate: true })

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
let glossaryProductsLoaded = false
let glossaryExclusiveLoaded = false
function checkGlossaryReady() {
  if (glossaryProductsLoaded && glossaryExclusiveLoaded) {
    glossaryReady = true
  }
}

onMounted(() => {
  // 先注册监听器，再发请求，避免任何竞态
  window.addEventListener('message', (e) => {
    const msg = e.data?.pluginMessage ?? e.data
    if (!msg?.type) return

    const { type, data } = msg

    switch (type) {
      case PluginMessage.SCAN_RESULT: {
        scanning.value = false
        // 兼容新旧格式：新格式 { items, pageName, fileName }，旧格式 TextItem[]
        const scanData = data as { items: TextItem[]; pageName?: string; fileName?: string } | TextItem[]
        if (Array.isArray(scanData)) {
          items.value = scanData
          pageName.value = ''
          fileName.value = ''
        } else {
          items.value = scanData.items
          pageName.value = scanData.pageName || ''
          fileName.value = scanData.fileName || ''
        }
        resizeAllTextareas()
        showToast(`扫描到 ${items.value.length} 个文本节点`, 'success')
        break
      }

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

      case PluginMessage.GLOSSARY_PRODUCTS_LOADED:
        glossaryProducts.value = ((data as GlossaryEntry[]) || []).map(function (g: GlossaryEntry) {
          if (g.translations) return g
          return { source: g.source, translations: (g as Record<string, unknown>).target ? { en: (g as Record<string, unknown>).target as string } : {} }
        })
        glossaryProductsLoaded = true
        checkGlossaryReady()
        break

      case PluginMessage.GLOSSARY_EXCLUSIVE_LOADED:
        glossaryExclusive.value = ((data as GlossaryEntry[]) || []).map(function (g: GlossaryEntry) {
          if (g.translations) return g
          return { source: g.source, translations: (g as Record<string, unknown>).target ? { en: (g as Record<string, unknown>).target as string } : {} }
        })
        glossaryExclusiveLoaded = true
        checkGlossaryReady()
        break

      case PluginMessage.SETTINGS_LOADED:
        if (data) {
          const raw = data as Record<string, unknown>
          // 迁移旧字段 industryContext → translationStyleCustom
          if (raw.translationStyle === undefined && raw.industryContext !== undefined) {
            raw.translationStyle = 'custom'
            raw.translationStyleCustom = raw.industryContext
          }
          if (raw.scenePreset === undefined) {
            raw.scenePreset = 'ecommerce'
          }
          llmConfig.value = { translationStyle: 'standard', translationStyleCustom: '', scenePreset: 'ecommerce', enableProofread: false, proofreadApiKey: '', proofreadApiUrl: '', proofreadModel: '', ...(raw as LLMConfig) }
        }
        selectedPreset.value = detectPreset()
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
        const existing = glossaryExclusive.value.find(g => g.source === sug.source)
        if (existing) {
          existing.translations[sug.targetLang] = sug.correctedTranslation
        } else {
          glossaryExclusive.value.push({
            source: sug.source,
            translations: { [sug.targetLang]: sug.correctedTranslation },
          })
        }
        saveGlossaryExclusive()
        showToast(`已自动将"${sug.source}"的修正加入专属术语库`, 'success')
        break
      }
    }
  })

  // 监听器注册完毕后，发送初始化请求
  sendMsgToPlugin(UIMessage.LOAD_SETTINGS)
  sendMsgToPlugin(UIMessage.LOAD_GLOSSARY_PRODUCTS)
  sendMsgToPlugin(UIMessage.LOAD_GLOSSARY_EXCLUSIVE)
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
  gap: 10px;
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
  padding: 16px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.app.dark .toolbar { background: var(--gray-100); }
.toolbar-row { display: flex; gap: 6px; align-items: center; }

/* ---- 翻译风格栏 ---- */
.style-bar {
  background: #fff;
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.app.dark .style-bar { background: var(--gray-100); }
.style-row {
  display: flex;
  gap: 12px;
}
.style-field {
  flex: 1;
  min-width: 0;
}
.style-select {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--gray-100);
  border-radius: var(--radius);
  font-size: 13px;
  background: #fff;
  color: var(--gray-800);
  cursor: pointer;
  font-family: inherit;
  transition: border-color var(--transition);
  -webkit-appearance: none;
  appearance: none;
}
.style-select:focus { outline: none; border-color: var(--blue); }
.style-select:disabled { opacity: 0.6; cursor: not-allowed; background: var(--gray-50); }
.auto-badge, .manual-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 3px; margin-left: 6px; vertical-align: middle; }
.auto-badge { color: var(--blue); background: rgba(66,133,244,0.10); }
.manual-badge { color: var(--orange, #e67e22); background: rgba(230,126,34,0.10); }
.app.dark .style-select {
  background: var(--gray-200);
  border-color: var(--gray-200);
  color: var(--gray-900);
}
.style-textarea {
  width: 100%;
  font-size: 13px;
  padding: 8px 10px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--gray-900);
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
  transition: border-color var(--transition), box-shadow var(--transition);
}
.style-textarea:focus {
  outline: none;
  border-color: var(--blue);
  box-shadow: 0 0 0 3px rgba(0,122,255,0.12);
}
.style-textarea::placeholder { color: var(--gray-200); }
.app.dark .style-textarea {
  background: var(--gray-200);
  border-color: var(--gray-400);
  color: var(--gray-900);
}
.style-prompt {
  width: 100%;
  font-size: 12px;
  padding: 10px 12px;
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-sm);
  background: var(--gray-50);
  color: var(--gray-600);
  resize: none;
  font-family: -apple-system, 'SF Pro Text', 'Helvetica Neue', Helvetica, sans-serif;
  line-height: 1.6;
  max-height: 240px;
  overflow-y: auto;
  cursor: default;
  white-space: pre-wrap;
  word-break: break-all;
}
.style-prompt:focus { outline: none; }
.style-ref-toggle {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 0; cursor: pointer; user-select: none;
  font-size: 11px; color: var(--gray-400);
  transition: color var(--transition);
}
.style-ref-toggle:hover { color: var(--blue); }
.style-ref-toggle .chevron {
  color: var(--gray-400); flex-shrink: 0;
  transition: transform var(--transition);
}
.style-ref-toggle .chevron.open { transform: rotate(90deg); }
.app.dark .style-prompt {
  background: var(--gray-200);
  border-color: var(--gray-400);
  color: var(--gray-400);
}

/* ---- 语言选择行 ---- */
.lang-row {
  display: flex; align-items: flex-end; gap: 6px;
  padding: 2px 0;
}
.lang-col { flex: 1; min-width: 0; }
.lang-arrow {
  display: flex; align-items: center; justify-content: center;
  padding-bottom: 6px; color: var(--gray-200); flex-shrink: 0;
}
.app.dark .lang-arrow { color: var(--gray-400); }

/* ---- 统计行 ---- */
.stats-row {
  display: flex; align-items: center; justify-content: center;
  gap: 14px; padding: 2px 0;
}
.stat-item {
  display: flex; align-items: baseline; gap: 4px;
}
.stat-value {
  font-size: 15px; font-weight: 600; color: var(--gray-800);
  letter-spacing: -0.02em;
}
.stat-label {
  font-size: 11px; color: var(--gray-400);
}
.stat-divider {
  width: 1px; height: 20px; background: var(--gray-100);
}
.app.dark .stat-value { color: var(--gray-900); }
.app.dark .stat-divider { background: var(--gray-200); }

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
  padding: 12px 14px; cursor: pointer; user-select: none;
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
.section-body { padding: 0 14px 14px 14px; }

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
.inline-actions { display: flex; gap: 6px; padding: 2px 0; flex-wrap: wrap; }
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
.glossary-sub { padding: 8px 0; border-bottom: 1px solid var(--gray-100); }
.glossary-sub:last-child { border-bottom: none; }
.app.dark .glossary-sub { border-color: var(--gray-200); }
.glossary-sub-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.glossary-sub-title { font-size: 13px; font-weight: 500; }
.glossary-sub-count { font-size: 11px; color: var(--gray-500); }
.app.dark .glossary-sub-count { color: var(--gray-400); }
.glossary-hint { font-size: 11px; color: var(--gray-400); margin: 4px 0 0; line-height: 1.4; }
.app.dark .glossary-hint { color: var(--gray-500); }

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

.footer { text-align: center; padding: 16px 0 4px; font-size: 11px; color: var(--gray-200); letter-spacing: 0.3px; }
.app.dark .footer { color: var(--gray-400); }
</style>
