package com.musicapp

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.musicapp.update.UpdaterModule

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "MusicApp"

  /**
   * react-native-screens: don't restore fragments from a saved instance state,
   * which would crash after the OS kills the app in the background.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    noteUpdateTap(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    noteUpdateTap(intent)
  }

  /** Opened from the "update available" notification: JS shows the update sheet. */
  private fun noteUpdateTap(intent: Intent?) {
    if (intent?.action == UpdaterModule.ACTION_OPEN_UPDATE) UpdaterModule.openRequested = true
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
