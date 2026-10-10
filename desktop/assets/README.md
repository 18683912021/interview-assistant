# App icons

These assets reproduce the existing sidebar/authentication brand mark: the
`#292d3b` rounded square and white Lucide `AudioLines` glyph. They retain the
29/19 mark-to-glyph proportions and 8/29 corner radius from `src/index.css`.
The surrounding space is transparent; no paid image generation is involved.

- `icon.svg`: inspectable vector representation.
- `icon.png`: 1024 × 1024 RGBA preview.
- `icon.icns`: standard macOS representations from 16 through 1024 pixels.
- `icon.ico`: Windows RGBA representations at 16, 24, 32, 48, 64, 128 and 256 pixels.

Regenerate on macOS using the system Swift/AppKit renderer and `iconutil`:

```bash
swift desktop/scripts/generate-icons.swift
```

The generator contains the colors and vector geometry in one place and writes all
four assets. An optional argument selects a different output directory for
reproducibility checks. No npm or Python image packages are required.

`AudioLines` is from Lucide; its ISC notice is retained in `LICENSE-icons.txt`.
