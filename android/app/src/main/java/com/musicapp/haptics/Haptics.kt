package com.musicapp.haptics

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import android.view.View

/**
 * Button haptics at the strength picked in Settings (app and floating bubble).
 *
 * - `light`: the system's own touch feedback (what other apps use; on many
 *   phones it's very soft, and it follows the phone's touch-vibration setting).
 * - `medium` / `strong`: the vibration motor directly, stronger and a little
 *   longer, with the finest control the phone offers.
 */
object Haptics {
  fun perform(context: Context, view: View?, kind: String, strength: String) {
    if (strength == "light") {
      view?.performHapticFeedback(systemConstant(kind))
      return
    }
    val vibrator = vibrator(context) ?: return
    if (!vibrator.hasVibrator()) return
    val strong = strength == "strong"
    try {
      vibrator.vibrate(effect(vibrator, kind, strong))
    } catch (_: Exception) {}
  }

  private fun effect(v: Vibrator, kind: String, strong: Boolean): VibrationEffect {
    // Android 11+: crisp "click" primitives that can be scaled.
    if (Build.VERSION.SDK_INT >= 30) {
      val primitive =
        if (kind == "tick") VibrationEffect.Composition.PRIMITIVE_TICK
        else VibrationEffect.Composition.PRIMITIVE_CLICK
      if (v.areAllPrimitivesSupported(primitive)) {
        val scale = if (strong) 1f else 0.7f
        val c = VibrationEffect.startComposition().addPrimitive(primitive, scale)
        if (kind == "confirm") c.addPrimitive(primitive, scale, 60)
        return c.compose()
      }
    }
    // Otherwise a short pulse: longer and harder for bigger actions.
    val ms = when (kind) {
      "tick" -> if (strong) 14L else 9L
      "confirm" -> if (strong) 40L else 28L
      else -> if (strong) 26L else 18L
    }
    val amplitude =
      if (v.hasAmplitudeControl()) (if (strong) 255 else 170)
      else VibrationEffect.DEFAULT_AMPLITUDE
    return VibrationEffect.createOneShot(ms, amplitude)
  }

  private fun vibrator(context: Context): Vibrator? =
    if (Build.VERSION.SDK_INT >= 31) {
      (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION") context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

  private fun systemConstant(kind: String): Int = when (kind) {
    "tick" -> HapticFeedbackConstants.CLOCK_TICK
    "toggle" -> HapticFeedbackConstants.CONTEXT_CLICK
    "confirm" ->
      if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM
      else HapticFeedbackConstants.LONG_PRESS
    else -> HapticFeedbackConstants.VIRTUAL_KEY
  }
}
