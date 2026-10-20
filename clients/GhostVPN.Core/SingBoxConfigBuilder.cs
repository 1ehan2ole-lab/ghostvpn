using System.Text.Json;
using System.Text.Json.Nodes;

namespace GhostVPN.Core;

/// <summary>
/// Сборка конфигурации sing-box из профиля VPN-сервера.
/// Формат совместим с sing-box 1.12+.
/// </summary>
public static class SingBoxConfigBuilder
{
    public sealed record Options
    {
        /// <summary>Локальный порт смешанного прокси (SOCKS5 + HTTP).</summary>
        public int MixedPort { get; init; } = 2080;

        /// <summary>Включить TUN-интерфейс (нужны права root/administrator).</summary>
        public bool EnableTun { get; init; }

        /// <summary>Имя TUN-интерфейса.</summary>
        public string TunName { get; init; } = "ghostvpn0";

        /// <summary>Уровень логирования sing-box.</summary>
        public string LogLevel { get; init; } = "info";

        /// <summary>Фиксированный адрес DNS-сервера.</summary>
        public string DnsServer { get; init; } = "1.1.1.1";

        /// <summary>Включить локальный API для статистики трафика (clash_api).</summary>
        public bool EnableClashApi { get; init; } = true;

        /// <summary>Порт локального API статистики.</summary>
        public int ClashApiPort { get; init; } = 9090;
    }

    public static string Build(VpnProfile profile, Options? options = null)
    {
        var opt = options ?? new Options();

        var inbound = new JsonObject
        {
            ["type"] = "mixed",
            ["tag"] = "mixed-in",
            ["listen"] = "127.0.0.1",
            ["listen_port"] = opt.MixedPort,
        };

        var outbounds = new JsonArray
        {
            new JsonObject
            {
                ["type"] = "vless",
                ["tag"] = "proxy",
                ["server"] = profile.Address,
                ["server_port"] = profile.Port,
                ["uuid"] = profile.Uuid,
            },
            new JsonObject { ["type"] = "direct", ["tag"] = "direct" },
            new JsonObject { ["type"] = "block", ["tag"] = "block" },
        };

        var proxy = (JsonObject)outbounds[0]!;
        if (!string.IsNullOrEmpty(profile.Flow))
        {
            proxy["flow"] = profile.Flow;
        }

        var tls = new JsonObject
        {
            ["enabled"] = true,
            ["server_name"] = profile.Sni,
            ["utls"] = new JsonObject
            {
                ["enabled"] = true,
                ["fingerprint"] = profile.Fingerprint,
            },
        };

        if (profile.IsReality)
        {
            tls["reality"] = new JsonObject
            {
                ["enabled"] = true,
                ["public_key"] = profile.PublicKey,
                ["short_id"] = profile.ShortId,
            };
        }
        proxy["tls"] = tls;

        var inbounds = new JsonArray { inbound };

        if (opt.EnableTun)
        {
            inbounds.Add(new JsonObject
            {
                ["type"] = "tun",
                ["tag"] = "tun-in",
                ["interface_name"] = opt.TunName,
                ["address"] = new JsonArray { JsonValue.Create("172.19.0.1/30"), JsonValue.Create("fdfe:cafe::1/126") },
                ["mtu"] = 9000,
                ["auto_route"] = true,
                ["strict_route"] = true,
                ["stack"] = "system",
            });
        }

        var config = new JsonObject
        {
            ["log"] = new JsonObject
            {
                ["level"] = opt.LogLevel,
                ["timestamp"] = true,
            },
            ["dns"] = new JsonObject
            {
                ["servers"] = new JsonArray
                {
                    // DNS через туннель: провайдеры часто блокируют 1.1.1.1/8.8.8.8
                    new JsonObject
                    {
                        ["tag"] = "dns-proxy",
                        ["type"] = "udp",
                        ["server"] = opt.DnsServer,
                        ["detour"] = "proxy",
                    },
                    // Прямой резолвер - нужен для адреса самой ноды
                    new JsonObject
                    {
                        ["tag"] = "dns-local",
                        ["type"] = "udp",
                        ["server"] = "8.8.8.8",
                    },
                },
                ["final"] = "dns-proxy",
                // только IPv4: AAAA-записи часто уводят трафик мимо туннеля
                ["strategy"] = "ipv4_only",
            },
            ["inbounds"] = inbounds,
            ["outbounds"] = outbounds,
            ["route"] = new JsonObject
            {
                ["rules"] = new JsonArray
                {
                    new JsonObject { ["action"] = "sniff" },
                    new JsonObject { ["protocol"] = "dns", ["action"] = "hijack-dns" },
                },
                ["final"] = "proxy",
                ["auto_detect_interface"] = true,
                ["default_domain_resolver"] = "dns-local",
            },
        };

        if (opt.EnableClashApi)
        {
            config["experimental"] = new JsonObject
            {
                ["clash_api"] = new JsonObject
                {
                    ["external_controller"] = $"127.0.0.1:{opt.ClashApiPort}",
                },
            };
        }

        return config.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    }
}
