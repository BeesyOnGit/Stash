package com.musicapp.audio

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File

/**
 * Re-encodes a downloaded song to AAC in an M4A file with the phone's own codecs
 * (MediaExtractor → decoder → AAC encoder → MediaMuxer). Used for YouTube's Opus
 * (WebM) and Ogg fallbacks, so every download is a plain M4A that plays anywhere
 * and that the waveform decoder can read.
 */
object AudioConverter {
  private const val AAC = MediaFormat.MIMETYPE_AUDIO_AAC
  /** Opus/Vorbis sources are ~128–160 kbps; 192 kbps AAC keeps the loss inaudible. */
  private const val BITRATE = 192_000
  /** Poll without blocking; only wait (briefly) when a whole round made no progress. */
  private const val TIMEOUT_US = 0L

  fun toM4a(input: String, output: String) {
    val extractor = MediaExtractor()
    var decoder: MediaCodec? = null
    var encoder: MediaCodec? = null
    var muxer: MediaMuxer? = null
    var muxing = false
    try {
      extractor.setDataSource(input)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: throw IllegalArgumentException("No audio track in $input")
      extractor.selectTrack(track)
      val inFormat = extractor.getTrackFormat(track)
      inFormat.setInteger(MediaFormat.KEY_PCM_ENCODING, android.media.AudioFormat.ENCODING_PCM_16BIT)

      decoder = MediaCodec.createDecoderByType(inFormat.getString(MediaFormat.KEY_MIME)!!)
      decoder.configure(inFormat, null, null, 0)
      decoder.start()
      muxer = MediaMuxer(output, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

      val pcm = PcmQueue()
      val info = MediaCodec.BufferInfo()
      var sampleRate = 0
      var channels = 0
      var framesFed = 0L
      var muxTrack = -1
      var extractorDone = false
      var decoderDone = false
      var encoderInputDone = false
      var encoderDone = false

      while (!encoderDone) {
        var moved = false
        // 1. Compressed samples → decoder.
        if (!extractorDone) {
          val i = decoder.dequeueInputBuffer(TIMEOUT_US)
          if (i >= 0) {
            moved = true
            val size = extractor.readSampleData(decoder.getInputBuffer(i)!!, 0)
            if (size < 0) {
              decoder.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              extractorDone = true
            } else {
              decoder.queueInputBuffer(i, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }

        // 2. Decoder → PCM (the encoder is set up once the real PCM format is known).
        if (!decoderDone) {
          val o = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
          if (o >= 0 || o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) moved = true
          when {
            o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
              val f = decoder.outputFormat
              sampleRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
              channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
              encoder = createEncoder(sampleRate, channels)
            }
            o >= 0 -> {
              if (info.size > 0) {
                val buf = decoder.getOutputBuffer(o)!!
                buf.position(info.offset)
                buf.limit(info.offset + info.size)
                pcm.write(buf)
              }
              if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) decoderDone = true
              decoder.releaseOutputBuffer(o, false)
            }
          }
        }

        val enc = encoder
        if (enc == null) {
          if (!moved) Thread.sleep(1)
          continue
        }

        // 3. PCM → encoder, with timestamps counted from the samples fed.
        if (!encoderInputDone && (pcm.size > 0 || decoderDone)) {
          val i = enc.dequeueInputBuffer(TIMEOUT_US)
          if (i >= 0) {
            moved = true
            val buf = enc.getInputBuffer(i)!!
            buf.clear()
            val n = pcm.read(buf, buf.capacity() - buf.capacity() % (2 * channels))
            val pts = framesFed * 1_000_000L / sampleRate
            if (n > 0) {
              enc.queueInputBuffer(i, 0, n, pts, 0)
              framesFed += n / (2 * channels)
            } else {
              enc.queueInputBuffer(i, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              encoderInputDone = true
            }
          }
        }

        // 4. Encoder → M4A.
        val o = enc.dequeueOutputBuffer(info, TIMEOUT_US)
        if (o >= 0 || o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) moved = true
        when {
          o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            muxTrack = muxer.addTrack(enc.outputFormat)
            muxer.start()
            muxing = true
          }
          o >= 0 -> {
            val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
            if (info.size > 0 && !config && muxing) {
              muxer.writeSampleData(muxTrack, enc.getOutputBuffer(o)!!, info)
            }
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) encoderDone = true
            enc.releaseOutputBuffer(o, false)
          }
        }
        if (!moved) Thread.sleep(1)
      }
      if (!muxing) throw IllegalStateException("Nothing was encoded")
    } catch (e: Exception) {
      File(output).delete()
      throw e
    } finally {
      runCatching { decoder?.stop() }
      runCatching { decoder?.release() }
      runCatching { encoder?.stop() }
      runCatching { encoder?.release() }
      runCatching { if (muxing) muxer?.stop() }
      runCatching { muxer?.release() }
      extractor.release()
    }
  }

  private fun createEncoder(sampleRate: Int, channels: Int): MediaCodec {
    val format = MediaFormat.createAudioFormat(AAC, sampleRate, channels).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
    }
    return MediaCodec.createEncoderByType(AAC).apply {
      configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      start()
    }
  }

  /** Decoded PCM waiting for room in the encoder (the two use different buffer sizes). */
  private class PcmQueue {
    private var data = ByteArray(256 * 1024)
    private var start = 0
    private var end = 0
    val size get() = end - start

    fun write(src: java.nio.ByteBuffer) {
      val n = src.remaining()
      if (end + n > data.size) {
        // Compact, and grow if still short.
        val live = size
        val next = if (live + n > data.size) ByteArray(maxOf(data.size * 2, live + n)) else data
        System.arraycopy(data, start, next, 0, live)
        data = next
        start = 0
        end = live
      }
      src.get(data, end, n)
      end += n
    }

    fun read(dst: java.nio.ByteBuffer, max: Int): Int {
      val n = minOf(max, size)
      dst.put(data, start, n)
      start += n
      if (start == end) {
        start = 0
        end = 0
      }
      return n
    }
  }
}
