using System.Text.Json;

namespace GhostVPN.Core;

/// <summary>Настройки клиента (хранятся в JSON рядом с приложением или в AppData).</summary>
public sealed class ClientSettings
{
    public string SubscriptionUrl { get; set; } = string.Empty;
    public string SelectedProfileId { get; set; } = string.Empty;
    public bool AutoConnect { get; set; }
    public bool SetSystemProxy { get; set; } = true;
    public bool UseTun { get; set; }
    public int MixedPort { get; set; } = 2080;
    public string UserAgent { get; set; } = "GhostVPN/1.0 (v2rayNG-like)";

    private static string FilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "GhostVPN",
        "settings.json");

    public static ClientSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                return JsonSerializer.Deserialize<ClientSettings>(File.ReadAllText(FilePath)) ?? new ClientSettings();
            }
        }
        catch
        {
            // повреждённый файл - начинаем с настроек по умолчанию
        }
        return new ClientSettings();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch
        {
            // не критично
        }
    }
}
