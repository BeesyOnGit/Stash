package com.musicapp.karaoke

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.Closeable
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

private fun toShort(v: Float): Short {
  val x = if (v > 1f) 1f else if (v < -1f) -1f else v
  return (x * 32767f).toInt().toShort()
}

/**
 * Stereo float → AAC in an M4A, written as it comes (the encoder is drained
 * after every block, so nothing piles up in memory).
 */
class AacWriter(
  private val path: String,
  private val sampleRate: Int = AudioReader.SAMPLE_RATE,
  bitrate: Int = 192_000,
) : Closeable {
  private val encoder: MediaCodec
  private val muxer = MediaMuxer(path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
  private val info = MediaCodec.BufferInfo()
  private var track = -1
  private var muxing = false
  private var framesFed = 0L
  private var pending = ByteBuffer.allocate(256 * 1024).order(ByteOrder.nativeOrder())
  private var finished = false
  /** The encoder has handed back its end-of-stream (possibly while still pumping input). */
  private var outputDone = false
  private var closed = false

  init {
    val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, 2).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
    }
    encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    encoder.start()
  }

  fun write(left: FloatArray, right: FloatArray, offset: Int, count: Int) {
    if (pending.remaining() < count * 4) {
      val next = ByteBuffer.allocate(maxOf(pending.capacity() * 2, pending.position() + count * 4))
        .order(ByteOrder.nativeOrder())
      pending.flip()
      next.put(pending)
      pending = next
    }
    for (i in offset until offset + count) {
      pending.putShort(toShort(left[i]))
      pending.putShort(toShort(right[i]))
    }
    pump(false)
  }

  /** Encodes what's left and closes the file. */
  fun finish() {
    pump(true)
    finished = true
    close()
  }

  private fun pump(end: Boolean) {
    pending.flip()
    var eosSent = false
    while (pending.hasRemaining() || (end && !eosSent)) {
      val i = encoder.dequeueInputBuffer(10_000)
      if (i >= 0) {
        val buf = encoder.getInputBuffer(i)!!
        buf.clear()
        val n = minOf(buf.remaining() - buf.remaining() % 4, pending.remaining())
        val pts = framesFed * 1_000_000L / sampleRate
        if (n > 0) {
          val slice = pending.duplicate()
          slice.limit(pending.position() + n)
          buf.put(slice)
          pending.position(pending.position() + n)
          encoder.queueInputBuffer(i, 0, n, pts, 0)
          framesFed += n / 4
        } else if (end) {
          encoder.queueInputBuffer(i, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
          eosSent = true
        }
      }
      drain(false)
    }
    pending.compact()
    if (end) drain(true)
  }

  private fun drain(untilEnd: Boolean) {
    while (!outputDone) {
      val o = encoder.dequeueOutputBuffer(info, if (untilEnd) 10_000 else 0)
      when {
        o == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!untilEnd) return
        o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          track = muxer.addTrack(encoder.outputFormat)
          muxer.start()
          muxing = true
        }
        o >= 0 -> {
          val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (info.size > 0 && !config && muxing) {
            muxer.writeSampleData(track, encoder.getOutputBuffer(o)!!, info)
          }
          encoder.releaseOutputBuffer(o, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
        }
      }
    }
  }

  /** Without finish() (cancelled or failed), the partial file is deleted. */
  override fun close() {
    if (closed) return
    closed = true
    runCatching { encoder.stop() }
    runCatching { encoder.release() }
    runCatching { if (muxing) muxer.stop() }
    runCatching { muxer.release() }
    if (!finished || !muxing) File(path).delete()
  }
}

/** A 16-bit stereo 44.1 kHz WAV of one block (the pieces played while a song is being prepared). */
fun writeWav(path: String, left: FloatArray, right: FloatArray, offset: Int, count: Int) {
  val data = ByteBuffer.allocate(44 + count * 4).order(ByteOrder.LITTLE_ENDIAN)
  val rate = AudioReader.SAMPLE_RATE
  data.put("RIFF".toByteArray()).putInt(36 + count * 4).put("WAVE".toByteArray())
  data.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(2)
    .putInt(rate).putInt(rate * 4).putShort(4).putShort(16)
  data.put("data".toByteArray()).putInt(count * 4)
  for (i in offset until offset + count) {
    data.putShort(toShort(left[i]))
    data.putShort(toShort(right[i]))
  }
  val tmp = File("$path.part")
  RandomAccessFile(tmp, "rw").use { it.setLength(0); it.write(data.array()) }
  tmp.renameTo(File(path))
}
