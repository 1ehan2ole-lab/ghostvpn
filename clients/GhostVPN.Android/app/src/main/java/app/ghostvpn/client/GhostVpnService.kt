// GhostVPN — клиент для Android.
// Управление подпиской и серверами + VPN-туннель (VpnService + sing-box + tun2socks).

package app.ghostvpn.client

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.File

/**
 * VPN-сервис: поднимает TUN-интерфейс и передаёт пакеты в локальный SOCKS-прокси,
 * который держит ядро sing-box (VLESS + REALITY).
 */
class GhostVpnService : VpnService() {

    private var singBox: Process? = null
    private var tunnel: Process? = null
    private var tunInterface: ParcelFileDescriptor? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_STOP
        if (action == ACTION_STOP) {
            stopTunnel()
            stopSelf()
            return START_NOT_STICKY
        }

        val configPath = intent?.getStringExtra(EXTRA_CONFIG) ?: return START_NOT_STICKY
        val socksPort = intent?.getIntExtra(EXTRA_SOCKS_PORT, 2080) ?: 2080

        startForeground(NOTIFICATION_ID, buildNotification())

        try {
            startSingBox(configPath)
            startTunnel(socksPort)
        } catch (e: Exception) {
            Log.e(TAG, "Не удалось запустить туннель", e)
            stopTunnel()
            stopSelf()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopTunnel()
        super.onDestroy()
    }

    override fun onRevoke() {
        stopTunnel()
        super.onRevoke()
    }

    // --- ядро sing-box ---

    private fun startSingBox(configPath: String) {
        val binary = File(applicationInfo.nativeLibraryDir, SINGBOX_BINARY)
        if (!binary.exists()) {
            throw IllegalStateException("Ядро sing-box не найдено: ${binary.path}")
        }
        binary.setExecutable(true)

        val process = ProcessBuilder(binary.absolutePath, "run", "--config", configPath)
            .redirectErrorStream(true)
            .start()
        process.inputStream.bufferedReader().forEachLine { Log.i(TAG, it) }
        singBox = process
    }

    // --- TUN -> SOCKS ---

    private fun startTunnel(socksPort: Int) {
        val builder = Builder()
            .setSession("GhostVPN")
            .setMtu(9000)
            .addAddress("172.19.0.1", 30)
            .addAddress("fdfe:cafe::1", 126)
            .addRoute("0.0.0.0", 0)
            .addRoute("::", 0)
            .addDnsServer("1.1.1.1")
            .addDnsServer("8.8.8.8")
            .setBlocking(true)

        val fd = builder.establish() ?: throw IllegalStateException("Не удалось создать TUN")
        tunInterface = fd

        val tunnelBinary = File(applicationInfo.nativeLibraryDir, TUNNEL_BINARY)
        if (tunnelBinary.exists()) {
            tunnelBinary.setExecutable(true)
            // hev-socks5-tunnel: -s <socks> <tun fd>
            val process = ProcessBuilder(
                tunnelBinary.absolutePath,
                "-s", "127.0.0.1:$socksPort",
                fd.fd.toString()
            ).redirectErrorStream(true).start()
            process.inputStream.bufferedReader().forEachLine { Log.i(TAG, it) }
            tunnel = process
        } else {
            Log.w(TAG, "tun2socks не найден - трафик пойдёт через SOCKS вручную")
        }
    }

    private fun stopTunnel() {
        tunnel?.destroy()
        tunnel = null
        singBox?.destroy()
        singBox = null
        try {
            tunInterface?.close()
        } catch (_: Exception) {
        }
        tunInterface = null
    }

    // --- уведомление ---

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Подключение",
            NotificationManager.IMPORTANCE_LOW
        )
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pending = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("GhostVPN")
            .setContentText("Подключение активно")
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentIntent(pending)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "GhostVPN"
        private const val CHANNEL_ID = "ghostvpn"
        private const val NOTIFICATION_ID = 1001

        const val ACTION_START = "app.ghostvpn.client.START"
        const val ACTION_STOP = "app.ghostvpn.client.STOP"
        const val EXTRA_CONFIG = "config"
        const val EXTRA_SOCKS_PORT = "socks_port"

        const val SINGBOX_BINARY = "libexec.so"
        const val TUNNEL_BINARY = "libhev-socks5-tunnel.so"

        /** Запуск VPN-сервиса (после подтверждения пользователя). */
        fun start(context: Context, configPath: String, socksPort: Int) {
            val intent = Intent(context, GhostVpnService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_CONFIG, configPath)
                putExtra(EXTRA_SOCKS_PORT, socksPort)
            }
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, GhostVpnService::class.java).apply { action = ACTION_STOP }
            context.startService(intent)
        }
    }
}
