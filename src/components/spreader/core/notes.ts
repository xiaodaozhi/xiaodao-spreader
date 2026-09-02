/**
 * 批注（Note）纯逻辑：CRUD、单元格与批注的绑定管理、范围内批注收集与孤儿清理。
 * 无 Vue 依赖，供 core-state 与批注浮层（note-overlay）调用。
 */
import type { CellNote, CellData, SelectionRange } from './types';
/** 安全移除 Record 中的指定 key（避免 ESLint no-dynamic-delete） */
function removeFromRecord<T>(rec: Record<string, T>, key: string): void {
  // delete 用于真正移除属性（保留 Object.keys 语义），此处动态 key 不可避免
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete rec[key];
}

/** 生成唯一 Note ID */
export function genNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createEmptyNotes(): Record<string, CellNote> {
  return {};
}

/** 从序列化数据加载批注池（兼容旧数据无 notes 的情况；返回浅拷贝避免共享引用） */
export function loadNotes(serialized?: Record<string, CellNote>): Record<string, CellNote> {
  if (!serialized) return {};
  return { ...serialized };
}

// ============ Note Manager（纯函数，传入 cells / notes 池操作）============

/** 单元格 key（与项目 "col,row" 稀疏结构一致） */
function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** 单元格是否有批注 */
export function hasNote(row: number, col: number, cells: Record<string, CellData>): boolean {
  const cell = cells[cellKey(col, row)];
  return !!(cell && cell.noteId);
}

/** 读取单元格批注（返回池中对象引用） */
export function getNote(
  row: number,
  col: number,
  cells: Record<string, CellData>,
  notes: Record<string, CellNote>,
): CellNote | undefined {
  const cell = cells[cellKey(col, row)];
  if (!cell || !cell.noteId) return undefined;
  return notes[cell.noteId];
}

/** 按 ID 读取批注 */
export function getNoteById(id: string, notes: Record<string, CellNote>): CellNote | undefined {
  return notes[id];
}

/** 创建纯批注对象（不落池） */
export function createNote(text: string, author?: string): CellNote {
  const now = Date.now();
  return {
    id: genNoteId(),
    text,
    author,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 为单元格创建/覆盖批注：新建 note 写入池并绑定 cell.noteId。
 * 若 cell 原先已有批注会先清理旧池对象（避免孤儿）。
 * 返回新批注对象。
 */
export function setNote(
  row: number,
  col: number,
  text: string,
  author: string | undefined,
  cells: Record<string, CellData>,
  notes: Record<string, CellNote>,
): CellNote {
  const key = cellKey(col, row);
  const cell = cells[key] || (cells[key] = { value: '' });
  if (cell.noteId && notes[cell.noteId]) {
    removeFromRecord(notes, cell.noteId!);
  }
  const note = createNote(text, author);
  notes[note.id] = note;
  cell.noteId = note.id;
  return note;
}

/** 更新现存批注文本（仅改 text 与 updatedAt） */
export function updateNote(
  id: string,
  text: string,
  notes: Record<string, CellNote>,
): CellNote {
  const note = notes[id];
  if (!note) throw new Error(`Note ${id} not found`);
  note.text = text;
  note.updatedAt = Date.now();
  return note;
}

/** 删除单元格批注（清理池对象 + cell.noteId），返回被删的 note 或 undefined */
export function removeNote(
  row: number,
  col: number,
  cells: Record<string, CellData>,
  notes: Record<string, CellNote>,
): CellNote | undefined {
  const key = cellKey(col, row);
  const cell = cells[key];
  if (!cell || !cell.noteId) return undefined;
  const removed = notes[cell.noteId];
  removeFromRecord(notes, cell.noteId!);
  cell.noteId = undefined;
  // cell 仅剩空 value 时回收该键，保持稀疏结构
  if (Object.keys(cell).length === 1 && 'value' in cell && cell.value === '') {
    removeFromRecord(cells, key);
  }
  return removed;
}

/** 批量读取选区内所有批注（key -> note） */
export function getNotesInRange(
  range: SelectionRange,
  cells: Record<string, CellData>,
  notes: Record<string, CellNote>,
): Map<string, CellNote> {
  const result = new Map<string, CellNote>();
  for (let r = range.startRow; r <= range.endRow; r++) {
    for (let c = range.startCol; c <= range.endCol; c++) {
      const cell = cells[cellKey(c, r)];
      if (cell && cell.noteId && notes[cell.noteId]) {
        result.set(cellKey(c, r), notes[cell.noteId]!);
      }
    }
  }
  return result;
}

/**
 * 复制批注引用：源 cell 有 note 时，目标 cell 复用同一 noteId（共享 note 对象）。
 * 目标原有批注会被覆盖（其池对象交由上层统一 GC）。
 */
export function copyNoteToCell(
  srcRow: number,
  srcCol: number,
  dstRow: number,
  dstCol: number,
  cells: Record<string, CellData>,
): void {
  const srcCell = cells[cellKey(srcCol, srcRow)];
  if (!srcCell || !srcCell.noteId) return;
  const dstKey = cellKey(dstCol, dstRow);
  const dstCell = cells[dstKey] || (cells[dstKey] = { value: '' });
  dstCell.noteId = srcCell.noteId;
}

/** 清理池中没有被任何 cell 引用的孤儿 note */
export function gcOrphanNotes(
  cells: Record<string, CellData>,
  notes: Record<string, CellNote>,
): void {
  const used = new Set<string>();
  for (const key in cells) {
    const cell = cells[key];
    if (cell?.noteId) used.add(cell.noteId);
  }
  for (const id in notes) {
    if (!used.has(id)) removeFromRecord(notes, id);
  }
}

/**
 * 插入行后平移全部 cell 引用（row >= insertAt 的行整体下移 count）。
 * 项目本体在 sheets-ops 的 insertRows 中已有整块单元格搬移逻辑，
 * 此处声明为独立函数便于与 notes 联动测试；实际调用时由上层在搬移后同步执行。
 */
export function adjustForInsertRows(
  insertAt: number,
  count: number,
  cells: Record<string, CellData>,
): void {
  const moves: Array<{ oldKey: string; newKey: string; cell: CellData }> = [];
  for (const key in cells) {
    const comma = key.indexOf(',');
    const col = Number(key.slice(0, comma));
    const row = Number(key.slice(comma + 1));
    if (row >= insertAt) {
      moves.push({ oldKey: key, newKey: cellKey(col, row + count), cell: cells[key]! });
    }
  }
  for (const m of moves) {
    removeFromRecord(cells, m.oldKey);
    cells[m.newKey] = m.cell;
  }
}

/** 插入列后平移全部 cell 引用 */
export function adjustForInsertCols(
  insertAt: number,
  count: number,
  cells: Record<string, CellData>,
): void {
  const moves: Array<{ oldKey: string; newKey: string; cell: CellData }> = [];
  for (const key in cells) {
    const comma = key.indexOf(',');
    const col = Number(key.slice(0, comma));
    const row = Number(key.slice(comma + 1));
    if (col >= insertAt) {
      moves.push({ oldKey: key, newKey: cellKey(col + count, row), cell: cells[key]! });
    }
  }
  for (const m of moves) {
    removeFromRecord(cells, m.oldKey);
    cells[m.newKey] = m.cell;
  }
}

/** 删除行：命中区间的 cell 及其 note 一并删除，后续行整体上移 */
export function adjustForDeleteRows(
  deleteStart: number,
  deleteEnd: number,
  cells: Record<string, CellData>,
  notes: Record<string, CellNote>,
): void {
  const del = deleteEnd - deleteStart + 1;
  const moves: Array<{ oldKey: string; newKey: string; cell: CellData }> = [];
  for (const key in cells) {
    const comma = key.indexOf(',');
    const col = Number(key.slice(0, comma));
    const row = Number(key.slice(comma + 1));
    if (row >= deleteStart && row <= deleteEnd) {
      const cell = cells[key]!;
      if (cell.noteId) removeFromRecord(notes, cell.noteId!);
      removeFromRecord(cells, key);
    } else if (row > deleteEnd) {
      moves.push({ oldKey: key, newKey: cellKey(col, row - del), cell: cells[key]! });
    }
  }
  for (const m of moves) {
    removeFromRecord(cells, m.oldKey);
    cells[m.newKey] = m.cell;
  }
}

/** 删除列：命中区间的 cell 及其 note 一并删除，后续列整体左移 */
export function adjustForDeleteCols(
  deleteStart: number,
  deleteEnd: number,
  cells: Record<string, CellData>,
  notes: Record<string, CellNote>,
): void {
  const del = deleteEnd - deleteStart + 1;
  const moves: Array<{ oldKey: string; newKey: string; cell: CellData }> = [];
  for (const key in cells) {
    const comma = key.indexOf(',');
    const col = Number(key.slice(0, comma));
    const row = Number(key.slice(comma + 1));
    if (col >= deleteStart && col <= deleteEnd) {
      const cell = cells[key]!;
      if (cell.noteId) removeFromRecord(notes, cell.noteId!);
      removeFromRecord(cells, key);
    } else if (col > deleteEnd) {
      moves.push({ oldKey: key, newKey: cellKey(col - del, row), cell: cells[key]! });
    }
  }
  for (const m of moves) {
    removeFromRecord(cells, m.oldKey);
    cells[m.newKey] = m.cell;
  }
}

/** 交换两个单元格的 noteId 引用（排序时随数据一起移动） */
export function swapNotes(
  row1: number,
  col1: number,
  row2: number,
  col2: number,
  cells: Record<string, CellData>,
): void {
  const k1 = cellKey(col1, row1);
  const k2 = cellKey(col2, row2);
  const c1 = cells[k1];
  const c2 = cells[k2];
  if (!c1 && !c2) return;
  if (!c1 && c2) {
    cells[k1] = { value: '', noteId: c2.noteId };
    c2.noteId = undefined;
    return;
  }
  if (c1 && !c2) {
    cells[k2] = { value: '', noteId: c1.noteId };
    c1.noteId = undefined;
    return;
  }
  if (c1 && c2) {
    const t = c1.noteId;
    c1.noteId = c2.noteId;
    c2.noteId = t;
  }
}
