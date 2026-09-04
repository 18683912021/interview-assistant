package com.poc.audiocapture.filepicker

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments

class FilePickerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "FilePicker"

    private var pickPromise: Promise? = null
    private val PICK_PDF = 9001
    private val PICK_DOC = 9002

    private val activityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(
            activity: Activity, requestCode: Int, resultCode: Int, data: Intent?
        ) {
            val promise = pickPromise ?: return
            pickPromise = null

            if (resultCode != Activity.RESULT_OK || data?.data == null) {
                promise.resolve(null)
                return
            }

            if (requestCode != PICK_PDF && requestCode != PICK_DOC) return

            val uri = data.data!!
            try {
                val contentResolver = reactApplicationContext.contentResolver
                val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"
                // 从 content resolver 获取真实文件名
                var originalName = "file"
                contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val idx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                        if (idx >= 0) {
                            originalName = cursor.getString(idx) ?: "file"
                        }
                    }
                }
                val destFile = java.io.File(reactApplicationContext.cacheDir, originalName.ifBlank { "file" })

                contentResolver.openInputStream(uri)?.use { input ->
                    destFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }

                val result: WritableMap = Arguments.createMap().apply {
                    putString("uri", "file://${destFile.absolutePath}")
                    putString("name", originalName)
                    putString("type", mimeType)
                    putInt("size", destFile.length().toInt())
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("FILE_ERROR", e.message ?: "读取文件失败")
            }
        }
    }

    init {
        reactApplicationContext.addActivityEventListener(activityEventListener)
    }

    @ReactMethod
    fun pickPDF(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "无法启动文件选择器")
            return
        }
        pickPromise = promise
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/pdf"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
        }
        activity.startActivityForResult(intent, PICK_PDF)
    }

    @ReactMethod
    fun pickDocument(mimeTypes: com.facebook.react.bridge.ReadableArray, promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "无法启动文件选择器")
            return
        }
        pickPromise = promise
        val types = Array(mimeTypes.size()) { mimeTypes.getString(it) }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            if (types.size == 1) {
                type = types[0]
            } else {
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, types)
            }
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
        }
        activity.startActivityForResult(intent, PICK_DOC)
    }
}
