package com.musicapp.bubble

import android.os.SystemClock
import android.view.View
import androidx.core.graphics.ColorUtils
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.musicapp.haptics.Haptics
import org.json.JSONArray
import org.json.JSONObject

/** A song in the card's Favorites / Suggested lists, as sent by JS. */
data class BubbleItem(
  val title: String,
  val artist: String,
  val art: String?,
  val hue: Float,
  /** Suggestions only: "Offline" or the source it would stream from. */
  val tag: String?,
  val local: Boolean,
)

/**
 * What the bubble shows, mirrored from the JS player (src/bubble/BubbleBridge.ts).
 * All reads and writes happen on the main thread.
 */
object BubbleState {
  // ---- settings ----
  var enabled = false
  var ringColor = "white"
  var vinylStyle = "classic"
  var rotate = true
  var haptics = true
  var hapticStrength = "medium"

  // ---- now playing ----
  var has = false
  var title = ""
  var artist = ""
  var art: String? = null
  var hue = 0f
  var playing = false
  var buffering = false
  var durationSec = 0.0
  var speed = 1f
  private var positionSec = 0.0
  private var positionAt = 0L

  // ---- card lists ----
  var favorites: List<BubbleItem> = emptyList()
  var suggestions: List<BubbleItem> = emptyList()

  /** The app is on screen: no bubble then (the mini player does that job). */
  var foreground = true

  /** Current position, moving forward while playing. */
  fun positionSec(): Double =
    if (playing && !buffering) {
      positionSec + (SystemClock.elapsedRealtime() - positionAt) / 1000.0 * speed
    } else {
      positionSec
    }

  fun setPosition(sec: Double) {
    positionSec = sec
    positionAt = SystemClock.elapsedRealtime()
  }

  fun progress(): Float =
    if (durationSec > 0) (positionSec() / durationSec).toFloat().coerceIn(0f, 1f) else 0f

  fun setLists(json: String) {
    val o = JSONObject(json)
    favorites = items(o.optJSONArray("favorites"))
    suggestions = items(o.optJSONArray("suggestions"))
  }

  private fun items(a: JSONArray?): List<BubbleItem> =
    if (a == null) emptyList() else (0 until a.length()).map {
      val j = a.getJSONObject(it)
      BubbleItem(
        title = j.optString("title"),
        artist = j.optString("artist"),
        art = j.optString("art").ifEmpty { null },
        hue = j.optDouble("hue", 0.0).toFloat(),
        tag = j.optString("tag").ifEmpty { null },
        local = j.optBoolean("local", false),
      )
    }

  // ---- colours (same as src/theme.ts paletteFor and the settings swatches) ----

  fun hsl(h: Float, s: Float, l: Float) = ColorUtils.HSLToColor(floatArrayOf(h, s, l))

  fun ringColorInt(): Int = when (ringColor) {
    "orange" -> 0xFFE0532F.toInt()
    "green" -> 0xFF6FD39A.toInt()
    "blue" -> 0xFF5B9BE6.toInt()
    "cover" -> hsl(hue, 0.6f, 0.72f)
    else -> 0xFFFFFFFF.toInt()
  }

  /** The app's "Haptic feedback" setting, for the bubble's own buttons. */
  fun buzz(view: View, kind: String = "tap") {
    if (haptics) Haptics.perform(view.context, view, kind, hapticStrength)
  }

  // ---- events to JS ----

  /** Set by the native module once JS is running. Taps before that are dropped. */
  var emitter: ((WritableMap) -> Unit)? = null

  fun emit(type: String, index: Int? = null) {
    val e = emitter ?: return
    e(Arguments.createMap().apply {
      putString("type", type)
      if (index != null) putInt("index", index)
    })
  }
}
