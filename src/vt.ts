/**
 * ShellPort — Headless VT100/VT220/xterm State Machine, Soft-Wrap Reflow & Snapshots
 *
 * Shared zero-DOM terminal core used both on the server (`HeadlessTerm`) and in
 * the browser (`NanoTermV2 extends HeadlessTerm`).
 */

// Maximum buffer size for OSC/DCS sequences (64 KB)
export const MAX_SEQUENCE_SIZE = 65536

// Packed cell layout: 16 bytes (4 x Uint32) per cell
export const CELL_WORDS = 4
export const CELL_CP_SHIFT = 11
export const CELL_FLAGS_MASK = 0x7ff
export const COLOR_DEFAULT = 0
export const SPACE_CP = 0x20
const DEFAULT_SPACE_WORD0 = (SPACE_CP << CELL_CP_SHIFT) >>> 0

export const ATTR = {
  BOLD: 1 << 0,
  DIM: 1 << 1,
  ITALIC: 1 << 2,
  UNDERLINE: 1 << 3,
  BLINK: 1 << 4,
  INVERSE: 1 << 5,
  HIDDEN: 1 << 6,
  STRIKETHROUGH: 1 << 7,
  DOUBLE_UNDERLINE: 1 << 8,
  OVERLINE: 1 << 9,
} as const

// Standard xterm 256-color palette
export const XTERM_256_PALETTE: string[] = [
  '#0d0d0d',
  '#e74c3c',
  '#2ecc71',
  '#f1c40f',
  '#3498db',
  '#a78bfa',
  '#1abc9c',
  '#e0e0e0',
  '#555555',
  '#ff6b6b',
  '#4ade80',
  '#fde047',
  '#60a5fa',
  '#c4b5fd',
  '#2dd4bf',
  '#ffffff',
  ...Array.from({ length: 216 }, (_, i) => {
    const r = Math.floor(i / 36) * 51
    const g = (Math.floor(i / 6) % 6) * 51
    const b = (i % 6) * 51
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
  }),
  ...Array.from({ length: 24 }, (_, i) => {
    const gray = 8 + i * 10
    return '#' + [gray, gray, gray].map((x) => x.toString(16).padStart(2, '0')).join('')
  }),
]

export function hexToRGBA(hex: string): number {
  return (
    ((parseInt(hex.slice(1, 3), 16) << 24) |
      (parseInt(hex.slice(3, 5), 16) << 16) |
      (parseInt(hex.slice(5, 7), 16) << 8) |
      0xff) >>>
    0
  )
}

export function rgbPack(r: number, g: number, b: number): number {
  return ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0
}

export const XTERM_256_RGBA: number[] = XTERM_256_PALETTE.map(hexToRGBA)

export const DEC_SPECIAL_GRAPHICS: Record<string, string> = {
  '`': '◆',
  a: '▒',
  f: '°',
  g: '±',
  j: '┘',
  k: '┐',
  l: '┌',
  m: '└',
  n: '┼',
  o: '⎺',
  p: '⎻',
  q: '─',
  r: '⎼',
  s: '⎽',
  t: '├',
  u: '┤',
  v: '┴',
  w: '┬',
  x: '│',
  y: '≤',
  z: '≥',
  '{': 'π',
  '|': '≠',
  '}': '£',
  '~': '·',
}

export interface HeadlessTermOptions {
  readonly cols?: number
  readonly rows?: number
  readonly scrollback?: number
  /**
   * When true, terminal identification and status queries (`DA1`, `DA2`, `DSR`,
   * `CPR`) are NOT echoed via `sendFn`. Enable on attached UI views when a
   * server-side `HeadlessTerm` already answers PTY probes once.
   */
  readonly passiveQueries?: boolean
}

export interface TerminalSnapshot {
  readonly version: 1
  readonly cols: number
  readonly rows: number
  readonly useAlternate: boolean
  readonly cursorX: number
  readonly cursorY: number
  readonly savedCursorX: number
  readonly savedCursorY: number
  readonly cursorVisible: boolean
  readonly wrapPending: boolean
  readonly curFg: number
  readonly curBg: number
  readonly curFlags: number
  readonly savedFg: number
  readonly savedBg: number
  readonly savedFlags: number
  readonly scrollTop: number
  readonly scrollBottom: number
  readonly charsetG0: string
  readonly charsetG1: string
  readonly activeCharset: number
  readonly applicationCursorKeys: boolean
  readonly mouseTracking: number
  readonly mouseProtocol: 'normal' | 'sgr'
  readonly bracketedPaste: boolean
  readonly title: string
  readonly primaryRows: readonly string[]
  readonly primaryWrapped: readonly boolean[]
  readonly scrollbackRows: readonly string[]
  readonly scrollbackWrapped: readonly boolean[]
  readonly alternateRows?: readonly string[]
}

export interface TerminalCellDump {
  readonly char: string
  readonly fg: string | null
  readonly bg: string | null
  readonly bold: boolean
  readonly dim: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly inverse: boolean
  readonly strike: boolean
}

export interface TerminalGridDump {
  readonly cols: number
  readonly rows: number
  readonly cursor: { readonly x: number; readonly y: number; readonly visible: boolean }
  readonly altScreen: boolean
  readonly lines: string[]
  readonly cells: TerminalCellDump[]
}

function rgbaHex(rgba: number): string {
  const r = (rgba >>> 24) & 0xff
  const g = (rgba >>> 16) & 0xff
  const b = (rgba >>> 8) & 0xff
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

export function allocTermGrid(cols: number, rows: number): Uint32Array {
  const grid = new Uint32Array(cols * rows * CELL_WORDS)
  for (let i = 0; i < grid.length; i += CELL_WORDS) {
    grid[i] = DEFAULT_SPACE_WORD0
  }
  return grid
}

function allocTermRow(cols: number): Uint32Array {
  const row = new Uint32Array(cols * CELL_WORDS)
  for (let i = 0; i < row.length; i += CELL_WORDS) {
    row[i] = DEFAULT_SPACE_WORD0
  }
  return row
}

function isDefaultBlankCell(buf: Uint32Array, off: number): boolean {
  const w0 = (buf[off] ?? 0) >>> 0
  return (
    (w0 === DEFAULT_SPACE_WORD0 || w0 === 0) &&
    (buf[off + 1] ?? 0) >>> 0 === COLOR_DEFAULT &&
    (buf[off + 2] ?? 0) >>> 0 === COLOR_DEFAULT
  )
}

function trimmedRowCells(row: Uint32Array): number {
  const totalCols = Math.floor(row.length / CELL_WORDS)
  for (let x = totalCols - 1; x >= 0; x--) {
    if (!isDefaultBlankCell(row, x * CELL_WORDS)) {
      return x + 1
    }
  }
  return 0
}

function encodeRowBase64(row: Uint32Array): string {
  const count = trimmedRowCells(row)
  if (count === 0) return ''
  const packed = new Uint32Array(count * 3)
  for (let x = 0; x < count; x++) {
    const src = x * CELL_WORDS
    const dst = x * 3
    packed[dst] = (row[src] ?? 0) >>> 0
    packed[dst + 1] = (row[src + 1] ?? 0) >>> 0
    packed[dst + 2] = (row[src + 2] ?? 0) >>> 0
  }
  const bytes = new Uint8Array(packed.buffer, packed.byteOffset, packed.byteLength)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function decodeRowBase64(encoded: string, cols: number): Uint32Array {
  const row = allocTermRow(cols)
  if (!encoded) return row
  const binary = atob(encoded)
  const byteLen = binary.length - (binary.length % 12)
  if (byteLen <= 0) return row
  const bytes = new Uint8Array(byteLen)
  for (let i = 0; i < byteLen; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const packed = new Uint32Array(bytes.buffer, bytes.byteOffset, byteLen / 4)
  const cells = Math.min(cols, Math.floor(packed.length / 3))
  for (let x = 0; x < cells; x++) {
    const src = x * 3
    const dst = x * CELL_WORDS
    row[dst] = (packed[src] ?? 0) >>> 0
    row[dst + 1] = (packed[src + 1] ?? 0) >>> 0
    row[dst + 2] = (packed[src + 2] ?? 0) >>> 0
    row[dst + 3] = 0
  }
  return row
}

function rowToPlainString(row: Uint32Array, keepAllSpaces: boolean, minLen = 0): string {
  const cols = Math.floor(row.length / CELL_WORDS)
  let s = ''
  let trailingSpaceStart = -1
  for (let x = 0; x < cols; x++) {
    const cp = ((row[x * CELL_WORDS] ?? 0) >>> 0) >>> CELL_CP_SHIFT
    const ch = cp === 0 ? ' ' : String.fromCodePoint(cp)
    s += ch
    if (ch !== ' ') trailingSpaceStart = -1
    else if (trailingSpaceStart < 0) trailingSpaceStart = x
  }
  if (keepAllSpaces || trailingSpaceStart < 0) return s
  const cut = Math.max(trailingSpaceStart, Math.min(cols, minLen))
  return s.slice(0, cut)
}

interface LogicalLine {
  readonly cells: Uint32Array
  readonly cellCount: number
  readonly cursorPos: number | null
}

interface ReflowInput {
  readonly primaryGrid: Uint32Array
  readonly primaryWrapped: readonly boolean[]
  readonly scrollbackBuffer: readonly Uint32Array[]
  readonly scrollbackWrapped: readonly boolean[]
  readonly oldCols: number
  readonly oldRows: number
  readonly newCols: number
  readonly newRows: number
  readonly cursorX: number
  readonly cursorY: number
  readonly wrapPending: boolean
  readonly maxScrollback: number
}

interface ReflowResult {
  readonly primaryGrid: Uint32Array
  readonly primaryWrapped: boolean[]
  readonly scrollbackBuffer: Uint32Array[]
  readonly scrollbackWrapped: boolean[]
  readonly cursorX: number
  readonly cursorY: number
  readonly wrapPending: boolean
}

function findLastContentRow(
  primaryGrid: Uint32Array,
  primaryWrapped: readonly boolean[],
  oldCols: number,
  oldRows: number,
  cursorY: number
): number {
  const last = Math.max(0, Math.min(oldRows - 1, cursorY))
  const rowWords = oldCols * CELL_WORDS
  for (let y = oldRows - 1; y > last; y--) {
    if (primaryWrapped[y]) return y
    const rowOff = y * rowWords
    for (let x = 0; x < oldCols; x++) {
      if (!isDefaultBlankCell(primaryGrid, rowOff + x * CELL_WORDS)) {
        return y
      }
    }
  }
  return last
}

function buildLogicalLines(input: ReflowInput): LogicalLine[] {
  const sbLen = input.scrollbackBuffer.length
  const clampedCursorY = Math.max(0, Math.min(input.oldRows - 1, input.cursorY))
  const clampedCursorX = Math.max(0, Math.min(input.oldCols - 1, input.cursorX))
  const lastRow = findLastContentRow(
    input.primaryGrid,
    input.primaryWrapped,
    input.oldCols,
    input.oldRows,
    clampedCursorY
  )

  const totalRows = sbLen + lastRow + 1
  const cursorGlobalRow = sbLen + clampedCursorY
  const cursorColPos = input.wrapPending ? clampedCursorX + 1 : clampedCursorX

  const getRow = (idx: number): Uint32Array => {
    if (idx < sbLen) return input.scrollbackBuffer[idx] ?? allocTermRow(input.oldCols)
    const py = idx - sbLen
    const rowWords = input.oldCols * CELL_WORDS
    return input.primaryGrid.subarray(py * rowWords, (py + 1) * rowWords)
  }
  const isWrapped = (idx: number): boolean => {
    if (idx >= totalRows - 1) return false
    if (idx < sbLen) return Boolean(input.scrollbackWrapped[idx])
    return Boolean(input.primaryWrapped[idx - sbLen])
  }

  const lines: LogicalLine[] = []
  let r = 0
  while (r < totalRows) {
    const start = r
    while (r < totalRows - 1 && isWrapped(r)) r++
    const end = r
    r++

    lines.push(packLogicalLine(start, end, getRow, cursorGlobalRow, cursorColPos))
  }
  return lines
}

function packLogicalLine(
  start: number,
  end: number,
  getRow: (idx: number) => Uint32Array,
  cursorGlobalRow: number,
  cursorColPos: number
): LogicalLine {
  let totalCells = 0
  let cursorPos: number | null = null

  for (let idx = start; idx <= end; idx++) {
    const row = getRow(idx)
    const rowCols = Math.floor(row.length / CELL_WORDS)
    const isLast = idx === end
    const hasCursor = idx === cursorGlobalRow
    if (hasCursor) {
      cursorPos = totalCells + Math.min(rowCols, cursorColPos)
    }
    if (!isLast) {
      totalCells += rowCols
    } else {
      const minKeep = hasCursor ? Math.min(rowCols, cursorColPos) : 0
      totalCells += Math.max(trimmedRowCells(row), minKeep)
    }
  }

  const cells = new Uint32Array(totalCells * CELL_WORDS)
  let writeCell = 0
  for (let idx = start; idx <= end; idx++) {
    const row = getRow(idx)
    const rowCols = Math.floor(row.length / CELL_WORDS)
    const take = Math.min(rowCols, totalCells - writeCell)
    if (take > 0) {
      cells.set(row.subarray(0, take * CELL_WORDS), writeCell * CELL_WORDS)
      writeCell += take
    }
  }
  return { cells, cellCount: totalCells, cursorPos }
}

function rewrapLogicalLines(
  lines: readonly LogicalLine[],
  newCols: number
): {
  rows: Uint32Array[]
  wrapped: boolean[]
  cursorRow: number
  cursorX: number
  wrapPending: boolean
} {
  const rows: Uint32Array[] = []
  const wrapped: boolean[] = []
  let cursorRow = 0
  let cursorX = 0
  let wrapPending = false

  for (const line of lines) {
    const baseRow = rows.length
    const numChunks = Math.max(1, Math.ceil(line.cellCount / newCols))
    for (let k = 0; k < numChunks; k++) {
      const dst = allocTermRow(newCols)
      const cellStart = k * newCols
      const take = Math.max(0, Math.min(newCols, line.cellCount - cellStart))
      if (take > 0) {
        dst.set(line.cells.subarray(cellStart * CELL_WORDS, (cellStart + take) * CELL_WORDS), 0)
      }
      rows.push(dst)
      wrapped.push(k < numChunks - 1)
    }

    if (line.cursorPos !== null) {
      const pos = line.cursorPos
      if (pos > 0 && pos % newCols === 0 && Math.floor(pos / newCols) === numChunks) {
        cursorRow = baseRow + numChunks - 1
        cursorX = newCols - 1
        wrapPending = true
      } else {
        const chunkIdx = Math.min(numChunks - 1, Math.floor(pos / newCols))
        cursorRow = baseRow + chunkIdx
        cursorX = Math.min(newCols - 1, pos - chunkIdx * newCols)
        wrapPending = false
      }
    }
  }

  if (rows.length === 0) {
    rows.push(allocTermRow(newCols))
    wrapped.push(false)
  }

  return { rows, wrapped, cursorRow, cursorX, wrapPending }
}

function reflowPrimaryState(input: ReflowInput): ReflowResult {
  const lines = buildLogicalLines(input)
  const rewrapped = rewrapLogicalLines(lines, input.newCols)
  const totalOut = rewrapped.rows.length
  const newGrid = allocTermGrid(input.newCols, input.newRows)
  const newPrimaryWrapped = new Array<boolean>(input.newRows).fill(false)
  const rowWords = input.newCols * CELL_WORDS

  if (totalOut <= input.newRows) {
    for (let y = 0; y < totalOut; y++) {
      const srcRow = rewrapped.rows[y]
      if (srcRow) newGrid.set(srcRow, y * rowWords)
      newPrimaryWrapped[y] = y < totalOut - 1 ? Boolean(rewrapped.wrapped[y]) : false
    }
    return {
      primaryGrid: newGrid,
      primaryWrapped: newPrimaryWrapped,
      scrollbackBuffer: [],
      scrollbackWrapped: [],
      cursorX: rewrapped.cursorX,
      cursorY: Math.max(0, Math.min(input.newRows - 1, rewrapped.cursorRow)),
      wrapPending: rewrapped.wrapPending,
    }
  }

  const split = totalOut - input.newRows
  const sbStart = Math.max(0, split - input.maxScrollback)
  const scrollbackBuffer = rewrapped.rows.slice(sbStart, split)
  const scrollbackWrapped = rewrapped.wrapped.slice(sbStart, split)

  for (let y = 0; y < input.newRows; y++) {
    const srcIdx = split + y
    const srcRow = rewrapped.rows[srcIdx]
    if (srcRow) newGrid.set(srcRow, y * rowWords)
    newPrimaryWrapped[y] = y < input.newRows - 1 ? Boolean(rewrapped.wrapped[srcIdx]) : false
  }

  return {
    primaryGrid: newGrid,
    primaryWrapped: newPrimaryWrapped,
    scrollbackBuffer,
    scrollbackWrapped,
    cursorX: rewrapped.cursorX,
    cursorY: Math.max(0, Math.min(input.newRows - 1, rewrapped.cursorRow - split)),
    wrapPending: rewrapped.wrapPending,
  }
}

function copyResizeAlternateGrid(
  oldGrid: Uint32Array,
  oldCols: number,
  oldRows: number,
  newCols: number,
  newRows: number
): Uint32Array {
  const newGrid = allocTermGrid(newCols, newRows)
  const copyRows = Math.min(oldRows, newRows)
  const copyWords = Math.min(oldCols, newCols) * CELL_WORDS
  for (let y = 0; y < copyRows; y++) {
    const srcOff = y * oldCols * CELL_WORDS
    const dstOff = y * newCols * CELL_WORDS
    newGrid.set(oldGrid.subarray(srcOff, srcOff + copyWords), dstOff)
  }
  return newGrid
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi
const URL_TRAILING_RE = /[.,;:!?)\]}]+$/

/** A link found in a logical line: `text.slice(start, end)` is what was matched. */
export interface TerminalLinkRange {
  readonly url: string
  readonly start: number
  readonly end: number
}

/** A soft-wrap-joined line plus where each of its cells sits on screen. */
export interface TerminalLogicalLine {
  readonly text: string
  /** String index of the queried cell. */
  readonly index: number
  /** One entry per grid row, top to bottom; `cellStarts[x]` is cell x's string index. */
  readonly rows: readonly { readonly screenY: number; readonly cellStarts: readonly number[] }[]
}

/**
 * The http(s) URL in `text` that covers `index`, with its extent, or null.
 * Sentence punctuation and closing brackets after the URL are not part of it;
 * other schemes (`javascript:`, `file:`) never match.
 */
export function findUrlRangeAt(text: string, index: number): TerminalLinkRange | null {
  URL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > index) return null
    const trailing = URL_TRAILING_RE.exec(match[0])?.[0] ?? ''
    const raw = trailing ? match[0].slice(0, -trailing.length) : match[0]
    if (index < match.index + raw.length) {
      try {
        return { url: new URL(raw).href, start: match.index, end: match.index + raw.length }
      } catch {
        return null
      }
    }
  }
  return null
}

/** The http(s) URL in `text` that covers `index`, or null. */
export function findUrlAt(text: string, index: number): string | null {
  return findUrlRangeAt(text, index)?.url ?? null
}

/**
 * Screen cells covered by `line.text.slice(start, end)`: one span per row,
 * clipped to rows inside a `rows`-high viewport.
 */
export function logicalRangeToSpans(
  line: TerminalLogicalLine,
  start: number,
  end: number,
  viewportRows: number
): { y: number; x: number; width: number }[] {
  const spans: { y: number; x: number; width: number }[] = []
  for (const row of line.rows) {
    if (row.screenY < 0 || row.screenY >= viewportRows) continue
    let x0 = -1
    let x1 = -1
    row.cellStarts.forEach((at, x) => {
      if (at >= start && at < end) {
        if (x0 < 0) x0 = x
        x1 = x
      }
    })
    if (x0 >= 0) spans.push({ y: row.screenY, x: x0, width: x1 - x0 + 1 })
  }
  return spans
}

const ESC = 0x1b
const BEL = 0x07

/** Length of a complete OSC 52 sequence starting at `start`, or 0 if unterminated. */
/**
 * Bytes to strip for an OSC 52 starting at `start`. Never returns 0: a sequence
 * left in place reaches a client that may still execute it.
 * - BEL or ST (`ESC \`) ends it, terminator included.
 * - Any other ESC ends it too, and the ESC is stripped with it, so the byte after
 *   it cannot start a new escape sequence or extend the OSC.
 * - No terminator in this chunk: strip to the end of the chunk. Leaving it
 *   intact let a sequence split across two PTY reads through, since the client
 *   keeps OSC state across chunks; the tail then arrives as plain text.
 */
function osc52Length(data: Uint8Array, start: number): number {
  for (let j = start + 5; j < data.length; j++) {
    if (data[j] === BEL) return j - start + 1
    if (data[j] === ESC) return data[j + 1] === 0x5c ? j - start + 2 : j - start + 1
  }
  return data.length - start
}

/**
 * Sanitizes outbound PTY bytes before broadcasting to UI clients.
 * Blocks cursor-reporting probes (`CSI 6 n`) and raw OSC 52 clipboard writes
 * (BEL- or ST-terminated).
 *
 * Works on raw bytes, never decoding: a PTY read can end mid-way through a
 * multibyte character, and a per-chunk UTF-8 round trip would turn each half
 * into U+FFFD. Every byte outside a stripped sequence passes through untouched.
 */
export function sanitizeTerminalOutput(data: Uint8Array): Uint8Array {
  if (data.indexOf(ESC) === -1) return data
  const out = new Uint8Array(data.length)
  let n = 0
  for (let i = 0; i < data.length; i++) {
    const b = data[i]!
    if (b === ESC) {
      if (data[i + 1] === 0x5b && data[i + 2] === 0x36 && data[i + 3] === 0x6e) {
        i += 3
        continue
      }
      if (
        data[i + 1] === 0x5d &&
        data[i + 2] === 0x35 &&
        data[i + 3] === 0x32 &&
        data[i + 4] === 0x3b
      ) {
        i += osc52Length(data, i) - 1
        continue
      }
    }
    out[n++] = b
  }
  return n === data.length ? data : out.subarray(0, n)
}

export class HeadlessTerm {
  cols: number
  rows: number
  grid: Uint32Array
  primaryGrid: Uint32Array
  primaryWrapped: boolean[]
  useAlternate = false
  scrollbackBuffer: Uint32Array[] = []
  scrollbackWrapped: boolean[] = []
  scrollbackOffset = 0

  cursorX = 0
  cursorY = 0
  savedCursorX = 0
  savedCursorY = 0
  cursorVisible = true

  curFg = COLOR_DEFAULT
  curBg = COLOR_DEFAULT
  curFlags = 0
  savedFg = COLOR_DEFAULT
  savedBg = COLOR_DEFAULT
  savedFlags = 0

  scrollTop = 0
  scrollBottom = 0

  charsetG0 = 'B'
  charsetG1 = '0'
  activeCharset = 0

  tabStops = new Set<number>()

  parseState: 'ground' | 'escape' | 'csi' | 'osc' | 'dcs' | 'charset' = 'ground'
  parseParams: number[] = []
  parseParam = ''
  parseIntermediates = ''
  oscBuffer = ''
  dcsBuffer = ''

  mouseTracking = 0
  mouseProtocol: 'normal' | 'sgr' = 'normal'
  applicationCursorKeys = false
  bracketedPaste = false
  wrapPending = false
  title = ''

  send: (data: string | Uint8Array) => void
  maxScrollback: number
  passiveQueries: boolean

  onResize: ((cols: number, rows: number) => void) | null = null
  onTitle: ((title: string) => void) | null = null
  onClipboardWrite: ((text: string) => boolean) | null = null

  private decoder = new TextDecoder('utf-8', { fatal: false })
  private utf8Buffer = new Uint8Array(4)
  private utf8BufferLen = 0

  constructor(
    sendFn: (data: string | Uint8Array) => void = (): void => {},
    options: HeadlessTermOptions = {}
  ) {
    this.send = sendFn
    this.cols = Math.max(1, Math.floor(options.cols ?? 80))
    this.rows = Math.max(1, Math.floor(options.rows ?? 24))
    this.maxScrollback = Math.max(0, Math.floor(options.scrollback ?? 10000))
    this.passiveQueries = options.passiveQueries === true
    this.primaryGrid = allocTermGrid(this.cols, this.rows)
    this.primaryWrapped = new Array<boolean>(this.rows).fill(false)
    this.grid = this.primaryGrid
    this.resetTabStops()
  }

  protected resetTabStops(): void {
    this.tabStops.clear()
    for (let i = 0; i < this.cols; i += 8) {
      this.tabStops.add(i)
    }
  }

  protected resetTerminalState(cols = 80, rows = 24): void {
    this.cols = Math.max(1, Math.floor(cols))
    this.rows = Math.max(1, Math.floor(rows))
    this.cursorX = 0
    this.cursorY = 0
    this.savedCursorX = 0
    this.savedCursorY = 0
    this.cursorVisible = true
    this.wrapPending = false
    this.curFg = COLOR_DEFAULT
    this.curBg = COLOR_DEFAULT
    this.curFlags = 0
    this.savedFg = COLOR_DEFAULT
    this.savedBg = COLOR_DEFAULT
    this.savedFlags = 0
    this.scrollTop = 0
    this.scrollBottom = 0
    this.charsetG0 = 'B'
    this.charsetG1 = '0'
    this.activeCharset = 0
    this.mouseTracking = 0
    this.mouseProtocol = 'normal'
    this.applicationCursorKeys = false
    this.bracketedPaste = false
    this.useAlternate = false
    this.scrollbackBuffer = []
    this.scrollbackWrapped = []
    this.scrollbackOffset = 0
    this.primaryGrid = allocTermGrid(this.cols, this.rows)
    this.primaryWrapped = new Array<boolean>(this.rows).fill(false)
    this.grid = this.primaryGrid
    this.resetTabStops()
  }

  resetTerminal(): void {
    this.resetTerminalState(this.cols, this.rows)
    this.triggerRender()
  }

  // Overridden by NanoTermV2 in browser contexts
  triggerRender(): void {}

  // Overridden by NanoTermV2 in browser contexts
  protected handleOsc52Clipboard(_arg: string): void {}

  allocGrid(cols: number, rows: number): Uint32Array {
    return allocTermGrid(cols, rows)
  }

  fillRow(y: number, cp: number, fg: number, bg: number, flags: number): void {
    const offset = y * this.cols * CELL_WORDS
    const word0 = ((cp << CELL_CP_SHIFT) | (flags & CELL_FLAGS_MASK)) >>> 0
    for (let x = 0; x < this.cols; x++) {
      const off = offset + x * CELL_WORDS
      this.grid[off] = word0
      this.grid[off + 1] = fg
      this.grid[off + 2] = bg
      this.grid[off + 3] = 0
    }
  }

  fillRange(
    y: number,
    startX: number,
    endX: number,
    cp: number,
    fg: number,
    bg: number,
    flags: number
  ): void {
    const rowOffset = y * this.cols * CELL_WORDS
    const word0 = ((cp << CELL_CP_SHIFT) | (flags & CELL_FLAGS_MASK)) >>> 0
    for (let x = startX; x < endX && x < this.cols; x++) {
      const off = rowOffset + x * CELL_WORDS
      this.grid[off] = word0
      this.grid[off + 1] = fg
      this.grid[off + 2] = bg
      this.grid[off + 3] = 0
    }
  }

  extractRow(y: number): Uint32Array {
    const rowWords = this.cols * CELL_WORDS
    const offset = y * rowWords
    const row = new Uint32Array(rowWords)
    row.set(this.grid.subarray(offset, offset + rowWords))
    return row
  }

  dumpRow(y: number): string {
    if (!this.grid || y < 0 || y >= this.rows) return ''
    const rowWords = this.cols * CELL_WORDS
    const slice = this.grid.subarray(y * rowWords, (y + 1) * rowWords)
    return rowToPlainString(slice, false)
  }

  dumpGrid(): TerminalGridDump {
    const total = this.cols * this.rows
    const cells = new Array<TerminalCellDump>(total)
    for (let i = 0; i < total; i++) {
      const off = i * CELL_WORDS
      const word0 = (this.grid[off] ?? 0) >>> 0
      const cp = word0 >>> CELL_CP_SHIFT
      const flags = word0 & CELL_FLAGS_MASK
      const fg = (this.grid[off + 1] ?? 0) >>> 0
      const bg = (this.grid[off + 2] ?? 0) >>> 0
      cells[i] = {
        char: cp === 0 ? '' : String.fromCodePoint(cp),
        fg: fg === COLOR_DEFAULT ? null : rgbaHex(fg),
        bg: bg === COLOR_DEFAULT ? null : rgbaHex(bg),
        bold: !!(flags & ATTR.BOLD),
        dim: !!(flags & ATTR.DIM),
        italic: !!(flags & ATTR.ITALIC),
        underline: !!(flags & ATTR.UNDERLINE),
        inverse: !!(flags & ATTR.INVERSE),
        strike: !!(flags & ATTR.STRIKETHROUGH),
      }
    }
    const lines: string[] = []
    for (let y = 0; y < this.rows; y++) lines.push(this.dumpRow(y))
    return {
      cols: this.cols,
      rows: this.rows,
      cursor: { x: this.cursorX, y: this.cursorY, visible: this.cursorVisible },
      altScreen: this.useAlternate,
      lines,
      cells,
    }
  }

  /**
   * The soft-wrap-joined logical line under a visible cell, with the string
   * index of that cell, so a URL that wraps across rows resolves as one link.
   * `screenY` counts visible rows, honouring a scrolled-back viewport
   * (`scrollbackOffset`) the same way the renderers lay rows out.
   */
  logicalLineAt(screenY: number, x: number): TerminalLogicalLine | null {
    if (screenY < 0 || screenY >= this.rows || x < 0 || x >= this.cols) return null
    const sbLen = this.useAlternate ? 0 : this.scrollbackBuffer.length
    const rowAt = (abs: number): Uint32Array =>
      abs < sbLen
        ? this.scrollbackBuffer[abs]!
        : this.grid.subarray(
            (abs - sbLen) * this.cols * CELL_WORDS,
            (abs - sbLen + 1) * this.cols * CELL_WORDS
          )
    const wrappedAt = (abs: number): boolean => {
      if (this.useAlternate) return false
      return abs < sbLen
        ? Boolean(this.scrollbackWrapped[abs])
        : Boolean(this.primaryWrapped[abs - sbLen])
    }

    let target = sbLen + screenY
    if (this.scrollbackOffset > 0 && !this.useAlternate) {
      const scrollbackRows = Math.min(this.scrollbackOffset, this.rows)
      target =
        screenY < scrollbackRows
          ? Math.max(0, sbLen - this.scrollbackOffset) + screenY
          : sbLen + (screenY - scrollbackRows)
    }
    const total = sbLen + this.rows
    if (target >= total) return null

    let first = target
    while (first > 0 && wrappedAt(first - 1)) first--
    let last = target
    while (last < total - 1 && wrappedAt(last)) last++

    let text = ''
    let index = -1
    const rows: TerminalLogicalLine['rows'][number][] = []
    for (let abs = first; abs <= last; abs++) {
      const row = rowAt(abs)
      const rowCols = row.length / CELL_WORDS
      const cellStarts: number[] = []
      for (let cx = 0; cx < rowCols; cx++) {
        if (abs === target && cx === x) index = text.length
        cellStarts.push(text.length)
        const cp = (row[cx * CELL_WORDS] ?? 0) >>> CELL_CP_SHIFT
        text += cp > 0 ? String.fromCodePoint(cp) : ' '
      }
      rows.push({ screenY: screenY + (abs - target), cellStarts })
    }
    return index >= 0 ? { text, index, rows } : null
  }

  /**
   * Read clean, soft-wrap-joined plain text from scrollback + visible screen.
   * Ideal for agent `session_output` inspection of interactive PTY shells/TUIs.
   */
  readPlainText(maxLines?: number): string {
    if (this.useAlternate) {
      const altLines: string[] = []
      for (let y = 0; y < this.rows; y++) altLines.push(this.dumpRow(y))
      while (altLines.length > 0 && altLines[altLines.length - 1] === '') altLines.pop()
      const sliced = maxLines && maxLines > 0 ? altLines.slice(-maxLines) : altLines
      return sliced.join('\n')
    }

    const lastRow = findLastContentRow(
      this.primaryGrid,
      this.primaryWrapped,
      this.cols,
      this.rows,
      this.cursorY
    )
    const sbLen = this.scrollbackBuffer.length
    const total = sbLen + lastRow + 1
    const rowWords = this.cols * CELL_WORDS
    const lines: string[] = []
    let acc = ''

    for (let idx = 0; idx < total; idx++) {
      const row =
        idx < sbLen
          ? (this.scrollbackBuffer[idx] ?? allocTermRow(this.cols))
          : this.primaryGrid.subarray((idx - sbLen) * rowWords, (idx - sbLen + 1) * rowWords)
      const wrapped =
        idx < total - 1
          ? idx < sbLen
            ? Boolean(this.scrollbackWrapped[idx])
            : Boolean(this.primaryWrapped[idx - sbLen])
          : false
      const minLen =
        idx === sbLen + this.cursorY ? (this.wrapPending ? this.cols : this.cursorX) : 0
      acc += rowToPlainString(row, wrapped, minLen)
      if (!wrapped) {
        lines.push(acc)
        acc = ''
      }
    }
    if (acc) lines.push(acc)
    const sliced = maxLines && maxLines > 0 ? lines.slice(-maxLines) : lines
    return sliced.join('\n')
  }

  /**
   * Resize the terminal grid to `newCols x newRows`, reflowing soft-wrapped
   * logical lines on the primary screen and preserving scrollback + cursor.
   */
  resizeTerminalGrid(newCols: number, newRows: number): void {
    const targetCols = Math.max(1, Math.floor(Number(newCols) || 1))
    const targetRows = Math.max(1, Math.floor(Number(newRows) || 1))
    const oldCols = this.cols
    const oldRows = this.rows
    if (targetCols === oldCols && targetRows === oldRows) return

    const activePrimary = this.useAlternate ? this.primaryGrid : this.grid
    const reflowed = reflowPrimaryState({
      primaryGrid: activePrimary,
      primaryWrapped: this.primaryWrapped,
      scrollbackBuffer: this.scrollbackBuffer,
      scrollbackWrapped: this.scrollbackWrapped,
      oldCols,
      oldRows,
      newCols: targetCols,
      newRows: targetRows,
      cursorX: this.useAlternate ? this.savedCursorX : this.cursorX,
      cursorY: this.useAlternate ? this.savedCursorY : this.cursorY,
      wrapPending: this.useAlternate ? false : this.wrapPending,
      maxScrollback: this.maxScrollback,
    })

    this.cols = targetCols
    this.rows = targetRows
    this.scrollTop = 0
    this.scrollBottom = 0
    this.primaryGrid = reflowed.primaryGrid
    this.primaryWrapped = reflowed.primaryWrapped
    this.scrollbackBuffer = reflowed.scrollbackBuffer
    this.scrollbackWrapped = reflowed.scrollbackWrapped
    this.scrollbackOffset = Math.min(this.scrollbackOffset, this.scrollbackBuffer.length)

    if (this.useAlternate) {
      this.grid = copyResizeAlternateGrid(this.grid, oldCols, oldRows, targetCols, targetRows)
      this.savedCursorX = reflowed.cursorX
      this.savedCursorY = reflowed.cursorY
      this.cursorX = Math.max(0, Math.min(targetCols - 1, this.cursorX))
      this.cursorY = Math.max(0, Math.min(targetRows - 1, this.cursorY))
      this.wrapPending = false
    } else {
      this.grid = this.primaryGrid
      this.cursorX = reflowed.cursorX
      this.cursorY = reflowed.cursorY
      this.wrapPending = reflowed.wrapPending
      this.savedCursorX = Math.max(0, Math.min(targetCols - 1, this.savedCursorX))
      this.savedCursorY = Math.max(0, Math.min(targetRows - 1, this.savedCursorY))
    }

    this.resetTabStops()
  }

  resize(cols?: number, rows?: number): void {
    if (cols !== undefined && rows !== undefined) {
      this.resizeTerminalGrid(cols, rows)
    }
  }

  exportSnapshot(maxScrollbackRows = 1000): TerminalSnapshot {
    const activePrimary = this.useAlternate ? this.primaryGrid : this.grid
    const rowWords = this.cols * CELL_WORDS
    const primaryRows: string[] = []
    for (let y = 0; y < this.rows; y++) {
      primaryRows.push(encodeRowBase64(activePrimary.subarray(y * rowWords, (y + 1) * rowWords)))
    }

    const sbCap = Math.max(0, Math.floor(maxScrollbackRows))
    const sbStart = Math.max(0, this.scrollbackBuffer.length - sbCap)
    const scrollbackRows: string[] = []
    const scrollbackWrapped: boolean[] = []
    for (let i = sbStart; i < this.scrollbackBuffer.length; i++) {
      const sbRow = this.scrollbackBuffer[i]
      scrollbackRows.push(sbRow ? encodeRowBase64(sbRow) : '')
      scrollbackWrapped.push(Boolean(this.scrollbackWrapped[i]))
    }

    let alternateRows: string[] | undefined
    if (this.useAlternate) {
      alternateRows = []
      for (let y = 0; y < this.rows; y++) {
        alternateRows.push(encodeRowBase64(this.grid.subarray(y * rowWords, (y + 1) * rowWords)))
      }
    }

    return {
      version: 1,
      cols: this.cols,
      rows: this.rows,
      useAlternate: this.useAlternate,
      cursorX: this.cursorX,
      cursorY: this.cursorY,
      savedCursorX: this.savedCursorX,
      savedCursorY: this.savedCursorY,
      cursorVisible: this.cursorVisible,
      wrapPending: this.wrapPending,
      curFg: this.curFg,
      curBg: this.curBg,
      curFlags: this.curFlags,
      savedFg: this.savedFg,
      savedBg: this.savedBg,
      savedFlags: this.savedFlags,
      scrollTop: this.scrollTop,
      scrollBottom: this.scrollBottom,
      charsetG0: this.charsetG0,
      charsetG1: this.charsetG1,
      activeCharset: this.activeCharset,
      applicationCursorKeys: this.applicationCursorKeys,
      mouseTracking: this.mouseTracking,
      mouseProtocol: this.mouseProtocol,
      bracketedPaste: this.bracketedPaste,
      title: this.title,
      primaryRows,
      primaryWrapped: this.primaryWrapped.slice(0, this.rows),
      scrollbackRows,
      scrollbackWrapped,
      ...(alternateRows ? { alternateRows } : {}),
    }
  }

  restoreSnapshot(snapshot: TerminalSnapshot): void {
    const cols = Math.max(1, Math.floor(snapshot.cols || 80))
    const rows = Math.max(1, Math.floor(snapshot.rows || 24))
    this.restoreScalarState(snapshot, cols, rows)
    this.resetParserState()
    this.restoreGridState(snapshot, cols, rows)
    this.resetTabStops()
    if (this.title && this.onTitle) {
      this.onTitle(this.title)
    }
    this.triggerRender()
  }

  private restoreScalarState(snapshot: TerminalSnapshot, cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.useAlternate = Boolean(snapshot.useAlternate)
    this.cursorX = Math.max(0, Math.min(cols - 1, snapshot.cursorX || 0))
    this.cursorY = Math.max(0, Math.min(rows - 1, snapshot.cursorY || 0))
    this.savedCursorX = Math.max(0, Math.min(cols - 1, snapshot.savedCursorX || 0))
    this.savedCursorY = Math.max(0, Math.min(rows - 1, snapshot.savedCursorY || 0))
    this.cursorVisible = snapshot.cursorVisible !== false
    this.wrapPending = Boolean(snapshot.wrapPending)
    this.curFg = snapshot.curFg >>> 0
    this.curBg = snapshot.curBg >>> 0
    this.curFlags = snapshot.curFlags >>> 0
    this.savedFg = snapshot.savedFg >>> 0
    this.savedBg = snapshot.savedBg >>> 0
    this.savedFlags = snapshot.savedFlags >>> 0
    this.scrollTop = Math.max(0, Math.min(rows - 1, snapshot.scrollTop || 0))
    this.scrollBottom = Math.max(0, Math.min(rows - 1, snapshot.scrollBottom || 0))
    this.charsetG0 = snapshot.charsetG0 || 'B'
    this.charsetG1 = snapshot.charsetG1 || '0'
    this.activeCharset = snapshot.activeCharset === 1 ? 1 : 0
    this.applicationCursorKeys = Boolean(snapshot.applicationCursorKeys)
    this.mouseTracking = snapshot.mouseTracking || 0
    this.mouseProtocol = snapshot.mouseProtocol === 'sgr' ? 'sgr' : 'normal'
    this.bracketedPaste = Boolean(snapshot.bracketedPaste)
    this.title = snapshot.title || ''
  }

  private resetParserState(): void {
    this.parseState = 'ground'
    this.parseParams = []
    this.parseParam = ''
    this.parseIntermediates = ''
    this.oscBuffer = ''
    this.dcsBuffer = ''
    this.utf8BufferLen = 0
  }

  private restoreGridState(snapshot: TerminalSnapshot, cols: number, rows: number): void {
    const rowWords = cols * CELL_WORDS
    this.primaryGrid = allocTermGrid(cols, rows)
    this.primaryWrapped = new Array<boolean>(rows).fill(false)
    for (let y = 0; y < rows; y++) {
      const decoded = decodeRowBase64(snapshot.primaryRows[y] ?? '', cols)
      this.primaryGrid.set(decoded, y * rowWords)
      this.primaryWrapped[y] = Boolean(snapshot.primaryWrapped[y])
    }

    this.scrollbackBuffer = []
    this.scrollbackWrapped = []
    for (let i = 0; i < snapshot.scrollbackRows.length; i++) {
      this.scrollbackBuffer.push(decodeRowBase64(snapshot.scrollbackRows[i] ?? '', cols))
      this.scrollbackWrapped.push(Boolean(snapshot.scrollbackWrapped[i]))
    }
    this.scrollbackOffset = 0

    if (!this.useAlternate) {
      this.grid = this.primaryGrid
      return
    }
    const altGrid = allocTermGrid(cols, rows)
    const altRows = snapshot.alternateRows ?? []
    for (let y = 0; y < rows; y++) {
      altGrid.set(decodeRowBase64(altRows[y] ?? '', cols), y * rowWords)
    }
    this.grid = altGrid
  }

  write(data: Uint8Array | ArrayBuffer | string): void {
    if (data instanceof ArrayBuffer) {
      this.processBytes(new Uint8Array(data))
    } else if (data instanceof Uint8Array) {
      this.processBytes(data)
    } else {
      this.processString(data)
    }
    this.triggerRender()
  }

  processBytes(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i] ?? 0
      if (this.utf8BufferLen > 0) {
        this.utf8Buffer[this.utf8BufferLen++] = byte
        const lead = this.utf8Buffer[0] ?? 0
        const seqLen = lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4
        if (this.utf8BufferLen >= seqLen) {
          const decoded = this.decoder.decode(this.utf8Buffer.slice(0, seqLen))
          this.processChar(decoded)
          this.utf8BufferLen = 0
        }
      } else if (byte >= 0x80) {
        this.utf8Buffer[0] = byte
        this.utf8BufferLen = 1
      } else {
        this.processChar(String.fromCharCode(byte))
      }
    }
  }

  processString(str: string): void {
    for (const ch of str) {
      this.processChar(ch)
    }
  }

  processChar(c: string): void {
    const code = c.charCodeAt(0)
    switch (this.parseState) {
      case 'ground':
        this.processGround(c, code)
        break
      case 'escape':
        this.processEscape(c)
        break
      case 'csi':
        this.processCSI(c, code)
        break
      case 'osc':
        this.processOSC(c, code)
        break
      case 'dcs':
        this.processDCS(c, code)
        break
      case 'charset':
        if (this.parseIntermediates === '(') this.charsetG0 = c
        else if (this.parseIntermediates === ')') this.charsetG1 = c
        this.parseState = 'ground'
        break
    }
  }

  processGround(c: string, code: number): void {
    if (code >= 0x20) {
      const cs = this.activeCharset === 0 ? this.charsetG0 : this.charsetG1
      const mapped = cs === '0' && DEC_SPECIAL_GRAPHICS[c] ? DEC_SPECIAL_GRAPHICS[c] : c
      this.putChar(mapped)
      return
    }
    this.processControlChar(code)
  }

  private processControlChar(code: number): void {
    switch (code) {
      case 0x1b:
        this.parseState = 'escape'
        this.parseIntermediates = ''
        break
      case 0x0d:
        this.cursorX = 0
        this.wrapPending = false
        break
      case 0x0a:
      case 0x0b:
      case 0x0c:
        this.wrapPending = false
        this.lineFeed()
        break
      case 0x08:
        this.wrapPending = false
        if (this.cursorX > 0) this.cursorX--
        break
      case 0x09:
        this.wrapPending = false
        this.tabForward()
        break
      case 0x0e:
        this.activeCharset = 1
        break
      case 0x0f:
        this.activeCharset = 0
        break
    }
  }

  processEscape(c: string): void {
    if (c === '[' || c === ']' || c === 'P') {
      this.startEscapeSequence(c)
      return
    }
    if (c === '(' || c === ')' || c === '*' || c === '+') {
      this.parseState = 'charset'
      this.parseIntermediates = c
      return
    }
    this.executeSimpleEscape(c)
    this.parseState = 'ground'
  }

  private startEscapeSequence(c: string): void {
    if (c === '[') {
      this.parseState = 'csi'
      this.parseParams = []
      this.parseParam = ''
      this.parseIntermediates = ''
    } else if (c === ']') {
      this.parseState = 'osc'
      this.oscBuffer = ''
      this.parseIntermediates = ''
    } else {
      this.parseState = 'dcs'
      this.dcsBuffer = ''
      this.parseIntermediates = ''
    }
  }

  private executeSimpleEscape(c: string): void {
    switch (c) {
      case 'M':
        this.reverseIndex()
        break
      case 'D':
        this.lineFeed()
        break
      case 'E':
        this.cursorX = 0
        this.wrapPending = false
        this.lineFeed()
        break
      case '7':
        this.saveCursorAndAttrs()
        break
      case '8':
        this.restoreCursorAndAttrs()
        break
      case 'c':
        this.resetTerminal()
        break
    }
  }

  private saveCursorAndAttrs(): void {
    this.savedCursorX = this.cursorX
    this.savedCursorY = this.cursorY
    this.savedFg = this.curFg
    this.savedBg = this.curBg
    this.savedFlags = this.curFlags
  }

  private restoreCursorAndAttrs(): void {
    this.cursorX = Math.max(0, Math.min(this.cols - 1, this.savedCursorX))
    this.cursorY = Math.max(0, Math.min(this.rows - 1, this.savedCursorY))
    this.wrapPending = false
    this.curFg = this.savedFg
    this.curBg = this.savedBg
    this.curFlags = this.savedFlags
  }

  processCSI(c: string, code: number): void {
    if (code >= 0x30 && code <= 0x39) {
      this.parseParam += c
    } else if (code === 0x3b) {
      this.parseParams.push(this.parseParam ? parseInt(this.parseParam, 10) : 0)
      this.parseParam = ''
    } else if (code >= 0x3c && code <= 0x3f) {
      this.parseIntermediates = c
    } else if (code >= 0x20 && code <= 0x2f) {
      this.parseIntermediates += c
    } else if (code >= 0x40 && code <= 0x7e) {
      this.parseParams.push(this.parseParam ? parseInt(this.parseParam, 10) : 0)
      this.executeCSI(c, this.parseParams, this.parseIntermediates)
      this.parseState = 'ground'
    } else if (code === 0x1b) {
      this.parseState = 'escape'
      this.parseIntermediates = ''
    } else {
      this.parseState = 'ground'
    }
  }

  processOSC(c: string, code: number): void {
    if (this.parseIntermediates === '\\' && code !== 0x5c) {
      // ESC not followed by `\` cancels the string (as in xterm) and starts a new
      // escape sequence. Appending it instead let `ESC ] 52;… ESC X … \` execute
      // a clipboard write that the server-side sanitizer had already let pass.
      this.oscBuffer = ''
      this.parseState = 'escape'
      this.parseIntermediates = ''
      this.processChar(c)
      return
    }
    if (code === 0x07 || (code === 0x5c && this.parseIntermediates === '\\')) {
      this.executeOSC(this.oscBuffer)
      this.parseState = 'ground'
    } else if (code === 0x1b) {
      this.parseIntermediates = '\\'
    } else if (this.oscBuffer.length < MAX_SEQUENCE_SIZE) {
      this.oscBuffer += c
    }
  }

  processDCS(c: string, code: number): void {
    if (code === 0x1b) {
      this.parseIntermediates = '\\'
    } else if (code === 0x5c && this.parseIntermediates === '\\') {
      this.executeDCS(this.dcsBuffer)
      this.parseState = 'ground'
    } else if (this.dcsBuffer.length < MAX_SEQUENCE_SIZE) {
      this.dcsBuffer += c
    }
  }

  executeCSI(cmd: string, params: number[], intermediates: string): void {
    const p = params.map((v) => v || 0)
    const priv = intermediates.includes('?')

    if (this.executeCsiCursor(cmd, p)) return
    if (this.executeCsiEdit(cmd, p)) return
    this.executeCsiMisc(cmd, p, priv, intermediates)
  }

  private executeCsiCursor(cmd: string, p: number[]): boolean {
    const n = p[0] || 1
    if (this.executeCsiRelativeCursor(cmd, n)) return true
    switch (cmd) {
      case 'G':
        this.wrapPending = false
        this.cursorX = Math.max(0, Math.min(this.cols - 1, n - 1))
        return true
      case 'H':
      case 'f':
        this.wrapPending = false
        this.cursorY = Math.max(0, Math.min(this.rows - 1, n - 1))
        this.cursorX = Math.max(0, Math.min(this.cols - 1, (p[1] || 1) - 1))
        return true
      case 'd':
        this.wrapPending = false
        this.cursorY = Math.max(0, Math.min(this.rows - 1, n - 1))
        return true
      default:
        return false
    }
  }

  private executeCsiRelativeCursor(cmd: string, n: number): boolean {
    switch (cmd) {
      case 'A':
        this.wrapPending = false
        this.cursorY = Math.max(this.getScrollTop(), this.cursorY - n)
        return true
      case 'B':
        this.wrapPending = false
        this.cursorY = Math.min(this.getScrollBottom(), this.cursorY + n)
        return true
      case 'C':
        this.wrapPending = false
        this.cursorX = Math.min(this.cols - 1, this.cursorX + n)
        return true
      case 'D':
        this.wrapPending = false
        this.cursorX = Math.max(0, this.cursorX - n)
        return true
      case 'E':
        this.wrapPending = false
        this.cursorX = 0
        this.cursorY = Math.min(this.getScrollBottom(), this.cursorY + n)
        return true
      case 'F':
        this.wrapPending = false
        this.cursorX = 0
        this.cursorY = Math.max(this.getScrollTop(), this.cursorY - n)
        return true
      default:
        return false
    }
  }

  private executeCsiEdit(cmd: string, p: number[]): boolean {
    switch (cmd) {
      case 'J':
        this.eraseDisplay(p[0] || 0)
        return true
      case 'K':
        this.eraseLine(p[0] || 0)
        return true
      case 'L':
        this.insertLines(p[0] || 1)
        return true
      case 'M':
        this.deleteLines(p[0] || 1)
        return true
      case 'P':
        this.deleteChars(p[0] || 1)
        return true
      case '@':
        this.insertChars(p[0] || 1)
        return true
      case 'X':
        this.eraseChars(p[0] || 1)
        return true
      case 'S':
        this.scrollUp(p[0] || 1)
        return true
      case 'T':
        this.scrollDown(p[0] || 1)
        return true
      default:
        return false
    }
  }

  private executeCsiMisc(cmd: string, p: number[], priv: boolean, intermediates: string): void {
    switch (cmd) {
      case 'r':
        if (!priv) this.setScrollRegion(p)
        break
      case 's':
        this.savedCursorX = this.cursorX
        this.savedCursorY = this.cursorY
        break
      case 'u':
        this.cursorX = Math.max(0, Math.min(this.cols - 1, this.savedCursorX))
        this.cursorY = Math.max(0, Math.min(this.rows - 1, this.savedCursorY))
        this.wrapPending = false
        break
      case 'm':
        this.processSGR(p)
        break
      case 'h':
        this.setMode(p, priv)
        break
      case 'l':
        this.resetMode(p, priv)
        break
      case 'n':
        this.deviceStatusReport(p[0] || 0)
        break
      case 'c':
        this.handleDeviceAttributes(priv, intermediates)
        break
      case 'g':
        if (p[0] === 0) this.tabStops.delete(this.cursorX)
        else if (p[0] === 3) this.tabStops.clear()
        break
      case 'Z':
        this.tabBackward(p[0] || 1)
        break
      case 'I':
        this.tabForward(p[0] || 1)
        break
    }
  }

  private setScrollRegion(p: number[]): void {
    const top = (p[0] || 1) - 1
    const bottom = p[1] ? p[1] - 1 : this.rows - 1
    this.scrollTop = Math.max(0, Math.min(top, this.rows - 1))
    this.scrollBottom = Math.max(this.scrollTop, Math.min(bottom, this.rows - 1))
    this.cursorX = 0
    this.cursorY = 0
    this.wrapPending = false
  }

  private handleDeviceAttributes(priv: boolean, intermediates: string): void {
    if (priv || this.passiveQueries) return
    if (intermediates === '>') {
      this.send('\x1b[>0;10;1c')
    } else {
      this.send('\x1b[?62;22c')
    }
  }

  processSGR(params: number[]): void {
    const list = params.length === 0 ? [0] : params
    for (let i = 0; i < list.length; i++) {
      i = this.applySgrParam(list, i)
    }
  }

  private applySgrParam(params: number[], index: number): number {
    const p = params[index] ?? 0
    if (p === 0) {
      this.curFg = COLOR_DEFAULT
      this.curBg = COLOR_DEFAULT
      this.curFlags = 0
      return index
    }
    if (p >= 1 && p <= 29) {
      this.applySgrAttribute(p)
      return index
    }
    return this.applySgrColor(params, index, p)
  }

  private applySgrAttribute(p: number): void {
    const setMap: Record<number, number> = {
      1: ATTR.BOLD,
      2: ATTR.DIM,
      3: ATTR.ITALIC,
      4: ATTR.UNDERLINE,
      5: ATTR.BLINK,
      6: ATTR.BLINK,
      7: ATTR.INVERSE,
      8: ATTR.HIDDEN,
      9: ATTR.STRIKETHROUGH,
      21: ATTR.DOUBLE_UNDERLINE,
    }
    const clearMap: Record<number, number> = {
      22: ATTR.BOLD | ATTR.DIM,
      23: ATTR.ITALIC,
      24: ATTR.UNDERLINE | ATTR.DOUBLE_UNDERLINE,
      25: ATTR.BLINK,
      27: ATTR.INVERSE,
      28: ATTR.HIDDEN,
      29: ATTR.STRIKETHROUGH,
    }
    const toSet = setMap[p]
    const toClear = clearMap[p]
    if (toSet !== undefined) this.curFlags |= toSet
    else if (toClear !== undefined) this.curFlags &= ~toClear
  }

  private applySgrColor(params: number[], index: number, p: number): number {
    if (p >= 30 && p <= 37) {
      this.curFg = XTERM_256_RGBA[p - 30] ?? COLOR_DEFAULT
    } else if (p === 39) {
      this.curFg = COLOR_DEFAULT
    } else if (p >= 40 && p <= 47) {
      this.curBg = XTERM_256_RGBA[p - 40] ?? COLOR_DEFAULT
    } else if (p === 49) {
      this.curBg = COLOR_DEFAULT
    } else if (p >= 90 && p <= 97) {
      this.curFg = XTERM_256_RGBA[p - 90 + 8] ?? COLOR_DEFAULT
    } else if (p >= 100 && p <= 107) {
      this.curBg = XTERM_256_RGBA[p - 100 + 8] ?? COLOR_DEFAULT
    } else if (p === 38 || p === 48) {
      return this.applyExtendedColor(params, index, p === 38)
    }
    return index
  }

  private applyExtendedColor(params: number[], index: number, isFg: boolean): number {
    const mode = params[index + 1]
    if (mode === 5) {
      const color =
        XTERM_256_RGBA[Math.max(0, Math.min(255, params[index + 2] || 0))] ?? COLOR_DEFAULT
      if (isFg) this.curFg = color
      else this.curBg = color
      return index + 2
    }
    if (mode === 2) {
      const color = rgbPack(params[index + 2] || 0, params[index + 3] || 0, params[index + 4] || 0)
      if (isFg) this.curFg = color
      else this.curBg = color
      return index + 4
    }
    return index
  }

  setMode(params: number[], priv: boolean): void {
    if (!priv) return
    for (const p of params) {
      this.applyDecPrivateMode(p)
    }
  }

  private applyDecPrivateMode(p: number): void {
    switch (p) {
      case 1:
        this.applicationCursorKeys = true
        break
      case 3:
        this.resizeTerminalGrid(132, this.rows)
        this.clearScreen()
        if (this.onResize) this.onResize(this.cols, this.rows)
        break
      case 9:
      case 1000:
      case 1002:
      case 1003:
        this.mouseTracking = p
        break
      case 25:
        this.cursorVisible = true
        this.triggerRender()
        break
      case 47:
      case 1047:
        this.switchToAlternateBuffer()
        break
      case 1048:
        this.savedCursorX = this.cursorX
        this.savedCursorY = this.cursorY
        break
      case 1049:
        this.savedCursorX = this.cursorX
        this.savedCursorY = this.cursorY
        this.switchToAlternateBuffer()
        break
      case 1006:
        this.mouseProtocol = 'sgr'
        break
      case 2004:
        this.bracketedPaste = true
        break
    }
  }

  resetMode(params: number[], priv: boolean): void {
    if (!priv) return
    for (const p of params) {
      this.resetDecPrivateMode(p)
    }
  }

  private resetDecPrivateMode(p: number): void {
    switch (p) {
      case 1:
        this.applicationCursorKeys = false
        break
      case 3:
        this.resizeTerminalGrid(80, this.rows)
        this.clearScreen()
        if (this.onResize) this.onResize(this.cols, this.rows)
        break
      case 9:
      case 1000:
      case 1002:
      case 1003:
        this.mouseTracking = 0
        break
      case 25:
        this.cursorVisible = false
        this.triggerRender()
        break
      case 47:
      case 1047:
      case 1049:
        this.switchToPrimaryBuffer()
        if (p === 1049) {
          this.cursorX = Math.max(0, Math.min(this.cols - 1, this.savedCursorX))
          this.cursorY = Math.max(0, Math.min(this.rows - 1, this.savedCursorY))
          this.wrapPending = false
        }
        break
      case 1006:
        this.mouseProtocol = 'normal'
        break
      case 2004:
        this.bracketedPaste = false
        break
    }
  }

  executeOSC(data: string): void {
    if (data.length > MAX_SEQUENCE_SIZE) return
    const semiIndex = data.indexOf(';')
    if (semiIndex === -1) return

    const cmd = data.slice(0, semiIndex)
    const arg = data.slice(semiIndex + 1)

    if (cmd === '0' || cmd === '2') {
      this.title = arg
      if (this.onTitle) this.onTitle(arg)
    } else if (cmd === '52') {
      this.handleOsc52Clipboard(arg)
    }
  }

  executeDCS(_data: string): void {}

  switchToAlternateBuffer(): void {
    if (!this.useAlternate) {
      this.primaryGrid = this.grid
      this.grid = allocTermGrid(this.cols, this.rows)
      this.useAlternate = true
      this.scrollbackOffset = 0
      this.cursorX = 0
      this.cursorY = 0
      this.wrapPending = false
    }
  }

  switchToPrimaryBuffer(): void {
    if (this.useAlternate) {
      this.grid = this.primaryGrid
      this.useAlternate = false
      this.scrollbackOffset = 0
      this.wrapPending = false
    }
  }

  getScrollTop(): number {
    return this.scrollTop || 0
  }

  getScrollBottom(): number {
    return this.scrollBottom || this.rows - 1
  }

  putChar(c: string): void {
    if (this.wrapPending) {
      if (!this.useAlternate && this.cursorY >= 0 && this.cursorY < this.rows) {
        this.primaryWrapped[this.cursorY] = true
      }
      this.cursorX = 0
      this.lineFeed()
      this.wrapPending = false
    }

    if (
      this.cursorY >= 0 &&
      this.cursorY < this.rows &&
      this.cursorX >= 0 &&
      this.cursorX < this.cols
    ) {
      const cp = c.codePointAt(0) ?? SPACE_CP
      const off = (this.cursorY * this.cols + this.cursorX) * CELL_WORDS
      this.grid[off] = ((cp << CELL_CP_SHIFT) | (this.curFlags & CELL_FLAGS_MASK)) >>> 0
      this.grid[off + 1] = this.curFg
      this.grid[off + 2] = this.curBg
      this.grid[off + 3] = 0
    }

    if (this.cursorX >= this.cols - 1) {
      this.wrapPending = true
    } else {
      this.cursorX++
    }
  }

  lineFeed(): void {
    const scrollBottom = this.getScrollBottom()
    if (this.cursorY >= scrollBottom) {
      this.scrollUp(1)
    } else {
      this.cursorY++
    }
  }

  reverseIndex(): void {
    const scrollTop = this.getScrollTop()
    if (this.cursorY <= scrollTop) {
      this.scrollDown(1)
    } else {
      this.cursorY--
    }
  }

  scrollUp(n = 1): void {
    const scrollTop = this.getScrollTop()
    const scrollBottom = this.getScrollBottom()
    const rowWords = this.cols * CELL_WORDS
    for (let i = 0; i < n; i++) {
      if (!this.useAlternate) {
        if (scrollTop === 0 && this.maxScrollback > 0) {
          this.scrollbackBuffer.push(this.extractRow(0))
          this.scrollbackWrapped.push(Boolean(this.primaryWrapped[0]))
          if (this.scrollbackBuffer.length > this.maxScrollback) {
            this.scrollbackBuffer.shift()
            this.scrollbackWrapped.shift()
          }
        }
        for (let y = scrollTop; y < scrollBottom; y++) {
          this.primaryWrapped[y] = Boolean(this.primaryWrapped[y + 1])
        }
        this.primaryWrapped[scrollBottom] = false
      }
      const srcStart = (scrollTop + 1) * rowWords
      const dstStart = scrollTop * rowWords
      const len = (scrollBottom - scrollTop) * rowWords
      this.grid.copyWithin(dstStart, srcStart, srcStart + len)
      this.fillRow(scrollBottom, SPACE_CP, this.curFg, this.curBg, 0)
    }
  }

  scrollDown(n = 1): void {
    const scrollTop = this.getScrollTop()
    const scrollBottom = this.getScrollBottom()
    const rowWords = this.cols * CELL_WORDS
    for (let i = 0; i < n; i++) {
      if (!this.useAlternate) {
        for (let y = scrollBottom; y > scrollTop; y--) {
          this.primaryWrapped[y] = Boolean(this.primaryWrapped[y - 1])
        }
        this.primaryWrapped[scrollTop] = false
      }
      const srcStart = scrollTop * rowWords
      const len = (scrollBottom - scrollTop) * rowWords
      this.grid.copyWithin(srcStart + rowWords, srcStart, srcStart + len)
      this.fillRow(scrollTop, SPACE_CP, this.curFg, this.curBg, 0)
    }
  }

  eraseDisplay(mode: number): void {
    switch (mode) {
      case 0:
        this.eraseLine(0)
        for (let y = this.cursorY + 1; y < this.rows; y++) {
          this.fillRow(y, SPACE_CP, this.curFg, this.curBg, 0)
          if (!this.useAlternate) this.primaryWrapped[y] = false
        }
        break
      case 1:
        this.eraseLine(1)
        for (let y = 0; y < this.cursorY; y++) {
          this.fillRow(y, SPACE_CP, this.curFg, this.curBg, 0)
          if (!this.useAlternate) this.primaryWrapped[y] = false
        }
        break
      case 2:
      case 3:
        for (let y = 0; y < this.rows; y++) {
          this.fillRow(y, SPACE_CP, this.curFg, this.curBg, 0)
          if (!this.useAlternate) this.primaryWrapped[y] = false
        }
        if (mode === 3 && !this.useAlternate) {
          this.scrollbackBuffer = []
          this.scrollbackWrapped = []
          this.scrollbackOffset = 0
        }
        break
    }
  }

  eraseLine(mode: number): void {
    if (this.cursorY < 0 || this.cursorY >= this.rows) return
    switch (mode) {
      case 0:
        this.fillRange(this.cursorY, this.cursorX, this.cols, SPACE_CP, this.curFg, this.curBg, 0)
        if (!this.useAlternate) this.primaryWrapped[this.cursorY] = false
        break
      case 1:
        this.fillRange(this.cursorY, 0, this.cursorX + 1, SPACE_CP, this.curFg, this.curBg, 0)
        break
      case 2:
        this.fillRow(this.cursorY, SPACE_CP, this.curFg, this.curBg, 0)
        if (!this.useAlternate) this.primaryWrapped[this.cursorY] = false
        break
    }
  }

  eraseChars(n: number): void {
    if (this.cursorY < 0 || this.cursorY >= this.rows) return
    this.fillRange(
      this.cursorY,
      this.cursorX,
      this.cursorX + n,
      SPACE_CP,
      this.curFg,
      this.curBg,
      0
    )
  }

  insertChars(n: number): void {
    if (this.cursorY < 0 || this.cursorY >= this.rows) return
    const rowOffset = this.cursorY * this.cols * CELL_WORDS
    const srcStart = rowOffset + this.cursorX * CELL_WORDS
    const dstStart = srcStart + n * CELL_WORDS
    const rowEnd = rowOffset + this.cols * CELL_WORDS
    this.grid.copyWithin(dstStart, srcStart, rowEnd - n * CELL_WORDS)
    this.fillRange(
      this.cursorY,
      this.cursorX,
      Math.min(this.cursorX + n, this.cols),
      SPACE_CP,
      this.curFg,
      this.curBg,
      0
    )
  }

  deleteChars(n: number): void {
    if (this.cursorY < 0 || this.cursorY >= this.rows) return
    const rowOffset = this.cursorY * this.cols * CELL_WORDS
    const srcStart = rowOffset + (this.cursorX + n) * CELL_WORDS
    const dstStart = rowOffset + this.cursorX * CELL_WORDS
    const rowEnd = rowOffset + this.cols * CELL_WORDS
    this.grid.copyWithin(dstStart, srcStart, rowEnd)
    this.fillRange(this.cursorY, this.cols - n, this.cols, SPACE_CP, this.curFg, this.curBg, 0)
  }

  insertLines(n: number): void {
    const scrollBottom = this.getScrollBottom()
    const rowWords = this.cols * CELL_WORDS
    for (let i = 0; i < n; i++) {
      if (this.cursorY <= scrollBottom) {
        if (!this.useAlternate) {
          for (let y = scrollBottom; y > this.cursorY; y--) {
            this.primaryWrapped[y] = Boolean(this.primaryWrapped[y - 1])
          }
          this.primaryWrapped[this.cursorY] = false
        }
        const srcStart = this.cursorY * rowWords
        const len = (scrollBottom - this.cursorY) * rowWords
        this.grid.copyWithin(srcStart + rowWords, srcStart, srcStart + len)
        this.fillRow(this.cursorY, SPACE_CP, this.curFg, this.curBg, 0)
      }
    }
  }

  deleteLines(n: number): void {
    const scrollBottom = this.getScrollBottom()
    const rowWords = this.cols * CELL_WORDS
    for (let i = 0; i < n; i++) {
      if (this.cursorY <= scrollBottom) {
        if (!this.useAlternate) {
          for (let y = this.cursorY; y < scrollBottom; y++) {
            this.primaryWrapped[y] = Boolean(this.primaryWrapped[y + 1])
          }
          this.primaryWrapped[scrollBottom] = false
        }
        const srcStart = (this.cursorY + 1) * rowWords
        const dstStart = this.cursorY * rowWords
        const len = (scrollBottom - this.cursorY) * rowWords
        this.grid.copyWithin(dstStart, srcStart, srcStart + len)
        this.fillRow(scrollBottom, SPACE_CP, this.curFg, this.curBg, 0)
      }
    }
  }

  clearScreen(): void {
    for (let y = 0; y < this.rows; y++) {
      this.fillRow(y, SPACE_CP, COLOR_DEFAULT, COLOR_DEFAULT, 0)
      if (!this.useAlternate) this.primaryWrapped[y] = false
    }
    this.cursorX = 0
    this.cursorY = 0
    this.wrapPending = false
  }

  tabForward(n = 1): void {
    for (let i = 0; i < n; i++) {
      let nextTab = this.cursorX + 1
      while (nextTab < this.cols && !this.tabStops.has(nextTab)) nextTab++
      this.cursorX = Math.min(nextTab, this.cols - 1)
    }
  }

  tabBackward(n = 1): void {
    for (let i = 0; i < n; i++) {
      let prevTab = this.cursorX - 1
      while (prevTab > 0 && !this.tabStops.has(prevTab)) prevTab--
      this.cursorX = Math.max(0, prevTab)
    }
  }

  deviceStatusReport(cmd: number): void {
    if (this.passiveQueries) return
    if (cmd === 5) {
      this.send('\x1b[0n')
    } else if (cmd === 6) {
      this.send(`\x1b[${this.cursorY + 1};${this.cursorX + 1}R`)
    }
  }

  clear(): void {
    this.eraseDisplay(3)
    this.cursorX = 0
    this.cursorY = 0
    this.wrapPending = false
    this.triggerRender()
  }
}
