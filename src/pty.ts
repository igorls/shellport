export interface PtySessionOptions {
  readonly cols: number
  readonly rows: number
  readonly cwd?: string
  readonly env?: Record<string, string | undefined>
  readonly onData: (data: Uint8Array) => void
}

export interface PtySession {
  readonly pid: number
  readonly exited: Promise<number>
  readonly exitCode: number | null
  write(data: string | Uint8Array): void
  resize(cols: number, rows: number): void
  close(): void
  kill(signal?: NodeJS.Signals | number): void
  unref(): void
}

function clampDim(value: number, fallback: number, max: number): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(max, n)
}

/** Spawn a command behind Bun's native PTY and expose only terminal operations. */
export function spawnPty(command: readonly string[], options: PtySessionOptions): PtySession {
  if (command.length === 0) throw new Error('PTY command must not be empty')

  const cols = clampDim(options.cols, 80, 1000)
  const rows = clampDim(options.rows, 24, 500)

  const proc = Bun.spawn([...command], {
    cwd: options.cwd,
    env: options.env,
    terminal: {
      cols,
      rows,
      data(_terminal, data): void {
        options.onData(data)
      },
    },
  })
  const terminal = proc.terminal
  if (!terminal) {
    proc.kill()
    throw new Error('Bun did not allocate a terminal for the PTY process')
  }

  return {
    pid: proc.pid,
    exited: proc.exited,
    get exitCode(): number | null {
      return proc.exitCode
    },
    write: (data): void => {
      if (proc.exitCode !== null) return
      try {
        terminal.write(data)
      } catch {
        // Ignore writes to a closed PTY descriptor
      }
    },
    resize: (nextCols, nextRows): void => {
      if (proc.exitCode !== null) return
      const safeCols = clampDim(nextCols, cols, 1000)
      const safeRows = clampDim(nextRows, rows, 500)
      try {
        terminal.resize(safeCols, safeRows)
      } catch {
        // ConPTY / exited PTY handles may throw if resized during teardown
      }
    },
    close: (): void => {
      try {
        terminal.close()
      } catch {
        // Already closed
      }
    },
    kill: (signal): void => {
      try {
        if (signal !== undefined) proc.kill(signal)
        else proc.kill()
      } catch {
        // Process already exited
      }
    },
    unref: (): void => {
      try {
        proc.unref()
      } catch {
        // Ignore if not supported or already exited
      }
    },
  }
}
