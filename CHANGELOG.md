# Changelog

What's new in each version of stash. When a version is tagged (`v1.2.0`),
its section below becomes the GitHub release notes, which the app also shows
when offering the update.

Add a `## x.y.z` section before tagging `vx.y.z`. The text can be edited
later on GitHub (Releases → Edit) without rebuilding.

## 1.1.5

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
