package com.musicapp.car

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap

/** JS side: src/car/CarBridge.ts. JS pushes state in, the car's button presses come out as "StashCar" events. */
class CarModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  override fun getName() = NAME

  override fun initialize() {
    super.initialize()
    CarState.emitter = { reactApplicationContext.emitDeviceEvent(EVENT, it) }
  }

  override fun invalidate() {
    CarState.emitter = null
    super.invalidate()
  }

  /** A window of the play queue: `items[0]` is at `offset` in the JS queue. */
  @ReactMethod
  fun setQueue(items: ReadableArray, offset: Double) {
    val list = (0 until items.size()).mapNotNull { i ->
      val m = items.getMap(i) ?: return@mapNotNull null
      CarItem(
        id = m.getString("id") ?: return@mapNotNull null,
        title = m.getString("title") ?: "",
        subtitle = if (m.hasKey("subtitle")) m.getString("subtitle") else null,
        artUri = if (m.hasKey("art")) m.getString("art") else null,
        durationMs = if (m.hasKey("duration")) (m.getDouble("duration") * 1000).toLong() else 0L,
      )
    }
    reactApplicationContext.runOnUiQueueThread {
      CarState.queue = list
      CarState.offset = offset.toInt()
      CarState.changed()
    }
  }

  @ReactMethod
  fun setPlayback(p: ReadableMap) {
    reactApplicationContext.runOnUiQueueThread {
      val s = CarState
      s.index = p.getInt("index")
      s.playing = p.getBoolean("playing")
      s.buffering = p.getBoolean("buffering")
      s.speed = p.getDouble("speed").toFloat()
      s.repeat = p.getString("repeat") ?: "off"
      s.shuffle = p.getBoolean("shuffle")
      s.liked = p.getBoolean("liked")
      s.canLike = p.getBoolean("canLike")
      s.setPosition((p.getDouble("position") * 1000).toLong())
      s.changed()
    }
  }

  /** `{ roots: Item[], children: { [parentId]: Item[] } }` as JSON. */
  @ReactMethod
  fun setBrowseTree(json: String) = CarState.setTree(json)

  // Required by NativeEventEmitter.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}

  companion object {
    const val NAME = "StashCar"
    const val EVENT = "StashCar"
  }
}
