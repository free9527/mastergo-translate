#!/usr/bin/env python3
"""
合并 Lexar 术语库拆分版 → 生成 default-glossary.ts
用法: python3 merge_glossary.py
输入: 提示词术语库/Lexar术语库_产品名_v{N}.csv
      Lexar术语库_LLM优化版_含小语种校验.csv (新版专属术语)
输出: lib/default-glossary.ts (含合并版 + 产品名 + 专属 + 产品线映射)
"""

import os, re, glob, csv, io

BASE = os.path.dirname(os.path.abspath(__file__))
GLOSSARY_DIR = os.path.join(BASE, '术语素材')  # 产品名 CSV
EXCLUSIVE_FILE = os.path.join(BASE, '术语素材', 'Lexar术语库_专属_校正版.csv')
OUTPUT = os.path.join(BASE, 'lib', 'default-glossary.ts')

def find_latest(prefix):
    pattern = os.path.join(GLOSSARY_DIR, f'{prefix}_v*.csv')
    files = glob.glob(pattern)
    if not files:
        raise FileNotFoundError(f'Cannot find {prefix}_v*.csv in {GLOSSARY_DIR}')
    def version(f):
        m = re.search(r'_v(\d+)\.csv$', f)
        return int(m.group(1)) if m else 0
    return max(files, key=version), version(max(files, key=version))

def read_csv(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    if content.startswith('﻿'):
        content = content[1:]
    lines = [l.strip() for l in content.split('\n') if l.strip()]
    return lines[0], lines[1:]

# ============================================================
# 产品名 → 产品线分类（与 llm-api.ts detectProductLine 逻辑一致）
# ============================================================
def classify_product(source):
    """对单个产品名 source 文本做产品线分类"""
    # 1. 电竞内存：ARES/THOR + DDR/DIMM
    if re.search(r'(ARES|THOR).*(DDR|DIMM)', source) or re.search(r'(DDR|DIMM).*(ARES|THOR)', source):
        return 'gaming_dimm'

    # 卡片上下文
    is_card_ctx = re.search(r'microSD|記憶卡|存储卡|SDXC|SDHC|\bSD\b|card|卡', source, re.I) and not re.search(r'Reader|读卡器|讀卡機', source, re.I)

    # 2. 电竞 SSD：PLAY/ARES/THOR + SSD/NVMe
    if not is_card_ctx:
        if re.search(r'(PLAY|ARES|THOR).*(SSD|NVMe)', source) or re.search(r'(SSD|NVMe).*(PLAY|ARES|THOR)', source):
            return 'gaming_ssd'

    # 3. 游戏存储卡：PLAY + card
    if re.search(r'PLAY.*(卡|card|microSD|SD)', source) or re.search(r'(卡|card|microSD|SD).*PLAY', source):
        return 'gaming_card'

    # 4. 专业影像
    is_reader = re.search(r'Reader|读卡器|讀卡機|Workflow\s*(CF|Go|Reader)|RW\d+', source, re.I)
    if not is_reader:
        if re.search(r'(GOLD|DIAMOND|ARMOR).*(CFexpress|microSD|SDXC|SDHC|\bSD\b|卡|card)', source, re.I) or \
           re.search(r'Professional.*(CFexpress|microSD|SDXC|SDHC|\bSD\b|卡|card)', source, re.I) or \
           re.search(r'CFexpress.*(GOLD|DIAMOND)', source, re.I) or \
           re.search(r'1667x|2000x|800x\s*PRO|1066x|1800x', source, re.I):
            return 'professional_imaging'

    # 5. PC/AI 生产力：NM/NQ/NS/EQ (需单词边界，避免匹配 M22/M400 等型号)
    if re.search(r'\bNM\d+|\bNQ\d+|\bNS\d+|\bEQ\d+', source):
        return 'pc_productivity'

    # 6. 创新生活
    if re.search(r'pexar|数字相框|數字相框|digital\s*photo\s*frame', source, re.I):
        return 'innovation_lifestyle'

    # 7. 消费存储卡：SILVER/BLUE + SD/microSD/card + 排除已归入专业影像的
    if re.search(r'\b(BLUE|SILVER)\b.*(microSD|SDXC|SDHC|\bSD\b|卡|card)', source, re.I) or \
       re.search(r'(microSD|SDXC|SDHC|\bSD\b|卡|card).*\b(BLUE|SILVER)\b', source, re.I):
        return 'consumer_cards'

    # 7b. 通用 DDR4/DDR5 内存（不含 ARES/THOR）
    if re.search(r'\bDDR[45]\b.*Memory', source, re.I):
        return 'pc_productivity'

    # 7c. High-Endurance / E-series 存储卡
    if re.search(r'High[- ]?Endurance|\bE[- ]?[Ss]eries\b', source):
        return 'consumer_cards'

    # 7d. NM Card
    if re.search(r'\bNM\s+Card\b', source, re.I):
        return 'consumer_cards'

    # 8. 移动存储
    if not is_card_ctx:
        if re.search(r'PSSD|Portable\s*SSD|Flash\s*Drive|Dual\s*Drive|Solid\s*State\s*Dual\s*Drive', source, re.I) or \
           re.search(r'JumpDrive|闪存盘|隨身碟|U盘|USB\s*闪存', source) or \
           re.search(r'读卡器|讀卡機|Reader|Enclosure|硬盘盒|硬碟盒|Workflow|SL\d+|ES\d+|RW\d+|Hub|扩展坞|擴充埠', source) or \
           re.search(r'ARMOR\s*700|Go\s*PSSD', source):
            return 'portable_storage'

    return None

ALL_PRODUCT_LINES = [
    'gaming_dimm', 'gaming_ssd', 'gaming_card',
    'professional_imaging', 'pc_productivity', 'consumer_cards',
    'portable_storage', 'innovation_lifestyle',
]

# 合法的产品线标签
VALID_LINES = set(ALL_PRODUCT_LINES) | {'common'}

def main():
    prod_file, prod_ver = find_latest('Lexar术语库_产品名')

    prod_header, prod_lines = read_csv(prod_file)
    excl_header, excl_lines = read_csv(EXCLUSIVE_FILE)

    # 产品名 header 格式: source,zh-CN,zh-TW,...
    # 专属术语 header 格式: source,产品线,zh-CN,zh-TW,...（无术语类型列）
    excl_header_cells = [c.strip() for c in excl_header.split(',')]
    normalized_excl_header = ','.join(excl_header_cells)

    # 允许产品名和专属术语的 header 不完全一致，不报 warning

    # 解析专属术语：source, 产品线, 语言列...
    # 使用 csv 模块处理引号内逗号（如 "Play Hard, Work Hard"）
    excl_entries = []  # (source, product_line, csv_line)
    excl_reader = csv.reader(io.StringIO('\n'.join(excl_lines)))
    for cells in excl_reader:
        if len(cells) < 3:
            continue
        source = cells[0].strip()
        product_line = cells[1].strip() if len(cells) > 1 else 'common'
        if product_line not in VALID_LINES:
            print(f'[WARN] Invalid product line "{product_line}" for "{source}", falling back to common')
            product_line = 'common'
        # 语言列从第2列开始（跳过 source, 产品线）
        lang_cells = cells[2:]
        normalized_line = source + ',' + product_line + ',' + ','.join(lang_cells)
        excl_entries.append((source, product_line, normalized_line))

    # 构建产品线映射
    # PRODUCT_LINE_GLOSSARY_MAP: product_line → [source1, source2, ...]
    # COMMON_GLOSSARY_SOURCES: [source1, source2, ...]
    from collections import defaultdict
    product_line_glossary = defaultdict(list)
    common_glossary = []

    # 1. 产品名分类
    prod_classified = 0
    prod_unclassified = []
    for line in prod_lines:
        source = line.split(',')[0].strip()
        if not source:
            continue
        pl = classify_product(source)
        if pl:
            product_line_glossary[pl].append(source)
            prod_classified += 1
        else:
            prod_unclassified.append(source)

    print(f'[INFO] Products classified: {prod_classified}/{len(prod_lines)}')
    if prod_unclassified:
        print(f'[INFO] Products unclassified ({len(prod_unclassified)}):')
        for s in prod_unclassified:
            print(f'  - {s}')
        # 未分类的产品名放入通用（保守策略）
        common_glossary.extend(prod_unclassified)

    # 2. 专属术语分类（直接从「产品线」列读取）
    for source, product_line, _ in excl_entries:
        if product_line == 'common':
            common_glossary.append(source)
        else:
            product_line_glossary[product_line].append(source)

    print(f'[INFO] Exclusive entries: {len(excl_entries)}')

    # 去重
    for pl in product_line_glossary:
        product_line_glossary[pl] = list(set(product_line_glossary[pl]))
    common_glossary = list(set(common_glossary))

    # 统计
    total_mapped = sum(len(v) for v in product_line_glossary.values())
    print(f'[INFO] Product line glossary: {total_mapped} entries across {len(product_line_glossary)} lines')
    for pl in ALL_PRODUCT_LINES:
        count = len(product_line_glossary.get(pl, []))
        print(f'  {pl}: {count} entries')
    print(f'[INFO] Common glossary: {len(common_glossary)} entries')

    def csv_block(lines):
        return '\n'.join(lines)

    def js_array(items):
        """生成 JS 字符串数组字面量"""
        return '[\n  ' + ',\n  '.join(f"'{s}'" for s in sorted(items)) + '\n]'

    # 生成产品线映射 TS 代码
    pl_map_lines = []
    for pl in ALL_PRODUCT_LINES:
        sources = product_line_glossary.get(pl, [])
        pl_map_lines.append(f"  '{pl}': {js_array(sources)}")
    pl_map_str = '{\n' + ',\n'.join(pl_map_lines) + '\n}'

    excl_csv_lines = [normalized_excl_header]
    for _, _, normalized_line in excl_entries:
        excl_csv_lines.append(normalized_line)

    content = f"""// Auto-generated by merge_glossary.py
// Sources: Lexar术语库_产品名_v{prod_ver}.csv ({len(prod_lines)} entries) + Lexar术语库_LLM优化版_含小语种校验.csv ({len(excl_entries)} entries)
// Version: {prod_ver}.2

export const DEFAULT_GLOSSARY_PRODUCTS_CSV = `{prod_header}
{csv_block(prod_lines)}
`

export const DEFAULT_GLOSSARY_EXCLUSIVE_CSV = `{normalized_excl_header}
{csv_block(excl_csv_lines[1:])}
`

// 术语库产品线映射：产品线 key → 该产品线相关的术语 source 列表
// 由 merge_glossary.py 根据产品名关键词 + 专属术语「产品线」列自动生成
export const GLOSSARY_PRODUCT_LINE_MAP: Record<string, string[]> = {pl_map_str}

// 通用术语（所有产品线都需要注入）
export const COMMON_GLOSSARY_SOURCES: string[] = {js_array(common_glossary)}
"""

    with open(OUTPUT, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f'[OK] Generated {OUTPUT}')
    print(f'   Products: {len(prod_lines)} entries (v{prod_ver})')
    print(f'   Exclusive: {len(excl_entries)} entries (LLM优化版)')
    print(f'   Product lines: {len(product_line_glossary)} lines, {total_mapped} entries')
    print(f'   Common: {len(common_glossary)} entries')

if __name__ == '__main__':
    main()
