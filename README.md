# shrinkpdf

**Compress PDF files entirely in your browser. No uploads. No servers. 100% private.**

A web-based PDF compression tool powered by Ghostscript compiled to WebAssembly. Your files never leave your device.

![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?logo=webassembly&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)
![License](https://img.shields.io/badge/license-AGPLv3-blue)

## Features

- **100% Client-Side** - All compression happens locally in your browser using WebAssembly
- **Complete Privacy** - Zero network transfer of file data; your documents stay on your device
- **Open Source** - Fully verifiable; inspect the code and network traffic yourself
- **Multiple Compression Levels** - Choose between quality-focused, balanced, or size-focused compression
- **No Installation Required** - Works in any modern browser with WebAssembly support

## How It Works

shrinkpdf uses [Ghostscript](https://www.ghostscript.com/) 10.07.0 compiled to [WebAssembly](https://webassembly.org/), running entirely in a Web Worker (see [louisprp/ps-wasm](https://github.com/louisprp/ps-wasm) for more details). The WASM binary handles all PDF processing locally without any server communication.

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/louisprp/shrinkpdf.git
cd shrinkpdf

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

### Build for Production

```bash
pnpm build
```

The built files will be in the `dist` directory, ready to deploy to any static hosting service.

## Tech Stack

- **React** + **TypeScript** - UI framework
- **Tailwind CSS** - Styling
- **shadcn/ui** - UI components
- **Web Workers** - Background processing
- **Vite** - Build tooling

## Privacy Verification

You can verify that your files never leave your device:

1. Open your browser's Developer Tools (F12)
2. Navigate to the **Network** tab
3. Upload and compress a PDF
4. Observe that no file data is transmitted

## Acknowledgments

This project is inspired by [shrinkpdf.sh](https://github.com/aklomp/shrinkpdf) by Alfred Klomp - a shell script that provides common arguments for PDF compression with Ghostscript. This website brings that same functionality to the browser, no local Ghostscript installation required.

## License

This project is licensed under the [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html).

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.