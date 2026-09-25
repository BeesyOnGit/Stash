package com.musicapp.bubble

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * The card that opens from the bubble: a small now playing (cover, title,
 * previous / play / next, progress), then Favorites and Suggested to start
 * something else without opening the app. A dim scrim behind it closes it.
 */
@SuppressLint("ViewConstructor")
class BubbleCard(
  private val ctx: Context,
  right: Boolean,
  bubbleTop: Int,
  screenHeight: Int,
  private val onClose: () -> Unit,
  onOpenApp: () -> Unit,
) {
  private val d = ctx.resources.displayMetrics.density
  private fun px(v: Float) = (v * d).toInt()

  val root = FrameLayout(ctx)

  private val art = cover(46f, 11f)
  private val title = text(14f, Font.SEMIBOLD, INK)
  private val artist = text(12f, Font.REGULAR, INK).apply { alpha = 0.7f }
  private val playIcon = IconView(ctx, IconView.Kind.PLAY, BG)
  private val progressFill = View(ctx).apply { setBackgroundColor(INK) }
  private val progressTrack = FrameLayout(ctx)
  private val lists = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }

  private var shownFavorites: List<BubbleItem>? = null
  private var shownSuggestions: List<BubbleItem>? = null
  private var shownArt: String? = "\u0000"

  init {
    root.setBackgroundColor(Color.argb(46, 0, 0, 0))
    root.setOnClickListener { onClose() }

    val card = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      background = rounded(BG, 22f)
      elevation = 24 * d
      clipToOutline = true
      isClickable = true // taps inside don't reach the scrim
    }

    // ---- header: song, controls, progress ----
    val header = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(px(14f), px(14f), px(14f), px(12f))
    }
    val top = LinearLayout(ctx).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    top.addView(art, LinearLayout.LayoutParams(px(46f), px(46f)))
    val names = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      addView(title)
      addView(artist)
    }
    top.addView(
      names,
      LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
        marginStart = px(10f)
        marginEnd = px(10f)
      },
    )
    val open = FrameLayout(ctx).apply {
      background = oval(CHIP)
      contentDescription = BubbleState.label("open", "Open stash")
      setOnClickListener { BubbleState.buzz(it); onOpenApp() }
      addView(IconView(ctx, IconView.Kind.OPEN, INK), FrameLayout.LayoutParams(px(15f), px(15f), Gravity.CENTER))
    }
    top.addView(open, LinearLayout.LayoutParams(px(32f), px(32f)))
    header.addView(top)

    val controls = LinearLayout(ctx).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
    }
    controls.addView(iconButton(IconView.Kind.PREV, BubbleState.label("previous", "Previous")) { BubbleState.emit("previous") })
    val play = FrameLayout(ctx).apply {
      background = oval(INK)
      contentDescription = BubbleState.label("playPause", "Play or pause")
      setOnClickListener { BubbleState.buzz(it); BubbleState.emit("toggle") }
      addView(playIcon, FrameLayout.LayoutParams(px(20f), px(20f), Gravity.CENTER))
    }
    controls.addView(
      play,
      LinearLayout.LayoutParams(px(48f), px(48f)).apply {
        marginStart = px(18f)
        marginEnd = px(18f)
      },
    )
    controls.addView(iconButton(IconView.Kind.NEXT, BubbleState.label("next", "Next")) { BubbleState.emit("next") })
    header.addView(
      controls,
      LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
        topMargin = px(12f)
      },
    )

    progressTrack.background = rounded(Color.argb(36, 255, 255, 255), 2f)
    progressTrack.clipToOutline = true
    progressTrack.addView(progressFill, FrameLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT))
    header.addView(
      progressTrack,
      LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(3f)).apply { topMargin = px(10f) },
    )
    card.addView(header)
    card.addView(View(ctx).apply { setBackgroundColor(Color.argb(20, 255, 255, 255)) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(1f)))

    // ---- favorites + suggestions ----
    val scroll = ScrollView(ctx).apply {
      isVerticalScrollBarEnabled = false
      overScrollMode = View.OVER_SCROLL_NEVER
      lists.setPadding(px(14f), px(2f), px(14f), px(14f))
      addView(lists)
    }
    card.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

    // Below the bubble when it fits, else above it; on the bubble's side.
    val height = minOf(px(420f), screenHeight - px(112f))
    val below = bubbleTop + px(68f)
    val topY = if (below + height <= screenHeight - px(24f)) below else maxOf(px(56f), bubbleTop - height - px(10f))
    root.addView(
      card,
      FrameLayout.LayoutParams(px(266f), height, Gravity.TOP or (if (right) Gravity.END else Gravity.START)).apply {
        topMargin = topY
        if (right) rightMargin = px(14f) else leftMargin = px(14f)
      },
    )
    card.alpha = 0f
    card.scaleX = 0.94f
    card.scaleY = 0.94f
    card.pivotX = if (right) px(266f).toFloat() else 0f
    card.pivotY = if (topY > bubbleTop) 0f else height.toFloat()
    card.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(160).start()
  }

  // ---- binding ----

  fun bind() {
    val s = BubbleState
    title.text = s.title
    artist.text = s.artist
    playIcon.kind = if (s.playing) IconView.Kind.PAUSE else IconView.Kind.PLAY
    if (s.art != shownArt) {
      shownArt = s.art
      setCover(art, s.art, s.hue, 46f)
    }
    bindProgress()
    if (s.favorites !== shownFavorites || s.suggestions !== shownSuggestions) {
      shownFavorites = s.favorites
      shownSuggestions = s.suggestions
      buildLists(s.favorites, s.suggestions)
    }
  }

  fun bindProgress() {
    val w = progressTrack.width
    if (w == 0) {
      progressTrack.post { bindProgress() }
      return
    }
    val lp = progressFill.layoutParams
    val want = (w * BubbleState.progress()).toInt()
    if (lp.width != want) {
      lp.width = want
      progressFill.layoutParams = lp
    }
  }

  private fun buildLists(favorites: List<BubbleItem>, suggestions: List<BubbleItem>) {
    lists.removeAllViews()
    if (favorites.isNotEmpty()) {
      lists.addView(label(BubbleState.label("favorites", "Favorites")), labelParams(12f))
      val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
      favorites.forEachIndexed { i, item ->
        val tile = cover(52f, 12f).apply {
          contentDescription = "${item.title}, ${item.artist}"
          setOnClickListener { BubbleState.buzz(it); BubbleState.emit("favorite", i) }
        }
        setCover(tile, item.art, item.hue, 52f)
        row.addView(tile, LinearLayout.LayoutParams(px(52f), px(52f)).apply { if (i > 0) marginStart = px(8f) })
      }
      val strip = HorizontalScrollView(ctx).apply {
        isHorizontalScrollBarEnabled = false
        overScrollMode = View.OVER_SCROLL_NEVER
        addView(row)
      }
      lists.addView(strip, labelParams(8f))
    }
    if (suggestions.isNotEmpty()) {
      lists.addView(label(BubbleState.label("suggested", "Suggested")), labelParams(16f))
      suggestions.forEachIndexed { i, item -> lists.addView(suggestionRow(i, item), labelParams(if (i == 0) 6f else 0f)) }
    }
    if (favorites.isEmpty() && suggestions.isEmpty()) {
      lists.addView(
        text(13f, Font.REGULAR, INK).apply {
          alpha = 0.6f
          text = BubbleState.label(
            "empty",
            "Like songs to keep them here, and turn on Suggest similar songs for ideas.",
          )
          maxLines = 3
        },
        labelParams(14f),
      )
    }
  }

  private fun suggestionRow(i: Int, item: BubbleItem): View {
    val row = LinearLayout(ctx).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(0, px(6f), 0, px(6f))
      setOnClickListener { BubbleState.buzz(it); BubbleState.emit("suggestion", i) }
    }
    val img = cover(38f, 9f)
    setCover(img, item.art, item.hue, 38f)
    row.addView(img, LinearLayout.LayoutParams(px(38f), px(38f)))
    val names = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      addView(text(13f, Font.MEDIUM, INK).apply { text = item.title })
      addView(text(11f, Font.REGULAR, INK).apply { text = item.artist; alpha = 0.6f })
    }
    row.addView(
      names,
      LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
        marginStart = px(10f)
        marginEnd = px(8f)
      },
    )
    item.tag?.let { tag ->
      val pill = TextView(ctx).apply {
        text = tag
        typeface = Font.MONO.typeface(ctx)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
        setTextColor(if (item.local) 0xFF86D4A0.toInt() else 0xFFC9C8CE.toInt())
        background = rounded(if (item.local) Color.argb(46, 120, 200, 150) else Color.argb(26, 255, 255, 255), 999f)
        setPadding(px(7f), px(3f), px(7f), px(3f))
      }
      row.addView(pill)
    }
    return row
  }

  // ---- little builders ----

  private fun label(s: String) = TextView(ctx).apply {
    text = s.uppercase()
    typeface = Font.MONO_SEMIBOLD.typeface(ctx)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
    letterSpacing = 0.06f
    setTextColor(INK)
    alpha = 0.55f
  }

  private fun labelParams(top: Float) =
    LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
      topMargin = px(top)
    }

  private fun text(size: Float, font: Font, color: Int) = TextView(ctx).apply {
    typeface = font.typeface(ctx)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
    setTextColor(color)
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
    includeFontPadding = false
    setPadding(0, px(1f), 0, px(1f))
  }

  private fun iconButton(kind: IconView.Kind, label: String, onTap: () -> Unit) = FrameLayout(ctx).apply {
    contentDescription = label
    setOnClickListener { BubbleState.buzz(it); onTap() }
    addView(IconView(ctx, kind, INK), FrameLayout.LayoutParams(px(24f), px(24f), Gravity.CENTER))
    layoutParams = LinearLayout.LayoutParams(px(38f), px(38f))
  }

  private fun cover(size: Float, radius: Float) = ImageView(ctx).apply {
    scaleType = ImageView.ScaleType.CENTER_CROP
    background = rounded(Color.argb(30, 255, 255, 255), radius)
    clipToOutline = true
    minimumWidth = px(size)
    minimumHeight = px(size)
  }

  private fun setCover(view: ImageView, uri: String?, hue: Float, size: Float) {
    view.setImageDrawable(null)
    (view.background as? GradientDrawable)?.setColor(BubbleState.hsl(hue, 0.45f, 0.8f))
    view.tag = uri
    ImageLoader.load(ctx, uri, px(size)) { bmp ->
      if (view.tag == uri && bmp != null) view.setImageBitmap(bmp)
    }
  }

  private fun rounded(color: Int, radius: Float) = GradientDrawable().apply {
    setColor(color)
    cornerRadius = radius * d
  }

  private fun oval(color: Int) = GradientDrawable().apply {
    shape = GradientDrawable.OVAL
    setColor(color)
  }

  /** The app's fonts (android/app/src/main/assets/fonts). */
  enum class Font(private val file: String) {
    REGULAR("Geist-Regular"),
    MEDIUM("Geist-Medium"),
    SEMIBOLD("Geist-SemiBold"),
    MONO("GeistMono-Medium"),
    MONO_SEMIBOLD("GeistMono-SemiBold");

    private var cached: Typeface? = null

    fun typeface(ctx: Context): Typeface =
      cached ?: try {
        Typeface.createFromAsset(ctx.assets, "fonts/$file.ttf")
      } catch (_: Exception) {
        Typeface.DEFAULT
      }.also { cached = it }
  }

  companion object {
    private const val BG = 0xFF1F1F22.toInt()
    private const val INK = 0xFFF2F1EE.toInt()
    private val CHIP = Color.argb(31, 255, 255, 255)
  }
}
