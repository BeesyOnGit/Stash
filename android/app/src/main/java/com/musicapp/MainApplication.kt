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
import com.musicapp.haptics.HapticsPackage

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
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
