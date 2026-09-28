/** Texts only the desktop app has (window, tray, mini player, keyboard…). Keys start with `desktop.`. */
import { defineStrings } from '../types';

const en = {
  // Window
  'desktop.searchPlaceholder': 'Search your library and free sources',
  'desktop.minimize': 'Minimize — music keeps playing',
  'desktop.maximize': 'Maximize',
  'desktop.closeToTray': 'Close to tray — music keeps playing',
  'desktop.resizeHint': 'Drag to resize · double-click to reset',
  'desktop.trayOpen': 'Open stash',
  'desktop.trayQuit': 'Quit stash',
  // Sidebar
  'desktop.playlists': 'Playlists',
  'desktop.storageOf': 'of {size}',
  // Library
  'desktop.allOffline': {
    one: '{count} song · {size} · all play offline',
    other: '{count} songs · {size} · all play offline',
  },
  'desktop.colTitle': 'Title',
  'desktop.colGenre': 'Genre',
  'desktop.colTime': 'Time',
  'desktop.selectHint': 'Press and hold a song (or Ctrl-click) to select several',
  'desktop.libraryEmpty':
    'No music yet. Scan your Music folder in Settings, or find songs in Search — they save while you listen.',
  'desktop.smartRecentSub': 'newest first',
  'desktop.smartMostSub': 'counted after 30 s',
  'desktop.smartDownloadedSub': 'saved from the web',
  'desktop.removeBody':
    'Saved songs are deleted from the computer. Your own music files are only hidden until the next scan.',
  // Search
  'desktop.searchTry': 'Type in the search bar above, or try:',
  // Saving
  'desktop.recordingsEmpty':
    'Use Karaoke in the player to sing — your takes land here, in Music/Karaoke.',
  'desktop.takes': { one: '{count} take', other: '{count} takes' },
  'desktop.modeNoVocals': 'no vocals',
  'desktop.modeOverSong': 'over song',
  'desktop.playRecording': 'Play recording',
  'desktop.shareHint': 'Share — save a copy anywhere',
  'desktop.shared': 'Saved a copy of “{name}”',
  'desktop.deleteHint': 'The file is deleted from Music/Karaoke.',
  // Stats
  'desktop.statPlays': 'Plays',
  'desktop.statSongs': 'Songs',
  'desktop.statDaily': 'Daily average',
  'desktop.statLibrary': 'Library played',
  'desktop.lastWeek': 'in the last 7 days',
  'desktop.lastMonth': 'in the last 30 days',
  'desktop.allTime': 'since you started listening',
  'desktop.tapBar': 'Click a bar for its value',
  'desktop.statsFootnote': 'Time is counted as you listen.',
  // Settings
  'desktop.sectionLibrary': 'Library',
  'desktop.sectionKaraoke': 'Karaoke',
  'desktop.sectionKeyboard': 'Keyboard',
  'desktop.scanSub':
    'Your Music and Downloads folders — also brings back songs saved in Music/stash after reinstalling',
  'desktop.scanDone': {
    one: '{count} song found on this computer ({added} new)',
    other: '{count} songs found on this computer ({added} new)',
  },
  'desktop.scan': 'Scan',
  'desktop.open': 'Open',
  'desktop.miniPlayer': 'Mini vinyl player',
  'desktop.miniPlayerSub':
    'Floats above other windows while stash is minimised or closed to the tray.',
  'desktop.miniColour': 'Mini player progress colour',
  'desktop.vinylStyleSub': 'Used in the Now playing panel and the mini player',
  'desktop.playerBackgroundSub': 'Adapts to each song’s cover',
  'desktop.keepAwake': 'Keep the screen on in full screen',
  'desktop.keepAwakeSub':
    'The display doesn’t go to sleep while the full-screen player is open',
  'desktop.languageSub': 'Uses your system language by default',
  'desktop.systemLanguage': 'System language · {name}',
  'desktop.languageHint':
    'Uses your system language by default. Arabic switches the layout to right-to-left after a restart.',
  'desktop.restartBanner':
    'Restart stash to switch to {name} — the layout direction changes.',
  'desktop.restart': 'Restart',
  'desktop.voiceRemover': 'Voice remover',
  'desktop.voiceRemoverReady': '{name} · {size} · works offline',
  'desktop.voiceRemoverMissing':
    'Downloads once ({size}) the first time you remove vocals',
  'desktop.voiceRemoverDeleted': 'Voice remover deleted — {size} freed',
  'desktop.recordingsIn': {
    one: '{count} recording · in Music/Karaoke',
    other: '{count} recordings · in Music/Karaoke',
  },
  'desktop.youtubeDevice': 'On this computer',
  'desktop.youtubeDeviceHint':
    'Searches YouTube Music and gets the audio directly from this computer — no server needed. Songs are saved in their original quality.',
  'desktop.checkUpdatesSub':
    'New versions from GitHub are offered at every start',
  'desktop.devBuild': 'Development build — updates come with released versions',
  'desktop.version': 'Version {version} · desktop',
  'desktop.keyPlayPause': 'Play / pause',
  'desktop.keyLyrics': 'Show or hide lyrics',
  'desktop.keyFull': 'Full-screen player',
  'desktop.keySkip': 'Next or previous song',
  'desktop.keySearch': 'Search',
  'desktop.keyEsc': 'Close a dialog, the full screen or the mini player card',
  // Player
  'desktop.lyrics': 'Lyrics',
  'desktop.sleep': 'Sleep',
  'desktop.upNext': 'Up next',
  'desktop.fullScreen': 'Full screen (F)',
  'desktop.exitFullScreen': 'Exit full screen (Esc)',
  'desktop.volume': 'Volume',
  'desktop.mute': 'Mute',
  'desktop.unmute': 'Unmute',
  'desktop.hidePanel': 'Hide panel',
  'desktop.nowPlayingPanel': 'Now playing panel',
  'desktop.dragCover': 'Drag sideways for next or previous',
  'desktop.queueHint': 'Drag ≡ to reorder · swipe a song sideways to take it out',
  'desktop.takenOut': 'Taken out of the queue — still in your library',
  'desktop.repeat': 'Repeat',
  'desktop.similarSongs': 'Similar songs',
  'desktop.playPauseKey': 'Play / pause (Space)',
  'desktop.lyricsKey': 'Lyrics (L)',
  'desktop.useLyrics': 'Use these lyrics',
  'desktop.backToFound': 'Go back to found lyrics',
  'desktop.editYours': 'Edit yours',
  'desktop.usingYours': 'Using your lyrics',
  'desktop.lyricsOfflineHint':
    'Lyrics are looked up online the first time, then saved on this computer.',
  // Karaoke
  'desktop.closeKaraoke': 'Close karaoke',
  'desktop.karaokeRemoveHint':
    'An AI voice remover takes the singer out, right on this computer. Nothing is sent anywhere.',
  'desktop.tagInstant': 'Opens instantly',
  'desktop.tagOffline': 'Works offline',
  'desktop.tagOnce': '{size}, once',
  'desktop.gettingRemover': 'Getting the voice remover',
  'desktop.removerFrom':
    '{name}, from Ultimate Vocal Remover. It downloads once, then works offline.',
  'desktop.ofSize': '{received} of {total}',
  'desktop.nothingSent': 'Nothing is sent anywhere — your songs stay on this computer.',
  'desktop.waitingMusic': 'Waiting for the music',
  'desktop.paused': 'Paused',
  'desktop.readyToSing': 'Ready to sing',
  'desktop.vocalsRemoved': 'Vocals removed',
  'desktop.originalSong': 'Original song',
  'desktop.subOver': 'The song plays as it is, vocals included.',
  'desktop.subMadeBefore': 'Made before — opens instantly now.',
  'desktop.subReady': 'Instrumental ready.',
  'desktop.subEnough':
    'Instrumental {percent}% made — enough to start. The rest is made as you sing.',
  'desktop.subMaking':
    'The instrumental plays while it’s being made. Your computer is measured so the music never catches up.',
  'desktop.karaokeNoLyrics':
    'No lyrics for this song yet — paste yours from the player’s Lyrics view.',
  'desktop.catchingUp':
    'The instrumental is catching up — music and your recording are paused together.',
  'desktop.finish': 'Finish',
  'desktop.recordedLine': '{time} recorded · {mode}',
  'desktop.listenBack': 'Listen back',
  'desktop.inTime': 'In time',
  'desktop.msEarlier': '{ms} ms earlier',
  'desktop.msLater': '{ms} ms later',
  'desktop.voiceEarlier': 'Voice earlier',
  'desktop.voiceLater': 'Voice later',
  'desktop.nameTake': 'Name this take',
  'desktop.takeName': '{title} — take {n}',
  'desktop.saveRecording': 'Save recording',
  'desktop.discard': 'Discard',
  'desktop.takeDiscarded': 'Take discarded',
  'desktop.savedHint': 'Saved to your Music/Karaoke folder, so other music apps see it too',
  'desktop.savedToast': 'Saved to Music/Karaoke',
  'desktop.karaokeNeedsFile': 'Karaoke needs the song saved on this computer',
  // Mini player
  'desktop.miniHidden': 'Mini player hidden — it comes back next time stash is minimised',
  'desktop.miniEmpty':
    'Like songs to keep them here, and turn on Suggest similar songs for ideas.',
  // Updates
  'desktop.installing': 'Installing — stash restarts by itself',
};

const fr = {
  // Window
  'desktop.searchPlaceholder': 'Cherche dans ta bibliothèque et les sources gratuites',
  'desktop.minimize': 'Réduire — la musique continue',
  'desktop.maximize': 'Agrandir',
  'desktop.closeToTray': 'Fermer dans la zone de notification — la musique continue',
  'desktop.resizeHint': 'Fais glisser pour redimensionner · double-clic pour réinitialiser',
  'desktop.trayOpen': 'Ouvrir stash',
  'desktop.trayQuit': 'Quitter stash',
  // Sidebar
  'desktop.playlists': 'Playlists',
  'desktop.storageOf': 'sur {size}',
  // Library
  'desktop.allOffline': {
    one: '{count} titre · {size} · tout se lit hors ligne',
    other: '{count} titres · {size} · tout se lit hors ligne',
  },
  'desktop.colTitle': 'Titre',
  'desktop.colGenre': 'Genre',
  'desktop.colTime': 'Durée',
  'desktop.selectHint':
    'Maintiens un titre enfoncé (ou Ctrl-clic) pour en sélectionner plusieurs',
  'desktop.libraryEmpty':
    'Pas encore de musique. Scanne ton dossier Musique dans Réglages, ou trouve des titres dans Recherche — ils s’enregistrent pendant que tu écoutes.',
  'desktop.smartRecentSub': 'les plus récents d’abord',
  'desktop.smartMostSub': 'comptés après 30 s',
  'desktop.smartDownloadedSub': 'enregistrés depuis le web',
  'desktop.removeBody':
    'Les titres enregistrés sont supprimés de l’ordinateur. Tes propres fichiers musicaux sont seulement masqués jusqu’au prochain scan.',
  // Search
  'desktop.searchTry': 'Tape dans la barre de recherche ci-dessus, ou essaie :',
  // Saving
  'desktop.recordingsEmpty':
    'Utilise le karaoké dans le lecteur pour chanter — tes prises arrivent ici, dans Music/Karaoke.',
  'desktop.takes': { one: '{count} prise', other: '{count} prises' },
  'desktop.modeNoVocals': 'sans voix',
  'desktop.modeOverSong': 'sur le morceau',
  'desktop.playRecording': 'Écouter l’enregistrement',
  'desktop.shareHint': 'Partager — enregistrer une copie où tu veux',
  'desktop.shared': 'Copie de « {name} » enregistrée',
  'desktop.deleteHint': 'Le fichier est supprimé de Music/Karaoke.',
  // Stats
  'desktop.statPlays': 'Écoutes',
  'desktop.statSongs': 'Titres',
  'desktop.statDaily': 'Moyenne par jour',
  'desktop.statLibrary': 'Bibliothèque écoutée',
  'desktop.lastWeek': 'sur les 7 derniers jours',
  'desktop.lastMonth': 'sur les 30 derniers jours',
  'desktop.allTime': 'depuis que tu as commencé à écouter',
  'desktop.tapBar': 'Clique sur une barre pour voir sa valeur',
  'desktop.statsFootnote': 'Le temps est compté pendant que tu écoutes.',
  // Settings
  'desktop.sectionLibrary': 'Bibliothèque',
  'desktop.sectionKaraoke': 'Karaoké',
  'desktop.sectionKeyboard': 'Clavier',
  'desktop.scanSub':
    'Tes dossiers Musique et Téléchargements — récupère aussi les titres enregistrés dans Music/stash après une réinstallation',
  'desktop.scanDone': {
    one: '{count} titre trouvé sur cet ordinateur ({added} nouveau)',
    other: '{count} titres trouvés sur cet ordinateur ({added} nouveaux)',
  },
  'desktop.scan': 'Scanner',
  'desktop.open': 'Ouvrir',
  'desktop.miniPlayer': 'Mini lecteur vinyle',
  'desktop.miniPlayerSub':
    'Flotte au-dessus des autres fenêtres quand stash est réduit ou fermé dans la zone de notification.',
  'desktop.miniColour': 'Couleur de progression du mini lecteur',
  'desktop.vinylStyleSub': 'Utilisé dans le panneau En cours de lecture et le mini lecteur',
  'desktop.playerBackgroundSub': 'S’adapte à la pochette de chaque titre',
  'desktop.keepAwake': 'Garder l’écran allumé en plein écran',
  'desktop.keepAwakeSub':
    'L’écran ne se met pas en veille tant que le lecteur plein écran est ouvert',
  'desktop.languageSub': 'Utilise la langue de ton système par défaut',
  'desktop.systemLanguage': 'Langue du système · {name}',
  'desktop.languageHint':
    'Utilise la langue de ton système par défaut. L’arabe passe la mise en page de droite à gauche après un redémarrage.',
  'desktop.restartBanner':
    'Redémarre stash pour passer à {name} — le sens de la mise en page change.',
  'desktop.restart': 'Redémarrer',
  'desktop.voiceRemover': 'Suppresseur de voix',
  'desktop.voiceRemoverReady': '{name} · {size} · marche hors ligne',
  'desktop.voiceRemoverMissing':
    'Se télécharge une fois ({size}) la première fois que tu supprimes la voix',
  'desktop.voiceRemoverDeleted': 'Suppresseur de voix supprimé — {size} libérés',
  'desktop.recordingsIn': {
    one: '{count} enregistrement · dans Music/Karaoke',
    other: '{count} enregistrements · dans Music/Karaoke',
  },
  'desktop.youtubeDevice': 'Sur cet ordinateur',
  'desktop.youtubeDeviceHint':
    'Cherche sur YouTube Music et récupère l’audio directement depuis cet ordinateur — aucun serveur nécessaire. Les titres sont enregistrés dans leur qualité d’origine.',
  'desktop.checkUpdatesSub':
    'Les nouvelles versions de GitHub sont proposées à chaque démarrage',
  'desktop.devBuild':
    'Version de développement — les mises à jour arrivent avec les versions publiées',
  'desktop.version': 'Version {version} · bureau',
  'desktop.keyPlayPause': 'Lecture / pause',
  'desktop.keyLyrics': 'Afficher ou masquer les paroles',
  'desktop.keyFull': 'Lecteur plein écran',
  'desktop.keySkip': 'Titre suivant ou précédent',
  'desktop.keySearch': 'Recherche',
  'desktop.keyEsc':
    'Fermer une boîte de dialogue, le plein écran ou la carte du mini lecteur',
  // Player
  'desktop.lyrics': 'Paroles',
  'desktop.sleep': 'Minuterie',
  'desktop.upNext': 'À suivre',
  'desktop.fullScreen': 'Plein écran (F)',
  'desktop.exitFullScreen': 'Quitter le plein écran (Esc)',
  'desktop.volume': 'Volume',
  'desktop.mute': 'Couper le son',
  'desktop.unmute': 'Réactiver le son',
  'desktop.hidePanel': 'Masquer le panneau',
  'desktop.nowPlayingPanel': 'Panneau En cours de lecture',
  'desktop.dragCover': 'Fais glisser sur le côté pour le suivant ou le précédent',
  'desktop.queueHint':
    'Fais glisser ≡ pour réorganiser · balaie un titre sur le côté pour le retirer',
  'desktop.takenOut': 'Retiré de la file — toujours dans ta bibliothèque',
  'desktop.repeat': 'Répéter',
  'desktop.similarSongs': 'Titres similaires',
  'desktop.playPauseKey': 'Lecture / pause (Space)',
  'desktop.lyricsKey': 'Paroles (L)',
  'desktop.useLyrics': 'Utiliser ces paroles',
  'desktop.backToFound': 'Revenir aux paroles trouvées',
  'desktop.editYours': 'Modifier les tiennes',
  'desktop.usingYours': 'Tes paroles sont utilisées',
  'desktop.lyricsOfflineHint':
    'Les paroles sont cherchées en ligne la première fois, puis gardées sur cet ordinateur.',
  // Karaoke
  'desktop.closeKaraoke': 'Fermer le karaoké',
  'desktop.karaokeRemoveHint':
    'Un suppresseur de voix par IA retire le chanteur, directement sur cet ordinateur. Rien n’est envoyé nulle part.',
  'desktop.tagInstant': 'S’ouvre instantanément',
  'desktop.tagOffline': 'Marche hors ligne',
  'desktop.tagOnce': '{size}, une seule fois',
  'desktop.gettingRemover': 'Récupération du suppresseur de voix',
  'desktop.removerFrom':
    '{name}, d’Ultimate Vocal Remover. Il se télécharge une fois, puis marche hors ligne.',
  'desktop.ofSize': '{received} sur {total}',
  'desktop.nothingSent':
    'Rien n’est envoyé nulle part — tes titres restent sur cet ordinateur.',
  'desktop.waitingMusic': 'En attente de la musique',
  'desktop.paused': 'En pause',
  'desktop.readyToSing': 'Prêt à chanter',
  'desktop.vocalsRemoved': 'Voix supprimée',
  'desktop.originalSong': 'Morceau original',
  'desktop.subOver': 'Le morceau est joué tel quel, voix comprise.',
  'desktop.subMadeBefore': 'Déjà préparé — s’ouvre instantanément maintenant.',
  'desktop.subReady': 'Instrumental prêt.',
  'desktop.subEnough':
    'Instrumental prêt à {percent} % — assez pour commencer. Le reste se prépare pendant que tu chantes.',
  'desktop.subMaking':
    'L’instrumental joue pendant qu’il se prépare. La vitesse de ton ordinateur est mesurée pour que la musique ne le rattrape jamais.',
  'desktop.karaokeNoLyrics':
    'Pas encore de paroles pour ce titre — colle les tiennes depuis la vue Paroles du lecteur.',
  'desktop.catchingUp':
    'L’instrumental rattrape son retard — la musique et ton enregistrement sont en pause ensemble.',
  'desktop.finish': 'Terminer',
  'desktop.recordedLine': 'Enregistré : {time} · {mode}',
  'desktop.listenBack': 'Réécouter',
  'desktop.inTime': 'En rythme',
  'desktop.msEarlier': '{ms} ms plus tôt',
  'desktop.msLater': '{ms} ms plus tard',
  'desktop.voiceEarlier': 'Voix plus tôt',
  'desktop.voiceLater': 'Voix plus tard',
  'desktop.nameTake': 'Nomme cette prise',
  'desktop.takeName': '{title} — prise {n}',
  'desktop.saveRecording': 'Garder l’enregistrement',
  'desktop.discard': 'Jeter',
  'desktop.takeDiscarded': 'Prise jetée',
  'desktop.savedHint':
    'Enregistré dans ton dossier Music/Karaoke, pour que les autres applis de musique le voient aussi',
  'desktop.savedToast': 'Enregistré dans Music/Karaoke',
  'desktop.karaokeNeedsFile':
    'Le karaoké a besoin que le titre soit enregistré sur cet ordinateur',
  // Mini player
  'desktop.miniHidden':
    'Mini lecteur masqué — il reviendra la prochaine fois que stash sera réduit',
  'desktop.miniEmpty':
    'Like des titres pour les garder ici, et active Suggérer des titres similaires pour avoir des idées.',
  // Updates
  'desktop.installing': 'Installation — stash redémarre tout seul',
};

const ar = {
  // Window
  'desktop.searchPlaceholder': 'ابحث في مكتبتك والمصادر المجانية',
  'desktop.minimize': 'تصغير — تستمر الموسيقى',
  'desktop.maximize': 'تكبير',
  'desktop.closeToTray': 'إغلاق إلى منطقة الإشعارات — تستمر الموسيقى',
  'desktop.resizeHint': 'اسحب لتغيير الحجم · انقر مرتين لإعادة الضبط',
  'desktop.trayOpen': 'فتح stash',
  'desktop.trayQuit': 'إنهاء stash',
  // Sidebar
  'desktop.playlists': 'القوائم',
  'desktop.storageOf': 'من أصل {size}',
  // Library
  'desktop.allOffline': {
    zero: 'لا أغاني · {size}',
    one: 'أغنية واحدة · {size} · تعمل دون اتصال',
    two: 'أغنيتان · {size} · تعملان دون اتصال',
    few: '{count} أغانٍ · {size} · كلها تعمل دون اتصال',
    many: '{count} أغنية · {size} · كلها تعمل دون اتصال',
    other: '{count} أغنية · {size} · كلها تعمل دون اتصال',
  },
  'desktop.colTitle': 'العنوان',
  'desktop.colGenre': 'النوع',
  'desktop.colTime': 'المدة',
  'desktop.selectHint': 'اضغط مطولًا على أغنية (أو Ctrl مع النقر) لتحديد عدة أغانٍ',
  'desktop.libraryEmpty':
    'لا توجد موسيقى بعد. افحص مجلد الموسيقى من الإعدادات، أو ابحث عن أغانٍ في البحث — تُحفظ أثناء الاستماع.',
  'desktop.smartRecentSub': 'الأحدث أولًا',
  'desktop.smartMostSub': 'تُحتسب بعد 30 ث',
  'desktop.smartDownloadedSub': 'محفوظة من الويب',
  'desktop.removeBody':
    'تُحذف الأغاني المحفوظة من الحاسوب. أما ملفات الموسيقى الخاصة بك فتُخفى فقط حتى الفحص التالي.',
  // Search
  'desktop.searchTry': 'اكتب في شريط البحث أعلاه، أو جرّب:',
  // Saving
  'desktop.recordingsEmpty':
    'استخدم الكاريوكي في المشغّل للغناء — تصل تسجيلاتك إلى هنا، في Music/Karaoke.',
  'desktop.takes': {
    zero: 'لا تسجيلات',
    one: 'تسجيل واحد',
    two: 'تسجيلان',
    few: '{count} تسجيلات',
    many: '{count} تسجيلًا',
    other: '{count} تسجيل',
  },
  'desktop.modeNoVocals': 'دون صوت المغني',
  'desktop.modeOverSong': 'مع الأغنية',
  'desktop.playRecording': 'تشغيل التسجيل',
  'desktop.shareHint': 'مشاركة — احفظ نسخة في أي مكان',
  'desktop.shared': 'حُفظت نسخة من «{name}»',
  'desktop.deleteHint': 'سيُحذف الملف من Music/Karaoke.',
  // Stats
  'desktop.statPlays': 'التشغيلات',
  'desktop.statSongs': 'الأغاني',
  'desktop.statDaily': 'المعدل اليومي',
  'desktop.statLibrary': 'ما شُغّل من المكتبة',
  'desktop.lastWeek': 'خلال آخر 7 أيام',
  'desktop.lastMonth': 'خلال آخر 30 يومًا',
  'desktop.allTime': 'منذ أن بدأت الاستماع',
  'desktop.tapBar': 'انقر على عمود لعرض قيمته',
  'desktop.statsFootnote': 'يُحتسب الوقت أثناء استماعك.',
  // Settings
  'desktop.sectionLibrary': 'المكتبة',
  'desktop.sectionKaraoke': 'الكاريوكي',
  'desktop.sectionKeyboard': 'لوحة المفاتيح',
  'desktop.scanSub':
    'مجلدا الموسيقى والتنزيلات — ويستعيد أيضًا الأغاني المحفوظة في Music/stash بعد إعادة التثبيت',
  'desktop.scanDone': {
    zero: 'لم يُعثر على أي أغنية في هذا الحاسوب',
    one: 'عُثر على أغنية واحدة في هذا الحاسوب ({added} جديدة)',
    two: 'عُثر على أغنيتين في هذا الحاسوب ({added} جديدة)',
    few: 'عُثر على {count} أغانٍ في هذا الحاسوب ({added} جديدة)',
    many: 'عُثر على {count} أغنية في هذا الحاسوب ({added} جديدة)',
    other: 'عُثر على {count} أغنية في هذا الحاسوب ({added} جديدة)',
  },
  'desktop.scan': 'فحص',
  'desktop.open': 'فتح',
  'desktop.miniPlayer': 'مشغّل الأسطوانة المصغّر',
  'desktop.miniPlayerSub':
    'يطفو فوق النوافذ الأخرى عندما يكون stash مصغّرًا أو مغلقًا إلى منطقة الإشعارات.',
  'desktop.miniColour': 'لون تقدّم المشغّل المصغّر',
  'desktop.vinylStyleSub': 'يُستخدم في لوحة «قيد التشغيل» والمشغّل المصغّر',
  'desktop.playerBackgroundSub': 'يتكيّف مع غلاف كل أغنية',
  'desktop.keepAwake': 'إبقاء الشاشة مضاءة في وضع ملء الشاشة',
  'desktop.keepAwakeSub':
    'لا تدخل الشاشة في وضع السكون ما دام المشغّل بملء الشاشة مفتوحًا',
  'desktop.languageSub': 'تستخدم لغة نظامك افتراضيًا',
  'desktop.systemLanguage': 'لغة النظام · {name}',
  'desktop.languageHint':
    'تستخدم لغة نظامك افتراضيًا. تُحوّل العربية اتجاه الواجهة من اليمين إلى اليسار بعد إعادة التشغيل.',
  'desktop.restartBanner':
    'أعد تشغيل stash للتبديل إلى {name} — يتغيّر اتجاه الواجهة.',
  'desktop.restart': 'إعادة التشغيل',
  'desktop.voiceRemover': 'مزيل الصوت',
  'desktop.voiceRemoverReady': '{name} · {size} · يعمل دون اتصال',
  'desktop.voiceRemoverMissing':
    'يُنزَّل مرة واحدة ({size}) في أول مرة تزيل فيها صوت المغني',
  'desktop.voiceRemoverDeleted': 'حُذف مزيل الصوت — تحرّرت {size}',
  'desktop.recordingsIn': {
    zero: 'لا تسجيلات · في Music/Karaoke',
    one: 'تسجيل واحد · في Music/Karaoke',
    two: 'تسجيلان · في Music/Karaoke',
    few: '{count} تسجيلات · في Music/Karaoke',
    many: '{count} تسجيلًا · في Music/Karaoke',
    other: '{count} تسجيل · في Music/Karaoke',
  },
  'desktop.youtubeDevice': 'على هذا الحاسوب',
  'desktop.youtubeDeviceHint':
    'يبحث في YouTube Music ويجلب الصوت مباشرة من هذا الحاسوب — دون الحاجة إلى خادم. تُحفظ الأغاني بجودتها الأصلية.',
  'desktop.checkUpdatesSub': 'تُعرض الإصدارات الجديدة من GitHub عند كل تشغيل',
  'desktop.devBuild': 'نسخة تطوير — تصل التحديثات مع الإصدارات المنشورة',
  'desktop.version': 'الإصدار {version} · سطح المكتب',
  'desktop.keyPlayPause': 'تشغيل / إيقاف مؤقت',
  'desktop.keyLyrics': 'إظهار الكلمات أو إخفاؤها',
  'desktop.keyFull': 'المشغّل بملء الشاشة',
  'desktop.keySkip': 'الأغنية التالية أو السابقة',
  'desktop.keySearch': 'البحث',
  'desktop.keyEsc': 'إغلاق نافذة حوار أو وضع ملء الشاشة أو بطاقة المشغّل المصغّر',
  // Player
  'desktop.lyrics': 'الكلمات',
  'desktop.sleep': 'مؤقت النوم',
  'desktop.upNext': 'التالي',
  'desktop.fullScreen': 'ملء الشاشة (F)',
  'desktop.exitFullScreen': 'الخروج من ملء الشاشة (Esc)',
  'desktop.volume': 'مستوى الصوت',
  'desktop.mute': 'كتم الصوت',
  'desktop.unmute': 'إلغاء كتم الصوت',
  'desktop.hidePanel': 'إخفاء اللوحة',
  'desktop.nowPlayingPanel': 'لوحة «قيد التشغيل»',
  'desktop.dragCover': 'اسحب جانبًا للانتقال إلى التالية أو السابقة',
  'desktop.queueHint': 'اسحب ≡ لإعادة الترتيب · اسحب أغنية جانبًا لإخراجها',
  'desktop.takenOut': 'أُخرجت من قائمة الانتظار — لا تزال في مكتبتك',
  'desktop.repeat': 'تكرار',
  'desktop.similarSongs': 'أغانٍ مشابهة',
  'desktop.playPauseKey': 'تشغيل / إيقاف مؤقت (Space)',
  'desktop.lyricsKey': 'الكلمات (L)',
  'desktop.useLyrics': 'استخدام هذه الكلمات',
  'desktop.backToFound': 'العودة إلى الكلمات التي عُثر عليها',
  'desktop.editYours': 'تعديل كلماتك',
  'desktop.usingYours': 'تُستخدم كلماتك',
  'desktop.lyricsOfflineHint':
    'يُبحث عن الكلمات عبر الإنترنت في المرة الأولى، ثم تُحفظ على هذا الحاسوب.',
  // Karaoke
  'desktop.closeKaraoke': 'إغلاق الكاريوكي',
  'desktop.karaokeRemoveHint':
    'يزيل مزيل صوت بالذكاء الاصطناعي صوت المغني، مباشرة على هذا الحاسوب. لا يُرسل أي شيء إلى أي مكان.',
  'desktop.tagInstant': 'يفتح فورًا',
  'desktop.tagOffline': 'يعمل دون اتصال',
  'desktop.tagOnce': '{size}، مرة واحدة',
  'desktop.gettingRemover': 'جارٍ تنزيل مزيل الصوت',
  'desktop.removerFrom':
    '{name}، من Ultimate Vocal Remover. يُنزَّل مرة واحدة، ثم يعمل دون اتصال.',
  'desktop.ofSize': '{received} من {total}',
  'desktop.nothingSent': 'لا يُرسل أي شيء إلى أي مكان — تبقى أغانيك على هذا الحاسوب.',
  'desktop.waitingMusic': 'في انتظار الموسيقى',
  'desktop.paused': 'متوقف مؤقتًا',
  'desktop.readyToSing': 'جاهز للغناء',
  'desktop.vocalsRemoved': 'أُزيل صوت المغني',
  'desktop.originalSong': 'الأغنية الأصلية',
  'desktop.subOver': 'تُشغَّل الأغنية كما هي، مع صوت المغني.',
  'desktop.subMadeBefore': 'جُهّزت من قبل — تفتح فورًا الآن.',
  'desktop.subReady': 'المقطوعة الموسيقية جاهزة.',
  'desktop.subEnough':
    'جُهّز {percent}% من المقطوعة الموسيقية — يكفي للبدء. يُجهَّز الباقي أثناء غنائك.',
  'desktop.subMaking':
    'تُشغَّل المقطوعة الموسيقية أثناء تجهيزها. تُقاس سرعة حاسوبك حتى لا تلحق الموسيقى بالتجهيز أبدًا.',
  'desktop.karaokeNoLyrics':
    'لا توجد كلمات لهذه الأغنية بعد — الصق كلماتك من عرض الكلمات في المشغّل.',
  'desktop.catchingUp':
    'المقطوعة الموسيقية تلحق — الموسيقى وتسجيلك متوقفان مؤقتًا معًا.',
  'desktop.finish': 'إنهاء',
  'desktop.recordedLine': 'سُجّل {time} · {mode}',
  'desktop.listenBack': 'إعادة الاستماع',
  'desktop.inTime': 'متزامن',
  'desktop.msEarlier': 'مبكرًا بـ{ms} ملّي ثانية',
  'desktop.msLater': 'متأخرًا بـ{ms} ملّي ثانية',
  'desktop.voiceEarlier': 'تقديم الصوت',
  'desktop.voiceLater': 'تأخير الصوت',
  'desktop.nameTake': 'سمِّ هذا التسجيل',
  'desktop.takeName': '{title} — تسجيل {n}',
  'desktop.saveRecording': 'حفظ التسجيل',
  'desktop.discard': 'تجاهل',
  'desktop.takeDiscarded': 'تم تجاهل التسجيل',
  'desktop.savedHint':
    'حُفظ في مجلد Music/Karaoke، لتراه تطبيقات الموسيقى الأخرى أيضًا',
  'desktop.savedToast': 'حُفظ في Music/Karaoke',
  'desktop.karaokeNeedsFile': 'يحتاج الكاريوكي إلى أن تكون الأغنية محفوظة على هذا الحاسوب',
  // Mini player
  'desktop.miniHidden':
    'أُخفي المشغّل المصغّر — سيعود في المرة القادمة التي يُصغَّر فيها stash',
  'desktop.miniEmpty':
    'أضف أغانيَ إلى المفضّلة لتبقى هنا، وفعّل «اقتراح أغانٍ مشابهة» للحصول على أفكار.',
  // Updates
  'desktop.installing': 'جارٍ التثبيت — يُعيد stash تشغيل نفسه',
};

const es = {
  // Window
  'desktop.searchPlaceholder': 'Busca en tu biblioteca y en fuentes gratuitas',
  'desktop.minimize': 'Minimizar — la música sigue sonando',
  'desktop.maximize': 'Maximizar',
  'desktop.closeToTray': 'Cerrar en la bandeja del sistema — la música sigue sonando',
  'desktop.resizeHint': 'Arrastra para cambiar el tamaño · doble clic para restablecer',
  'desktop.trayOpen': 'Abrir stash',
  'desktop.trayQuit': 'Salir de stash',
  // Sidebar
  'desktop.playlists': 'Listas',
  'desktop.storageOf': 'de {size}',
  // Library
  'desktop.allOffline': {
    one: '{count} canción · {size} · suena sin conexión',
    other: '{count} canciones · {size} · todas suenan sin conexión',
  },
  'desktop.colTitle': 'Título',
  'desktop.colGenre': 'Género',
  'desktop.colTime': 'Duración',
  'desktop.selectHint':
    'Mantén pulsada una canción (o Ctrl-clic) para seleccionar varias',
  'desktop.libraryEmpty':
    'Aún no hay música. Escanea tu carpeta Música en Ajustes, o busca canciones en Buscar — se guardan mientras escuchas.',
  'desktop.smartRecentSub': 'las más recientes primero',
  'desktop.smartMostSub': 'cuentan tras 30 s',
  'desktop.smartDownloadedSub': 'guardadas desde la web',
  'desktop.removeBody':
    'Las canciones guardadas se borran del ordenador. Tus propios archivos de música solo se ocultan hasta el próximo escaneo.',
  // Search
  'desktop.searchTry': 'Escribe en la barra de búsqueda de arriba, o prueba:',
  // Saving
  'desktop.recordingsEmpty':
    'Usa el karaoke del reproductor para cantar — tus tomas llegan aquí, a Music/Karaoke.',
  'desktop.takes': { one: '{count} toma', other: '{count} tomas' },
  'desktop.modeNoVocals': 'sin voz',
  'desktop.modeOverSong': 'sobre la canción',
  'desktop.playRecording': 'Reproducir grabación',
  'desktop.shareHint': 'Compartir — guarda una copia donde quieras',
  'desktop.shared': 'Copia de «{name}» guardada',
  'desktop.deleteHint': 'El archivo se borra de Music/Karaoke.',
  // Stats
  'desktop.statPlays': 'Reproducciones',
  'desktop.statSongs': 'Canciones',
  'desktop.statDaily': 'Media diaria',
  'desktop.statLibrary': 'Biblioteca escuchada',
  'desktop.lastWeek': 'en los últimos 7 días',
  'desktop.lastMonth': 'en los últimos 30 días',
  'desktop.allTime': 'desde que empezaste a escuchar',
  'desktop.tapBar': 'Haz clic en una barra para ver su valor',
  'desktop.statsFootnote': 'El tiempo se cuenta mientras escuchas.',
  // Settings
  'desktop.sectionLibrary': 'Biblioteca',
  'desktop.sectionKaraoke': 'Karaoke',
  'desktop.sectionKeyboard': 'Teclado',
  'desktop.scanSub':
    'Tus carpetas Música y Descargas — también recupera las canciones guardadas en Music/stash tras reinstalar',
  'desktop.scanDone': {
    one: '{count} canción encontrada en este ordenador ({added} nuevas)',
    other: '{count} canciones encontradas en este ordenador ({added} nuevas)',
  },
  'desktop.scan': 'Escanear',
  'desktop.open': 'Abrir',
  'desktop.miniPlayer': 'Minirreproductor de vinilo',
  'desktop.miniPlayerSub':
    'Flota sobre otras ventanas mientras stash está minimizado o cerrado en la bandeja del sistema.',
  'desktop.miniColour': 'Color del progreso del minirreproductor',
  'desktop.vinylStyleSub': 'Se usa en el panel Sonando ahora y en el minirreproductor',
  'desktop.playerBackgroundSub': 'Se adapta a la portada de cada canción',
  'desktop.keepAwake': 'Mantener la pantalla encendida en pantalla completa',
  'desktop.keepAwakeSub':
    'La pantalla no entra en reposo mientras el reproductor a pantalla completa está abierto',
  'desktop.languageSub': 'Usa el idioma de tu sistema por defecto',
  'desktop.systemLanguage': 'Idioma del sistema · {name}',
  'desktop.languageHint':
    'Usa el idioma de tu sistema por defecto. El árabe cambia el diseño a derecha a izquierda tras reiniciar.',
  'desktop.restartBanner':
    'Reinicia stash para cambiar a {name} — cambia la dirección del diseño.',
  'desktop.restart': 'Reiniciar',
  'desktop.voiceRemover': 'Eliminador de voz',
  'desktop.voiceRemoverReady': '{name} · {size} · funciona sin conexión',
  'desktop.voiceRemoverMissing':
    'Se descarga una vez ({size}) la primera vez que quitas la voz',
  'desktop.voiceRemoverDeleted': 'Eliminador de voz borrado — {size} liberados',
  'desktop.recordingsIn': {
    one: '{count} grabación · en Music/Karaoke',
    other: '{count} grabaciones · en Music/Karaoke',
  },
  'desktop.youtubeDevice': 'En este ordenador',
  'desktop.youtubeDeviceHint':
    'Busca en YouTube Music y obtiene el audio directamente desde este ordenador, sin servidor. Las canciones se guardan en su calidad original.',
  'desktop.checkUpdatesSub':
    'Las nuevas versiones de GitHub se ofrecen en cada inicio',
  'desktop.devBuild':
    'Versión de desarrollo: las actualizaciones llegan con las versiones publicadas',
  'desktop.version': 'Versión {version} · escritorio',
  'desktop.keyPlayPause': 'Reproducir / pausa',
  'desktop.keyLyrics': 'Mostrar u ocultar la letra',
  'desktop.keyFull': 'Reproductor a pantalla completa',
  'desktop.keySkip': 'Canción siguiente o anterior',
  'desktop.keySearch': 'Buscar',
  'desktop.keyEsc':
    'Cerrar un diálogo, la pantalla completa o la tarjeta del minirreproductor',
  // Player
  'desktop.lyrics': 'Letra',
  'desktop.sleep': 'Temporizador',
  'desktop.upNext': 'A continuación',
  'desktop.fullScreen': 'Pantalla completa (F)',
  'desktop.exitFullScreen': 'Salir de pantalla completa (Esc)',
  'desktop.volume': 'Volumen',
  'desktop.mute': 'Silenciar',
  'desktop.unmute': 'Activar sonido',
  'desktop.hidePanel': 'Ocultar panel',
  'desktop.nowPlayingPanel': 'Panel Sonando ahora',
  'desktop.dragCover': 'Arrastra a un lado para la siguiente o la anterior',
  'desktop.queueHint':
    'Arrastra ≡ para reordenar · desliza una canción a un lado para quitarla',
  'desktop.takenOut': 'Quitada de la cola — sigue en tu biblioteca',
  'desktop.repeat': 'Repetir',
  'desktop.similarSongs': 'Canciones similares',
  'desktop.playPauseKey': 'Reproducir / pausa (Space)',
  'desktop.lyricsKey': 'Letra (L)',
  'desktop.useLyrics': 'Usar esta letra',
  'desktop.backToFound': 'Volver a la letra encontrada',
  'desktop.editYours': 'Editar la tuya',
  'desktop.usingYours': 'Usando tu letra',
  'desktop.lyricsOfflineHint':
    'La letra se busca en internet la primera vez y luego se guarda en este ordenador.',
  // Karaoke
  'desktop.closeKaraoke': 'Cerrar karaoke',
  'desktop.karaokeRemoveHint':
    'Un eliminador de voz con IA quita al cantante, aquí mismo en este ordenador. No se envía nada a ningún sitio.',
  'desktop.tagInstant': 'Se abre al instante',
  'desktop.tagOffline': 'Funciona sin conexión',
  'desktop.tagOnce': '{size}, una sola vez',
  'desktop.gettingRemover': 'Descargando el eliminador de voz',
  'desktop.removerFrom':
    '{name}, de Ultimate Vocal Remover. Se descarga una vez y luego funciona sin conexión.',
  'desktop.ofSize': '{received} de {total}',
  'desktop.nothingSent':
    'No se envía nada a ningún sitio — tus canciones se quedan en este ordenador.',
  'desktop.waitingMusic': 'Esperando la música',
  'desktop.paused': 'En pausa',
  'desktop.readyToSing': 'Listo para cantar',
  'desktop.vocalsRemoved': 'Voz quitada',
  'desktop.originalSong': 'Canción original',
  'desktop.subOver': 'La canción suena tal cual, con la voz incluida.',
  'desktop.subMadeBefore': 'Ya se hizo antes — ahora se abre al instante.',
  'desktop.subReady': 'Instrumental listo.',
  'desktop.subEnough':
    'Instrumental al {percent} % — suficiente para empezar. El resto se hace mientras cantas.',
  'desktop.subMaking':
    'El instrumental suena mientras se hace. Se mide la velocidad de tu ordenador para que la música nunca lo alcance.',
  'desktop.karaokeNoLyrics':
    'Aún no hay letra para esta canción — pega la tuya desde la vista Letra del reproductor.',
  'desktop.catchingUp':
    'El instrumental se está poniendo al día — la música y tu grabación se pausan juntas.',
  'desktop.finish': 'Terminar',
  'desktop.recordedLine': 'Grabado: {time} · {mode}',
  'desktop.listenBack': 'Volver a escuchar',
  'desktop.inTime': 'A tiempo',
  'desktop.msEarlier': '{ms} ms antes',
  'desktop.msLater': '{ms} ms después',
  'desktop.voiceEarlier': 'Voz antes',
  'desktop.voiceLater': 'Voz después',
  'desktop.nameTake': 'Ponle nombre a esta toma',
  'desktop.takeName': '{title} — toma {n}',
  'desktop.saveRecording': 'Guardar grabación',
  'desktop.discard': 'Descartar',
  'desktop.takeDiscarded': 'Toma descartada',
  'desktop.savedHint':
    'Guardado en tu carpeta Music/Karaoke, para que otras apps de música también lo vean',
  'desktop.savedToast': 'Guardado en Music/Karaoke',
  'desktop.karaokeNeedsFile': 'El karaoke necesita la canción guardada en este ordenador',
  // Mini player
  'desktop.miniHidden':
    'Minirreproductor oculto — vuelve la próxima vez que se minimice stash',
  'desktop.miniEmpty':
    'Dale a Me gusta a canciones para tenerlas aquí, y activa Sugerir canciones similares para tener ideas.',
  // Updates
  'desktop.installing': 'Instalando — stash se reinicia solo',
};

const de = {
  // Window
  'desktop.searchPlaceholder': 'Durchsuche deine Mediathek und freie Quellen',
  'desktop.minimize': 'Minimieren – die Musik läuft weiter',
  'desktop.maximize': 'Maximieren',
  'desktop.closeToTray': 'In den Infobereich schließen – die Musik läuft weiter',
  'desktop.resizeHint': 'Ziehen zum Anpassen der Größe · Doppelklick zum Zurücksetzen',
  'desktop.trayOpen': 'stash öffnen',
  'desktop.trayQuit': 'stash beenden',
  // Sidebar
  'desktop.playlists': 'Playlists',
  'desktop.storageOf': 'von {size}',
  // Library
  'desktop.allOffline': {
    one: '{count} Song · {size} · alles läuft offline',
    other: '{count} Songs · {size} · alles läuft offline',
  },
  'desktop.colTitle': 'Titel',
  'desktop.colGenre': 'Genre',
  'desktop.colTime': 'Dauer',
  'desktop.selectHint':
    'Halte einen Song gedrückt (oder Ctrl-Klick), um mehrere auszuwählen',
  'desktop.libraryEmpty':
    'Noch keine Musik. Durchsuche deinen Musikordner in den Einstellungen oder finde Songs in der Suche – sie werden beim Hören gespeichert.',
  'desktop.smartRecentSub': 'neueste zuerst',
  'desktop.smartMostSub': 'zählt ab 30 Sek.',
  'desktop.smartDownloadedSub': 'aus dem Web gespeichert',
  'desktop.removeBody':
    'Gespeicherte Songs werden vom Computer gelöscht. Deine eigenen Musikdateien werden nur bis zum nächsten Scan ausgeblendet.',
  // Search
  'desktop.searchTry': 'Tippe oben in die Suchleiste oder probier:',
  // Saving
  'desktop.recordingsEmpty':
    'Nutze Karaoke im Player zum Singen – deine Aufnahmen landen hier, in Music/Karaoke.',
  'desktop.takes': { one: '{count} Aufnahme', other: '{count} Aufnahmen' },
  'desktop.modeNoVocals': 'ohne Gesang',
  'desktop.modeOverSong': 'zum Song',
  'desktop.playRecording': 'Aufnahme abspielen',
  'desktop.shareHint': 'Teilen – eine Kopie irgendwo speichern',
  'desktop.shared': 'Kopie von „{name}“ gespeichert',
  'desktop.deleteHint': 'Die Datei wird aus Music/Karaoke gelöscht.',
  // Stats
  'desktop.statPlays': 'Wiedergaben',
  'desktop.statSongs': 'Songs',
  'desktop.statDaily': 'Tagesdurchschnitt',
  'desktop.statLibrary': 'Mediathek gehört',
  'desktop.lastWeek': 'in den letzten 7 Tagen',
  'desktop.lastMonth': 'in den letzten 30 Tagen',
  'desktop.allTime': 'seit du angefangen hast zu hören',
  'desktop.tapBar': 'Klick auf einen Balken für seinen Wert',
  'desktop.statsFootnote': 'Die Zeit wird gezählt, während du hörst.',
  // Settings
  'desktop.sectionLibrary': 'Mediathek',
  'desktop.sectionKaraoke': 'Karaoke',
  'desktop.sectionKeyboard': 'Tastatur',
  'desktop.scanSub':
    'Deine Ordner Musik und Downloads – holt nach einer Neuinstallation auch die in Music/stash gespeicherten Songs zurück',
  'desktop.scanDone': {
    one: '{count} Song auf diesem Computer gefunden ({added} neu)',
    other: '{count} Songs auf diesem Computer gefunden ({added} neu)',
  },
  'desktop.scan': 'Scannen',
  'desktop.open': 'Öffnen',
  'desktop.miniPlayer': 'Mini-Vinyl-Player',
  'desktop.miniPlayerSub':
    'Schwebt über anderen Fenstern, während stash minimiert oder in den Infobereich geschlossen ist.',
  'desktop.miniColour': 'Fortschrittsfarbe des Mini-Players',
  'desktop.vinylStyleSub': 'Im Bereich „Läuft gerade“ und im Mini-Player verwendet',
  'desktop.playerBackgroundSub': 'Passt sich dem Cover jedes Songs an',
  'desktop.keepAwake': 'Bildschirm im Vollbild anlassen',
  'desktop.keepAwakeSub':
    'Der Bildschirm geht nicht in den Ruhezustand, solange der Vollbild-Player offen ist',
  'desktop.languageSub': 'Nutzt standardmäßig deine Systemsprache',
  'desktop.systemLanguage': 'Systemsprache · {name}',
  'desktop.languageHint':
    'Nutzt standardmäßig deine Systemsprache. Arabisch stellt das Layout nach einem Neustart auf rechts nach links um.',
  'desktop.restartBanner':
    'Starte stash neu, um zu {name} zu wechseln – die Layout-Richtung ändert sich.',
  'desktop.restart': 'Neu starten',
  'desktop.voiceRemover': 'Stimmentferner',
  'desktop.voiceRemoverReady': '{name} · {size} · funktioniert offline',
  'desktop.voiceRemoverMissing':
    'Wird einmalig geladen ({size}), wenn du zum ersten Mal Gesang entfernst',
  'desktop.voiceRemoverDeleted': 'Stimmentferner gelöscht – {size} frei geworden',
  'desktop.recordingsIn': {
    one: '{count} Aufnahme · in Music/Karaoke',
    other: '{count} Aufnahmen · in Music/Karaoke',
  },
  'desktop.youtubeDevice': 'Auf diesem Computer',
  'desktop.youtubeDeviceHint':
    'Durchsucht YouTube Music und holt den Ton direkt auf diesen Computer – ganz ohne Server. Songs werden in Originalqualität gespeichert.',
  'desktop.checkUpdatesSub':
    'Neue Versionen von GitHub werden bei jedem Start angeboten',
  'desktop.devBuild':
    'Entwicklungsversion – Updates kommen mit veröffentlichten Versionen',
  'desktop.version': 'Version {version} · Desktop',
  'desktop.keyPlayPause': 'Abspielen / Pause',
  'desktop.keyLyrics': 'Songtext ein- oder ausblenden',
  'desktop.keyFull': 'Vollbild-Player',
  'desktop.keySkip': 'Nächster oder vorheriger Song',
  'desktop.keySearch': 'Suche',
  'desktop.keyEsc': 'Einen Dialog, das Vollbild oder die Mini-Player-Karte schließen',
  // Player
  'desktop.lyrics': 'Songtext',
  'desktop.sleep': 'Sleep-Timer',
  'desktop.upNext': 'Als Nächstes',
  'desktop.fullScreen': 'Vollbild (F)',
  'desktop.exitFullScreen': 'Vollbild beenden (Esc)',
  'desktop.volume': 'Lautstärke',
  'desktop.mute': 'Stummschalten',
  'desktop.unmute': 'Ton einschalten',
  'desktop.hidePanel': 'Bereich ausblenden',
  'desktop.nowPlayingPanel': 'Bereich „Läuft gerade“',
  'desktop.dragCover': 'Seitlich ziehen für nächsten oder vorherigen Song',
  'desktop.queueHint':
    'Zieh ≡ zum Umsortieren · wisch einen Song zur Seite, um ihn herauszunehmen',
  'desktop.takenOut': 'Aus der Warteschlange genommen – noch in deiner Mediathek',
  'desktop.repeat': 'Wiederholen',
  'desktop.similarSongs': 'Ähnliche Songs',
  'desktop.playPauseKey': 'Abspielen / Pause (Space)',
  'desktop.lyricsKey': 'Songtext (L)',
  'desktop.useLyrics': 'Diesen Songtext verwenden',
  'desktop.backToFound': 'Zurück zum gefundenen Songtext',
  'desktop.editYours': 'Eigenen bearbeiten',
  'desktop.usingYours': 'Dein Songtext wird verwendet',
  'desktop.lyricsOfflineHint':
    'Songtexte werden beim ersten Mal online gesucht und dann auf diesem Computer gespeichert.',
  // Karaoke
  'desktop.closeKaraoke': 'Karaoke schließen',
  'desktop.karaokeRemoveHint':
    'Ein KI-Stimmentferner nimmt den Gesang heraus, direkt auf diesem Computer. Nichts wird irgendwohin gesendet.',
  'desktop.tagInstant': 'Öffnet sofort',
  'desktop.tagOffline': 'Funktioniert offline',
  'desktop.tagOnce': '{size}, einmalig',
  'desktop.gettingRemover': 'Stimmentferner wird geladen',
  'desktop.removerFrom':
    '{name}, von Ultimate Vocal Remover. Wird einmal geladen und funktioniert dann offline.',
  'desktop.ofSize': '{received} von {total}',
  'desktop.nothingSent':
    'Nichts wird irgendwohin gesendet – deine Songs bleiben auf diesem Computer.',
  'desktop.waitingMusic': 'Warte auf die Musik',
  'desktop.paused': 'Pausiert',
  'desktop.readyToSing': 'Bereit zum Singen',
  'desktop.vocalsRemoved': 'Gesang entfernt',
  'desktop.originalSong': 'Originalsong',
  'desktop.subOver': 'Der Song läuft unverändert, mit Gesang.',
  'desktop.subMadeBefore': 'Schon früher erstellt – öffnet jetzt sofort.',
  'desktop.subReady': 'Instrumental fertig.',
  'desktop.subEnough':
    'Instrumental zu {percent} % erstellt – genug zum Starten. Der Rest entsteht, während du singst.',
  'desktop.subMaking':
    'Das Instrumental läuft, während es erstellt wird. Dein Computer wird vermessen, damit die Musik es nie einholt.',
  'desktop.karaokeNoLyrics':
    'Noch kein Songtext für diesen Song – füge deinen in der Songtext-Ansicht des Players ein.',
  'desktop.catchingUp':
    'Das Instrumental holt auf – Musik und Aufnahme sind zusammen pausiert.',
  'desktop.finish': 'Fertig',
  'desktop.recordedLine': '{time} aufgenommen · {mode}',
  'desktop.listenBack': 'Anhören',
  'desktop.inTime': 'Im Takt',
  'desktop.msEarlier': '{ms} ms früher',
  'desktop.msLater': '{ms} ms später',
  'desktop.voiceEarlier': 'Stimme früher',
  'desktop.voiceLater': 'Stimme später',
  'desktop.nameTake': 'Benenne diese Aufnahme',
  'desktop.takeName': '{title} — Aufnahme {n}',
  'desktop.saveRecording': 'Aufnahme speichern',
  'desktop.discard': 'Verwerfen',
  'desktop.takeDiscarded': 'Aufnahme verworfen',
  'desktop.savedHint':
    'In deinem Ordner Music/Karaoke gespeichert, damit andere Musik-Apps sie auch sehen',
  'desktop.savedToast': 'In Music/Karaoke gespeichert',
  'desktop.karaokeNeedsFile':
    'Für Karaoke muss der Song auf diesem Computer gespeichert sein',
  // Mini player
  'desktop.miniHidden':
    'Mini-Player ausgeblendet – er kommt zurück, wenn stash das nächste Mal minimiert wird',
  'desktop.miniEmpty':
    'Like Songs, um sie hier zu behalten, und aktiviere „Ähnliche Songs vorschlagen“ für Ideen.',
  // Updates
  'desktop.installing': 'Wird installiert – stash startet von selbst neu',
};

export default defineStrings({ en, fr, ar, es, de });
