package com.musicapp.bubble

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.SweepGradient
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.max

/**
 * The bubble's record: disc, grooves, a light sheen and the cover as the label.
 * Styles match src/ui/Vinyl.tsx (the `small` insets).
 */
class VinylView(context: Context) : View(context) {
  private val disc = Paint(Paint.ANTI_ALIAS_FLAG)
  private val groove = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    color = Color.argb(18, 255, 255, 255)
  }
  private val sheen = Paint(Paint.ANTI_ALIAS_FLAG)
  private val art = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val artFallback = Paint(Paint.ANTI_ALIAS_FLAG)
  private val artEdge = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    color = Color.argb(153, 0, 0, 0)
  }
  private val spindle = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF0B0B0D.toInt() }
  private val matrix = Matrix()

  private var bitmap: Bitmap? = null
  private var styleName = "classic"
  private var hue = 0f

  private val spin = ObjectAnimator.ofFloat(this, "rotation", 0f, 360f).apply {
    duration = 6000
    repeatCount = ValueAnimator.INFINITE
    interpolator = LinearInterpolator()
  }

  fun bind(bmp: Bitmap?, style: String, hue: Float) {
    if (bmp === bitmap && style == styleName && hue == this.hue) return
    bitmap = bmp
    styleName = style
    this.hue = hue
    art.shader = bmp?.let { BitmapShader(it, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
    invalidate()
  }

  /** Turns while playing; pausing keeps the angle. */
  fun setSpinning(on: Boolean, enabled: Boolean) {
    when {
      !enabled -> {
        spin.cancel()
        rotation = 0f
      }
      on && !spin.isStarted -> spin.start()
      on && spin.isPaused -> spin.resume()
      !on && spin.isRunning -> spin.pause()
    }
  }

  fun stop() = spin.cancel()

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    sheen.shader = SweepGradient(
      w / 2f,
      h / 2f,
      intArrayOf(0, 0, Color.argb(36, 255, 255, 255), 0, 0, Color.argb(26, 255, 255, 255), 0, 0),
      floatArrayOf(0f, 0.08f, 0.2f, 0.3f, 0.58f, 0.7f, 0.8f, 1f),
    )
  }

  override fun onDraw(canvas: Canvas) {
    val r = width / 2f
    val cx = r
    val d = resources.displayMetrics.density
    val (discColor, inset, opacity) = when (styleName) {
      "colour" -> Triple(BubbleState.hsl(hue, 0.55f, 0.12f), 0.30f, 1f)
      "picture" -> Triple(0xFF141414.toInt(), 0f, 1f)
      "clear" -> Triple(Color.argb(56, 255, 255, 255), 0.32f, 0.92f)
      else -> Triple(0xFF141414.toInt(), 0.30f, 1f)
    }
    disc.color = discColor
    canvas.drawCircle(cx, cx, r, disc)

    val artR = r * (1 - 2 * inset)
    groove.strokeWidth = 0.5f * d
    var g = r - 1.5f * d
    while (g > max(artR, 3 * d)) {
      canvas.drawCircle(cx, cx, g, groove)
      g -= 3 * d
    }
    canvas.drawCircle(cx, cx, r, sheen)

    val bmp = bitmap
    if (bmp != null) {
      val scale = max(artR * 2 / bmp.width, artR * 2 / bmp.height)
      matrix.setScale(scale, scale)
      matrix.postTranslate(cx - bmp.width * scale / 2, cx - bmp.height * scale / 2)
      art.shader?.setLocalMatrix(matrix)
      art.alpha = (opacity * 255).toInt()
      canvas.drawCircle(cx, cx, artR, art)
    } else {
      artFallback.color = BubbleState.hsl(hue, 0.55f, 0.78f)
      artFallback.alpha = (opacity * 255).toInt()
      canvas.drawCircle(cx, cx, artR, artFallback)
    }
    if (inset > 0) {
      artEdge.strokeWidth = 1.5f * d
      canvas.drawCircle(cx, cx, artR, artEdge)
    }
    canvas.drawCircle(cx, cx, 2 * d, spindle)
  }
}

/** Song progress around the record's edge. */
class RingView(context: Context) : View(context) {
  private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    color = Color.argb(64, 0, 0, 0)
  }
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
  }
  private val box = RectF()
  var progress = 0f
    set(v) {
      if (v != field) {
        field = v
        invalidate()
      }
    }
  var color = Color.WHITE
    set(v) {
      if (v != field) {
        field = v
        invalidate()
      }
    }

  override fun onDraw(canvas: Canvas) {
    val sw = 2.5f * resources.displayMetrics.density
    track.strokeWidth = sw
    fill.strokeWidth = sw
    fill.color = color
    box.set(sw / 2 + 1, sw / 2 + 1, width - sw / 2 - 1, height - sw / 2 - 1)
    canvas.drawOval(box, track)
    if (progress > 0) canvas.drawArc(box, -90f, 360f * progress, false, fill)
  }
}

/** The few icons the bubble needs, drawn from the app's 24×24 SVG paths. */
class IconView(context: Context, kind: Kind, color: Int) : View(context) {
  enum class Kind { PLAY, PAUSE, PREV, NEXT, OPEN, CLOSE }

  var kind = kind
    set(v) {
      if (v != field) {
        field = v
        invalidate()
      }
    }
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    this.color = color
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }
  private val path = Path()
  private val rect = RectF()

  fun setColor(c: Int) {
    paint.color = c
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    val s = minOf(width, height) / 24f
    canvas.save()
    canvas.translate((width - 24 * s) / 2, (height - 24 * s) / 2)
    canvas.scale(s, s)
    path.reset()
    paint.style = Paint.Style.FILL
    when (kind) {
      Kind.PLAY -> {
        path.moveTo(8f, 5f); path.lineTo(8f, 19f); path.lineTo(19f, 12f); path.close()
        canvas.drawPath(path, paint)
      }
      Kind.PAUSE -> {
        rect.set(6f, 5f, 10f, 19f); canvas.drawRoundRect(rect, 1f, 1f, paint)
        rect.set(14f, 5f, 18f, 19f); canvas.drawRoundRect(rect, 1f, 1f, paint)
      }
      Kind.PREV -> {
        path.moveTo(18f, 5f); path.lineTo(18f, 19f); path.lineTo(9f, 12f); path.close()
        canvas.drawPath(path, paint)
        rect.set(5f, 5f, 7.5f, 19f); canvas.drawRoundRect(rect, 1f, 1f, paint)
      }
      Kind.NEXT -> {
        path.moveTo(6f, 5f); path.lineTo(6f, 19f); path.lineTo(15f, 12f); path.close()
        canvas.drawPath(path, paint)
        rect.set(16.5f, 5f, 19f, 19f); canvas.drawRoundRect(rect, 1f, 1f, paint)
      }
      Kind.OPEN -> {
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2.4f
        path.moveTo(7f, 17f); path.lineTo(17f, 7f)
        path.moveTo(9f, 7f); path.lineTo(17f, 7f); path.lineTo(17f, 15f)
        canvas.drawPath(path, paint)
      }
      Kind.CLOSE -> {
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2.4f
        path.moveTo(6f, 6f); path.lineTo(18f, 18f)
        path.moveTo(18f, 6f); path.lineTo(6f, 18f)
        canvas.drawPath(path, paint)
      }
    }
    canvas.restore()
  }
}
