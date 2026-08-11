import { describe, expect, test } from 'bun:test'
import { CELL_CP_SHIFT, CELL_WORDS, SPACE_CP } from './constants.js'
import { WebGLRenderer } from './webgl-renderer.js'

describe('NanoTerm WebGL redraw snapshots', () => {
  test('clears uncovered cells when a resized scrollback row is narrower', () => {
    const renderer = Object.create(WebGLRenderer.prototype)
    renderer._gridData = new Uint32Array(4 * 2 * CELL_WORDS).fill(0xdeadbeef)

    const narrowRow = new Uint32Array(2 * CELL_WORDS)
    narrowRow[0] = 'A'.codePointAt(0) << CELL_CP_SHIFT
    narrowRow[CELL_WORDS] = 'B'.codePointAt(0) << CELL_CP_SHIFT

    const activeGrid = new Uint32Array(4 * 2 * CELL_WORDS)
    for (let i = 0; i < activeGrid.length; i += CELL_WORDS) {
      activeGrid[i] = SPACE_CP << CELL_CP_SHIFT
    }

    const { gridData } = renderer._buildVisibleGrid({
      cols: 4,
      rows: 2,
      scrollbackOffset: 1,
      useAlternate: false,
      scrollbackBuffer: [narrowRow],
      grid: activeGrid,
    })

    expect(gridData[0] >>> CELL_CP_SHIFT).toBe('A'.codePointAt(0))
    expect(gridData[CELL_WORDS] >>> CELL_CP_SHIFT).toBe('B'.codePointAt(0))
    expect(Array.from(gridData.slice(2 * CELL_WORDS, 4 * CELL_WORDS))).toEqual(
      new Array(2 * CELL_WORDS).fill(0)
    )
  })

  test('drops stale atlas indices from blank and procedural cells', () => {
    const renderer = Object.create(WebGLRenderer.prototype)
    const gridData = new Uint32Array(2 * CELL_WORDS)
    gridData[0] = SPACE_CP << CELL_CP_SHIFT
    gridData[3] = 91
    gridData[CELL_WORDS] = 0x2801 << CELL_CP_SHIFT
    gridData[CELL_WORDS + 3] = 92

    renderer._updateAtlasForGrid(gridData, 2, 1)

    expect(gridData[3]).toBe(0)
    expect(gridData[CELL_WORDS + 3]).toBe(0)
  })
})
