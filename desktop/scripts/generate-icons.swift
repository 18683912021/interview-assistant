#!/usr/bin/env swift
// Reproduce the existing .brand-mark + Lucide AudioLines app identity.
// macOS only; uses the system AppKit PNG encoder and iconutil, with no dependencies.
import AppKit
import Foundation

let fileManager = FileManager.default
let desktop = URL(fileURLWithPath: #filePath).standardizedFileURL.deletingLastPathComponent().deletingLastPathComponent()
let assets = CommandLine.arguments.count > 1
    ? URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
    : desktop.appendingPathComponent("assets")
try fileManager.createDirectory(at: assets, withIntermediateDirectories: true)

// Same proportions and colors as src/index.css: 29 px mark, 8 px corner radius,
// 19 px glyph, #292d3b background, white foreground. Transparent OS-icon padding.
let canvas: CGFloat = 1024
let inset: CGFloat = 64
let side = canvas - inset * 2
let radius = side * 8 / 29
let glyphSide = side * 19 / 29
let glyphOrigin = (canvas - glyphSide) / 2
let glyphScale = glyphSide / 24
let bars: [(x: CGFloat, y: CGFloat, height: CGFloat)] = [
    (2, 10, 3), (6, 6, 11), (10, 3, 18),
    (14, 8, 7), (18, 5, 13), (22, 10, 3),
]
let background = NSColor(srgbRed: 41 / 255, green: 45 / 255, blue: 59 / 255, alpha: 1)

func number(_ value: CGFloat) -> String {
    String(format: "%.6f", Double(value))
}

let paths = bars.map { "    <path d=\"M\(Int($0.x)) \(Int($0.y))v\(Int($0.height))\"/>" }.joined(separator: "\n")
let svg = """
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>面试助手</title>
  <!-- Existing app brand; AudioLines geometry copyright Lucide Icons and Contributors, ISC. -->
  <rect x="64" y="64" width="896" height="896" rx="\(number(radius))" fill="#292d3b"/>
  <g transform="translate(\(number(glyphOrigin)) \(number(glyphOrigin))) scale(\(number(glyphScale)))"
     fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
\(paths)
  </g>
</svg>

"""
try Data(svg.utf8).write(to: assets.appendingPathComponent("icon.svg"), options: .atomic)

func png(size: Int) throws -> Data {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
        let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw NSError(domain: "IconGenerator", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot create RGBA bitmap"])
    }
    bitmap.size = NSSize(width: size, height: size)
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSGraphicsContext.current = graphics
    let context = graphics.cgContext
    context.setAllowsAntialiasing(true)
    context.setShouldAntialias(true)
    context.clear(CGRect(x: 0, y: 0, width: size, height: size))
    // SVG origin is top-left; AppKit/Quartz bitmap origin is bottom-left.
    context.translateBy(x: 0, y: CGFloat(size))
    context.scaleBy(x: CGFloat(size) / canvas, y: -CGFloat(size) / canvas)
    context.setFillColor(background.cgColor)
    context.addPath(CGPath(roundedRect: CGRect(x: inset, y: inset, width: side, height: side),
        cornerWidth: radius, cornerHeight: radius, transform: nil))
    context.fillPath()
    context.translateBy(x: glyphOrigin, y: glyphOrigin)
    context.scaleBy(x: glyphScale, y: glyphScale)
    context.setStrokeColor(NSColor.white.cgColor)
    context.setLineWidth(2)
    context.setLineCap(.round)
    for bar in bars {
        context.move(to: CGPoint(x: bar.x, y: bar.y))
        context.addLine(to: CGPoint(x: bar.x, y: bar.y + bar.height))
        context.strokePath()
    }
    graphics.flushGraphics()
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "IconGenerator", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot encode PNG"])
    }
    return data
}

let temporary = fileManager.temporaryDirectory.appendingPathComponent("interview-icons-\(UUID().uuidString)")
let iconset = temporary.appendingPathComponent("icon.iconset")
try fileManager.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? fileManager.removeItem(at: temporary) }
let representations: [(String, Int)] = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
]
for (name, size) in representations {
    try png(size: size).write(to: iconset.appendingPathComponent(name), options: .atomic)
}
try png(size: 1024).write(to: assets.appendingPathComponent("icon.png"), options: .atomic)

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", assets.appendingPathComponent("icon.icns").path]
try iconutil.run()
iconutil.waitUntilExit()
guard iconutil.terminationStatus == 0 else {
    throw NSError(domain: "IconGenerator", code: 3, userInfo: [NSLocalizedDescriptionKey: "iconutil failed"])
}

// ICO supports PNG representations on supported Windows versions (Windows 10+).
// Each entry has its own vector-rendered RGBA image, avoiding resampling small icons.
func littleEndian<T: FixedWidthInteger>(_ value: T) -> Data {
    var little = value.littleEndian
    return withUnsafeBytes(of: &little) { Data($0) }
}
let sizes = [16, 24, 32, 48, 64, 128, 256]
let images = try sizes.map { try png(size: $0) }
var ico = littleEndian(UInt16(0)) + littleEndian(UInt16(1)) + littleEndian(UInt16(sizes.count))
var offset = UInt32(6 + sizes.count * 16)
for (size, image) in zip(sizes, images) {
    let dimension = size == 256 ? UInt8(0) : UInt8(size)
    ico.append(contentsOf: [dimension, dimension, 0, 0])
    ico.append(littleEndian(UInt16(1)))
    ico.append(littleEndian(UInt16(32)))
    ico.append(littleEndian(UInt32(image.count)))
    ico.append(littleEndian(offset))
    offset += UInt32(image.count)
}
for image in images { ico.append(image) }
try ico.write(to: assets.appendingPathComponent("icon.ico"), options: .atomic)
print("Generated icon.svg, icon.png, icon.icns, icon.ico in \(assets.path)")
