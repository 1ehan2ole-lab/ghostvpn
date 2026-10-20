using System.Net;
using System.Text;

namespace GhostVPN.Core;

/// <summary>Загрузка подписки и разбор профилей.</summary>
public static class SubscriptionClient
{
    public static async Task<List<VpnProfile>> FetchAsync(string url, string userAgent, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            throw new ArgumentException("Укажите ссылку на подписку или ключ vless://");
        }

        var trimmed = url.Trim();

        if (!trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            // это может быть готовая ссылка vless:// или другой адрес
            var linkProfiles = SubscriptionParser.Parse(trimmed);
            if (linkProfiles.Count == 0)
            {
                throw new ArgumentException("Не удалось распознать ссылку. Нужен адрес подписки (http/https) или ключ vless://");
            }
            return linkProfiles;
        }

        using var handler = new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
            AllowAutoRedirect = true,
        };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
        client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", userAgent);

        var response = await client.GetAsync(url, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Сервер подписки вернул {(int)response.StatusCode}");
        }

        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        var profiles = SubscriptionParser.Parse(body);
        if (profiles.Count == 0)
        {
            throw new InvalidOperationException("В подписке не найдено ни одного сервера");
        }
        return profiles;
    }

    /// <summary>Получить заголовки подписки (истечение, трафик) - для панели.</summary>
    public static async Task<SubscriptionInfo> FetchInfoAsync(string url, string userAgent, CancellationToken cancellationToken = default)
    {
        using var handler = new HttpClientHandler { AutomaticDecompression = DecompressionMethods.All };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
        client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", userAgent);

        var response = await client.GetAsync(url, cancellationToken);
        var info = new SubscriptionInfo();

        if (response.Headers.TryGetValues("Subscription-Userinfo", out var userInfo))
        {
            var raw = userInfo.FirstOrDefault() ?? string.Empty;
            foreach (var part in raw.Split(';', StringSplitOptions.RemoveEmptyEntries))
            {
                var kv = part.Split('=', 2);
                if (kv.Length != 2) continue;
                var key = kv[0].Trim();
                var value = kv[1].Trim();
                if (key == "expire" && long.TryParse(value, out var expire))
                {
                    info.Expire = DateTimeOffset.FromUnixTimeSeconds(expire).UtcDateTime;
                }
                if (key == "total" && long.TryParse(value, out var total)) info.TotalBytes = total;
                if (key == "download" && long.TryParse(value, out var download)) info.DownloadBytes = download;
                if (key == "upload" && long.TryParse(value, out var upload)) info.UploadBytes = upload;
            }
        }

        if (response.Headers.TryGetValues("Profile-Title", out var titles))
        {
            var raw = titles.FirstOrDefault() ?? string.Empty;
            if (raw.StartsWith("base64:", StringComparison.OrdinalIgnoreCase))
            {
                raw = raw[7..];
                try
                {
                    info.Title = Encoding.UTF8.GetString(Convert.FromBase64String(raw));
                }
                catch
                {
                    // игнорируем
                }
            }
        }

        return info;
    }
}

public sealed class SubscriptionInfo
{
    public string Title { get; set; } = string.Empty;
    public DateTime? Expire { get; set; }
    public long TotalBytes { get; set; }
    public long DownloadBytes { get; set; }
    public long UploadBytes { get; set; }
}
