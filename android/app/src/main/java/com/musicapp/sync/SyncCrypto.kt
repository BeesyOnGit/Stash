package com.musicapp.sync

import java.io.File
import java.io.FileInputStream
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The sync protocol's cryptography (src/sync/core/protocol.ts), matching the
 * computer's (desktop/src-tauri/src/sync.rs): P-256 ECDH for pairing,
 * HMAC-SHA256 request signatures, AES-256-GCM for data and files.
 */
object SyncCrypto {
  private val random = SecureRandom()

  fun hmac(key: ByteArray, msg: ByteArray): ByteArray =
    Mac.getInstance("HmacSHA256").run {
      init(SecretKeySpec(key, "HmacSHA256"))
      doFinal(msg)
    }

  fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

  fun sha256Hex(data: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(data))

  fun sha256File(file: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buf = ByteArray(1 shl 16)
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        md.update(buf, 0, n)
      }
    }
    return hex(md.digest())
  }

  fun randomHex(bytes: Int) = hex(ByteArray(bytes).also { random.nextBytes(it) })

  fun ephemeralKeyPair(): KeyPair =
    KeyPairGenerator.getInstance("EC").run {
      initialize(ECGenParameterSpec("secp256r1"))
      generateKeyPair()
    }

  /** The ECDH shared secret (x coordinate) with the computer's public key (SPKI DER). */
  fun sharedSecret(own: KeyPair, peerDer: ByteArray): ByteArray {
    val peer = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(peerDer))
    return KeyAgreement.getInstance("ECDH").run {
      init(own.private)
      doPhase(peer, true)
      generateSecret()
    }
  }

  class Keys(secret: ByteArray) {
    val enc = hmac(secret, "stash-enc".toByteArray())
    val mac = hmac(secret, "stash-mac".toByteArray())

    fun sign(msg: String) = hex(hmac(mac, msg.toByteArray()))

    /** nonce(12) | ciphertext | tag(16) */
    fun seal(aad: String, plain: ByteArray, len: Int = plain.size): ByteArray {
      val nonce = ByteArray(12).also { random.nextBytes(it) }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(enc, "AES"), GCMParameterSpec(128, nonce))
      cipher.updateAAD(aad.toByteArray())
      return nonce + cipher.doFinal(plain, 0, len)
    }

    fun open(aad: String, data: ByteArray, len: Int = data.size): ByteArray {
      require(len >= 28) { "Frame too short" }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(enc, "AES"), GCMParameterSpec(128, data, 0, 12))
      cipher.updateAAD(aad.toByteArray())
      return cipher.doFinal(data, 12, len - 12)
    }
  }
}
