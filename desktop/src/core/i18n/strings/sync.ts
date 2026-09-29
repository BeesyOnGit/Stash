/** Wi-Fi sync between the phone and computer apps. Keys start with `sync.`. Same file in both apps. */
import { defineStrings } from '../types';

export default defineStrings({
  en: {
    'sync.titlePhone': 'Sync with computer',
    'sync.titleDesktop': 'Sync with phone',
    'sync.intro':
      'Your library, songs, playlists, likes, stats, lyrics and karaoke recordings on both devices. Over Wi-Fi or the phone’s hotspot, no internet needed.',
    // Pairing (phone)
    'sync.pairScan': 'Pair with your computer',
    'sync.pairScanSub':
      'On the computer, open Settings → Sync with phone and scan its QR code',
    'sync.pairCode': 'Use the 6-digit code instead',
    'sync.pairCodeSub': 'For when the QR code can’t be scanned',
    'sync.searching': 'Looking for computers…',
    'sync.noneFound':
      'No computer found. Open stash on it, on the same Wi-Fi or hotspot.',
    'sync.enterCode': 'Code shown on {name}',
    'sync.pairButton': 'Pair',
    'sync.paired': 'Paired with {name}',
    'sync.errNotFound':
      'Couldn’t reach the computer. Are both on the same Wi-Fi or hotspot?',
    'sync.errWrongCode': 'Wrong code. Check it on the computer and try again.',
    'sync.errClosed': 'Open Settings → Sync with phone on the computer first.',
    'sync.errFailed': 'Pairing didn’t work. Try again.',
    'sync.updatePhone': 'Update stash on your phone to sync',
    'sync.updateComputer': 'Update stash on your PC to sync',
    // Status
    'sync.syncing': 'Syncing…',
    'sync.lookingFor': 'Looking for {name}…',
    'sync.offline': 'Not reachable · syncs when both are on the same network',
    'sync.connected': 'Connected',
    'sync.lastSync': 'Last synced {time}',
    'sync.never': 'Not synced yet',
    'sync.justNow': 'just now',
    'sync.minutesAgo': { one: '{count} min ago', other: '{count} min ago' },
    'sync.hoursAgo': { one: '{count} hour ago', other: '{count} hours ago' },
    'sync.daysAgo': { one: '{count} day ago', other: '{count} days ago' },
    'sync.syncNow': 'Sync now',
    'sync.unpair': 'Unpair',
    'sync.unpairSub': 'Stop syncing with {name}',
    'sync.unpairTitle': 'Unpair {name}?',
    'sync.unpairBody': 'Nothing is deleted. You can pair again any time.',
    'sync.unpairedByOther':
      'The other device unpaired. Pair again to keep syncing.',
    'sync.cancel': 'Cancel',
    // Files
    'sync.receiving': 'Receiving files',
    'sync.sending': 'Sending files',
    'sync.filesLeft': { one: '{count} file left', other: '{count} files left' },
    'sync.secondsLeft': {
      one: 'about {count} second left',
      other: 'about {count} seconds left',
    },
    'sync.minutesLeft': {
      one: 'about {count} minute left',
      other: 'about {count} minutes left',
    },
    'sync.notifTitle': 'Syncing with {name}',
    // Computer
    'sync.pairPhone': 'Pair a phone',
    'sync.pairPhoneSub': 'Shows a QR code to scan with stash on your phone',
    'sync.scanThis':
      'In stash on your phone: Settings → Sync with computer → Pair with your computer, then scan this code.',
    'sync.orCode': 'Or enter this code on the phone',
    'sync.waitingPhone': 'Waiting for the phone…',
    'sync.close': 'Close',
    'sync.phoneAway':
      'Not connected · open stash on the phone, on the same network',
    'sync.serverError': 'Sync couldn’t start: {error}',
    'sync.firewall':
      'If the phone can’t find this computer, allow stash through the firewall on private networks.',
  },
  fr: {
    'sync.titlePhone': 'Synchro avec l’ordinateur',
    'sync.titleDesktop': 'Synchro avec le téléphone',
    'sync.intro':
      'Votre bibliothèque, vos titres, playlists, favoris, statistiques, paroles et enregistrements karaoké sur les deux appareils. Par Wi-Fi ou le partage de connexion du téléphone, sans internet.',
    'sync.pairScan': 'Associer votre ordinateur',
    'sync.pairScanSub':
      'Sur l’ordinateur, ouvrez Réglages → Synchro avec le téléphone et scannez son code QR',
    'sync.pairCode': 'Utiliser plutôt le code à 6 chiffres',
    'sync.pairCodeSub': 'Si le code QR ne peut pas être scanné',
    'sync.searching': 'Recherche d’ordinateurs…',
    'sync.noneFound':
      'Aucun ordinateur trouvé. Ouvrez stash dessus, sur le même Wi-Fi ou partage de connexion.',
    'sync.enterCode': 'Code affiché sur {name}',
    'sync.pairButton': 'Associer',
    'sync.paired': 'Associé à {name}',
    'sync.errNotFound':
      'Impossible de joindre l’ordinateur. Les deux sont-ils sur le même Wi-Fi ou partage de connexion ?',
    'sync.errWrongCode':
      'Code incorrect. Vérifiez-le sur l’ordinateur et réessayez.',
    'sync.errClosed':
      'Ouvrez d’abord Réglages → Synchro avec le téléphone sur l’ordinateur.',
    'sync.errFailed': 'L’association n’a pas fonctionné. Réessayez.',
    'sync.updatePhone': 'Mettez à jour stash sur votre téléphone pour synchroniser',
    'sync.updateComputer': 'Mettez à jour stash sur votre PC pour synchroniser',
    'sync.syncing': 'Synchronisation…',
    'sync.lookingFor': 'Recherche de {name}…',
    'sync.offline':
      'Injoignable · la synchro reprend quand les deux sont sur le même réseau',
    'sync.connected': 'Connecté',
    'sync.lastSync': 'Dernière synchro {time}',
    'sync.never': 'Pas encore synchronisé',
    'sync.justNow': 'à l’instant',
    'sync.minutesAgo': { one: 'il y a {count} min', other: 'il y a {count} min' },
    'sync.hoursAgo': { one: 'il y a {count} heure', other: 'il y a {count} heures' },
    'sync.daysAgo': { one: 'il y a {count} jour', other: 'il y a {count} jours' },
    'sync.syncNow': 'Synchroniser',
    'sync.unpair': 'Dissocier',
    'sync.unpairSub': 'Arrêter la synchro avec {name}',
    'sync.unpairTitle': 'Dissocier {name} ?',
    'sync.unpairBody':
      'Rien n’est supprimé. Vous pouvez les associer à nouveau à tout moment.',
    'sync.unpairedByOther':
      'L’autre appareil s’est dissocié. Associez-les à nouveau pour continuer.',
    'sync.cancel': 'Annuler',
    'sync.receiving': 'Réception de fichiers',
    'sync.sending': 'Envoi de fichiers',
    'sync.filesLeft': {
      one: '{count} fichier restant',
      other: '{count} fichiers restants',
    },
    'sync.secondsLeft': {
      one: 'environ {count} seconde restante',
      other: 'environ {count} secondes restantes',
    },
    'sync.minutesLeft': {
      one: 'environ {count} minute restante',
      other: 'environ {count} minutes restantes',
    },
    'sync.notifTitle': 'Synchro avec {name}',
    'sync.pairPhone': 'Associer un téléphone',
    'sync.pairPhoneSub': 'Affiche un code QR à scanner avec stash sur votre téléphone',
    'sync.scanThis':
      'Dans stash sur votre téléphone : Réglages → Synchro avec l’ordinateur → Associer votre ordinateur, puis scannez ce code.',
    'sync.orCode': 'Ou saisissez ce code sur le téléphone',
    'sync.waitingPhone': 'En attente du téléphone…',
    'sync.close': 'Fermer',
    'sync.phoneAway':
      'Non connecté · ouvrez stash sur le téléphone, sur le même réseau',
    'sync.serverError': 'La synchro n’a pas pu démarrer : {error}',
    'sync.firewall':
      'Si le téléphone ne trouve pas cet ordinateur, autorisez stash dans le pare-feu pour les réseaux privés.',
  },
  ar: {
    'sync.titlePhone': 'المزامنة مع الكمبيوتر',
    'sync.titleDesktop': 'المزامنة مع الهاتف',
    'sync.intro':
      'مكتبتك وأغانيك وقوائم التشغيل والإعجابات والإحصاءات والكلمات وتسجيلات الكاريوكي على الجهازين. عبر Wi-Fi أو نقطة اتصال الهاتف، دون الحاجة إلى الإنترنت.',
    'sync.pairScan': 'اقرن هاتفك بالكمبيوتر',
    'sync.pairScanSub':
      'على الكمبيوتر، افتح الإعدادات ← المزامنة مع الهاتف وامسح رمز QR',
    'sync.pairCode': 'استخدم الرمز المكوّن من 6 أرقام بدلًا من ذلك',
    'sync.pairCodeSub': 'عندما يتعذّر مسح رمز QR',
    'sync.searching': 'جارٍ البحث عن أجهزة كمبيوتر…',
    'sync.noneFound':
      'لم يُعثر على أي كمبيوتر. افتح stash عليه، على شبكة Wi-Fi نفسها أو نقطة الاتصال نفسها.',
    'sync.enterCode': 'الرمز الظاهر على {name}',
    'sync.pairButton': 'اقرن',
    'sync.paired': 'تم الاقتران بـ {name}',
    'sync.errNotFound':
      'تعذّر الوصول إلى الكمبيوتر. هل الجهازان على شبكة Wi-Fi نفسها أو نقطة الاتصال نفسها؟',
    'sync.errWrongCode': 'رمز خاطئ. تحقّق منه على الكمبيوتر وحاول مجددًا.',
    'sync.errClosed': 'افتح أولًا الإعدادات ← المزامنة مع الهاتف على الكمبيوتر.',
    'sync.errFailed': 'لم ينجح الاقتران. حاول مجددًا.',
    'sync.updatePhone': 'حدّث stash على هاتفك للمزامنة',
    'sync.updateComputer': 'حدّث stash على الكمبيوتر للمزامنة',
    'sync.syncing': 'جارٍ المزامنة…',
    'sync.lookingFor': 'جارٍ البحث عن {name}…',
    'sync.offline': 'غير متاح · تتم المزامنة عندما يكون الجهازان على الشبكة نفسها',
    'sync.connected': 'متصل',
    'sync.lastSync': 'آخر مزامنة {time}',
    'sync.never': 'لم تتم المزامنة بعد',
    'sync.justNow': 'الآن',
    'sync.minutesAgo': {
      zero: 'منذ {count} دقيقة',
      one: 'منذ دقيقة',
      two: 'منذ دقيقتين',
      few: 'منذ {count} دقائق',
      many: 'منذ {count} دقيقة',
      other: 'منذ {count} دقيقة',
    },
    'sync.hoursAgo': {
      zero: 'منذ {count} ساعة',
      one: 'منذ ساعة',
      two: 'منذ ساعتين',
      few: 'منذ {count} ساعات',
      many: 'منذ {count} ساعة',
      other: 'منذ {count} ساعة',
    },
    'sync.daysAgo': {
      zero: 'منذ {count} يوم',
      one: 'منذ يوم',
      two: 'منذ يومين',
      few: 'منذ {count} أيام',
      many: 'منذ {count} يومًا',
      other: 'منذ {count} يوم',
    },
    'sync.syncNow': 'زامن الآن',
    'sync.unpair': 'إلغاء الاقتران',
    'sync.unpairSub': 'إيقاف المزامنة مع {name}',
    'sync.unpairTitle': 'إلغاء الاقتران بـ {name}؟',
    'sync.unpairBody': 'لن يُحذف أي شيء. يمكنك الاقتران مجددًا في أي وقت.',
    'sync.unpairedByOther':
      'ألغى الجهاز الآخر الاقتران. اقرن الجهازين مجددًا لمواصلة المزامنة.',
    'sync.cancel': 'إلغاء',
    'sync.receiving': 'جارٍ استلام الملفات',
    'sync.sending': 'جارٍ إرسال الملفات',
    'sync.filesLeft': {
      zero: 'لم يتبقَّ أي ملف',
      one: 'تبقّى ملف واحد',
      two: 'تبقّى ملفان',
      few: 'تبقّت {count} ملفات',
      many: 'تبقّى {count} ملفًا',
      other: 'تبقّى {count} ملف',
    },
    'sync.secondsLeft': {
      zero: 'تبقّى نحو {count} ثانية',
      one: 'تبقّت نحو ثانية',
      two: 'تبقّت نحو ثانيتين',
      few: 'تبقّت نحو {count} ثوانٍ',
      many: 'تبقّت نحو {count} ثانية',
      other: 'تبقّت نحو {count} ثانية',
    },
    'sync.minutesLeft': {
      zero: 'تبقّى نحو {count} دقيقة',
      one: 'تبقّت نحو دقيقة',
      two: 'تبقّت نحو دقيقتين',
      few: 'تبقّت نحو {count} دقائق',
      many: 'تبقّت نحو {count} دقيقة',
      other: 'تبقّت نحو {count} دقيقة',
    },
    'sync.notifTitle': 'جارٍ المزامنة مع {name}',
    'sync.pairPhone': 'اقرن هاتفًا',
    'sync.pairPhoneSub': 'يعرض رمز QR لمسحه باستخدام stash على هاتفك',
    'sync.scanThis':
      'في stash على هاتفك: الإعدادات ← المزامنة مع الكمبيوتر ← اقرن هاتفك بالكمبيوتر، ثم امسح هذا الرمز.',
    'sync.orCode': 'أو أدخل هذا الرمز على الهاتف',
    'sync.waitingPhone': 'في انتظار الهاتف…',
    'sync.close': 'إغلاق',
    'sync.phoneAway': 'غير متصل · افتح stash على الهاتف، على الشبكة نفسها',
    'sync.serverError': 'تعذّر بدء المزامنة: {error}',
    'sync.firewall':
      'إذا لم يعثر الهاتف على هذا الكمبيوتر، فاسمح لـ stash عبر جدار الحماية على الشبكات الخاصة.',
  },
  es: {
    'sync.titlePhone': 'Sincronizar con el ordenador',
    'sync.titleDesktop': 'Sincronizar con el móvil',
    'sync.intro':
      'Tu biblioteca, canciones, listas, favoritos, estadísticas, letras y grabaciones de karaoke en los dos dispositivos. Por Wi-Fi o el punto de acceso del móvil, sin internet.',
    'sync.pairScan': 'Vincular con tu ordenador',
    'sync.pairScanSub':
      'En el ordenador, abre Ajustes → Sincronizar con el móvil y escanea su código QR',
    'sync.pairCode': 'Usar el código de 6 dígitos',
    'sync.pairCodeSub': 'Si no se puede escanear el código QR',
    'sync.searching': 'Buscando ordenadores…',
    'sync.noneFound':
      'No se encontró ningún ordenador. Abre stash en él, en la misma Wi-Fi o punto de acceso.',
    'sync.enterCode': 'Código que muestra {name}',
    'sync.pairButton': 'Vincular',
    'sync.paired': 'Vinculado con {name}',
    'sync.errNotFound':
      'No se pudo conectar con el ordenador. ¿Están los dos en la misma Wi-Fi o punto de acceso?',
    'sync.errWrongCode':
      'Código incorrecto. Compruébalo en el ordenador e inténtalo de nuevo.',
    'sync.errClosed':
      'Primero abre Ajustes → Sincronizar con el móvil en el ordenador.',
    'sync.errFailed': 'No se pudo vincular. Inténtalo de nuevo.',
    'sync.updatePhone': 'Actualiza stash en tu móvil para sincronizar',
    'sync.updateComputer': 'Actualiza stash en tu PC para sincronizar',
    'sync.syncing': 'Sincronizando…',
    'sync.lookingFor': 'Buscando {name}…',
    'sync.offline':
      'No disponible · se sincroniza cuando ambos estén en la misma red',
    'sync.connected': 'Conectado',
    'sync.lastSync': 'Última sincronización {time}',
    'sync.never': 'Aún no sincronizado',
    'sync.justNow': 'ahora mismo',
    'sync.minutesAgo': { one: 'hace {count} min', other: 'hace {count} min' },
    'sync.hoursAgo': { one: 'hace {count} hora', other: 'hace {count} horas' },
    'sync.daysAgo': { one: 'hace {count} día', other: 'hace {count} días' },
    'sync.syncNow': 'Sincronizar ahora',
    'sync.unpair': 'Desvincular',
    'sync.unpairSub': 'Dejar de sincronizar con {name}',
    'sync.unpairTitle': '¿Desvincular {name}?',
    'sync.unpairBody':
      'No se borra nada. Puedes volver a vincularlos cuando quieras.',
    'sync.unpairedByOther':
      'El otro dispositivo se desvinculó. Vuelve a vincularlos para seguir sincronizando.',
    'sync.cancel': 'Cancelar',
    'sync.receiving': 'Recibiendo archivos',
    'sync.sending': 'Enviando archivos',
    'sync.filesLeft': {
      one: 'Queda {count} archivo',
      other: 'Quedan {count} archivos',
    },
    'sync.secondsLeft': {
      one: 'queda {count} segundo aprox.',
      other: 'quedan {count} segundos aprox.',
    },
    'sync.minutesLeft': {
      one: 'queda {count} minuto aprox.',
      other: 'quedan {count} minutos aprox.',
    },
    'sync.notifTitle': 'Sincronizando con {name}',
    'sync.pairPhone': 'Vincular un móvil',
    'sync.pairPhoneSub': 'Muestra un código QR para escanear con stash en tu móvil',
    'sync.scanThis':
      'En stash en tu móvil: Ajustes → Sincronizar con el ordenador → Vincular con tu ordenador, y escanea este código.',
    'sync.orCode': 'O escribe este código en el móvil',
    'sync.waitingPhone': 'Esperando al móvil…',
    'sync.close': 'Cerrar',
    'sync.phoneAway':
      'No conectado · abre stash en el móvil, en la misma red',
    'sync.serverError': 'No se pudo iniciar la sincronización: {error}',
    'sync.firewall':
      'Si el móvil no encuentra este ordenador, permite stash en el cortafuegos para redes privadas.',
  },
  de: {
    'sync.titlePhone': 'Mit Computer synchronisieren',
    'sync.titleDesktop': 'Mit Handy synchronisieren',
    'sync.intro':
      'Deine Bibliothek, Songs, Playlists, Likes, Statistiken, Songtexte und Karaoke-Aufnahmen auf beiden Geräten. Über WLAN oder den Hotspot des Handys, ohne Internet.',
    'sync.pairScan': 'Mit deinem Computer koppeln',
    'sync.pairScanSub':
      'Öffne am Computer Einstellungen → Mit Handy synchronisieren und scanne den QR-Code',
    'sync.pairCode': 'Stattdessen den 6-stelligen Code verwenden',
    'sync.pairCodeSub': 'Falls sich der QR-Code nicht scannen lässt',
    'sync.searching': 'Suche nach Computern…',
    'sync.noneFound':
      'Kein Computer gefunden. Öffne stash dort, im selben WLAN oder Hotspot.',
    'sync.enterCode': 'Code auf {name}',
    'sync.pairButton': 'Koppeln',
    'sync.paired': 'Mit {name} gekoppelt',
    'sync.errNotFound':
      'Der Computer ist nicht erreichbar. Sind beide im selben WLAN oder Hotspot?',
    'sync.errWrongCode':
      'Falscher Code. Prüfe ihn am Computer und versuche es erneut.',
    'sync.errClosed':
      'Öffne zuerst Einstellungen → Mit Handy synchronisieren am Computer.',
    'sync.errFailed': 'Koppeln hat nicht geklappt. Versuche es erneut.',
    'sync.updatePhone': 'Aktualisiere stash auf deinem Handy, um zu synchronisieren',
    'sync.updateComputer': 'Aktualisiere stash auf deinem PC, um zu synchronisieren',
    'sync.syncing': 'Wird synchronisiert…',
    'sync.lookingFor': 'Suche nach {name}…',
    'sync.offline':
      'Nicht erreichbar · synchronisiert, sobald beide im selben Netz sind',
    'sync.connected': 'Verbunden',
    'sync.lastSync': 'Zuletzt synchronisiert {time}',
    'sync.never': 'Noch nicht synchronisiert',
    'sync.justNow': 'gerade eben',
    'sync.minutesAgo': { one: 'vor {count} Min.', other: 'vor {count} Min.' },
    'sync.hoursAgo': { one: 'vor {count} Stunde', other: 'vor {count} Stunden' },
    'sync.daysAgo': { one: 'vor {count} Tag', other: 'vor {count} Tagen' },
    'sync.syncNow': 'Jetzt synchronisieren',
    'sync.unpair': 'Entkoppeln',
    'sync.unpairSub': 'Nicht mehr mit {name} synchronisieren',
    'sync.unpairTitle': '{name} entkoppeln?',
    'sync.unpairBody': 'Es wird nichts gelöscht. Du kannst jederzeit neu koppeln.',
    'sync.unpairedByOther':
      'Das andere Gerät hat die Kopplung aufgehoben. Kopple erneut, um weiter zu synchronisieren.',
    'sync.cancel': 'Abbrechen',
    'sync.receiving': 'Dateien werden empfangen',
    'sync.sending': 'Dateien werden gesendet',
    'sync.filesLeft': {
      one: 'Noch {count} Datei',
      other: 'Noch {count} Dateien',
    },
    'sync.secondsLeft': {
      one: 'noch etwa {count} Sekunde',
      other: 'noch etwa {count} Sekunden',
    },
    'sync.minutesLeft': {
      one: 'noch etwa {count} Minute',
      other: 'noch etwa {count} Minuten',
    },
    'sync.notifTitle': 'Synchronisierung mit {name}',
    'sync.pairPhone': 'Handy koppeln',
    'sync.pairPhoneSub': 'Zeigt einen QR-Code zum Scannen mit stash auf deinem Handy',
    'sync.scanThis':
      'In stash auf deinem Handy: Einstellungen → Mit Computer synchronisieren → Mit deinem Computer koppeln, dann diesen Code scannen.',
    'sync.orCode': 'Oder gib diesen Code am Handy ein',
    'sync.waitingPhone': 'Warte auf das Handy…',
    'sync.close': 'Schließen',
    'sync.phoneAway':
      'Nicht verbunden · öffne stash auf dem Handy, im selben Netz',
    'sync.serverError': 'Synchronisierung konnte nicht starten: {error}',
    'sync.firewall':
      'Findet das Handy diesen Computer nicht, erlaube stash in der Firewall für private Netzwerke.',
  },
});
