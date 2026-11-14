# Roppo agent portraits

Selected visual target: [R-shaped identity concept](../../../../docs/images/agent-identity-concept.png), confirmed by the user on 2026-11-14.

Five separate transparent images were produced with the built-in ImageGen edit tool using that sheet as reference. Exact generation prompts are preserved in the adjacent `*.prompt.txt` files. Original outputs are square RGBA PNGs; production files are resized and encoded as 256 × 256 WebP with `cwebp -q 90 -m 6 -resize 256 256`, preserving alpha.

| Asset | Role | Bytes |
| --- | --- | ---: |
| router.webp | Router | 7,256 |
| worker-sage.webp | Worker variant | 6,926 |
| worker-blue.webp | Worker variant | 10,874 |
| worker-clay.webp | Worker variant | 9,976 |
| worker-stone.webp | Worker variant | 7,078 |

Appearance follows stable Worker identity, not task profession or model provider. The four Worker variants can repeat; labels remain the primary identity. Router is inverted in dark mode; Worker colors remain stable.

All five files were visually checked after browser compositing at small sizes on light and dark surfaces. They have no text, white background panel, or sprite-sheet neighbors. Static portraits only; existing runtime state labels and indicators remain authoritative.
