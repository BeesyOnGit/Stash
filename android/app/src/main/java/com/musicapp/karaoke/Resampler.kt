package com.musicapp.karaoke

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * Streaming stereo sample-rate converter: a Blackman-windowed sinc (32 taps)
 * read from a table of 512 phases, with its cut-off lowered below the new
 * Nyquist when converting down (48 → 44.1 kHz). Output positions are counted
 * exactly (k·from/to in integers), so long songs don't drift.
 */
class Resampler(private val from: Int, private val to: Int) {
  private val half = 16
  private val phases = 512
  private val table: Array<FloatArray>

  // Input history, with `half` zeros in front so the first outputs have their left taps.
  private var inL = FloatArray(1 shl 16)
  private var inR = FloatArray(1 shl 16)
  private var inCount = half
  /** Global input index of inL[0] (minus the leading zeros). */
  private var dropped = 0L
  private var totalIn = 0L
  private var produced = 0L

  init {
    val cutoff = min(1.0, to.toDouble() / from) * 0.97
    table = Array(phases + 1) { ph ->
      val frac = ph.toDouble() / phases
      val taps = FloatArray(2 * half)
      var sum = 0.0
      for (j in 0 until 2 * half) {
        val x = frac + half - 1 - j // distance from the output point to tap j
        val v = cutoff * sinc(cutoff * x) * blackman(x)
        taps[j] = v.toFloat()
        sum += v
      }
      // Unity gain at DC for every phase.
      for (j in taps.indices) taps[j] = (taps[j] / sum).toFloat()
      taps
    }
  }

  private fun sinc(x: Double) = if (abs(x) < 1e-9) 1.0 else sin(PI * x) / (PI * x)

  private fun blackman(x: Double): Double {
    if (abs(x) >= half) return 0.0
    val t = (x + half) / (2.0 * half) // 0..1
    return 0.42 - 0.5 * cos(2 * PI * t) + 0.08 * cos(4 * PI * t)
  }

  /** Adds `count` frames; converted frames are handed to `out` (which must copy them). */
  fun push(
    left: FloatArray,
    right: FloatArray,
    count: Int,
    out: (FloatArray, FloatArray, Int) -> Unit,
  ) {
    ensureRoom(count)
    System.arraycopy(left, 0, inL, inCount, count)
    System.arraycopy(right, 0, inR, inCount, count)
    inCount += count
    totalIn += count
    drain(false, out)
  }

  /** Call once at the end: the last frames, whose right taps fall past the input. */
  fun flush(out: (FloatArray, FloatArray, Int) -> Unit) {
    ensureRoom(half + 1)
    for (i in 0..half) {
      inL[inCount + i] = 0f
      inR[inCount + i] = 0f
    }
    drain(true, out)
  }

  private val outL = FloatArray(4096)
  private val outR = FloatArray(4096)

  private fun drain(final: Boolean, out: (FloatArray, FloatArray, Int) -> Unit) {
    val last = (totalIn * to + from - 1) / from // outputs in total, once the input is complete
    var n = 0
    while (true) {
      if (final && produced >= last) break
      val num = produced * from
      val idx = num / to // input sample at or before the output point
      // Needs inputs up to idx + half.
      if (!final && idx + half >= totalIn) break
      val frac = (num % to).toDouble() / to
      val taps = table[(frac * phases + 0.5).toInt()]
      // Array position of input idx - half + 1 (leading zeros offset by `half`).
      val base = (idx - half + 1 - dropped).toInt() + half
      var l = 0f
      var r = 0f
      for (j in 0 until 2 * half) {
        val w = taps[j]
        l += inL[base + j] * w
        r += inR[base + j] * w
      }
      outL[n] = l
      outR[n] = r
      n++
      produced++
      if (n == outL.size) {
        out(outL, outR, n)
        n = 0
      }
    }
    if (n > 0) out(outL, outR, n)
    compact()
  }

  /** Forgets inputs no future output reaches. */
  private fun compact() {
    val nextIdx = produced * from / to
    val keepFrom = nextIdx - half + 1 - dropped // array offset (without the zeros' shift) still needed
    val drop = (keepFrom).toInt()
    if (drop < 16384) return
    System.arraycopy(inL, drop, inL, 0, inCount - drop)
    System.arraycopy(inR, drop, inR, 0, inCount - drop)
    inCount -= drop
    dropped += drop
  }

  private fun ensureRoom(extra: Int) {
    if (inCount + extra <= inL.size) return
    val size = maxOf(inL.size * 2, inCount + extra)
    inL = inL.copyOf(size)
    inR = inR.copyOf(size)
  }
}
