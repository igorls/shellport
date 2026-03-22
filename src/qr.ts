/**
 * ShellPort — Zero-Dependency QR Code Generator for Terminal
 *
 * Based on Gemini DeepThink's proven implementation.
 * Supports: Auto-Sizing (V1-40), Byte Mode (UTF-8), Error Correction Level M
 * Renders to terminal using Unicode half-block characters with ANSI colors.
 */

// EC Level M tables (index 0 unused, 1-40 = versions)
const ECC_WORDS = [
  0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 28, 28, 30, 30,
  26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
]
const NUM_BLOCKS = [
  0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
]

// ═══════════════════════════════════════════════════════════════════════════
// Reed-Solomon GF(256) Arithmetic
// ═══════════════════════════════════════════════════════════════════════════

class ReedSolomon {
  static exp = new Uint8Array(512)
  static log = new Uint8Array(256)

  static init() {
    let x = 1
    for (let i = 0; i < 255; i++) {
      this.exp[i] = x
      this.exp[i + 255] = x
      this.log[x] = i
      x <<= 1
      if (x & 0x100) x ^= 0x11d
    }
  }

  static mul(x: number, y: number): number {
    if (x === 0 || y === 0) return 0
    return this.exp[(this.log[x] + this.log[y]) % 255]
  }

  static divisor(degree: number): number[] {
    let poly = [1]
    for (let i = 0; i < degree; i++) {
      const root = this.exp[i]
      const next = new Array(poly.length + 1).fill(0)
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j]
        next[j + 1] ^= this.mul(poly[j], root)
      }
      poly = next
    }
    return poly
  }
}

ReedSolomon.init()

// ═══════════════════════════════════════════════════════════════════════════
// QR Code Geometry Helpers
// ═══════════════════════════════════════════════════════════════════════════

function getNumRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}

function getAlignments(ver: number): number[] {
  if (ver === 1) return []
  const num = Math.floor(ver / 7) + 2
  const step = ver === 32 ? 26 : Math.round((ver * 4 + 4) / (num - 1) / 2) * 2
  const res = [6]
  const last = 4 * ver + 10
  for (let i = num - 2; i >= 0; i--) res.push(last - step * i)
  return res
}

// ═══════════════════════════════════════════════════════════════════════════
// Core QR Generation
// ═══════════════════════════════════════════════════════════════════════════

function generateQR(text: string): boolean[][] {
  const data = new TextEncoder().encode(text)

  // 1. Determine optimal version
  let version = 1
  let dataCapacity = 0
  for (; version <= 40; version++) {
    const charCountBits = version < 10 ? 8 : 16
    const requiredBits = 4 + charCountBits + data.length * 8
    const rawModules = getNumRawDataModules(version)
    dataCapacity = Math.floor(rawModules / 8) - NUM_BLOCKS[version] * ECC_WORDS[version]
    if (Math.ceil(requiredBits / 8) <= dataCapacity) break
  }
  if (version > 40) throw new Error('Data too long for QR code')

  // 2. Build bitstream (byte mode)
  const bits: number[] = []
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }

  push(0b0100, 4) // Byte mode indicator
  push(data.length, version < 10 ? 8 : 16)
  for (const b of data) push(b, 8)

  const maxBits = dataCapacity * 8
  push(0, Math.min(4, maxBits - bits.length)) // Terminator
  while (bits.length % 8 !== 0) push(0, 1) // Byte pad

  let pad = 0xec
  while (bits.length < maxBits) {
    push(pad, 8)
    pad = pad === 0xec ? 0x11 : 0xec
  }

  const dataBytes = new Uint8Array(bits.length / 8)
  for (let i = 0; i < bits.length; i++) dataBytes[i >>> 3] |= bits[i] << (7 - (i & 7))

  // 3. Reed-Solomon error correction blocks
  const numBlocks = NUM_BLOCKS[version]
  const eccPerBlock = ECC_WORDS[version]
  const shortBlockLen = Math.floor(dataCapacity / numBlocks)
  const numShortBlocks = numBlocks - (dataCapacity % numBlocks)

  const divisor = ReedSolomon.divisor(eccPerBlock)
  const dataBlocks: Uint8Array[] = []
  const eccBlocks: Uint8Array[] = []

  let offset = 0
  for (let i = 0; i < numBlocks; i++) {
    const len = shortBlockLen + (i < numShortBlocks ? 0 : 1)
    const block = dataBytes.subarray(offset, offset + len)
    offset += len
    dataBlocks.push(block)

    const ecc = new Uint8Array(eccPerBlock)
    for (const b of block) {
      const factor = b ^ ecc[0]
      ecc.copyWithin(0, 1)
      ecc[eccPerBlock - 1] = 0
      for (let j = 0; j < eccPerBlock; j++) {
        ecc[j] ^= ReedSolomon.mul(divisor[j + 1], factor)
      }
    }
    eccBlocks.push(ecc)
  }

  // 4. Interleave data and EC
  const finalBytes: number[] = []
  for (let i = 0; i <= shortBlockLen; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i < shortBlockLen || j >= numShortBlocks) finalBytes.push(dataBlocks[j][i])
    }
  }
  for (let i = 0; i < eccPerBlock; i++) {
    for (let j = 0; j < numBlocks; j++) finalBytes.push(eccBlocks[j][i])
  }

  // 5. Draw matrix
  const size = 21 + (version - 1) * 4
  const matrix = Array.from({ length: size }, () => new Array(size).fill(false))
  const isFunc = Array.from({ length: size }, () => new Array(size).fill(false))

  const setFunc = (x: number, y: number, isDark: boolean) => {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      matrix[y][x] = isDark
      isFunc[y][x] = true
    }
  }

  // Finder patterns
  const drawFinder = (dx: number, dy: number) => {
    for (let y = -1; y < 8; y++) {
      for (let x = -1; x < 8; x++) {
        const dist = Math.max(Math.abs(x - 3), Math.abs(y - 3))
        setFunc(dx + x, dy + y, dist !== 2 && dist !== 4)
      }
    }
  }
  drawFinder(0, 0)
  drawFinder(size - 7, 0)
  drawFinder(0, size - 7)

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0)
    setFunc(i, 6, i % 2 === 0)
  }

  // Alignment patterns
  const alignPos = getAlignments(version)
  for (const x of alignPos) {
    for (const y of alignPos) {
      if ((x === 6 && y === 6) || (x === 6 && y === size - 7) || (x === size - 7 && y === 6))
        continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunc(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }

  // Format & version reservoirs
  for (let i = 0; i < 9; i++) setFunc(8, i, false)
  for (let i = 0; i < 8; i++) setFunc(i, 8, false)
  for (let i = 0; i < 8; i++) setFunc(size - 1 - i, 8, false)
  for (let i = 0; i < 7; i++) setFunc(8, size - 1 - i, false)
  setFunc(8, size - 8, true)

  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3),
        b = Math.floor(i / 3)
      setFunc(a, b, false)
      setFunc(b, a, false)
    }
  }

  // 6. Zigzag data placement
  let index = 0
  let right = size - 1
  let upward = true
  while (right >= 0) {
    if (right === 6) right = 5
    for (let y = upward ? size - 1 : 0; upward ? y >= 0 : y < size; upward ? y-- : y++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        if (!isFunc[y][x]) {
          matrix[y][x] =
            index < finalBytes.length * 8
              ? ((finalBytes[index >>> 3] >>> (7 - (index & 7))) & 1) === 1
              : false
          index++
        }
      }
    }
    upward = !upward
    right -= 2
  }

  // 7. Mask evaluation — apply/unapply to find best penalty
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFunc[y][x]) continue
        let invert = false
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0
            break
          case 1:
            invert = y % 2 === 0
            break
          case 2:
            invert = x % 3 === 0
            break
          case 3:
            invert = (x + y) % 3 === 0
            break
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
            break
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0
            break
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
            break
          case 7:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
            break
        }
        if (invert) matrix[y][x] = !matrix[y][x]
      }
    }
  }

  let bestMask = 0
  let minPenalty = Infinity

  for (let m = 0; m < 8; m++) {
    applyMask(m)
    let penalty = 0
    let dark = 0

    for (let y = 0; y < size; y++) {
      let cx = 1,
        cy = 1
      for (let x = 0; x < size; x++) {
        if (matrix[y][x]) dark++
        if (x > 0) {
          if (matrix[y][x] === matrix[y][x - 1]) cx++
          else {
            if (cx >= 5) penalty += cx - 2
            cx = 1
          }
          if (matrix[x][y] === matrix[x - 1][y]) cy++
          else {
            if (cy >= 5) penalty += cy - 2
            cy = 1
          }
        }
        if (x < size - 1 && y < size - 1) {
          const c = matrix[y][x]
          if (c === matrix[y][x + 1] && c === matrix[y + 1][x] && c === matrix[y + 1][x + 1])
            penalty += 3
        }
      }
      if (cx >= 5) penalty += cx - 2
      if (cy >= 5) penalty += cy - 2
    }

    const pat = [true, false, true, true, true, false, true]
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size - 6; x++) {
        let matchH = true,
          matchV = true
        for (let i = 0; i < 7; i++) {
          if (matrix[y][x + i] !== pat[i]) matchH = false
          if (matrix[x + i][y] !== pat[i]) matchV = false
        }
        if (matchH) {
          const left =
            x >= 4 &&
            !matrix[y][x - 1] &&
            !matrix[y][x - 2] &&
            !matrix[y][x - 3] &&
            !matrix[y][x - 4]
          const right =
            x + 10 < size &&
            !matrix[y][x + 7] &&
            !matrix[y][x + 8] &&
            !matrix[y][x + 9] &&
            !matrix[y][x + 10]
          if (left || right) penalty += 40
        }
        if (matchV) {
          const up =
            x >= 4 &&
            !matrix[x - 1][y] &&
            !matrix[x - 2][y] &&
            !matrix[x - 3][y] &&
            !matrix[x - 4][y]
          const down =
            x + 10 < size &&
            !matrix[x + 7][y] &&
            !matrix[x + 8][y] &&
            !matrix[x + 9][y] &&
            !matrix[x + 10][y]
          if (up || down) penalty += 40
        }
      }
    }

    penalty += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10
    if (penalty < minPenalty) {
      minPenalty = penalty
      bestMask = m
    }
    applyMask(m) // Undo mask (XOR is self-inverse)
  }

  // Lock in best mask
  applyMask(bestMask)

  // 8. Place BCH-encoded format info
  let formatBits = bestMask
  for (let i = 0; i < 10; i++) formatBits = (formatBits << 1) ^ (formatBits >>> 9 ? 0x537 : 0)
  formatBits = ((bestMask << 10) | formatBits) ^ 0x5412

  const fC1 = [
    [8, size - 1],
    [8, size - 2],
    [8, size - 3],
    [8, size - 4],
    [8, size - 5],
    [8, size - 6],
    [8, size - 7],
    [size - 8, 8],
    [size - 7, 8],
    [size - 6, 8],
    [size - 5, 8],
    [size - 4, 8],
    [size - 3, 8],
    [size - 2, 8],
    [size - 1, 8],
  ]
  const fC2 = [
    [0, 8],
    [1, 8],
    [2, 8],
    [3, 8],
    [4, 8],
    [5, 8],
    [7, 8],
    [8, 8],
    [8, 7],
    [8, 5],
    [8, 4],
    [8, 3],
    [8, 2],
    [8, 1],
    [8, 0],
  ]

  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >>> (14 - i)) & 1) === 1
    matrix[fC1[i][1]][fC1[i][0]] = bit
    matrix[fC2[i][1]][fC2[i][0]] = bit
  }

  if (version >= 7) {
    let verBits = version
    for (let i = 0; i < 12; i++) verBits = (verBits << 1) ^ (verBits >>> 11 ? 0x1f25 : 0)
    verBits = (version << 12) | verBits
    for (let i = 0; i < 18; i++) {
      const bit = ((verBits >>> i) & 1) === 1
      const a = size - 11 + (i % 3),
        b = Math.floor(i / 3)
      matrix[b][a] = bit
      matrix[a][b] = bit
    }
  }

  return matrix
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a QR code boolean matrix from text.
 * Returns a 2D array where true = black module, false = white module.
 */
export function generateQRMatrix(text: string): boolean[][] {
  return generateQR(text)
}

/**
 * Render a QR code as a Unicode string for terminal display.
 * Uses ANSI white background + half-block characters for 1:1 aspect ratio.
 */
export function renderQRTerminal(text: string): string {
  const matrix = generateQR(text)
  const size = matrix.length
  const quiet = 2
  const totalSize = size + quiet * 2
  const padded = Array.from({ length: totalSize }, () => Array(totalSize).fill(false))

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      padded[y + quiet][x + quiet] = matrix[y][x]
    }
  }

  const lines: string[] = []
  for (let y = 0; y < totalSize; y += 2) {
    let line = '\x1b[47;30m'
    for (let x = 0; x < totalSize; x++) {
      const top = padded[y][x]
      const bottom = y + 1 < totalSize ? padded[y + 1][x] : false

      if (top && bottom) line += '█'
      else if (top && !bottom) line += '▀'
      else if (!top && bottom) line += '▄'
      else line += ' '
    }
    lines.push(line + '\x1b[0m')
  }

  return lines.join('\n')
}

/**
 * Print a QR code to the terminal with a label.
 */
export function printQR(text: string, label?: string): void {
  console.log('')
  if (label) {
    console.log(`  ${label}`)
    console.log('')
  }
  const rendered = renderQRTerminal(text)
  for (const line of rendered.split('\n')) {
    console.log(`  ${line}`)
  }
  console.log('')
}
