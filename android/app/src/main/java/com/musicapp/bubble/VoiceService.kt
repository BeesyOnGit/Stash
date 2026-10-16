package com.musicapp.bubble

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.musicapp.R

/**
 * Keeps the microphone on in a huddle's voice chat while the screen is locked:
 * Android only lets an app record in the background from a foreground service
 * of type microphone. Started and stopped by JS (src/huddle/index.ts).
 */
class VoiceService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (Build.VERSION.SDK_INT >= 26) {
      val nm = getSystemService(NotificationManager::class.java)
      if (nm.getNotificationChannel(CHANNEL) == null) {
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Voice", NotificationManager.IMPORTANCE_LOW))
      }
    }
    val tap = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val n = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.ic_launcher_foreground)
      .setContentTitle(intent?.getStringExtra("title") ?: "stash")
      .setContentText(intent?.getStringExtra("text") ?: "")
      .setOngoing(true)
      .setSilent(true)
      .setContentIntent(tap)
      .build()
    if (Build.VERSION.SDK_INT >= 30) {
      startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(ID, n)
    }
    return START_NOT_STICKY
  }

  companion object {
    private const val CHANNEL = "voice"
    private const val ID = 4712
  }
}
