# Xiaodao Spreader

[中文](./README.ZH.md) | **English** | [Demo](https://spreader.xdz.me)

[![Downloads](https://img.shields.io/npm/d18m/xiaodao-spreader)](https://www.npmjs.com/package/xiaodao-spreader)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3.4+-42b883.svg)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178C6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.0+-646CFF.svg)](https://vitejs.dev/)

A high-performance, canvas-based spreadsheet component for Vue 3: bringing an Excel-like editing experience to the web. It supports full cell editing, formula evaluation with relative/absolute/mixed references, clipboard cut/copy/paste, merge cells, frozen panes, number formatting, borders, find & replace, sorting, and auto-fill: all rendered on a single virtualized canvas with smooth scrolling across hundreds of thousands of rows. The pure-logic core (formula engine, sort, find-replace, auto-fill) is fully decoupled from Vue/Canvas and unit-tested, making it easy to embed or reuse across projects.

![Preview](./img/preview.png)

---

## Features

### Core Spreadsheet
- **Dynamic Sheet Expansion**: Excel-like dynamic row/column expansion; default 26 columns (A-Z) × 200 rows, automatically expands when scrolling near boundaries, inputting at edges, pasting beyond current range, or inserting rows/columns that would push data out of bounds
- **Canvas 2D Rendering**: High-DPI aware with DPR scaling, virtual viewport rendering for dynamically-sized sheets
- **Multi-Sheet Workbook**: Tab bar with add, rename, duplicate, delete, reorder
- **Formula Engine**: `=SUM()`, `=AVERAGE()`, `=COUNT()`, `=IF()`, `=VLOOKUP()`, `=CONCATENATE()` with dependency tracking and circular-reference detection; toolbar and context menu provide one-click sum/average/count
- **Merge Cells**: Merge & Center, Merge Across, Unmerge; merged-region borders stored at the anchor, shared borders resolved at render time
- **Freeze Panes**: Pin frozen top rows / left columns so they keep visible while the body scrolls. The toolbar "Freeze Panes" dropdown exposes *Freeze Panes* (freezes at the top-left corner of the current selection / active cell: Excel's "Freeze Panes" behavior), *Freeze First Row*, *Freeze First Column*, and *Unfreeze* (shown only when a pane is already frozen, replacing the "Freeze Panes" entry). Per-sheet view state (`freeze: { rows, cols }`) persisted through v-model; merged cells straddling the freeze line are handled correctly: only the frozen portion stays pinned, the rest scrolls away
- **Rich Cell Formatting**: Font family, font size (5–72), bold, italic, underline, strikethrough, text color, fill color, horizontal & vertical alignment, wrap text
- **Borders**: Top / bottom / left / right / outside / all / none with 5 predefined styles and custom color; stored in a dedicated border pool, shared borders resolved at render time
- **Undo / Redo**: Full state snapshots for cells, column widths, and row heights (50 steps)
- **Format Painter**: Copy & apply cell formatting across ranges
- **Number Format**: Excel-style number formatting (General / Text / Number / Currency / Accounting / Percent / Scientific / Date / Time / DateTime / Duration) with a custom format dialog; display-only, never mutates the stored cell value
- **Smart Data Recognition**: Typing `100%`, `1,234`, `¥1,234.56` auto-converts the text to a number and applies the matching format; common date/time text auto-converts to dates: matching Excel input behavior
- **Sorting & Sort Warning**: Sort any column by its **displayed content** (numbers / dates / text); sorting moves data only, never cell styles; ranges containing merged cells or formulas are auto-disabled; when adjacent data sits outside the selection, an Excel-style **Sort Warning** dialog lets you choose "Expand the selection" or "Sort the current selection only"
- **Auto Filter (AutoFilter)**: Excel-style auto filter on a normal range. Enable via the toolbar **Data → Filter** or `Ctrl+Shift+L`; select a data cell (or a single-row multi-column range) and the filter is created by intelligently probing the contiguous data region **downward** from that header row. Each column header shows a filter drop-down arrow; opening it reveals the filter panel (values / text / number / date / search / blanks / multi-column AND). Clearing one column's criteria clears only that column; removing the AutoFilter clears everything. Only columns inside the Filter Range get an arrow; selecting a single merged cell with no active filter disables the filter button — *see [Auto Filter (AutoFilter)](#auto-filter-autofilter)*
- **Find & Replace**: Open via the toolbar find button or `Ctrl/Cmd+F` (also `Ctrl/Cmd+H`); three scopes: current sheet / entire workbook / current selection; match case and match entire cell; highlights all matches and locates the active one with wrap-around navigation; single and replace-all both integrate with undo/redo, mutating only the raw `value` (always kept a string), never format / border / merge
- **Conditional Formatting**: Excel-style conditional formatting rules stored per-sheet. The toolbar "Conditional Formatting" dropdown offers preset rules (greater than / less than / between / text contains / duplicate / unique / blank / not blank) and a "New Rule" dialog with cell value and formula-based conditions. Rules render as temporary style overlays on top of the base cell style — no mutation of the underlying cell `value` or `styleId`. Rule priority (smaller number = higher), `stopIfTrue` semantics, and automatic cache invalidation on cell value change. Inserting / deleting rows or columns adjusts rule ranges and formula references via the same `shiftFormulaRefs` engine used by auto-fill. Includes a "Manage Rules" dialog for editing, reordering, and deleting rules; the "Clear Rules" sub-dialog lets you clear all rules or rules from selected ranges. Render-time style synthesis correctly composes CF background, font color, bold, italic, underline, and strikethrough with the base cell style. *see [Conditional Formatting](#conditional-formatting)*
- **Data Validation**: Excel-style data validation rules stored per-sheet. The toolbar "Data Validation" button opens a dialog to set the allowed type (any value / list / whole number / decimal / date / time / text length / custom formula), the operator (between, not between, equal, greater than, …), and the criterion values. List validation shows an in-cell dropdown with search and full keyboard navigation (↑ ↓ / Home / End / PageUp / PageDown / Enter / Esc). Per-rule input message and error alert (Stop / Warning / Information) are supported; validation runs *before* the value is committed, so Stop-level violations reject the edit while Warning/Information let the user confirm. All rules on a range must pass. Rules persist through v-model, integrate with undo/redo, and adjust automatically on row/column insert/delete. Copy/paste and Auto Fill validate atomically — a Stop violation cancels the whole operation. *see [Data Validation](#data-validation)*
- **Auto Fill (Fill Handle)**: Excel-style fill handle at the bottom-right corner of the active selection. Drag it up/down/left/right to fill cells: single values copy, number/date/text-number sequences auto-continue (e.g. `1,2 → 3,4,5`), formula references adjust per relative/absolute/mixed rules (e.g. `=A1*2` → `=A2*2`), and source `styleId` is reused via the style pool. Live preview during drag, edge auto-scroll, dynamic sheet expansion, freeze-pane compatibility, and a single undo step per operation: *see [Auto Fill](#auto-fill)*

### Interaction
- **Smart Selection**: Click, drag, Shift+Click, row/column header select, corner-cell select-all
- **Double-Click Editing**: Inline cell editor with `<textarea>` for multi-line input
- **Formula Bar**: Dedicated input bar with cell label and live formula display
- **Full Keyboard Navigation**: Arrow keys, Tab, Enter, Home, End, Ctrl+Home, Ctrl+End
- **Context Menus**: Context-aware menus for cells, rows, columns, sheet tabs, with nested submenus
- **Row / Column Operations**: Insert, delete, cut, copy, paste via right-click menu
- **Column Width / Row Height**: Drag-to-resize with live preview and double-click auto-fit
- **Touch Support**: Swipe scrolling, double-tap to edit
- **Responsive**: ResizeObserver for dynamic container sizing

### Visual
- **Light / Dark Theme**: Full color palette with 50+ CSS custom properties
- **Internationalization**: English & Chinese (zh-CN) out of the box
- **Overflow Toolbar**: Responsive toolbar that automatically collapses overflow buttons into a dropdown menu
- **Custom Scrollbars**: Native-styled scrollbars with arrow buttons and draggable thumbs

---

## Installation

```bash
# pnpm (recommended)
pnpm add xiaodao-spreader

# npm
npm install xiaodao-spreader

# yarn
yarn add xiaodao-spreader
```

### Peer Dependencies

- `vue` ^3.4.0

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/xiaodaozhi/xiaodao-spreader.git
cd xiaodao-spreader

# Install dependencies
pnpm install

# Start dev server
pnpm dev
```

Navigate to `http://localhost:5173` to see the demo application.

---

## Basic Usage

```vue
<template>
  <Spreader
    v-model:data="myData"
    :row-count="100"
    :col-count="12"
    theme="light"
    locale="zh-CN"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import Spreader from 'xiaodao-spreader';
import type { SheetModelData } from 'xiaodao-spreader';

const myData = ref<SheetModelData[]>([
  {
    name: 'Sheet1',
    styles: [{}, { fontSize: 14, fontWeight: 'bold' }],
    cells: {
      '0,0': { value: 'Name' },
      '0,1': { value: 'Age' },
      '1,0': { value: 'Alice', styleId: 1 },
      '1,1': { value: '28' },
    },
    colWidths: { 0: 120, 1: 80 },
  },
]);
</script>
```

---

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` (v-model) | `SheetModelData[]` | `[]` | Multi-sheet data (two-way binding) |
| `rowCount` | `number` | `200` | Initial rows per sheet (can be exceeded dynamically) |
| `colCount` | `number` | `26` | Initial columns per sheet (can be exceeded dynamically) |
| `width` | `number \| string` | - | Component width (pixels; omit or pass `string` for responsive) |
| `height` | `number \| string` | - | Component height (pixels; omit or pass `string` for responsive) |
| `theme` | `'light' \| 'dark'` | `'light'` | Theme mode |
| `locale` | `string` | `'zh-CN'` | Language: `'zh-CN'` \| `'en-US'` |

---

## Data Model

### `SheetModelData`

The external data format used for v-model two-way binding:

```typescript
interface SheetModelData {
  name: string;
  styles?: CellStyle[];
  borders?: BorderStyle[];
  cells: Record<string, {
    value: string;
    styleId?: number;
  }>;
  merges?: Record<string, SelectionRange>;
  freeze?: { rows: number; cols: number };
  colWidths?: Record<number, number>;
  rowHeights?: Record<number, number>;
  /** Logic column count (0-based exclusive). Defaults to 26 when omitted. */
  colCount?: number;
  /** Logic row count (0-based exclusive). Defaults to 200 when omitted. */
  rowCount?: number;
}
```

- **`styles`**: Style pool: `styles[0]` is always the default empty style `{}`. Cells reference styles by index (`styleId`).
- **`borders`**: Border pool: `borders[0]` is always the default empty border `{}`. Styles reference borders by index (`borderId`); auto-migrated from legacy inline border props when omitted.
- **`cells`**: Key is `"col,row"` (e.g., `"0,0"` for cell A1). `styleId` references into the `styles` array; `styleId=0` or omitted means default style.
- **`merges`**: Merge cell definitions, keyed by merge anchor cell.
- **`freeze`**: View state for frozen panes: `{ rows, cols }` freezes the top `rows` rows and the left `cols` columns; `{ rows: 0, cols: 0 }` means no freeze. Persisted per sheet and restored on sheet switch.
- **`colWidths` / `rowHeights`**: Sparse maps: only stores non-default values.

### Type Exports

```typescript
import type {
  CellCoord,       // { col: number; row: number }
  SelectionRange,  // { startCol; startRow; endCol; endRow }
  CellData,        // { value: string; styleId?: number }
  CellStyle,       // Typed style interface (font, color, border, alignment, etc.)
  BorderStyle,     // Four-side border { top; right; bottom; left }
  BorderSide,      // Single border side { width; color; style }
  BorderSource,    // Border source 'cell' | 'merge'
  Range,           // { start: number; end: number }
  SpreadsheetOptions,
  SpreadsheetData,
  SheetModelData,  // ← main data interface
  SheetState,      // internal runtime state
  UndoSnapshot,
  ContextMenuItem,
  ThemeColors,
  Point,
} from 'xiaodao-spreader';

// Runtime utilities
import { StylePool, resolveStyle, migrateCells, cloneCells } from 'xiaodao-spreader';
```

---

## Architecture

```
src/
├── index.ts                          # Library entry: re-exports from spreader/
├── App.vue                           # Demo application
└── components/
    └── spreader/
        ├── index.ts                  # Unified export: component + types (barrel)
        ├── components/
        │   ├── spreader.vue          # Entry component: template + style + composition
        │   ├── toolbar.vue           # Toolbar with overflow dropdown
        │   ├── tabbar.vue            # Sheet tab bar
        │   ├── dropdown.vue          # Generic dropdown component
        │   ├── find-replace-bar.vue  # Find/replace bar UI
        │   └── pickers/
        │       ├── colorPicker.vue       # Text & fill color picker
        │       ├── borderPicker.vue      # Border picker
        │       ├── mergePicker.vue       # Merge cell picker
        │       ├── numberFormatDialog.vue # Number format custom dialog
        │       ├── sortPicker.vue        # Sort dropdown
        │       ├── sortConfirmDialog.vue # Excel-style sort warning dialog
        │       ├── calcPicker.vue        # Sum / average / count picker
        │       └── insertFunctionDialog.vue # Insert function dialog
        ├── composables/
        │   ├── core-state.ts        # Props, cells/merges/selection, font metrics, navigation
        │   ├── undo-styles.ts       # Undo/redo, format painter, font/alignment/color
        │   ├── borders-merge.ts     # Border ops, merge ops, clipboard, sum
        │   ├── sheets-ops.ts        # Row/col ops, multi-sheet, v-model emit, theme, refs
        │   ├── find-replace.ts      # Find/replace state & interaction (Vue-dependent)
        │   └── interactions.ts      # Renderer, formula bar, tab bar, context menu, scrollbar, events
        └── core/
            ├── constants.ts         # Layout constants, i18n, theme palettes
            ├── types.ts             # All type definitions
            ├── style-pool.ts        # Style pool: dedup, registration, resolve, migration, GC
            ├── border-pool.ts       # Border pool: dedup, registration, resolve, migration, GC
            ├── border-resolve.ts    # Shared-border conflict resolution (resolveSharedBorder)
            ├── formula.ts           # Formula engine (parse, evaluate, deps, cache)
            ├── find-replace-core.ts # Find/replace pure algorithms (zero Vue deps, unit-testable)
            ├── sort-core.ts         # Sort pure algorithms (zero Vue deps, unit-testable)
            ├── autofill.ts          # Auto-fill pure engine (pattern inference, fill handle logic, zero Vue deps)
            ├── number-format.ts     # Number format engine (Excel-style display formatting)
            ├── conditional-formatting.ts # Conditional formatting engine (condition eval, rule cache, formula ref shift)
            ├── theme.ts             # Theme CSS variable construction
            └── utils.ts             # Pure utilities (col label, hit test, resolve size)
```

### Design Principles

- **Sparse Data Model**: Only cells with actual data are stored; expanding the logical range does not create empty cells
- **Dynamic Range**: Each sheet maintains a reactive logical range (`colCount`/`rowCount`) that starts from the `colCount`/`rowCount` props (default 26/200) and grows as needed via `ensureCapacity(minCol, minRow)`. Expansion uses buffer steps (8 columns / 32 rows) to reduce frequent resize overhead
- **Composition API**: All business logic extracted into `composables/`, maintaining single-responsibility modules
- **Barrel Export**: `spreader/index.ts` centralizes all component and type exports; `src/index.ts` re-exports everything, so consumers import uniformly from `xiaodao-spreader`
- **Canvas 2D Rendering**: Only visible cells are drawn (virtual rendering), ensuring smooth performance on large sheets
- **No Dirty Flags**: Manual `scheduleRender()` calls at interaction end-points; `requestAnimationFrame` automatically merges multiple calls within the same frame
- **Style Pool**: Each sheet maintains a `styles: CellStyle[]` array; cells reference styles via `styleId` (array index). Identical styles are automatically deduplicated. Runtime style resolution via `resolveStyle()` / `registerStyle()`; GC (`compactStyles`) runs only at save/export time
- **Border Pool**: Borders are stored separately from regular styles in a per-sheet `borders: BorderStyle[]` pool; styles reference borders via `borderId` (array index). Adjacent shared borders are resolved at render time via `resolveSharedBorder()`; setting a border no longer mutates neighboring cells
- **Shared State**: A central `CoreState` object is injected into each composable, enabling cross-module communication without tight coupling
- **Reactive Wrap**: Composable return values are wrapped in `reactive()` for automatic ref/computed unwrapping in templates

---

## Keyboard Shortcuts

### Navigation

| Keys | Action |
|------|--------|
| `↑` `↓` `←` `→` | Move active cell |
| `Tab` / `Shift+Tab` | Move right / left |
| `Enter` / `Shift+Enter` | Move down / up |
| `Home` / `End` | Jump to first / last column |
| `Ctrl+Home` / `Ctrl+End` | Jump to A1 / bottom-right |
| `PageUp` / `PageDown` | Scroll one page up / down |

### Editing

| Keys | Action |
|------|--------|
| `F2` / `双击` / `直接输入` | Enter edit mode |
| `Enter` (in edit) | Commit and move down |
| `Tab` (in edit) | Commit and move right |
| `Escape` (in edit) | Cancel edit |
| `Ctrl+Enter` | Line break in multi-line cells |
| `Delete` / `Backspace` | Clear selection |

### Clipboard & History

| Keys | Action |
|------|--------|
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / Cut / Paste |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+A` | Select all |
| `Ctrl+Shift+L` | Toggle Auto Filter |

### Formatting

| Keys | Action |
|------|--------|
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+U` | Underline |

---

## Formula Engine

### Supported Formulas

| Formula | Syntax | Description |
|---------|--------|-------------|
| `SUM` | `=SUM(A1:B5)` | Range summation |
| `AVERAGE` | `=AVERAGE(A1:B5)` | Range average |
| `COUNT` | `=COUNT(A1:B5)` | Count numeric cells in range |
| `IF` | `=IF(A1>5, A1*2, 0)` | Conditional branching; supports comparison operators (`> < >= <= = <>`) and arithmetic |
| `VLOOKUP` | `=VLOOKUP(value, A1:C5, 2, FALSE)` | Vertical lookup; exact match by default, `TRUE` for approximate match |
| `CONCATENATE` | `=CONCATENATE(A1, " ", B1)` | Concatenate multiple values into a string |
| Absolute ref | `$A$1` | Lock column and row |
| Mixed ref | `$A1`, `A$1` | Lock column or row only |

### Dependency Tracking

The `FormulaDeps` class maintains a bidirectional dependency graph:

- **Forward**: `formulaKey` → `[depKey, ...]`: which cells a formula references
- **Reverse**: `depKey` → `Set<formulaKey>`: which formulas depend on a cell

When a cell changes, dirty flags propagate through the reverse graph. Circular references are detected via a separate `inProgress` set and return `#ERROR`.

### Reference Offsetting During Paste

`shiftFormulaRefs()` automatically adjusts cell references in formulas when pasting, with `$` absolute reference locking.

---

## Number Format

An Excel-style number formatting engine (`spreader/core/number-format.ts`) that controls **how a cell value is displayed**: it never mutates the stored `value` (which always remains a raw string).

### Categories

| Category | Example display | Format code |
|----------|-----------------|-------------|
| General | Auto (numbers, sci-notation for very large/small) | `` (empty) |
| Text | Verbatim | `@` |
| Number | `1,234.56` | `#,##0.00` |
| Percent | `12.34%` | `0.00%` |
| Scientific | `1.23E+03` | `0.00E+00` |
| Currency | `¥1,234.56` / `$1,234.56` | `¥#,##0.00` |
| Currency (rounded) | `¥1,235` | `¥#,##0` |
| Accounting | `(¥1,234.56)` for negatives | `¥#,##0.00;(¥#,##0.00);¥"-"` |
| Financial | `[Red](#,##0.00)` for negatives | `#,##0.00;[Red](#,##0.00)` |
| Date | `2026年8月24日` / `8/24/2026` | `yyyy"年"m"月"d"日"` |
| Time | `13:45:30` | `h:mm:ss` |
| Date & Time | `2026年8月24日 13:45:30` | `yyyy"年"m"月"d"日" h:mm:ss` |
| Duration | `26:30:00` | `[h]:mm:ss` |
| Custom | User-defined Excel-style code | - |

### How it works

- **Storage**: the format code is stored per-cell in the resolved style's `numberFormat` property (a string). Omitting the property (or empty string) means General.
- **UI**: the toolbar number-format dropdown applies presets to the current selection; the **「Format…」(格式…)** item opens `numberFormatDialog.vue` for a custom code, decimals, and thousands separator.
- **Display**: `formatNumber(value, format, locale)` parses the code (cached), applies thousands separators / decimals / percent scaling / date-serial conversion, and returns the display string. Invalid date/duration serials render as `###`.
- **Alignment**: numeric formats default to right-aligned; Text and General-with-non-numeric keep left alignment: matching Excel semantics.
- **i18n**: currency symbol (`¥` / `$`), month and weekday names follow the `locale` prop.

---

## Conditional Formatting

Excel-style conditional formatting stored per-sheet in `SheetState.conditionalFormats` (array of `ConditionalFormattingRule`). The engine lives in `spreader/core/conditional-formatting.ts` — pure-logic, zero Vue/Canvas deps, with unit tests in `test/conditional-formatting.test.ts`.

### Rule Structure

Each rule has a stable `id`, a `condition`, a `format` override, one or more `ranges`, a numeric `priority` (smaller = higher precedence), `stopIfTrue`, and `enabled` flag. The `format` carries only visual properties (`backgroundColor`, `color`, `fontWeight`, `fontStyle`, `underline`, `strikethrough`) — it never writes back to `cell.styleId`.

### Supported Condition Types

Preset rules exposed via the toolbar dropdown and the "New Rule" dialog:

| Type | Key | Description |
|------|-----|-------------|
| Cell value | `cellIs` | compare against threshold(s): greater than, less than, between, equal to |
| Text | `textContains` / `textNotContains` / `beginsWith` / `endsWith` | string match with optional case sensitivity |
| Blank | `blank` / `notBlank` | cell value is empty or whitespace-only |
| Duplicate | `duplicate` | value appears more than once within rule scope |
| Unique | `unique` | value appears exactly once within rule scope |
| Formula | `formula` | custom formula evaluated relative to the rule anchor (e.g. `=A1>100`); supports absolute references (`$B$2`) which stay fixed during range expansion |

Color scale, data bar, icon set, top/bottom N, and above/below average are type stubs (`colorScale`, `dataBar`, `iconSet`, `topBottom`, `aboveBelowAverage`) in the type system for forward compatibility; preset UI and rendering for these are planned.

### Priority & Stop-If-True

Rules fire in ascending priority order (lowest number first). The first rule whose condition matches the cell contributes its format properties; subsequent rules add only properties not yet set. If a matched rule has `stopIfTrue: true`, the scan halts immediately for that cell.

### Cache & Invalidation

Duplicate / unique / top-bottom / above-below rules need a value-frequency statistic over the rule range. `CfValueCache` keyed by range+rule type computes these on first access and caches them. Any `setCellValue` in `composables/core-state.ts` invalidates the affected rule caches before the next render pass.

### Insert / Delete Propagation

`shiftFormulaRefsSafe` in the CF engine reuses the same `shiftFormulaRefs` function from the formula engine — so `$B$2` (absolute) stays locked while `A1` (relative) shifts. Rule ranges also expand/shrink accordingly; ranges completely removed from the sheet are auto-deleted.

### Render-time Style Synthesis

`resolveConditionalFormatting` is called per viewport cell inside `drawCells`. It walks all enabled rules whose ranges contain the cell, applies priority-merging, and produces a temporary `cfStyle`. `applyCfFormat` merges this onto the base resolved style, composing `backgroundColor`, `color`, `fontWeight`, `fontStyle`, `underline`, and `strikethrough` — including correct handling of merged cells (CF applies to the anchor cell and propagates to the entire merge region).

### UI Components

| File | Role |
|------|------|
| `conditional-format-menu.vue` | Toolbar dropdown: preset rules (highlight cells, blank, duplicate, unique), New Rule, Manage Rules, Clear Rules submenu. Teleport-based submenus with hover-intent (150ms debounce) for cross-gap hover transitions |
| `conditional-format-rule-editor.vue` | "New Rule" dialog: condition type selector (reuses `SpDropdown`), threshold inputs, format panel (background color picker, text color picker, bold, italic, underline, strikethrough — all reuse toolbar picker/button styles), application range auto-filled from current selection |
| `conditional-format-manager.vue` | "Manage Rules" dialog: list all rules for the active sheet, drag-to-reorder priority toggle, edit/delete per rule, clear all / clear selection |

---

## Auto Fill

An Excel-style fill-handle mechanism (`spreader/core/autofill.ts` pure engine + `composables/interactions.ts` canvas/interaction layer). Drag the small square at the bottom-right corner of the active selection to fill cells: no DOM handles, all drawn on Canvas.

### Fill Patterns

| Source values | Fill behavior | Example |
|---------------|---------------|---------|
| Single number | Copy | `42 → 42, 42, 42` |
| Single text | Copy | `foo → foo, foo, foo` |
| Single date | +1 day | `2026-01-01 → 2026-01-02, 2026-01-03` |
| Two+ numbers, constant diff | Linear series | `1,2 → 3,4,5` · `2,4 → 6,8,10` |
| Two+ dates, constant diff | Date series | `2026-01-01, 2026-01-03 → 2026-01-05, 2026-01-07` |
| Text + number, same prefix | Text-number series | `Item1,Item2 → Item3,Item4` |
| Two single letters | Alpha series | `A,B → C,D,E` |
| Formula | Reference translation | `=A1*2` → `=A2*2, =A3*2` |
| Multi-column / multi-row block | Per-column pattern inference | `A1:B2=[[1,10],[2,20]] → [[3,30],[4,40]]` |

### Formula Reference Rules

Fill-handle translation reuses the existing `shiftFormulaRefs()`: no second formula engine:

| Reference type | Syntax | Fill behavior |
|----------------|--------|---------------|
| Relative | `=A1` | Row/col offset with the target cell |
| Absolute | `=$A$1` | Stays unchanged |
| Mixed (col absolute) | `=$A1` | Row adjusts, column locked |
| Mixed (row absolute) | `=A$1` | Column adjusts, row locked |
| Composite | `=B1*$F$1` | `B1` adjusts, `$F$1` locked |

### Interaction

- **Fill handle**: 6px square at the selection's bottom-right corner, theme primary color; turns grey when the selection partially intersects a merge (fill disabled).
- **Hit-test**: independent `isFillHandleHit()` runs after resize handles and before cell click; hover shows `crosshair` cursor.
- **State machine**: a dedicated `autofilling` state prevents selection drag / editor / resize from starting; ESC cancels mid-drag.
- **Live preview**: the target range renders as a semi-transparent dashed rectangle during drag; the source selection stays put; no cell data is mutated until `mouseup`.
- **Edge auto-scroll**: dragging within 30px of the viewport edge starts a single `requestAnimationFrame` loop that scrolls and updates the target range; stopped on `mouseup` / ESC / pointercancel.
- **Dynamic expansion**: fills beyond the current `rowCount`/`colCount` trigger `ensureCapacity()` first, folded into the same undo step.
- **Selection after fill**: the selection updates to the union of source + target range.
- **Freeze panes**: all coordinates flow through `cellToScreenRect` / `screenToCell`, so the handle, hit-test, preview, and final fill work across frozen and body regions alike.
- **Merge compatibility**: partially intersecting merges disable the fill handle (conservative first version); whole-block merges fill correctly.
- **Touch**: shares the same `autoFillState` and `applyAutoFill` path as mouse: no separate implementation.

### Architecture

```
Fill Handle UI (drawFillHandle)
       ↓
Unified Hit-Test (isFillHandleHit)
       ↓
AutoFill Drag State (autoFillState)
       ↓
Target Range Calculation (computeTargetRange)
       ↓
Pure AutoFill Pattern Engine (core/autofill.ts)
       ↓
Formula Translation (shiftFormulaRefs)
       ↓
Style / Border / Cell Mutation (applyAutoFill)
       ↓
Undo Snapshot (saveUndo, one step per drag)
       ↓
scheduleRender()
```

The pure engine (`core/autofill.ts`) has zero Vue/Canvas dependencies and is fully unit-tested in `test/autofill.test.ts` (54 cases), making it reusable for `Ctrl+D`/`Ctrl+R`, paste-fill, right-click fill, and programmatic auto-fill.

---

## Auto Filter (AutoFilter)

An Excel-style auto filter on a normal range: filtering is a **Sheet-level feature bound to a data Range**, not a per-column-header filter. The header arrows are drawn on the Canvas (no DOM); the filter panel uses Vue DOM.

### Enable & toggle

- Toolbar **Data → Filter** or `Ctrl+Shift+L` invokes `toggleAutoFilter()`.
- **Not enabled → create**: select a data cell or a single-row multi-column range, then the filter is created by probing the contiguous data region **downward** from that header row; a completely empty sheet creates no invalid filter.
- **Enabled → remove entirely**: restores hidden rows, clears all column criteria, and removes header arrows. The toolbar button's highlighted state exactly matches its click behavior (highlight = enabled, click = turn off).
- Selecting a single merged cell (a multi-cell merge) with no active filter disables the filter button (a merged cell cannot serve as a valid data-region header).

### Header arrow

- Shown only on the header row of the Filter Range and only for columns inside the range; not shown when disabled or outside the range.
- Styled as a "drop-down button with background on the right border": grey background + dark arrow when not filtered, blue background + white arrow when filtered (distinguishes "enabled" from "this column filtered").
- Clicking the arrow opens only the filter panel, never a normal selection; with frozen panes the arrow renders correctly on the frozen header.

### Filter panel

Reuses the existing engine: the title shows the column's header text (not the column letter); unchecking items takes effect only on **OK**, never immediately. Supports value / text / number / date filters, search, blanks, and multi-column AND; candidate values come from the corresponding column inside the Filter Range, generated from already-filtered rows when other columns are filtered (Excel cascading behavior).

### Compatibility

- Hidden rows use the existing `filteredOutRows` + visible-row mapping; rows are **never deleted or copied**.
- Row/column insert/delete adjust the range via `adjustFilterRows` / `adjustFilterCols`; deleting the entire filter region auto-cancels the filter.
- After sorting, filtered rows are recomputed; original row indices are preserved.
- Persisted through v-model, fully retaining range, arrows, criteria, and hidden rows.

---

## Border System

A dedicated border storage & rendering mechanism (`spreader/core/border-pool.ts` + `border-resolve.ts`).

- **Dedicated border pool**: each sheet maintains a `borders: BorderStyle[]` pool (`borders[0]` is always the empty border `{}`); styles reference borders by index (`borderId`), and identical borders are deduplicated.
- **Shared-border resolution**: adjacent cells' shared border is resolved at render time via `resolveSharedBorder()`: wider wins, then the first side on equal width; setting a border no longer mutates neighboring cells.
- **Merged cells**: merged-region borders are stored at the anchor (top-left); internal borders are masked, outer boundaries are resolved segment-wise against neighbors, and the four corners fill in corner blocks.
- **Legacy compatibility**: legacy inline border props (`borderTopWidth`, etc., deprecated) are auto-migrated via `migrateBordersInStyles()` on load.

---

## Theming

### Built-in Themes

```typescript
import type { ThemeColors } from 'xiaodao-spreader';

const lightTheme: ThemeColors = { /* 50+ color fields */ };
const darkTheme: ThemeColors = { /* 50+ color fields */ };
```

### CSS Variable Injection

Theme colors are injected via CSS custom properties (`--sp-*`):

```css
--sp-bg, --sp-gridBg, --sp-gridLine, --sp-selectionBg,
--sp-headerBg, --sp-headerBorder, --sp-headerText,
--sp-formulaBarBg, --sp-formulaBarInputBorder,
--sp-wrapperBg, --sp-cellEditorBorder,
/* ... and many more */
```

### Custom Theme

Pass `theme="dark"` for dark mode, or create a wrapper component that overrides CSS variables for full customization:

```vue
<template>
  <div style="--sp-bg: #1a1a2e; --sp-cellText: #e0e0e0;">
    <Spreader v-model:data="myData" theme="dark" />
  </div>
</template>
```

### Internationalization

Built-in languages: `'zh-CN'`, `'en-US'`. Pass via `locale` prop. Right-click menus and toolbar labels are automatically localized.

---

## Development

```bash
# Install dependencies
pnpm install

# Start dev server (with auto-reload)
pnpm dev

# Type check only
pnpm type-check
```

The dev server runs on `http://localhost:5173` by default.

---

## Building

```bash
# Production build (type-check + vite build)
pnpm build

# Preview production build
pnpm preview

# Build for demo/testing purposes
pnpm build:demo
```

### Build Output

| File | Description |
|------|-------------|
| `dist/xiaodao-spreader.es.js` | ES module (for bundlers) |
| `dist/xiaodao-spreader.umd.js` | UMD bundle (for direct `<script>` usage) |
| `dist/style.css` | Extracted stylesheet |
| `dist/types/` | TypeScript declaration files |

### CI/CD

The project includes a GitHub Actions workflow (`.github/workflows/publish.yml`) for automated publishing to npm.

---

## Touch & Mobile Interaction

x-spreader is touch-first: every mouse interaction has a symmetric touch path, verified on real mobile devices.

- **Tap to select / long-press for context menu**: tap a cell, row header, column header, or the corner select-all button to select; long-press (450ms) inside the current selection opens the right-click context menu (cell / row / column / corner). Long-press outside the selection falls back to range selection / header drag-multi-select, so gestures never conflict.
- **Header filter arrow**: tap the arrow on the header cell to open the AutoFilter panel (`onTouchStart` now hit-tests the filter button).
- **Resize columns / rows**: touch the right edge of a column header or bottom edge of a row header (8px hot zone, widened on touch) to drag width / height.
- **Range selection**: long-press a cell (450ms) then drag to draw a rectangular selection; long-press a row/column header then drag to expand the selection. A clear drag (>8px) switches to scrolling; a light tap keeps the single selection.
- **Format brush**: after copying a style from a source cell, tap the target range on touch to apply it (mirrors mouse `onMouseUp`).
- **Commit edit by tapping outside**: tapping empty canvas or outside the formula bar commits an in-progress cell / formula-bar edit (mirrors mouse `onMouseDown`).
- **Tab bar**: long-press a tab button or the empty tab-bar area (450ms) opens the tab right-click menu.
- **Popups close on outside tap**: the context menu and the row-height / column-width editor panel (`dimPanel`) close on outside tap. They listen on `touchstart` because `onTouchStart` calls `preventDefault()`, which suppresses the synthetic `click`/`mousedown` that desktop close-listeners rely on. All other pickers already use `pointerdown` and close correctly on touch.

## Roadmap

### Near-term

- [x] More formulas: `COUNT`, `IF`, `VLOOKUP`, `CONCATENATE`
- [x] Cell background color picker
- [x] Number format (currency, percentage, date, number of decimals): *see [Number Format](#number-format)*
- [x] Conditional Formatting: preset rules (highlight cells / duplicate / unique / blank / not blank), formula-based conditions, formula ref adjustment on insert/delete, manage & clear rules dialogs. *see [Conditional Formatting](#conditional-formatting)*
- [x] Auto-fill drag handle: *see [Auto Fill](#auto-fill)*
- [x] Find & Replace: *see [Find & Replace](#find--replace)*

### Mid-term

- [x] Frozen panes (freeze rows/columns): *see [Freeze Panes](#features)*
- [x] Data Validation: dropdown lists, input constraints (any value / list / whole number / decimal / date / time / text length / custom formula), list dropdown with search & keyboard nav, input message and error alert (Stop/Warning/Information), atomic paste/auto-fill validation, undo/redo and persistence; see [Data Validation](#data-validation)
- [ ] Column / row grouping and collapsing
- [x] Sort & filter: sort by displayed content with Excel-style Sort Warning dialog (expand selection / current selection only); see [Sorting & Sort Warning](#features)
- [x] Auto Filter (AutoFilter): toolbar "Filter" / `Ctrl+Shift+L` to enable, header drop-down arrows, intelligent downward data probing, value/text/number/date multi-type filters, separate clear-column vs remove-all; see [Auto Filter (AutoFilter)](#auto-filter-autofilter)
- [x] Touch & mobile interaction: symmetric touch paths for select / context menu / filter / resize / range select / format brush / tab menu; popups close on outside tap; see [Touch & Mobile Interaction](#touch--mobile-interaction)
- [ ] Cell comments / notes
- [ ] Print layout

### Long-term

- [ ] OffscreenCanvas + Web Worker for multi-threaded rendering
- [ ] Shared worker for cross-tab collaboration
- [ ] Plugin system for custom cell renderers
- [ ] Excel / CSV import & export
- [ ] Chart engine (embedded mini-charts)

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Vue 3 (Composition API + `<script setup>`) | ^3.4 |
| Build | Vite | ^5.0 |
| Language | TypeScript (strict) | ~5.4 |
| Rendering | Canvas 2D API | - |
| Type Checker | vue-tsc | ^2.2 |
| Package Manager | pnpm | - |
| CSS | Scoped CSS + CSS Custom Properties | - |

---

## License

This project is licensed under the MIT License: see the [LICENSE](LICENSE) file for details.
