package com.poc.audiocapture.audiocapture

class PcmFrameAccumulator(
    private val frameSize: Int = PcmNormalizer.OUTPUT_FORMAT.frameBytes40Ms,
) {
  private var buffer = ByteArray(frameSize * 2)
  private var size = 0

  fun append(bytes: ByteArray, onFrame: (ByteArray, Boolean) -> Unit) {
    var sourceOffset = 0
    while (sourceOffset < bytes.size) {
      ensureCapacity(size + bytes.size - sourceOffset)
      val copyCount = minOf(frameSize - size, bytes.size - sourceOffset)
      bytes.copyInto(buffer, destinationOffset = size, startIndex = sourceOffset, endIndex = sourceOffset + copyCount)
      size += copyCount
      sourceOffset += copyCount

      if (size == frameSize) {
        onFrame(buffer.copyOf(frameSize), false)
        size = 0
      }
    }
  }

  fun flush(onFrame: (ByteArray, Boolean) -> Unit) {
    if (size > 0) {
      onFrame(buffer.copyOf(size), true)
      size = 0
    }
  }

  private fun ensureCapacity(required: Int) {
    if (required <= buffer.size) return
    buffer = buffer.copyOf(maxOf(required, buffer.size * 2))
  }
}
