package com.musicapp.update

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import com.musicapp.R
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.io.File

/** Serves the downloaded update APK to the system installer (own class: no clash with other libraries' providers). */
class UpdateFileProvider : FileProvider()

/** JS side: src/services/updater.ts. Installs new versions downloaded from GitHub Releases. */
class UpdaterModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  override fun getName() = NAME

  /** The installed version, and whether this is a development build (those don't self-update). */
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun info(): WritableMap {
    val ctx = reactApplicationContext
    val pkg = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
    @Suppress("DEPRECATION")
    val code = if (Build.VERSION.SDK_INT >= 28) pkg.longVersionCode else pkg.versionCode.toLong()
    return Arguments.createMap().apply {
      putString("versionName", pkg.versionName ?: "")
      putDouble("versionCode", code.toDouble())
      putBoolean("debug", ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
    }
  }

  /** Android 8+: has the user allowed stash to install apps? */
  @ReactMethod
  fun canInstall(promise: Promise) {
    promise.resolve(
      Build.VERSION.SDK_INT < 26 || reactApplicationContext.packageManager.canRequestPackageInstalls(),
    )
  }

  /** Opens the "Install unknown apps" switch for stash. */
  @ReactMethod
  fun openInstallPermission() {
    if (Build.VERSION.SDK_INT < 26) return
    val ctx = reactApplicationContext
    ctx.startActivity(
      Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }

  /** Hands the APK to Android's installer, which asks the user to confirm. */
  @ReactMethod
  fun install(path: String, promise: Promise) {
    try {
      val ctx = reactApplicationContext
      val file = File(path.removePrefix("file://"))
      val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".updates", file)
      ctx.startActivity(
        Intent(Intent.ACTION_VIEW)
          .setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
      )
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("install_failed", e.message ?: e.toString(), e)
    }
  }

  // ---- "update available" notification ----

  /**
   * Stays in the notification shade (can't be swiped away) until the app is
   * updated or it's cancelled; tapping it opens the app on the update sheet.
   */
  @ReactMethod
  fun showNotification(version: String, text: String) {
    val ctx = reactApplicationContext
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
          description = "When a new version of stash is available"
        },
      )
    }
    val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.apply {
      action = ACTION_OPEN_UPDATE
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    } ?: return
    val tap = PendingIntent.getActivity(
      ctx,
      0,
      open,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val n = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(R.drawable.ic_stat_update)
      .setColor(0xFFE0532F.toInt())
      .setContentTitle("stash $version is available")
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setContentIntent(tap)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .build()
    try {
      NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, n)
    } catch (_: SecurityException) {
      // Notifications not allowed: the in-app sheet still shows the update.
    }
  }

  @ReactMethod
  fun cancelNotification() {
    NotificationManagerCompat.from(reactApplicationContext).cancel(NOTIFICATION_ID)
  }

  /** True once after the notification was tapped (MainActivity records it). */
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun takeOpenRequest(): Boolean {
    val asked = openRequested
    openRequested = false
    return asked
  }

  companion object {
    const val NAME = "StashUpdater"
    const val ACTION_OPEN_UPDATE = "com.musicapp.OPEN_UPDATE"
    private const val CHANNEL = "updates"
    private const val NOTIFICATION_ID = 7301

    /** Set by MainActivity when it's opened from the update notification. */
    @Volatile
    var openRequested = false
  }
}
