package com.musicapp.car

import android.content.Context
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * A "remote control" player for the car. It plays nothing itself: it shows the
 * state of the app's real player (react-native-video, driven by JS) and turns
 * every button press in the car into an event for JS.
 */
@OptIn(UnstableApi::class)
class CarPlayer(private val context: Context) : SimpleBasePlayer(Looper.getMainLooper()) {

  fun refresh() = invalidateState()

  override fun getState(): State {
    val s = CarState
    val items = s.queue.mapIndexed { i, item ->
      MediaItemData.Builder("$i:${item.id}")
        .setMediaItem(mediaItemFor(context, item))
        .setDurationUs(if (item.durationMs > 0) item.durationMs * 1000 else C.TIME_UNSET)
        .build()
    }
    val hasCurrent = s.index in items.indices
    val commands = Player.Commands.Builder().addAll(
      COMMAND_PLAY_PAUSE,
      COMMAND_PREPARE,
      COMMAND_STOP,
      COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
      COMMAND_SEEK_TO_PREVIOUS,
      COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
      COMMAND_SEEK_TO_NEXT,
      COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
      COMMAND_SEEK_TO_MEDIA_ITEM,
      COMMAND_SET_SPEED_AND_PITCH,
      COMMAND_SET_REPEAT_MODE,
      COMMAND_SET_MEDIA_ITEM,
      COMMAND_CHANGE_MEDIA_ITEMS,
      COMMAND_GET_CURRENT_MEDIA_ITEM,
      COMMAND_GET_TIMELINE,
      COMMAND_GET_METADATA,
    ).build()

    return State.Builder()
      .setAvailableCommands(commands)
      .setPlaylist(items)
      .setCurrentMediaItemIndex(if (hasCurrent) s.index else C.INDEX_UNSET)
      .setPlayWhenReady(s.playing, PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
      .setPlaybackState(
        when {
          !hasCurrent -> STATE_IDLE
          s.buffering -> STATE_BUFFERING
          else -> STATE_READY
        },
      )
      .setContentPositionMs(
        if (s.playing && !s.buffering) {
          PositionSupplier.getExtrapolating(s.positionMs(), s.speed)
        } else {
          PositionSupplier.getConstant(s.positionMs())
        },
      )
      .setPlaybackParameters(PlaybackParameters(s.speed))
      .setRepeatMode(
        when (s.repeat) {
          "all" -> REPEAT_MODE_ALL
          "one" -> REPEAT_MODE_ONE
          else -> REPEAT_MODE_OFF
        },
      )
      .build()
  }

  // Each handler updates the mirrored state right away (so the car doesn't flicker
  // back) and tells JS; JS then sends the real state.

  override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
    CarState.playing = playWhenReady
    CarState.emit(if (playWhenReady) "play" else "pause")
    return done()
  }

  override fun handlePrepare(): ListenableFuture<*> = done()

  override fun handleStop(): ListenableFuture<*> {
    CarState.playing = false
    CarState.emit("pause")
    return done()
  }

  override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
    val s = CarState
    when {
      seekCommand == COMMAND_SEEK_TO_NEXT || seekCommand == COMMAND_SEEK_TO_NEXT_MEDIA_ITEM ->
        s.emit("next")
      seekCommand == COMMAND_SEEK_TO_PREVIOUS || seekCommand == COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM ->
        s.emit("previous")
      mediaItemIndex != s.index && mediaItemIndex >= 0 -> {
        s.index = mediaItemIndex
        s.setPosition(0)
        s.emit("skipTo", "index" to s.offset + mediaItemIndex)
      }
      else -> {
        val ms = if (positionMs == C.TIME_UNSET) 0 else positionMs
        s.setPosition(ms)
        s.emit("seek", "position" to ms / 1000.0)
      }
    }
    return done()
  }

  override fun handleSetPlaybackParameters(playbackParameters: PlaybackParameters): ListenableFuture<*> {
    CarState.speed = playbackParameters.speed
    CarState.emit("speed", "value" to playbackParameters.speed.toDouble())
    return done()
  }

  override fun handleSetRepeatMode(repeatMode: Int): ListenableFuture<*> {
    val mode = when (repeatMode) {
      REPEAT_MODE_ALL -> "all"
      REPEAT_MODE_ONE -> "one"
      else -> "off"
    }
    CarState.repeat = mode
    CarState.emit("repeat", "mode" to mode)
    return done()
  }

  /** The car picked a song from the browse screens (or asked by voice). */
  override fun handleSetMediaItems(
    mediaItems: List<MediaItem>,
    startIndex: Int,
    startPositionMs: Long,
  ): ListenableFuture<*> {
    val item = mediaItems.getOrNull(if (startIndex == C.INDEX_UNSET) 0 else startIndex)
    val query = item?.requestMetadata?.searchQuery
    when {
      item == null -> {}
      item.mediaId.isNotEmpty() -> CarState.emit("playItem", "id" to item.mediaId)
      !query.isNullOrBlank() -> CarState.emit("playSearch", "query" to query)
    }
    return done()
  }

  override fun handleAddMediaItems(index: Int, mediaItems: List<MediaItem>): ListenableFuture<*> {
    mediaItems.firstOrNull()?.let { CarState.emit("playNext", "id" to it.mediaId) }
    return done()
  }

  /** Media3 reads getState() again once the returned future is done. */
  private fun done(): ListenableFuture<*> = Futures.immediateVoidFuture()

  companion object {
    fun mediaItemFor(context: Context, item: CarItem): MediaItem =
      MediaItem.Builder()
        .setMediaId(item.id)
        .setMediaMetadata(
          MediaMetadata.Builder()
            .setTitle(item.title)
            .setArtist(item.subtitle)
            .setSubtitle(item.subtitle)
            .setArtworkUri(ArtworkProvider.uriFor(context, item.artUri))
            .setIsPlayable(item.playable)
            .setIsBrowsable(item.browsable)
            .setMediaType(
              if (item.browsable) MediaMetadata.MEDIA_TYPE_FOLDER_MIXED
              else MediaMetadata.MEDIA_TYPE_MUSIC,
            )
            .build(),
        )
        .build()
  }
}
