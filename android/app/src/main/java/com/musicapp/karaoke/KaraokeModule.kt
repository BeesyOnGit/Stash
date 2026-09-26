package com.musicapp.karaoke

import ai.onnxruntime.OnnxTensor
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import androidx.core.content.FileProvider
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.tanh

/** Hands saved recordings to other apps (share). */
class KaraokeFileProvider : FileProvider()

/**
 * Karaoke, native side (JS: src/services/karaoke.ts).
 *
 * - separate(): the instrumental of a song, made by the vocal-removal model
 *   (UVR-MDX-NET Inst HQ 4, downloaded on first use) and streamed to JS as
 *   short WAV pieces while the full M4A is written.
 * - mix(): the instrumental and a recorded voice → one M4A.
 */
class KaraokeModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  override fun getName() = NAME

  @Volatile private var cancelledJob: String? = null
  @Volatile private var runningJob: String? = null
  @Volatile private var runOptions: OrtSession.RunOptions? = null

  /**
   * Makes `output` (M4A) from `input`, one chunk at a time; each finished piece
   * is also written to `pieceDir` and announced as a "piece" event. Resolves
   * with the length in seconds. One job at a time: a new one waits.
   */
  @ReactMethod
  fun separate(job: String, input: String, output: String, pieceDir: String, modelPath: String, promise: Promise) {
    worker.execute {
      if (cancelledJob == job) {
        promise.reject("cancelled", "cancelled")
        return@execute
      }
      runningJob = job
      val part = "${output.removePrefix("file://")}.part"
      try {
        val session = session(modelPath.removePrefix("file://"))
        val dir = File(pieceDir.removePrefix("file://")).apply { deleteRecursively(); mkdirs() }
        val options = OrtSession.RunOptions().also { runOptions = it }
        val model = OrtModel(session, options)
        val stft = MdxStft(N_FFT, HOP, model.dimF, model.dimT)
        val remover = VocalRemover(model, N_FFT, stft)
        AudioReader(input.removePrefix("file://")).use { reader ->
          val total = reader.durationUs / 1e6
          AacWriter(part).use { writer ->
            var frames = 0L
            var piece = 0
            val started = System.nanoTime()
            val written = remover.run(
              reader,
              sink = { l, r, off, n ->
                writer.write(l, r, off, n)
                val path = File(dir, "piece_%04d.wav".format(piece)).path
                writeWav(path, l, r, off, n)
                val start = frames
                frames += n
                val elapsed = (System.nanoTime() - started) / 1e9
                emit(Arguments.createMap().apply {
                  putString("job", job)
                  putString("type", "piece")
                  putString("path", path)
                  putInt("index", piece)
                  putDouble("start", start / RATE)
                  putDouble("duration", n / RATE)
                  putDouble("done", frames / RATE)
                  putDouble("total", total)
                  putDouble("elapsed", elapsed)
                })
                piece++
              },
              cancelled = { cancelledJob == job },
            )
            writer.finish()
            val target = File(output.removePrefix("file://"))
            target.delete()
            if (!File(part).renameTo(target)) throw IllegalStateException("Couldn't save $target")
            promise.resolve(written / RATE)
          }
        }
      } catch (e: Throwable) {
        File(part).delete()
        if (cancelledJob == job) promise.reject("cancelled", "cancelled")
        else promise.reject("separate_failed", e.message ?: e.toString(), e)
      } finally {
        runOptions?.close()
        runOptions = null
        runningJob = null
        if (cancelledJob == job) cancelledJob = null
      }
    }
  }

  /** Stops a job (queued or running), as soon as the model's current step allows. */
  @ReactMethod
  fun cancel(job: String) {
    cancelledJob = job
    if (runningJob == job) runCatching { runOptions?.setTerminate(true) }
  }

  /** Stops whatever job is running (one started before JS was reloaded, which nothing follows any more). */
  @ReactMethod
  fun cancelRunning() {
    runningJob?.let { cancel(it) }
  }

  /** Frees the model (its weights and working memory) once karaoke is closed. */
  @ReactMethod
  fun release() {
    worker.execute {
      loaded?.close()
      loaded = null
      loadedPath = null
    }
  }

  /**
   * The instrumental with the voice on top → `output` (M4A). The first
   * `voiceOffsetMs` of the recording are skipped (negative: the voice is
   * delayed), which lines it up with the music. Ends with the recording.
   */
  @ReactMethod
  fun mix(
    instrumental: String,
    voice: String,
    output: String,
    voiceOffsetMs: Double,
    voiceGain: Double,
    musicGain: Double,
    promise: Promise,
  ) {
    mixer.execute {
      val out = output.removePrefix("file://")
      try {
        AudioReader(instrumental.removePrefix("file://")).use { music ->
          AudioReader(voice.removePrefix("file://")).use { mic ->
            AacWriter(out).use { writer ->
              val block = 8192
              val mL = FloatArray(block); val mR = FloatArray(block)
              val vL = FloatArray(block); val vR = FloatArray(block)
              val offset = (voiceOffsetMs / 1000 * RATE).toLong()
              // Skip the start of the recording, or delay it with silence.
              var skip = offset
              while (skip > 0) {
                val n = mic.read(vL, vR, 0, minOf(block.toLong(), skip).toInt())
                if (n == 0) break
                skip -= n
              }
              var silence = if (offset < 0) -offset else 0L
              var voiceOver = false
              var total = 0L
              while (true) {
                val n = music.read(mL, mR, 0, block)
                if (n == 0) break
                var v = 0
                if (silence > 0) {
                  v = minOf(n.toLong(), silence).toInt()
                  vL.fill(0f, 0, v); vR.fill(0f, 0, v)
                  silence -= v
                }
                if (v < n && !voiceOver) {
                  val got = mic.read(vL, vR, v, n - v)
                  if (got < n - v) voiceOver = true
                  vL.fill(0f, v + got, n); vR.fill(0f, v + got, n)
                  v += got
                } else if (v < n) {
                  vL.fill(0f, v, n); vR.fill(0f, v, n)
                }
                for (i in 0 until n) {
                  mL[i] = limit(mL[i] * musicGain.toFloat() + vL[i] * voiceGain.toFloat())
                  mR[i] = limit(mR[i] * musicGain.toFloat() + vR[i] * voiceGain.toFloat())
                }
                // The recording is over (and the silence before it): stop here.
                val keep = if (voiceOver && silence == 0L) v else n
                writer.write(mL, mR, 0, keep)
                total += keep
                if (keep < n) break
              }
              writer.finish()
              promise.resolve(total / RATE)
            }
          }
        }
      } catch (e: Throwable) {
        File(out).delete()
        promise.reject("mix_failed", e.message ?: e.toString(), e)
      }
    }
  }

  /** Soft ceiling instead of hard clipping when voice and music add up past full scale. */
  private fun limit(x: Float): Float {
    val a = abs(x)
    if (a <= KNEE) return x
    val y = KNEE + (1 - KNEE) * tanh((a - KNEE) / (1 - KNEE))
    return if (x < 0) -y else y
  }

  /**
   * Opens the phone's file manager in the folder holding `path` (a public
   * folder like Music/Karaoke): Samsung's My Files, else Android's Files app.
   * Resolves false if no app would open it.
   */
  @ReactMethod
  fun openFolder(path: String, promise: Promise) {
    val file = File(path.removePrefix("file://"))
    val dir = if (file.isDirectory) file else file.parentFile
    val root = Environment.getExternalStorageDirectory().path
    if (dir == null || !dir.path.startsWith(root)) {
      promise.resolve(false)
      return
    }
    val relative = dir.path.removePrefix(root).trimStart('/')
    val attempts = listOf(
      Intent("samsung.myfiles.intent.action.LAUNCH_MY_FILES")
        .putExtra("samsung.myfiles.intent.extra.START_PATH", dir.path),
      Intent(Intent.ACTION_VIEW).setDataAndType(
        DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:$relative"),
        DocumentsContract.Document.MIME_TYPE_DIR,
      ).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
      Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(dir.path), "resource/folder"),
    )
    val context = reactApplicationContext
    for (intent in attempts) {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      // Tried rather than looked up: Android 11+ hides other apps from
      // resolveActivity() unless they're declared, and a miss just throws.
      if (runCatching { context.startActivity(intent) }.isSuccess) {
        promise.resolve(true)
        return
      }
    }
    promise.resolve(false)
  }

  /** The system share sheet for one recording (send it, save it to Drive…). */
  @ReactMethod
  fun share(path: String, title: String, promise: Promise) {
    try {
      val context = reactApplicationContext
      val uri = FileProvider.getUriForFile(context, "${context.packageName}.karaoke", File(path.removePrefix("file://")))
      val send = Intent(Intent.ACTION_SEND)
        .setType("audio/mp4")
        .putExtra(Intent.EXTRA_STREAM, uri)
        .putExtra(Intent.EXTRA_TITLE, title)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      context.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("share_failed", e.message ?: e.toString(), e)
    }
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}

  private fun emit(map: com.facebook.react.bridge.WritableMap) {
    runCatching { reactApplicationContext.emitDeviceEvent(EVENT, map) }
  }

  /** The loaded model, kept between songs while karaoke is open. */
  private fun session(path: String): OrtSession {
    loaded?.let { if (loadedPath == path) return it }
    loaded?.close()
    shortenSegments(path)
    val options = OrtSession.SessionOptions().apply {
      setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      // ORT's arena and memory planning keep every intermediate tensor's peak
      // reserved: ~2 GB for this model, which gets the app killed on a 4 GB phone.
      setCPUArenaAllocator(false)
      setMemoryPatternOptimization(false)
      // Big cores only: waiting on the little ones slows every step down.
      // (XNNPACK was tried: slower and ~650 MB heavier on a Galaxy S9.)
      setIntraOpNumThreads(Runtime.getRuntime().availableProcessors().coerceIn(1, 4))
    }
    return env.createSession(path, options).also {
      loaded = it
      loadedPath = path
    }
  }

  /**
   * The model is fully convolutional in time but declares 256 frames per
   * input; at 128 it needs half the memory (~570 MB) for the same result
   * (measured: same SDR, as UVR's own shorter segments). Rewrites the two
   * declared shapes (input and output, at the very end of the file) in place:
   * 256 and 128 are both two-byte varints, so nothing else moves.
   */
  private fun shortenSegments(path: String) {
    val file = java.io.RandomAccessFile(path, "rw")
    file.use {
      val tail = minOf(it.length(), 4096L).toInt()
      val bytes = ByteArray(tail)
      it.seek(it.length() - tail)
      it.readFully(bytes)
      // dims …, 4, 2560, 256: 0A 02 08 04 | 0A 03 08 80 14 | 0A 03 08 80 02
      val pattern = byteArrayOf(0x0A, 0x02, 0x08, 0x04, 0x0A, 0x03, 0x08, 0x80.toByte(), 0x14, 0x0A, 0x03, 0x08, 0x80.toByte(), 0x02)
      var i = 0
      while (i <= tail - pattern.size) {
        if ((pattern.indices).all { k -> bytes[i + k] == pattern[k] }) {
          it.seek(it.length() - tail + i + pattern.size - 1)
          it.write(0x01) // 256 → 128
          i += pattern.size
        } else {
          i++
        }
      }
    }
  }

  /** The ONNX model as a SpecModel, reusing one direct buffer for its input. */
  private class OrtModel(private val session: OrtSession, private val options: OrtSession.RunOptions) : SpecModel {
    private val inputName = session.inputNames.first()
    private val shape: LongArray
    val dimF: Int
    val dimT: Int
    private val buffer: FloatBuffer

    init {
      val info = session.inputInfo.getValue(inputName).info as ai.onnxruntime.TensorInfo
      val s = info.shape // [batch, 4, dimF, dimT]
      dimF = s[2].toInt()
      dimT = s[3].toInt()
      shape = longArrayOf(1, 4, s[2], s[3])
      buffer = ByteBuffer.allocateDirect(4 * dimF * dimT * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
    }

    override fun run(input: FloatArray, output: FloatArray) {
      buffer.clear()
      buffer.put(input)
      buffer.rewind()
      OnnxTensor.createTensor(env, buffer, shape).use { tensor ->
        session.run(mapOf(inputName to tensor), options).use { result ->
          (result.get(0) as OnnxTensor).floatBuffer.get(output)
        }
      }
    }
  }

  companion object {
    const val NAME = "StashKaraoke"
    const val EVENT = "StashKaraoke"
    /** UVR-MDX-NET Inst HQ 4's settings (UVR's model_data: n_fft 5120, hop 1024). */
    private const val N_FFT = 5120
    private const val HOP = 1024
    private const val RATE = AudioReader.SAMPLE_RATE.toDouble()
    private const val KNEE = 0.9f
    private val env: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }
    private val worker = Executors.newSingleThreadExecutor()
    private val mixer = Executors.newSingleThreadExecutor()
    private var loaded: OrtSession? = null
    private var loadedPath: String? = null
  }
}
