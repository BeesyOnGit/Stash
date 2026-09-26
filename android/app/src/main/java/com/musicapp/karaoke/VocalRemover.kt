package com.musicapp.karaoke

import kotlin.math.PI
import kotlin.math.cos

/** Runs the network: spectrogram in, instrumental spectrogram out (both MdxStft.size). */
fun interface SpecModel {
  fun run(input: FloatArray, output: FloatArray)
}

/**
 * Removes the vocals from a song with an MDX-Net model, the way UVR
 * (Ultimate Vocal Remover) does it, but as a stream: the song is read a model
 * chunk at a time (~6 s), overlapping chunks are cross-faded with a Hann
 * window, and every stretch that no later chunk touches is handed out at once,
 * so it can be played while the rest is still being worked on.
 *
 * Mirrors UVR's demix(): `trim` zeros in front, chunks every 75% of a chunk,
 * the song padded at the end to a whole number of generated blocks.
 */
class VocalRemover(
  private val model: SpecModel,
  nFft: Int,
  private val stft: MdxStft,
  overlap: Double = 0.25,
) {
  private val trim = nFft / 2
  private val chunk = stft.chunk
  private val gen = chunk - 2 * trim
  private val step = ((1 - overlap) * chunk).toInt()

  /**
   * Reads `source` to the end, calling `sink` with the instrumental in order
   * (from the song's first sample). `cancelled` is checked between chunks.
   * Returns the number of frames written.
   */
  fun run(
    source: PcmSource,
    sink: (left: FloatArray, right: FloatArray, offset: Int, count: Int) -> Unit,
    cancelled: () -> Boolean = { false },
  ): Long {
    // The current chunk of the padded song: [pos, pos + chunk).
    val mixL = FloatArray(chunk)
    val mixR = FloatArray(chunk)
    val accL = FloatArray(chunk)
    val accR = FloatArray(chunk)
    val weight = FloatArray(chunk)
    val outL = FloatArray(chunk)
    val outR = FloatArray(chunk)
    val spec = FloatArray(stft.size)
    val pred = FloatArray(stft.size)
    val fullWindow = hanning(chunk)

    var songFrames = -1L // known at the end of the input
    var read = 0L // song frames read so far
    var written = 0L
    var pos = 0L // padded position of the current chunk
    var filled = 0 // valid frames at the start of mix*

    // The padded song starts with `trim` zeros.
    filled = trim

    while (true) {
      if (cancelled()) throw InterruptedException("cancelled")
      // Fill the chunk: song frames, then zeros once it's over.
      while (filled < chunk) {
        val n = if (songFrames < 0) source.read(mixL, mixR, filled, chunk - filled) else 0
        if (n == 0) {
          if (songFrames < 0) songFrames = read
          mixL.fill(0f, filled, chunk)
          mixR.fill(0f, filled, chunk)
          filled = chunk
        } else {
          filled += n
          read += n
        }
      }
      val padded = if (songFrames >= 0) trim + songFrames + (gen + trim - songFrames % gen) else Long.MAX_VALUE
      val actual = minOf(chunk.toLong(), padded - pos).toInt()
      val window = if (actual == chunk) fullWindow else hanning(actual)

      stft.forward(mixL, mixR, spec)
      model.run(spec, pred)
      stft.inverse(pred, outL, outR)
      for (i in 0 until actual) {
        val w = window[i]
        accL[i] += outL[i] * w
        accR[i] += outR[i] * w
        weight[i] += w
      }

      val last = pos + step >= padded
      val done = if (last) actual else step
      // Finished stretch [pos, pos + done) → song frames [pos - trim, …).
      var from = 0
      var to = done
      if (pos < trim) from = (trim - pos).toInt()
      if (songFrames >= 0) to = minOf(to.toLong(), trim + songFrames - pos).toInt()
      if (to > from) {
        for (i in from until to) {
          val w = weight[i]
          outL[i] = if (w > 1e-8f) accL[i] / w else 0f
          outR[i] = if (w > 1e-8f) accR[i] / w else 0f
        }
        sink(outL, outR, from, to - from)
        written += to - from
      }
      if (last) return written

      // Slide everything by one step.
      val keep = chunk - step
      System.arraycopy(mixL, step, mixL, 0, keep)
      System.arraycopy(mixR, step, mixR, 0, keep)
      System.arraycopy(accL, step, accL, 0, keep)
      System.arraycopy(accR, step, accR, 0, keep)
      System.arraycopy(weight, step, weight, 0, keep)
      accL.fill(0f, keep, chunk)
      accR.fill(0f, keep, chunk)
      weight.fill(0f, keep, chunk)
      filled = keep
      pos += step
    }
  }

  companion object {
    /** numpy.hanning: symmetric, zero at both ends. */
    fun hanning(n: Int) = FloatArray(n) {
      if (n == 1) 1f else (0.5 - 0.5 * cos(2 * PI * it / (n - 1))).toFloat()
    }
  }
}
