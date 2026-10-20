using GhostVPN.Core;

// Консольный клиент GhostVPN.
//   ghostvpn --url <подписка> [--out config.json] [--check]
//   ghostvpn --key <vless://...> [--out config.json] [--check]
//   ghostvpn --list <подписка>

var options = ParseArgs(args);

if (options.ContainsKey("help") || args.Length == 0)
{
    Console.WriteLine("""
        GhostVPN CLI 1.0

        Использование:
          ghostvpn --url <ссылка на подписку> [--out <файл>] [--check]
          ghostvpn --key <vless://...>            [--out <файл>] [--check]
          ghostvpn --list <ссылка на подписку>

        Опции:
          --out <файл>   сохранить конфигурацию sing-box
          --check         проверить конфигурацию ядром sing-box
          --tun           включить TUN-интерфейс
          --port <порт>   локальный порт прокси (по умолчанию 2080)
        """);
    return 0;
}

string source;
if (options.TryGetValue("url", out var url)) source = url;
else if (options.TryGetValue("key", out var key)) source = key;
else if (options.TryGetValue("list", out var listUrl)) source = listUrl;
else
{
    Console.Error.WriteLine("Укажите --url, --key или --list");
    return 1;
}

var userAgent = options.GetValueOrDefault("agent", "GhostVPN-CLI/1.0");
List<VpnProfile> profiles;

try
{
    profiles = await SubscriptionClient.FetchAsync(source, userAgent);
}
catch (Exception ex)
{
    Console.Error.WriteLine("Ошибка: " + ex.Message);
    return 1;
}

if (profiles.Count == 0)
{
    Console.Error.WriteLine("Серверы не найдены");
    return 1;
}

if (options.ContainsKey("list"))
{
    Console.WriteLine($"Серверов: {profiles.Count}");
    foreach (var p in profiles)
    {
        Console.WriteLine($"  {p.Name,-32} {p.Endpoint,-24} {p.Security} sni={p.Sni} flow={p.Flow}");
    }
    return 0;
}

var profile = profiles[0];
var mixedPort = options.TryGetValue("port", out var portText) && int.TryParse(portText, out var p2) ? p2 : 2080;
var config = SingBoxConfigBuilder.Build(profile, new SingBoxConfigBuilder.Options
{
    MixedPort = mixedPort,
    EnableTun = options.ContainsKey("tun"),
});

var output = options.GetValueOrDefault("out", "config.json");
File.WriteAllText(output, config);
Console.WriteLine($"Сервер: {profile.Name} ({profile.Endpoint})");
Console.WriteLine($"Конфигурация сохранена: {Path.GetFullPath(output)}");

if (options.ContainsKey("check"))
{
    if (!SingBoxRunner.IsCorePresent)
    {
        Console.Error.WriteLine("Ядро sing-box не найдено рядом с программой");
        return 1;
    }
    var ok = SingBoxRunner.CheckConfig(output);
    Console.WriteLine(ok ? "Конфигурация корректна" : "Конфигурация отклонена ядром");
    return ok ? 0 : 1;
}

return 0;

static Dictionary<string, string> ParseArgs(string[] args)
{
    var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    for (var i = 0; i < args.Length; i++)
    {
        var arg = args[i];
        if (!arg.StartsWith("--", StringComparison.Ordinal)) continue;
        var key = arg[2..];
        if (i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal))
        {
            result[key] = args[++i];
        }
        else
        {
            result[key] = "true";
        }
    }
    return result;
}
