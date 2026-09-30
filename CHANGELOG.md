# Changelog

What's new in each version of stash. When a version is tagged (`v1.2.0`),
its section below becomes the GitHub release notes, which the app also shows
when offering the update/.

Add a `## x.y.z` section before tagging `vx.y.z`. The text can be edited
later on GitHub (Releases → Edit) without rebuilding.

## 1.3.3

- **Desktop app starts again after updating:** on some Windows computers, stash stopped at startup with "database error: there is already another table or index with name listens_v2" after updating to 1.3.2. It now starts normally and repairs the library on its own, and your listening stats are kept.

## 1.3.2

- **Sync your phone and computer over Wi-Fi:** stash on your phone and stash on your computer now keep each other up to date, straight over your own network. No internet, no account, nothing goes through anyone else's servers.
- **Pair once with a QR code:** on the computer, open Settings → Sync with phone → Pair a phone. On the phone, open Settings → Sync with computer → Pair with your computer and scan the code. If the camera can't read it, type the 6-digit code shown under it instead. Everything sent between the two is encrypted.
- **Everything comes along:** your library and the songs themselves, playlists and their order, likes, listening stats (added up across both devices, never counted twice), lyrics, and karaoke recordings. Songs you add on one device show up on the other, and deleting one removes it on both. Your settings stay separate on each device, except the language.
- **Almost instant:** while stash is open on both, a change on one shows up on the other within a second or so. Otherwise they catch up the next time both are open on the same network, and **Sync now** does it right away. Songs being copied show a progress bar with the files left and the time remaining, and a copy that gets cut off picks up where it stopped.
- **Works on your phone's hotspot:** no Wi-Fi router nearby? Connect the computer to the phone's hotspot and they sync just the same.

## 1.3.1

- **Desktop downloads are here:** the Windows and macOS versions are now attached to the release, next to the phone app: the `.exe` (or `.msi`) for Windows and the `.dmg` for macOS (Apple silicon or Intel).
- **Smaller phone app:** the Android download is about a third smaller (around 80 MB instead of 126 MB). It now needs a 64-bit phone, which is almost every phone from the last several years.
- **Karaoke on Intel Macs:** the voice remover isn't available on Intel Macs yet. You can still sing over songs as they are, and everything else works the same. On Apple silicon Macs and Windows, karaoke is unchanged.
- **Linux:** the Linux version is paused for now and isn't part of this release.

## 1.3.0

- **stash for desktop:** stash now runs on Windows, macOS and Linux too, with everything the phone app does — your library, search across your library and free sources, saving while you stream, playlists and automatic playlists, genres, stats, synced lyrics (paste your own, or pick other ones), similar songs and random suggestions, sleep timer, playback speed, crossfade, song change animations, the vinyl styles and karaoke with the voice remover. Download it from this release: the `.exe` (or `.msi`) for Windows, the `.dmg` for macOS (Apple silicon or Intel), the `.AppImage`, `.deb` or `.rpm` for Linux.
- **Made for a big screen:** a sidebar with your playlists, a Now playing panel beside the library (drag its edge to resize it), a full-screen player (F), and keyboard shortcuts: Space to play or pause, L for lyrics, Ctrl+← / → to skip, Ctrl+K to search. The keyboard's media keys and the system's media controls work too.
- **Keeps playing in the background:** closing the window keeps the music going in the tray (Quit is in the tray menu). While stash is minimised or in the tray, a **mini vinyl player** floats over your other windows: drag it anywhere, drop it on ✕ to hide it, click it for controls, your favorites and suggestions.
- **Your files, where you expect them:** saved songs go to your Music/stash folder and karaoke takes to Music/Karaoke. Settings → Scan for music adds the music in your Music and Downloads folders, and brings back songs stash saved before.
- **Updates itself:** new versions are offered when stash starts (or Settings → Check for updates), checked against their signature, installed, and stash restarts — your library stays as it is.

## 1.2.0

- **Karaoke:** sing any song on your phone. Tap the new mic button in the player (or Karaoke in a song's ••• menu), then choose **Remove the vocals** or **Sing over the song** as it is, for songs that are already instrumental or karaoke versions. The lyrics scroll with the music, and **Sing** records you over it (use headphones so the mic only hears you). Afterwards, listen back, set your voice volume and timing, and save it (Android).
- **Vocals removed on your phone:** an AI voice remover (UVR-MDX-NET Inst HQ 4, from Ultimate Vocal Remover) takes the singer out of the song. It isn't built into the app: it downloads once (59 MB) the first time you use karaoke, then works offline. Nothing is sent anywhere.
- **Sing sooner:** the instrumental plays while it's still being made. The app measures how fast your phone is and tells you when you can start ("Ready to sing in about 1:20") so the music never catches up with the making. If it ever falls behind, the music and your recording pause together, so you stay in time. On older phones it takes a few minutes the first time; after that a song opens instantly.
- **Karaoke recordings:** your saved performances are listed under Saving, grouped by song. Play them, rename or delete them, share them, or tap **Show in folder** to open them in your file manager. They're saved in the phone's Music/Karaoke folder, so other music apps see them too.
- **Paste your own lyrics:** tap **Paste yours** under the lyrics (or **Paste lyrics** when none are found) to use your own words instead. Timed lyrics in LRC format (`[01:23.45] …`) follow the song; plain text just scrolls.

## 1.1.7

- **stash speaks your language:** the app now comes in English, French, Arabic, Spanish and German, and uses your phone's language by default (English if it isn't one of these). Pick another one in Settings → Language. In Arabic the app is laid out right to left; switching to or from Arabic takes effect after restarting stash.
- **Listening stats:** a new Stats tab in the bottom bar shows how long you've listened over the last 7 days, 30 days or all time, with plays, songs, a daily average, your day streak, your favourite hour and how much of your library you've played. Charts show listening per day (per month for all time) and by hour of the day; tap a bar for its value. Top songs, artists and genres are listed with their listening time. Time is counted as you listen, so stats start from this version.
- **Swipe the cover:** in the player, swipe the cover left for the next song and right for the one before. It moves with your finger, with the next or previous cover coming in beside it, and carries on into the new song when you let go.
- **Arrange the queue:** in the Queue, drag a song by its ≡ handle to move it, or swipe it sideways to take it out of the queue (it stays in your library).
- **Reorder playlists:** drag songs by their ≡ handle to put a playlist in the order you want.
- **Add to queue:** the song menu has "Add to queue" next to "Play next", to play a song after everything that's already coming up.
- **Details right away for downloads:** a downloaded song gets its official name, cover, album and genre as the download starts. If that can't happen then (for example offline), they're looked up again when the download finishes.

## 1.1.6

- **Choose the song change animation:** Slide (the page swipes toward the next or previous song), Fade (the song fades out, then the next one fades in), Zoom (the song shrinks away and the next one settles in) or Flip (cover, title and waveform flip over like a card). Settings → Appearance → Song change.
- **Screen stays on in the player:** the screen doesn't turn off while the full player is open. It can be turned off in Settings → Appearance (Android).
- **Tidier player:** the chips under the title (song status, Save offline, Random, sleep timer) show their full text when there's room. When the row gets crowded they shrink to icons one at a time, in that order.
- **Crossfade:** each song can fade into the next over 2 to 12 seconds (Settings → Listening → Crossfade; off by default). It works with the screen off, and skipping or pausing ends it cleanly (Android).

## 1.1.5

- **Official song names and covers:** songs are looked up on Deezer and iTunes, so they get their real title and artist (not "Artist - Title (Clip Officiel)" from the video, or the uploader's channel name), the album, the genre and the album cover instead of a video frame. A song is only renamed when it's clearly the same recording: instrumentals, covers, remixes and live versions keep their own names. Songs no catalogue has get the artist's picture as a cover. Songs already in the library are updated in the background. Can be turned off in Settings → Look up song details.
- **Song change animation:** on Next and Previous, the background, cover, title and waveform slide over like a page, the new song coming in from its side (right for Next, left for Previous). The buttons stay in place.
- **No more pause between songs:** the next song is loaded 15 seconds before the current one ends and starts right as it finishes, with the screen off too. Online songs no longer wait to connect when their turn comes (Android).
- **Sleep timer:** pause the music in 15, 30, 45, 60 or 90 minutes, or at the end of the song. The last 30 seconds fade out, and it works with the screen off. Set it from the song's ••• menu in the player; a moon chip shows the time left.
- **Previous and next on the lock screen and notification**, instead of skipping back and forward 10 seconds (Android).
- **Select several songs:** long-press a song in Library → Songs, tap more, then play them, add them to a playlist, like them or remove them all at once.
- **Automatic playlists:** Recently added, Most played and Downloaded, under Library → Playlists. A song counts as played after 30 seconds of listening.

## 1.1.4

- **Smoother progress bar:** the played part moves continuously through the bars instead of jumping bar by bar.

## 1.1.3

- **Waveforms work in installed versions.** The bars now follow the song on release builds too; before, they showed a placeholder shape.
- **Downloads survive uninstalling:** saved songs now live in the phone's Music/stash folder. After reinstalling, Settings → Scan for music brings them back.
- **Update notification:** a notification stays until you update; tap it to open the update.
- **Repeat works with the screen off**, and moving to the next song keeps working in the background.
- **Play button fixed** after the music was stopped by the system (for example after closing the app from recent apps).
- Tidier player when random suggestions and "Save offline" are both showing.

## 1.1.2

- First release built on GitHub, with in-app updates.
