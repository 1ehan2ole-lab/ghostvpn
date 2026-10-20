namespace GhostVPN.Core;

/// <summary>Один VPN-сервер (профиль) из подписки.</summary>
public sealed class VpnProfile
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "GhostVPN";
    public string Type { get; set; } = "vless";
    public string Address { get; set; } = string.Empty;
    public int Port { get; set; } = 443;
    public string Uuid { get; set; } = string.Empty;
    public string Flow { get; set; } = "xtls-rprx-vision";
    public string Security { get; set; } = "reality";
    public string Sni { get; set; } = string.Empty;
    public string PublicKey { get; set; } = string.Empty;
    public string ShortId { get; set; } = string.Empty;
    public string Fingerprint { get; set; } = "chrome";
    public string Network { get; set; } = "tcp";
    public string? RawLink { get; set; }

    public bool IsReality => Security.Equals("reality", StringComparison.OrdinalIgnoreCase);

    public string Endpoint => $"{Address}:{Port}";

    public override string ToString() => $"{Name} ({Endpoint})";
}
