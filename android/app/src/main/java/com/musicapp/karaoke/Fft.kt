package com.musicapp.karaoke

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * In-place complex FFT for sizes P·2^k with a small odd P (the vocal model's
 * 5120 = 5·1024): P radix-2 FFTs of the interleaved sub-sequences, then a
 * direct P-point combine per bin. Forward is e^(-2πi·kn/N), as in numpy/torch.
 * Not thread-safe (it keeps scratch buffers).
 */
class Fft(val n: Int) {
  private val p: Int
  private val m: Int

  init {
    var odd = n
    while (odd % 2 == 0) odd /= 2
    require(odd <= 15) { "FFT size $n: odd factor $odd is too large" }
    p = odd
    m = n / odd
  }

  private val bitrev = IntArray(m).also { rev ->
    val bits = Integer.numberOfTrailingZeros(m)
    for (i in 0 until m) rev[i] = if (bits == 0) 0 else Integer.reverse(i) ushr (32 - bits)
  }
  private val cosM = FloatArray(m / 2 + 1) { cos(2 * PI * it / m).toFloat() }
  private val sinM = FloatArray(m / 2 + 1) { sin(2 * PI * it / m).toFloat() }
  private val cosN = FloatArray(n) { cos(2 * PI * it / n).toFloat() }
  private val sinN = FloatArray(n) { sin(2 * PI * it / n).toFloat() }
  private val subRe = Array(p) { FloatArray(m) }
  private val subIm = Array(p) { FloatArray(m) }

  fun forward(re: FloatArray, im: FloatArray) {
    if (p == 1) {
      radix2(re, im)
      return
    }
    for (r in 0 until p) {
      val sr = subRe[r]
      val si = subIm[r]
      for (j in 0 until m) {
        sr[j] = re[j * p + r]
        si[j] = im[j * p + r]
      }
      radix2(sr, si)
    }
    // X[k] = Σ_r e^(-2πi·rk/N) · F_r[k mod m]
    for (k in 0 until n) {
      val km = k % m
      var xr = subRe[0][km]
      var xi = subIm[0][km]
      var e = 0
      for (r in 1 until p) {
        e += k
        if (e >= n) e -= n
        val c = cosN[e]
        val s = sinN[e]
        val a = subRe[r][km]
        val b = subIm[r][km]
        xr += a * c + b * s
        xi += b * c - a * s
      }
      re[k] = xr
      im[k] = xi
    }
  }

  /** Inverse, scaled by 1/N (so inverse(forward(x)) == x). */
  fun inverse(re: FloatArray, im: FloatArray) {
    for (i in 0 until n) im[i] = -im[i]
    forward(re, im)
    val scale = 1f / n
    for (i in 0 until n) {
      re[i] *= scale
      im[i] = -im[i] * scale
    }
  }

  private fun radix2(re: FloatArray, im: FloatArray) {
    for (i in 0 until m) {
      val j = bitrev[i]
      if (j > i) {
        val tr = re[i]; re[i] = re[j]; re[j] = tr
        val ti = im[i]; im[i] = im[j]; im[j] = ti
      }
    }
    var len = 2
    while (len <= m) {
      val half = len / 2
      val step = m / len
      var start = 0
      while (start < m) {
        var t = 0
        for (j in 0 until half) {
          val wr = cosM[t]
          val wi = -sinM[t]
          val a = start + j
          val b = a + half
          val xr = re[b] * wr - im[b] * wi
          val xi = re[b] * wi + im[b] * wr
          re[b] = re[a] - xr
          im[b] = im[a] - xi
          re[a] += xr
          im[a] += xi
          t += step
        }
        start += len
      }
      len *= 2
    }
  }
}
