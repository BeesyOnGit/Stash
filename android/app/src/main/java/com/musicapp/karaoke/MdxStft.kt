package com.musicapp.karaoke

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min

/**
 * The spectrogram MDX-Net models read and write: torch.stft / torch.istft with
 * a periodic Hann window, center=True (reflect padding), no normalisation,
 * cut to the model's `dimF` lowest bins. Laid out as the model's
 * [4, dimF, dimT] tensor: left real, left imaginary, right real, right imaginary.
 *
 * Both channels go through one complex FFT (left + i·right) and are pulled
 * apart by symmetry, which halves the work.
 */
class MdxStft(val nFft: Int, val hop: Int, val dimF: Int, val dimT: Int) {
  /** Samples per channel in one model input. */
  val chunk = hop * (dimT - 1)
  val size = 4 * dimF * dimT

  private val pad = nFft / 2
  private val bins = min(dimF, nFft / 2 + 1)
  private val window = FloatArray(nFft) { (0.5 - 0.5 * cos(2 * PI * it / nFft)).toFloat() }
  private val fft = Fft(nFft)
  private val re = FloatArray(nFft)
  private val im = FloatArray(nFft)
  private val paddedL = FloatArray(chunk + nFft)
  private val paddedR = FloatArray(chunk + nFft)
  private val olaL = FloatArray(chunk + nFft)
  private val olaR = FloatArray(chunk + nFft)
  /** Σ window² under each output sample, what istft divides by. */
  private val envelope = FloatArray(chunk + nFft).also { env ->
    for (t in 0 until dimT) for (i in 0 until nFft) env[t * hop + i] += window[i] * window[i]
  }

  init {
    require(chunk > pad) { "chunk too short for the FFT size" }
  }

  /** `chunk` samples per channel → `spec` ([size]); the 3 lowest bins zeroed, as UVR does. */
  fun forward(left: FloatArray, right: FloatArray, spec: FloatArray) {
    reflectPad(left, paddedL)
    reflectPad(right, paddedR)
    val plane = dimF * dimT
    for (t in 0 until dimT) {
      val off = t * hop
      for (i in 0 until nFft) {
        re[i] = paddedL[off + i] * window[i]
        im[i] = paddedR[off + i] * window[i]
      }
      fft.forward(re, im)
      for (k in 0 until dimF) {
        val at = k * dimT + t
        if (k < 3 || k >= bins) {
          spec[at] = 0f
          spec[plane + at] = 0f
          spec[2 * plane + at] = 0f
          spec[3 * plane + at] = 0f
          continue
        }
        val kk = if (k == 0) 0 else nFft - k
        val a = re[k]
        val b = im[k]
        val c = re[kk]
        val d = im[kk]
        spec[at] = (a + c) * 0.5f // left real
        spec[plane + at] = (b - d) * 0.5f // left imaginary
        spec[2 * plane + at] = (b + d) * 0.5f // right real
        spec[3 * plane + at] = (c - a) * 0.5f // right imaginary
      }
    }
  }

  /** `spec` ([size]) → `chunk` samples per channel. */
  fun inverse(spec: FloatArray, left: FloatArray, right: FloatArray) {
    olaL.fill(0f)
    olaR.fill(0f)
    val plane = dimF * dimT
    val nyquist = nFft / 2
    for (t in 0 until dimT) {
      re.fill(0f)
      im.fill(0f)
      for (k in 0 until bins) {
        val at = k * dimT + t
        val lr = spec[at]
        val rr = spec[2 * plane + at]
        // A real signal's DC and Nyquist bins are real; irfft ignores their imaginary parts.
        val edge = k == 0 || k == nyquist
        val li = if (edge) 0f else spec[plane + at]
        val ri = if (edge) 0f else spec[3 * plane + at]
        // Z[k] = L + iR; Z[N-k] = conj(L) + i·conj(R).
        re[k] = lr - ri
        im[k] = li + rr
        if (!edge) {
          re[nFft - k] = lr + ri
          im[nFft - k] = rr - li
        }
      }
      fft.inverse(re, im)
      val off = t * hop
      for (i in 0 until nFft) {
        olaL[off + i] += re[i] * window[i]
        olaR[off + i] += im[i] * window[i]
      }
    }
    for (i in 0 until chunk) {
      val e = envelope[pad + i]
      left[i] = olaL[pad + i] / e
      right[i] = olaR[pad + i] / e
    }
  }

  /** torch's reflect padding: `pad` mirrored samples each side, the edge sample not repeated. */
  private fun reflectPad(x: FloatArray, out: FloatArray) {
    System.arraycopy(x, 0, out, pad, chunk)
    for (j in 0 until pad) {
      out[j] = x[pad - j]
      out[pad + chunk + j] = x[chunk - 2 - j]
    }
  }
}
