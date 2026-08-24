# Xiaodao Spreader

[中文](./README.ZH.md) | English

A high-performance, canvas-based spreadsheet component for Vue 3 — bringing an Excel-like editing experience to the web.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3.4+-42b883.svg)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178C6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.0+-646CFF.svg)](https://vitejs.dev/)

![Preview](./img/preview.png)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Basic Usage](#basic-usage)
- [Props](#props)
- [Data Model](#data-model)
- [Architecture](#architecture)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Formula Engine](#formula-engine)
- [Number Format](#number-format)
- [Theming](#theming)
- [Development](#development)
- [Building](#building)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [中文版](./README.ZH.md)

---

## Features

### Core Spreadsheet
- **Canvas 2D Rendering** — High-DPI aware with DPR scaling, virtual viewport rendering for 200 × 26 sheets
- **Multi-Sheet Workbook** — Tab bar with add, rename, duplicate, delete, reorder
- **Formula Engine** — `=SUM()`, `=AVERAGE()` range calculation with dependency tracking and circular-reference detection; toolbar and context menu provide one-click sum/average
- **Merge Cells** — Merge & Center, Merge Across, Unmerge with border synchronization
- **Rich Cell Formatting** — Font family, font size (5–72), bold, italic, underline, strikethrough, text color, fill color, horizontal & vertical alignment, wrap text
- **Borders** — Top / bottom / left / right / all / none with 5 predefined styles and custom color
- **Undo / Redo** — Full state snapshots for cells, column widths, and row heights (50 steps)
- **Format Painter** — Copy & apply cell formatting across ranges
- **Number Format** — Excel-style number formatting (General / Text / Number / Currency / Accounting / Percent / Scientific / Date / Time / DateTime / Duration) with a custom format dialog; display-only, never mutates the stored cell value

### Interaction
- **Smart Selection** — Click, drag, Shift+Click, row/column header select, corner-cell select-all
- **Double-Click Editing** — Inline cell editor with `<textarea>` for multi-line input
- **Formula Bar** — Dedicated input bar with cell label and live formula display
- **Full Keyboard Navigation** — Arrow keys, Tab, Enter, Home, End, Ctrl+Home, Ctrl+End
- **Context Menus** — Context-aware menus for cells, rows, columns, sheet tabs, with nested submenus
- **Row / Column Operations** — Insert, delete, cut, copy, paste via right-click menu
- **Column Width / Row Height** — Drag-to-resize with live preview and double-click auto-fit
- **Touch Support** — Swipe scrolling, double-tap to edit
- **Responsive** — ResizeObserver for dynamic container sizing

### Visual
- **Light / Dark Theme** — Full color palette with 50+ CSS custom properties
- **Internationalization** — English & Chinese (zh-CN) out of the box
- **Overflow Toolbar** — Responsive toolbar that automatically collapses overflow buttons into a dropdown menu
- **Custom Scrollbars** — Native-styled scrollbars with arrow buttons and draggable thumbs

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
    cells: {
      '0,0': { value: 'Name' },
      '0,1': { value: 'Age' },
      '1,0': { value: 'Alice', style: { fontSize: 14, fontWeight: 'bold' } },
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
| `rowCount` | `number` | `200` | Total rows per sheet |
| `colCount` | `number` | `26` | Total columns per sheet |
| `width` | `number \| string` | — | Component width (pixels; omit or pass `string` for responsive) |
| `height` | `number \| string` | — | Component height (pixels; omit or pass `string` for responsive) |
| `theme` | `'light' \| 'dark'` | `'light'` | Theme mode |
| `locale` | `string` | `'zh-CN'` | Language — `'zh-CN'` \| `'en-US'` |

---

## Data Model

### `SheetModelData`

The external data format used for v-model two-way binding:

```typescript
interface SheetModelData {
  name: string;
  cells: Record<string, {
    value: string;
    style?: Record<string, unknown>;
  }>;
  merges?: Record<string, SelectionRange>;
  colWidths?: Record<number, number>;
  rowHeights?: Record<number, number>;
}
```

- **`cells`**: Key is `"col,row"` (e.g., `"0,0"` for cell A1).
- **`style`**: Arbitrary CSS-like style properties (`fontSize`, `fontWeight`, `color`, `background`, etc.).
- **`merges`**: Merge cell definitions, keyed by merge anchor cell.
- **`colWidths` / `rowHeights`**: Sparse maps — only stores non-default values.

### Type Exports

```typescript
import type {
  CellCoord,       // { col: number; row: number }
  SelectionRange,  // { startCol; startRow; endCol; endRow }
  CellData,        // { value: string; style: Record<string, unknown> | null }
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
```

---

## Architecture

```
src/
├── index.ts                          # Library entry — re-exports from spreader/
├── App.vue                           # Demo application
└── components/
    └── spreader/
        ├── index.ts                  # Unified export — component + types (barrel)
        ├── components/
        │   ├── spreader.vue          # Entry component — template + style + composition
        │   ├── toolbar.vue           # Toolbar with overflow dropdown
        │   ├── tabbar.vue            # Sheet tab bar
        │   ├── dropdown.vue          # Generic dropdown component
        │   └── pickers/
        │       ├── colorPicker.vue
        │       ├── borderPicker.vue
        │       ├── mergePicker.vue
        │       └── numberFormatDialog.vue
        ├── composables/
        │   ├── core-state.ts        # Props, cells/merges/selection, font metrics, navigation
        │   ├── undo-styles.ts       # Undo/redo, format painter, font/alignment/color
        │   ├── borders-merge.ts     # Border sync, merge ops, clipboard, sum
        │   ├── sheets-ops.ts        # Row/col ops, multi-sheet, v-model emit, theme, refs
        │   └── interactions.ts      # Renderer, formula bar, tab bar, context menu, scrollbar, events
        └── core/
            ├── constants.ts         # Layout constants, i18n, theme palettes
            ├── types.ts             # All type definitions
            ├── formula.ts          # Formula engine (parse, evaluate, deps, cache)
            ├── number-format.ts    # Number format engine (Excel-style display formatting)
            ├── theme.ts             # Theme CSS variable construction
            └── utils.ts            # Pure utilities (col label, hit test, resolve size)
```

### Design Principles

- **Composition API**: All business logic extracted into `composables/`, maintaining single-responsibility modules
- **Barrel Export**: `spreader/index.ts` centralizes all component and type exports; `src/index.ts` re-exports everything, so consumers import uniformly from `xiaodao-spreader`
- **Canvas 2D Rendering**: Only visible cells are drawn (virtual rendering), ensuring smooth performance on large sheets
- **No Dirty Flags**: Manual `scheduleRender()` calls at interaction end-points; `requestAnimationFrame` automatically merges multiple calls within the same frame
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
| Absolute ref | `$A$1` | Lock column and row |
| Mixed ref | `$A1`, `A$1` | Lock column or row only |

### Dependency Tracking

The `FormulaDeps` class maintains a bidirectional dependency graph:

- **Forward**: `formulaKey` → `[depKey, ...]` — which cells a formula references
- **Reverse**: `depKey` → `Set<formulaKey>` — which formulas depend on a cell

When a cell changes, dirty flags propagate through the reverse graph. Circular references (depth > 20) return `#ERROR`.

### Reference Offsetting During Paste

`shiftFormulaRefs()` automatically adjusts cell references in formulas when pasting, with `$` absolute reference locking.

---

## Number Format

An Excel-style number formatting engine (`spreader/core/number-format.ts`) that controls **how a cell value is displayed** — it never mutates the stored `value` (which always remains a raw string).

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
| Custom | User-defined Excel-style code | — |

### How it works

- **Storage**: the format code is stored per-cell in `cell.style.numberFormat` (a string). Omitting the property (or empty string) means General.
- **UI**: the toolbar number-format dropdown applies presets to the current selection; the **「Format…」(格式…)** item opens `numberFormatDialog.vue` for a custom code, decimals, and thousands separator.
- **Display**: `formatNumber(value, format, locale)` parses the code (cached), applies thousands separators / decimals / percent scaling / date-serial conversion, and returns the display string. Invalid date/duration serials render as `###`.
- **Alignment**: numeric formats default to right-aligned; Text and General-with-non-numeric keep left alignment — matching Excel semantics.
- **i18n**: currency symbol (`¥` / `$`), month and weekday names follow the `locale` prop.

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

## Roadmap

### Near-term

- [ ] More formulas: `COUNT`, `IF`, `VLOOKUP`, `CONCATENATE`
- [ ] Cell background color picker
- [x] Number format (currency, percentage, date, number of decimals) — *see [Number Format](#number-format)*
- [ ] Conditional formatting rules
- [ ] Auto-fill drag handle
- [ ] Find & Replace

### Mid-term

- [ ] Frozen panes (freeze rows/columns)
- [ ] Data validation (dropdown lists, input constraints)
- [ ] Column / row grouping and collapsing
- [ ] Sort & filter
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
| Rendering | Canvas 2D API | — |
| Type Checker | vue-tsc | ^2.2 |
| Package Manager | pnpm | — |
| CSS | Scoped CSS + CSS Custom Properties | — |

---

## Contributing

Contributions are welcome! Please feel free to:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Before submitting, please ensure the type check passes (`pnpm type-check`) and the build succeeds (`pnpm build`).

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

**Crafted with care by [xiaodaozhi](https://github.com/xiaodaozhi)**
