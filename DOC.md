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
            │       └── mergePicker.vue
            ├── composables/
            │   ├── core-state.ts      # Props, cells/merges/selection, font metrics, navigation
            │   ├── undo-styles.ts      # Undo/redo, format painter, font/alignment/color
            │   ├── borders-merge.ts    # Border sync, merge ops, clipboard, sum
            │   ├── sheets-ops.ts      # Row/col ops, multi-sheet, v-model emit, theme, refs
            │   └── interactions.ts    # Renderer, formula bar, tab bar, context menu, scrollbar, events
            └── core/
                ├── constants.ts       # Layout constants, i18n text, theme color palette
                ├── types.ts           # All type definitions
                ├── formula.ts         # Formula engine (parsing, evaluation, dependency tracking)
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

// Cell data + style reservation
interface CellData {
  value: string
  style: Record<string, unknown> | null
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
  [cellRef: string]: { value: string; style?: Record<string, unknown> }
}

// v-model two-way binding external data format
interface SheetModelData {
  name: string
  cells: Record<string, { value: string; style?: Record<string, unknown> }>
  colWidths?: Record<number, number>
  rowHeights?: Record<number, number>
}

// Worksheet internal runtime state
interface SheetState {
  id: string; name: string
  cells: Record<string, CellData>
  selection: SelectionRange | null
  activeCell: CellCoord
  scrollX: number; scrollY: number
  colWidths: number[]; rowHeights: number[]
}

// Undo snapshot
interface UndoSnapshot {
  cells: Record<string, CellData>
  colWidths: number[]; rowHeights: number[]
}

// Context menu item
interface ContextMenuItem {
  label: string; action: () => void; disabled?: boolean
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
- `saveSheet()` serializes current `cells`, `selection`, `scrollX/Y`, `colWidths`, `rowHeights` to `sheets[activeSheetIndex]`
- `loadSheet(i)` restores all state from `sheets[i]`, including formula dependency graph rebuild

### 4.4 v-model Data Sync

`emitModelData()` serializes all sheets to `SheetModelData[]` and triggers two-way binding via `modelData.value = out`. Uses `lastEmittedData` string comparison for deduplication to avoid circular updates.

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

### 7.2 Dependency Tracking

`FormulaDeps` class maintains a bidirectional dependency graph:
- **Forward**: formulaKey → [depKey, ...] (which cells the formula references)
- **Reverse**: depKey → Set<formulaKey> (which formulas depend on this cell)

When modifying a cell, dirty flags are propagated through the reverse graph. Caching is used during evaluation to avoid redundant calculations. Circular reference detection (depth > 20 returns NaN).

### 7.3 Evaluation Cache

A module-level `evalCache: Map<string, number>` stores computed formula results. During evaluation:
- Before evaluating a cell, check cache — if present, return `NaN` (prevents circular evaluation)
- Store the result in cache after successful evaluation
- `clearEvalCache()` clears the cache (called during sheet switching or rebuild)

### 7.4 Display Value Calculation

`computeCellValue(col, row)` determines if the cell value starts with `=`:
- Yes → call `evalFormula()` for evaluation
- No → return original value

Returns `'#ERROR'` if the formula evaluates to `NaN`.

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

- **Snapshot**: `takeSnap()` deep clones current `cells`, `colWidths`, `rowHeights`
- **Stack Push**: Call `saveUndo()` before each modification, deduplicate with stack top (JSON comparison)
- **Undo**: `undoStack.pop()` → `restoreSnap()` and rebuild formula dependency graph
- **Redo**: `redoStack.pop()` → `restoreSnap()` and rebuild formula dependency graph
- **Limit**: `UNDO_MAX = 50`, removes oldest snapshot when exceeded

---

## 13. Extension Points / Roadmap

### 13.1 Data Layer
- **More Formulas**: AVERAGE, COUNT, IF, VLOOKUP, etc.
- **Cell Styles**: `CellData.style` field is already reserved (background color, font, alignment, number format)
- **Merged Cells**: Extend data model to store merge information

### 13.2 Rendering Layer
- **Frozen Panes**: `frozenCols`/`frozenRows` state, split fixed and scrollable areas
- **Conditional Formatting**: Add style rule matching in render loop
- **Auto-Fill**: Drag handle at bottom-right of active cell

### 13.3 Interaction Layer
- **Find/Replace**
- **Data Sort/Filter**
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
