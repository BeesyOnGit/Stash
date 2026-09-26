package com.musicapp

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.musicapp.audio.AudioPackage
import com.musicapp.bubble.BubblePackage
import com.musicapp.car.CarPackage
import com.musicapp.car.CarState
import com.musicapp.display.ScreenPackage
import com.twg.video.core.services.playback.CustomMediaNotificationProvider
import com.musicapp.haptics.HapticsPackage
import com.musicapp.karaoke.KaraokePackage
import com.musicapp.update.UpdaterPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(CarPackage()) // Android Auto bridge (src/car/CarBridge.ts)
          add(BubblePackage()) // floating bubble (src/bubble/BubbleBridge.ts)
          add(HapticsPackage()) // button haptics (src/services/haptics.ts)
          add(AudioPackage()) // downloads → M4A (src/services/convert.ts)
          add(UpdaterPackage()) // updates from GitHub Releases (src/services/updater.ts)
          add(ScreenPackage()) // screen kept on in the player (src/services/screen.ts)
          add(KaraokePackage()) // vocal removal + voice mixing (src/services/karaoke.ts)
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    // Notification / lock screen ⏮ ⏭ move through the JS queue (react-native-video
    // is patched for this: patches/react-native-video+*.patch). Same events as the car's.
    CustomMediaNotificationProvider.onSkip = { type ->
      if (CarState.emitter != null) {
        CarState.emit(type)
        true
      } else {
        false
      }
    }
  }
}
