package com.musicapp.karaoke

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.Closeable
import java.nio.ByteOrder

/** Stereo float audio, read a block at a time. */
interface PcmSource {
  /** Fills up to `count` frames from `offset`; fewer only at the end (0 = finished). */
  fun read(left: FloatArray, right: FloatArray, offset: Int, count: Int): Int
}

/**
 * Decodes an audio file with the phone's codecs as 44.1 kHz stereo float,
 * pulled as it's needed (nothing is decoded ahead into memory). Mono is
 * doubled to both sides; for more than two channels the front pair is kept.
 */
class AudioReader(path: String) : PcmSource, Closeable {
  private val extractor = MediaExtractor()
  private lateinit var decoder: MediaCodec
  /** Length from the file's header (0 if unknown). */
  var durationUs = 0L
    private set

  private var channels = 0
  private var floatPcm = false
  private var resampler: Resampler? = null
  private var sourceRate = 0
  private var inputDone = false
  private var outputDone = false
  private val info = MediaCodec.BufferInfo()

  // Converted frames waiting to be read.
  private var fifoL = FloatArray(1 shl 16)
  private var fifoR = FloatArray(1 shl 16)
  private var fifoStart = 0
  private var fifoEnd = 0
  private var blockL = FloatArray(0)
  private var blockR = FloatArray(0)

  init {
    try {
      extractor.setDataSource(path)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: throw IllegalArgumentException("No audio track in $path")
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
      sourceRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
      decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      decoder.configure(format, null, null, 0)
      decoder.start()
    } catch (e: Exception) {
      extractor.release()
      throw e
    }
  }

  override fun read(left: FloatArray, right: FloatArray, offset: Int, count: Int): Int {
    var got = 0
    while (got < count) {
      if (fifoEnd == fifoStart) {
        if (outputDone) break
        step()
        continue
      }
      val n = minOf(count - got, fifoEnd - fifoStart)
      System.arraycopy(fifoL, fifoStart, left, offset + got, n)
      System.arraycopy(fifoR, fifoStart, right, offset + got, n)
      fifoStart += n
      got += n
    }
    return got
  }

  /** One round of the decoder: feed a compressed sample, collect decoded PCM. */
  private fun step() {
    if (!inputDone) {
      val i = decoder.dequeueInputBuffer(5_000)
      if (i >= 0) {
        val size = extractor.readSampleData(decoder.getInputBuffer(i)!!, 0)
        if (size < 0) {
          decoder.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
          inputDone = true
        } else {
          decoder.queueInputBuffer(i, 0, size, extractor.sampleTime, 0)
          extractor.advance()
        }
      }
    }
    val o = decoder.dequeueOutputBuffer(info, 5_000)
    when {
      o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
        val f = decoder.outputFormat
        sourceRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        floatPcm = f.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
          f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
      }
      o >= 0 -> {
        if (info.size > 0) {
          val buf = decoder.getOutputBuffer(o)!!
          buf.position(info.offset)
          buf.limit(info.offset + info.size)
          buf.order(ByteOrder.nativeOrder())
          val frames = info.size / ((if (floatPcm) 4 else 2) * channels)
          if (blockL.size < frames) {
            blockL = FloatArray(frames)
            blockR = FloatArray(frames)
          }
          if (floatPcm) {
            val fb = buf.asFloatBuffer()
            for (f in 0 until frames) {
              val l = fb.get(f * channels)
              blockL[f] = l
              blockR[f] = if (channels > 1) fb.get(f * channels + 1) else l
            }
          } else {
            val sb = buf.asShortBuffer()
            for (f in 0 until frames) {
              val l = sb.get(f * channels) / 32768f
              blockL[f] = l
              blockR[f] = if (channels > 1) sb.get(f * channels + 1) / 32768f else l
            }
          }
          emit(frames)
        }
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
          outputDone = true
          resampler?.flush(::append)
        }
        decoder.releaseOutputBuffer(o, false)
      }
    }
  }

  private fun emit(frames: Int) {
    if (sourceRate == SAMPLE_RATE) {
      append(blockL, blockR, frames)
      return
    }
    val r = resampler ?: Resampler(sourceRate, SAMPLE_RATE).also { resampler = it }
    r.push(blockL, blockR, frames, ::append)
  }

  private fun append(l: FloatArray, r: FloatArray, n: Int) {
    if (fifoEnd + n > fifoL.size) {
      val live = fifoEnd - fifoStart
      if (live + n > fifoL.size) {
        val size = maxOf(fifoL.size * 2, live + n)
        fifoL = FloatArray(size).also { System.arraycopy(fifoL, fifoStart, it, 0, live) }
        fifoR = FloatArray(size).also { System.arraycopy(fifoR, fifoStart, it, 0, live) }
      } else {
        System.arraycopy(fifoL, fifoStart, fifoL, 0, live)
        System.arraycopy(fifoR, fifoStart, fifoR, 0, live)
      }
      fifoStart = 0
      fifoEnd = live
    }
    System.arraycopy(l, 0, fifoL, fifoEnd, n)
    System.arraycopy(r, 0, fifoR, fifoEnd, n)
    fifoEnd += n
  }

  override fun close() {
    runCatching { decoder.stop() }
    runCatching { decoder.release() }
    extractor.release()
  }

  companion object {
    /** What the vocal model is trained on, and what karaoke files are made at. */
    const val SAMPLE_RATE = 44100
  }
}
