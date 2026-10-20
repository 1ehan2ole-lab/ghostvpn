package app.ghostvpn.client

import android.util.Base64
import org.json.JSONObject
import java.net.URI

/** Профиль VPN-сервера из подписки. */
data class VpnProfile(
    val id: String = System.nanoTime().toString(),
    val name: String = "GhostVPN",
    val address: String = "",
    val port: Int = 443,
    val uuid: String = "",
    val flow: String = "xtls-rprx-vision",
    val security: String = "reality",
    val sni: String = "",
    val publicKey: String = "",
    val shortId: String = "",
    val fingerprint: String = "chrome",
    val network: String = "tcp",
    val rawLink: String? = null
) {
    val endpoint: String get() = "$address:$port"
    val isReality: Boolean get() = security.equals("reality", ignoreCase = true)
}

/**
 * Разбор подписок: v2ray (base64), vless://, Clash YAML и sing-box JSON.
 */
object SubscriptionParser {

    fun parse(input: String): List<VpnProfile> {
        val text = input.trim()
        if (text.isEmpty()) return emptyList()

        if (text.startsWith("vless://", true) || text.startsWith("vmess://", true) ||
            text.startsWith("trojan://", true)
        ) {
            return listOfNotNull(parseLink(text))
        }
        if (text.startsWith("{")) return parseSingBox(text)
        if (text.contains("proxies:")) return parseClash(text)
        return parseV2Ray(text)
    }

    /** Подписка v2ray: base64 со списком ссылок. */
    fun parseV2Ray(base64: String): List<VpnProfile> {
        var text = base64.trim()
        val decoded = runCatching {
            String(Base64.decode(normalizeBase64(text), Base64.DEFAULT))
        }.getOrNull()
        if (decoded != null && decoded.contains("://")) text = decoded

        return text.split("\n")
            .map { it.trim() }
            .filter { it.startsWith("vless://", true) }
            .mapNotNull { parseLink(it) }
    }

    /** Одна ссылка vless://. */
    fun parseLink(link: String): VpnProfile? {
        return try {
            val uri = URI(link)
            val query = parseQuery(uri.query)
            val fragment = uri.fragment?.let { java.net.URLDecoder.decode(it, "UTF-8") } ?: ""
            VpnProfile(
                name = fragment.ifEmpty { uri.host ?: "GhostVPN" },
                address = uri.host ?: "",
                port = if (uri.port > 0) uri.port else 443,
                uuid = uri.userInfo ?: "",
                security = query["security"] ?: "reality",
                sni = query["sni"] ?: query["host"] ?: "",
                publicKey = query["pbk"] ?: "",
                shortId = query["sid"] ?: "",
                fingerprint = query["fp"] ?: "chrome",
                network = query["type"] ?: "tcp",
                flow = query["flow"] ?: "",
                rawLink = link
            )
        } catch (e: Exception) {
            null
        }
    }

    /** Конфигурация sing-box: забираем outbound типа vless. */
    fun parseSingBox(json: String): List<VpnProfile> {
        return try {
            val root = JSONObject(json)
            val outbounds = root.optJSONArray("outbounds") ?: return emptyList()
            val result = mutableListOf<VpnProfile>()
            for (i in 0 until outbounds.length()) {
                val outbound = outbounds.optJSONObject(i) ?: continue
                if (outbound.optString("type") != "vless") continue
                val tls = outbound.optJSONObject("tls")
                val reality = tls?.optJSONObject("reality")
                val utls = tls?.optJSONObject("utls")
                result += VpnProfile(
                    name = outbound.optString("tag", "GhostVPN"),
                    address = outbound.optString("server"),
                    port = outbound.optInt("server_port", 443),
                    uuid = outbound.optString("uuid"),
                    flow = outbound.optString("flow"),
                    security = if (reality != null) "reality" else "none",
                    sni = tls?.optString("server_name") ?: "",
                    publicKey = reality?.optString("public_key") ?: "",
                    shortId = reality?.optString("short_id") ?: "",
                    fingerprint = utls?.optString("fingerprint") ?: "chrome"
                )
            }
            result
        } catch (e: Exception) {
            emptyList()
        }
    }

    /** Clash / Mihomo: минимальный разбор секции proxies. */
    fun parseClash(yaml: String): List<VpnProfile> {
        val result = mutableListOf<VpnProfile>()
        var current = mutableMapOf<String, String>()
        var inProxies = false

        fun flush() {
            val map = current
            current = mutableMapOf()
            if (!map["type"].equals("vless", ignoreCase = true)) return
            var publicKey = ""
            var shortId = ""
            map["reality-opts"]?.split("|")?.forEach { pair ->
                val kv = pair.split("=", limit = 2)
                if (kv.size == 2) {
                    if (kv[0] == "public-key") publicKey = kv[1]
                    if (kv[0] == "short-id") shortId = kv[1]
                }
            }
            result += VpnProfile(
                name = map["name"] ?: "GhostVPN",
                address = map["server"] ?: "",
                port = map["port"]?.toIntOrNull() ?: 443,
                uuid = map["uuid"] ?: "",
                sni = map["servername"] ?: "",
                fingerprint = map["client-fingerprint"] ?: "chrome",
                flow = map["flow"] ?: "",
                security = "reality",
                publicKey = publicKey,
                shortId = shortId
            )
        }

        yaml.lines().forEach { raw ->
            val line = raw.trim()
            if (line.isEmpty()) return@forEach
            if (!raw.startsWith(" ") && !raw.startsWith("-")) {
                flush()
                inProxies = line.startsWith("proxies:")
                return@forEach
            }
            if (!inProxies) return@forEach
            var value = if (line.startsWith("- ")) line.substring(2) else line
            val idx = value.indexOf(':')
            if (idx <= 0) return@forEach
            val key = value.substring(0, idx).trim()
            var v = value.substring(idx + 1).trim()
            if (v.startsWith("{") && v.endsWith("}")) {
                val inner = v.substring(1, v.length - 1)
                val map = mutableMapOf<String, String>()
                inner.split(",").forEach { part ->
                    val kv = part.split("=", limit = 2)
                    if (kv.size == 2) map[kv[0].trim()] = kv[1].trim()
                }
                v = map.entries.joinToString("|") { "${it.key}=${it.value}" }
            } else {
                v = v.trim('"', '\'')
            }
            current[key] = v
        }
        flush()
        return result
    }

    private fun parseQuery(query: String?): Map<String, String> {
        val result = mutableMapOf<String, String>()
        query?.split("&")?.forEach { part ->
            val kv = part.split("=", limit = 2)
            if (kv.size == 2) {
                result[java.net.URLDecoder.decode(kv[0], "UTF-8")] =
                    java.net.URLDecoder.decode(kv[1], "UTF-8")
            }
        }
        return result
    }

    private fun normalizeBase64(value: String): String {
        var normalized = value.replace("-", "+").replace("_", "/")
            .replace("\n", "").replace("\r", "").replace(" ", "")
        while (normalized.length % 4 != 0) normalized += "="
        return normalized
    }
}

/** Сборка конфигурации sing-box из профиля. */
object SingBoxConfig {

    fun build(
        profile: VpnProfile,
        mixedPort: Int = 2080,
        enableTun: Boolean = false,
        logLevel: String = "info"
    ): String {
        val outbound = JSONObject().apply {
            put("type", "vless")
            put("tag", "proxy")
            put("server", profile.address)
            put("server_port", profile.port)
            put("uuid", profile.uuid)
            if (profile.flow.isNotEmpty()) put("flow", profile.flow)

            val tls = JSONObject().apply {
                put("enabled", true)
                put("server_name", profile.sni)
                put("utls", JSONObject().apply {
                    put("enabled", true)
                    put("fingerprint", profile.fingerprint)
                })
                if (profile.isReality) {
                    put("reality", JSONObject().apply {
                        put("enabled", true)
                        put("public_key", profile.publicKey)
                        put("short_id", profile.shortId)
                    })
                }
            }
            put("tls", tls)
        }

        val inbounds = mutableListOf(JSONObject().apply {
            put("type", "mixed")
            put("tag", "mixed-in")
            put("listen", "127.0.0.1")
            put("listen_port", mixedPort)
        })

        if (enableTun) {
            inbounds += JSONObject().apply {
                put("type", "tun")
                put("tag", "tun-in")
                put("interface_name", "ghostvpn0")
                put("address", org.json.JSONArray().apply {
                    put("172.19.0.1/30")
                    put("fdfe:cafe::1/126")
                })
                put("mtu", 9000)
                put("auto_route", true)
                put("strict_route", true)
                put("stack", "system")
            }
        }

        val config = JSONObject().apply {
            put("log", JSONObject().apply {
                put("level", logLevel)
                put("timestamp", true)
            })
            put("dns", JSONObject().apply {
                put("servers", org.json.JSONArray().apply {
                    put(JSONObject().apply {
                        put("tag", "dns-remote"); put("type", "udp"); put("server", "1.1.1.1")
                    })
                    put(JSONObject().apply {
                        put("tag", "dns-local"); put("type", "udp"); put("server", "8.8.8.8")
                    })
                })
                put("final", "dns-remote")
                put("strategy", "prefer_ipv4")
            })
            put("inbounds", org.json.JSONArray().apply { inbounds.forEach { put(it) } })
            put("outbounds", org.json.JSONArray().apply {
                put(outbound)
                put(JSONObject().apply { put("type", "direct"); put("tag", "direct") })
                put(JSONObject().apply { put("type", "block"); put("tag", "block") })
            })
            put("route", JSONObject().apply {
                put("rules", org.json.JSONArray().apply {
                    put(JSONObject().apply { put("action", "sniff") })
                    put(JSONObject().apply { put("protocol", "dns"); put("action", "hijack-dns") })
                })
                put("final", "proxy")
                put("auto_detect_interface", true)
                put("default_domain_resolver", "dns-local")
            })
            put("experimental", JSONObject().apply {
                put("clash_api", JSONObject().apply {
                    put("external_controller", "127.0.0.1:9090")
                })
            })
        }
        return config.toString(2)
    }
}
