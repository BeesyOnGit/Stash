# Changelog

What's new in each version of stash. When a version is tagged (`v1.2.0`),
its section below becomes the GitHub release notes, which the app also shows
when offering the update/.

Add a `## x.y.z` section before tagging `vx.y.z`. The text can be edited
later on GitHub (Releases → Edit) without rebuilding.

## 1.3.6

- **Guess the song:** in a huddle, tap **Guess the song** and pick a mystery song from the shared playlist or a search. It plays with the cover blurred, and everyone else has 20 seconds to pick it from 4 similar songs. The fastest right answers get 3, 2 and 1 points. Then the answer is revealed with who picked what and a leaderboard, and the music goes back to where it was.
- **Reaction streaks:** when the same reaction is sent 3 or more times in a row within a couple of seconds, a big burst plays for everyone with a "4× streak" label.
- **Shoutouts:** add a short message when you add a song. It shows under the song in the shared playlist and pops up for everyone when the song starts.
- **Room vibe:** a glow behind the cover pulses while music plays, a chip names the mood from the song's genre (for example "Dreamy vibe"), and the playlist and chat are tinted to match.
- **Taste match:** each member's avatar shows how closely your tastes match. It goes up when you react to the same songs the same way.
- **Members and recap:** the **⋯** menu opens the members list (host, taste match, songs added and reactions for each person, plus the invite code) and a recap of the huddle: time together, songs played, messages, the most-loved song, the top reaction and best streak, the MVP DJ and the Guess the song champion. Share it from there.
- **A livelier chat:** everyone's messages are in bubbles. Tap a message to react with one of 6 quick emoji, or to edit your own; edited messages say so. The chat box has an emoji picker with about 220 emoji in 6 groups, and the host's reaction editor uses the same set.
- **Download huddle songs:** save the song that's playing, or any song in the shared playlist, to your library. Progress shows while it downloads.
- **Volume in the huddle (computer):** the huddle player has the same volume and mute control as the main player.
- **Pick your colour:** choose your colour before starting or joining a huddle. Others see it on your avatar, your messages and the songs you add.
- **You stay you:** if your connection drops and comes back, you rejoin as the same person, keeping your songs and, if you were the host, the host role.
- **Your songs, your call:** everyone can remove or reorder the songs they added; the host can manage all of them.
- **Google emoji on the computer:** reactions and chat use the same emoji style as Android.
- **Typing on the phone:** the keyboard no longer hides the huddle's text boxes. While you type, the top of the huddle shrinks so the chat or song list stays in view.

## 1.3.5

- **Huddle: listen together:** start a huddle from the button at the top of the Library (on the phone) or in the sidebar (on the computer), give it a name and share its 6-character code. Friends join with the code, on a phone or a computer.
- **Same song, same second:** a song only starts once everyone has it, and then starts at the same instant for all. If someone's player drifts off, it's pulled back in step. Songs are fetched on each device ahead of time, so the next one is ready when the current one ends.
- **A shared playlist and shared controls:** everyone can add songs from their library or from a search of free sources, reorder or remove them, and play, pause, skip or jump for everyone. The huddle shows who did what last. Songs that only exist as files on one device can't be shared, since the others have no way to get them.
- **Chat and reactions:** talk in the huddle's chat and send reactions that float up everyone's screen. The host picks which reactions (up to 8) the huddle uses.
- **Nothing kept:** a huddle isn't saved anywhere. It ends a few minutes after the last person leaves, and the songs fetched for it aren't added to your library.

## 1.3.4

- **Add songs straight from a playlist:** open a playlist and tap **+** next to Play and Shuffle. Search your library, tick the songs you want and tap **Add**. Songs already in the playlist aren't listed.
- **Lock screen buttons in the right order:** the lock screen showed two "previous" buttons and put "next" on the wrong side. It now shows previous, play/pause and next, like any music player.
- **Car and headphone buttons work:** next, previous and play/pause on a car stereo, steering wheel or Bluetooth headphones now control stash.
- **Music plays through the car with Android Auto:** stash now plays through the car's speakers when you pick a song in Android Auto. Before, it played but the car didn't switch to it. Navigation instructions no longer pause the music either: it keeps playing under them.
- **Other music apps pause when stash plays:** starting a song in stash now pauses music playing in another app, like other music players do.

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
