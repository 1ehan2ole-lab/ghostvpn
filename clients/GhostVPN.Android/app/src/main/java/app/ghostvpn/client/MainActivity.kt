package app.ghostvpn.client

import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import androidx.core.net.toUri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private val Brand = Color(0xFF7C5CFF)
private val Accent = Color(0xFF22D3EE)
private val Surface = Color(0xFF14172B)
private val Border = Color(0xFF2A2F52)

class MainActivity : ComponentActivity() {

    private val vpnPermission = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK) {
            pendingConfigPath?.let { GhostVpnService.start(this, it, 2080) }
        }
        pendingConfigPath = null
    }

    private var pendingConfigPath: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            GhostVpnApp(
                onConnect = ::requestConnect,
                onDisconnect = { GhostVpnService.stop(this) }
            )
        }
    }

    /** Вызывается из UI после подготовки конфигурации. */
    fun requestConnect(configPath: String) {
        pendingConfigPath = configPath
        val intent = VpnService.prepare(this)
        if (intent != null) {
            vpnPermission.launch(intent)
        } else {
            GhostVpnService.start(this, configPath, 2080)
            pendingConfigPath = null
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GhostVpnApp(onConnect: (String) -> Unit, onDisconnect: () -> Unit) {
    val context = LocalContext.current
    var subscription by remember { mutableStateOf("") }
    var profiles by remember { mutableStateOf<List<VpnProfile>>(emptyList()) }
    var selected by remember { mutableStateOf<VpnProfile?>(null) }
    var connected by remember { mutableStateOf(false) }
    var log by remember { mutableStateOf<List<String>>(emptyList()) }
    var status by remember { mutableStateOf("Не подключено") }
    val scope = rememberCoroutineScope()

    fun append(line: String) {
        log = (listOf("${java.text.SimpleDateFormat("HH:mm:ss").format(java.util.Date())}  $line") + log).take(200)
    }

    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Brand,
            secondary = Accent,
            background = Color(0xFF06070F),
            surface = Surface
        )
    ) {
        Scaffold(containerColor = Color(0xFF06070F)) { padding ->
            Column(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(Color(0xFF0B0920), Color(0xFF06070F), Color(0xFF04121A))
                        )
                    )
                    .padding(16.dp)
            ) {
                // Шапка
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(46.dp)
                            .background(Brush.linearGradient(listOf(Brand, Accent)), RoundedCornerShape(14.dp)),
                        contentAlignment = Alignment.Center
                    ) { Text("👻", fontSize = 22.sp) }
                    Column(Modifier.padding(start = 12.dp)) {
                        Text("GhostVPN", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color.White)
                        Text(status, fontSize = 12.sp, color = Color(0xFF9AA0C3))
                    }
                    Spacer(Modifier.weight(1f))
                    Box(
                        modifier = Modifier
                            .size(9.dp)
                            .background(if (connected) Color(0xFF34D399) else Color(0xFFFB7185), RoundedCornerShape(50))
                    )
                }

                Spacer(Modifier.height(16.dp))

                // Подписка
                Card(colors = CardDefaults.cardColors(containerColor = Surface.copy(alpha = 0.7f))) {
                    Column(Modifier.padding(16.dp)) {
                        Text("Подписка", fontWeight = FontWeight.SemiBold, color = Color.White)
                        Text(
                            "Ссылка из личного кабинета или ключ vless://",
                            fontSize = 12.sp, color = Color(0xFF9AA0C3)
                        )
                        Spacer(Modifier.height(10.dp))
                        OutlinedTextField(
                            value = subscription,
                            onValueChange = { subscription = it },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            placeholder = { Text("https://vpn.example.com/sub/...", color = Color(0xFF5B6188)) },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = Brand,
                                unfocusedBorderColor = Border,
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White
                            )
                        )
                        Spacer(Modifier.height(10.dp))
                        Button(
                            onClick = {
                                scope.launch {
                                    val text = subscription.trim()
                                    if (text.isEmpty()) { append("Укажите ссылку"); return@launch }
                                    val parsed = withContext(Dispatchers.IO) {
                                        if (text.startsWith("http")) {
                                            val request = java.net.URL(text).openRequest() as java.net.HttpURLConnection
                                            request.setRequestProperty("User-Agent", "GhostVPN/1.0 (Android)")
                                            request.connect()
                                            val body = request.inputStream.bufferedReader().use { it.readText() }
                                            SubscriptionParser.parse(body)
                                        } else {
                                            SubscriptionParser.parse(text)
                                        }
                                    }
                                    profiles = parsed
                                    selected = parsed.firstOrNull()
                                    append(if (parsed.isEmpty()) "Серверы не найдены" else "Серверов: ${parsed.size}")
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Brand)
                        ) { Text("Загрузить") }
                    }
                }

                Spacer(Modifier.height(14.dp))

                // Серверы
                Card(colors = CardDefaults.cardColors(containerColor = Surface.copy(alpha = 0.7f))) {
                    Column(Modifier.padding(16.dp)) {
                        Text("Серверы", fontWeight = FontWeight.SemiBold, color = Color.White)
                        Spacer(Modifier.height(8.dp))
                        if (profiles.isEmpty()) {
                            Text("Подписка не загружена", fontSize = 12.sp, color = Color(0xFF9AA0C3))
                        } else {
                            LazyColumn(Modifier.heightIn(max = 220.dp)) {
                                items(profiles) { profile ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable { selected = profile }
                                            .padding(vertical = 8.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Column(Modifier.weight(1f)) {
                                            Text(profile.name, fontSize = 14.sp, color = Color.White)
                                            Text(
                                                "${profile.endpoint} · ${profile.security}",
                                                fontSize = 11.sp,
                                                fontFamily = FontFamily.Monospace,
                                                color = Color(0xFF9AA0C3)
                                            )
                                        }
                                        if (selected?.id == profile.id) {
                                            Text("✓", color = Color(0xFF34D399), fontSize = 16.sp)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(Modifier.height(14.dp))

                // Подключение
                Button(
                    onClick = {
                        val profile = selected
                        if (connected) {
                            onDisconnect()
                            connected = false
                            status = "Не подключено"
                            append("Отключено")
                        } else if (profile == null) {
                            append("Сначала выберите сервер")
                        } else {
                            scope.launch {
                                val config = SingBoxConfig.build(profile, mixedPort = 2080)
                                val dir = File(context.filesDir, "core").apply { mkdirs() }
                                val configFile = File(dir, "config.json")
                                configFile.writeText(config)
                                append("Подключение к ${profile.name} (${profile.endpoint})")
                                onConnect(configFile.absolutePath)
                                connected = true
                                status = "Подключено"
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (connected) Color(0xFFFB7185) else Brand
                    )
                ) { Text(if (connected) "Отключиться" else "Подключиться", fontSize = 15.sp) }

                Spacer(Modifier.height(14.dp))

                // Журнал
                Card(colors = CardDefaults.cardColors(containerColor = Surface.copy(alpha = 0.7f))) {
                    Column(Modifier.padding(16.dp)) {
                        Text("Журнал", fontWeight = FontWeight.SemiBold, color = Color.White)
                        Spacer(Modifier.height(8.dp))
                        LazyColumn(Modifier.heightIn(max = 200.dp)) {
                            items(log) { line ->
                                Text(
                                    line,
                                    fontSize = 11.sp,
                                    fontFamily = FontFamily.Monospace,
                                    color = Color(0xFF9AA0C3)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
