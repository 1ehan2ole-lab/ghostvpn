using System.Net;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using GhostVPN.Core;

namespace GhostVPN.Windows;

public partial class MainWindow : Window
{
    private readonly ClientSettings _settings = ClientSettings.Load();
    private readonly SingBoxRunner _runner = new();
    private readonly List<VpnProfile> _profiles = new();
    private DispatcherTimer? _timer;
    private long _upBytes;
    private long _downBytes;
    private bool _proxyEnabledByUs;

    public MainWindow()
    {
        InitializeComponent();

        SubscriptionBox.Text = _settings.SubscriptionUrl;
        SystemProxyCheck.IsChecked = _settings.SetSystemProxy;
        TunCheck.IsChecked = _settings.UseTun;
        AutoConnectCheck.IsChecked = _settings.AutoConnect;

        _runner.OnLog += line => Dispatcher.Invoke(() => AppendLog(line));

        Loaded += async (_, _) => await OnLoadedAsync();
        Closing += (_, _) => Shutdown();
    }

    /* ------------------------------------------------------------------ */
    /* Запуск                                                             */
    /* ------------------------------------------------------------------ */

    private async Task OnLoadedAsync()
    {
        AppendLog("GhostVPN Client запущен");

        if (!SingBoxRunner.IsCorePresent)
        {
            CoreHint.Text = "Ядро sing-box ещё не скачано.";
            DownloadCoreButton.Visibility = Visibility.Visible;
        }
        else
        {
            CoreHint.Text = $"Ядро: {SingBoxRunner.BinaryPath}";
            DownloadCoreButton.Visibility = Visibility.Collapsed;
        }

        if (!string.IsNullOrWhiteSpace(_settings.SubscriptionUrl))
        {
            await LoadSubscriptionAsync();
            if (_settings.AutoConnect && _profiles.Count > 0)
            {
                await ConnectAsync();
            }
        }
    }

    private async void DownloadCore_Click(object sender, RoutedEventArgs e)
    {
        DownloadCoreButton.IsEnabled = false;
        try
        {
            var progress = new Progress<string>(msg => Dispatcher.Invoke(() => CoreHint.Text = msg));
            var ok = await SingBoxRunner.DownloadCoreAsync(progress);
            AppendLog(ok ? "Ядро sing-box скачано" : "Не удалось скачать ядро");
            CoreHint.Text = ok ? $"Ядро: {SingBoxRunner.BinaryPath}" : "Не удалось скачать ядро";
            DownloadCoreButton.Visibility = ok ? Visibility.Collapsed : Visibility.Visible;
        }
        catch (Exception ex)
        {
            AppendLog("Ошибка загрузки ядра: " + ex.Message);
        }
        finally
        {
            DownloadCoreButton.IsEnabled = true;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Подписка                                                           */
    /* ------------------------------------------------------------------ */

    private void SubscriptionBox_OnTextChanged(object sender, TextChangedEventArgs e)
    {
        _settings.SubscriptionUrl = SubscriptionBox.Text.Trim();
    }

    private async void LoadSubscription_Click(object sender, RoutedEventArgs e)
    {
        await LoadSubscriptionAsync();
    }

    private async Task LoadSubscriptionAsync()
    {
        var url = SubscriptionBox.Text.Trim();
        if (url.Length == 0)
        {
            AppendLog("Укажите ссылку подписки");
            return;
        }

        SubscriptionInfo.Text = "Загрузка подписки...";
        try
        {
            var profiles = await SubscriptionClient.FetchAsync(url, _settings.UserAgent);
            _profiles.Clear();
            _profiles.AddRange(profiles);

            ServersList.ItemsSource = null;
            ServersList.ItemsSource = _profiles;
            if (_profiles.Count > 0)
            {
                var index = _profiles.FindIndex(p => p.Id == _settings.SelectedProfileId);
                ServersList.SelectedIndex = index >= 0 ? index : 0;
            }

            var info = await SubscriptionClient.FetchInfoAsync(url, _settings.UserAgent);
            var parts = new List<string> { $"Серверов: {profiles.Count}" };
            if (info.Expire is not null) parts.Add($"доступ до {info.Expire:yyyy-MM-dd}");
            if (info.TotalBytes > 0)
            {
                parts.Add($"трафик {FormatBytes(info.DownloadBytes + info.UploadBytes)} из {FormatBytes(info.TotalBytes)}");
            }
            SubscriptionInfo.Text = string.Join(" · ", parts);
            AppendLog($"Подписка загружена: серверов {profiles.Count}");

            _settings.SubscriptionUrl = url;
            _settings.Save();
        }
        catch (Exception ex)
        {
            SubscriptionInfo.Text = string.Empty;
            AppendLog("Ошибка загрузки подписки: " + ex.Message);
            MessageBox.Show(ex.Message, "GhostVPN", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private VpnProfile? Selected => ServersList.SelectedItem as VpnProfile;

    /* ------------------------------------------------------------------ */
    /* Подключение                                                        */
    /* ------------------------------------------------------------------ */

    private async void Connect_Click(object sender, RoutedEventArgs e)
    {
        if (_runner.IsRunning)
        {
            Disconnect();
            return;
        }
        await ConnectAsync();
    }

    private async Task ConnectAsync()
    {
        var profile = Selected;
        if (profile is null)
        {
            AppendLog("Сначала выберите сервер");
            return;
        }

        if (!SingBoxRunner.IsCorePresent)
        {
            MessageBox.Show("Не найдено ядро sing-box. Нажмите «Скачать ядро sing-box».", "GhostVPN");
            return;
        }

        _settings.SelectedProfileId = profile.Id;
        _settings.SetSystemProxy = SystemProxyCheck.IsChecked == true;
        _settings.UseTun = TunCheck.IsChecked == true;
        _settings.MixedPort = _settings.MixedPort <= 0 ? 2080 : _settings.MixedPort;
        _settings.Save();

        var config = SingBoxConfigBuilder.Build(profile, new SingBoxConfigBuilder.Options
        {
            MixedPort = _settings.MixedPort,
            EnableTun = _settings.UseTun,
        });

        try
        {
            AppendLog($"Подключение к {profile.Name} ({profile.Endpoint})...");
            await _runner.StartAsync(config, _settings.UseTun);

            // даём ядру подняться и проверяем, что оно не упало
            await Task.Delay(1200);
            if (!_runner.IsRunning)
            {
                throw new InvalidOperationException("Ядро sing-box завершилось с ошибкой, смотрите журнал");
            }

            if (_settings.SetSystemProxy && SystemProxyManager.IsSupported)
            {
                SystemProxyManager.Enable(_settings.MixedPort);
                _proxyEnabledByUs = true;
                AppendLog($"Системный прокси включён: 127.0.0.1:{_settings.MixedPort}");
            }

            _upBytes = 0;
            _downBytes = 0;
            SetStatus(true);
            ConnectButton.Content = "Отключиться";
            StartTimer();
        }
        catch (Exception ex)
        {
            AppendLog("Ошибка подключения: " + ex.Message);
            MessageBox.Show(ex.Message, "GhostVPN", MessageBoxButton.OK, MessageBoxImage.Error);
            Disconnect();
        }
    }

    private void Disconnect()
    {
        _runner.Stop();
        if (_proxyEnabledByUs)
        {
            SystemProxyManager.Disable();
            _proxyEnabledByUs = false;
            AppendLog("Системный прокси отключён");
        }
        _timer?.Stop();
        SetStatus(false);
        ConnectButton.Content = "Подключиться";
        ExternalIpText.Text = "—";
        TrafficText.Text = "—";
    }

    private void Shutdown()
    {
        Disconnect();
        _runner.Dispose();
    }

    private void SetStatus(bool connected)
    {
        StatusLabel.Text = connected ? "Подключено" : "Отключено";
        StatusDot.Fill = (Brush)FindResource(connected ? "OkBrush" : "ErrBrush");
        StatusText.Text = connected
            ? "Защищённое соединение установлено"
            : "Не подключено";
    }

    /* ------------------------------------------------------------------ */
    /* Таймер: IP и трафик                                                 */
    /* ------------------------------------------------------------------ */

    private void StartTimer()
    {
        _timer?.Stop();
        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        _timer.Tick += async (_, _) => await RefreshStatusAsync();
        _timer.Start();
        _ = RefreshStatusAsync();
    }

    private async Task RefreshStatusAsync()
    {
        try
        {
            using var handler = new HttpClientHandler
            {
                Proxy = new WebProxy($"socks5://127.0.0.1:{_settings.MixedPort}"),
                UseProxy = true,
            };
            using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(8) };
            var ip = await client.GetStringAsync("https://api.ipify.org");
            Dispatcher.Invoke(() => ExternalIpText.Text = ip.Trim());
        }
        catch
        {
            Dispatcher.Invoke(() => ExternalIpText.Text = "…");
        }

        var (up, down) = await ReadTrafficAsync();
        _upBytes += up;
        _downBytes += down;
        Dispatcher.Invoke(() => TrafficText.Text = FormatBytes(_upBytes + _downBytes));
    }

    private async Task<(long Up, long Down)> ReadTrafficAsync()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            var json = await client.GetStringAsync("http://127.0.0.1:9090/traffic");
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            var up = doc.RootElement.TryGetProperty("up", out var u) ? u.GetInt64() : 0;
            var down = doc.RootElement.TryGetProperty("down", out var d) ? d.GetInt64() : 0;
            return (up, down);
        }
        catch
        {
            return (0, 0);
        }
    }

    private static string FormatBytes(long bytes)
    {
        string[] units = { "Б", "КБ", "МБ", "ГБ", "ТБ" };
        double value = bytes;
        var index = 0;
        while (value >= 1024 && index < units.Length - 1)
        {
            value /= 1024;
            index++;
        }
        return $"{value:0.##} {units[index]}";
    }

    /* ------------------------------------------------------------------ */
    /* Прочее                                                              */
    /* ------------------------------------------------------------------ */

    private void CopyKey_Click(object sender, RoutedEventArgs e)
    {
        var profile = Selected;
        if (profile?.RawLink is null)
        {
            return;
        }
        Clipboard.SetText(profile.RawLink);
        AppendLog("Ключ скопирован в буфер обмена");
    }

    private void AppendLog(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        Dispatcher.Invoke(() =>
        {
            LogBox.AppendText($"{DateTime.Now:HH:mm:ss}  {line}{Environment.NewLine}");
            LogBox.ScrollToEnd();
        });
    }
}
