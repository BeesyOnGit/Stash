package com.musicapp.bubble

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import kotlin.math.hypot

/**
 * Shows the floating bubble while stash plays in the background: a record that
 * spins with the music and a progress ring. Drag it anywhere (it snaps to the
 * nearest edge), drop it on the ✕ to dismiss it until the app is opened again,
 * tap it for the card ([BubbleCard]).
 *
 * Three overlay windows: the ✕ target (never touchable), the card with its
 * scrim (only while open) and the bubble itself, always added last so it stays
 * on top of the other two.
 */
@SuppressLint("StaticFieldLeak") // application context only
object BubbleManager {
  private lateinit var ctx: Context
  private lateinit var wm: WindowManager
  private val main = Handler(Looper.getMainLooper())

  private var bubble: BubbleView? = null
  private var bubbleParams: WindowManager.LayoutParams? = null
  private var target: TargetView? = null
  private var targetParams: WindowManager.LayoutParams? = null
  private var card: BubbleCard? = null
  private var snap: ValueAnimator? = null

  /** Dropped on the ✕: stays hidden until the app has been opened again. */
  private var dismissed = false

  fun init(context: Context) {
    if (::ctx.isInitialized) return
    ctx = context.applicationContext
    wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  }

  private fun dp(v: Float) = (v * ctx.resources.displayMetrics.density).toInt()

  // Sizes: a 56dp record in a 3dp white rim, with room around it for the shadow.
  private val rim get() = dp(62f)
  private val pad get() = dp(8f)
  private val win get() = rim + 2 * pad
  private val edge get() = dp(14f) - pad

  // ---- show / hide ----

  fun update() {
    if (!::ctx.isInitialized) return
    val s = BubbleState
    if (s.foreground) dismissed = false
    val show = s.enabled && s.has && !s.foreground && !dismissed && Settings.canDrawOverlays(ctx)
    if (!show) return hideAll()
    if (bubble == null && !showBubble()) return
    bind()
  }

  fun hideAll() {
    if (!::ctx.isInitialized) return
    main.removeCallbacks(tick)
    snap?.cancel()
    closeCard()
    bubble?.let {
      it.vinyl.stop()
      remove(it)
    }
    target?.let { remove(it) }
    bubble = null
    target = null
  }

  private fun remove(v: View) {
    try {
      wm.removeViewImmediate(v)
    } catch (_: Exception) {}
  }

  private fun overlayParams(w: Int, h: Int, touchable: Boolean) = WindowManager.LayoutParams(
    w,
    h,
    if (Build.VERSION.SDK_INT >= 26) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
    },
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
      (if (touchable) 0 else WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE),
    PixelFormat.TRANSLUCENT,
  ).apply {
    gravity = Gravity.TOP or Gravity.START
    // Screen coordinates everywhere: the bubble's x/y and the card line up.
    if (Build.VERSION.SDK_INT >= 30) setFitInsetsTypes(0)
    if (Build.VERSION.SDK_INT >= 28) {
      layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
  }

  private fun screen(): Point =
    if (Build.VERSION.SDK_INT >= 30) {
      val b = wm.currentWindowMetrics.bounds
      Point(b.width(), b.height())
    } else {
      Point().also { @Suppress("DEPRECATION") wm.defaultDisplay.getRealSize(it) }
    }

  private fun minY() = dp(48f)
  private fun maxY() = screen().y - win - dp(96f)
  private fun edgeX(right: Boolean) = if (right) screen().x - win - edge else edge

  private fun showBubble(): Boolean {
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val right = prefs.getBoolean("right", true)
    val y = prefs.getInt("y", (screen().y * 0.3f).toInt()).coerceIn(minY(), maxY())

    val t = TargetView(ctx)
    val tp = overlayParams(dp(100f), dp(100f), touchable = false).apply {
      x = screen().x / 2 - dp(50f)
      this.y = screen().y - dp(140f)
    }
    val b = BubbleView(ctx)
    val bp = overlayParams(win, win, touchable = true).apply {
      x = edgeX(right)
      this.y = y
    }
    return try {
      t.visibility = View.GONE
      wm.addView(t, tp)
      wm.addView(b, bp)
      target = t
      targetParams = tp
      bubble = b
      bubbleParams = bp
      b.setOnTouchListener(Drag())
      main.post(tick)
      true
    } catch (_: Exception) {
      // Permission taken away, or the system refused the window.
      remove(t)
      remove(b)
      false
    }
  }

  private fun bind() {
    val b = bubble ?: return
    val s = BubbleState
    b.vinyl.setSpinning(s.playing && !s.buffering, s.rotate)
    b.badgeIcon.kind = if (s.playing) IconView.Kind.PAUSE else IconView.Kind.PLAY
    b.ring.color = s.ringColorInt()
    b.ring.progress = s.progress()
    val art = s.art
    ImageLoader.load(ctx, art, dp(56f)) { bmp ->
      // A newer song may have arrived while this one was loading.
      if (art == BubbleState.art) bubble?.vinyl?.bind(bmp, BubbleState.vinylStyle, BubbleState.hue)
    }
    card?.bind()
  }

  /** Moves the ring (and the card's bar) between JS updates. */
  private val tick = object : Runnable {
    override fun run() {
      val b = bubble ?: return
      b.ring.progress = BubbleState.progress()
      card?.bindProgress()
      main.postDelayed(this, 250)
    }
  }

  // ---- the card ----

  private fun toggleCard() = if (card != null) closeCard() else openCard()

  private fun openCard() {
    val bp = bubbleParams ?: return
    val right = bp.x + win / 2 > screen().x / 2
    val c = BubbleCard(ctx, right, bp.y + pad, screen().y, onClose = { closeCard() }, onOpenApp = { openApp() })
    try {
      wm.addView(c.root, overlayParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, true))
      card = c
      c.bind()
      raiseBubble()
    } catch (_: Exception) {}
  }

  private fun closeCard() {
    card?.let { remove(it.root) }
    card = null
  }

  /** The newest window is on top: re-add the bubble above the card. */
  private fun raiseBubble() {
    val b = bubble ?: return
    val bp = bubbleParams ?: return
    try {
      wm.removeViewImmediate(b)
      wm.addView(b, bp)
    } catch (_: Exception) {}
  }

  private fun openApp() {
    hideAll()
    ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
      try {
        ctx.startActivity(it)
      } catch (_: Exception) {}
    }
    BubbleState.emit("open")
  }

  // ---- dragging ----

  private class Drag : View.OnTouchListener {
    private val slop = ViewConfiguration.get(ctx).scaledTouchSlop
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var dragging = false
    private var near = false

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouch(v: View, e: MotionEvent): Boolean {
      val bp = bubbleParams ?: return false
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          snap?.cancel()
          downX = e.rawX
          downY = e.rawY
          startX = bp.x
          startY = bp.y
          dragging = false
          near = false
          v.animate().scaleX(0.92f).scaleY(0.92f).setDuration(120).start()
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = e.rawX - downX
          val dy = e.rawY - downY
          if (!dragging && hypot(dx, dy) > slop) {
            dragging = true
            closeCard()
            target?.visibility = View.VISIBLE
          }
          if (dragging) {
            val size = screen()
            bp.x = (startX + dx.toInt()).coerceIn(0, size.x - win)
            bp.y = (startY + dy.toInt()).coerceIn(0, size.y - win)
            update(v, bp)
            val nowNear = nearTarget(bp)
            if (nowNear != near) {
              near = nowNear
              target?.setNear(near)
              if (near) BubbleState.buzz(v, "tick")
            }
          }
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          v.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
          target?.visibility = View.GONE
          target?.setNear(false)
          when {
            !dragging && e.actionMasked == MotionEvent.ACTION_UP -> {
              BubbleState.buzz(v)
              toggleCard()
            }
            near -> {
              BubbleState.buzz(v, "confirm")
              dismissed = true
              hideAll()
            }
            dragging -> snapToEdge(v, bp)
          }
          dragging = false
        }
      }
      return true
    }

    private fun nearTarget(bp: WindowManager.LayoutParams): Boolean {
      val tp = targetParams ?: return false
      val tx = tp.x + tp.width / 2f
      val ty = tp.y + tp.height / 2f
      return hypot(bp.x + win / 2f - tx, bp.y + win / 2f - ty) < dp(80f)
    }
  }

  private fun update(v: View, bp: WindowManager.LayoutParams) {
    try {
      wm.updateViewLayout(v, bp)
    } catch (_: Exception) {}
  }

  private fun snapToEdge(v: View, bp: WindowManager.LayoutParams) {
    val right = bp.x + win / 2 > screen().x / 2
    val fromX = bp.x
    val fromY = bp.y
    val toX = edgeX(right)
    val toY = bp.y.coerceIn(minY(), maxY())
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean("right", right)
      .putInt("y", toY)
      .apply()
    snap = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 260
      interpolator = DecelerateInterpolator(1.6f)
      addUpdateListener {
        val f = it.animatedValue as Float
        bp.x = (fromX + (toX - fromX) * f).toInt()
        bp.y = (fromY + (toY - fromY) * f).toInt()
        if (bubble === v) update(v, bp)
      }
      start()
    }
  }

  private const val PREFS = "stash_bubble"

  // ---- views ----

  /** The record in its white rim, the progress ring and the play / pause badge. */
  private class BubbleView(context: Context) : FrameLayout(context) {
    val vinyl = VinylView(context)
    val ring = RingView(context)
    val badgeIcon = IconView(context, IconView.Kind.PLAY, 0xFFFFFFFF.toInt())

    init {
      val d = context.resources.displayMetrics.density
      fun px(v: Float) = (v * d).toInt()
      clipChildren = false
      clipToPadding = false
      val holder = FrameLayout(context).apply {
        background = GradientDrawable().apply {
          shape = GradientDrawable.OVAL
          setColor(0xFFFFFFFF.toInt())
        }
        elevation = 8 * d
      }
      holder.addView(vinyl, LayoutParams(px(56f), px(56f), Gravity.CENTER))
      holder.addView(ring, LayoutParams(px(56f), px(56f), Gravity.CENTER))
      addView(holder, LayoutParams(px(62f), px(62f), Gravity.CENTER))

      val badge = FrameLayout(context).apply {
        background = GradientDrawable().apply {
          shape = GradientDrawable.OVAL
          setColor(0xFF16161A.toInt())
          setStroke(px(2f), 0xFFFFFFFF.toInt())
        }
        elevation = 9 * d
      }
      badge.addView(badgeIcon, LayoutParams(px(10f), px(10f), Gravity.CENTER))
      addView(
        badge,
        LayoutParams(px(20f), px(20f), Gravity.BOTTOM or Gravity.END).apply {
          rightMargin = px(9f)
          bottomMargin = px(9f)
        },
      )
      contentDescription = "stash — tap for controls, drag to move"
    }
  }

  /** The ✕ at the bottom; turns orange and grows when the bubble is over it. */
  private class TargetView(context: Context) : FrameLayout(context) {
    private val circle = FrameLayout(context)
    private val bg = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(0x8C000000.toInt())
    }

    init {
      val d = context.resources.displayMetrics.density
      circle.background = bg
      circle.addView(
        IconView(context, IconView.Kind.CLOSE, 0xFFFFFFFF.toInt()),
        LayoutParams((24 * d).toInt(), (24 * d).toInt(), Gravity.CENTER),
      )
      addView(circle, LayoutParams((60 * d).toInt(), (60 * d).toInt(), Gravity.CENTER))
    }

    fun setNear(near: Boolean) {
      bg.setColor(if (near) 0xFFE0532F.toInt() else 0x8C000000.toInt())
      val s = if (near) 1.15f else 1f
      circle.animate().scaleX(s).scaleY(s).setDuration(150).start()
    }
  }
}
