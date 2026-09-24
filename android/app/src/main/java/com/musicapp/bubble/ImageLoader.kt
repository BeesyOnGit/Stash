package com.musicapp.bubble

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Covers for the bubble: saved files (`file://…`) or web thumbnails, decoded at
 * the size shown and kept in a small memory cache.
 */
object ImageLoader {
  private val main = Handler(Looper.getMainLooper())
  private val pool = Executors.newFixedThreadPool(2)
  private val cache = object : LruCache<String, Bitmap>(8 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap) = value.byteCount
  }
  private val loading = mutableMapOf<String, MutableList<(Bitmap?) -> Unit>>()

  /** Calls back on the main thread (right away when cached). */
  fun load(context: Context, uri: String?, sizePx: Int, done: (Bitmap?) -> Unit) {
    if (uri.isNullOrEmpty()) return done(null)
    val key = "$sizePx|$uri"
    cache.get(key)?.let { return done(it) }
    loading[key]?.let { it += done; return }
    loading[key] = mutableListOf(done)
    val app = context.applicationContext
    pool.execute {
      val bmp = try {
        decode(app, uri, sizePx)
      } catch (_: Exception) {
        null
      }
      main.post {
        if (bmp != null) cache.put(key, bmp)
        loading.remove(key)?.forEach { it(bmp) }
      }
    }
  }

  private fun decode(context: Context, uri: String, sizePx: Int): Bitmap? {
    val bytes = when {
      uri.startsWith("http://") || uri.startsWith("https://") -> {
        val c = URL(uri).openConnection() as HttpURLConnection
        c.connectTimeout = 8000
        c.readTimeout = 8000
        try {
          c.inputStream.use { it.readBytes() }
        } finally {
          c.disconnect()
        }
      }
      uri.startsWith("content://") ->
        context.contentResolver.openInputStream(Uri.parse(uri))?.use { it.readBytes() }
      else -> File(uri.removePrefix("file://")).takeIf { it.isFile }?.readBytes()
    } ?: return null

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= sizePx && bounds.outHeight / (sample * 2) >= sizePx) {
      sample *= 2
    }
    return BitmapFactory.decodeByteArray(
      bytes,
      0,
      bytes.size,
      BitmapFactory.Options().apply { inSampleSize = sample },
    )
  }
}
