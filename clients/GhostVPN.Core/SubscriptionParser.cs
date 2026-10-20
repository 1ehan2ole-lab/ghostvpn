using System.Text;
using System.Text.Json;

namespace GhostVPN.Core;

/// <summary>
/// Разбор подписок и одиночных ссылок:
/// v2ray (base64), vless://, Clash/Mihomo YAML, sing-box JSON.
/// </summary>
public static class SubscriptionParser
{
    /// <summary>Определяет формат входа и возвращает список серверов.</summary>
    public static List<VpnProfile> Parse(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return new();

        var text = input.Trim();

        if (text.StartsWith("vless://", StringComparison.OrdinalIgnoreCase) ||
            text.StartsWith("vmess://", StringComparison.OrdinalIgnoreCase) ||
            text.StartsWith("trojan://", StringComparison.OrdinalIgnoreCase) ||
            text.StartsWith("ss://", StringComparison.OrdinalIgnoreCase))
        {
            return new List<VpnProfile> { ParseLink(text) };
        }

        if (text.StartsWith("{"))
        {
            return ParseSingBox(text);
        }

        if (text.Contains("proxies:") || text.Contains("proxy-groups:"))
        {
            return ParseClash(text);
        }

        // v2ray base64 (возможно, много строк)
        return ParseV2Ray(text);
    }

    /* ------------------------------------------------------------------ */
    /* v2ray base64                                                       */
    /* ------------------------------------------------------------------ */

    public static List<VpnProfile> ParseV2Ray(string base64)
    {
        var result = new List<VpnProfile>();
        var decoded = TryDecodeBase64(base64);
        if (decoded is null)
        {
            // возможно, это не base64, а обычный текст со ссылками
            decoded = base64;
        }

        foreach (var line in decoded.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var value = line.Trim();
            if (!value.StartsWith("vless://", StringComparison.OrdinalIgnoreCase)) continue;
            try
            {
                result.Add(ParseLink(value));
            }
            catch
            {
                // пропускаем битые ссылки
            }
        }
        return result;
    }

    private static string? TryDecodeBase64(string value)
    {
        var normalized = value.Replace("\r", "").Replace("\n", "").Trim();
        normalized = normalized.Replace('-', '+').Replace('_', '/');
        switch (normalized.Length % 4)
        {
            case 2: normalized += "=="; break;
            case 3: normalized += "="; break;
            case 1: return null;
        }

        try
        {
            var bytes = Convert.FromBase64String(normalized);
            var text = Encoding.UTF8.GetString(bytes);
            return text.Contains("://") ? text : null;
        }
        catch
        {
            return null;
        }
    }

    /* ------------------------------------------------------------------ */
    /* vless://                                                           */
    /* ------------------------------------------------------------------ */

    public static VpnProfile ParseLink(string link)
    {
        var uri = new Uri(link.Trim());
        var query = ParseQuery(uri.Query);
        var name = Uri.UnescapeDataString(uri.Fragment.TrimStart('#'));

        var profile = new VpnProfile
        {
            RawLink = link.Trim(),
            Name = string.IsNullOrWhiteSpace(name) ? uri.Host : name,
            Address = uri.Host,
            Port = uri.IsDefaultPort ? 443 : uri.Port,
            Uuid = Uri.UnescapeDataString(uri.UserInfo),
            Security = query.GetValueOrDefault("security", "none"),
            Sni = query.GetValueOrDefault("sni", query.GetValueOrDefault("host", string.Empty)),
            PublicKey = query.GetValueOrDefault("pbk", string.Empty),
            ShortId = query.GetValueOrDefault("sid", string.Empty),
            Fingerprint = query.GetValueOrDefault("fp", "chrome"),
            Network = query.GetValueOrDefault("type", "tcp"),
            Flow = query.GetValueOrDefault("flow", string.Empty),
        };

        if (string.IsNullOrEmpty(profile.Flow)) profile.Flow = string.Empty;
        return profile;
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(query)) return result;
        foreach (var part in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var idx = part.IndexOf('=');
            if (idx <= 0) continue;
            var key = Uri.UnescapeDataString(part[..idx]);
            var value = Uri.UnescapeDataString(part[(idx + 1)..]);
            result[key] = value;
        }
        return result;
    }

    /* ------------------------------------------------------------------ */
    /* Clash / Mihomo                                                     */
    /* ------------------------------------------------------------------ */

    public static List<VpnProfile> ParseClash(string yaml)
    {
        var result = new List<VpnProfile>();
        var lines = yaml.Split('\n');
        var inProxies = false;
        var current = new Dictionary<string, string>();
        var order = new List<string>();

        void Flush()
        {
            if (current.Count == 0) return;
            if (current.TryGetValue("type", out var type) && type.Equals("vless", StringComparison.OrdinalIgnoreCase))
            {
                var reality = new Dictionary<string, string>();
                if (current.TryGetValue("reality-opts", out var opts))
                {
                    foreach (var part in opts.Split('|', StringSplitOptions.RemoveEmptyEntries))
                    {
                        var idx = part.IndexOf('=');
                        if (idx <= 0) continue;
                        reality[part[..idx]] = part[(idx + 1)..];
                    }
                }
                var profile = new VpnProfile
                {
                    Name = current.GetValueOrDefault("name", "GhostVPN"),
                    Address = current.GetValueOrDefault("server", string.Empty),
                    Port = int.TryParse(current.GetValueOrDefault("port", "443"), out var p) ? p : 443,
                    Uuid = current.GetValueOrDefault("uuid", string.Empty),
                    Sni = current.GetValueOrDefault("servername", string.Empty),
                    PublicKey = reality.GetValueOrDefault("public-key", string.Empty),
                    ShortId = reality.GetValueOrDefault("short-id", string.Empty),
                    Fingerprint = current.GetValueOrDefault("client-fingerprint", "chrome"),
                    Flow = current.GetValueOrDefault("flow", string.Empty),
                    Network = current.GetValueOrDefault("network", "tcp"),
                    Security = "reality",
                };
                result.Add(profile);
            }
            current.Clear();
            order.Clear();
        }

        foreach (var raw in lines)
        {
            var line = raw.TrimEnd();
            var trimmed = line.Trim();
            if (trimmed.Length == 0) continue;

            if (!line.StartsWith(" ", StringComparison.Ordinal) && !line.StartsWith("-", StringComparison.Ordinal))
            {
                Flush();
                inProxies = trimmed.StartsWith("proxies:", StringComparison.OrdinalIgnoreCase);
                continue;
            }

            if (!inProxies) continue;

            if (trimmed.StartsWith("- ", StringComparison.Ordinal))
            {
                Flush();
                var inline = trimmed[2..].Trim();
                var (key, value) = SplitYamlPair(inline);
                if (key is not null) current[key] = value ?? string.Empty;
                continue;
            }

            var (k, v) = SplitYamlPair(trimmed);
            if (k is not null) current[k] = v ?? string.Empty;
        }
        Flush();
        return result;
    }

    private static (string? Key, string? Value) SplitYamlPair(string line)
    {
        var idx = line.IndexOf(':');
        if (idx <= 0) return (null, null);
        var key = line[..idx].Trim();
        var value = line[(idx + 1)..].Trim();
        if (value.StartsWith('{') && value.EndsWith('}'))
        {
            // inline map: public-key: xxx, short-id: yyy
            var map = new Dictionary<string, string>();
            foreach (var part in value.Trim('{', '}').Split(','))
            {
                var (pk, pv) = SplitYamlPair(part.Trim());
                if (pk is not null) map[pk] = pv ?? string.Empty;
            }
            return (key, string.Join("|", map.Select(kv => $"{kv.Key}={kv.Value}")));
        }
        return (key, value.Trim('"', '\''));
    }

    /* ------------------------------------------------------------------ */
    /* sing-box JSON                                                       */
    /* ------------------------------------------------------------------ */

    public static List<VpnProfile> ParseSingBox(string json)
    {
        var result = new List<VpnProfile>();
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("outbounds", out var outbounds)) return result;

        foreach (var outbound in outbounds.EnumerateArray())
        {
            if (!outbound.TryGetProperty("type", out var type) || type.GetString() != "vless") continue;

            var tls = outbound.TryGetProperty("tls", out var tlsEl) ? tlsEl : default;
            var reality = tls.ValueKind == JsonValueKind.Object && tls.TryGetProperty("reality", out var r) ? r : default;

            var profile = new VpnProfile
            {
                Name = outbound.TryGetProperty("tag", out var tag) ? tag.GetString() ?? "GhostVPN" : "GhostVPN",
                Address = outbound.TryGetProperty("server", out var s) ? s.GetString() ?? string.Empty : string.Empty,
                Port = outbound.TryGetProperty("server_port", out var sp) ? sp.GetInt32() : 443,
                Uuid = outbound.TryGetProperty("uuid", out var u) ? u.GetString() ?? string.Empty : string.Empty,
                Flow = outbound.TryGetProperty("flow", out var f) ? f.GetString() ?? string.Empty : string.Empty,
                Security = reality.ValueKind == JsonValueKind.Object ? "reality" : "none",
                Sni = tls.ValueKind == JsonValueKind.Object && tls.TryGetProperty("server_name", out var sni) ? sni.GetString() ?? string.Empty : string.Empty,
                PublicKey = reality.ValueKind == JsonValueKind.Object && reality.TryGetProperty("public_key", out var pk) ? pk.GetString() ?? string.Empty : string.Empty,
                ShortId = reality.ValueKind == JsonValueKind.Object && reality.TryGetProperty("short_id", out var sid) ? sid.GetString() ?? string.Empty : string.Empty,
                Fingerprint = tls.ValueKind == JsonValueKind.Object && tls.TryGetProperty("utls", out var utls) && utls.TryGetProperty("fingerprint", out var fp)
                    ? fp.GetString() ?? "chrome" : "chrome",
            };
            result.Add(profile);
        }
        return result;
    }
}
