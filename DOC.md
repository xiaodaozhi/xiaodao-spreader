# xiaodao-spreader: Design Document

[中文](./DOC.ZH.md) | **English**

A Vue 3 spreadsheet component based on Canvas 2D.

---

## 1. Tech Stack

| Layer | Choice | Version |
|---|---|---|
| Framework | Vue 3 (Composition API + `<script setup>`) | ^3.4 |
| Build | Vite | ^5.0 |
| Language | TypeScript (strict) | ~5.4 |
| Rendering | Canvas 2D API | - |
| Type Checker | vue-tsc | ^2.2 |
| Package Manager | pnpm | - |

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
    ├── index.ts                        # Library entry: re-exports from spreader/
    ├── App.vue                         # Root component, flex full-height container
    ├── vite-env.d.ts
    └── components/
        └── spreader/
            ├── index.ts                # Unified barrel export: component + types
            ├── components/
            │   ├── spreader.vue        # Main component (Canvas rendering + all interaction logic)
            │   ├── toolbar.vue         # Toolbar with overflow dropdown
            │   ├── tabbar.vue          # Sheet tab bar
            │   ├── dropdown.vue        # Generic dropdown component
            │   ├── find-replace-bar.vue # Find/replace bar UI
            │   └── pickers/
            │       ├── border-picker.vue          # Border picker
            │       ├── calc-picker.vue            # Sum / average / count picker
            │       ├── color-picker.vue           # Text & fill color picker
            │       ├── merge-picker.vue           # Merge cell picker
            │       ├── sort-picker.vue            # Sort dropdown
            │       ├── sort-confirm-dialog.vue    # Excel-style sort warning dialog
            │       ├── number-format-dialog.vue   # Number format custom dialog
            │       ├── insert-function-dialog.vue # Insert function dialog
            │       ├── filter-popup.vue           # Auto Filter panel (values / text / number / date + search + blanks + multi-column AND)
            │       ├── conditional-format-menu.vue       # Conditional formatting toolbar dropdown (presets + new / manage / clear rules)
            │       ├── conditional-format-rule-editor.vue # Conditional formatting "New Rule / Edit Rule" dialog
            │       ├── conditional-format-manager.vue     # Conditional formatting "Manage Rules" dialog
            │       ├── data-validation-dialog.vue    # Data validation settings dialog (Settings / Input Message / Error Alert / Apply To)
            │       ├── data-validation-dropdown.vue  # Data validation list dropdown (search + virtual list + keyboard)
            │       ├── data-validation-alert.vue    # Data validation error alert (Stop / Warning / Information)
            │       └── outline-picker.vue          # Toolbar "Group" dropdown (add / ungroup / clear, expand / collapse)
            ├── composables/
            │   ├── core-state.ts      # Props, cells/merges/selection, font metrics, navigation, outline state
            │   ├── undo-styles.ts      # Undo/redo, format painter, font/alignment/color
            │   ├── borders-merge.ts    # Border ops, merge ops, clipboard, sum/avg/count
            │   ├── sheets-ops.ts      # Row/col ops, multi-sheet, v-model emit, theme, refs
            │   ├── find-replace.ts    # Find/replace state & interaction (Vue-dependent)
            │   ├── useFloatMenuPosition.ts # Shared toolbar dropdown positioning (right-anchor + flip/clamp)
            │   └── interactions.ts    # Renderer, formula bar, tab bar, context menu, scrollbar, events
            └── core/
                ├── constants.ts       # Layout constants, i18n text, theme color palette
                ├── types.ts           # All type definitions
                ├── style-pool.ts      # Style pool: dedup, registration, resolve, migration, GC
                ├── border-pool.ts     # Border pool: dedup, registration, resolve, migration, GC
                ├── border-resolve.ts  # Shared-border conflict resolution (resolveSharedBorder)
                ├── border-color.ts    # Per-side border color: decouple color from line type, plan color changes
                ├── border-style.ts    # Border line type (solid/dashed/dotted): normalize + dash pattern
                ├── formula.ts         # Formula engine (parsing, evaluation, dependency tracking)
                ├── find-replace-core.ts # Find/replace pure algorithms (zero Vue deps, unit-testable)
                ├── sort-core.ts       # Sort pure algorithms (zero Vue deps, unit-testable)
                ├── autofill.ts        # Auto-fill pure engine (pattern inference, fill handle logic, zero Vue deps)
                ├── outline-core.ts     # Row/column grouping pure engine (validation / shifting / collapse, zero Vue deps)
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

// Single border side
interface BorderSide {
  width?: number; color?: string; style?: string;  // style reserved: solid/dashed/dotted
}

// Four-side border combination
interface BorderStyle {
  top?: BorderSide; right?: BorderSide; bottom?: BorderSide; left?: BorderSide;
}

// Border source identifier
type BorderSource = 'cell' | 'merge';

// Cell style: typed interface for all style properties
interface CellStyle {
  fontFamily?: string; fontSize?: number | string; fontWeight?: string;
  fontStyle?: string; underline?: string; strikethrough?: string;
  color?: string; backgroundColor?: string;
  textAlign?: string; verticalAlign?: string; wrap?: string;
  borderId?: number;  // index into sheet-level borders[] pool; 0 or omitted = no border
  // borderTopWidth / borderBottomWidth / borderLeftWidth / borderRightWidth / borderColor
  //   @deprecated: legacy inline border props, kept only for migrating historical data
  numberFormat?: string;
  numberFormatCategory?: 'custom';  // marks formats auto-generated by the decimal buttons on General cells
  [key: string]: unknown;  // extensible
}

// Cell data: value is always string; style referenced via styleId
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
  borders?: BorderStyle[]  // border pool; borders[0] is always {}
  cells: Record<string, { value: string; styleId?: number; style?: CellStyle }>
  colWidths?: Record<number, number>
  rowHeights?: Record<number, number>
  /** Logical column count (0-based exclusive). Defaults to 26 when omitted. */
  colCount?: number
  /** Logical row count (0-based exclusive). Defaults to 200 when omitted. */
  rowCount?: number
}

// Worksheet internal runtime state
interface SheetState {
  id: string; name: string
  cells: Record<string, CellData>
  styles: CellStyle[]  // style pool; styles[0] is always {}
  borders: BorderStyle[]  // border pool; borders[0] is always {}
  merges: Record<string, SelectionRange>
  selection: SelectionRange | null
  activeCell: CellCoord
  scrollX: number; scrollY: number
  colWidths: number[]; rowHeights: (number | undefined)[]
  /** Reactive logical dimensions: grows dynamically via ensureCapacity */
  colCount: number; rowCount: number
}

// Undo snapshot
interface UndoSnapshot {
  cells: Record<string, CellData>
  styles: CellStyle[]
  borders: BorderStyle[]
  colWidths: number[]; rowHeights: (number | undefined)[]
  /** Snapshot of logical dimensions for undo/redo */
  colCount: number; rowCount: number
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
| `borders` | `reactive<BorderStyle[]>` | Border pool for the current sheet; `borders[0]` is always default `{}`; styles reference borders via `borderId` |
| `dims` | `reactive<{colCount: number; rowCount: number}>` | **Dynamic logical dimensions**: initialised from props (default 26/200), grows via `ensureCapacity()` |
| `selection` | `ref<SelectionRange \| null>` | Current selection range |
| `activeCell` | `ref<CellCoord>` | Active cell |
| `scrollX/Y` | `ref<number>` | Grid area scroll offset |
| `editingCell` | `ref<CellCoord \| null>` | Cell being edited |
| `freeze` | `reactive<FreezePane>` | Frozen-pane view state `{ rows, cols }` (`{0,0}` = no freeze). Mutators `setFreeze(rows, cols)` / `clearFreeze()` / `getFreeze()` exposed via CoreState. See [Section 21](#21-freeze-panes) |
| `editValue` | `ref<string>` | Real-time text in the edit overlay |
| `colWidths` | `ref<number[]>` | Width of each column (default 100px), auto-expanded with `dims.colCount` |
| `rowHeights` | `ref<number[]>` | Height of each row (default 24px), auto-expanded with `dims.rowCount` |
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
- `saveSheet()` serializes current `cells`, `styles`, `borders`, `selection`, `scrollX/Y`, `colWidths`, `rowHeights`, and `dims` (colCount/rowCount) to `sheets[activeSheetIndex]`
- `loadSheet(i)` restores all state from `sheets[i]`, including `dims` via `setDims()`, `styles` pool sync via `syncStyles()`, `borders` pool sync via `syncBorders()`, and formula dependency graph rebuild

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
FILL_HANDLE_SIZE       = 6   (fill handle visual size, px)
FILL_HANDLE_HIT_PADDING = 4   (fill handle hit area expansion, px)
DEFAULT_COL_WIDTH  = 100
DEFAULT_ROW_HEIGHT = 24
MIN_COL_WIDTH  = 30
MIN_ROW_HEIGHT = 24

Default logical range: 200 rows × 26 columns
Dynamic expansion via ensureCapacity(minCol, minRow) with buffer steps (8 columns / 32 rows)
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

When a sheet has frozen panes, the top-left `freeze.cols × freeze.rows` block (and its header edges) is pinned above/beside the scrollable grid: see [Section 21](#21-freeze-panes).

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
3. Visible range calculation (cumulative per-column determination, no binary search: direct traversal in render loop)
4. Grid area cells (clip to `[52,24]` - `[W,H]`)
   - Selection highlight / active cell border / grid lines / text
   - Cell borders + merge boundary segments + corner blocks (unified via `resolveSharedBorder`)
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

- `=SUM(A1:B5)`: Range summation, supports absolute references `$A$1`
- `=AVERAGE(A1:B5)`: Range average
- `=COUNT(A1:B5)`: Count numeric cells in range
- `=IF(condition, true_val, false_val)`: Conditional logic, supports comparison operators (`> < >= <= = <>`) and arithmetic in branches
- `=VLOOKUP(value, range, col_index, [approx])`: Vertical lookup, exact match by default, `TRUE` for approximate match
- `=CONCATENATE(A1, " ", B1)`: Concatenate multiple values into a string

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
| Drag fill handle (bottom-right of selection) | Auto-fill (see [Section 22](#22-auto-fill)) |
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

- **Snapshot**: `takeSnap()` deep clones current `cells`, `styles`, `borders`, `colWidths`, `rowHeights`, and `dims` (colCount/rowCount)
- **Stack Push**: Call `saveUndo()` before each modification, deduplicate with stack top (JSON comparison)
- **Undo**: `undoStack.pop()` → `restoreSnap()` (restores dims via `setDims()`) and rebuild formula dependency graph
- **Redo**: `redoStack.pop()` → `restoreSnap()` (restores dims via `setDims()`) and rebuild formula dependency graph
- **Limit**: `UNDO_MAX = 50`, removes oldest snapshot when exceeded

---

## 13. Extension Points / Roadmap

### 13.1 Data Layer
- **More Formulas**: AVERAGE, COUNT, IF, VLOOKUP, etc.
- **Cell Styles**: Styles are managed via a per-sheet Style Pool (`styles: CellStyle[]`); cells reference styles by `styleId` (array index). Identical styles are automatically deduplicated. See [Section 17](#17-style-pool) for details.
- **Cell Borders**: Borders are managed via a separate per-sheet Border Pool (`borders: BorderStyle[]`); styles reference borders by `borderId`. Shared borders are resolved at render time. See [Section 18](#18-border-system) for details.
- **Merged Cells**: Extend data model to store merge information

### 13.2 Rendering Layer
- **Frozen Panes**: *now implemented, see [Section 21](#21-freeze-panes)*
- **Conditional Formatting**: *now implemented, see [Section 25](#25-conditional-formatting)*
- **Auto-Fill**: *now implemented, see [Section 22](#22-auto-fill)*

### 13.3 Interaction Layer
- **Find/Replace**: *now implemented, see [Section 16](#16-find--replace)*
- **Data Sort**: *now implemented, see [Section 19](#19-sorting)*
- **Auto Filter (AutoFilter)**: *now implemented, see [Section 23](#23-auto-filter-autofilter)*
- **Data Validation**: *now implemented, see [Section 26](#26-data-validation)*
- **Row / Column Grouping (Outline)**: *now implemented, see [Section 27](#27-row--column-grouping-outline)*
- **Touch & Mobile Interaction**: *now implemented - every mouse path has a symmetric touch path (select / context menu / filter hit-test / resize / range select / format brush / tab menu; popups close on outside tap). See [Section 24](#24-touch--mobile-interaction).*
- **Charts**

### 13.4 Performance Optimization
- **OffscreenCanvas + Web Worker**: Offload rendering to worker thread
- **Dirty Rectangle Redraw**: Currently full redraw, can optimize to redraw only changed areas

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

## 15. Number Format Engine

Located in `spreader/core/number-format.ts`, an Excel / Univer-style "display formatting" engine.

### 15.1 Design Principles

- **Display-only, never mutates `Cell.value`**: `Cell.value` always keeps the raw string; the format only affects the display text during Canvas rendering.
- **Parse results cached by format code**: `parseNumberFormat()` caches internally with a `Map`, avoiding per-frame re-parsing in Canvas (performance).
- **Pure functions, zero Vue dependency**: easy to test and reuse.

### 15.2 Storage

The format code is stored per-cell in the resolved style's `numberFormat` property (a string). Storage conventions:

- Property absent / empty string = General.
- Text = `'@'`.
- Under General, if the raw value parses to a finite number, the display is determined automatically by "number" semantics (very large/small use scientific notation), defaulting to right-aligned.
- **Date/time input auto-recognition (General cells only, Excel-aligned)**: when committing a value via `setCellValue`, if the cell's format is General and the input matches a common pattern, it is converted to an Excel serial value and the matching format code is applied automatically: dates (`yyyy-m-d`, `yyyy/m/d`, `yyyy年m月d日`, `m-d`/`m/d` filling the current year), times (`h:mm`, `h:mm:ss`) and datetime (date + space/`T` + time). Invalid dates (e.g. `2023-2-29`, month/day out of range) and non-matching text stay as plain text. The applied codes are the locale date/datetime presets and `h:mm:ss`, so the toolbar dropdown echoes the corresponding preset. Serials follow the 1900 date system including the 1900 leap-year correction (`parseDateTimeInput` in `core/number-format.ts`).

### 15.3 Categories & Format Codes

Supports General / Text / Number / Currency / Accounting / Financial / Percent / Scientific / Date / Time / DateTime / Duration / Custom. Common codes are listed in the README's Number Format table.

Key behaviors:

- **Percent `%`**: scaled by 100 (`scale = 100`).
- **Accounting / Financial**: implemented via `;`-separated positive/negative/zero sections; Financial supports `[Red]` conditional color.
- **Date / Time**: the cell value is treated as an Excel 1900 date-system serial number (1 = 1900-01-01, constructed in UTC to avoid timezone shift). Invalid serials (date out of [0, 2958465], duration < 0) return `__NF_INVALID__`, which the renderer replaces with a run of `#`.
- **Duration `[h]:mm:ss`**: total hours may exceed 24.

### 15.4 Rendering & Alignment

- `formatNumber(value, format, locale)` is the top-level entry, returning the display string (never mutates value).
- `shouldAlignRightByDefault(value, format)`: numeric formats and finite numbers under General default to right-aligned; Text and General non-numbers stay left-aligned: consistent with Excel.
- `isFormatOverflowsToHashes(format)` / `isInvalidDisplayValue(value, format)`: let the renderer decide whether to pad with `#`.
- **i18n**: currency symbol (`¥` / `$`), month and weekday names follow `locale`.

### 15.5 UI

- The toolbar "Number Format" dropdown (`buildNumberFormatPresets`) provides presets: General, Text, Number, Percent, Scientific, Accounting, Financial, Currency, Currency (rounded), Date, Time, DateTime, Duration, plus a "Format…" custom item (`NF_CUSTOM`).
- "Format…" opens `numberFormatDialog.vue` for entering a custom format code, decimals, and thousands separator.
- Increase/Decrease Decimal buttons (right of the dropdown) step the decimal places per cell for numeric formats (number/percent/currency, etc.) and General cells whose value parses as a number; bounds are 0–30, and a button is disabled when unsupported or at the bound. When applied to a General cell, the generated format is additionally marked `numberFormatCategory: 'custom'`: the dropdown echoes "Format…" (custom) and the dialog opens in the Custom category. Explicitly choosing a format (dropdown or dialog apply) clears the marker.
- When selection formats are inconsistent, `selNumberFormat` returns `NF_MIXED` (special marker `0x01`), and the dropdown shows "Mixed".
- The dropdown echo is normalized by category (`normalizeNumberFormatForDisplay`, display-only): codes outside the preset list: non-default decimals from the decimal buttons, changed currency symbols, non-default date/time variants, etc.: are mapped to their category preset (classification rules mirror the dialog's `detectFromCode`), and unrecognizable codes show "Format…" (custom). `selNumberFormat` keeps the raw code for storage/dialog use; `selNumberFormatDisplay` feeds the toolbar.

---

## 16. Find & Replace

Located in `composables/find-replace.ts` (state & interaction) and `core/find-replace-core.ts` (pure algorithms, zero Vue dependency, unit-testable). The UI is provided by `find-replace-bar.vue`; a find button is added to the toolbar, opened via `Ctrl/Cmd+F` (also `Ctrl/Cmd+H`).

### 16.1 Design Principles

- **Based on the raw `Cell.value`**: always reads the cell's `value` (a string), **not** the Canvas-formatted display text, so it is independent of number format, formula, and other display layers.
- **Algorithm/UI separation**: the pure match/replace functions (`cellMatches` / `replaceFirst` / `replaceAllOccurrences` / `scanSheetCells`) have no Vue dependency, easy to unit-test.
- **Reuses existing capabilities**: locating reuses existing Selection (`selectCell` / `activeCell` / `ensureVisible`) and multi-sheet (`switchSheet`); undo/redo reuses the `undo-styles` snapshot mechanism.

### 16.2 Search Scopes

| Scope | Implementation |
|-------|----------------|
| Current sheet (default) | Scans only `s.cells` (the active sheet) |
| Entire workbook | Iterates `cells` of all sheets in `so.sheets.value`, recording `sheetIndex`; locating auto `switchSheet` across sheets and scrolls |
| Current selection | Passes the `s.selection` rectangle as `range` to `scanSheetCells`; locating only moves `activeCell`, preserving the original selection rectangle |

### 16.3 Matching & Replacement Rules

- **Matching**: case-insensitive and non-exact (substring) by default; supports "match case" and "match entire cell".
- **Replacement**: replacement mutates only `Cell.value`, with `String()` coercion keeping the string type, preserving `styleId` / `numberFormat` / border / merge. For multiple matches within a cell, a single replace changes only the first; replace-all changes all.
- **`$` safety**: case-insensitive replace-all uses the regex callback form `() => replace` to avoid `$&` / `$1` in the `replace` string being treated as group references.

### 16.4 Undo / Redo Integration

- A single "Replace" calls `us.saveUndo()` only when content actually changes.
- "Replace All" calls `us.saveUndo()` once outside the loop (one undo point per operation), and iterates over a `results` snapshot to avoid missing changes caused by `results` mutating during recomputation.
- After undo/redo, watching `undoStack` / `redoStack` length triggers result recomputation, keeping search state and match highlights in sync.

### 16.5 Highlighting & Navigation

- Injected into rendering via the `s.findHighlight(col, row)` hook: ordinary matches return `'match'`, the current item returns `'active'`. `interactions.ts` fills `findMatchBg` / `findActiveBg` during the render background phase, and strokes the active cell for emphasis.
- Wrap-around find: modulo achieves head-to-tail wrap; `Enter` = next, `Shift+Enter` = previous, `Esc` closes (all handled inside the find bar). In edit mode `onKeydown` already `return`s, so global `Ctrl/Cmd+F/H` does not conflict with cell-edit shortcuts.
- Performance: scans the data model, zero DOM; recomputation is debounced with `requestAnimationFrame`, re-searching only when keyword / scope / rules / cell data / replacement changes.

---

## 17. Style Pool

Located in `spreader/core/style-pool.ts`. Implements sheet-level style deduplication to reduce the storage footprint of repeated style data.

### 17.1 Core Idea

- Each sheet maintains a `styles: CellStyle[]` array; `styles[0]` is always the default empty style `{}`.
- Cells reference styles by `styleId` (array index) rather than inlining full style objects.
- Identical styles (even with different property order) automatically reuse the same `styleId`.
- Registered style objects must not be mutated directly (`Object.freeze`); modifications require creating a copy and re-registering.

### 17.2 StylePool Class

| Method | Description |
|--------|-------------|
| `get(styleId)` | Get a style object by styleId (read-only, `Object.freeze`) |
| `getId(style)` | Look up or register a style, returning its styleId (identical content auto-reused) |
| `getStyles()` | Return a shallow copy of the styles array (for persistence/snapshot) |
| `setStyles(styles)` | Directly set the styles array (for restoring a snapshot), rebuilding the index |
| `compactStyles(cells)` | Style GC: scan styleIds actually used by cells, drop unreferenced styles, regenerate contiguous ids |

**Stable key generation**: sort property names then `JSON.stringify`, so styles with the same content but different property order produce the same key.

### 17.3 Helper Functions

| Function | Description |
|----------|-------------|
| `resolveStyle(cell, styles)` | Get the style object from the styles array by styleId; returns null when styleId is missing or 0 |
| `updateCellStyle(cell, patch, pool)` | Read old style → copy → merge patch → register into pool → update styleId |
| `unsetCellStyle(cell, key, pool)` | Remove a single style property from a cell |
| `updateCellsStyle(cells, patch, pool)` | Batch-update styles of multiple cells |
| `migrateCells(oldCells)` | Migrate legacy cells (`{value, style}`) to the new format (`{value, styleId}`), auto-deduplicating and generating the styles array |
| `cloneCells(src)` | Deep-clone cells (preserving styleId references) |

### 17.4 CoreState Integration

`CoreState` holds a reactive `styles: CellStyle[]` array and a closure `styleIndex: Map<string, number>`, exposing:

- `registerStyle(style)` → `number`: look up or register a style, returning styleId
- `resolveStyle(cell)` → `CellStyle | null`: resolve a cell's style
- `syncStyles(styles)`: restore from an external styles array (rebuild styleIndex)
- `rebuildStyleIndex()`: rebuild the index from the current styles array

### 17.5 Serialization Format

`SheetModelData` includes `styles?: CellStyle[]`. On serialization:

- Cells with `styleId=0` omit it (default style); only cells with `styleId > 0` are emitted.
- The `styles` array is emitted only when its length > 1 (non-default styles exist).
- The `index` (Map) is runtime-only and not serialized.

### 17.6 Legacy Data Compatibility

`migrateCells()` converts the legacy `{value, style}` format to the new `{value, styleId}` format:

- Scans every cell's `style` property and registers it into a temporary StylePool.
- Cells already carrying `styleId` are kept as-is.
- Returns `{ cells, styles }`; the caller assigns styles to the sheet.

### 17.7 GC Strategy

`compactStyles(cells)` runs at save/export time (not on every edit):

1. Collect all styleIds actually used by cells.
2. Build an old-id → new-id map and drop unreferenced styles.
3. Update every cell's styleId to the new contiguous id.
4. `styles[0]` is always preserved.

---

## 18. Border System

Located in `spreader/core/border-pool.ts` and `spreader/core/border-resolve.ts`. Borders are decoupled from regular styles, stored with dedicated deduplication, and resolved for shared edges at render time.

### 18.1 Data Structures

- `BorderSide`: a single border side `{ width?, color?, style?, owner? }` (`style` is the line type `solid` / `dashed` / `dotted`, decoupled from `color`/`width`; legacy borders with no `style` default to `solid`, and `solid` stores no `style` key so its dedup key matches historical empty-border data; `owner` optional, set by explicit border/selection operations as a render-time priority hint for shared-edge resolution).
- `BorderStyle`: a four-side combination `{ top?, right?, bottom?, left? }`, each side stored independently.
- `CellStyle.borderId`: a style references a border via `borderId` (index into `borders`); `0` or omitted means no border.
- Legacy inline props (`borderTopWidth` / `borderBottomWidth` / `borderLeftWidth` / `borderRightWidth` / `borderColor`) are marked `@deprecated`, used only for migrating historical data.

### 18.2 BorderPool

A border pool isomorphic to StylePool:

| Method | Description |
|--------|-------------|
| `get(borderId)` | Get a border object by borderId (read-only, `Object.freeze`) |
| `getId(border)` | Look up or register a border, returning its borderId (identical content auto-reused) |
| `getBorders()` / `setBorders(borders)` | Return a shallow array copy / restore a snapshot and rebuild the index |
| `compactBorders(styles)` | Border GC: drop borders unreferenced by styles, regenerate contiguous ids |

Constraints: `borders[0]` is always the default empty border `{}`; registered borders are frozen via `Object.freeze`: modifications require copying and re-registering; `index` (Map) is runtime-only and not serialized.

Helper functions: `getCellBorderSide` / `getCellBorder` / `setCellBorderSide` / `setCellBorder` / `clearCellBorder` / `migrateBordersInStyles` / `cleanupMergeInternalBorders`.

### 18.3 Shared-Border Resolution (resolveSharedBorder)

`border-resolve.ts` provides unified conflict resolution for adjacent borders, producing a single visual result:

1. Both sides empty → do not draw.
2. Only one side present → use that side.
3. Both present:
   a. If exactly one side carries `owner: true` (set by an explicit border or selection operation), that side wins the shared edge, regardless of width.
   b. Otherwise the larger `width` wins; on equal width → the `first` side wins (stable tie-break).
4. `firstSource`/`secondSource` (`'cell'`/`'merge'`) are reserved parameters that currently do not affect priority: merge does not unconditionally override cell.

When the renderer draws borders and corner blocks, every adjacent edge goes through this function. **Setting a border no longer synchronizes neighboring cells** (the old `syncCellBorders` mechanism has been removed).

### 18.4 Merged-Cell Borders

- **Write redirect to anchor**: a merged region's borders are stored uniformly on the anchor (top-left) cell; writing a border to an internal cell of the merge is automatically redirected to the anchor.
- **Internal edges masked**: grid lines inside the same merged region are not drawn (`isSameMergeInternal`).
- **Boundary segment resolution**: the top/bottom/left/right outer boundaries of a merged region are split by column/row, resolved segment-wise against neighbors via `resolveSharedBorder`; the four corners separately fill in corner blocks.
- Reads also redirect through the anchor (renderer-side `getBorderSideAt`), ensuring write and render consistency.

### 18.5 Serialization & Migration

- `SheetModelData` / `SheetState` / `UndoSnapshot` all add `borders: BorderStyle[]`.
- `migrateBordersInStyles(styles)`: migrates legacy inline border props into the `borders` pool + `borderId` mechanism.
- On load: if `smd.borders` exists it is used directly; otherwise migration runs over `styles`.

### 18.6 Line Type (solid / dashed / dotted)

- **Per-side property**: line type is set on each `BorderSide.style`, independent of `color`/`width`; changing it never overwrites the others.
- **Pen model**: the border picker's **Line Type** submenu sets the active pen line type; subsequent border operations (top / bottom / left / right / outside / all) apply it to the corresponding edges. Selecting a line type also updates the selection's *existing* edges, but never creates a border that isn't there.
- **Conflict rule**: changing a line type writes `owner: true` on the affected side, so shared-edge priority follows the existing `resolveSharedBorder` owner rule; neighbor cells are not mutated.
- **Rendering**: `interactions.ts` draws dashed/dotted borders through `paintBorderEdge` (solid keeps the original `fillRect` path so grid lines and the selection frame are unaffected).
- **Pure logic**: `core/border-style.ts` provides `normalizeBorderLineStyle` (legacy default `solid`) and `borderLineDash` (dash pattern per style/width); `core/border-color.ts` provides `withBorderStyle` / `planBorderStyleChanges` / `resolveSelectionBorderLineStyle`. All are Vue/Canvas-free and unit-tested.

---

## 19. Sorting

Located in `spreader/composables/sheets-ops.ts`, with `SortConfirmDialog.vue` providing the warning UI. Sorts the rows of the selected column range by their **displayed content**: numbers, dates, and text are all supported.

### 19.1 Key Column & Display-based Comparison
- The **key column** (the column that decides row order) is the first column of the user's *original* selection. When the selection is expanded via the Sort Warning dialog, the key column stays fixed at the original selection's first column: it does **not** shift to the leftmost expanded column.
- Comparison keys come from `parseSortKeyByDisplay(raw, format, locale)`:
  - Numbers / dates compare by their **displayed numeric value**; percent formats scale back by 100 so `100%` sorts as `100`, matching what the eye sees.
  - Text (including the explicit Text format `@`) compares by the rendered string from `formatNumber`.
  - A non-numeric cell inside a numeric-format column falls back to its display text instead of throwing.

### 19.2 Data-only, Style-preserving
Sorting moves only `Cell.value`; the target cell's `styleId` stays in place. Styles (border / fill / font / number format) never travel with the row, so sorting reorders content without disturbing per-cell styling.

### 19.3 Blocking Conditions
`analyzeSortRange` returns `blocked: true` (disabling sort) when the selected range contains:
- a **formula cell** (value starts with `=`), because row permutation would corrupt formula references (the current formula architecture does not rewrite references);
- a **merged cell** whose row range intersects the selection's row range (the column already overlaps).

Both conditions mirror the right-click column-menu "Sort" availability (`canSortColumns`).

### 19.4 Sort Warning Dialog (Excel-style)
When the selection has adjacent data outside it, an Excel-style **Sort Warning** dialog (`SortConfirmDialog.vue`) appears before sorting:
- **Expand the selection**: the sort range extends *horizontally* to adjacent columns that have data (rows stay exactly as the user selected); the key column remains the original first column.
- **Sort the current selection only**: sort exactly the selected rectangle.

Detection uses `getCurrentRegion(sel)` (horizontal-only expansion) + `needsSortConfirmation(sel)`. The flow is driven by `prepareSortConfirmation` / `confirmSort(expand)` / `cancelSortConfirmation`.

### 19.5 Auto Number Recognition (input)
Input text such as `100%`, `1,234`, `¥1,234.56` is recognized by `parseNumericText` (in `core/number-format.ts`) and stored as a number with the matching format; this is wired into `setCellValue` (in `composables/core-state.ts`) right after date recognition. This makes the display-based sort treat `100%` as the numeric `1` (scaled back on display): consistent with the comparison rule in §19.1.

---

## 20. Dynamic Range Expansion

Located in `composables/core-state.ts` and `composables/sheets-ops.ts`. Transforms the worksheet from a fixed 26×200 grid into an Excel-like dynamically-expandable sheet.

### 20.1 Core Data Structure

Each sheet maintains a **reactive** logical range via `dims`:

```typescript
// In CoreState (reactive)
dims: { colCount: number; rowCount: number }
```

- Initialised from the `colCount`/`rowCount` props (default: 26 columns, 200 rows).
- Grows monotonically: never shrinks automatically (only explicit sheet reset/load can reduce it).
- Persisted as `colCount`/`rowCount` in `SheetModelData` for save/load round-tripping.

### 20.2 ensureCapacity(minCol, minRow)

The unified expansion entry point in `CoreState`:

```typescript
ensureCapacity(minCol: number, minRow: number): void
```

- If the current `dims.colCount` < `minCol`, expands columns; if `dims.rowCount` < `minRow`, expands rows.
- Expansion uses **buffer steps** (`COL_EXPAND_STEP = 8`, `ROW_EXPAND_STEP = 32`) to reduce frequent resize overhead:
  ```
  newColCount = Math.ceil(minCol / 8) * 8   // rounds up to next multiple of 8
  newRowCount = Math.ceil(minRow / 32) * 32 // rounds up to next multiple of 32
  ```
- Auto-expands `colWidths`/`rowHeights` arrays to match the new dims with default values.
- Returns immediately if no expansion is needed (idempotent).

### 20.3 Expansion Triggers

Expansion is triggered automatically when user actions would cross the current boundary:

| Trigger | Location | Behavior |
|---|---|---|
| **Scroll near boundary** | `interactions.ts` → `onWheel` | When scrolling within 40px of the right/bottom edge, estimates visible columns/rows and calls `ensureCapacity()` |
| **Keyboard navigation past boundary** | `core-state.ts` → `moveActive()` | Arrow keys / PgUp/PgDn that would move beyond current dims expand the range first, then clamp |
| **Input at boundary** | `core-state.ts` → `setCellValue()` | Writing a non-empty value to a cell calls `ensureCapacity(col, row)` to guarantee the target exists |
| **Paste beyond range** | `borders-merge.ts` → `pasteFromClipboard()` | Calculates the paste target range and calls `ensureCapacity()` before writing |
| **Insert rows/columns that push data out** | `sheets-ops.ts` → `insertRows()`/`insertCols()` | Uses `findLastDataExtents()` to detect if the last data row/col would be pushed beyond current range; expands only when non-default cells (data or custom format) are at risk, not for empty default cells |

### 20.4 Conditional Expansion for Insert/Delete

Insert operations use `findLastDataExtents()` to locate the actual last column/row containing data or custom formatting:

```typescript
function findLastDataExtents(): { lastCol: number; lastRow: number }
```

- Scans `cells` to find the maximum column/row that has either a non-empty value or a non-default `styleId` (`> 0`).
- If inserting would push `lastCol + n` beyond the current `colCount`, expansion is triggered.
- Inserting at the boundary **always** expands (since new empty rows/columns at the edge represent intentional user intent).
- Default-format empty cells being pushed out does **not** trigger expansion: matching Excel's behavior.

### 20.5 Sparse Storage Compatibility

Expansion works seamlessly with the existing sparse cell storage:

- Expanding logical range **does not create empty cells**: cells are only stored when they have actual data.
- `colWidths`/`rowHeights` arrays are padded with default values (100px / 24px) for the new range.
- Undo/redo snapshots include `colCount`/`rowCount`, so range expansion/contraction is properly reversible.
- Sheet serialization (`SheetModelData`) includes `colCount?`/`rowCount?` for persistence.

### 20.6 Column Name Conversion

Column labels use Excel-style naming (A→Z→AA→AZ→BA→...→ZZ→AAA...), implemented in `core/utils.ts`:

- `colToLabel(col: number): string`: converts 0-based column index to letter label
- `labelToCol(label: string): number`: converts letter label back to 0-based index

These utilities handle header rendering, cell reference parsing, and formula column references across the full dynamic range.

### 20.7 Integration Notes

- **All dependent calculations** (`colPositions`, `rowPositions`, `totalWidth`, `totalHeight`, `maxScrollX`, `maxScrollY`) are computed properties that reactively depend on `dims.colCount`/`dims.rowCount`, so they automatically update when the range expands.
- **Canvas rendering** iterates only the visible area via virtual scrolling; expansion does not impact rendering performance.
- **Selection** (including select-all) uses `dims` for boundary calculation, so expanded ranges are fully selectable.
- **Copy-paste** operations respect dynamic boundaries; the clipboard protocol (TSV) is unchanged.

---

## 21. Freeze Panes

Located in `composables/core-state.ts` (state + `setFreeze` / `clearFreeze` / `getFreeze`), `composables/sheets-ops.ts` (per-sheet persistence + insert/delete clamping), `components/spreader.vue` (dedicated overlay canvas + toolbar event routing), `components/toolbar.vue` (menu), and `composables/interactions.ts` (cross-freeze merged-cell rendering).

### 21.1 State Model

Each sheet holds a reactive `freeze: FreezePane` where `FreezePane = { rows: number; cols: number }`: the number of frozen top rows and left columns. `{ rows: 0, cols: 0 }` means no freeze.

- `setFreeze(rows, cols)`: clamps both to `[0, rowCount]` / `[0, colCount]` and assigns; designed to **preserve the other axis** when widening (e.g. *Freeze First Row* keeps any already-frozen columns).
- `clearFreeze()`: resets both to 0.
- `getFreeze()`: returns a plain snapshot `{ rows, cols }`.

### 21.2 Persistence

`freeze` is per-sheet **view state**, persisted alongside cell data:

- Saved into `SheetState.freeze` and serialized to `SheetModelData.freeze?: FreezePane` during v-model emit / sheet save (`sheets-ops.ts` copies the reactive `s.freeze` into `sh.freeze`).
- Restored on sheet load, clamped to the new `[rowCount, colCount]`.
- Explicitly **excluded from undo/redo**: `undo-styles.ts` re-applies the live `currentFreeze` after every restore, so freezing/unfreezing never pollutes the cell-data undo stack.
- Row/column insert/delete deterministically keep frozen rows/cols within the new range (`sheets-ops.ts` clamps `freeze.rows` / `freeze.cols` after each op).

### 21.3 Toolbar Entry

The "Freeze Panes" dropdown (`freezeOptions` in `toolbar.vue`) adapts to the current state:

| State | Menu items |
|---|---|
| No freeze | 冻结窗格 (Freeze Panes) · 冻结首行 (Freeze First Row) · 冻结首列 (Freeze First Column) |
| Already frozen | 取消冻结 (Unfreeze) · 冻结首行 · 冻结首列 |

- **Freeze Panes** (`panes`) freezes at the **top-left corner of the current selection / active cell** (`rows = sel.startRow`, `cols = sel.startCol`): Excel's "Freeze Panes" semantics.
- **Unfreeze** replaces the "Freeze Panes" entry (mutual exclusion) and calls `clearFreeze()`.
- Every item carries an SVG icon; the trigger button itself uses the freeze icon, and first-row / first-col / unfreeze have their own dedicated SVGs.
- Selecting *Freeze First Row* / *Freeze First Column* keeps the existing frozen axis (freezing first row preserves frozen columns and vice-versa).

Routing: `toolbar.vue` emits `freeze-change`, `spreader.vue`'s `onFreezeChange` maps `panes` → `setFreeze(startRow, startCol)`, `firstRow` → `setFreeze(1, cur.cols)`, `firstCol` → `setFreeze(cur.rows, 1)`, `unfreeze` → `clearFreeze()`, then `scheduleRender()`.

### 21.4 Rendering Architecture

Freeze panes are drawn on a **separate overlay canvas** (`freezeCanvasRef`, `z-index: 1`) layered above the body canvas (`z-index: 0`). For each frame, `renderFrozenOverlay` composites three panes, each clipped to its own viewport:

- **Corner pane**: the frozen-rows × frozen-cols top-left block
- **Top frozen-rows pane**: the band of frozen rows across the scrollable width
- **Left frozen-cols pane**: the band of frozen columns across the scrollable height

`cellToScreenRect(row, col)` is freeze-aware: a cell in a frozen direction **does not** add `scrollX`/`scrollY`, while a body-direction cell does. This pins frozen cells while the body scrolls underneath. Both canvases share the same coordinate system, so the overlay aligns perfectly with the body.

### 21.5 Cross-Freeze-Line Merged Cells

A merged cell that straddles the freeze line is drawn by `drawMergedCells(ctx, vx, vy, vw, vh)` using **region-intersection** against the current pane's viewport, instead of relying on clip alone:

- The merge's full screen rectangle is synthesized from its **anchor** (top-left, frozen-aware) and **end cell** (bottom-right, body-aware): its width is `(endCell.right − anchor.left)`, which naturally shrinks by `scrollX` on the body side.
- **Background**: in a frozen pane the visible segment's right boundary is fixed at the freeze divider; in a body pane it follows `scrollX`.
- **Text**: laid out from the merge's *logical* width (independent of scroll) so wrapping / overflow / alignment stay stable; drawn at the frozen anchor for frozen panes and at `anchor − scroll` for body panes: the two layers' clips splice into one continuous title (frozen part pinned, body part scrolling).
- **Borders**: top/bottom/left/right edges are segmented per column/row (already freeze-aware); the **right edge and the top-right / bottom-right corner blocks belong to the body segment** and are drawn only where the merge crosses into the body, so they scroll away correctly.

This guarantees the frozen portion stays pinned and the non-frozen portion scrolls off, including merged cells spanning the divide.

### 21.6 Integration Notes

- Freeze is independent of the scroll math elsewhere (`maxScrollX/Y`, hit-testing): frozen rows/cols are simply excluded from the scrollable viewport.
- Switching sheets restores each sheet's own `freeze` automatically.

---

## 22. Auto Fill

An Excel-style fill-handle mechanism. The pure engine lives in `spreader/core/autofill.ts` (zero Vue/Canvas deps, fully unit-tested in `test/autofill.test.ts`); the canvas/interaction layer lives in `composables/interactions.ts`; the commit entry point `applyAutoFill` lives in `composables/core-state.ts`.

### 22.1 Design Principles

- **Algorithm/UI separation**: the pure functions (`parseFillValue` / `inferFillPattern` / `generateFillValue` / `applyAutoFillPlan` / `computeTargetRange` / `translateFormulaForTarget` / `validateMergeCompatibility`) have no Vue/Canvas dependency, easy to unit-test and reuse for `Ctrl+D`/`Ctrl+R`, paste-fill, right-click fill, etc.
- **No data mutation during drag**: during the drag only `autoFillState.targetRange` is updated for preview rendering; actual cell writes happen once on `mouseup`.
- **One undo step per drag**: `saveUndo()` is called once at commit; dynamic `ensureCapacity()` is folded into the same step.
- **Reuses existing capabilities**: formula translation calls `shiftFormulaRefs()` (no second formula engine); style copy reuses `styleId` via the style pool; border handling stays on the existing `border-resolve.ts` path; freeze compatibility flows through the existing `cellToScreenRect` / `screenToCell` APIs.

### 22.2 Pure Engine (`core/autofill.ts`)

#### 22.2.1 FillValue: value classification

`parseFillValue(value, locale): FillValue` classifies a raw cell value (priority: formula > date > text-number > number > text):

| Kind | Matched when | Stored payload |
|------|--------------|----------------|
| `formula` | value starts with `=` | the formula string |
| `date` | `parseDateTimeInput` succeeds | Excel 1900-date-system serial |
| `text-number` | non-empty prefix + trailing digits | `{ prefix, num, digits }` |
| `number` | `isNumericValue` | the number |
| `text` | fallback | the raw string |

#### 22.2.2 Pattern inference

`inferFillPattern(sourceValues: FillValue[]): FillPattern`:

| Pattern | Triggered when | Parameters |
|---------|----------------|------------|
| `copy` | single value, non-constant diff, mixed kinds | `sourceValues` |
| `linear` | all numbers, constant diff | `{ step, base, sourceLen }` |
| `date-linear` | all dates, constant diff (single date → step=1) | `{ step, baseSerial, sourceLen }` |
| `text-number` | all text-number, same prefix, constant num diff | `{ prefix, step, base, digits, sourceLen }` |
| `text-series` | single ASCII letters with constant charCode diff | `{ step, baseCharCode, sourceLen }` |
| `formula` | any formula in source | (translation handled in plan) |

#### 22.2.3 Target range calculation

`computeTargetRange(sourceRange, draggedCell): { targetRange, direction } | null`:

- Direction = the axis (row/col) with the larger offset between source and dragged cell.
- Returns `null` when the dragged cell falls inside the source range (cancel).
- Never overlaps the source range: the target is always the *new* cells beyond the source boundary.
- Supports all four directions: up / down / left / right; reverse fills (up/left) generate values by decrementing the inferred step.

#### 22.2.4 Formula translation

`translateFormulaForTarget(formula, sourceCell, targetCell, colCount, rowCount, colToLabel)` wraps the existing `shiftFormulaRefs()`, passing `targetCol - sourceCol` / `targetRow - sourceRow` as offsets. The `$` absolute/ mixed rules are handled entirely by `shiftFormulaRefs`.

#### 22.2.5 Merge compatibility

`validateMergeCompatibility(sourceRange, targetRange, merges): boolean`:

- `true` when no merges intersect either range, or every intersected merge is fully contained by the source/target range (whole-block fill).
- `false` when a merge partially intersects the source or target range: the fill handle greys out and drag is disabled (conservative first version).

#### 22.2.6 applyAutoFillPlan

`applyAutoFillPlan(sourceRange, targetRange, sheet, direction, locale, colCount, rowCount, colToLabel): FillResult`:

- Returns a `{ cells, merges }` increment: does **not** mutate the input sheet.
- For each column (vertical fill) or row (horizontal fill) in the source range, independently infers the pattern from the source cells in that line, then generates values for the target cells in that line.
- Formula cells are translated via `translateFormulaForTarget`; the source/target cell correspondence is by offset within the fill line.
- Copies the source cell's `styleId` (no deep style clone): reuses the style pool.
- For reverse fills (up/left), the pattern step is negated so values decrement from the source start.

### 22.3 Interaction Layer (`composables/interactions.ts`)

#### 22.3.1 Fill handle rendering

`drawFillHandle(ctx, cs)` draws a `FILL_HANDLE_SIZE` square at the bottom-right corner of the current selection's end cell (via `cellToScreenRect`), filled with `cs.activeCellBorder` (theme primary), or `cs.scrollTrack` (grey) when the selection partially intersects a merge. Called at the end of both `render()` and `renderFrozenOverlay()` so the handle shows above frozen content. A 1px white stroke improves visibility.

`drawAutoFillPreview(ctx, cs)` renders the `targetRange` as a semi-transparent fill (`cs.selectionBg`) with a dashed border (`cs.activeCellBorder`) during an active drag. Also called in both render paths.

#### 22.3.2 Hit-test

`isFillHandleHit(x, y): boolean`:

- Returns `false` when there is no selection, the editor is open, or the selection partially intersects a merge.
- Hit area = `FILL_HANDLE_SIZE + 2 × FILL_HANDLE_HIT_PADDING` (14×14px) centred on the handle's corner: large enough for touch without enlarging the visual size.
- Called in `onMouseDown`/`onTouchStart` **after** the resize-handle checks and **before** the cell-click branch; called in `onMouseMove` hover branch to switch to `crosshair` cursor.

#### 22.3.3 State machine

A dedicated `autofilling` state (`s.autoFillState`) is mutually exclusive with selection drag / editor / resize:

| Phase | Trigger | State change |
|-------|---------|--------------|
| Start | `mousedown` on handle | `autoFillState = { active: true, sourceRange: sel, targetRange: null, direction: null, preview: true }` |
| Move | `mousemove` / `touchmove` | `updateAutoFillPreview(x, y)` → `computeTargetRange` → update `targetRange` + `direction` |
| Commit | `mouseup` / `touchend` | `commitAutoFill()` → `applyAutoFill(source, target, direction)` → reset state |
| Cancel | ESC / pointercancel | reset state + `cancelAutoScroll()` |

#### 22.3.4 Edge auto-scroll

When the mouse is within 30px of any viewport edge during an active drag:

- A single `requestAnimationFrame` loop (`autoScrollStep`) scrolls via `clampScroll` and recomputes the target range from the current mouse coordinates.
- Single-instance guard (`autoScrollRAF !== null` check) prevents multiple loops.
- Stopped on `mouseup` / ESC / `onMouseLeave` via `cancelAutoScroll()`.

#### 22.3.5 Touch

Touch shares the exact same `autoFillState` / `updateAutoFillPreview` / `commitAutoFill` path as mouse: no separate implementation. The 14×14px hit area prevents accidental touch-selection triggering.

### 22.4 Commit (`composables/core-state.ts`)

`applyAutoFill(sourceRange, targetRange, direction)`:

1. `saveUndo()`: one snapshot before any mutation.
2. `ensureCapacity(targetRange.endCol, targetRange.endRow)`: dynamic expansion, folded into the same undo step.
3. `applyAutoFillPlan(...)`: compute the pure `{ cells, merges }` increment.
4. Write each target cell: set `value` + `styleId`; update `formulaDeps` (parse refs if formula, clear otherwise); `markDirty` for recalculation.
5. `selectRange(union of source + target)`: selection updates to the full filled range.
6. `scheduleRender()` + `emitModelData()`.

### 22.5 Integration Notes

- **Formula recalculation**: after commit, `formulaDeps.markDirty` + `clearEvalCache` ensure dependent formulas re-evaluate on the next render.
- **Style pool**: target cells reuse source `styleId` directly: no new style registration needed unless the source itself changes.
- **Border system**: AutoFill copies `styleId` (which carries `borderId`); shared-border resolution at render time is unchanged: no neighbour mutation introduced.
- **Freeze panes**: all coordinates go through `cellToScreenRect` / `screenToCell`; the handle is drawn in both `render` and `renderFrozenOverlay`, so it stays visible above frozen content.
- **Dynamic expansion**: `ensureCapacity` is called before `applyAutoFillPlan`, and the pure plan does not enforce bounds: the caller guarantees capacity.
- **Undo/Redo**: one `saveUndo()` per drag; the snapshot includes `colCount`/`rowCount` so dynamic expansion is reversible.

---

## 23. Auto Filter (AutoFilter)

An Excel-style auto filter on a normal range. Designed as a "Sheet-level feature bound to a data Range", not a "per-column-header filter". The filter arrow is drawn on the Canvas header (no DOM); the filter panel uses Vue DOM.

### 23.1 Data Model

The filter state lives as a single `SheetFilter` object per sheet (`SheetState.filter` / `SheetModelData.filter`); a sheet allows only one AutoFilter range at a time:

```typescript
interface SheetFilter {
  range: SelectionRange;            // filter region (incl. header row), e.g. A1:F100
  columns: Record<number, FilterColumn>;  // column key → criteria; absent key = column not filtered
}

type FilterColumn =
  | { type: 'values'; values: string[] }       // by value (FILTER_BLANK = blanks)
  | { type: 'text'; condition: TextCondition }
  | { type: 'number'; condition: NumberCondition }
  | { type: 'date'; condition: DateCondition };
```

- `range.startRow` is the header row (always visible, never filtered); only rows `startRow+1 … endRow` are hidden.
- Only columns inside `range` get an arrow (`isColumnInFilterRange`); outside columns (incl. column A / G) show none.
- Hidden rows use the existing `filteredOutRows` + visible-row mapping; rows are **never deleted or copied** - original row indices are preserved.

### 23.2 Enable & toggle

Triggered by the toolbar **Data → Filter** or `Ctrl+Shift+L` → `toggleAutoFilter()`:

- **Not enabled → create**: probe priority is "current multi-cell selection" → "active cell's current row probing downward for the contiguous data region" → whole data-used region (`getDataRange`); empty sheet returns `null`, no invalid filter created.
- **Enabled → remove entirely**: restores hidden rows, clears all column criteria, removes header arrows. The toolbar button's highlighted state exactly matches its click behavior (highlight = enabled, click = off).
- Single cell / single-row multi-column: the selected row is the header row, the column range is the selection (single = that column), then probe **downward** row by row for the last contiguous data row.
- A single merged cell (multi-cell merge) with no active filter sets `canFilter=false` (a merged cell cannot be a valid data-region header).
- Backward compat: `normalizeLoadedFilter` migrates the old `column → filter` shape into `range + columns` on load; missing `range` is inferred from column keys + the max data row.

### 23.3 Header arrow & hit-test

- Styled as a "drop-down button with background on the right border": a 2px-rounded, 2px-margin button block on the cell's right border; grey bg + dark arrow when not filtered, blue bg + white arrow when filtered (distinguishes "enabled" from "this column filtered").
- Drawn only when the cell is the header row of `filter.range` (`row === range.startRow`) and the column is inside `range`; not drawn when disabled or outside the range.
- Hit-test `isFilterButtonHit` runs before cell/row/column selection and resize: clicking the arrow opens only the panel, no normal selection.
- The popup anchor follows the button box (incl. margin); frozen panes reuse `cellToScreenRect`, so the arrow renders correctly on the frozen header.
- The down-arrow icon reuses the toolbar dropdown caret svg (`M180.053 361.387…`, viewBox `0 0 1024 1024`), drawn scaled via `Path2D`.

### 23.4 Filter panel

`filter-popup.vue` reuses the existing engine; the title shows the column's header text (not the column letter). Local state (`selected` / `blankChecked`) is committed to the sheet via `syncValuesFilter()` only on **OK** - unchecking items never affects the grid immediately. Supports value / text / number / date filters, search, blanks, and multi-column AND; candidate values come from the corresponding column inside `range`, generated from already-filtered rows when other columns are filtered (Excel cascading behavior).

### 23.5 Internal API (`composables/core-state.ts`)

```
getAutoFilter()          // current Sheet AutoFilter (null = disabled)
isFilterEnabled()        // enabled?
getFilterRange()         // filter range
isColumnInFilterRange(c) // column inside filter range?
isColumnFiltered(c)      // column has criteria?
detectFilterRange()      // auto-detect range
toggleAutoFilter()       // toggle (create / remove entirely)
setFilterColumn(c, crit) // set column criteria (null = clear)
clearFilterColumn(c)     // clear one column (keep others)
clearFilter()            // remove AutoFilter entirely
```

### 23.6 Compatibility

- **Freeze panes**: the arrow follows the header row; frozen hit-test & popup anchor reuse `cellToScreenRect` / `screenToCell`, so the arrow shows correctly on the frozen header.
- **Row/column insert/delete**: `adjustFilterRows` / `adjustFilterCols` sync `filter.range`; deleting the whole filter region auto-cancels the filter.
- **Sorting**: hidden rows are preserved; sorting moves data only, never styles; after sorting, filtered rows are recomputed and original row indices are not lost.
- **Persistence**: `SheetFilter` is serialized through v-model; range, header arrows, criteria, and hidden rows are fully retained on `serialize` / `load`.

## 24. Touch & Mobile Interaction

x-spreader is touch-first: every mouse interaction has a symmetric touch path, verified on real mobile devices. Touch input goes through `onTouchStart` / `onTouchMove` / `onTouchEnd` in `composables/interactions.ts`; `onTouchStart` calls `e.preventDefault()` to suppress synthetic mouse/click events and own the gesture, so all close-listeners that rely on `click`/`mousedown` must also listen on `touchstart`.

- **Tap to select / long-press context menu**: tap a cell, row header, column header, or the corner select-all button to select; long-press (450ms) inside the current selection opens the right-click context menu (cell / row / column / corner) via `showCtx`. Long-press outside the selection falls back to range selection / header drag-multi-select, so gestures never conflict. Touch coordinates are converted with `makeTouchEv(clientX, clientY)` into a minimal `MouseEvent` reused by `showCtx`.
- **Header filter arrow**: `onTouchStart` now hit-tests `isFilterButtonHit` before selection/resize, so tapping the arrow opens the AutoFilter panel.
- **Resize columns / rows**: touch the right edge of a column header or bottom edge of a row header (8px hot zone, widened on touch) to drag width / height - mirrors the mouse resize path.
- **Range selection**: long-press a cell (450ms) then drag to draw a rectangular selection (`tSelecting` / `tSelAnchorC` / `tSelAnchorR`); long-press a row/column header then drag to expand the selection. A clear drag (>8px) switches to scrolling; a light tap keeps the single selection.
- **Format brush**: after copying a style from a source cell, tapping the target range on touch applies it via `us.applyPaintFormat()` (mirrors mouse `onMouseUp`).
- **Commit edit by tapping outside**: tapping empty canvas or outside the formula bar commits an in-progress cell / formula-bar edit via `acceptFormulaBarEdit()` (mirrors mouse `onMouseDown`).
- **Tab bar**: long-press a tab button or the empty tab-bar area (450ms) emits `tab-contextmenu` / `tabbar-contextmenu`; `tabbar.vue` builds a real `MouseEvent` via `makeCtxMouseEv(x, y, target)` (with `preventDefault` + `stopPropagation`) so the shared `onTabCtxMenu` handler works unchanged.
- **Popups close on outside tap**: the context menu (`showCtx`) and the row-height / column-width editor panel (`openDimPanel`) register a `touchstart` (capture) outside-close listener, because `onTouchStart`'s `preventDefault` suppresses the synthetic `click`/`mousedown` desktop listeners depend on. A `tCtxMenuOpened` flag prevents a long-press-opened menu from collapsing the selection on `onTouchEnd`. All other pickers (calc / color / border / merge / sort, `dropdown.vue`, toolbar overflow, filter-popup) already use `pointerdown` and close correctly on touch.


## 25. Conditional Formatting

Excel-style conditional formatting stored per-sheet. Engine in `spreader/core/conditional-formatting.ts`, pure-logic, zero Vue/Canvas deps. Unit tests in `test/conditional-formatting.test.ts`.

### 25.1 Data Model

Rules live on the sheet state:

Rule object fields: id, condition, format, ranges, priority, stopIfTrue, enabled.

Condition type union covers seven variants: cellIs (value threshold comparison), textContains/textNotContains/beginsWith/endsWith (string match), blank/notBlank (empty cell), duplicate/unique (value frequency), formula (custom formula), plus stubs for colorScale/dataBar/iconSet/topBottom/aboveBelowAverage.

### 25.2 Condition Evaluation

evaluateCondition(rule, col, row, ctx) is the top-level entry. Cell-value and text conditions resolve via ctx.getCell. Duplicate/unique/topBottom/aboveBelow use CfValueCache (section 25.3). Formula conditions evaluate relative to the rule anchor using evalCondition exported from the formula engine which handles top-level comparison operators that the regular evaluator would skip. Absolute references stay fixed, relative references shift with the range.

### 25.3 Frequency Cache

CfValueCache keys by ruleId plus rangeKey and caches a value-to-count map. Invalidation: any setCellValue in core-state.ts iterates enabled CF rules whose ranges contain the changed cell and calls cache.invalidate(ruleId) before the next render pass.

### 25.4 Formula Reference Shift

shiftFormulaRefsSafe reuses shiftFormulaRefs from the formula engine, so dollar sign absolute refs stay locked. Rule ranges also expand or shrink on insert/delete rows/columns. Rules whose range becomes completely empty are auto-deleted.

### 25.5 Render-time Style Synthesis

resolveConditionalFormatting is called per viewport cell inside drawCells (spreader.vue). It walks enabled rules whose ranges contain the cell, evaluates each in ascending priority order, merges matched rule format properties into an accumulator, halts on stopIfTrue. Merge direction: higher-priority rule wins for conflict, lower-priority fills unset properties.

applyCfFormat merges the temp cfStyle onto the base resolved style. CF can override backgroundColor, color, fontWeight, fontStyle, underline, strikethrough. Border, number format, number alignment are intentionally excluded.

Merged cells: CF evaluates once at the anchor cell (top-left of merge region) and applies to the entire merge, matching Excel semantics.

### 25.6 UI Components

conditional-format-menu.vue: Toolbar dropdown with preset rule groups (highlight cells, blank/not-blank, duplicate/unique), New Rule, Manage Rules, and Clear Rules submenu. Submenus use Teleport plus hover-intent (150ms debounce on mouseleave, cancelled on mouseenter into sub-panel) so cross-gap hover transitions do not kill the submenu.

conditional-format-rule-editor.vue: New Rule or Edit Rule dialog. Condition type selector reuses SpDropdown. Format panel reuses toolbar color pickers for background and text, with bold, italic, underline, strikethrough toggle buttons. Application range auto-fills from current selection when the menu opens.

conditional-format-manager.vue: Lists all rules for the active sheet. Drag handles change priority. Individual edit and delete buttons. Bulk clear-all and clear-selection actions.

### 25.7 Persistence and Undo

Rules persist through v-model serialization as part of SheetState.conditionalFormats and are restored on deserialize. Rule mutations follow the existing core-state snapshot pattern so any change produces one undo step.

### 25.8 Integration Points

core-state.ts setCellValue invalidates CfValueCache entries for rules whose ranges contain the changed cell. core-state.ts insertRows/insertCols/deleteRows/deleteCols calls shiftFormulaRefsSafe and adjusts rule ranges, deleting rules with empty ranges. sheets-ops.ts pasteFromClipboard adjusts rule ranges via the same propagation logic. spreader.vue drawCells calls resolveConditionalFormatting and applyCfFormat per viewport cell.

### 25.9 Future Extensions

The type system already reserves union members for color scale, data bar, icon set, top-bottom N, and above-below average. Unit tests in test/conditional-formatting.test.ts cover rule persistence, priority merge semantics, absolute-reference shift, duplicate/unique statistics, and formula-condition evaluation. Additional coverage for each new condition type is added alongside its implementation.

---

## 26. Data Validation

Excel-style data validation rules stored per-sheet. Engine in `spreader/core/data-validation.ts`, pure-logic, zero Vue/Canvas deps. Unit tests in `test/data-validation.test.ts` and `test/data-validation-integration.test.ts`.

### 26.1 Data Model

Rules live on the sheet state (`SheetState.dataValidations: DataValidationRule[]`, default empty). A rule belongs to the Sheet, not to a Cell; it describes only input constraints plus optional UI behavior and never writes to the cell `value` or `styleId`.

Rule object fields: id (stable unique id, never the array index), ranges (SelectionRange[], multi-area), type, operator, formula1, formula2, listSource / values, allowBlank, showDropdown, showInputMessage, inputTitle, inputMessage, showErrorMessage, errorStyle, errorTitle, errorMessage, enabled.

Type union covers eight variants: `any` (no constraint - selecting it in the dialog clears the range), `list` (dropdown of allowed values), `wholeNumber`, `decimal`, `date`, `time`, `textLength`, `custom` (formula). Operator union covers eight: `between`, `notBetween`, `equal`, `notEqual`, `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`. Error style: `stop` (reject the commit) / `warning` (let the user confirm to continue) / `information` (prompt, user decides).

List source is either `{ type: 'values'; values: string[] }` (inline constant list) or `{ type: 'range'; range: SelectionRange; sheetId?: string }` (a cell range, same sheet or cross-sheet via `ctx.getSheetCells`).

### 26.2 Validation Engine

`evaluateDataValidationRule(rule, value, col, row, ctx)` is the per-rule entry. `allowBlank` wins first: a blank value passes when not explicitly disabled (default true, matching Excel). Type evaluators reuse `parseNumericText` / `parseDateTimeInput`, so literal criteria share the exact parsing used for live input. `between` / `notBetween` use `Math.min` / `Math.max`, so the min/max order does not matter. Multiple rules on the same range must all pass - `validateCellValue` aggregates via `rules.every()` and the worst (most severe) failing rule drives the alert.

### 26.3 Range Index

`DataValidationIndex` is a row-band spatial index over all rule ranges. `findRule(col, row)` returns the matching rule with zero allocation on the render hot path, so a sheet with one rule covering `A1:A100000` costs O(1) lookups instead of scanning every rule per painted cell.

### 26.4 Commit & Alert Flow

Validation runs *before* `setCellValue`. `commitEdit()` returns `Promise<boolean>`; a `stop`-level violation blocks the write and keeps the editor open. The alert is injected from `spreader.vue` through the `showValidationAlert` hook (Promise-based). `onEditBlur` defers when an alert is open to avoid re-entrancy with the alert decision.

### 26.5 Atomic Paste / Auto Fill

Paste and Auto Fill compute all candidate values first, call `validateCells()`, and cancel the entire operation if any `stop`-level violation exists - never a partial write. Copy carries intersecting rules with the internal clipboard and translates them onto the paste target; external plain-text paste writes values only.

### 26.6 Range Shift on Insert / Delete

`adjustDvRangeForInsert` / `adjustDvRangeForDelete` reuse the same propagation as conditional formatting. Dynamic `ensureCapacity` expansion does **not** auto-grow validation ranges - this is intentionally distinct from Insert Row semantics.

### 26.7 UI Components

`data-validation-dialog.vue`: Excel-style dialog with tabs Settings / Input Message / Error Alert / Apply To. Type dropdown, operator, criterion values (with min/max literal validation in the dialog), list source, input message, and error alert. Styling unified with the Conditional Formatting "New Rule" dialog.

`data-validation-dropdown.vue`: in-cell list dropdown with search, a virtual list (fixed row height, windowed rendering), and full keyboard support (↑ ↓ / Home / End / PageUp / PageDown / Enter / Esc). Position is driven by the caller-supplied cell screen rect, so it is compatible with frozen panes and merged cells.

`data-validation-alert.vue`: Stop / Warning / Information alert dialog, sharing the same visual language as Conditional Formatting.

`data-validation-input-message.vue`: a tooltip shown on cell focus when `showInputMessage` is set (kept at the components root, not under pickers, since it is a pure informational bubble).

### 26.8 Persistence and Undo

Rules persist through v-model serialization as part of `SheetState.dataValidations` and are restored on deserialize. Mutations follow the existing core-state snapshot pattern, so any change (create / update / remove / clear) produces one undo step.

### 26.9 Integration Points

`core-state.ts` `commitEdit` validates before `setCellValue` and exposes `validateCell` / `getListValidation` / `getValidationDropdown` / `getValidationInputMessage` / `hasDataValidation`. `core-state.ts` `insertRows`/`insertCols`/`deleteRows`/`deleteCols` adjust DV ranges. `sheets-ops.ts` `pasteFromClipboard` and `applyAutoFill` validate atomically. `interactions.ts` draws the dropdown indicator and handles `Alt+↓`. `spreader.vue` wires the four DV components and the `showValidationAlert` hook.

### 26.10 Future Extensions

The type union already reserves room for more operators and list-source variants. Custom formula leverages the extended formula engine (`AND` / `OR` / `NOT` plus comparison tokens), so new condition kinds can be added without touching the render path.

---

## 27. Row / Column Grouping (Outline)

Excel-style row/column grouping and collapsing. The engine lives in `spreader/core/outline-core.ts` - pure functions with zero Vue / DOM dependencies; the state layer is `composables/core-state.ts` (rowOutlines / columnOutlines plus add/remove/collapse/shift methods); rendering and interaction live in `composables/interactions.ts`. Unit tests: `test/outline-core.test.ts`.

### 27.1 Data Model

Groups are stored per-sheet and per-axis in `SheetState.rowOutlines` / `columnOutlines` (`DimensionOutline[]`, serialized and persisted through v-model). Each group carries:

- a stable `id` (`row-N` / `col-N`; array indices are forbidden)
- `start` / `end`: 0-based inclusive range
- `level`: always 1 (`MAX_OUTLINE_LEVEL = 1` - one level of grouping only)
- `collapsed`: collapse state

### 27.2 Validation Rules

`validateGroup(existing, start, end)` runs before creation and returns an `OutlineValidationResult` with a failure code:

- `outlineInvalid`: start > end or non-integer indices
- `outlineMinSize`: at least 2 consecutive rows/columns required
- `outlineCrossing`: partial overlap with an existing group (neither disjoint nor fully containing, decided by `isNestedPair`)
- `outlineTooDeep`: nesting (countContaining > 0 pushes level past 1) - message: "groups cannot nest, only one level is supported"

Before creating a group the selection must cover whole rows (startCol === 0 and endCol === colCount - 1) or whole columns, otherwise the "select entire rows or columns first" hint is shown. Ungrouping requires the selection to **fully cover** at least one group (`rs <= o.start && o.end <= re`), otherwise a hint asks the user to adjust the selection.

### 27.3 Collapse & Rendering

- Group ranges get alternating background colors in the row/column header band (`buildOutlineColorMap` assigns alternating colors by group order).
- ± collapse buttons (`OUTLINE_BTN`, ~9px) float inside the header band (`rowOutlineAnchorX` / `colOutlineAnchorY`); no separate gutter partition is reserved (`getOutlineGutterSize` is always 0, the grid origin never shifts).
- Collapsed rows/columns are skipped during content (drawCells), border, and header-text rendering (`isRowCollapsed` / `isColumnCollapsed` - the 0-size guard prevents ghost stripes); merged cells straddling the freeze line are drawn per pane.
- `afterOutlineChange` is the shared tail for any structural/collapse mutation: re-clamp scroll, schedule render, emit v-model.

### 27.4 Coordinate Shifting

On row/column insert/delete, `addOutlineForInsert` / `addOutlineForDelete` shift group ranges: insertions inside a group extend `end`; insertions/deletions before a group shift the whole range; groups whose range is fully deleted are dropped. Levels are recomputed via `recomputeOutlineLevels` afterwards.

### 27.5 UI Entry Points

- **Toolbar "Group" dropdown** (`pickers/outline-picker.vue`, button sits between Sort and Filter): enabled only when whole rows/columns are selected (the `outlineAxis` computed drives button `:disabled`; the Teleport overflow condition is unaffected by graying-out). Five verb items (Add Group → Ungroup → Clear Outline → Expand All → Collapse All, matching the context menu) act directly on the selected axis (action keys like `group-rows` / `expand-cols`) - no "rows/columns" submenu. Positioning reuses `useFloatMenuPosition`.
- **Row/column context menu "Group" submenu** (interactions.ts): dispatches per right-clicked axis (Add Row Group / Ungroup Rows / Clear Outline / Expand All / Collapse All).
- Validation failures go through `alertOutline`: the host-injected in-app dialog (`showOutlineAlert` hook) when available, falling back to `window.alert`.

### 27.6 Persistence & Undo

Groups persist through the sheet v-model (`rowOutlines` / `columnOutlines` fields) and round-trip through save/load/duplicate-sheet. Add, ungroup, clear, and single-group collapse each saveUndo into one undo step; `setAxisCollapsed` (expand/collapse all) wraps the whole-axis batch into a single undo step (silent mode skips per-group undo).

### 27.7 Integration Points

`core-state.ts` exposes addRowGroup / addColumnGroup / removeOutline / clearRowGroups / clearColumnGroups / setOutlineCollapsed / toggleOutline / getRowOutlines / getColumnOutlines / isRowCollapsed / isColumnCollapsed plus adjustOutlinesFor* on insert/delete. `interactions.ts` provides outlineGroupRows / outlineGroupCols / outlineUngroupRows / outlineUngroupCols / outlineExpand* / outlineCollapse* (toolbar event dispatch) and the rendering layer. `spreader.vue` wires OutlinePicker, computes outlineAxis, and injects the showOutlineAlert hook. `toolbar.vue` owns the group button and dropdown (with overflow-menu support).

### 27.8 Future Extensions

The types already reserve room for multi-level grouping (recomputeOutlineLevels computes levels from nesting); the validation layer currently caps it at one. Lifting `MAX_OUTLINE_LEVEL` plus adding gutter-partition rendering would enable nested groups.
