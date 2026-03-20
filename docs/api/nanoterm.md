# NanoTermV2 Library

NanoTermV2 is a feature-complete VT100/VT220/xterm terminal emulator written in JavaScript. It can be used standalone as a library in any web application.

## Installation

NanoTermV2 is bundled with ShellPort. To use it standalone:

```bash
# Via Bun
bun add shellport

# Via npm
npm install shellport
```

Then import from the package:

```javascript
import NanoTermV2 from 'shellport/nanoterm';
```

Or use the pre-bundled version directly in HTML:

```html
<script src="node_modules/shellport/dist/nanoterm.js"></script>
<script>
  const terminal = new window.NanoTermV2(container, sendFn, options);
</script>
```

## Initialization

```javascript
const terminal = new NanoTermV2(container, sendFn, options);
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `container` | `HTMLElement` | DOM element to mount the terminal |
| `sendFn` | `function(data)` | Callback to send data to the PTY/server |
| `options` | `object` | Configuration options (see below) |

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fontSize` | `number` | `14` | Font size in pixels |
| `fontFamily` | `string` | _(see below)_ | CSS font family string |
| `theme` | `object` | `{}` | Color theme overrides |
| `scrollback` | `number` | `10000` | Number of scrollback lines to keep |
| `cursorStyle` | `string` | `'block'` | Cursor style: `'block'`, `'underline'`, or `'bar'` |
| `cursorBlink` | `boolean` | `true` | Whether the cursor blinks |
| `allowProprietary` | `boolean` | `true` | Allow proprietary escape sequences |
| `padding` | `number` | `6` | Terminal padding in pixels |
| `lineHeight` | `number` | `0` | Additional line height |
| `renderer` | `string` | `'auto'` | Renderer: `'auto'`, `'canvas'`, or `'webgl'` |

### Default Font Family

```javascript
"'JetBrains Mono Nerd Font', 'CaskaydiaCove Nerd Font', 'FiraCode Nerd Font', 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace"
```

### Theme Object

```javascript
const theme = {
  background: '#0a0a0a',    // Terminal background
  foreground: '#e0e0e0',   // Default text color
  cursor: '#a78bfa',        // Cursor color
  selection: 'rgba(167, 139, 250, 0.3)', // Selection highlight
  palette: [...]            // 256-color palette (optional)
};
```

## API Methods

### `write(data)`

Write data to the terminal for rendering.

```javascript
terminal.write('\x1b[1;32mHello\x1b[0m');  // Write escape sequences
terminal.write('Plain text');
terminal.write(new Uint8Array([...]));       // Binary data
terminal.write(arrayBuffer);                 // ArrayBuffer
```

### `resize(cols, rows)`

Resize the terminal grid (usually called automatically via `onResize` callback).

```javascript
terminal.resize(80, 24);
```

### `onData(callback)`

Register a callback for incoming terminal data (sent to PTY).

```javascript
terminal.onData((data) => {
  // data is the string/bytes received from terminal
});
```

Note: `onData` is registered via the `sendFn` callback passed during initialization.

### `onResize(callback)`

Register a callback for terminal resize events.

```javascript
terminal.onResize((cols, rows) => {
  console.log(`Terminal resized to ${cols}x${rows}`);
  // Send resize to server: JSON.stringify({ type: 'resize', cols, rows })
});
```

### `onTitle(callback)`

Register a callback for terminal title changes (OSC 0/2).

```javascript
terminal.onTitle((title) => {
  document.title = title;
});
```

### `onFocus(callback)`

Register a callback for focus events.

```javascript
terminal.onFocus(() => {
  console.log('Terminal focused');
});
```

### `onBlur(callback)`

Register a callback for blur events.

```javascript
terminal.onBlur(() => {
  console.log('Terminal blurred');
});
```

### `clear()`

Clear the terminal screen.

```javascript
terminal.clear();
```

### `getSelection()`

Get the currently selected text.

```javascript
const selected = terminal.getSelection();
console.log(selected);
```

### `copyToClipboard()`

Copy the current selection to the clipboard.

```javascript
terminal.copyToClipboard();
```

### `destroy()`

Destroy the terminal instance and clean up resources.

```javascript
terminal.destroy();
```

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `cols` | `number` | Current number of columns |
| `rows` | `number` | Current number of rows |
| `canvas` | `HTMLCanvasElement` | The canvas element |
| `focused` | `boolean` | Whether the terminal has focus |

## Events

The terminal fires events via callback properties:

| Event | Callback Signature | Description |
|-------|-------------------|-------------|
| Resize | `(cols: number, rows: number) => void` | Terminal was resized |
| Title | `(title: string) => void` | Terminal title changed |
| Focus | `() => void` | Terminal gained focus |
| Blur | `() => void` | Terminal lost focus |
| Clipboard Write | `(text: string) => boolean` | Clipboard write requested (return `true` to allow) |

## Security

NanoTermV2 includes security features:

- **OSC 52 Clipboard**: Clipboard write requests require explicit confirmation via `onClipboardWrite` callback
- **Sequence Size Limits**: Maximum escape sequence size is capped to prevent memory exhaustion
- **DSR Blocking**: Device Status Report queries are blocked to prevent fingerprinting
- **Input Sanitization**: All input is validated before processing

## Example

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    #terminal {
      width: 100%;
      height: 400px;
      background: #0a0a0a;
    }
  </style>
</head>
<body>
  <div id="terminal"></div>
  
  <script type="module">
    import NanoTermV2 from './nanoterm.js';
    
    const container = document.getElementById('terminal');
    const terminal = new NanoTermV2(container, (data) => {
      // Send keystrokes to your PTY/server
      ws.send(data);
    }, {
      fontSize: 14,
      cursorBlink: true,
      theme: {
        background: '#0a0a0a',
        foreground: '#e0e0e0',
        cursor: '#a78bfa'
      }
    });
    
    terminal.onResize((cols, rows) => {
      // Notify server of resize
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    });
    
    terminal.onTitle((title) => {
      document.title = title;
    });
    
    // Receive data from server
    ws.addEventListener('message', (event) => {
      terminal.write(event.data);
    });
  </script>
</body>
</html>
```
