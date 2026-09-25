# Changelog

What's new in each version of stash. When a version is tagged (`v1.2.0`),
its section below becomes the GitHub release notes, which the app also shows
when offering the update.

Add a `## x.y.z` section before tagging `vx.y.z`. The text can be edited
later on GitHub (Releases → Edit) without rebuilding.

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
