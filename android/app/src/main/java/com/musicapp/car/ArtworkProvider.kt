package com.musicapp.car

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException

/**
 * Serves the saved cover images to Android Auto, which runs in another app and
 * can't read `file://` paths inside this app. Read-only, and only the artwork folder.
 */
class ArtworkProvider : ContentProvider() {

  override fun onCreate() = true

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    val ctx = context ?: throw FileNotFoundException()
    val dir = artworkDir(ctx).canonicalFile
    val file = File(dir, uri.lastPathSegment ?: "").canonicalFile
    if (file.parentFile != dir || !file.isFile) throw FileNotFoundException(uri.toString())
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  override fun getType(uri: Uri): String =
    if (uri.lastPathSegment?.endsWith(".png") == true) "image/png" else "image/jpeg"

  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0

  companion object {
    /** Same folder as ARTWORK_DIR in src/services/paths.ts (DocumentDir = filesDir). */
    private fun artworkDir(context: Context) = File(context.filesDir, "artwork")

    /** A local cover path becomes a content:// URI; web URLs pass through. */
    fun uriFor(context: Context, art: String?): Uri? {
      if (art.isNullOrEmpty()) return null
      val path = art.removePrefix("file://")
      if (!path.startsWith("/")) return Uri.parse(art)
      val file = File(path)
      if (file.parentFile?.canonicalPath != artworkDir(context).canonicalPath) return null
      return Uri.Builder()
        .scheme("content")
        .authority(context.packageName + ".artwork")
        .appendPath(file.name)
        .build()
    }
  }
}
