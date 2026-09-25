package com.musicapp.car

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import org.json.JSONObject

/** A song in the car's queue / browse lists, as sent by JS. */
data class CarItem(
  val id: String,
  val title: String,
  val subtitle: String?,
  val artUri: String?,
  val durationMs: Long,
  val playable: Boolean = true,
  val browsable: Boolean = false,
)

/**
 * What the car shows, mirrored from the JS player (the single source of truth).
 * All reads and writes happen on the main thread.
 */
object CarState {
  private val main = Handler(Looper.getMainLooper())

  // ---- queue + transport ----
  var queue: List<CarItem> = emptyList()
  /** Index in the full JS queue of `queue[0]` (JS sends a window around the current song). */
  var offset = 0
  var index = -1
  var playing = false
  var buffering = false
  var speed = 1f
  var repeat = "off"
  var shuffle = false
  var liked = false
  var canLike = false
  /** Button labels in the app's language, sent by JS (empty until then: English fallback). */
  var likeLabel = ""
  var speedLabel = ""
  var shuffleLabel = ""
  private var positionMs = 0L
  private var positionAt = 0L

  // ---- browse tree: parent id -> children ----
  var roots: List<CarItem> = emptyList()
  var children: Map<String, List<CarItem>> = emptyMap()
  var treeReady = false

  /** The service listens to redraw the car screen. */
  var onPlaybackChanged: (() -> Unit)? = null
  var onTreeChanged: ((Set<String>) -> Unit)? = null

  /** Current position, moving forward while playing. */
  fun positionMs(): Long =
    if (playing && !buffering) {
      positionMs + ((SystemClock.elapsedRealtime() - positionAt) * speed).toLong()
    } else {
      positionMs
    }

  fun setPosition(ms: Long) {
    positionMs = ms
    positionAt = SystemClock.elapsedRealtime()
  }

  fun changed() = main.post { onPlaybackChanged?.invoke() }

  fun setTree(json: String) {
    val o = JSONObject(json)
    val kids = mutableMapOf<String, List<CarItem>>()
    val c = o.getJSONObject("children")
    for (key in c.keys()) {
      val arr = c.getJSONArray(key)
      kids[key] = (0 until arr.length()).map { itemFrom(arr.getJSONObject(it)) }
    }
    val r = o.getJSONArray("roots")
    main.post {
      val parents = children.keys + kids.keys
      roots = (0 until r.length()).map { itemFrom(r.getJSONObject(it)) }
      children = kids
      treeReady = true
      onTreeChanged?.invoke(parents + ROOT_ID)
    }
  }

  private fun itemFrom(j: JSONObject) = CarItem(
    id = j.getString("id"),
    title = j.getString("title"),
    subtitle = j.optString("subtitle").ifEmpty { null },
    artUri = j.optString("art").ifEmpty { null },
    durationMs = (j.optDouble("duration", 0.0) * 1000).toLong(),
    playable = j.optBoolean("playable", true),
    browsable = j.optBoolean("browsable", false),
  )

  // ---- events to JS ----

  /** Set by the native module once JS is running; events before that wait here. */
  var emitter: ((WritableMap) -> Unit)? = null
    set(value) {
      field = value
      if (value != null) {
        val waiting = pending.toList()
        pending.clear()
        waiting.forEach { value(it.toWritable()) }
      }
    }
  private val pending = mutableListOf<Map<String, Any?>>()

  fun emit(type: String, vararg extra: Pair<String, Any?>) {
    val event = mapOf("type" to type, *extra)
    val e = emitter
    if (e != null) {
      e(event.toWritable())
    } else {
      pending += event
      if (pending.size > 20) pending.removeAt(0)
    }
  }

  private fun Map<String, Any?>.toWritable(): WritableMap = Arguments.createMap().apply {
    for ((k, v) in this@toWritable) {
      when (v) {
        null -> putNull(k)
        is String -> putString(k, v)
        is Int -> putInt(k, v)
        is Number -> putDouble(k, v.toDouble())
        is Boolean -> putBoolean(k, v)
      }
    }
  }

  const val ROOT_ID = "root"
}
