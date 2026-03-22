import { describe, test, expect } from 'bun:test'
import { generateQRMatrix, renderQRTerminal } from './qr.js'

describe('QR Code', () => {
  test('generates valid v1 matrix for short text', () => {
    const matrix = generateQRMatrix('HELLO')
    expect(matrix.length).toBe(21) // v1 = 21×21
    expect(matrix[0].length).toBe(21)
    // Every cell should be boolean
    for (const row of matrix) {
      for (const cell of row) {
        expect(typeof cell).toBe('boolean')
      }
    }
  })

  test('generates valid matrix for URL', () => {
    const matrix = generateQRMatrix('https://example.com')
    expect(matrix.length).toBeGreaterThan(21) // v2+
    for (const row of matrix) {
      for (const cell of row) {
        expect(typeof cell).toBe('boolean')
      }
    }
  })

  test('generates valid matrix for otpauth URI', () => {
    const uri = 'otpauth://totp/ShellPort?secret=JBSWY3DPEHPK3PXP&issuer=ShellPort'
    const matrix = generateQRMatrix(uri)
    expect(matrix.length).toBeGreaterThan(21)
  })

  test('has correct finder patterns', () => {
    const matrix = generateQRMatrix('test')
    // Top-left finder: corners and center should be dark (true)
    expect(matrix[0][0]).toBe(true)
    expect(matrix[0][6]).toBe(true)
    expect(matrix[6][0]).toBe(true)
    expect(matrix[6][6]).toBe(true)
    expect(matrix[3][3]).toBe(true)
    // Inner white ring
    expect(matrix[1][1]).toBe(false)
  })

  test('renders to terminal string with ANSI codes', () => {
    const output = renderQRTerminal('test')
    expect(output).toContain('█')
    expect(output).toContain('\x1b[47;30m') // White bg, black fg
    expect(output).toContain('\x1b[0m') // Reset
    expect(output.length).toBeGreaterThan(0)
  })

  test('throws for data too long', () => {
    expect(() => generateQRMatrix('x'.repeat(3000))).toThrow('Data too long')
  })
})
