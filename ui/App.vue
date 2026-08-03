<template>
  <div class="app" :class="{ dark: isDark }">
    <!-- ① 状态栏 -->
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

    <!-- ② 主操作区（sticky 顶部常驻） -->
    <div class="action-panel">
      <!-- 翻译范围（v9.0.3 回滚到 v8.7 版式：标签 + 蓝色描边分段按钮） -->
      <div class="field-label">扫描方式</div>
      <div class="segmented-control">
        <button
          class="seg-btn"
          :class="{ active: lastScanMode === 'all' }"
          @click="scanAll"
          :disabled="scanning"
        >{{ scanning && lastScanMode === 'all' ? scanProgressText : '当前页扫描' }}</button>
        <button
          class="seg-btn"
          :class="{ active: lastScanMode === 'selection' }"
          @click="scanSelection"
          :disabled="scanning || selectionCount === 0"
          :title="selectionCount === 0 ? '请先在画布中选中至少一个图层' : ''"
        >{{ scanning && lastScanMode === 'selection' ? scanProgressText : (selectionCount > 0 ? `选中对象扫描 (${selectionCount})` : '选中对象扫描') }}</button>
      </div>
      <div class="disabled-hint" v-if="selectionCount === 0 && !scanning">画布中未选中图层时，"选中对象扫描"不可用</div>

      <!-- 语言选择（v9.0.3 回滚：源/目标带标签分列） -->
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

      <!-- 统计 + 翻译 / 统一进度条（v9.0.3：翻译按钮加长） -->
      <div class="translate-row" v-if="!busyPhase">
        <div class="stats-info" v-if="items.length > 0">
          <span class="stat-value">{{ items.length }}</span><span class="stat-label">条</span>
          <span class="stat-divider"></span>
          <span class="stat-value">{{ charCount }}</span><span class="stat-label">字符</span>
        </div>
        <div class="stats-info stats-empty" v-else>
          <span class="stat-label">扫描后开始翻译</span>
        </div>
        <!-- v9.1 #1/#6: 未配置 API 前置提示 / 禁用原因内联 -->
        <span class="disabled-hint" v-if="!apiConfigured">⚠ 未配置大模型，点翻译前往设置</span>
        <span class="disabled-hint" v-else-if="translateDisabledReason">{{ translateDisabledReason }}</span>
        <button class="btn btn-primary btn-translate" @click="startTranslate" :disabled="translating || proofreading || items.length === 0">
          <svg class="btn-icon-svg" width="14" height="14" viewBox="0 0 16 16"><path d="M2 4l4 4-4 4M8 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          翻译
        </button>
      </div>
      <div class="progress-bar" v-else :data-phase="busyPhase">
        <div class="progress-meta">
          <span class="progress-phase">{{ busyLabel }}</span>
          <span class="progress-pct">{{ Math.floor(busyPercent) }}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: busyPercent + '%' }"></div>
        </div>
        <button
          v-if="busyPhase === 'translate' || busyPhase === 'proofread'"
          class="btn btn-xs btn-plain progress-cancel"
          @click="cancelOperation"
        >取消</button>
      </div>

      <!-- 流程终点操作（v9.1 #3：应用/字体需有译文；恢复原文常驻，可撤销性以画布快照为准） -->
      <div class="apply-row">
        <template v-if="hasTranslation">
          <button class="btn btn-accent flex-1" @click="applyTranslationsOnly" :disabled="applying || translating || proofreading || !hasTranslation || hasPendingBlockingIssue">
            <svg v-if="!applying" class="btn-icon-svg" width="14" height="14" viewBox="0 0 16 16"><path d="M3 8l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {{ hasPendingBlockingIssue ? `应用翻译 (${pendingItems.length}条待处理)` : '应用翻译' }}
          </button>
          <button class="btn btn-gray" @click="applyFonts" :disabled="applyingFonts || fontMappings.length === 0">
            <svg v-if="!applyingFonts" class="btn-icon-svg" width="14" height="14" viewBox="0 0 16 16"><path d="M4 2h8M4 6h8M4 10h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            {{ applyingFonts ? `替换中 ${Math.floor(applyingProgressPercent)}%` : '替换字体' }}
          </button>
        </template>
        <span v-else class="apply-row-spacer"></span>
        <button class="btn btn-plain" @click="undoAll" :disabled="undoing || applying || !canUndo" title="将画布上已应用的译文恢复为原文；手动改过的节点会跳过">
          {{ undoCount > 0 ? `恢复原文 (${undoCount})` : '恢复原文' }}
        </button>
      </div>
      <!-- v9.1 #5/#6: 顺序引导 / 撤销禁用原因（合并一行，不挤 apply-row） -->
      <div class="apply-hint disabled-hint" v-if="applyRowHint || undoDisabledReason">{{ applyRowHint || undoDisabledReason }}</div>

      <!-- ③ v8.9: 待处理警告条（v9.1 #7: 移入 sticky 区，阻塞操作 0 次滚动可达） -->
      <div class="pending-banner" v-if="hasPendingBlockingIssue">
        <div class="pending-header" @click="togglePendingList">
          <span class="pending-icon">⚠️</span>
          <span class="pending-text">
            {{ pendingItems.filter(p => p.type === 'error').length }} 条错误，
            {{ pendingItems.filter(p => p.type === 'placeholder').length }} 条占位符，
            {{ pendingItems.filter(p => p.type === 'untranslated').length }} 条漏翻待确认<template v-if="pendingItems.some(p => p.type === 'misspelled')">，{{ pendingItems.filter(p => p.type === 'misspelled').length }} 条疑似拼写错误</template>
          </span>
          <svg class="chevron" :class="{ open: showPendingList }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </div>
        <div class="pending-actions" v-if="showPendingList">
          <button class="btn btn-sm btn-tinted" @click="fixAllPlaceholders" :disabled="!pendingItems.some(p => p.type === 'placeholder')">
            一键修复占位符
          </button>
          <button class="btn btn-sm btn-tinted" @click="acceptAllUntranslated" :disabled="!pendingItems.some(p => p.type === 'untranslated')">
            全部接受漏翻原文
          </button>
        </div>
        <div class="pending-list" v-if="showPendingList">
          <div class="pending-item" v-for="p in pendingItems" :key="p.item.nodeIds[0]" :class="p.type">
            <div class="pending-item-source">
              <span v-if="p.type === 'misspelled'" class="misspelled-tag">疑似拼写错误，请核对源稿：</span>{{ p.item.sourceText.slice(0, 40) }}{{ p.item.sourceText.length > 40 ? '...' : '' }}
            </div>
            <div class="pending-item-trans">{{ p.item.translatedText.slice(0, 40) }}{{ p.item.translatedText.length > 40 ? '...' : '' }}</div>
            <div class="pending-item-actions">
              <button class="btn btn-xs btn-tinted" @click="editPendingItem(p.item)">编辑</button>
              <button class="btn btn-xs btn-plain" @click="skipPendingItem(p.item)">跳过</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 条件行：重翻失败 / 重试应用 -->
      <div class="retry-row" v-if="translateErrors.size > 0 || failedNodeIds.length > 0">
        <button v-if="translateErrors.size > 0" class="btn btn-xs btn-plain warn" @click="retryFailedTranslations" :disabled="applying || translating || proofreading">
          重翻失败 ({{ translateErrors.size }})
        </button>
        <button v-if="failedNodeIds.length > 0" class="btn btn-xs btn-plain" @click="retryFailedApply" :disabled="applying || translating || proofreading">
          重试应用 ({{ failedNodeIds.length }})
        </button>
      </div>
    </div>

    <!-- ④ 翻译配置（默认折叠，摘要行可见当前值） -->
    <div class="section config-section">
      <div class="section-header" @click="showConfig = !showConfig">
        <svg class="chevron" :class="{ open: showConfig }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span>翻译配置</span>
        <span class="config-summary">{{ configSummary }}</span>
      </div>
      <div class="section-body" v-if="showConfig">
        <!-- v9.0.2 紧凑三列：标签一排 + 下拉框一排（上一版布局） -->
        <div class="config-grid">
          <div class="config-col">
            <span class="config-label">翻译风格</span>
            <select class="config-select" v-model="selectedPreset" @change="applyPreset" :disabled="isStyleLocked">
              <option value="standard">通用标准版</option>
              <option value="professional">{{ isStyleLocked ? '严谨专业版🔒' : '严谨专业版' }}</option>
              <option value="marketing" v-if="!isStyleLocked">电商营销版</option>
            </select>
          </div>
          <div class="config-col">
            <span class="config-label">场景</span>
            <select class="config-select" v-model="llmConfig.scenePreset" @change="onSceneChange">
              <option value="ecommerce">商品详情页</option>
              <option value="technical_params">技术参数表</option>
              <option value="packaging">包装印刷</option>
              <option value="ui">软件UI</option>
              <option value="after_sales">售后/保修卡</option>
              <option value="manual">说明书</option>
              <option value="spec_sheet">规格书</option>
            </select>
          </div>
          <div class="config-col">
            <span class="config-label">
              产品线
              <span v-if="effectiveProductLine && manualProductLine === ''" class="auto-badge">自动</span>
              <span v-if="manualProductLine !== '' && manualProductLine !== 'none'" class="manual-badge">手动</span>
            </span>
            <select class="config-select" v-model="manualProductLine" @change="onProductLineChange">
              <option v-for="opt in productLineOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>
        </div>
        <div class="pl-detected-row" v-if="detectedProductLine && manualProductLine === ''">
          <span class="pl-detected">检测到：{{ productLineOptions.find(o => o.value === detectedProductLine)?.label || detectedProductLine }}</span>
        </div>
        <div class="pl-warning-row" v-if="!detectedProductLine && manualProductLine === '' && items.length > 0">
          <span class="pl-warning">⚠️ 未检测到产品线，建议手动选择</span>
        </div>
        <textarea
          v-if="selectedPreset === 'custom'"
          class="style-textarea"
          v-model="llmConfig.translationStyleCustom"
          rows="3"
          placeholder="自定义翻译风格，如：语气轻松活泼，适合年轻用户..."
        ></textarea>
        <div class="style-detail-toggle" @click="showStyleDetail = !showStyleDetail">
          <svg class="chevron" :class="{ open: showStyleDetail }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span>查看风格详情</span>
        </div>
        <template v-if="showStyleDetail">
          <!-- v9.1 #13: 参考格式不再第三层折叠，跟随风格详情直接展示 -->
          <textarea
            v-if="selectedPreset === 'custom'"
            class="style-prompt"
            :value="styleReference"
            readonly
            rows="8"
          ></textarea>
          <textarea
            v-else
            class="style-prompt"
            :value="currentStylePrompt"
            readonly
            rows="10"
          ></textarea>
        </template>
      </div>
    </div>

    <!-- ⑤ 翻译结果 -->
    <div class="section">
      <div class="section-header" @click="showTexts = !showTexts">
        <svg class="chevron" :class="{ open: showTexts }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span>翻译结果</span>
        <span class="section-count">{{ items.length }}</span>
      </div>
      <div class="section-body" v-if="showTexts">
        <div class="empty-state" v-if="items.length === 0">
          <div class="empty-icon">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="6" y="8" width="28" height="20" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M12 15h16M12 19h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M20 28v6M16 34h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
          <p>点击"当前页扫描"采集文本</p>
          <p class="empty-sub">{{ selectionCount > 0 ? `已选中 ${selectionCount} 个图层，可点"选中对象扫描"` : '或先在画布中选中图层，再点"选中对象扫描"' }}</p>
        </div>
        <div class="text-item" :class="{
          corrected: item.corrected,
          'csv-changed': csvChangedIds.has(item.nodeIds[0]),
          'trans-error': translateErrors.has(item.nodeIds[0]),
          'applied-manually': appliedNodeIds.has(item.nodeIds[0]),
          'untranslated': showUntranslatedBadge(item),
          'has-placeholder': hasPlaceholderResidue(item.translatedText)
        }" v-for="(item, idx) in items" :key="item.nodeIds[0] || idx" :data-node-id="item.nodeIds[0]" @dblclick="navigateToNode(item)">
          <!-- 原文 — 上方全宽 -->
          <div class="item-source">
            <div class="item-label">
              原文
              <span class="merge-badge" v-if="item.nodeIds.length > 1">×{{ item.nodeIds.length }}</span>
            </div>
            <div class="source-box">{{ item.sourceText }}</div>
          </div>
          <!-- 译文 — 下方全宽 -->
          <div class="item-target">
            <div class="item-label">
              译文
              <span class="error-badge" v-if="translateErrors.has(item.nodeIds[0])">翻译失败</span>
              <span class="misspelled-badge" v-if="misspelledIds.has(item.nodeIds[0])">疑似拼写错误</span>
              <span class="placeholder-badge" v-if="hasPlaceholderResidue(item.translatedText)">⚠️ 占位符</span>
              <span class="untranslated-badge" v-if="showUntranslatedBadge(item)">⚠️ 漏翻</span>
              <span class="proof-badge" v-if="item.corrected">校正</span>
              <span class="csv-badge" v-if="csvChangedIds.has(item.nodeIds[0])">导入变更</span>
              <span class="applied-badge" v-if="appliedNodeIds.has(item.nodeIds[0])">已应用</span>
            </div>
            <textarea
              class="trans-input"
              :class="{ proofread: item.corrected }"
              v-model="item.translatedText"
              rows="1"
              :placeholder="translating ? '翻译中...' : '待翻译'"
              :disabled="translating || proofreading"
              @input="autoResize($event)"
              @focus="autoResize($event); onTransInputFocus(item)"
              @blur="onTransInputBlur(item)"
            ></textarea>
            <div class="proof-hint" v-if="item.corrected">
              <div class="proof-hint-body">
                <div class="proof-hint-top">
                  <span class="proof-reason" v-if="item.proofreadReason">{{ item.proofreadReason }}</span>
                  <button class="btn btn-xs btn-plain btn-revert-proof" @click="revertProofread(item)">恢复原译文</button>
                </div>
                <span class="proof-original">原译文：{{ item.proofreadText }}</span>
              </div>
            </div>
            <!-- 操作行 — 全部 icon+文字 -->
            <div class="item-actions" v-if="!appliedNodeIds.has(item.nodeIds[0])">
              <button class="btn btn-xs btn-tinted" @click.stop="navigateToNode(item)" title="在画布中定位该文本">
                <svg width="12" height="12" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                定位
              </button>
              <!-- 重翻按钮：有译文（非失败）或翻译失败时都显示 — 失败条目用户需要重翻补救 -->
              <button class="btn btn-xs btn-tinted" v-if="item.translatedText || translateErrors.has(item.nodeIds[0])" :disabled="retranslatingIds.has(item.nodeIds[0]) || translating || proofreading" @click.stop="retranslateSingle(item)">
                <svg width="12" height="12" viewBox="0 0 16 16"><path d="M2 8a6 6 0 0 1 10.47-4M14 8a6 6 0 0 1-10.47 4M2 4v3h3M14 12v-3h-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                重翻
              </button>
              <button class="btn btn-xs btn-primary item-apply-btn" v-if="item.translatedText" :disabled="translating || proofreading || applying" @click.stop="applySingle(item)">应用</button>
            </div>
          </div>
        </div>
        <!-- CSV 人工兜底：LLM 翻不好时导出人工填译文再回传批量替换 -->
        <div class="csv-row">
          <div class="csv-row-info">
            <div class="csv-row-title">CSV 人工兜底</div>
            <div class="csv-row-desc">导出人工翻译 → 回传批量替换</div>
          </div>
          <div class="csv-row-actions">
            <button class="btn btn-xs btn-gray" @click.stop="exportCSV" :disabled="items.length === 0">导出 CSV</button>
            <button class="btn btn-xs btn-gray" @click.stop="triggerImport" :disabled="translating || proofreading || applying">导入 CSV</button>
            <input ref="csvInput" type="file" accept=".csv" style="display:none" @change="handleCSVImport" />
          </div>
        </div>
      </div>
    </div>

    <!-- ⑥ 高级分组（默认折叠：低频功能收纳） -->
    <div class="section">
      <div class="section-header" @click="showAdvanced = !showAdvanced">
        <svg class="chevron" :class="{ open: showAdvanced }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span>高级</span>
        <span class="config-summary">字体替换 · 大模型配置 · 术语库</span>
      </div>
      <div class="section-body advanced-body" v-if="showAdvanced">

        <!-- 字体替换设置 -->
        <div class="adv-sub" v-if="fontMappings.length > 0">
          <div class="adv-sub-head" @click="showFontMap = !showFontMap">
            <svg class="chevron" :class="{ open: showFontMap }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <span>字体替换设置</span>
            <span class="section-count">{{ fontMappings.length }} · 已自动匹配</span>
          </div>
          <div class="adv-sub-body" v-if="showFontMap">
            <p class="field-hint">左侧为原文使用的字体属性，点击同步按钮可将属性传导至右侧替换目标</p>
            <div class="font-card" v-for="f in fontMappings" :key="f.key">
              <!-- 左栏：源字体 -->
              <div class="font-panel font-panel-source">
                <div class="font-panel-label">原文</div>
                <div class="font-preview" :style="{ fontFamily: f.sourceFamily }">
                  <span class="font-preview-name">{{ f.sourceFamily }}</span>
                  <span class="font-preview-style">{{ f.sourceStyle }}</span>
                </div>
                <div class="font-attrs-card font-attrs-source">
                  <div class="font-attr-col">
                    <div class="font-attr-val">{{ fmtNum(f.sourceFontSize) }}<span class="font-attr-unit">px</span></div>
                    <div class="font-attr-label">字号</div>
                  </div>
                  <div class="font-attr-col">
                    <div class="font-attr-val">{{ f.sourceLineHeight !== null ? fmtNum(f.sourceLineHeight) : 'AUTO' }}<span class="font-attr-unit" v-if="f.sourceLineHeight !== null">px</span></div>
                    <div class="font-attr-label">行距</div>
                  </div>
                  <div class="font-attr-col">
                    <div class="font-attr-val">{{ f.sourceLetterSpacing !== null ? fmtNum(f.sourceLetterSpacing) : '—' }}<span class="font-attr-unit" v-if="f.sourceLetterSpacing !== null">px</span></div>
                    <div class="font-attr-label">字距</div>
                  </div>
                  <div class="font-attr-col">
                    <div class="font-attr-val">{{ ALIGN_LABELS[f.sourceTextAlign] || f.sourceTextAlign }}</div>
                    <div class="font-attr-label">对齐</div>
                  </div>
                </div>
              </div>

              <!-- 右栏：目标字体 -->
              <div class="font-panel font-panel-target">
                <div class="font-panel-head">
                  <div class="font-panel-label">替换为</div>
                  <button class="btn-sync" @click="syncFontAttrs(f)" title="将原文属性同步到替换目标">
                    <svg width="14" height="14" viewBox="0 0 16 16"><path d="M4 8a4 4 0 0 1 4-4 3.96 3.96 0 0 1 3.46 2M13 8a4 4 0 0 1-4 4 3.96 3.96 0 0 1-3.46-2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M12 4l1.5-1.5L15 4M4 12l-1.5 1.5L1 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    <span class="btn-sync-text">同步</span>
                  </button>
                </div>
                <input
                  class="font-search-input"
                  type="text"
                  placeholder="搜索字体..."
                  :value="fontSearchMap[f.key] || ''"
                  @input="fontSearchMap = { ...fontSearchMap, [f.key]: ($event.target as HTMLInputElement).value }"
                />
                <select class="font-family-select" v-model="f.selectedFont" @change="onFontSelected(f)">
                  <option value="">继承原字体</option>
                  <optgroup v-for="group in groupedFontOptions(filteredFontOptions(f), f.key + '|' + (fontSearchMap[f.key] || ''))" :key="group[0]" :label="group[0]">
                    <option v-for="fs in group[1]" :key="fs.key" :value="fs.key">{{ fs.style }}</option>
                  </optgroup>
                </select>
                <div class="font-preview" v-if="f.selectedFont" :style="{ fontFamily: f.targetFamily || f.sourceFamily }">
                  <span class="font-preview-name">{{ f.targetFamily || '—' }}</span>
                  <span class="font-preview-style">{{ f.targetStyle || '—' }}</span>
                </div>
                <div class="font-attrs-card font-attrs-target">
                  <div class="font-attr-col">
                    <input class="font-attr-input" type="number" :value="fmtNum(f.targetFontSize)" @input="f.targetFontSize = ($event.target as HTMLInputElement).valueAsNumber || 0" placeholder="继承" />
                    <div class="font-attr-label">字号</div>
                  </div>
                  <div class="font-attr-col">
                    <input class="font-attr-input" type="number" :value="fmtNum(f.targetLineHeight)" @input="f.targetLineHeight = ($event.target as HTMLInputElement).valueAsNumber || null" placeholder="继承" />
                    <div class="font-attr-label">行距</div>
                  </div>
                  <div class="font-attr-col">
                    <input class="font-attr-input" type="number" :value="fmtNum(f.targetLetterSpacing)" @input="f.targetLetterSpacing = ($event.target as HTMLInputElement).valueAsNumber || null" placeholder="继承" />
                    <div class="font-attr-label">字距</div>
                  </div>
                  <div class="font-attr-col">
                    <select class="font-attr-select" v-model="f.targetTextAlign">
                      <option value="">继承</option>
                      <option value="LEFT">左</option>
                      <option value="CENTER">中</option>
                      <option value="RIGHT">右</option>
                      <option value="JUSTIFIED">两端</option>
                    </select>
                    <div class="font-attr-label">对齐</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 大模型配置 -->
        <div class="adv-sub">
          <div class="adv-sub-head" @click="showSettings = !showSettings">
            <svg class="chevron" :class="{ open: showSettings }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <span>大模型配置</span>
          </div>
          <div class="adv-sub-body" v-if="showSettings">
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
              <button class="btn btn-gray flex-1" @click="useDefaultConfig">
                使用默认配置
              </button>
              <button class="btn btn-gray flex-1" @click="testTranslationConnection" :disabled="testingTrans">
                {{ testingTrans ? '测试中...' : '测试翻译' }}
              </button>
              <button v-if="llmConfig.enableProofread" class="btn btn-gray flex-1" @click="testProofConnection" :disabled="testingProof">
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

        <!-- 术语库 -->
        <div class="adv-sub">
          <div class="adv-sub-head" @click="showGlossary = !showGlossary">
            <svg class="chevron" :class="{ open: showGlossary }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <span>术语库</span>
            <span class="section-count">{{ glossaryProducts.length + glossaryExclusive.length }}</span>
          </div>
          <div class="adv-sub-body" v-if="showGlossary">
            <div class="glossary-sub">
              <div class="glossary-sub-head">
                <span class="glossary-sub-title">产品名</span>
                <span class="glossary-sub-count">{{ glossaryProducts.length }} 条</span>
              </div>
              <div class="inline-actions">
                <button class="btn btn-sm btn-gray" @click="downloadGlossaryProducts">下载</button>
                <button class="btn btn-sm btn-gray" @click="triggerGlossaryProductsUpload">替换</button>
                <input ref="glossaryProductsInput" type="file" accept=".csv" style="display:none" @change="handleGlossaryProductsUpload" />
              </div>
            </div>
            <div class="glossary-sub">
              <div class="glossary-sub-head">
                <span class="glossary-sub-title">专属术语</span>
                <span class="glossary-sub-count">{{ glossaryExclusive.length }} 条</span>
              </div>
              <div class="inline-actions">
                <button class="btn btn-sm btn-gray" @click="downloadGlossaryExclusive">下载</button>
                <button class="btn btn-sm btn-gray" @click="triggerGlossaryExclusiveUpload">替换</button>
                <input ref="glossaryExclusiveInput" type="file" accept=".csv" style="display:none" @change="handleGlossaryExclusiveUpload" />
              </div>
            </div>
            <p class="glossary-hint">"替换"上传将完全覆盖对应术语库，而非合并。</p>
          </div>
        </div>

        <!-- v10.1: 诊断日志（排障用，默认折叠；翻译/校对时自动记录） -->
        <div class="adv-sub">
          <div class="adv-sub-head" @click="showDiagLog = !showDiagLog">
            <svg class="chevron" :class="{ open: showDiagLog }" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <span>诊断日志</span>
            <span class="section-count">{{ diagLogs.length }}</span>
          </div>
          <div class="adv-sub-body" v-if="showDiagLog">
            <div class="inline-actions">
              <button class="btn btn-sm btn-gray" @click="copyDiagLogs">复制日志</button>
              <button class="btn btn-sm btn-gray" @click="clearDiagLogs">清空</button>
            </div>
            <pre ref="diagLogPre" class="diag-log-view">{{ diagLogs.length ? diagLogs.map(e => `[${e.time}] [${e.tag}] ${e.message}`).join('\n') : '（暂无日志，执行一次翻译后此处显示诊断信息）' }}</pre>
            <p class="glossary-hint">翻译异常时：点「复制日志」把内容发给开发者。</p>
          </div>
        </div>

      </div>
    </div>

    <!-- 页脚署名（v9.3 恢复：v9.0 重构时误删，v8.7 及更早版本均有） -->
    <div class="footer">by Lexar Design Team</div>

    <!-- Toast -->
    <transition name="fade">
      <div class="toast" v-if="toastMsg" :class="toastType">{{ toastMsg }}</div>
    </transition>
  </div>
</template>

<script lang="ts" setup>
import { ref, shallowRef, markRaw, computed, onMounted, nextTick, watch } from 'vue'
import { UIMessage, PluginMessage, TextItem, LLMConfig, GlossaryEntry, TranslationCorrection, LANGUAGES, TestConnectionResult } from '@messages/types'
import { sendMsgToPlugin } from '@messages/ui-sender'
import { parseCSVRow, csvEncodeCell } from '@lib/parse-csv'
import { formatCJKSpace } from '@lib/format-text'
import { postProcessTranslation, restoreTrademarkSymbols, restoreStorageUnitFormatting, enforceGlossaryTerms, detectTranslationExpansion, sanitizeLineBreaks, cleanKey } from '@lib/post-process'
import { translateBatch, proofreadBatch, fetchWithRetry, isProofreadScriptMismatch, detectTruncatedTexts, STYLE_PRESETS, SCENE_PRESETS, detectProductLine, buildTaskGlossaryHint, isUntranslatable, isSuspectMisspelledWord, classifyNecessity, getTargetScript, hasFunctionWords, hasSimplifiedOnlyChars, hasTraditionalOnlyChars } from '@lib/llm-api'
import { startMetricsCollection, recordBatchMetrics, recordProofreadMetrics, finalizeMetrics, formatMetricsReport, createBatchTimer } from '@lib/metrics'
import { DEFAULT_GLOSSARY_PRODUCTS_CSV } from '@lib/default-glossary'
import { TRANSLATE_BATCH_SIZE, PROOFREAD_BATCH_SIZE, TOAST_DURATION_MS, CORRECTION_THRESHOLD, makeFontKey, parseFontKey, normalizeText } from '@lib/constants'
import { convertStorageUnit } from '@lib/unit-convert'
import { getAutoFontMapping } from '@lib/font-mapper'
import { compressBatch, expandBatch } from '@lib/translation-memory'
import { detectAdhocProductTerms, parseProductName } from '@lib/new-product-detect'
import { generateProductNameTranslations, zhCNtoZhTW } from '@lib/product-name-generator'
import { uiLog, getUiLogs, getUiLogVersion, clearUiLogs, formatUiLogs, receiveMainLog, restoreUiLogs, serializeUiLogs, UiLogEntry } from '@lib/ui-debug-log'

// ============================================================
// 响应式状态
// ============================================================
const items = ref<TextItem[]>([])
const targetLang = ref('en')
const sourceLang = ref('auto')
// v9.0.1 性能：术语库/字体列表为大批量静态数据，shallowRef + markRaw 避免深层响应式递归开销
const glossaryProducts = shallowRef<GlossaryEntry[]>([])
const glossaryExclusive = shallowRef<GlossaryEntry[]>([])
const glossary = computed(() => [...glossaryProducts.value, ...glossaryExclusive.value])
/** 术语库映射（响应式），供 UI 层漏翻检测复用，避免重复构建 */
const glossaryMapForUi = computed(() => buildGlossaryMaps().full)

/** 判断条目是否应显示漏翻标记（兼容术语库中 source==target 的全球统一英文术语） */
/** v9.0.1 性能：漏翻检测结果缓存 — 模板每卡调用 2 次，pendingItems 再调 1 次，
 * 且任一响应式变化触发全模板重渲染时 48 卡×3 次全量重跑。
 * 键含源文/译文/目标语言/术语库规模，任一变化自动失效。 */
const untranslatedBadgeCache = new Map<string, boolean>()
function showUntranslatedBadge(item: { sourceText: string; translatedText: string; nodeIds?: string[] }): boolean {
  if (item.sourceText !== item.translatedText) return false
  // v10.6.2: 疑似错词已单独标记"疑似拼写错误"，不再叠加"⚠️ 漏翻"徽章
  if (item.nodeIds?.[0] && misspelledIds.value.has(item.nodeIds[0])) return false
  const key = item.sourceText + '' + targetLang.value + '' + glossaryProducts.value.length + '/' + glossaryExclusive.value.length
  const cached = untranslatedBadgeCache.get(key)
  if (cached !== undefined) return cached
  const result = computeUntranslatedBadge(item)
  if (untranslatedBadgeCache.size > 5000) untranslatedBadgeCache.clear()
  untranslatedBadgeCache.set(key, result)
  return result
}
function computeUntranslatedBadge(item: { sourceText: string; translatedText: string }): boolean {
  if (item.sourceText !== item.translatedText) return false

  // 第一层：不可翻译 → 不显示
  if (isUntranslatable(item.sourceText, glossaryMapForUi.value)) return false

  // v10.6.2: 疑似错词形态（拉丁单词，非术语库，非已豁免类别）→ LLM 保留原形是正确行为，不算漏翻
  if (isSuspectMisspelledWord(item.sourceText, glossaryMapForUi.value)) return false

  // 逐条 necessity 分类（与后端 detectUntranslatedText 三层架构一致）
  const necessity = classifyNecessity(item.sourceText, targetLang.value)

  switch (necessity.kind) {
    case 'translate':
      // 跨字符集：源文==译文 → 漏翻
      // 反向校验：拉丁目标语言，含目标语言功能词 → 已翻译，不显示
      if (getTargetScript(targetLang.value) === 'latin' && hasFunctionWords(item.translatedText, targetLang.value)) {
        return false
      }
      return true

    case 'variant':
      // 变体转换校验
      if (necessity.conversion === 's2t') return hasSimplifiedOnlyChars(item.translatedText)
      if (necessity.conversion === 't2s') return hasTraditionalOnlyChars(item.translatedText)
      if (necessity.conversion === 'pt') {
        return hasFunctionWords(item.translatedText, 'en') && !hasFunctionWords(item.translatedText, 'pt')
      }
      return false

    case 'verify':
      // 同语言：不显示
      return false
  }
}

/** v8.9: 检测译文是否含未还原的占位符（__GLOSSARY_N__/__PRD_N__ 等） */
function hasPlaceholderResidue(text: string): boolean {
  return /__[A-Z]+_\d+__/.test(text)
}

/** v8.9: 待确认条目 — 三类阻塞问题 */
const pendingItems = computed(() => {
  const errors: Array<{ item: typeof items.value[0]; type: 'error' | 'placeholder' | 'untranslated' | 'misspelled' }> = []
  for (const item of items.value) {
    if (appliedNodeIds.value.has(item.nodeIds[0])) continue // 已应用的不参与
    if (misspelledIds.value.has(item.nodeIds[0])) {
      errors.push({ item, type: 'misspelled' })
    } else if (translateErrors.value.has(item.nodeIds[0])) {
      errors.push({ item, type: 'error' })
    } else if (hasPlaceholderResidue(item.translatedText)) {
      errors.push({ item, type: 'placeholder' })
    } else if (showUntranslatedBadge(item)) {
      errors.push({ item, type: 'untranslated' })
    }
  }
  return errors
})

/** v8.9: 是否有阻塞批量应用的问题 */
const hasPendingBlockingIssue = computed(() => pendingItems.value.length > 0)
const translationCache = ref<Record<string, string>>({})
const llmConfig = ref<LLMConfig>({ apiKey: '', apiUrl: '', model: '', translationStyle: 'standard', translationStyleCustom: '', scenePreset: 'ecommerce', enableProofread: false, proofreadApiKey: '', proofreadApiUrl: '', proofreadModel: '' })

const scanning = ref(false)
/** v9.1 #11: 扫描进度（main.ts 每 100 节点上报），按钮文案"扫描中(N)..." */
const scanFoundCount = ref(0)
const scanProgressText = computed(() =>
  scanFoundCount.value > 0 ? `扫描中(${scanFoundCount.value})...` : '扫描中...'
)
/** v9.1 #8: 画布选区计数（main.ts selectionchange 推送），无选区时禁用"选中对象扫描" */
const selectionCount = ref(0)
const lastScanMode = ref<'all' | 'selection' | null>(null)
const pageName = ref('')
const fileName = ref('')
const translating = ref(false)
const proofreading = ref(false)
const applying = ref(false)
const applyingFonts = ref(false)
const undoing = ref(false)
/** v9.1 #3: 撤销可用性以画布快照为准（main.ts UNDO_STATE 推送），而非 UI 列表是否有译文 */
const canUndo = ref(false)
const undoCount = ref(0)
const cancelFlag = ref(false)
const failedNodeIds = ref<string[]>([])
const translateErrors = ref<Set<string>>(new Set())
/** v10.6: 疑似拼写错误的 nodeId 集合 — 源稿疑似错词被保留原形，与"翻译失败"区分标记 */
const misspelledIds = ref<Set<string>>(new Set())
/** v10.8: 译文显著超长的 nodeId 集合 — 长度异常信号透出给校对层作 hint（不自动截断） */
const expansionIds = ref<Set<string>>(new Set())
/** AI 校对标记的歧义词汇 — 应加入术语库 source 列，用户后续补充翻译 */
const suggestedGlossaryTerms = ref<string[]>([])
/** 已被手动应用过的 nodeId 集合，批量应用时自动跳过 */
const appliedNodeIds = ref<Set<string>>(new Set())
/** 正在单条重翻中的 nodeId 集合，用于禁用按钮防止重复提交 */
const retranslatingIds = ref<Set<string>>(new Set())


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
const showPendingList = ref(false)
/** v9.1 #7: 待确认条出现时自动展开（一键操作 0 次点击）；用户手动收起后不再自动展开 */
let pendingUserCollapsed = false
function togglePendingList() {
  showPendingList.value = !showPendingList.value
  pendingUserCollapsed = !showPendingList.value
}
watch(pendingItems, (list) => {
  if (list.length > 0 && !pendingUserCollapsed) showPendingList.value = true
  if (list.length === 0) pendingUserCollapsed = false
})
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

const availableFonts = shallowRef<{ family: string; style: string }[]>([])

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

/** v9.0.1 性能：字体分组结果缓存 — 模板中每个字体映射卡都调用
 * groupedFontOptions(filteredFontOptions(f))，任一响应式变化全量重跑 */
const fontGroupCache = new Map<string, Array<[string, FontOption[]]>>()

function filteredFontOptions(fm: FontMapping): FontOption[] {
  const q = (fontSearchMap.value[fm.key] || '').trim().toLowerCase()
  if (!q) return fontStyleOptions.value
  return fontStyleOptions.value.filter(function (f) {
    return f.family.toLowerCase().includes(q) || f.style.toLowerCase().includes(q)
  })
}

function groupedFontOptions(options: FontOption[], cacheKey?: string): Array<[string, FontOption[]]> {
  if (cacheKey !== undefined) {
    const cached = fontGroupCache.get(cacheKey)
    if (cached) return cached
  }
  const map = new Map<string, FontOption[]>()
  for (const opt of options) {
    const group = map.get(opt.family)
    if (group) {
      group.push(opt)
    } else {
      map.set(opt.family, [opt])
    }
  }
  const result = Array.from(map.entries())
  if (cacheKey !== undefined) {
    if (fontGroupCache.size > 200) fontGroupCache.clear()
    fontGroupCache.set(cacheKey, result)
  }
  return result
}

function onFontSelected(f: FontMapping) {
  if (f.selectedFont) {
    const parsed = parseFontKey(f.selectedFont)
    f.targetFamily = parsed.family
    f.targetStyle = parsed.style
  } else {
    // "继承原字体"：清除所有目标字体属性，避免字号/行距/字距残留
    f.targetFamily = ''
    f.targetStyle = ''
    f.targetFontSize = 0
    f.targetLineHeight = null
    f.targetLetterSpacing = null
    f.targetTextAlign = ''
    f.selectedFont = ''
  }
}

function syncFontAttrs(f: FontMapping) {
  // 1. 直接更新 FontMapping 对象，UI 即时反映
  f.targetFontSize = f.sourceFontSize
  f.targetLineHeight = f.sourceLineHeight ?? null
  f.targetLetterSpacing = f.sourceLetterSpacing ?? null
  f.targetTextAlign = f.sourceTextAlign || ''
  // 2. 同步到 items.value 以持久化（应用翻译+字体时会用到）
  for (const item of items.value) {
    if (item.fontFamily === f.sourceFamily && item.fontStyle === f.sourceStyle) {
      item.targetFontSize = f.sourceFontSize
      item.targetLineHeight = f.sourceLineHeight ?? null
      item.targetLetterSpacing = f.sourceLetterSpacing ?? null
      item.targetTextAlign = f.sourceTextAlign || ''
    }
  }
}


const toastMsg = ref('')
const toastType = ref('info')
let toastTimer = 0

/** v9.1 #10: toast 队列 — 同时只显示 1 条，同类连续合并计数，error 展示更久。
 *  解决"翻译完成→校对开始→校对完成"3 连 toast 互相覆盖的问题。 */
interface ToastItem { msg: string; type: string; repeat: number }
const toastQueue: ToastItem[] = []
const TOAST_SHOW_MS: Record<string, number> = { error: 4000, warning: 3000, success: 2500, info: 1500 }

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

/** v9.1 #6: 禁用原因内联小字 — 用户不用猜按钮为什么灰 */
const translateDisabledReason = computed(() => {
  if (items.value.length === 0) return ''  // stats-empty 已有"扫描后开始翻译"引导，不重复
  if (proofreading.value) return '校对中...'
  return ''
})
/** 应用行下方的综合提示：优先顺序引导（应用翻译→替换字体），其次撤销原因 */
const applyRowHint = computed(() => {
  if (hasTranslation.value && appliedNodeIds.value.size === 0 && !applyingFonts.value) {
    return '建议先"应用翻译"再"替换字体"'
  }
  if (!hasTranslation.value && !canUndo.value) return ''
  return ''
})
const undoDisabledReason = computed(() => {
  if (canUndo.value || undoing.value || applying.value) return ''
  if (hasTranslation.value) return ''  // 有译文时 applyRowHint 已占此行
  return '画布上没有可恢复的应用'
})

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

// v9.0: 折叠区开关
const showConfig = ref(false)
const showAdvanced = ref(false)
const showStyleDetail = ref(false)

// v10.1: 诊断日志面板（高级区，默认折叠；轮询版本号刷新，免深响应式）
const showDiagLog = ref(false)
const diagLogs = ref<UiLogEntry[]>([])
let diagLogTimer: ReturnType<typeof setInterval> | null = null
let diagLogSeenVersion = -1
watch(showDiagLog, (open) => {
  if (open) {
    diagLogs.value = getUiLogs()
    diagLogSeenVersion = getUiLogVersion()
    diagLogTimer = setInterval(() => {
      const v = getUiLogVersion()
      if (v !== diagLogSeenVersion) {
        diagLogSeenVersion = v
        diagLogs.value = getUiLogs()
      }
    }, 500)
  } else if (diagLogTimer) {
    clearInterval(diagLogTimer)
    diagLogTimer = null
  }
})
const diagLogPre = ref<HTMLElement | null>(null)
// v10.3: 日志变化时防抖持久化（主线程是 clientStorage 唯一持有者，经消息写入）
let diagLogPersistTimer: ReturnType<typeof setTimeout> | null = null
let diagLogLastPersistedVersion = -1
function schedulePersistUiLogs() {
  if (diagLogPersistTimer) clearTimeout(diagLogPersistTimer)
  diagLogPersistTimer = setTimeout(() => {
    const v = getUiLogVersion()
    if (v === diagLogLastPersistedVersion) return
    diagLogLastPersistedVersion = v
    sendMsgToPlugin(UIMessage.SAVE_UI_LOGS, JSON.parse(JSON.stringify(serializeUiLogs())))
  }, 2000)
}
async function copyDiagLogs() {
  const text = formatUiLogs() || '（暂无日志）'
  try {
    await navigator.clipboard.writeText(text)
    showToast('日志已复制', 'success')
  } catch {
    // 剪贴板 API 不可用（MasterGo iframe 环境常见）：自动全选日志文本，用户 Ctrl+C 即可
    const el = diagLogPre.value
    if (el) {
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      showToast('已全选日志，按 Ctrl+C 复制', 'warning')
    } else {
      showToast('复制失败，请手动全选日志文本复制', 'warning')
    }
  }
}
// v10.3: 清空日志同时清掉持久化存储
function clearDiagLogs() {
  clearUiLogs()
  diagLogs.value = []
  diagLogLastPersistedVersion = getUiLogVersion()
  sendMsgToPlugin(UIMessage.SAVE_UI_LOGS, [])
}

// v9.0: 统一进度条 — 优先级 apply > proofread > translate（同时只跑一个阶段）
const busyPhase = computed((): 'translate' | 'proofread' | 'apply' | null => {
  if (applying.value) return 'apply'
  if (proofreading.value) return 'proofread'
  if (translating.value) return 'translate'
  return null
})
const busyPercent = computed(() => {
  if (busyPhase.value === 'apply') return applyingProgressPercent.value
  if (busyPhase.value === 'proofread') return proofreadProgressPercent.value
  return translateProgressPercent.value
})
const busyLabel = computed(() => {
  if (busyPhase.value === 'apply') return '应用中'
  if (busyPhase.value === 'proofread') return '校对中'
  return '翻译中'
})

// v9.0: 配置摘要 — 折叠时显示当前生效值（含产品线自动检测结果）
// 见下方 productLineOptions 定义之后

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
  // 同类连续合并：与队尾同 msg 则计数 +1（"xx (×2)"），不刷队列
  const tail = toastQueue[toastQueue.length - 1]
  if (tail && tail.msg === msg && tail.type === type) {
    tail.repeat++
    return
  }
  toastQueue.push({ msg, type, repeat: 1 })
  if (toastQueue.length === 1) drainToastQueue()
}

function drainToastQueue() {
  const cur = toastQueue[0]
  if (!cur) { toastMsg.value = ''; return }
  toastMsg.value = cur.repeat > 1 ? `${cur.msg} (×${cur.repeat})` : cur.msg
  toastType.value = cur.type
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastQueue.shift()
    drainToastQueue()
  }, (TOAST_SHOW_MS[cur.type] || TOAST_DURATION_MS)) as unknown as number
}

// ============================================================
// 用户修正跟踪
// ============================================================
const editingOriginal = ref<{ item: TextItem; originalTranslation: string } | null>(null)
const corrections = ref<TranslationCorrection[]>([])

/** v9.1 #13: 恢复原译文抽函数 + 反馈 toast（原内联赋值无任何反馈） */
function revertProofread(item: TextItem) {
  item.translatedText = item.proofreadText
  item.proofreadText = ''
  item.proofreadReason = ''
  item.corrected = false
  showToast('已恢复原译文', 'info')
}

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
/** v9.1 #2: 扫描即开始新一轮工作 — 完整重置上一轮的所有状态，避免徽章/阻塞残留 */
function resetWorkState() {
  items.value = []
  translateErrors.value = new Set()
  misspelledIds.value = new Set()
  expansionIds.value = new Set()
  failedNodeIds.value = []
  appliedNodeIds.value = new Set()
  retranslatingIds.value = new Set()
  csvChangedIds.value = new Set()
  showPendingList.value = false
  scanFoundCount.value = 0
  translateProgress.value = { current: 0, total: 0 }
  proofreadProgress.value = { current: 0, total: 0 }
  untranslatedBadgeCache.clear()
}

function scanAll() {
  lastScanMode.value = 'all'
  scanning.value = true
  resetWorkState()
  sendMsgToPlugin(UIMessage.SCAN_ALL)
  // scanning state reset by SCAN_RESULT message
}

function scanSelection() {
  lastScanMode.value = 'selection'
  scanning.value = true
  resetWorkState()
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
        // v7.5.7: 冲突时选择更好的译文，而不是盲目用第一条
        const better = pickBetterTranslation(item.sourceText, first, item.translatedText)
        seen.set(key, better)
        if (item.translatedText !== better) {
          item.translatedText = better
          unified++
        } else if (first !== better) {
          // 回溯更新已处理过的同源条目
          seen.set(key, better)
          // 重新遍历：将之前用旧值覆盖的条目改回更好的值
          for (const prev of items.value) {
            if (prev === item) break
            const prevKey = normalizeText(prev.sourceText)
            if (prevKey === key && prev.translatedText === first) {
              prev.translatedText = better
              unified++
            }
          }
        }
      }
    } else {
      seen.set(key, item.translatedText)
    }
  }
  if (unified > 0) {
    console.log('[translate] 一致化: ' + unified + ' 条相同源文本的译文被统一')
  }
}

/** 从两个译文中选择更好的：优先实际翻译过的，其次有®的 */
function pickBetterTranslation(source: string, a: string, b: string): string {
  // 规则1: 优先选被翻译过的（≠源文）
  const aTranslated = a !== source
  const bTranslated = b !== source
  if (aTranslated && !bTranslated) return a
  if (!aTranslated && bTranslated) return b
  // 规则2: 源文有®时，优先选保留®的
  if (/[®™©]/.test(source)) {
    const aHasReg = /[®™©]/.test(a)
    const bHasReg = /[®™©]/.test(b)
    if (aHasReg && !bHasReg) return a
    if (!aHasReg && bHasReg) return b
  }
  // 规则3: 默认保留第一个（保持原有行为）
  return a
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
  const result: string[] = []

  // 1. 单词级别：统计词频，匹配单词语术
  const wordCounts = new Map<string, number>()
  for (const text of allTexts) {
    const words = text.toLowerCase().split(/[\s,.;:!?()\[\]{}<>]+/)
    for (const w of words) {
      if (w.length < 3) continue
      wordCounts.set(w, (wordCounts.get(w) || 0) + 1)
    }
  }
  for (const [word, count] of wordCounts) {
    if (count >= 2 && glossaryMap.has(word)) {
      result.push(word)
    }
  }

  // 2. 多词短语级别：扫描术语库中所有多词条目，检测在所有文本中的出现次数
  //    修复 "Rigorously Tested" 等短语被单词拆分后无法检测到的 bug
  const multiWordPhraseCounts = new Map<string, number>()
  for (const [glossSource] of glossaryMap) {
    const trimmed = glossSource.trim()
    if (!trimmed.includes(' ')) continue  // 跳过单词语术（上面已处理）
    const glossLower = trimmed.toLowerCase()
    for (const text of allTexts) {
      if (text.toLowerCase().includes(glossLower)) {
        multiWordPhraseCounts.set(trimmed, (multiWordPhraseCounts.get(trimmed) || 0) + 1)
      }
    }
  }
  for (const [phrase, count] of multiWordPhraseCounts) {
    if (count >= 2 && !result.includes(phrase)) {
      result.push(phrase)
    }
  }

  return result
}


// ============================================================
/** 术语库双视图：匹配类用 full（任意语言源文），判断类用 en（仅 EN source） */
interface GlossaryMaps {
  /** 全语言视图：任意语言列值→目标译文。供 短路/遮蔽/校准/合规校验/漏翻检测 匹配 */
  full: Map<string, string>
  /** EN 视图：仅 EN source→目标译文。供 场景过滤/noTranslateTerms/isUntranslatable 判断 */
  en: Map<string, string>
}

/**
 * 构建术语库映射表（双视图）。
 * v9.9 无条件注册全部语言列 key（匹配任意源语言，含 auto 检测）。
 * v9.10 拆分双视图：full 供匹配，en 供判断 —— 修复场景过滤/豁免/不翻判断误用全语言视图
 * 导致的 R1(营销术语污染 prompt)/R4(跨语言同形词整句不翻)/R5(漏翻误判豁免)。
 */
function buildGlossaryMaps(): GlossaryMaps {
  // EN 视图：仅 EN source（分类器 isMarketingTerm/isComplianceTerm 是 EN 精确匹配，只认这个）
  const en = new Map<string, string>()
  for (const g of glossary.value) {
    const t = g.translations[targetLang.value]
    if (t) en.set(g.source, t)
  }
  // 全语言视图：EN 优先，再补其他语言列（先到者胜，撞 key 行为确定 + 观测）
  const full = new Map<string, string>(en)
  for (const g of glossary.value) {
    const tgtVal = g.translations[targetLang.value]
    if (!tgtVal) continue
    for (const [lang, srcVal] of Object.entries(g.translations)) {
      if (lang === targetLang.value) continue
      if (srcVal) {
        // 撞 key 观测：非 EN 列值与已注册 key 冲突且目标值不同 → 记录（不阻断，先到者胜）
        if (full.has(srcVal) && full.get(srcVal) !== tgtVal) {
          console.warn('[glossary] key collision:', srcVal.slice(0, 40), '→', full.get(srcVal)!.slice(0, 30), 'vs', tgtVal.slice(0, 30))
        }
        if (!full.has(srcVal)) full.set(srcVal, tgtVal)
      }
    }
  }
  return { full, en }
}

// ============================================================
async function startTranslate() {
  if (!settingsReady || !glossaryReady) {
    showToast('插件正在初始化，请稍后再试...', 'warning')
    return
  }
  if (!llmConfig.value.apiKey || !llmConfig.value.apiUrl) {
    showToast('请先填写大模型 API Key 和 API 地址', 'error')
    showAdvanced.value = true
    showSettings.value = true
    return
  }

  translating.value = true
  cancelFlag.value = false
  translateErrors.value = new Set()
  misspelledIds.value = new Set()
  expansionIds.value = new Set()
  translateProgress.value = { current: 0, total: 0 }

  // 目标语言切换后需要重新翻译：清空所有旧译文和校对状态
  for (const item of items.value) {
    item.translatedText = ''
    item.proofreadText = ''
    item.proofreadReason = ''
    item.corrected = false
  }

  try {
    const { full: glossaryMap, en: glossaryEnMap } = buildGlossaryMaps()

    // 构建归一化术语查找表（去®™© + 空白归一化），用于译前精确匹配跳过LLM
    const normalizedGlossaryMap = new Map<string, string>()
    for (const [key, value] of glossaryMap) {
      const ck = cleanKey(key)
      if (ck.length >= 3 && !normalizedGlossaryMap.has(ck)) {
        normalizedGlossaryMap.set(ck, value)
      }
    }

    // ═══ v11.2: 未收录新产品名保护 — 检测 → 按命名规则生成译名 → 并入术语链 ═══
    // 检测"整条独立出现+Lexar锚点+品类词"的未收录产品名（含®变体与纯型号形态），
    // 按五槽位+语序模板生成当前目标语种译名并入本批次术语链 → S1 整条短路直接出厂形译文，
    // LLM 不碰产品名（代码管形式/LLM 管语义：判定走形态门+锚点+品类指纹，翻译走命名规则）。
    // 只对产品名生效；营销词/描述性文本不碰（形态门+锚点门+品类指纹门+新颖性门四重收紧）。
    const adhocDetected = detectAdhocProductTerms(
      items.value.map(it => it.sourceText),
      glossaryMap,
    )
    const adhocTerms = adhocDetected.map(d => d.term)
    // 预生成当前目标语种译名（纯查表，微秒级）；zh-TW 若生成器给出与 zh-CN 同形则走简繁转换兜底
    const adhocTargetTranslations = new Map<string, string>()
    for (const d of adhocDetected) {
      const gen = generateProductNameTranslations(d.term, d.series)
      let targetVal = gen.translations[targetLang.value] || d.term
      if (targetLang.value === 'zh-TW' && targetVal === gen.translations['zh-CN']) {
        targetVal = zhCNtoZhTW(targetVal)
      }
      adhocTargetTranslations.set(d.term, targetVal)
      // 并入 full 视图（短路/遮蔽/合规锁）与 EN 视图（isUntranslatable/noTranslateTerms 同源）
      glossaryMap.set(d.term, targetVal)
      glossaryEnMap.set(d.term, d.term)
      const ck = cleanKey(d.term)
      if (ck.length >= 3 && !normalizedGlossaryMap.has(ck)) normalizedGlossaryMap.set(ck, targetVal)
    }
    if (adhocTerms.length > 0) {
      uiLog('translate', `v11.2 新产品名保护: ${adhocTerms.map(t => `${t}→${adhocTargetTranslations.get(t)}`).join(' | ')}`)
      showToast(`检测到 ${adhocTerms.length} 个未收录新产品名，已按命名规则生成译名: ${adhocTerms.slice(0, 3).join(', ')}${adhocTerms.length > 3 ? ' …' : ''}`, 'info')
    }


  // 跨批次术语预扫描：找出全页高频术语，提前注入每个批次确保译文一致
  const allSourceTexts = items.value.map(it => it.sourceText)
  const crossBatchTerms = findHighFreqGlossaryTerms(allSourceTexts, glossaryMap)

  // 任务级术语预计算：用全部源文本一次性过滤术语库，每个批次注入相同 glossaryHint
  // → system prompt 跨批次 100% 一致 → LLM API 自动缓存命中，后续批次不消耗 prompt token
  // v9.10: 传 EN 视图 — 场景/营销/合规分类器是 EN 精确匹配，只对 EN source 有效
  const taskGlossaryHint = buildTaskGlossaryHint(
    glossaryEnMap,
    llmConfig.value.scenePreset,
    allSourceTexts,
  )

  const toTranslate = items.value.filter(it => it.sourceText.trim())
  const total = toTranslate.length

  if (total === 0) {
    translating.value = false
    showToast('没有待翻译的文本', 'info')
    return
  }

  // 纯数字、单字符、纯存储规格文本直接沿用/本地转换，不请求 API
  let autoSkipped = 0
  // 预收集术语库中 source===target 的产品名（全语种保留的硬件型号/系列名，无需翻译）
  // v9.10: 仅 EN 视图 — 其他语言列的同形值不触发整句不翻（修 R4 跨语言同形词漏翻）
  const noTranslateTerms = new Set<string>()
  for (const [src, tgt] of glossaryEnMap) {
    if (src === tgt && src.length >= 4) {
      noTranslateTerms.add(src)
    }
  }
  for (const item of toTranslate) {
    const trimmed = item.sourceText.trim()
    if (/^\d+(\.\d+)?$/.test(trimmed) || (trimmed.length === 1 && !/[一-鿿぀-ヿ가-힯]/.test(trimmed))) {
      item.translatedText = trimmed
      autoSkipped++
    } else if (noTranslateTerms.has(trimmed)) {
      // 术语库中 source===target 的产品名，全语种保留英文原样，不送 API
      item.translatedText = trimmed
      autoSkipped++
    } else if (normalizedGlossaryMap.has(cleanKey(trimmed))) {
      // 术语库精确匹配（去®™©后）：直接使用术语库译文，不送API
      let glossTrans = normalizedGlossaryMap.get(cleanKey(trimmed))!
      // 源文有®™©但术语库译文没有 → 恢复商标符号
      if (/[®™©]/.test(trimmed)) {
        glossTrans = restoreTrademarkSymbols([trimmed], [glossTrans])[0]
      }
      item.translatedText = glossTrans
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
  // v7.5.5: 保持 Figma 图层扫描顺序，不排序
  // 排序（短前长后）会导致 LLM 先看到短文（产品名→保留英文），
  // 建立"不翻译"惯性后长描述句也跟着不翻，造成系统性漏翻
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
  // v11.1: 检测集合进缓存键 — 新产品名一旦被检测保护，旧的"未保护译文"缓存永不命中（防 v10.7 缓存复活）
  const adhocHash = adhocTerms.slice().sort().join(',').slice(0, 200).split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0).toString(36)
  const cacheKey = (text: string) => normalizeText(text) + '\x00' + targetLang.value + '\x00' + glossaryHash + '\x00' + adhocHash
  let cacheHits = 0
  let failedBatches = 0
  const lastErrors: string[] = []

  let cursor = autoSkipped
  translateProgress.value = { current: cursor, total }

  // ═══ v8.4: 启动翻译指标收集 ═══
  const detectedProductLine = detectProductLine(
    items.value.map(it => it.sourceText),
    pageName.value,
    fileName.value,
  )
  const totalBatches = Math.ceil(apiTotal / TRANSLATE_BATCH_SIZE)
  startMetricsCollection(totalBatches, apiTotal, targetLang.value, detectedProductLine)
  const translationTimer = createBatchTimer()

  // ═══ 流水线化：预计算校对参数（翻译开始前就准备好，翻译完一波立即校对） ═══
  const proofreadEnabled = llmConfig.value.enableProofread
  let proofreadGlossaryHint: string | undefined
  let proofreadGlossaryMap: Map<string, string> | undefined
  let proofreadNormalizedMap: Map<string, string> | undefined
  if (proofreadEnabled) {
    // v11.1: 校对与翻译同源同世界 — 复用已并入新产品名的 glossaryMap/glossaryEnMap，
    // 否则校对会把"翻译故意保留的新产品名"误当漏翻改掉（v11.0 双世界问题的新产品名版本）。
    proofreadGlossaryMap = glossaryMap
    // v9.10: 校对路径也构建归一化查找表，供合规校验锁死术语（与翻译管道对齐）
    proofreadNormalizedMap = new Map<string, string>()
    for (const [key, value] of glossaryMap) {
      const ck = cleanKey(key)
      if (ck.length >= 3 && !proofreadNormalizedMap.has(ck)) proofreadNormalizedMap.set(ck, value)
    }
    proofreadGlossaryHint = buildTaskGlossaryHint(
      glossaryEnMap,
      llmConfig.value.scenePreset,
      items.value.map(it => it.sourceText),
    )
  }
  // 流水线校对状态
  const proofreadWavePromises: Promise<void>[] = []
  const proofreadCoveredIndices = new Set<number>()
  const proofreadStats = { correctedCount: 0, failedBatches: 0, lastError: '' }
  let proofreadDoneCount = 0
  let proofreadTotalEstimate = 0

  // 并发批次处理：每次并发 CONCURRENCY 个批次，大幅提速
  const CONCURRENCY = 4
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
        const batchTimer = createBatchTimer()
        let batchApiCalls = 0
        let batchUntranslated = 0
        let batchTruncated = 0

        try {
          // 检查缓存：分离已缓存和未缓存的文本
          // v7.5.6: 脏缓存拒绝 — 防止旧版本bug污染缓存
          const isDirtyCache = (hit: string, sourceText: string): boolean => {
            // 1. 含__XXX_N__占位符残留（unmaskEntities失败）
            if (/__[A-Z]+_\d+__/.test(hit)) return true
            // 2. "译文"===源文（非en目标语言）= 管道回退英文被误缓存
            if (targetLang.value !== 'en' && hit.trim().toLowerCase() === sourceText.trim().toLowerCase()) return true
            // 3. v7.5.7: 源文有®/™/©但缓存结果没有 = 旧版本商标恢复缺陷
            if (/[®™©]/.test(sourceText) && !/[®™©]/.test(hit)) return true
            // 4. v10.7: 源文整条命中术语库但缓存译文 ≠ 术语库目标值 = 旧校对漏网脏缓存
            //    与 isDirtyCache 同构，但语义不同：不抛脏缓存，而是弃用并强制重新翻译
            const expected = normalizedGlossaryMap.get(cleanKey(sourceText))
            if (expected) {
              // v10.7: 修正层豁免 — 用户手动修正过的译文优先于术语库值（最高优先级）
              //        避免"启动清洗删了术语库违规缓存，但用户之前手动改的译文被误杀"
              const hasUserCorrection = corrections.value.some(c =>
                c.source === sourceText && c.targetLang === targetLang.value && c.correctedTranslation === hit
              )
              if (!hasUserCorrection && hit !== expected) return true
            }
            return false
          }
          const uncachedIndices: number[] = []
          const cachedResult: (string | null)[] = texts.map((t, idx) => {
            const hit = cache[cacheKey(t)]
            if (hit !== undefined && !isDirtyCache(hit, t)) {
              cacheHits++
              return hit
            }
            // 脏缓存 → 清除并重新翻译
            if (hit !== undefined) {
              delete cache[cacheKey(t)]
            }
            uncachedIndices.push(idx)
            return null
          })

          let translated: string[] = []
          if (uncachedIndices.length > 0) {
            const uncachedTexts = uncachedIndices.map(idx => texts[idx])
            // 翻译记忆：同型号不同容量/速度的文本压缩为唯一模板，减少 API 调用
            const { uniqueTexts, expandData } = compressBatch(uncachedTexts)
            // v9.11: 收集管道最终仍漏翻（保留原文）的唯一条目 → 标记翻译失败（进待确认）
            const uniqueUntranslated = new Set<number>()
            // v10.6: 收集疑似错词（保留原形）的唯一条目 → 单独标记"疑似拼写错误"（与漏翻区分）
            const uniqueMisspelled = new Set<number>()
            // v10.8: 收集译文显著超长的唯一条目 → 透出给校对层作长度异常 hint（不自动截断）
            const uniqueExpansion = new Set<number>()
            const uniqueResult = await translateBatch(uniqueTexts, targetLang.value, glossaryMap, llmConfig.value, sourceLang.value === 'auto' ? undefined : sourceLang.value, pageName.value || undefined, fileName.value || undefined, crossBatchTerms, taskGlossaryHint, normalizedGlossaryMap, false, false, glossaryEnMap, uniqueUntranslated, uniqueMisspelled, uniqueExpansion)
            // 将模板译文展开回原始文本
            const expandedResult = expandBatch(uniqueResult, expandData, uncachedTexts.length)
            // v9.11: 唯一模板索引 → 展开后索引（同源文复制项共享同一模板译文，同样视为漏翻）
            const expandedUntranslated = new Set<number>()
            for (const u of uniqueUntranslated) {
              for (let x = 0; x < expandedResult.length; x++) {
                if (expandedResult[x] !== undefined && expandedResult[x] === uniqueResult[u]) expandedUntranslated.add(x)
              }
            }
            // v10.6: 疑似错词模板索引 → 展开后索引（同源文复制项同样标记）
            const expandedMisspelled = new Set<number>()
            for (const u of uniqueMisspelled) {
              for (let x = 0; x < expandedResult.length; x++) {
                if (expandedResult[x] !== undefined && expandedResult[x] === uniqueResult[u]) expandedMisspelled.add(x)
              }
            }
            // v10.8: 超长信号模板索引 → 展开后索引（同源文复制项同样透出给校对）
            const expandedExpansion = new Set<number>()
            for (const u of uniqueExpansion) {
              for (let x = 0; x < expandedResult.length; x++) {
                if (expandedResult[x] !== undefined && expandedResult[x] === uniqueResult[u]) expandedExpansion.add(x)
              }
            }
            // v7.5.7: 追踪关键文本在各环节的值
            // 合并缓存+API结果
            translated = texts.map((_, idx) => {
              if (cachedResult[idx] !== null) return cachedResult[idx]!
              const apiIdx = uncachedIndices.indexOf(idx)
              return expandedResult[apiIdx] || ''
            })
            // 更新缓存
            for (let j = 0; j < uncachedIndices.length; j++) {
              const srcIdx = uncachedIndices[j]
              // v7.5.6: 不缓存含__XXX_N__占位符的结果（防止unmaskEntities失败污染缓存）
              const resultText = expandedResult[j] || ''
              if (!/__[A-Z]+_\d+__/.test(resultText)) {
                cache[cacheKey(texts[srcIdx])] = resultText
              }
            }
            // v9.11: 漏翻条目索引 → 本批次条目索引
            for (const x of expandedUntranslated) {
              const batchIdx = uncachedIndices[x]
              if (batchIdx !== undefined) translateErrors.value.add(batch[batchIdx].nodeIds[0])
            }
            // v10.6: 疑似错词条目索引 → 本批次条目索引（单独标记，不进 translateErrors）
            for (const x of expandedMisspelled) {
              const batchIdx = uncachedIndices[x]
              if (batchIdx !== undefined) misspelledIds.value.add(batch[batchIdx].nodeIds[0])
            }
            // v10.8: 超长信号条目索引 → 本批次条目索引（透出给校对层，不进 translateErrors）
            for (const x of expandedExpansion) {
              const batchIdx = uncachedIndices[x]
              if (batchIdx !== undefined) expansionIds.value.add(batch[batchIdx].nodeIds[0])
            }
          } else {
            translated = cachedResult as string[]
          }

          // v7.5.7: 对所有结果统一恢复商标符号
          // 缓存结果可能来自旧版本（不含®），必须在此兜底
          translated = restoreTrademarkSymbols(texts, translated)

          for (let j = 0; j < batch.length; j++) {
            batch[j].translatedText = formatCJKSpace(translated[j] || '', targetLang.value)
            // v9.7: 空结果且源文非空 → 标记翻译失败
            // 管道内部兜底（激进翻译/逐句拆分/大小写归一化/术语组合）全部失败时，
            // translateBatch 静默返回空字符串，UI 层无法感知 → 条目显示"待翻译"、
            // 无徽章、无重翻按钮、无待确认。此处兜底标记，让用户能重翻。
            if (!batch[j].translatedText.trim() && texts[j].trim()) {
              translateErrors.value.add(batch[j].nodeIds[0])
            }
          }

          // v8.4: 记录批次指标
          batchApiCalls = uncachedIndices.length > 0 ? 1 : 0
          batchUntranslated = translated.filter(t => !t || t.trim() === '').length
          const batchDuration = batchTimer.stop()
          recordBatchMetrics({
            batchIndex: Math.floor(batchStart / TRANSLATE_BATCH_SIZE),
            batchSize: batch.length,
            targetLang: targetLang.value,
            productLine: detectedProductLine,
            apiCalls: batchApiCalls,
            retryLayers: {
              unified: false,
              aggressive: 0,
              sentenceSplit: 0,
              caseNormalization: 0,
            },
            duration: {
              total: batchDuration,
              llm: batchDuration,
              preprocessing: 0,
              postprocessing: 0,
            },
            glossary: {
              totalTerms: glossaryMap.size,
              matchedTerms: 0,
              hitRate: 0,
            },
            quality: {
              untranslated: batchUntranslated,
              truncated: batchTruncated,
              brandInjection: 0,
              expansion: 0,
            },
          })
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

    // ═══ 流水线校对：本波翻译完成立即校对，不等下一波 ═══
    if (proofreadEnabled && proofreadGlossaryMap && !cancelFlag.value) {
      // 收集本波翻译完成的所有条目（去重）
      const waveItems: typeof items.value[0][] = []
      const waveIndices: number[] = []
      const waveEnd = Math.min(i + TRANSLATE_BATCH_SIZE * CONCURRENCY, apiTotal)
      for (let w = i; w < waveEnd; w++) {
        const item = needApi[w]
        if (item && item.translatedText && item.sourceText.trim() !== item.translatedText.trim()) {
          // 去重：同一源文只校对一次
          const srcKey = item.sourceText.trim()
          if (!proofreadCoveredIndices.has(needApi.indexOf(item))) {
            waveItems.push(item)
            waveIndices.push(needApi.indexOf(item))
            proofreadCoveredIndices.add(needApi.indexOf(item))
          }
        }
      }

      if (waveItems.length > 0) {
        // 立即启动本波校对（异步，不阻塞下一波翻译）
        proofreadWavePromises.push((async () => {
          try {
            const P_CONCURRENCY = 4
            for (let p = 0; p < waveItems.length; p += PROOFREAD_BATCH_SIZE * P_CONCURRENCY) {
              if (cancelFlag.value) break
              const proofPromises: Promise<void>[] = []
              for (let pk = 0; pk < P_CONCURRENCY; pk++) {
                const pStart = p + pk * PROOFREAD_BATCH_SIZE
                if (pStart >= waveItems.length) break
                const pBatch = waveItems.slice(pStart, pStart + PROOFREAD_BATCH_SIZE)
                // v10.8: 本批内译文显著超长的条目索引 → 透出给校对作长度异常 hint
                const pExpansionFlags = new Set<number>()
                for (let pj = 0; pj < pBatch.length; pj++) {
                  if (expansionIds.value.has(pBatch[pj].nodeIds[0])) pExpansionFlags.add(pj)
                }
                proofPromises.push((async () => {
                  try {
                    const batchResults = await proofreadBatch(
                      pBatch.map(it => ({ sourceText: it.sourceText, translatedText: it.translatedText })),
                      targetLang.value,
                      proofreadGlossaryMap!,
                      llmConfig.value,
                      pageName.value || undefined,
                      fileName.value || undefined,
                      proofreadGlossaryHint,
                      proofreadNormalizedMap,
                      pExpansionFlags,
                    )
                    for (let j = 0; j < pBatch.length; j++) {
                      const proofed = batchResults[j]
                      if (proofed.ambiguous && proofed.ambiguous.length > 0) {
                        for (const term of proofed.ambiguous) {
                          if (term && term.trim()) suggestedGlossaryTerms.value.push(term.trim())
                        }
                      }
                      if (proofed.text && proofed.text !== 'OK' && proofed.text !== pBatch[j].translatedText) {
                        if (isProofreadScriptMismatch(proofed.text, targetLang.value)) continue
                        if (pBatch[j].sourceText.length >= 15 && proofed.text.length > pBatch[j].translatedText.length * 2) continue
                        if (pBatch[j].sourceText.length >= 15 && proofed.text.length < pBatch[j].translatedText.length * 0.2) continue
                        let fixed = postProcessTranslation(proofed.text, targetLang.value)
                        if (!/[\n\r]/.test(pBatch[j].sourceText)) fixed = fixed.replace(/[\n\r]+/g, ' ')
                        fixed = formatCJKSpace(fixed, targetLang.value)
                        if (fixed === pBatch[j].translatedText) continue
                        pBatch[j].proofreadText = pBatch[j].translatedText
                        pBatch[j].translatedText = fixed
                        pBatch[j].proofreadReason = (proofed.reason || '').slice(0, 40)
                        pBatch[j].corrected = true
                        proofreadStats.correctedCount++
                        sendMsgToPlugin(UIMessage.SAVE_CORRECTION, {
                          source: pBatch[j].sourceText,
                          targetLang: targetLang.value,
                          originalTranslation: pBatch[j].proofreadText,
                          correctedTranslation: fixed,
                          correctedAt: Date.now(),
                        })
                      }
                    }
                  } catch (e) {
                    proofreadStats.failedBatches++
                    proofreadStats.lastError = e instanceof Error ? e.message : String(e)
                  }
                })())
              }
              await Promise.allSettled(proofPromises)
              proofreadDoneCount += proofPromises.length * PROOFREAD_BATCH_SIZE
              if (proofreadTotalEstimate > 0) {
                proofreadProgress.value = { current: Math.min(proofreadDoneCount, proofreadTotalEstimate), total: proofreadTotalEstimate }
              }
            }
          } catch (e) {
            proofreadStats.failedBatches++
            proofreadStats.lastError = e instanceof Error ? e.message : String(e)
          }
        })())
      }
    }
  }

  resizeAllTextareas()

  // 翻译结束后统一持久化缓存
  // 注意：Vue3 ref 值是 Proxy 对象，postMessage 无法克隆，需展开为纯对象
  if (Object.keys(cache).length > 0) {
    sendMsgToPlugin(UIMessage.SAVE_TRANSLATION_CACHE, { ...cache })
  }

  if (cancelFlag.value) {
    translating.value = false
    const count = toTranslate.filter(it => it.translatedText).length
    showToast(`翻译已取消，已完成 ${count} 条`, 'warning')
    return
  }

  const count = toTranslate.filter(it => it.translatedText).length
  const cacheMsg = cacheHits > 0 ? ` (缓存命中 ${cacheHits} 条)` : ''
  const failMsg = failedBatches > 0 ? `，${failedBatches} 个批次失败` : ''
  const skipMsg = autoSkipped > 0 ? `，${autoSkipped} 条沿用原文` : ''
  if (count === 0 && failedBatches > 0) {
    translating.value = false
    const errDetail = lastErrors.length > 0 ? ' — ' + lastErrors[lastErrors.length - 1].slice(0, 80) : ''
    showToast('翻译失败：所有批次请求失败' + errDetail, 'error')
    return
  } else {
    showToast('翻译完成: ' + count + ' 条' + cacheMsg + skipMsg + failMsg, failedBatches > 0 ? 'warning' : 'success')
  }

  // ═══ 流水线校对：等待所有校对波次完成 ═══
  if (proofreadEnabled && proofreadWavePromises.length > 0) {
    proofreading.value = true
    proofreadTotalEstimate = count
    proofreadProgress.value = { current: proofreadDoneCount, total: proofreadTotalEstimate }
    showToast('校对进行中...', 'info')
    await Promise.allSettled(proofreadWavePromises)
    proofreading.value = false
    const proofFailMsg = proofreadStats.failedBatches > 0 ? `，${proofreadStats.failedBatches} 批次校对失败` : ''
    showToast('校对完成: ' + proofreadStats.correctedCount + ' 处被修正' + proofFailMsg, proofreadStats.correctedCount > 0 ? 'success' : 'info')
  } else if (proofreadEnabled && count > 0) {
    // 没有触发流水线校对（可能全部缓存命中或源文=译文），回退到传统校对
    showToast('翻译完成，即将开始校对...', 'info')
    try {
      await startProofread()
    } catch (e) {
      console.error('[translate] proofread crashed', e)
      showToast('校对异常: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }

  // ═══ v11.2: 新产品名静默入库（按规则生成 20 语种，长期保持）═══
  // 检测到的未收录产品名，按五槽位+语序模板生成 20 语种译名，静默写入专属术语库。
  // 入库 key = 整条原文去®（与 CSV 惯例一致：140 条全部无®，cleanKey 模糊匹配天然命中带®变体）。
  // 只对产品名生效；系列/型号/规格全语种保留，品类词按 CSV 现状译法；中文营销名留空待补。
  if (adhocDetected.length > 0) {
    let addedCount = 0
    for (const d of adhocDetected) {
      const already = glossaryExclusive.value.some(g => g.source === d.term) ||
        glossaryProducts.value.some(g => g.source === d.term)
      if (already) continue
      const gen = generateProductNameTranslations(d.term, d.series)
      const translations: Record<string, string> = {}
      for (const [lang, val] of Object.entries(gen.translations)) {
        if (lang !== 'en') translations[lang] = val  // en = source 本身，不重复入库
      }
      glossaryExclusive.value.push({ source: d.term, translations })
      addedCount++
    }
    if (addedCount > 0) {
      saveGlossaryExclusive()
      uiLog('translate', `v11.2 新产品名已静默入库 ${addedCount} 条（20 语种）: ${adhocTerms.slice(0, 5).join(', ')}${adhocTerms.length > 5 ? ' …' : ''}`)
      showToast(`已按命名规则自动入库 ${addedCount} 个新产品名（20 语种），中文营销名待补`, 'success')
    }
  }

  // v8.4: 完成指标收集并显示报告
  const metrics = finalizeMetrics()
  if (metrics) {
    const report = formatMetricsReport(metrics)
    console.log('[translate] 翻译指标报告:\n' + report)
  }

  translating.value = false

  // 同源一致化：无论是否开启校对都执行，确保相同源文本译文一致
  enforceSameSourceConsistency()
  // 换行保护：修复翻译/校对中引入的多余换行
  const allSrcTexts = items.value.map(it => it.sourceText)
  let allTgtTexts = items.value.map(it => it.translatedText)
  allTgtTexts = sanitizeLineBreaks(allSrcTexts, allTgtTexts)
  for (let i = 0; i < items.value.length; i++) {
    items.value[i].translatedText = allTgtTexts[i]
  }
  // 自动字体映射（仅对未手动设置字体的条目生效）
  autoMapFonts()
  } catch (e) {
    translating.value = false
    proofreading.value = false
    console.error('[translate] fatal error', e)
    showToast('翻译异常: ' + (e instanceof Error ? e.message : String(e)), 'error')
  }
}

async function startProofread() {
  proofreading.value = true
  cancelFlag.value = false
  proofreadProgress.value = { current: 0, total: 0 }

  // 跳过无需校对的条目：源文=译文（产品名原样保留/数字/单位转换等），AI 未实际翻译
  const allCandidate = items.value.filter(it => it.translatedText.trim())
  const toCheck = allCandidate.filter(it => it.sourceText.trim() !== it.translatedText.trim())
  const skipped = allCandidate.length - toCheck.length
  const total = toCheck.length

  if (total === 0) {
    proofreading.value = false
    showToast(skipped > 0 ? `校对完成，${skipped} 条无需校对（原文保留）` : '没有可校对的译文', 'info')
    return
  }

  // 提前构建术语库双视图，供校对后 enforceGlossaryTerms 兜底 + 合规校验使用
  const { full: glossaryMap, en: glossaryEnMap } = buildGlossaryMaps()
  // v11.2: 独立校对路径同样并入新产品名的生成译名（可能绕过 startTranslate 直接校对）
  // 与翻译路径同世界：full 视图并入当前目标语种译名，EN 视图并入原文（isUntranslatable 豁免）
  for (const d of detectAdhocProductTerms(items.value.map(it => it.sourceText), glossaryMap)) {
    const gen = generateProductNameTranslations(d.term, d.series)
    let targetVal = gen.translations[targetLang.value] || d.term
    if (targetLang.value === 'zh-TW' && targetVal === gen.translations['zh-CN']) {
      targetVal = zhCNtoZhTW(targetVal)
    }
    glossaryMap.set(d.term, targetVal)
    glossaryEnMap.set(d.term, d.term)
  }
  // v9.10: 校对路径归一化查找表，供合规校验锁死术语（与翻译管道对齐）
  const proofreadNormalizedMap = new Map<string, string>()
  for (const [key, value] of glossaryMap) {
    const ck = cleanKey(key)
    if (ck.length >= 3 && !proofreadNormalizedMap.has(ck)) proofreadNormalizedMap.set(ck, value)
  }

  // 任务级术语预计算：用全部源文本一次性过滤 → 校对各批次 system prompt 100% 一致 → 缓存命中
  // v9.10: 传 EN 视图 — 场景/营销/合规分类器是 EN 精确匹配
  const proofreadGlossaryHint = buildTaskGlossaryHint(
    glossaryEnMap,
    llmConfig.value.scenePreset,
    items.value.map(it => it.sourceText),
  )

  try {
    let correctedCount = 0
    let failedBatches = 0
    let proofLastError = ''

    // 并发校对：大幅提速
    const P_CONCURRENCY = 4
    for (let i = 0; i < total; i += PROOFREAD_BATCH_SIZE * P_CONCURRENCY) {
      if (cancelFlag.value) break

      const concurrentBatchPromises: Promise<void>[] = []

      for (let k = 0; k < P_CONCURRENCY; k++) {
        const batchStart = i + k * PROOFREAD_BATCH_SIZE
        if (batchStart >= total || cancelFlag.value) break
        const batch = toCheck.slice(batchStart, batchStart + PROOFREAD_BATCH_SIZE)
        // v10.8: 本批内译文显著超长的条目索引 → 透出给校对作长度异常 hint
        const expansionFlags = new Set<number>()
        for (let bj = 0; bj < batch.length; bj++) {
          if (expansionIds.value.has(batch[bj].nodeIds[0])) expansionFlags.add(bj)
        }

        concurrentBatchPromises.push((async () => {
          if (cancelFlag.value) return
          try {
            const batchResults = await proofreadBatch(
              batch.map(it => ({ sourceText: it.sourceText, translatedText: it.translatedText })),
              targetLang.value,
              glossaryMap,
              llmConfig.value,
              pageName.value || undefined,
              fileName.value || undefined,
              proofreadGlossaryHint,
              proofreadNormalizedMap,
              expansionFlags,
            )
            for (let j = 0; j < batch.length; j++) {
              const proofed = batchResults[j]
              // 收集校对 LLM 标记的歧义词（应加入术语库 source 列）
              if (proofed.ambiguous && proofed.ambiguous.length > 0) {
                for (const term of proofed.ambiguous) {
                  if (term && term.trim()) {
                    suggestedGlossaryTerms.value.push(term.trim())
                  }
                }
              }
              if (proofed.text && proofed.text !== 'OK' && proofed.text !== batch[j].translatedText) {
                if (isProofreadScriptMismatch(proofed.text, targetLang.value)) {
                  console.warn('[translate] proofread script mismatch, rejected:', proofed.text)
                  continue
                }
                // 校对安全网 — 长度爆炸守卫：校对修正不应远超原译文长度
                // 防止 LLM 将短译文替换为无关长文案（同批次交叉污染）
                if (batch[j].sourceText.length >= 15 &&
                    proofed.text.length > batch[j].translatedText.length * 2) {
                  console.warn('[translate] proofread length explosion guard, rejected:',
                    batch[j].sourceText.slice(0, 50), '|',
                    batch[j].translatedText.length, '→', proofed.text.length)
                  continue
                }
                // 校对安全网 — 长度坍缩守卫：校对修正不应将长译文缩成极短片段
                // 防止 LLM 将正确译文过度精简为只言片语
                if (batch[j].sourceText.length >= 15 &&
                    proofed.text.length < batch[j].translatedText.length * 0.2) {
                  console.warn('[translate] proofread length collapse guard, rejected:',
                    batch[j].sourceText.slice(0, 50), '|',
                    batch[j].translatedText.length, '→', proofed.text.length)
                  continue
                }
                let fixed = postProcessTranslation(proofed.text, targetLang.value)
                // 校对模型偶尔插入换行，原文无换行时强制还原为空格
                if (!/[\n\r]/.test(batch[j].sourceText)) {
                  fixed = fixed.replace(/[\n\r]+/g, ' ')
                }
                fixed = formatCJKSpace(fixed, targetLang.value)
                if (fixed === batch[j].translatedText) continue
                batch[j].proofreadText = batch[j].translatedText
                batch[j].translatedText = fixed
                batch[j].proofreadReason = (proofed.reason || '').slice(0, 40)
                batch[j].corrected = true
                correctedCount++
                // 闭环：将 AI 校对修正也存入反馈系统，触发术语库自动更新
                sendMsgToPlugin(UIMessage.SAVE_CORRECTION, {
                  source: batch[j].sourceText,
                  targetLang: targetLang.value,
                  originalTranslation: batch[j].proofreadText,
                  correctedTranslation: fixed,
                  correctedAt: Date.now(),
                })
              }
            }
            // 校对安全网 — 跨条目污染守卫：防止 LLM 将多条不同源文的译文输出为相同内容
            {
              const dedup = new Map<string, number>()
              for (let j = 0; j < batch.length; j++) {
                const key = batch[j].translatedText.slice(0, 60)
                dedup.set(key, (dedup.get(key) || 0) + 1)
              }
              for (let j = 0; j < batch.length; j++) {
                const key = batch[j].translatedText.slice(0, 60)
                if (dedup.get(key)! > 1 && batch[j].proofreadText) {
                  const hasConflict = batch.some((other, k) =>
                    k !== j && other.translatedText.slice(0, 60) === key &&
                    other.sourceText !== batch[j].sourceText
                  )
                  if (hasConflict) {
                    console.warn('[translate] proofread cross-contamination guard, reverted:',
                      batch[j].sourceText.slice(0, 50))
                    batch[j].translatedText = batch[j].proofreadText
                    batch[j].proofreadText = undefined
                    batch[j].proofreadReason = undefined
                    batch[j].corrected = false
                    correctedCount--
                  }
                }
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
      // 进度：已校对的项 = 本轮并发覆盖到的最后一项索引
      const processedSoFar = Math.min(i + PROOFREAD_BATCH_SIZE * P_CONCURRENCY, total)
      proofreadProgress.value = { current: processedSoFar, total }
    }

    // 校对后兜底：只处理校对实际修改过的文本（消除三重后处理）
    // 收集所有被校对修改的索引
    const correctedIndices = new Set<number>()
    for (let i = 0; i < items.value.length; i++) {
      if (items.value[i].corrected) {
        correctedIndices.add(i)
      }
    }

    // 只对修改过的文本执行后处理（未修改的跳过）
    if (correctedIndices.size > 0) {
      const allSourceTexts = items.value.map(it => it.sourceText)
      let allTranslatedTexts = items.value.map(it => it.translatedText)

      // 扩写检测：只检查修改过的文本
      const correctedSources = [...correctedIndices].map(i => allSourceTexts[i])
      const correctedTranslations = [...correctedIndices].map(i => allTranslatedTexts[i])
      const expansionResult = detectTranslationExpansion(correctedSources, correctedTranslations)
      if (expansionResult.expandedIndices.size > 0) {
        console.warn('[proofread] 检测到 ' + expansionResult.expandedIndices.size + ' 条扩写，已截断')
        // 将截断结果写回原位置
        let k = 0
        for (const i of correctedIndices) {
          if (expansionResult.expandedIndices.has(k)) {
            allTranslatedTexts[i] = expansionResult.texts[k]
          }
          k++
        }
      }

      // 术语库强制校准：只处理修改过的
      for (const i of correctedIndices) {
        const singleResult = enforceGlossaryTerms([allSourceTexts[i]], [allTranslatedTexts[i]], glossaryMap)
        allTranslatedTexts[i] = singleResult[0]
      }

      // 语言后处理 + CJK格式：只处理修改过的
      for (const i of correctedIndices) {
        allTranslatedTexts[i] = postProcessTranslation(allTranslatedTexts[i], targetLang.value)
        allTranslatedTexts[i] = formatCJKSpace(allTranslatedTexts[i], targetLang.value)
      }

      // 存储单位格式还原 + 商标符号还原：只处理修改过的
      const correctedSourcesArr = [...correctedIndices].map(i => allSourceTexts[i])
      const correctedTranslationsArr = [...correctedIndices].map(i => allTranslatedTexts[i])
      const restoredStorage = restoreStorageUnitFormatting(correctedSourcesArr, correctedTranslationsArr)
      const restoredTrademarks = restoreTrademarkSymbols(correctedSourcesArr, restoredStorage)
      let k = 0
      for (const i of correctedIndices) {
        allTranslatedTexts[i] = restoredTrademarks[k]
        k++
      }

      // 换行保护：只处理修改过的
      const sanitizedBreaks = sanitizeLineBreaks(correctedSourcesArr, restoredTrademarks)
      k = 0
      for (const i of correctedIndices) {
        allTranslatedTexts[i] = sanitizedBreaks[k]
        k++
      }

      // 截断兜底：只检查修改过的
      const truncAfterProofread = detectTruncatedTexts(correctedSourcesArr, sanitizedBreaks)
      if (truncAfterProofread.size > 0) {
        console.warn('[proofread] 校对后检测到 ' + truncAfterProofread.size + ' 条译文仍截断，标记为翻译失败')
        k = 0
        for (const i of correctedIndices) {
          if (truncAfterProofread.has(k)) {
            allTranslatedTexts[i] = ''
            items.value[i].proofreadText = ''
            items.value[i].proofreadReason = ''
            items.value[i].corrected = false
            translateErrors.value.add(items.value[i].nodeIds[0])
          }
          k++
        }
      }

      // 写回 items
      for (let i = 0; i < items.value.length; i++) {
        if (allTranslatedTexts[i] !== items.value[i].translatedText) {
          items.value[i].translatedText = allTranslatedTexts[i]
        }
      }
    }

    enforceSameSourceConsistency()
    // 自动字体映射（校对可能改变了译文，也需重新映射）
    autoMapFonts()

    proofreading.value = false
    resizeAllTextareas()

    if (cancelFlag.value) {
      showToast(`校对已取消，已修正 ${correctedCount} 处`, 'warning')
      return
    }
    const totalBatches = Math.ceil(total / PROOFREAD_BATCH_SIZE)
    if (correctedCount === 0 && failedBatches >= totalBatches && failedBatches > 0) {
      showToast('校对全部失败: ' + proofLastError.slice(0, 80), 'error')
    } else {
      const failMsg = failedBatches > 0 ? `，${failedBatches} 批次校对失败` : ''
      const skipMsg = skipped > 0 ? `，${skipped} 条无需校对` : ''
      showToast('校对完成: ' + correctedCount + ' 处被修正' + failMsg + skipMsg, correctedCount > 0 ? 'success' : 'info')
    }

    // 校对完成后，歧义词自动写入专属术语库 source 列
    if (suggestedGlossaryTerms.value.length > 0) {
      const unique = [...new Set(suggestedGlossaryTerms.value)]
      let addedCount = 0
      for (const term of unique) {
        // 检查是否已存在于产品术语库或专属术语库
        const alreadyExists = glossaryExclusive.value.some(g => g.source === term) ||
          glossaryProducts.value.some(g => g.source === term)
        if (!alreadyExists) {
          glossaryExclusive.value.push({ source: term, translations: {} })
          addedCount++
        }
      }
      if (addedCount > 0) {
        saveGlossaryExclusive()
        setTimeout(() => {
          showToast(
            '已将 ' + addedCount + ' 个歧义词加入专属术语库（待补全翻译）: ' +
            unique.slice(0, 5).join(', ') + (unique.length > 5 ? ' ...' : ''),
            'success'
          )
        }, 1000)
      }
      suggestedGlossaryTerms.value = []
    }
  } catch (e) {
    proofreading.value = false
    console.error('[translate] proofread error:', e)
    showToast('校对失败: ' + (e instanceof Error ? e.message : String(e)).slice(0, 80), 'error')
  } finally {
    proofreading.value = false
  }
}

// ============================================================
// 应用 & 撤销
// ============================================================

/** 仅应用翻译内容，不包含字体替换 */
function applyTranslationsOnly() {
  if (items.value.length === 0) return
  // 跳过已手动应用的节点
  const unapplied = items.value.filter(function (it) { return !it.nodeIds.some(function (id) { return appliedNodeIds.value.has(id) }) })
  const skipped = items.value.length - unapplied.length
  if (unapplied.length === 0) {
    showToast(skipped > 0 ? '所有条目已手动应用，无需批量操作' : '没有待应用的译文', 'info')
    return
  }
  applying.value = true
  applyingFonts.value = false
  if (skipped > 0) showToast('跳过 ' + skipped + ' 条已手动应用，正在应用剩余 ' + unapplied.length + ' 条...', 'info')
  // 清除字体目标属性，确保只应用翻译内容不改字体
  const payload = unapplied.map(function (it) {
    return {
      ...it,
      targetFontFamily: '',
      targetFontStyle: '',
      targetFontSize: 0,
      targetLineHeight: null,
      targetLetterSpacing: null,
      targetTextAlign: '',
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

// ============================================================
// 自动字体映射：根据目标语言自动替换字体，字重/间距/行距全部继承原文
// 每次目标语言切换或扫描后重新计算，确保字体替换模块始终预填正确
// ============================================================

/** Avenir → HarmonyOS Sans SC 字重名称映射（两族字体 style name 不一致） */
const AVENIR_TO_HARMONYOS_STYLE: Record<string, string> = {
  'Roman': 'Regular',
  'Extra Light': 'Light',
  'Extra Light Italic': 'Light Italic',
  'Heavy': 'Bold',
  'Heavy Italic': 'Bold Italic',
}

/** 将源字体 style name 映射为目标字体族支持的 style name */
function normalizeFontStyle(sourceFamily: string, sourceStyle: string, targetFamily: string): string {
  const raw = sourceStyle || 'Regular'
  // Avenir → HarmonyOS Sans SC / HarmonyOS Sans TC: 替换不兼容的字重名
  if (
    sourceFamily === 'Avenir' &&
    (targetFamily === 'HarmonyOS Sans SC' || targetFamily === 'HarmonyOS Sans TC')
  ) {
    return AVENIR_TO_HARMONYOS_STYLE[raw] || raw
  }
  return raw
}

function autoMapFonts() {
  for (const item of items.value) {
    const mapping = getAutoFontMapping(item.fontFamily, targetLang.value)
    if (!mapping) {
      // 非品牌字体，清除之前的自动映射
      item.targetFontFamily = ''
      item.targetFontStyle = ''
      item.targetTextAlign = ''
      continue
    }

    item.targetFontFamily = mapping.targetFamily
    // 继承源字体样式（字重），跨字体族时做 style name 映射
    item.targetFontStyle = normalizeFontStyle(item.fontFamily, item.fontStyle, mapping.targetFamily)
    // 继承源字号/行距/字距（此前缺失导致 applyFonts 发送 targetFontSize: 0）
    item.targetFontSize = item.fontSize
    item.targetLineHeight = item.lineHeight ?? null
    item.targetLetterSpacing = item.letterSpacing ?? null
    if (mapping.targetTextAlign) {
      item.targetTextAlign = mapping.targetTextAlign
    }
  }
}

/** 向主线程触发独立的字体替换操作（不改字号/行距/字距，只换字体族+字重） */
let fontOrderHintShown = false  // v9.1 #5: 顺序提示只弹一次，不打扰
function applyFonts() {
  syncFontMappings()
  if (!fontOrderHintShown && appliedNodeIds.value.size === 0) {
    fontOrderHintShown = true
    showToast('提示：若尚未应用翻译，建议先点"应用翻译"——单独应用翻译时不会带上字体', 'info')
  }
  applyingFonts.value = true
  const fontPayload = items.value.map(function (it) {
    return {
      nodeIds: it.nodeIds,
      fontFamily: it.fontFamily,
      fontStyle: it.fontStyle,
      targetFontFamily: it.targetFontFamily || '',
      targetFontStyle: it.targetFontStyle || '',
      targetFontSize: 0,
      targetLineHeight: null,
      targetLetterSpacing: null,
      targetTextAlign: '',
    }
  })
  sendMsgToPlugin(UIMessage.APPLY_FONTS, JSON.parse(JSON.stringify(fontPayload)))
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

  // 构建术语库双视图并调用翻译
  const { full: glossaryMap, en: glossaryEnMap } = buildGlossaryMaps()

  const crossBatchTerms = findHighFreqGlossaryTerms(
    items.value.map(it => it.sourceText), glossaryMap,
  )

  // 任务级术语预计算：用全部源文本一次性过滤 → system prompt 跨批次一致 → 缓存命中
  // v9.10: 传 EN 视图 — 场景/营销/合规分类器是 EN 精确匹配
  const taskGlossaryHint = buildTaskGlossaryHint(
    glossaryEnMap,
    llmConfig.value.scenePreset,
    items.value.map(it => it.sourceText),
  )

  translating.value = true
  cancelFlag.value = false
  translateProgress.value = { current: 0, total: failedItems.length }
  uiLog('retry', `开始重翻 ${failedItems.length} 条失败条目 → ${targetLang.value}`)

  // 分批处理失败项
  for (let i = 0; i < failedItems.length; i += TRANSLATE_BATCH_SIZE) {
    if (cancelFlag.value) break
    const batch = failedItems.slice(i, i + TRANSLATE_BATCH_SIZE)
    const texts = batch.map(it => it.sourceText)

    try {
      // 翻译记忆：同型号不同容量/速度的文本压缩为唯一模板
      const { uniqueTexts, expandData } = compressBatch(texts)
      // v9.11: 收集管道最终仍漏翻的唯一条目 → 标记翻译失败（进待确认，可再次重翻）
      const uniqueUntranslated = new Set<number>()
      // v10.8: 收集译文显著超长的唯一条目 → 透出给校对层（重翻场景同样保留信号）
      const uniqueExpansion = new Set<number>()
      const uniqueResult = await translateBatch(
        uniqueTexts, targetLang.value, glossaryMap, llmConfig.value,
        sourceLang.value === 'auto' ? undefined : sourceLang.value,
        pageName.value || undefined, fileName.value || undefined,
        crossBatchTerms, taskGlossaryHint,
        undefined, false, false, glossaryEnMap,
        uniqueUntranslated, undefined, uniqueExpansion,
      )
      const expandedResult = expandBatch(uniqueResult, expandData, texts.length)
      for (let j = 0; j < batch.length; j++) {
        batch[j].translatedText = formatCJKSpace(expandedResult[j] || '', targetLang.value)
      }
      // v9.11: 唯一模板索引 → 展开后索引（同源文复制项共享模板译文）
      for (const u of uniqueUntranslated) {
        for (let j = 0; j < expandedResult.length; j++) {
          if (expandedResult[j] !== undefined && expandedResult[j] === uniqueResult[u]) {
            translateErrors.value.add(batch[j].nodeIds[0])
          }
        }
      }
      // v10.8: 超长信号透出（重翻场景，同源文复制项同样透出给校对）
      for (const u of uniqueExpansion) {
        for (let j = 0; j < expandedResult.length; j++) {
          if (expandedResult[j] !== undefined && expandedResult[j] === uniqueResult[u]) {
            expansionIds.value.add(batch[j].nodeIds[0])
          }
        }
      }
    } catch (e) {
      for (const item of batch) {
        translateErrors.value.add(item.nodeIds[0])
      }
      uiLog('retry', `❌ 重翻批次异常: ${e instanceof Error ? e.message : String(e)}`)
      console.error('[translate] retry batch failed', e)
    }
    translateProgress.value = { current: Math.min(i + TRANSLATE_BATCH_SIZE, failedItems.length), total: failedItems.length }
  }

  translating.value = false
  resizeAllTextareas()
  enforceSameSourceConsistency()
  autoMapFonts()

  const succeeded = failedItems.filter(it => it.translatedText && !translateErrors.value.has(it.nodeIds[0])).length
  const stillFailed = translateErrors.value.size
  uiLog('retry', `重翻结束: 成功 ${succeeded} 条, 仍失败 ${stillFailed} 条`)
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
  // 跳过旧版元数据列（兼容旧 CSV 格式）
  const skipCols = new Set([
    headerCells.findIndex((h: string) => h.trim() === '处理方式'),
    headerCells.findIndex((h: string) => h.trim() === '术语分类'),
    headerCells.findIndex((h: string) => h.trim() === '产品线'),
    headerCells.findIndex((h: string) => h.trim() === '术语类型'),
  ].filter(i => i >= 0))
  const langCols: string[] = []
  const dataCols: number[] = []
  for (let i = 1; i < headerCells.length; i++) {
    if (skipCols.has(i)) continue
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
    entries.push({ source, translations })
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
    glossaryProducts.value = markRaw(entries)
    saveGlossaryProducts()
    showToast(`已替换产品名术语库（${entries.length} 条）`, 'success')
  }
  reader.readAsText(file)
  glossaryProductsInput.value!.value = ''
}

// ---- 专属术语术语库 ----
function downloadGlossaryExclusive() {
  // 从当前 glossaryExclusive 数据生成 CSV，用户下载后可补全翻译再上传
  const langCodes = LANGUAGES.map(l => l.code)
  const header = ['source', ...langCodes].join(',')
  const rows = glossaryExclusive.value.map(g => {
    const cells = [escapeCSVCell(g.source)]
    for (const code of langCodes) {
      cells.push(escapeCSVCell(g.translations[code] || ''))
    }
    return cells.join(',')
  })
  const csv = [header, ...rows].join('\n')
  triggerDownload(csv, 'Lexar术语库_专属.csv')
}

function escapeCSVCell(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"'
  }
  return val
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
    glossaryExclusive.value = markRaw(entries)
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
const selectedPreset = ref('professional')

// 场景锁定：非电商场景强制严谨专业版
const isStyleLocked = computed(() => llmConfig.value.scenePreset !== 'ecommerce')
const previousStyle = ref('marketing')

// 自动检测的产品线
const detectedProductLine = computed(() => {
  if (items.value.length === 0) return null
  // 性能：pageName/fileName 未加载完成时不检测（它们到达后会触发重算并命中缓存）
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

// v9.0: 配置摘要 — 折叠时显示当前生效值（含产品线自动检测结果）
const configSummary = computed(() => {
  const styleMap: Record<string, string> = {
    standard: '通用标准版',
    professional: '严谨专业版',
    marketing: '电商营销版',
    custom: '自定义',
  }
  const sceneMap: Record<string, string> = {
    ecommerce: '商品详情页',
    technical_params: '技术参数表',
    packaging: '包装印刷',
    ui: '软件UI',
    after_sales: '售后/保修卡',
    manual: '说明书',
    spec_sheet: '规格书',
  }
  const style = styleMap[selectedPreset.value] || selectedPreset.value
  const scene = sceneMap[llmConfig.value.scenePreset] || llmConfig.value.scenePreset
  const plOpt = productLineOptions.find(o => o.value === effectiveProductLine.value)
  const plName = plOpt ? plOpt.label : '未检测'
  const plTag = manualProductLine.value === '' && effectiveProductLine.value ? `${plName}·自动` : plName
  return `${style} / ${scene} / ${plTag}`
})

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
    // 切换回商品详情页：恢复之前的风格
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

// 目标语言切换时重新计算字体映射
watch(targetLang, () => {
  if (items.value.length > 0) {
    nextTick(() => autoMapFonts())
  }
})

// ============================================================
// 节点定位
// ============================================================
/** 记录每个合并组的当前定位索引，用于双击循环切换 */
const locateIndexMap = new Map<string, number>()

function navigateToNode(item: TextItem) {
  if (!item.nodeIds || item.nodeIds.length === 0) return
  const key = item.nodeIds[0]  // 用首个 nodeId 作为组的唯一标识
  const prev = locateIndexMap.get(key) ?? -1
  const next = (prev + 1) % item.nodeIds.length
  locateIndexMap.set(key, next)
  sendMsgToPlugin(UIMessage.LOCATE_NODE, item.nodeIds[next])
}

/** 手动应用单条翻译（译文+字体）到画布 */
async function applySingle(item: TextItem) {
  if (!item.translatedText) return
  syncFontMappings()
  sendMsgToPlugin(UIMessage.APPLY_SINGLE, [JSON.parse(JSON.stringify(item))])
  item.nodeIds.forEach(function (id) { appliedNodeIds.value.add(id) })
  showToast('已应用到画布', 'success')
}

/** 单条重翻：对翻译错误的条目单独重新调用 LLM 翻译 */
async function retranslateSingle(item: TextItem) {
  if (!item.sourceText.trim()) return
  const id = item.nodeIds[0]
  retranslatingIds.value.add(id)

  try {
    const glossaryMap = buildGlossaryMaps().full
    // v9.11: 收集管道最终仍漏翻的条目 — 模型顽固保留原文时不再静默成功
    const untranslated = new Set<number>()
    // v10.6: 收集疑似错词（保留原形）→ 单独标记，不算翻译失败
    const misspelled = new Set<number>()
    // v10.8: 收集译文显著超长信号 → 透出给校对层（不自动截断）
    const expansion = new Set<number>()
    const results = await translateBatch(
      [item.sourceText],
      targetLang.value,
      glossaryMap,
      llmConfig.value,
      sourceLang.value === 'auto' ? undefined : sourceLang.value,
      pageName.value || undefined,
      fileName.value || undefined,
      undefined, undefined, undefined, false, false, undefined,
      untranslated,
      misspelled,
      expansion,
    )
    if (expansion.has(0)) {
      expansionIds.value.add(id)
    }
    if (misspelled.has(0)) {
      // v10.6: 疑似错词 → 保留原形 + 单独标记（非翻译失败，提示核对源稿）
      item.translatedText = item.sourceText
      misspelledIds.value.add(id)
      showToast('源文疑似拼写错误，已保留原形，请核对源稿', 'warning')
    } else if (untranslated.size > 0) {
      // v9.11: 兜底链全失败 → 保留原文 + 标记失败（待确认可见 + 可重翻）
      item.translatedText = item.sourceText
      translateErrors.value.add(id)
      showToast('重翻未成功：模型多次返回原文，已标记为翻译失败', 'error')
    } else if (results[0]) {
      item.translatedText = formatCJKSpace(results[0], targetLang.value)
      // 清空旧校对状态（重翻后旧校对结论已无效）
      item.proofreadText = ''
      item.proofreadReason = ''
      item.corrected = false
      // 移除已应用标记，强制用户重翻后重新确认
      for (const nid of item.nodeIds) {
        appliedNodeIds.value.delete(nid)
      }
      translateErrors.value.delete(id)
      misspelledIds.value.delete(id)
      showToast('已重新翻译', 'success')
    } else {
      // v9.11: 空结果也标记失败（此前只弹 toast，条目状态不变，用户无处可查）
      translateErrors.value.add(id)
      showToast('重翻失败：返回结果为空', 'error')
    }
  } catch (e) {
    console.error('[translate] retranslateSingle failed', e)
    showToast('重翻失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
  } finally {
    retranslatingIds.value.delete(id)
  }
}

// ============================================================
// v8.9: 待处理条目操作
// ============================================================

/** 一键修复占位符残留：重新跑 unmaskEntities */
function fixAllPlaceholders() {
  const placeholderItems = pendingItems.value.filter(p => p.type === 'placeholder')
  if (placeholderItems.length === 0) return
  let fixed = 0
  for (const p of placeholderItems) {
    // 简单尝试：移除所有 __XXX_N__ 占位符（保守策略，避免复杂映射重建）
    const before = p.item.translatedText
    p.item.translatedText = before.replace(/__[A-Z]+_\d+__/g, '').trim()
    if (p.item.translatedText !== before && p.item.translatedText.length > 0) fixed++
  }
  showToast(`已修复 ${fixed}/${placeholderItems.length} 条占位符残留`, fixed > 0 ? 'success' : 'warning')
}

/** 全部接受漏翻原文：确认保留源文作为译文 */
function acceptAllUntranslated() {
  const untranslatedItems = pendingItems.value.filter(p => p.type === 'untranslated')
  if (untranslatedItems.length === 0) return
  // 标记为已确认：从 pending 中移除的方式是确保 showUntranslatedBadge 返回 false
  // 但 showUntranslatedBadge 是计算属性，无法直接修改。这里用 appliedNodeIds 标记跳过批量应用拦截。
  // 实际上这些条目会被正常应用（因为 translatedText 就是原文），只是不再阻塞。
  for (const p of untranslatedItems) {
    for (const nid of p.item.nodeIds) {
      appliedNodeIds.value.add(nid)
    }
  }
  showToast(`已确认保留 ${untranslatedItems.length} 条原文`, 'success')
}

/** 编辑待处理条目：聚焦到该条目的 textarea */
function editPendingItem(item: TextItem) {
  showPendingList.value = false
  // 通过 nodeId 找到对应的 textarea 并聚焦
  const el = document.querySelector(`[data-node-id="${item.nodeIds[0]}"] textarea`)
  if (el instanceof HTMLTextAreaElement) {
    el.focus()
    el.select()
  }
  showToast('请编辑译文', 'info')
}

/** 跳过待处理条目：标记为已应用，不再阻塞 */
function skipPendingItem(item: TextItem) {
  for (const nid of item.nodeIds) {
    appliedNodeIds.value.add(nid)
  }
  misspelledIds.value.delete(item.nodeIds[0])
  showToast('已跳过该条目', 'info')
}

// ============================================================
// 设置
// ============================================================
function useDefaultConfig() {
  llmConfig.value.apiKey = 'sk-LcscmmvLrVlwRbWtoPgF1jSNg6fzR7rgp2FX8pFaHreVYMyu'
  llmConfig.value.apiUrl = 'https://aigo.lexar.com/v1/chat/completions'
  llmConfig.value.model = 'gpt-5.5'
  llmConfig.value.enableProofread = true
  llmConfig.value.proofreadModel = 'gpt-5.5'
  saveSettings()
  showToast('已恢复默认团队配置并保存', 'success')
}

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
/** v9.1 #1: settings 加载完成后若未配置 API，UI 主动提示（而非等点翻译才报错） */
const apiConfigured = ref(true)
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
        // 扫描后预填字体映射：根据目标语言自动确定替换字体
        nextTick(() => autoMapFonts())
        showToast(`扫描到 ${items.value.length} 个文本节点`, 'success')
        break
      }

      case PluginMessage.TRANSLATION_CACHE_LOADED: {
        const rawCache = (data as Record<string, string>) || {}
        // v10.7: 启动时全量清洗 — 除旧版脏缓存（占位符/英文回退）外，
        //        追加"术语库合规"清洗：源文整条命中术语库但缓存值 ≠ 术语库目标值 → 删除
        //        解决 v10.6 及更早版本校对偶发漏网导致错误译文被缓存复活的闭环缺口
        const { full: glossaryMapForPurge } = buildGlossaryMaps()
        const normalizedGlossaryMapForPurge = new Map<string, string>()
        for (const [key, value] of glossaryMapForPurge) {
          const ck = cleanKey(key)
          if (ck.length >= 3 && !normalizedGlossaryMapForPurge.has(ck)) {
            normalizedGlossaryMapForPurge.set(ck, value)
          }
        }
        let purged = 0
        let glossaryPurged = 0
        for (const [key, val] of Object.entries(rawCache)) {
          if (/__[A-Z]+_\d+__/.test(val)) { delete rawCache[key]; purged++; continue }
          const srcEnd = key.indexOf('\x00')
          if (srcEnd > 0) {
            const sourceText = key.slice(0, srcEnd)
            // 旧版英文回退脏缓存
            if (sourceText && val.trim().toLowerCase() === sourceText.trim().toLowerCase()) {
              delete rawCache[key]; purged++; continue
            }
            // v10.7: 术语库合规清洗（跨语言：cleanKey 对大小写/连字符/®™©/空白不敏感）
            //        用户手动修正过的译文优先于术语库值（最高优先级），不参与清洗
            const expected = normalizedGlossaryMapForPurge.get(cleanKey(sourceText))
            if (expected) {
              const hasUserCorrection = corrections.value.some(c =>
                c.source === sourceText && c.targetLang === targetLang.value && c.correctedTranslation === val
              )
              if (!hasUserCorrection && val !== expected) {
                delete rawCache[key]
                glossaryPurged++
                console.warn('[translate] ⛔ 术语库合规缓存清洗:', sourceText.slice(0, 50), '→', val.slice(0, 40), '已删除（应为:', expected.slice(0, 40), ')')
              }
            }
          }
        }
        if (purged > 0 || glossaryPurged > 0) {
          console.warn(`[translate] 启动清理了 ${purged} 条脏缓存 + ${glossaryPurged} 条术语库违规缓存`)
          sendMsgToPlugin(UIMessage.SAVE_TRANSLATION_CACHE, rawCache)
        }
        translationCache.value = rawCache
        break
      }

      case PluginMessage.APPLY_PROGRESS: {
        const p = data as { current: number; total: number }
        applyingProgress.value.current = p.current
        applyingProgress.value.total = p.total
        break
      }

      case PluginMessage.APPLY_DONE: {
        const d = data as { count: number; failed?: number; failedNodeIds?: string[] }
        failedNodeIds.value = d.failedNodeIds || []
        const msg = d.failed
          ? `已应用 ${d.count} 条，${d.failed} 处失败`
          : `已应用 ${d.count} 条译文到画布`
        showToast(msg, d.failed ? 'error' : 'success')

        applying.value = false
        applyingProgress.value.current = 0
        applyingProgress.value.total = 0
        break
      }

      case PluginMessage.APPLY_FONTS_PROGRESS: {
        const p = data as { current: number; total: number }
        applyingProgress.value.current = p.current
        applyingProgress.value.total = p.total
        break
      }

      case PluginMessage.APPLY_FONTS_DONE: {
        applying.value = false
        applyingFonts.value = false
        applyingProgress.value.current = 0
        applyingProgress.value.total = 0
        const fd = data as { count: number; failed?: number }
        const fmsg = fd.failed
          ? `字体替换完成：${fd.count} 处，${fd.failed} 处失败`
          : `字体替换完成：${fd.count} 处`
        showToast(fmsg, fd.failed ? 'warning' : 'success')
        break
      }

      case PluginMessage.UNDO_DONE: {
        undoing.value = false
        const ud = data as { count: number; skipped?: number }
        showToast(
          `已恢复 ${ud.count} 条原文到画布（列表译文保留）` + (ud.skipped ? `，跳过 ${ud.skipped} 条手动修改` : ''),
          'success',
        )
        break
      }

      case PluginMessage.UNDO_STATE: {
        const us = data as { canUndo: boolean; count: number }
        canUndo.value = us.canUndo
        undoCount.value = us.count
        break
      }

      case PluginMessage.SELECTION_STATE:
        selectionCount.value = (data as { count: number }).count
        break

      case PluginMessage.SCAN_PROGRESS:
        scanFoundCount.value = (data as { found: number }).found
        break

      // v10.3: 主线程日志入缓冲 + 触发防抖持久化
      case PluginMessage.MAIN_LOG:
        receiveMainLog(data as UiLogEntry)
        schedulePersistUiLogs()
        break

      // v10.3: 启动时从持久化恢复上次会话日志
      case PluginMessage.UI_LOGS_LOADED:
        restoreUiLogs(data as UiLogEntry[])
        break

      case PluginMessage.GLOSSARY_PRODUCTS_LOADED:
        glossaryProducts.value = markRaw(((data as GlossaryEntry[]) || []).map(function (g: GlossaryEntry) {
          if (g.translations) return g
          return { source: g.source, translations: (g as Record<string, unknown>).target ? { en: (g as Record<string, unknown>).target as string } : {} }
        }))
        glossaryProductsLoaded = true
        checkGlossaryReady()
        break

      case PluginMessage.GLOSSARY_EXCLUSIVE_LOADED:
        glossaryExclusive.value = markRaw(((data as GlossaryEntry[]) || []).map(function (g: GlossaryEntry) {
          if (g.translations) return g
          return { source: g.source, translations: (g as Record<string, unknown>).target ? { en: (g as Record<string, unknown>).target as string } : {} }
        }))
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
        apiConfigured.value = !!(llmConfig.value.apiKey && llmConfig.value.apiUrl)
        break

      case PluginMessage.SETTINGS_SAVED:
        saving.value = false
        apiConfigured.value = !!(llmConfig.value.apiKey && llmConfig.value.apiUrl)
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
        availableFonts.value = markRaw((data as { family: string; style: string }[]) || [])
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
  sendMsgToPlugin(UIMessage.LOAD_UI_LOGS)

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
