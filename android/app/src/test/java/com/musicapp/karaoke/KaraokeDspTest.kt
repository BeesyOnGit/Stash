package com.musicapp.karaoke

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

/**
 * The karaoke DSP against numpy/torch: expected values come from UVR's own
 * pipeline (torch.stft/istft + demix) run on the same test signals.
 */
class KaraokeDspTest {

  @Test
  fun fftMatchesDirectDft() {
    for (n in intArrayOf(8, 12, 40, 5120)) {
      val fft = Fft(n)
      val re = FloatArray(n) { sin(0.37 * it * it).toFloat() }
      val im = FloatArray(n) { cos(1.3 * it).toFloat() * 0.5f }
      val r0 = re.copyOf()
      val i0 = im.copyOf()
      fft.forward(re, im)
      for (k in listOf(0, 1, n / 3, n / 2, n - 1)) {
        var sr = 0.0
        var si = 0.0
        for (j in 0 until n) {
          val a = -2 * PI * k.toLong() * j / n
          sr += r0[j] * cos(a) - i0[j] * sin(a)
          si += r0[j] * sin(a) + i0[j] * cos(a)
        }
        assertEquals("n=$n k=$k re", sr, re[k].toDouble(), 1e-3 * max(1.0, abs(sr)))
        assertEquals("n=$n k=$k im", si, im[k].toDouble(), 1e-3 * max(1.0, abs(si)))
      }
      fft.inverse(re, im)
      for (j in 0 until n) {
        assertEquals(r0[j], re[j], 1e-4f)
        assertEquals(i0[j], im[j], 1e-4f)
      }
    }
  }

  private fun stft() = MdxStft(5120, 1024, 2560, 256)

  @Test
  fun stftMatchesTorch() {
    val s = stft()
    val left = FloatArray(s.chunk) {
      (0.5 * sin(2 * PI * 440 * it / 44100) + 0.1 * cos(2 * PI * 3000 * it / 44100 + 0.3)).toFloat()
    }
    val right = FloatArray(s.chunk) {
      (0.3 * sin(2 * PI * 1000 * it / 44100 + 1) + 0.05 * sin(2 * PI * 7.7 * it + 0.2)).toFloat()
    }
    val spec = FloatArray(s.size)
    s.forward(left, right, spec)
    fun check(spec: FloatArray, c: Int, f: Int, t: Int, want: Float) {
      val got = spec[(c * 2560 + f) * 256 + t]
      assertEquals("c=$c f=$f t=$t", want, got, 0.02f + abs(want) * 1e-3f)
    }
    check(spec, 0, 51, 0, -53.873791f)
    check(spec, 1, 51, 100, -278.470062f)
    check(spec, 2, 116, 255, 367.266541f)
    check(spec, 3, 116, 37, 112.135582f)
    check(spec, 0, 348, 128, -120.518837f)
    check(spec, 1, 348, 200, 15.540039f)
    check(spec, 2, 894, 10, -0.000000f)
    check(spec, 3, 1500, 77, 0.000001f)
    check(spec, 0, 3, 5, 0.000409f)
  }

  @Test
  fun stftRoundTrip() {
    val s = stft()
    val left = FloatArray(s.chunk) { (0.4 * sin(2 * PI * 523.25 * it / 44100)).toFloat() }
    val right = FloatArray(s.chunk) { (0.2 * sin(2 * PI * 2000 * it / 44100) + 0.1 * sin(2 * PI * 8000 * it / 44100)).toFloat() }
    val spec = FloatArray(s.size)
    s.forward(left, right, spec)
    val l = FloatArray(s.chunk)
    val r = FloatArray(s.chunk)
    s.inverse(spec, l, r)
    // Everything below 3 bins (~26 Hz) and above 2560 bins (~22 kHz) is dropped; these tones are in
    // between. The edges (reflect padding) aren't exact, which is why demix trims them.
    for (i in 2560 until s.chunk - 2560 step 97) {
      assertEquals(left[i], l[i], 2e-3f)
      assertEquals(right[i], r[i], 2e-3f)
    }
  }

  @Test
  fun demixMatchesUvr() {
    val n = 600001
    val left = FloatArray(n) {
      (0.5 * sin(2 * PI * 440 * it / 44100) * sin(2 * PI * 0.5 * it / 44100) + 0.2 * sin(2 * PI * 5000 * it / 44100)).toFloat()
    }
    val right = FloatArray(n) {
      (0.3 * sin(2 * PI * 1000 * it / 44100 + 1) + 0.2 * sin(2 * PI * 9000 * it / 44100) * (if (it % 30000 < 15000) 1 else 0)).toFloat()
    }
    val s = stft()
    // A stand-in "model": keep the lowest 500 bins, turn the rest down to a quarter.
    val model = SpecModel { input, output ->
      for (c in 0 until 4) for (f in 0 until 2560) {
        val g = if (f < 500) 1f else 0.25f
        val base = (c * 2560 + f) * 256
        for (t in 0 until 256) output[base + t] = input[base + t] * g
      }
    }
    val outL = FloatArray(n)
    val outR = FloatArray(n)
    var at = 0
    val source = ArraySource(left, right, blocks = 12345)
    val written = VocalRemover(model, 5120, s).run(source, { l, r, off, count ->
      System.arraycopy(l, off, outL, at, count)
      System.arraycopy(r, off, outR, at, count)
      at += count
    })
    assertEquals(n.toLong(), written)
    fun check(outL: FloatArray, outR: FloatArray, i: Int, wantL: Float, wantR: Float) {
      assertEquals("L[$i]", wantL, outL[i], 1e-3f)
      assertEquals("R[$i]", wantR, outR[i], 1e-3f)
    }
    check(outL, outR, 0, 0.059814f, 0.205369f)
    check(outL, outR, 1000, 0.029392f, -0.233748f)
    check(outL, outR, 195000, -0.270513f, -0.142955f)
    check(outL, outR, 200000, 0.059024f, 0.281263f)
    check(outL, outR, 261119, -0.077859f, 0.296281f)
    check(outL, outR, 300000, 0.243880f, -0.222333f)
    check(outL, outR, 450000, -0.259418f, 0.233202f)
    check(outL, outR, 599999, -0.246726f, -0.114439f)
    check(outL, outR, 600000, -0.157901f, -0.122983f)
  }

  @Test
  fun resamplerKeepsToneAndLength() {
    val from = 48000
    val to = 44100
    val n = 48000 * 2
    val r = Resampler(from, to)
    val out = ArrayList<Float>()
    val block = 1000
    val l = FloatArray(block)
    val rr = FloatArray(block)
    var i = 0
    while (i < n) {
      for (j in 0 until block) {
        l[j] = (0.5 * sin(2 * PI * 1000 * (i + j) / from)).toFloat()
        rr[j] = l[j]
      }
      r.push(l, rr, block) { a, _, c -> for (k in 0 until c) out.add(a[k]) }
      i += block
    }
    r.flush { a, _, c -> for (k in 0 until c) out.add(a[k]) }
    assertEquals((n.toLong() * to + from - 1) / from, out.size.toLong())
    // Away from the edges it's the same 1 kHz tone at the new rate.
    var err = 0.0
    for (k in 1000 until out.size - 1000) {
      err = max(err, abs(out[k] - 0.5 * sin(2 * PI * 1000 * k / to)))
    }
    assert(err < 2e-3) { "max error $err" }
  }

  /** Arrays as a PcmSource, handed out in odd-sized reads like a decoder would. */
  private class ArraySource(val l: FloatArray, val r: FloatArray, val blocks: Int) : PcmSource {
    var pos = 0
    override fun read(left: FloatArray, right: FloatArray, offset: Int, count: Int): Int {
      val n = minOf(count, blocks, l.size - pos)
      System.arraycopy(l, pos, left, offset, n)
      System.arraycopy(r, pos, right, offset, n)
      pos += n
      return n
    }
  }
}
