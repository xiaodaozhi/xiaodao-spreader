# xiaodao-spreader — Design Document

A Vue 3 spreadsheet component based on Canvas 2D.

---

## 1. Tech Stack

| Layer | Choice | Version |
|---|---|---|
| Framework | Vue 3 (Composition API + `<script setup>`) | ^3.4 |
| Build | Vite | ^5.0 |
| Language | TypeScript (strict) | ~5.4 |
| Rendering | Canvas 2D API | — |
| Type Checker | vue-tsc | ^2.2 |
| Package Manager | pnpm | — |

---

## 2. File Structure

```
xiaodao-spreader/
├── index.html                          # Entry HTML, full-height layout
├── package.json
├── tsconfig.json                       # strict mode
├── tsconfig.build.json                 # declaration emit config
├── vite.config.ts                      # @vitejs/plugin-vue
└── src/
    ├── main.ts                         # createApp(App).mount('#app')
    ├── index.ts                        # Library entry — re-exports from spreader/
    ├── App.vue                         # Root component, flex full-height container
    ├── vite-env.d.ts
    └── components/
        └── spreader/
            ├── index.ts                # Unified barrel export — component + types
            ├── components/
            │   ├── spreader.vue        # Main component (Canvas rendering + all interaction logic)
            │   ├── toolbar.vue         # Toolbar with overflow dropdown
            │   ├── tabbar.vue          # Sheet tab bar
            │   ├── dropdown.vue        # Generic dropdown component
            │   └── pickers/
            │       ├── colorPicker.vue
            │       ├── borderPicker.vue
            │       ├── mergePicker.vue
            │       └── numberFormatDialog.vue
            ├── composables/
            │   ├── core-state.ts      # Props, cells/merges/selection, font metrics, navigation
            │   ├── undo-styles.ts      # Undo/redo, format painter, font/alignment/color
            │   ├── borders-merge.ts    # Border sync, merge ops, clipboard, sum/avg/count
            │   ├── sheets-ops.ts      # Row/col ops, multi-sheet, v-model emit, theme, refs
            │   ├── find-replace.ts    # Find/replace state & interaction (Vue-dependent)
            │   └── interactions.ts    # Renderer, formula bar, tab bar, context menu, scrollbar, events
            └── core/
                ├── constants.ts       # Layout constants, i18n text, theme color palette
                ├── types.ts           # All type definitions
                ├── style-pool.ts      # Style pool: dedup, registration, resolve, migration, GC
                ├── formula.ts         # Formula engine (parsing, evaluation, dependency tracking)
                ├── find-replace-core.ts # Find/replace pure algorithms (zero Vue deps, unit-testable)
                ├── number-format.ts    # Number format engine (Excel-style display formatting)
                ├── theme.ts           # Theme CSS variable construction
                └── utils.ts           # Pure utility functions (column label conversion, hit testing, etc.)
```

**Dependency Direction**: `App.vue → spreader/index.ts → spreader.vue → composables/* + core/*`

---

## 3. Type System

All type definitions are in `spreader/core/types.ts`.

```typescript
// Cell coordinates (0-based)
interface CellCoord { col: number; row: number }

// Selection range (min/max normalized)
interface SelectionRange {
  startCol: number; startRow: number
  endCol: number; endRow: number
}

// Cell style — typed interface for all style properties
interface CellStyle {
  fontFamily?: string; fontSize?: number | string; fontWeight?: string;
  fontStyle?: string; underline?: string; strikethrough?: string;
  color?: string; backgroundColor?: string;
  textAlign?: string; verticalAlign?: string; wrap?: string;
  borderTopWidth?: number; borderBottomWidth?: number;
  borderLeftWidth?: number; borderRightWidth?: number; borderColor?: string;
  numberFormat?: string;
  [key: string]: unknown;  // extensible
}

// Cell data — value is always string; style referenced via styleId
interface CellData {
  value: string
  styleId?: number  // index into sheet-level styles[] pool; 0 or omitted = default
}

// Range utility (start/end span)
interface Range {
  start: number
  end: number
}

// External data format for spreadsheet operations
interface SpreadsheetOptions {
  rowCount?: number
  colCount?: number
  colWidths?: Record<number, number>
  rowHeights?: Record<number, number>
}

// Cell reference map for import/export
interface SpreadsheetData {
  [cellRef: string]: { value: string; styleId?: number; style?: CellStyle }
}

// v-model two-way binding external data format
interface SheetModelData {
  name: string
  styles?: CellStyle[]  // style pool; styles[0] is always {}
  cells: Record<string, { value: string; styleId?: number; style?: CellStyle }>
  colWidths?: Record<number, number>
  rowHeights?: Record<number, number>
}

// Worksheet internal runtime state
interface SheetState {
  id: string; name: string
  cells: Record<string, CellData>
  styles: CellStyle[]  // style pool; styles[0] is always {}
  merges: Record<string, SelectionRange>
  selection: SelectionRange | null
  activeCell: CellCoord
  scrollX: number; scrollY: number
  colWidths: number[]; rowHeights: (number | undefined)[]
}

// Undo snapshot
interface UndoSnapshot {
  cells: Record<string, CellData>
  styles: CellStyle[]
  colWidths: number[]; rowHeights: (number | undefined)[]
}

// Context menu item
interface ContextMenuItem {
  label: string; action?: () => void; disabled?: boolean; children?: ContextMenuItem[]
}

// Point utility
interface Point {
  x: number; y: number
}

// Theme color palette (50+ color fields)
interface ThemeColors { /* See Section 10 for full list */ }
```

---

## 4. Data Model

### 4.1 Core State

| State | Type | Description |
|---|---|---|
| `cells` | `reactive<Record<string, CellData>>` | Cell data for the current sheet |
| `styles` | `reactive<CellStyle[]>` | Style pool for the current sheet; `styles[0]` is always default `{}` |
| `selection` | `ref<SelectionRange \| null>` | Current selection range |
| `activeCell` | `ref<CellCoord>` | Active cell |
| `scrollX/Y` | `ref<number>` | Grid area scroll offset |
| `editingCell` | `ref<CellCoord \| null>` | Cell being edited |
| `editValue` | `ref<string>` | Real-time text in the edit overlay |
| `colWidths` | `ref<number[]>` | Width of each column (default 100px) |
| `rowHeights` | `ref<number[]>` | Height of each row (default 24px) |
| `sheets` | `ref<SheetState[]>` | All worksheets |
| `activeSheetIndex` | `ref<number>` | Current active worksheet index |
| `undoStack` / `redoStack` | `ref<UndoSnapshot[]>` | Undo/redo stacks (max 50 steps) |

### 4.2 Computed Properties

| Property | Description |
|---|---|
| `colPositions` | Cumulative column position prefix sum `pos[i]` = starting x of column i |
| `rowPositions` | Cumulative row position prefix sum |
| `totalWidth` / `totalHeight` | Sum of all column/row dimensions |
| `maxScrollX` / `maxScrollY` | Maximum scroll range |
| `themeColors` | Selects light/dark color palette based on `theme` prop |
| `outerStyle` | Injects theme colors via CSS variables |

### 4.3 Multi-Sheet Switching

When switching sheets, `saveSheet()` → `loadSheet(i)` is executed:
- `saveSheet()` serializes current `cells`, `styles`, `selection`, `scrollX/Y`, `colWidths`, `rowHeights` to `sheets[activeSheetIndex]`
- `loadSheet(i)` restores all state from `sheets[i]`, including `styles` pool sync via `syncStyles()` and formula dependency graph rebuild

### 4.4 v-model Data Sync

`emitModelData()` serializes all sheets to `SheetModelData[]` (cells with `styleId` references + the `styles` pool array) and triggers two-way binding via `modelData.value = out`. Uses `lastEmittedData` string comparison for deduplication to avoid circular updates.

---

## 5. Layout Constants & Coordinate System

```
HEADER_WIDTH  = 52   (row header width)
HEADER_HEIGHT = 24   (column header height)
SB_SIZE       = 11   (scrollbar width/height)
ARROW_SIZE    = 11   (scrollbar arrow button size)
SCROLL_STEP   = 50   (scroll amount per click)
DEFAULT_COL_WIDTH  = 100
DEFAULT_ROW_HEIGHT = 24
MIN_COL_WIDTH  = 30
MIN_ROW_HEIGHT = 24

Grid total: default 200 rows × 26 columns
```

### 5.1 Canvas Layout Plane

```
┌──────────┬──────────────────────────────────┐
│ Corner   │  Column Headers (A, B, C... Z, AA...)  │
│ 52×24    │  y: [0, 24)  x: [52, W)          │
│ Select   │                                  │
│ All Btn  │                                  │
├──────────┼──────────────────────────────────┤
│          │                                  │
│ Row      │  Grid Area (scrollable)          │
│ Headers  │  y: [24, H)  x: [52, W)         │
│ 1,2,3... │                                  │
│          │                                  │
│ x: [0,52)│                                  │
├──────────┴──────────────────────────────────┤
│  Horizontal Scrollbar (bottom 11px) │ Vertical Scrollbar (right 11px) │
└──────────────────────────────────────────────┘
```

### 5.2 Coordinate Transformation

```
Mouse client (e.clientX, e.clientY)
        │
        ▼  getCanvasXY(e) → canvas.getBoundingClientRect()
Canvas CSS coordinates (logical pixels)
        │
        ▼  gridX = x - HEADER_WIDTH + scrollX
        │  gridY = y - HEADER_HEIGHT + scrollY
Grid content coordinates → binary search → col/row
```

---

## 6. Rendering Pipeline

### 6.1 Scheduling Mechanism

```
State Change → scheduleRender()
              │
              ▼
         renderPending? ──yes──▶ return (merge)
              │ no
              ▼
         renderPending = true
         requestAnimationFrame(render)
```

No dirty flags, no watchers. Manually call `scheduleRender()` after each interaction ends. rAF ensures multiple calls within one frame only execute one draw.

### 6.2 render() Drawing Order

1. Canvas size sync + DPR setting (`ctx.setTransform(dpr,0,0,dpr,0,0)`)
2. Background fill + grid area white background
3. Visible range calculation (cumulative per-column determination, no binary search — direct traversal in render loop)
4. Grid area cells (clip to `[52,24]` - `[W,H]`)
   - Selection highlight / active cell border / grid lines / text
5. Column headers (including selected column highlight + bold bottom border)
6. Row headers (including selected row highlight + bold right border)
7. Corner cell
8. Scrollbars rendered independently by HTML/CSS (not Canvas drawing)

### 6.3 Virtual Rendering

Visible range is determined by traversing `colPositions`/`rowPositions` to find the starting row/column, only drawing cells on screen. Average visible ~15-20 columns × 25-40 rows = 375-800 cells/frame.

### 6.4 DPR Handling

All drawing uses logical pixels (CSS pixels), uniformly scaled by `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`. Mouse coordinates returned by `getCanvasXY()` are also logical pixels.

---

## 7. Formula Engine

Located in `spreader/core/formula.ts`.

### 7.1 Supported Formulas

- `=SUM(A1:B5)` — Range summation, supports absolute references `$A$1`
- `=AVERAGE(A1:B5)` — Range average
- `=COUNT(A1:B5)` — Count numeric cells in range
- `=IF(condition, true_val, false_val)` — Conditional logic, supports comparison operators (`> < >= <= = <>`) and arithmetic in branches
- `=VLOOKUP(value, range, col_index, [approx])` — Vertical lookup, exact match by default, `TRUE` for approximate match
- `=CONCATENATE(A1, " ", B1)` — Concatenate multiple values into a string

Formula values can be `number`, `string`, or `null` (error). `null` renders as `#ERROR`.

### 7.2 Dependency Tracking

`FormulaDeps` class maintains a bidirectional dependency graph:
- **Forward**: formulaKey → [depKey, ...] (which cells the formula references)
- **Reverse**: depKey → Set<formulaKey> (which formulas depend on this cell)

When modifying a cell, dirty flags are propagated through the reverse graph. Caching is used during evaluation to avoid redundant calculations. Circular reference detection via a separate `inProgress` set (returns `null` on cycle).

### 7.3 Evaluation Cache

A module-level `evalCache: Map<string, FormulaValue>` stores computed formula results (number, string, or null). A separate `inProgress: Set<string>` tracks cells currently being evaluated for cycle detection. During evaluation:
- If a cell is in `inProgress`, return `null` (circular reference detected)
- If a cell is in cache, return the cached result
- Otherwise, mark as in-progress, evaluate, cache the result, and unmark

### 7.4 Display Value Calculation

`computeCellValue(col, row)` determines if the cell value starts with `=`:
- Yes → call `evalFormula()` for evaluation
- No → return original value

Returns `'#ERROR'` if the formula evaluates to `null`.

### 7.5 Formula Reference Offset During Paste

`shiftFormulaRefs()` automatically offsets cell references in formulas when pasting, supporting `$` absolute reference locking.

---

## 8. Interaction Model

### 8.1 Mouse

| Operation | Behavior |
|---|---|
| Click grid area | Select cell |
| Drag grid area | Extend selection |
| Shift + Click | Extend from original selection start to clicked position |
| Double-click grid area | Enter edit mode |
| Click column header | Select entire column |
| Click row header | Select entire row |
| Click corner cell | Select all |
| Drag column header right edge | Adjust column width |
| Drag row header bottom edge | Adjust row height |
| Mouse wheel | Scroll |
| Right-click | Context menu (area-dependent) |

### 8.2 Keyboard (Non-Edit Mode)

| Key | Behavior |
|---|---|
| ↑↓←→ | Move active cell |
| Tab / Shift+Tab | Move right / left |
| Enter / Shift+Enter | Move down / up |
| Home | Jump to column A of current row |
| End | Jump to last column of current row |
| Ctrl+Home | Jump to A1 |
| Ctrl+End | Jump to bottom-right corner |
| F2 | Enter edit mode |
| Delete / Backspace | Clear selection content |
| Escape | Cancel edit |
| Printable characters | Enter edit mode and input the character |
| Ctrl+C | Copy |
| Ctrl+V | Paste |
| Ctrl+X | Cut |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |
| Ctrl+A | Select all |

### 8.3 Edit Mode

- **Enter**: Double-click / F2 / direct printable character input / click formula bar
- **Overlay**: `<input>` positioned absolutely via computed style covering the Canvas cell
- **Commit**: Enter (move down) / Tab (move right) / blur
- **Cancel**: Escape
- **Formula Bar**: Displays current cell formula or value, triggers edit mode when focused

### 8.4 Touch

- Single-finger swipe → scroll (movement exceeds 8px threshold)
- Single-finger tap → select cell
- Double-tap (two clicks on same cell within 300ms) → enter edit mode

### 8.5 Context Menus

Different context menus are displayed based on clicked area:

| Area | Menu Items |
|---|---|
| Cell | Cut / Copy / Paste / Delete |
| Column Header | Insert Column / Cut / Copy / Paste / Delete |
| Row Header | Insert Row / Cut / Copy / Paste / Delete |
| Corner Cell | Cut / Copy / Paste / Clear All |
| Tab Bar Blank | New Worksheet |
| Tab Item | New / Duplicate / Rename / Delete / Move Left / Move Right |

---

## 9. Clipboard Protocol

- **Format**: TSV (Tab-Separated Values), rows separated by `\n`
- **Copy**: Traverse selection → build TSV → `navigator.clipboard.writeText()` (fallback: textarea + execCommand)
- **Paste**: `navigator.clipboard.readText()` → split by row/column → write cell-by-cell with activeCell as top-left, formula references automatically offset
- **Cut**: Copy then clear selection content

---

## 10. Theme System

### 10.1 Color Palette

`lightTheme` and `darkTheme` are defined in `spreader/core/constants.ts`, containing 50+ color fields covering all UI elements: background, text, borders, scrollbars, formula bar, tab bar, edit overlay, etc.

The `ThemeColors` interface includes:
- Grid: `bg`, `gridBg`, `gridLine`, `selectionBg`, `activeCellBorder`, `cellText`
- Headers: `headerBg`, `headerBorder`, `headerText`, `headerSep`, `cornerBg`
- Formula Bar: `formulaBarBg`, `formulaBarBorder`, `formulaBarLabelText`, `formulaBarLabelBg`, `formulaBarLabelBorder`, `formulaBarInputBg`, `formulaBarInputBorder`, `formulaBarInputText`, `formulaBarInputFocusBorder`, `formulaBarInputFocusShadow`
- Tabs: `tabBarBg`, `tabBarBorder`, `tabActiveBg`, `tabActiveText`, `tabActiveBorder`, `tabInactiveBg`, `tabInactiveText`, `tabInactiveBorder`, `tabHoverBg`, `tabAddBtnColor`, `tabAddBtnHoverBg`, `tabScrollBtnColor`, `tabScrollBtnHoverBg`
- Scrollbar: `scrollTrack`, `scrollThumb`, `scrollbarThumb`, `scrollbarThumbHover`, `scrollBtnBg`, `scrollBtnColor`, `scrollBtnHoverBg`, `scrollBtnActiveBg`, `scrollTrackBg`
- Editor: `cellEditorBorder`, `cellEditorText`, `cellEditorBg`, `cellEditorShadow`
- Wrapper: `wrapperBg`

### 10.2 CSS Variable Injection

`buildOuterStyle()` converts the theme color palette to CSS custom properties (`--sp-*`), bound to the root element via `outerStyle`. Scoped styles within the component reference these variables.

---

## 11. Responsive Adaptation

`ResizeObserver` monitors wrapper size changes, updates `viewSize` and re-clamps the scroll range. If `width`/`height` props are fixed pixel values, ResizeObserver is skipped.

---

## 12. Undo/Redo

- **Snapshot**: `takeSnap()` deep clones current `cells`, `styles`, `colWidths`, `rowHeights`
- **Stack Push**: Call `saveUndo()` before each modification, deduplicate with stack top (JSON comparison)
- **Undo**: `undoStack.pop()` → `restoreSnap()` and rebuild formula dependency graph
- **Redo**: `redoStack.pop()` → `restoreSnap()` and rebuild formula dependency graph
- **Limit**: `UNDO_MAX = 50`, removes oldest snapshot when exceeded

---

## 13. Extension Points / Roadmap

### 13.1 Data Layer
- **More Formulas**: AVERAGE, COUNT, IF, VLOOKUP, etc.
- **Cell Styles**: Styles are managed via a per-sheet Style Pool (`styles: CellStyle[]`); cells reference styles by `styleId` (array index). Identical styles are automatically deduplicated. See [Section 17](#17-样式池-style-pool) for details.
- **Merged Cells**: Extend data model to store merge information

### 13.2 Rendering Layer
- **Frozen Panes**: `frozenCols`/`frozenRows` state, split fixed and scrollable areas
- **Conditional Formatting**: Add style rule matching in render loop
- **Auto-Fill**: Drag handle at bottom-right of active cell

### 13.3 Interaction Layer
- **Find/Replace** — *now implemented, see [Section 16](#16-查找与替换-find--replace)*
- **Data Sort/Filter**
- **Charts**

### 13.4 Performance Optimization
- **OffscreenCanvas + Web Worker**: Offload rendering to worker thread
- **Dirty Rectangle Redraw**: Currently full redraw, can optimize to redraw only changed areas

---

## 15. 数字格式引擎 (Number Format)

位于 `spreader/core/number-format.ts`，是一套 Excel / Univer 风格的「显示格式化」引擎。

### 15.1 设计原则

- **只负责显示，绝不修改 `Cell.value`**：`Cell.value` 始终保持原始字符串；格式仅影响 Canvas 渲染时的显示文本。
- **解析结果按格式代码缓存**：`parseNumberFormat()` 内部用 `Map` 缓存，避免 Canvas 每帧重复解析（性能）。
- **纯函数、不依赖 Vue**：便于测试与复用。

### 15.2 存储

格式代码按单元格存入解析后样式的 `numberFormat` 属性（字符串）。存储层约定：

- 不存储该属性 / 空串 = 常规（General）。
- 文本（Text）= `'@'`。
- 常规下若原始值能解析为有限数字，按「数值」语义自动决定显示（极大/极小用科学计数法），并默认右对齐。

### 15.3 分类与格式代码

支持 General / Text / Number / Currency / Accounting / Financial / Percent / Scientific / Date / Time / DateTime / Duration / Custom。常用代码见 README「数字格式」章节的对照表。

关键行为：

- **百分比 `%`**：缩放 100 倍（`scale = 100`）。
- **会计 / 财务**：通过 `;` 分隔的正值/负值/零值区段实现，财务支持 `[Red]` 条件颜色。
- **日期 / 时间**：单元格值视为 Excel 1900 日期系统的序列号（1 = 1900-01-01，UTC 构造避免时区偏移）。非法序列号（date 超出 [0, 2958465]、duration < 0）返回 `__NF_INVALID__`，渲染端替换为连续 `#` 填充。
- **持续时间 `[h]:mm:ss`**：总小时数可超过 24。

### 15.4 渲染与对齐

- `formatNumber(value, format, locale)` 是顶层入口，返回显示字符串（绝不修改 value）。
- `shouldAlignRightByDefault(value, format)`：数值类格式及常规下的有限数字默认右对齐；Text 与常规非数字保持左对齐——与 Excel 一致。
- `isFormatOverflowsToHashes(format)` / `isInvalidDisplayValue(value, format)`：供渲染端判断是否需要用 `#` 填充。
- **i18n**：货币符号（`¥` / `$`）、月份与星期名称随 `locale` 变化。

### 15.5 界面

- 工具栏「数字格式」下拉框（`buildNumberFormatPresets`）提供预设：常规、文本、数值、百分比、科学计数、会计、财务、货币、货币取整、日期、时间、日期时间、持续时间，外加「格式…」自定义项（`NF_CUSTOM`）。
- 「格式…」打开 `numberFormatDialog.vue`，可输入自定义格式代码、设置小数位数与千位分隔符。
- 选区格式不一致时，`selNumberFormat` 返回 `NF_MIXED`（特殊标记 `0x01`），下拉框显示「混合」。

---

## 14. Development Notes

1. **Canvas DPR Consistency**: All drawing and mouse coordinates use logical pixels, uniformly scaled by `ctx.setTransform(dpr,0,0,dpr,0,0)`.

2. **Manual `scheduleRender()` After State Changes**: No automatic watcher mechanism, call once at the end of each interaction handler. rAF automatically merges multiple calls within the same frame.

3. **Edit Overlay blur vs keydown Timing**: `commitEdit` is triggered first in Enter/Tab keydown, `onEditBlur` uses `setTimeout(0)` delay to ensure keyboard submission is not interrupted by blur.

4. **Hit Testing**: `hitTestCol`/`hitTestRow` implemented as binary search (O(log n)), depends on `colPositions` computed update.

5. **v-model Debouncing**: `lastEmittedData` string comparison avoids circular updates, cell changes are emitted in batch via `watch` on `nextTick`.

6. **TypeScript Strict**: All function parameters and return values have type annotations. `vue-tsc --noEmit` runs automatically before build.

7. **Cross-Platform Compatibility**: Ctrl key uses `e.ctrlKey || e.metaKey` for Mac compatibility. Clipboard API uses async API + sync fallback.

---

## 16. 查找与替换 (Find & Replace)

位于 `composables/find-replace.ts`（状态与交互）与 `core/find-replace-core.ts`（纯算法，零 Vue 依赖，可单测）。UI 由 `find-replace-bar.vue` 提供，工具栏新增查找按钮，快捷键 `Ctrl/Cmd+F`（含 `Ctrl/Cmd+H`）打开。

### 16.1 设计原则

- **基于原始 `Cell.value`**：始终读取单元格的 `value`（字符串），**不**基于 Canvas 格式化显示文本，因此与数字格式、公式等显示层无关。
- **算法与 UI 分离**：匹配/替换的纯函数（`cellMatches` / `replaceFirst` / `replaceAllOccurrences` / `scanSheetCells`）不依赖 Vue，便于单元测试。
- **复用既有能力**：查找定位复用现有 Selection（`selectCell` / `activeCell` / `ensureVisible`）与多 Sheet（`switchSheet`），撤销/重做复用 `undo-styles` 的 snapshot 机制。

### 16.2 搜索范围

| 范围 | 实现 |
|------|------|
| 当前工作表（默认） | 仅扫描 `s.cells`（当前激活 Sheet） |
| 整个工作簿 | 遍历 `so.sheets.value` 所有 Sheet 的 `cells`，记录 `sheetIndex`；定位时跨表自动 `switchSheet` 并滚动 |
| 当前选区 | 将 `s.selection` 矩形作为 `range` 传入 `scanSheetCells`；定位时仅移动 `activeCell`，不破坏原选区矩形 |

### 16.3 匹配与替换规则

- **匹配**：默认不区分大小写、非完整匹配（子串包含）；支持「区分大小写」与「匹配整个单元格」。
- **替换**：替换仅改 `Cell.value`，且 `String()` 强制保持字符串类型，保留 `styleId` / `numberFormat` / 边框 / 合并。单元格内多匹配时，单次替换仅改首个、全部替换改所有。
- **$ 安全**：不区分大小写的全部替换用正则回调 `() => replace` 形式，避免 `replace` 字符串中的 `$&` / `$1` 被当作分组引用。

### 16.4 Undo / Redo 接入

- 单次「替换」仅在内容变化时调用一次 `us.saveUndo()`。
- 「全部替换」在循环外仅调用一次 `us.saveUndo()`（整次操作一个撤销点），并用 `results` 快照遍历，避免重算过程中 `results` 变化导致漏改。
- 撤销 / 重做后，通过 watch `undoStack` / `redoStack` 长度触发结果重算，搜索状态与匹配高亮同步刷新。

### 16.5 高亮与定位

- 通过 `s.findHighlight(col, row)` 钩子注入渲染：普通匹配返回 `'match'`、当前项返回 `'active'`。`interactions.ts` 在 render 背景阶段用 `findMatchBg` / `findActiveBg` 填充，活动格额外描边强化。
- 查找上下循环：取模实现首尾相接，`Enter` = 下一个、`Shift+Enter` = 上一个、`Esc` 关闭（均在查找栏内处理）。编辑态下 `onKeydown` 已 `return`，全局 `Ctrl/Cmd+F/H` 不与单元格编辑快捷键冲突。
- 性能：基于数据模型扫描、零 DOM；重算用 `requestAnimationFrame` 防抖，仅在关键词 / 范围 / 规则 / 单元格数据 / 替换变更时重搜。

---

## 17. 样式池 (Style Pool)

位于 `spreader/core/style-pool.ts`。实现表格级样式去重存储，减少重复样式数据的存储体积。

### 17.1 核心思路

- 每个 Sheet 维护一个 `styles: CellStyle[]` 数组，`styles[0]` 始终为默认空样式 `{}`。
- 单元格通过 `styleId`（数组下标）引用样式，而非内联存储完整样式对象。
- 相同内容的样式（即使属性顺序不同）自动复用同一 `styleId`。
- 已注册的样式对象禁止直接修改（`Object.freeze`），修改必须创建副本后重新注册。

### 17.2 StylePool 类

| 方法 | 说明 |
|------|------|
| `get(styleId)` | 根据 styleId 获取样式对象（只读，`Object.freeze`） |
| `getId(style)` | 查找或注册样式，返回对应的 styleId（相同内容自动复用） |
| `getStyles()` | 返回 styles 数组浅拷贝（用于持久化/快照） |
| `setStyles(styles)` | 直接设置 styles 数组（用于恢复快照），同时重建 index |
| `compactStyles(cells)` | Style GC：扫描 cells 实际使用的 styleId，删除未引用样式，重新生成连续 id |

**稳定 key 生成**：对属性名排序后 `JSON.stringify`，保证属性顺序不同但内容相同的样式产生相同的 key。

### 17.3 辅助函数

| 函数 | 说明 |
|------|------|
| `resolveStyle(cell, styles)` | 根据 styleId 从 styles 数组获取样式对象；styleId 不存在或为 0 时返回 null |
| `updateCellStyle(cell, patch, pool)` | 读取旧样式 → 创建副本 → 合并 patch → 注册到 pool → 更新 styleId |
| `unsetCellStyle(cell, key, pool)` | 删除单元格的某个样式属性 |
| `updateCellsStyle(cells, patch, pool)` | 批量修改多个单元格样式 |
| `migrateCells(oldCells)` | 将旧格式 cells（`{value, style}`）迁移到新格式（`{value, styleId}`），自动去重并生成 styles 数组 |
| `cloneCells(src)` | 深拷贝 cells（同时保留 styleId 引用） |

### 17.4 CoreState 集成

`CoreState` 持有 reactive `styles: CellStyle[]` 数组与闭包 `styleIndex: Map<string, number>`，对外提供：

- `registerStyle(style)` → `number`：查找或注册样式，返回 styleId
- `resolveStyle(cell)` → `CellStyle | null`：解析单元格样式
- `syncStyles(styles)`：从外部 styles 数组恢复（重建 styleIndex）
- `rebuildStyleIndex()`：从当前 styles 数组重建 index

### 17.5 序列化格式

`SheetModelData` 包含 `styles?: CellStyle[]`。序列化时：

- cells 中 `styleId=0` 时省略（默认样式），仅输出 `styleId > 0` 的单元格。
- `styles` 数组仅在长度 > 1（存在非默认样式）时输出。
- `index`（Map）仅运行时使用，不参与序列化。

### 17.6 旧数据兼容

`migrateCells()` 支持将旧格式 `{value, style}` 自动转换为新格式 `{value, styleId}`：

- 扫描所有 cells 的 `style` 属性，注册到临时 StylePool。
- 已包含 `styleId` 的 cells 直接保留。
- 返回 `{ cells, styles }`，调用方将 styles 赋给 Sheet 即可。

### 17.7 GC 策略

`compactStyles(cells)` 在保存/导出时执行（不在每次编辑时）：

1. 收集 cells 中所有实际使用的 styleId。
2. 构建旧 id → 新 id 映射，删除未被引用的样式。
3. 更新所有 cells 的 styleId 为新连续 id。
4. `styles[0]` 始终保留。
