package com.musicapp.sync

import android.content.Context
import android.content.Intent
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import java.io.DataInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.URL
import java.net.URLEncoder
import java.security.KeyPair
import java.util.Collections
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * JS side: src/sync/native.ts. Everything of the Wi-Fi sync that needs the
 * phone itself: finding the computer (NSD, or probing the local network),
 * pairing keys, signed + encrypted requests, resumable file transfers, the
 * QR scanner (Google's code scanner: no camera permission) and the
 * foreground service that keeps transfers going.
 */
class SyncModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  override fun getName() = NAME

  private val pool = Executors.newCachedThreadPool()

  /** The paired computer: where it is and the keys (set by JS from its saved pairing). */
  private class Session(val base: String, val device: String, val protocol: Int, val keys: SyncCrypto.Keys)

  @Volatile private var session: Session? = null
  @Volatile private var keyPair: KeyPair? = null
  @Volatile private var cancelled = false
  @Volatile private var lastProgress = 0L

  @ReactMethod
  fun configure(base: String, device: String, secret: String, protocol: Int) {
    session = Session(base.trimEnd('/'), device, protocol, SyncCrypto.Keys(Base64.decode(secret, Base64.NO_WRAP)))
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun deviceName(): String {
    val ctx = reactApplicationContext
    val named = runCatching { Settings.Global.getString(ctx.contentResolver, "device_name") }.getOrNull()
    return named?.takeIf { it.isNotBlank() } ?: "${Build.MANUFACTURER} ${Build.MODEL}".trim()
  }

  // ---- pairing ----

  /** A new ephemeral key pair; returns its public key (base64 SPKI DER). */
  @ReactMethod
  fun keyPair(promise: Promise) = work(promise) {
    val kp = SyncCrypto.ephemeralKeyPair()
    keyPair = kp
    Base64.encodeToString(kp.public.encoded, Base64.NO_WRAP)
  }

  /** secret = HMAC(ECDH shared, message); also both proofs (see protocol.ts). */
  @ReactMethod
  fun pairSecret(peerPub: String, message: String, promise: Promise) = work(promise) {
    val kp = keyPair ?: error("No key pair")
    val shared = SyncCrypto.sharedSecret(kp, Base64.decode(peerPub, Base64.NO_WRAP))
    val secret = SyncCrypto.hmac(shared, message.toByteArray())
    val keys = SyncCrypto.Keys(secret)
    keyPair = null
    Arguments.createMap().apply {
      putString("secret", Base64.encodeToString(secret, Base64.NO_WRAP))
      putString("proof", keys.sign("stash-pair-phone"))
      putString("expected", keys.sign("stash-pair-desktop"))
    }
  }

  // ---- plain requests (no pairing needed) ----

  /** GET <base>/v1/hello → its JSON, or rejects (nothing there, not stash). */
  @ReactMethod
  fun hello(base: String, timeoutMs: Int, promise: Promise) = work(promise) {
    val conn = open("${base.trimEnd('/')}/v1/hello", "GET", timeoutMs)
    try {
      if (conn.responseCode != 200) error("HTTP_${conn.responseCode}")
      conn.inputStream.readBytes().toString(Charsets.UTF_8)
    } finally {
      conn.disconnect()
    }
  }

  @ReactMethod
  fun pair(base: String, body: String, promise: Promise) = work(promise) {
    val conn = open("${base.trimEnd('/')}/v1/pair", "POST", 10_000)
    try {
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/json")
      conn.outputStream.use { it.write(body.toByteArray()) }
      if (conn.responseCode != 200) error("HTTP_${conn.responseCode}")
      conn.inputStream.readBytes().toString(Charsets.UTF_8)
    } finally {
      conn.disconnect()
    }
  }

  // ---- signed, encrypted requests ----

  private fun open(url: String, method: String, timeoutMs: Int): HttpURLConnection =
    (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = timeoutMs
      readTimeout = maxOf(timeoutMs, 60_000)
      useCaches = false
    }

  private fun signed(s: Session, method: String, pathAndQuery: String, bodyHash: String, range: String = ""): HttpURLConnection {
    val ts = System.currentTimeMillis().toString()
    val nonce = SyncCrypto.randomHex(16)
    val conn = open(s.base + pathAndQuery, method, 8_000)
    conn.setRequestProperty("X-Stash-Device", s.device)
    conn.setRequestProperty("X-Stash-Protocol", s.protocol.toString())
    conn.setRequestProperty("X-Stash-Ts", ts)
    conn.setRequestProperty("X-Stash-Nonce", nonce)
    if (range.isNotEmpty()) conn.setRequestProperty("Range", range)
    conn.setRequestProperty("X-Stash-Sig", s.keys.sign("$method\n$pathAndQuery\n$ts\n$nonce\n$range\n$bodyHash"))
    return conn
  }

  private fun fail(conn: HttpURLConnection): Nothing = error("HTTP_${conn.responseCode}")

  /** POST <path> with an encrypted JSON body; resolves with the decrypted JSON answer. */
  @ReactMethod
  fun request(path: String, json: String, promise: Promise) = work(promise) {
    val s = session ?: error("NOT_CONFIGURED")
    val body = s.keys.seal("req:$path", json.toByteArray())
    val conn = signed(s, "POST", path, SyncCrypto.sha256Hex(body))
    try {
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/octet-stream")
      conn.setFixedLengthStreamingMode(body.size)
      conn.outputStream.use { it.write(body) }
      if (conn.responseCode != 200) fail(conn)
      String(s.keys.open("res:$path", conn.inputStream.readBytes()), Charsets.UTF_8)
    } finally {
      conn.disconnect()
    }
  }

  /** The WebSocket address, signed (valid once). */
  @ReactMethod
  fun wsUrl(promise: Promise) = work(promise) {
    val s = session ?: error("NOT_CONFIGURED")
    val ts = System.currentTimeMillis().toString()
    val nonce = SyncCrypto.randomHex(16)
    val sig = s.keys.sign("GET\n/v1/ws\n$ts\n$nonce\n\n${SyncCrypto.sha256Hex(ByteArray(0))}")
    val q = "device=${enc(s.device)}&protocol=${s.protocol}&ts=$ts&nonce=$nonce&sig=$sig"
    s.base.replaceFirst("http", "ws") + "/v1/ws?" + q
  }

  // ---- files ----

  private fun partFile(hash: String) = File(reactApplicationContext.cacheDir, "sync/$hash.part")

  private fun progress(dir: String, hash: String, done: Long, total: Long) {
    val now = System.currentTimeMillis()
    if (done < total && now - lastProgress < 250) return
    lastProgress = now
    runCatching {
      reactApplicationContext.emitDeviceEvent(
        EVENT,
        Arguments.createMap().apply {
          putString("dir", dir)
          putString("hash", hash)
          putDouble("done", done.toDouble())
          putDouble("total", total.toDouble())
        },
      )
    }
  }

  /**
   * Downloads a file from the computer into `dest`, resuming a partial one;
   * checked against its SHA-256 before it's moved there. Resolves with its size.
   */
  @ReactMethod
  fun download(hash: String, dest: String, batch: String, promise: Promise) = work(promise) {
    val s = session ?: error("NOT_CONFIGURED")
    cancelled = false
    val part = partFile(hash)
    part.parentFile?.mkdirs()
    var have = if (part.exists()) part.length() - part.length() % CHUNK else 0L
    RandomAccessFile(part, "rw").use { it.setLength(have) }
    val conn = signed(s, "GET", "/v1/file/$hash", SyncCrypto.sha256Hex(ByteArray(0)), "bytes=$have-")
    conn.setRequestProperty("X-Stash-Batch", batch)
    try {
      val code = conn.responseCode
      // The file changed on the computer since the partial one: start over next time.
      if (code == 416) part.delete()
      if (code != 200 && code != 206) fail(conn)
      if (code == 200 && have > 0) {
        have = 0
        RandomAccessFile(part, "rw").use { it.setLength(0) }
      }
      val total = conn.getHeaderField("X-Stash-Size")?.toLongOrNull() ?: error("No size")
      var index = have / CHUNK
      var done = have
      DataInputStream(conn.inputStream.buffered(1 shl 16)).use { input ->
        FileOutputStream(part, true).use { out ->
          val frame = ByteArray((CHUNK + 64).toInt())
          while (done < total) {
            if (cancelled) error("CANCELLED")
            val len = input.readInt()
            if (len <= 28 || len > frame.size) error("Bad frame")
            input.readFully(frame, 0, len)
            val plain = s.keys.open("$hash:$index", frame, len)
            out.write(plain)
            done += plain.size
            index++
            progress("receive", hash, done, total)
          }
        }
      }
      if (part.length() != total) error("INCOMPLETE")
      if (SyncCrypto.sha256File(part) != hash.lowercase()) {
        part.delete()
        error("HASH_MISMATCH")
      }
      val target = File(dest)
      target.parentFile?.mkdirs()
      if (target.exists()) target.delete()
      if (!part.renameTo(target)) {
        part.copyTo(target, overwrite = true)
        part.delete()
      }
      total.toDouble()
    } finally {
      conn.disconnect()
    }
  }

  /** Sends a file to the computer, resuming where a previous try stopped. */
  @ReactMethod
  fun upload(hash: String, path: String, name: String, batch: String, promise: Promise) = work(promise) {
    val s = session ?: error("NOT_CONFIGURED")
    cancelled = false
    val file = File(path)
    val size = file.length()
    val status = signed(s, "GET", "/v1/upload/$hash", SyncCrypto.sha256Hex(ByteArray(0)))
    val received = try {
      if (status.responseCode != 200) fail(status)
      JSONObject(status.inputStream.readBytes().toString(Charsets.UTF_8)).optLong("received", 0)
    } finally {
      status.disconnect()
    }
    val from = received.coerceAtMost(size).let { it - it % CHUNK }
    val pathAndQuery = "/v1/upload/$hash?size=$size&name=${enc(name)}&from=$from"
    val conn = signed(s, "PUT", pathAndQuery, "-")
    conn.setRequestProperty("X-Stash-Batch", batch)
    try {
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/octet-stream")
      conn.setChunkedStreamingMode(1 shl 16)
      RandomAccessFile(file, "r").use { input ->
        input.seek(from)
        conn.outputStream.buffered(1 shl 16).use { out ->
          val buf = ByteArray(CHUNK.toInt())
          var done = from
          while (done < size) {
            if (cancelled) error("CANCELLED")
            val len = minOf(CHUNK, size - done).toInt()
            input.readFully(buf, 0, len)
            val sealed = s.keys.seal("$hash:${done / CHUNK}", buf, len)
            out.write(byteArrayOf((sealed.size ushr 24).toByte(), (sealed.size ushr 16).toByte(), (sealed.size ushr 8).toByte(), sealed.size.toByte()))
            out.write(sealed)
            done += len
            progress("send", hash, done, size)
          }
        }
      }
      if (conn.responseCode != 200) fail(conn)
      val received = JSONObject(conn.inputStream.readBytes().toString(Charsets.UTF_8)).optLong("received", 0)
      if (received < size) error("INCOMPLETE")
      size.toDouble()
    } finally {
      conn.disconnect()
    }
  }

  @ReactMethod
  fun cancelTransfers() {
    cancelled = true
  }

  // ---- finding the computer ----

  /** The computers announcing `_stash._tcp` on this network (NSD), after `timeoutMs`. */
  @ReactMethod
  fun discover(timeoutMs: Int, promise: Promise) {
    val ctx = reactApplicationContext
    val nsd = ctx.getSystemService(Context.NSD_SERVICE) as NsdManager
    val wifi = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    val lock = wifi.createMulticastLock("stash-sync").apply {
      setReferenceCounted(false)
      runCatching { acquire() }
    }
    val found = Collections.synchronizedList(mutableListOf<Map<String, Any>>())
    val toResolve = ConcurrentLinkedQueue<NsdServiceInfo>()
    var resolving = false

    fun next() {
      synchronized(toResolve) {
        if (resolving) return
        val info = toResolve.poll() ?: return
        resolving = true
        @Suppress("DEPRECATION")
        nsd.resolveService(
          info,
          object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, error: Int) {
              synchronized(toResolve) { resolving = false }
              next()
            }

            override fun onServiceResolved(info: NsdServiceInfo) {
              @Suppress("DEPRECATION")
              val host = info.host?.hostAddress
              if (host != null && info.host is Inet4Address) {
                val id = info.attributes["id"]?.toString(Charsets.UTF_8) ?: ""
                found.add(mapOf("host" to host, "port" to info.port, "id" to id))
              }
              synchronized(toResolve) { resolving = false }
              next()
            }
          },
        )
      }
    }

    val listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(type: String) {}
      override fun onDiscoveryStopped(type: String) {}
      override fun onStartDiscoveryFailed(type: String, error: Int) {}
      override fun onStopDiscoveryFailed(type: String, error: Int) {}
      override fun onServiceLost(info: NsdServiceInfo) {}
      override fun onServiceFound(info: NsdServiceInfo) {
        toResolve.add(info)
        next()
      }
    }
    runCatching { nsd.discoverServices("_stash._tcp", NsdManager.PROTOCOL_DNS_SD, listener) }
    pool.execute {
      Thread.sleep(timeoutMs.toLong())
      runCatching { nsd.stopServiceDiscovery(listener) }
      runCatching { lock.release() }
      val out = Arguments.createArray()
      synchronized(found) {
        found.distinctBy { "${it["host"]}:${it["port"]}" }.forEach { f ->
          out.pushMap(Arguments.createMap().apply {
            putString("host", f["host"] as String)
            putInt("port", f["port"] as Int)
            putString("id", f["id"] as String)
          })
        }
      }
      promise.resolve(out)
    }
  }

  /**
   * Addresses on the phone's own networks (Wi-Fi, or its hotspot) with `port`
   * open: for when mDNS doesn't get through. JS then asks each one /v1/hello.
   */
  @ReactMethod
  fun probeSubnet(port: Int, timeoutMs: Int, promise: Promise) = work(promise) {
    val own = NetworkInterface.getNetworkInterfaces().toList()
      .filter { it.isUp && !it.isLoopback }
      .flatMap { it.inetAddresses.toList() }
      .filterIsInstance<Inet4Address>()
      .filter { it.isSiteLocalAddress }
    val candidates = own.flatMap { a ->
      val b = a.address
      (1..254).map { "${b[0].toInt() and 255}.${b[1].toInt() and 255}.${b[2].toInt() and 255}.$it" }
        .filter { it != a.hostAddress }
    }.distinct()
    val open = Collections.synchronizedList(mutableListOf<String>())
    val probes = Executors.newFixedThreadPool(64)
    candidates.forEach { host ->
      probes.execute {
        runCatching {
          Socket().use { it.connect(InetSocketAddress(host, port), timeoutMs) }
          open.add(host)
        }
      }
    }
    probes.shutdown()
    probes.awaitTermination(timeoutMs.toLong() * (candidates.size / 64 + 2), TimeUnit.MILLISECONDS)
    Arguments.createArray().apply { synchronized(open) { open.forEach { pushString(it) } } }
  }

  // ---- QR code ----

  /** Google's code scanner (Play services): the camera without a permission. */
  @ReactMethod
  fun scanQr(promise: Promise) {
    val ctx = reactApplicationContext.currentActivity ?: reactApplicationContext
    val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    GmsBarcodeScanning.getClient(ctx, options)
      .startScan()
      .addOnSuccessListener { promise.resolve(it.rawValue) }
      .addOnCanceledListener { promise.resolve(null) }
      .addOnFailureListener { promise.reject("SCAN_FAILED", it.message, it) }
  }

  // ---- foreground service (keeps transfers going with the screen off) ----

  @ReactMethod
  fun startForeground(title: String, text: String) {
    val ctx = reactApplicationContext
    val intent = Intent(ctx, SyncService::class.java).putExtra("title", title).putExtra("text", text)
    runCatching {
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent) else ctx.startService(intent)
    }
  }

  @ReactMethod
  fun updateForeground(title: String, text: String, percent: Int) {
    SyncService.update(reactApplicationContext, title, text, percent)
  }

  @ReactMethod
  fun stopForeground() {
    val ctx = reactApplicationContext
    runCatching { ctx.stopService(Intent(ctx, SyncService::class.java)) }
  }

  // Event emitter plumbing (NativeEventEmitter needs these).
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

  /** Runs off the JS thread; errors reject with their message as the code. */
  private fun work(promise: Promise, block: () -> Any?) {
    pool.execute {
      try {
        promise.resolve(block())
      } catch (e: Throwable) {
        val code = e.message?.takeIf { it.matches(Regex("[A-Z_0-9]+")) } ?: "NETWORK"
        promise.reject(code, e.message ?: code, e)
      }
    }
  }

  companion object {
    const val NAME = "StashSync"
    const val EVENT = "StashSyncProgress"
    const val CHUNK = 1L shl 20
  }
}
