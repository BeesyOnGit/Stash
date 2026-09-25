package com.musicapp.car

import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.facebook.react.ReactApplication
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.musicapp.R

/**
 * What Android Auto connects to: the browse screens (Library, Playlists, For you)
 * and the now-playing screen with Like / Speed / Shuffle buttons.
 *
 * Audio still comes from the app's own player; this session only mirrors it
 * (see [CarPlayer]). It never posts a notification of its own, since the app's
 * player already shows one.
 */
@OptIn(UnstableApi::class)
class CarService : MediaLibraryService() {
  private lateinit var player: CarPlayer
  private var session: MediaLibrarySession? = null

  override fun onCreate() {
    super.onCreate()
    player = CarPlayer(this)
    session = MediaLibrarySession.Builder(this, player, Callback())
      .setId("stash-car")
      .setCustomLayout(buttons())
      .build()

    CarState.onPlaybackChanged = {
      player.refresh()
      session?.setCustomLayout(buttons())
    }
    CarState.onTreeChanged = { parents ->
      val s = session
      if (s != null) {
        for (id in parents) s.notifyChildrenChanged(id, childrenOf(id).size, null)
      }
    }
    startJs()
    CarState.emit("connected")
  }

  /** The car can open the app while it isn't running: start JS without a screen. */
  private fun startJs() {
    try {
      (application as ReactApplication).reactHost?.start()
    } catch (_: Exception) {}
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  /** No second notification: react-native-video's service already shows one. */
  override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) {}

  override fun onDestroy() {
    CarState.onPlaybackChanged = null
    CarState.onTreeChanged = null
    session?.release()
    session = null
    player.release()
    super.onDestroy()
  }

  // ---- buttons on the car's now-playing screen ----

  private fun buttons(): ImmutableList<CommandButton> {
    val s = CarState
    val list = mutableListOf<CommandButton>()
    if (s.canLike) {
      list += button(
        CMD_LIKE,
        s.likeLabel.ifEmpty { if (s.liked) "Unlike" else "Like" },
        if (s.liked) R.drawable.ic_car_heart_filled else R.drawable.ic_car_heart,
      )
    }
    list += button(
      CMD_SPEED,
      s.speedLabel.ifEmpty { "Speed ${formatSpeed(s.speed)}×" },
      R.drawable.ic_car_speed,
    )
    list += button(
      CMD_SHUFFLE,
      s.shuffleLabel.ifEmpty { if (s.shuffle) "Shuffle off" else "Shuffle on" },
      if (s.shuffle) R.drawable.ic_car_shuffle_on else R.drawable.ic_car_shuffle,
    )
    return ImmutableList.copyOf(list)
  }

  private fun button(action: String, name: String, icon: Int) =
    CommandButton.Builder()
      .setSessionCommand(SessionCommand(action, Bundle.EMPTY))
      .setDisplayName(name)
      .setIconResId(icon)
      .build()

  private fun formatSpeed(v: Float) =
    if (v == v.toInt().toFloat()) v.toInt().toString() else v.toString()

  // ---- browse tree ----

  private fun childrenOf(parentId: String): List<CarItem> =
    if (parentId == CarState.ROOT_ID) CarState.roots else CarState.children[parentId].orEmpty()

  private fun rootItem(): MediaItem =
    MediaItem.Builder()
      .setMediaId(CarState.ROOT_ID)
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle("stash")
          .setIsBrowsable(true)
          .setIsPlayable(false)
          .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
          .build(),
      )
      .build()

  private inner class Callback : MediaLibrarySession.Callback {
    override fun onConnect(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
    ): MediaSession.ConnectionResult {
      val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
        .add(SessionCommand(CMD_LIKE, Bundle.EMPTY))
        .add(SessionCommand(CMD_SPEED, Bundle.EMPTY))
        .add(SessionCommand(CMD_SHUFFLE, Bundle.EMPTY))
        .build()
      return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
        .setAvailableSessionCommands(commands)
        .build()
    }

    override fun onCustomCommand(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      customCommand: SessionCommand,
      args: Bundle,
    ): ListenableFuture<SessionResult> {
      when (customCommand.customAction) {
        CMD_LIKE -> CarState.emit("like")
        CMD_SPEED -> CarState.emit("cycleSpeed")
        CMD_SHUFFLE -> CarState.emit("shuffle")
      }
      return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
    }

    override fun onGetLibraryRoot(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      // Songs as lists, playlists and genres as a grid.
      val extras = Bundle().apply {
        putInt(CONTENT_STYLE_PLAYABLE, STYLE_LIST)
        putInt(CONTENT_STYLE_BROWSABLE, STYLE_GRID)
      }
      val rootParams = LibraryParams.Builder().setExtras(extras).build()
      return Futures.immediateFuture(LibraryResult.ofItem(rootItem(), rootParams))
    }

    override fun onGetChildren(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      if (!CarState.treeReady) CarState.emit("connected")
      val all = childrenOf(parentId)
      val from = (page.toLong() * pageSize).coerceAtMost(all.size.toLong()).toInt()
      val to = (from.toLong() + pageSize).coerceAtMost(all.size.toLong()).toInt()
      val items = all.subList(from, to).map { CarPlayer.mediaItemFor(this@CarService, it) }
      return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(items), params))
    }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      if (mediaId == CarState.ROOT_ID) return Futures.immediateFuture(LibraryResult.ofItem(rootItem(), null))
      val found = (CarState.roots.asSequence() + CarState.children.values.asSequence().flatten())
        .firstOrNull { it.id == mediaId }
        ?: return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE))
      return Futures.immediateFuture(
        LibraryResult.ofItem(CarPlayer.mediaItemFor(this@CarService, found), null),
      )
    }

    /** Items picked in the car carry only an id; JS knows what to play for it. */
    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: List<MediaItem>,
    ): ListenableFuture<List<MediaItem>> = Futures.immediateFuture(mediaItems)
  }

  companion object {
    private const val CMD_LIKE = "stash.like"
    private const val CMD_SPEED = "stash.speed"
    private const val CMD_SHUFFLE = "stash.shuffle"

    // Android Auto content-style hints.
    private const val CONTENT_STYLE_PLAYABLE = "android.media.browse.CONTENT_STYLE_PLAYABLE_HINT"
    private const val CONTENT_STYLE_BROWSABLE = "android.media.browse.CONTENT_STYLE_BROWSABLE_HINT"
    private const val STYLE_LIST = 1
    private const val STYLE_GRID = 2
  }
}
