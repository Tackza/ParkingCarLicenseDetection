package com.donnytang.myapp.lpr

import android.app.Application
import android.content.Context
import androidx.test.runner.AndroidJUnitRunner

/**
 * Boots the test process with a plain [Application] instead of `MainApplication`.
 *
 * `MainApplication.onCreate` starts the whole Expo/React Native stack, and under instrumentation
 * expo-dev-launcher immediately kills the process:
 *
 *     java.lang.IllegalStateException: DevelopmentClientController was initialized.
 *         at expo.modules.devlauncher.DevLauncherController$Companion.initialize
 *         at com.donnytang.myapp.MainApplication.onCreate
 *
 * [LprOcr] needs nothing from React Native — only a Context to reach the bundled assets — so the
 * cheapest correct fix is to not start React Native at all. This also keeps the test honest: it
 * exercises the OCR engine, not the app shell.
 */
class LprTestRunner : AndroidJUnitRunner() {
    override fun newApplication(cl: ClassLoader?, className: String?, context: Context?): Application =
        super.newApplication(cl, Application::class.java.name, context)
}
