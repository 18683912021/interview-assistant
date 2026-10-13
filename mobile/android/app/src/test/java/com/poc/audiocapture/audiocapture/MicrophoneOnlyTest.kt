package com.poc.audiocapture.audiocapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MicrophoneOnlyTest {
  @Test fun allowsOnlyMicrophoneAtNativeBoundary() {
    assertEquals(CaptureSource.MIC, CaptureSource.fromWireName("mic"))
    assertThrows(CaptureException::class.java) { CaptureSource.fromWireName("system") }
    assertThrows(CaptureException::class.java) { CaptureSource.fromWireName("both") }
  }
}
