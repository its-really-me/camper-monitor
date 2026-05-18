# Third-Party Licenses

Camper Monitor uses the following open-source packages. License texts are available in each package's directory under `node_modules/`.

---

## Runtime dependencies

| Package | Version | License | Notes |
|---------|---------|---------|-------|
| `@abandonware/noble` | ^1.9.2 | MIT | BLE scanning and GATT connections on Linux/BlueZ |
| `express` | ^4.21.0 | MIT | HTTP server + SSE endpoint |
| `js-yaml` | ^4.1.0 | MIT | `settings.yaml` config parser |
| `dotenv` | ^16.4.0 | BSD-2-Clause | `.env` override loading |
| `serialport` | ^12.0.0 | MIT | VE.Direct serial port reader (solar, optional) |
| `react` | ^18.3.1 | MIT | UI framework |
| `react-dom` | ^18.3.1 | MIT | React DOM renderer |
| `lucide-react` | ^1.14.0 | ISC | Icon library |
| `canvas` | ^2.11.2 | MIT | Cairo-based canvas for Pi Zero W framebuffer renderer (`ui-fb`) |

## Build / dev dependencies

| Package | Version | License | Notes |
|---------|---------|---------|-------|
| `vite` | ^6.0.1 | MIT | React build tool + dev server |
| `@vitejs/plugin-react` | ^4.3.4 | MIT | Vite plugin for React JSX transform |
| `tailwindcss` | ^3.4.14 | MIT | Utility-first CSS framework |
| `postcss` | ^8.4.47 | MIT | CSS post-processor (required by Tailwind) |
| `autoprefixer` | ^10.4.20 | MIT | PostCSS plugin for vendor prefixes |
| `concurrently` | ^8.2.2 | MIT | Runs server + Vite dev server in parallel (`npm run dev`) |

---

## License texts

### MIT License (applies to most packages above)

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### ISC License (lucide-react)

> Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

### BSD 2-Clause License (dotenv)

> Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
>
> 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
> 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

---

*Full license texts for each package can be found in the respective `node_modules/<package>/LICENSE` file or on [npmjs.com](https://npmjs.com).*
