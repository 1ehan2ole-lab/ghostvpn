using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace GhostVPN.Core;

/// <summary>
/// Запуск и остановка ядра sing-box, скачивание ядра при первом запуске.
/// </summary>
public sealed class SingBoxRunner : IDisposable
{
    private Process? _process;

    public bool IsRunning => _process is { HasExited: false };

    public int MixedPort { get; }

    public event Action<string>? OnLog;

    public SingBoxRunner(int mixedPort = 2080)
    {
        MixedPort = mixedPort;
    }

    /// <summary>Путь к исполняемому файлу sing-box рядом с приложением.</summary>
    public static string BinaryPath
    {
        get
        {
            var name = RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "sing-box.exe" : "sing-box";
            return Path.Combine(AppContext.BaseDirectory, "core", name);
        }
    }

    /// <summary>Есть ли ядро на диске.</summary>
    public static bool IsCorePresent => File.Exists(BinaryPath);

    /// <summary>Скачать ядро sing-box для текущей платформы.</summary>
    public static async Task<bool> DownloadCoreAsync(IProgress<string>? progress = null, CancellationToken cancellationToken = default)
    {
        var target = BinaryPath;
        var dir = Path.GetDirectoryName(target)!;
        Directory.CreateDirectory(dir);

        var (archive, binaryName) = ResolveAsset();
        progress?.Report($"Скачивание sing-box ({archive})...");

        var url = $"https://github.com/SagerNet/sing-box/releases/download/v{SingBoxVersion}/{archive}";
        using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        var bytes = await client.GetByteArrayAsync(url, cancellationToken);
        var tmpArchive = Path.Combine(Path.GetTempPath(), archive);

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            System.IO.Compression.ZipFile.ExtractToDirectory(tmpArchive, dir, true);
        }
        else
        {
            // tar -xf умеет распаковывать zip на Linux/macOS (bsdtar)
            ExtractWithTar(tmpArchive, dir);
        }
        File.Delete(tmpArchive);

        var extracted = Directory.GetFiles(dir, binaryName, SearchOption.AllDirectories).FirstOrDefault();
        if (extracted is null)
        {
            progress?.Report("Не удалось найти sing-box в архиве");
            return false;
        }

        if (!string.Equals(extracted, target, StringComparison.OrdinalIgnoreCase))
        {
            File.Copy(extracted, target, true);
        }

        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            File.SetUnixFileMode(target,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute |
                UnixFileMode.GroupRead | UnixFileMode.GroupExecute |
                UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
        }
        return true;
    }

    public const string SingBoxVersion = "1.14.3";

    private static (string Archive, string Binary) ResolveAsset()
    {
        var arch = RuntimeInformation.ProcessArchitecture;
        var v = SingBoxVersion;

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return arch == Architecture.Arm64
                ? ($"sing-box-{v}-windows-arm64.zip", "sing-box.exe")
                : ($"sing-box-{v}-windows-amd64.zip", "sing-box.exe");
        }
        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            return arch == Architecture.Arm64
                ? ($"sing-box-{v}-darwin-arm64.tar.gz", "sing-box")
                : ($"sing-box-{v}-darwin-amd64.tar.gz", "sing-box");
        }
        return arch == Architecture.Arm64
            ? ($"sing-box-{v}-linux-arm64.tar.gz", "sing-box")
            : ($"sing-box-{v}-linux-amd64.tar.gz", "sing-box");
    }

    private static void ExtractWithTar(string archive, string targetDir)
    {
        var psi = new ProcessStartInfo("tar", $"-xf \"{archive}\" -C \"{targetDir}\"")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        using var p = Process.Start(psi)!;
        p.WaitForExit();
        if (p.ExitCode != 0)
        {
            throw new InvalidOperationException("Не удалось распаковать архив sing-box");
        }
    }

    /// <summary>Запустить ядро с указанной конфигурацией.</summary>
    public Task StartAsync(string configJson, bool enableTun = false, CancellationToken cancellationToken = default)
    {
        Stop();

        if (!IsCorePresent)
        {
            throw new FileNotFoundException("Ядро sing-box не найдено", BinaryPath);
        }

        var configPath = Path.Combine(AppContext.BaseDirectory, "core", "config.json");
        Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);
        // без BOM: sing-box не принимает JSON с меткой порядка байтов
        File.WriteAllText(configPath, configJson, new UTF8Encoding(false));

        var psi = new ProcessStartInfo
        {
            FileName = BinaryPath,
            Arguments = $"run --config \"{configPath}\"",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = Path.GetDirectoryName(configPath)!,
        };

        _process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _process.OutputDataReceived += (_, e) => { if (e.Data is not null) OnLog?.Invoke(e.Data); };
        _process.ErrorDataReceived += (_, e) => { if (e.Data is not null) OnLog?.Invoke(e.Data); };
        _process.Start();
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();
        return Task.CompletedTask;
    }

    public void Stop()
    {
        if (_process is null) return;
        try
        {
            if (!_process.HasExited) _process.Kill(entireProcessTree: true);
        }
        catch
        {
            // процесс уже завершён
        }
        finally
        {
            _process.Dispose();
            _process = null;
        }
    }

    /// <summary>Проверить конфигурацию ядром sing-box (check).</summary>
    public static bool CheckConfig(string configPath)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = BinaryPath,
                Arguments = $"check --config \"{configPath}\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            using var p = Process.Start(psi)!;
            var output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
            p.WaitForExit();
            if (p.ExitCode != 0)
            {
                Console.WriteLine(output);
            }
            return p.ExitCode == 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine("Ошибка проверки: " + ex.Message);
            return false;
        }
    }

    public void Dispose() => Stop();
}
