# Installation

ShellPort can be installed in three ways. Choose the method that best fits your workflow.

## Quick Start (Bun)

The fastest way to get started. Requires [Bun](https://bun.sh) to be installed.

```bash
bunx shellport server
```

This downloads and runs ShellPort in a single command. No additional setup required.

## Prebuilt Binary

Download a prebuilt binary for your platform from the [GitHub Releases](https://github.com/igorls/shellport/releases) page.

### Linux

```bash
curl -fsSL https://github.com/igorls/shellport/releases/latest/download/shellport-linux-x64 -o shellport
chmod +x shellport
./shellport server
```

### macOS

```bash
curl -fsSL https://github.com/igorls/shellport/releases/latest/download/shellport-macos-arm64 -o shellport
chmod +x shellport
./shellport server
```

### Windows

Download the `shellport-windows-x64.exe` from the releases page and run it from Command Prompt or PowerShell.

## Building from Source

Clone the repository and build it yourself.

### Prerequisites

- [Bun](https://bun.sh) 1.x

### Steps

```bash
git clone https://github.com/igorls/shellport.git
cd shellport
bun install
bun run build
```

This creates a `shellport` binary in the project root. Run it with:

```bash
./shellport server
```

For development with hot-reloading:

```bash
bun run dev
```

## Verifying Installation

After installation, verify ShellPort is working by starting the server:

```bash
shellport server
```

You should see output like:

```
🌐 Open in browser: http://localhost:7681/#<random-secret>
```

If you see this message, ShellPort is installed correctly. Proceed to the [Quick Start](./quick-start) guide to learn how to use it.
