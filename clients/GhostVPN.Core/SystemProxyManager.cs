using System.Diagnostics;
using System.Runtime.InteropServices;
#if WINDOWS
using Microsoft.Win32;
#endif

namespace GhostVPN.Core;

/// <summary>Управление системным прокси (SOCKS/HTTP) на десктопных платформах.</summary>
public static class SystemProxyManager
{
    public static bool IsSupported => RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
        || RuntimeInformation.IsOSPlatform(OSPlatform.OSX)
        || RuntimeInformation.IsOSPlatform(OSPlatform.Linux);

    /// <summary>Включить системный прокси на 127.0.0.1:порт.</summary>
    public static void Enable(int port)
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
#if WINDOWS
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings", true)!;
            key.SetValue("ProxyServer", $"socks=127.0.0.1:{port};http=127.0.0.1:{port}");
            key.SetValue("ProxyEnable", 1);
            key.SetValue("ProxyOverride", "<local>");
            NotifySettingsChanged();
#endif
            return;
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            foreach (var service in NetworkServices())
            {
                Run("networksetup", $"-setwebproxy \"{service}\" 127.0.0.1 {port}");
                Run("networksetup", $"-setsecurewebproxy \"{service}\" 127.0.0.1 {port}");
                Run("networksetup", $"-setsocksfirewallproxy \"{service}\" 127.0.0.1 {port}");
                Run("networksetup", $"-setproxybypassdomains \"{service}\" \"*.local\" \"169.254/16\"");
            }
            return;
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            Run("gsettings", "set org.gnome.system.proxy mode 'manual'");
            Run("gsettings", "set org.gnome.system.proxy.http host '127.0.0.1'");
            Run("gsettings", $"set org.gnome.system.proxy.http port '{port}'");
            Run("gsettings", "set org.gnome.system.proxy.socks host '127.0.0.1'");
            Run("gsettings", $"set org.gnome.system.proxy.socks port '{port}'");
        }
    }

    /// <summary>Выключить системный прокси.</summary>
    public static void Disable()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
#if WINDOWS
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings", true)!;
            key.SetValue("ProxyEnable", 0);
            NotifySettingsChanged();
#endif
            return;
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            foreach (var service in NetworkServices())
            {
                Run("networksetup", $"-setwebproxystate \"{service}\" off");
                Run("networksetup", $"-setsecurewebproxystate \"{service}\" off");
                Run("networksetup", $"-setsocksfirewallproxystate \"{service}\" off");
            }
            return;
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            Run("gsettings", "set org.gnome.system.proxy mode 'none'");
        }
    }

    private static IEnumerable<string> NetworkServices()
    {
        var output = Run("networksetup", "-listallnetworkservices");
        foreach (var line in output.Split('\n'))
        {
            var name = line.Trim();
            if (name.Length == 0 || name.StartsWith('*')) continue;
            yield return name;
        }
    }

#if WINDOWS
    [DllImport("wininet.dll", SetLastError = true)]
    private static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);

    private static void NotifySettingsChanged()
    {
        const int settingsChanged = 39;
        const int settingsRefresh = 37;
        InternetSetOption(IntPtr.Zero, settingsChanged, IntPtr.Zero, 0);
        InternetSetOption(IntPtr.Zero, settingsRefresh, IntPtr.Zero, 0);
    }
#endif

    private static string Run(string file, string args)
    {
        try
        {
            var psi = new ProcessStartInfo(file, args)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            using var p = Process.Start(psi)!;
            var output = p.StandardOutput.ReadToEnd();
            p.WaitForExit();
            return output;
        }
        catch
        {
            return string.Empty;
        }
    }
}
