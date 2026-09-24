# stash

*Your library first, the open web second.*

An offline-first music player for Android (iOS builds too, with fewer features).
It plays the music on your phone, finds more online when you search, and keeps
what you listen to so it plays offline next time.

Plain React Native CLI app (no Expo), React Native 0.87, New Architecture.

## Features

**Library**
- Songs on the phone and songs you've saved live in one local library (SQLite) and play without a connection.
- Liked songs, playlists and genres. Phone music is added when you ask: Settings → This phone → Scan for music.
- Cover art and genres looked up automatically and stored on the phone.

**Search and saving**
- Search looks in your library first, then online sources.
- Online songs start playing right away and are saved at the same time, so the second play is offline. Saved files are always M4A, and nothing is ever saved twice.
- A storage limit you choose, and a Saving tab to see what's saving and saved.

**Player**
- Queue, shuffle, repeat, and a waveform seek bar drawn from the song itself.
- The cover can spin like a vinyl record (four styles) or show as a plain square.
- Playback speed from 0.5× to 2× with the pitch kept the same.
- **Lyrics**: synced lyrics that follow the song (tap a line to jump there) or plain text, saved for offline. Sources: `.lrc` files next to your songs, [LRCLIB](https://lrclib.net), then an online fallback. "Wrong lyrics?" lets you pick another match.
- **Similar songs** and a **random suggestions** mode that keeps playing related music, online or offline, until you turn it off.
- Mini player above the tabs: tap to open, ✕ or swipe sideways to stop.

**Android extras**
- **Floating bubble** over other apps while music plays in the background: drag it, drop it on ✕ to hide it, tap it for a card with controls, favorites and suggestions.
- **Android Auto**: library, playlists and suggestions in the car, with Like, Speed and Shuffle buttons and voice search.
- **Haptic feedback** on buttons, light / medium / strong.
- Background playback with notification and lock-screen controls.
- **Updates from GitHub Releases**: new versions are offered when the app starts (or Settings → Check for updates), downloaded, checked against their checksum and installed over the old one, keeping your library.

## Build

Requirements:
- Node.js ≥ 22.11, JDK 17
- Android SDK (Android Studio) with platform 36, build-tools and NDK 27.1.12297006 (Gradle downloads the NDK if missing)
- An Android phone with USB debugging, or an emulator
- iOS: a Mac with Xcode 16+ and CocoaPods (`bundle install && bundle exec pod install` in `ios/`)

```sh
npm install
npm start          # Metro, keep it running
npm run android    # in a second terminal, with the phone plugged in
```

Releases are built by GitHub Actions (`.github/workflows/release.yml`): push a tag like `v1.2.0` and a signed APK is published as a GitHub Release, which installed apps then offer as an update. It needs the signing key in the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`.

Local release APK: `cd android && ./gradlew assembleRelease`. Set up your own signing key first (`STASH_UPLOAD_STORE_FILE` and friends in `~/.gradle/gradle.properties`), and keep it: updates must be signed with the same key.

Runs on Android 7.0+ (minSdk 24) and iOS 15.1+. For the optional [Jamendo](https://devportal.jamendo.com) catalogue, add a free client id in Settings.

## Project layout

```
App.tsx, index.js               startup; background bridges (car, bubble)
src/
  player/PlayerService.ts       the one app-wide player and queue (outside React)
  player/hooks.ts               React hooks for the player and the library
  sources/                      online sources (each implements MusicSource)
  services/
    downloader.ts               saves songs while they stream
    convert.ts                  makes every saved file an M4A
    lyrics.ts                   lyrics lookup, matching and caching
    similar.ts                  similar songs, with an offline fallback
    waveform.ts                 the player's waveform from the audio file
    keepAlive.ts                keeps work going while the app is in the background
    updater.ts                  checks GitHub Releases and installs new versions
    haptics.ts, settings.ts, artwork.ts, deviceScanner.ts, storage.ts …
  bubble/BubbleBridge.ts        floating bubble (Android)
  car/CarBridge.ts              Android Auto
  db/database.ts                SQLite schema and queries
  screens/, components/, ui/    the interface
android/app/src/main/java/com/musicapp/
  bubble/                       overlay windows for the floating bubble
  car/                          Android Auto service
  audio/                        M4A conversion with the phone's codecs
  haptics/                      button haptics
  update/                       hands downloaded updates to Android's installer
```

## How a few things work

**Stream and save at once.** Picking an online song resolves its audio URL, then starts playback and a download of the same file side by side. When the file is complete the song plays from the phone from then on; if the download fails, the partial file is removed. The first listen uses about twice the data of the song.

**Android Auto.** `CarService` is a Media3 `MediaLibraryService` serving a browse tree built in JS. `CarPlayer` is a remote control that plays nothing: it mirrors the app's player and forwards button presses to JS, so there's still exactly one player. To try it without a car, use the Android Auto *Desktop Head Unit* from the SDK Manager.

**Floating bubble.** Native overlay windows (`SYSTEM_ALERT_WINDOW`, asked for when you turn the bubble on). Native code decides when it shows; JS keeps it up to date and plays what you tap. Android pauses JS timers in the background, so work started from the bubble runs inside a short headless task (`keepAlive.ts`).

## Known limitations

- The notification and lock screen have play/pause and seek; next/previous are in the app and the bubble.
- `react-native-video` v7 is a beta: `7.0.0-beta.11` is the tested version.
- On iOS the library holds saved songs only (apps can't read the Music library's files), and there's no bubble, haptics or car support yet.
- Phone files take their title and artist from the file name (`Artist - Title.mp3`); tags aren't read yet.

## Credits

stash is built on the work of these open-source projects. Thank you to their authors and contributors.

**App**

| Project | License |
| --- | --- |
| [React](https://github.com/facebook/react) and [React Native](https://github.com/facebook/react-native) | MIT |
| [React Navigation](https://github.com/react-navigation/react-navigation) (native, native-stack, bottom-tabs) | MIT |
| [react-native-screens](https://github.com/software-mansion/react-native-screens), [react-native-svg](https://github.com/software-mansion/react-native-svg), [react-native-audio-api](https://github.com/software-mansion/react-native-audio-api) (Software Mansion) | MIT |
| [react-native-video](https://github.com/TheWidlarzGroup/react-native-video) (TheWidlarzGroup) | MIT |
| [Nitro Modules](https://github.com/mrousavy/nitro) (Marc Rousavy) | MIT |
| [op-sqlite](https://github.com/OP-Engineering/op-sqlite) (OP Engineering) | MIT |
| [react-native-blob-util](https://github.com/RonRadtke/react-native-blob-util) | MIT |
| [react-native-safe-area-context](https://github.com/AppAndFlow/react-native-safe-area-context) | MIT |
| [NetInfo](https://github.com/react-native-netinfo/react-native-netinfo) | MIT |
| [react-native-url-polyfill](https://github.com/charpeni/react-native-url-polyfill) | MIT |
| [event-target-polyfill](https://github.com/benlesh/event-target-polyfill) | MIT |
| [fast-text-encoding](https://github.com/samthor/fast-text-encoding) | Apache-2.0 |
| [youtubei.js](https://github.com/LuanRT/YouTube.js) (LuanRT) | MIT |

**Android**

| Project | License |
| --- | --- |
| [AndroidX Media3](https://github.com/androidx/media) | Apache-2.0 |
| [Guava](https://github.com/google/guava) | Apache-2.0 |
| [Kotlin](https://github.com/JetBrains/kotlin) | Apache-2.0 |

**Bundled inside react-native-audio-api** (audio decoding for the waveform)

| Project | License |
| --- | --- |
| [FFmpeg](https://ffmpeg.org) (prebuilt, dynamically linked) | LGPL-2.1-or-later |
| [miniaudio](https://github.com/mackron/miniaudio) (David Reid) | Public domain / MIT-0 |
| [Opus](https://opus-codec.org), [Vorbis and Ogg](https://xiph.org) (Xiph.Org Foundation) | BSD-3-Clause |
| [PFFFT](https://bitbucket.org/jpommier/pffft) (Julien Pommier) | FFTPACK / BSD-like |
| [moodycamel::ConcurrentQueue](https://github.com/cameron314/concurrentqueue) (Cameron Desrochers) | Simplified BSD / Boost |

FFmpeg is licensed under the GNU Lesser General Public License, version 2.1 or later. Its source code is available at <https://ffmpeg.org/download.html>.

**Fonts**

[Geist and Geist Mono](https://github.com/vercel/geist-font) by Vercel, under the SIL Open Font License 1.1 (see `assets/fonts/OFL-Geist.txt`).

**Services**

- Lyrics from [LRCLIB](https://lrclib.net), a free, community-built lyrics database.
- Cover art and genres from the [iTunes Search API](https://performance-partners.apple.com/search-api).
- Creative Commons music from [Jamendo](https://www.jamendo.com) (optional).

Development tools: TypeScript, Babel, Jest, ESLint and Prettier (all MIT or Apache-2.0).

## License

stash is open source under the [MIT License](LICENSE): use it, change it and share it freely, as long as the copyright notice stays with it. The projects in Credits keep their own licenses.

## Note

A personal project, shared as is. Most of stash, its code and its design, was created by AI, with the author directing it, reviewing the results and testing them on real phones. Please respect the terms of the services you connect it to and the rights of the artists you listen to.
