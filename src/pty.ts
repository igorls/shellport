import { spawn } from 'bun'

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
  write(data: string | Uint8Array): void
  resize(cols: number, rows: number): void
  close(): void
  kill(): void
}

/** Spawn a command behind Bun's native PTY and expose only terminal operations. */
export function spawnPty(command: readonly string[], options: PtySessionOptions): PtySession {
  if (command.length === 0) throw new Error('PTY command must not be empty')

  const proc = spawn([...command], {
    cwd: options.cwd,
    env: options.env,
    terminal: {
      cols: options.cols,
      rows: options.rows,
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
    write: (data): void => {
      terminal.write(data)
    },
    resize: (cols, rows): void => {
      terminal.resize(cols, rows)
    },
    close: (): void => {
      terminal.close()
    },
    kill: (): void => {
      proc.kill()
    },
  }
}
