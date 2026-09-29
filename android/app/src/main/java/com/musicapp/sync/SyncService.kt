package com.musicapp.sync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.musicapp.R

/**
 * Keeps file transfers with the computer going while the phone is locked or
 * stash is in the background: a foreground service with a progress
 * notification, started and stopped by JS (src/sync/files.ts).
 */
class SyncService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val n = notification(this, intent?.getStringExtra("title") ?: "stash", intent?.getStringExtra("text") ?: "", -1)
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(ID, n)
    }
    return START_NOT_STICKY
  }

  companion object {
    private const val CHANNEL = "sync"
    private const val ID = 4711

    private fun notification(ctx: Context, title: String, text: String, percent: Int): android.app.Notification {
      if (Build.VERSION.SDK_INT >= 26) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
          nm.createNotificationChannel(NotificationChannel(CHANNEL, "Sync", NotificationManager.IMPORTANCE_LOW))
        }
      }
      val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      val tap = open?.let {
        PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }
      return NotificationCompat.Builder(ctx, CHANNEL)
        .setSmallIcon(R.drawable.ic_launcher_foreground)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setContentIntent(tap)
        .apply { if (percent >= 0) setProgress(100, percent, false) else setProgress(0, 0, true) }
        .build()
    }

    fun update(ctx: Context, title: String, text: String, percent: Int) {
      runCatching { NotificationManagerCompat.from(ctx).notify(ID, notification(ctx, title, text, percent)) }
    }
  }
}
