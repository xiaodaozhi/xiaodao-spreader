/**
 * 查找 / 替换 交互层（依赖 Vue）。
 * 驱动查找栏 UI 的状态与操作：范围 / 大小写 / 整格匹配选项、命中遍历与跳转、
 * 替换与全部替换，纯算法部分委托 core/find-replace-core。
 */
import {
  ref,
  computed,
  watch,
  onBeforeUnmount,
  type Ref,
  type ComputedRef,
} from 'vue';
import { t } from '../core/constants';
import type { CoreState } from './core-state';
import type { UndoStylesState } from './undo-styles';
import type { SheetsOpsState } from './sheets-ops';
import type { FindResult, FindScope } from '../core/types';
import {
  replaceFirst,
  replaceAllOccurrences,
  scanSheetCells,
} from '../core/find-replace-core';

export interface FindReplaceState {
  // 状态
  open: Ref<boolean>;
  findText: Ref<string>;
  replaceText: Ref<string>;
  scope: Ref<FindScope>;
  matchCase: Ref<boolean>;
  matchEntireCell: Ref<boolean>;
  currentIndex: Ref<number>;
  results: Ref<FindResult[]>;
  message: Ref<string>;
  /** 每次打开/需要聚焦时自增，供 UI 聚焦查找输入框 */
  focusToken: Ref<number>;

  // 渲染高亮（仅当前激活 Sheet 的匹配会被绘制）
  activeSheetMatches: ComputedRef<Set<string>>;
  activeMatchKey: ComputedRef<string | null>;

  // 操作
  openFind: () => void;
  openReplace: () => void;
  close: () => void;
  recompute: () => void;
  findNext: () => void;
  findPrev: () => void;
  replace: () => void;
  replaceAll: () => void;
  setupLifecycle: () => void;
}

export function createFindReplace(
  s: CoreState,
  us: UndoStylesState,
  so: SheetsOpsState,
  _lastEmittedDataRef?: { value: string },
): FindReplaceState {
  const open = ref(false);
  const findText = ref('');
  const replaceText = ref('');
  const scope = ref<FindScope>('sheet');
  const matchCase = ref(false);
  const matchEntireCell = ref(false);
  const currentIndex = ref(-1);
  const results = ref<FindResult[]>([]);
  const message = ref('');
  const focusToken = ref(0);
  // 「全部替换」后保留提示，避免被实时重算覆盖
  const stickyMessage = ref('');

  // ===== 高亮（仅当前激活 Sheet）=====
  const activeSheetMatches = computed<Set<string>>(() => {
    const set = new Set<string>();
    const ai = so.activeSheetIndex.value;
    for (const m of results.value) {
      if (m.sheetIndex === ai) set.add(`${m.col},${m.row}`);
    }
    return set;
  });
  const activeMatchKey = computed<string | null>(() => {
    if (currentIndex.value < 0 || currentIndex.value >= results.value.length) return null;
    const m = results.value[currentIndex.value]!;
    if (m.sheetIndex !== so.activeSheetIndex.value) return null;
    return `${m.col},${m.row}`;
  });

  // 注入渲染高亮钩子（render 会调用 s.findHighlight）
  s.findHighlight = (col: number, row: number) => {
    const key = `${col},${row}`;
    if (activeMatchKey.value === key) return 'active';
    if (activeSheetMatches.value.has(key)) return 'match';
    return null;
  };

  // ===== 工具：读取 / 写入某一匹配单元格的 value =====
  function getRawValue(m: FindResult): string {
    const k = s.cellKey(m.col, m.row);
    if (m.sheetIndex === so.activeSheetIndex.value) {
      return s.cells[k]?.value ?? '';
    }
    const sh = so.sheets.value[m.sheetIndex];
    return sh?.cells[k]?.value ?? '';
  }

  function applyReplaceValue(m: FindResult, newVal: string): void {
    const k = s.cellKey(m.col, m.row);
    if (m.sheetIndex === so.activeSheetIndex.value) {
      // 复用核心 setter：保证 value 始终为 string 且保留 style
      s.setCellValue(m.col, m.row, newVal);
    } else {
      const sh = so.sheets.value[m.sheetIndex];
      if (!sh) return;
      const cd = sh.cells[k];
      // 仅修改 value（String 保证），保留 styleId，不改动其它属性
      sh.cells[k] = { value: String(newVal), styleId: cd?.styleId };
    }
  }

  function updateMessage(): void {
    if (stickyMessage.value) {
      message.value = stickyMessage.value;
      return;
    }
    if (!findText.value) {
      message.value = '';
      return;
    }
    if (scope.value === 'selection' && !s.selection.value) {
      message.value = t(s.locale.value, 'findNeedSelection');
      return;
    }
    if (results.value.length === 0) {
      message.value = t(s.locale.value, 'findNoResult');
      return;
    }
    message.value = '';
  }

  function recompute(): void {
    const ft = findText.value;
    const list: FindResult[] = [];
    if (ft) {
      if (scope.value === 'workbook') {
        // 整个工作簿：遍历所有 Sheet 的 cells（非激活 Sheet 直接读存储数据）
        so.sheets.value.forEach((sh, i) => {
          list.push(
            ...scanSheetCells(sh.cells, i, s.cellKey, ft, matchCase.value, matchEntireCell.value),
          );
        });
      } else if (scope.value === 'selection') {
        const sel = s.selection.value;
        if (sel) {
          list.push(
            ...scanSheetCells(
              s.cells,
              so.activeSheetIndex.value,
              s.cellKey,
              ft,
              matchCase.value,
              matchEntireCell.value,
              sel,
            ),
          );
        }
      } else {
        // 当前工作表
        list.push(
          ...scanSheetCells(
            s.cells,
            so.activeSheetIndex.value,
            s.cellKey,
            ft,
            matchCase.value,
            matchEntireCell.value,
          ),
        );
      }
    }
    results.value = list;
    if (list.length === 0) {
      currentIndex.value = -1;
    } else if (currentIndex.value >= list.length) {
      currentIndex.value = list.length - 1;
    } else if (currentIndex.value < 0) {
      currentIndex.value = 0;
    }
    updateMessage();
  }

  function locateCurrent(): void {
    if (currentIndex.value < 0 || currentIndex.value >= results.value.length) return;
    const m = results.value[currentIndex.value]!;
    // 跨 Sheet 匹配：自动切换到对应 Sheet（会保存当前 Sheet 并加载目标）
    if (m.sheetIndex !== so.activeSheetIndex.value) {
      so.switchSheet(m.sheetIndex);
    }
    if (scope.value === 'selection') {
      // 当前选区范围：仅移动活动单元格，不破坏原选区矩形
      s.activeCell.value = { col: m.col, row: m.row };
    } else {
      // 复用现有 Selection 机制，使目标成为当前选中项
      s.selectCell(m.col, m.row);
    }
    s.ensureVisible(m.col, m.row);
  }

  // ===== 防抖重算（合并批量 cells 变更 / 连续输入）=====
  const raf: (cb: () => void) => void
    = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16);
  let recomputePending = false;
  let pendingLocate = false;
  function scheduleRecompute(locate: boolean): void {
    if (recomputePending) {
      pendingLocate = pendingLocate || locate;
      return;
    }
    recomputePending = true;
    pendingLocate = locate;
    raf(() => {
      recomputePending = false;
      recompute();
      if (pendingLocate && results.value.length > 0 && currentIndex.value >= 0) {
        locateCurrent();
      }
      pendingLocate = false;
      s.scheduleRender?.();
    });
  }

  function openFind(): void {
    open.value = true;
    focusToken.value++;
    recompute();
    if (results.value.length > 0) {
      currentIndex.value = 0;
      locateCurrent();
    }
    s.scheduleRender?.();
  }
  function openReplace(): void {
    openFind();
  }
  function close(): void {
    open.value = false;
    results.value = [];
    currentIndex.value = -1;
    stickyMessage.value = '';
    message.value = '';
    s.scheduleRender?.();
  }

  function findNext(): void {
    if (results.value.length === 0) return;
    currentIndex.value = (currentIndex.value + 1) % results.value.length;
    locateCurrent();
    s.scheduleRender?.();
  }
  function findPrev(): void {
    if (results.value.length === 0) return;
    currentIndex.value = (currentIndex.value - 1 + results.value.length) % results.value.length;
    locateCurrent();
    s.scheduleRender?.();
  }

  function replace(): void {
    if (!s.editable.value) return;
    if (currentIndex.value < 0 || currentIndex.value >= results.value.length) return;
    const m = results.value[currentIndex.value]!;
    const raw = getRawValue(m);
    const nv = replaceFirst(raw, findText.value, replaceText.value, matchCase.value);
    if (nv === raw) return; // 内容未变化，跳过
    us.saveUndo();
    applyReplaceValue(m, nv);
    const idx = currentIndex.value;
    recompute();
    if (results.value.length > 0) {
      // 保持当前位置（已钳制）后跳到下一个匹配，便于连续替换
      currentIndex.value = Math.min(idx, results.value.length - 1);
      findNext();
    } else {
      currentIndex.value = -1;
    }
    s.emitModelData?.();
    s.scheduleRender?.();
  }

  function replaceAll(): void {
    if (!s.editable.value) return;
    const ft = findText.value;
    if (!ft || results.value.length === 0) return;
    us.saveUndo(); // 整个「全部替换」仅产生一次 Undo
    let count = 0;
    const snapshot = results.value.slice();
    for (const m of snapshot) {
      const raw = getRawValue(m);
      const nv = replaceAllOccurrences(raw, ft, replaceText.value, matchCase.value);
      if (nv !== raw) {
        applyReplaceValue(m, nv);
        count++;
      }
    }
    results.value = [];
    currentIndex.value = -1;
    // 使用 stickyMessage，避免随后 cells 变更触发的重算把提示覆盖掉
    stickyMessage.value = t(s.locale.value, 'findReplacedAll').replace('{n}', String(count));
    updateMessage();
    s.emitModelData?.();
    s.scheduleRender?.();
  }

  function setupLifecycle(): void {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'f' || k === 'h') {
        e.preventDefault();
        openFind();
      }
    };
    window.addEventListener('keydown', onKey);
    onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
  }

  // ===== 自动重算触发（仅查找栏打开时）=====
  // 关键词 / 搜索范围 / 匹配规则变更 → 跳到首个匹配
  watch(findText, () => {
    if (open.value) {
      stickyMessage.value = '';
      currentIndex.value = 0;
      scheduleRecompute(true);
    }
  });
  watch([scope, matchCase, matchEntireCell], () => {
    if (open.value) {
      stickyMessage.value = '';
      currentIndex.value = 0;
      scheduleRecompute(true);
    }
  });
  // 单元格数据变更（含编辑/粘贴等）→ 刷新结果
  watch(
    s.cells,
    () => {
      if (open.value) scheduleRecompute(false);
    },
    { deep: true },
  );
  // 当前选区变更（仅选区范围搜索时）刷新结果
  watch(
    () => s.selection.value,
    () => {
      if (open.value && scope.value === 'selection') {
        currentIndex.value = 0;
        scheduleRecompute(true);
      }
    },
  );
  // 撤销 / 重做 → 结果同步刷新
  watch(
    [() => us.undoStack.value.length, () => us.redoStack.value.length],
    () => {
      if (open.value) scheduleRecompute(false);
    },
  );

  return {
    open,
    findText,
    replaceText,
    scope,
    matchCase,
    matchEntireCell,
    currentIndex,
    results,
    message,
    focusToken,
    activeSheetMatches,
    activeMatchKey,
    openFind,
    openReplace,
    close,
    recompute,
    findNext,
    findPrev,
    replace,
    replaceAll,
    setupLifecycle,
  };
}
