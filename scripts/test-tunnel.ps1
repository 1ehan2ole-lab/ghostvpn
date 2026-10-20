param(
  [string]$Email = 'demo@ghostvpn.local',
  [string]$Password = 'demo12345',
  [string]$Panel = 'http://127.0.0.1:8080'
)
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\Game\Desktop\AI\GhostVPN'
$xray = "$root\vendor\xray\xray.exe"
$tmp  = $env:TEMP
Add-Type -AssemblyName System.Web
Push-Location $root

# 1. Получаем подписку и разбираем vless-ссылку
$token = node --disable-warning=ExperimentalWarning -e "import('./server/db.js').then(async m=>{m.initDb();const u=m.findUserByEmail('$Email');console.log(u?u.sub_token:'')})"
if (-not $token) { "НЕТ ПОЛЬЗОВАТЕЛЯ $Email"; exit 1 }
$raw = curl.exe -s "$Panel/sub/$token"
$link = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($raw)).Trim()

$uri = [Uri]$link
$q = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
$uuid = $uri.UserInfo
$server = $uri.Host
if ($server -eq 'localhost') { $server = '127.0.0.1' }   # сервер слушает только IPv4
$port = $uri.Port
$sni = $q['sni']; $pbk = $q['pbk']; $sid = $q['sid']; $fp = $q['fp']; $flow = $q['flow']
"Ссылка: $link"
"Параметры: host=$server port=$port sni=$sni flow=$flow fp=$fp"

# 2. Собираем клиентский конфиг из ссылки
$client = @{
  log = @{ loglevel = 'warning' }
  inbounds = @(@{ tag='socks'; listen='127.0.0.1'; port=18080; protocol='socks'; settings=@{ auth='noauth'; udp=$false } })
  outbounds = @(@{
    tag='proxy'; protocol='vless'
    settings=@{ vnext=@(@{ address=$server; port=$port; users=@(@{ id=$uuid; encryption='none'; flow=$flow }) }) }
    streamSettings=@{ network='tcp'; security='reality'; realitySettings=@{ fingerprint=$fp; serverName=$sni; publicKey=$pbk; shortId=$sid; spiderX='/' } }
  })
}
[IO.File]::WriteAllText("$tmp/ghost-client.json", ($client | ConvertTo-Json -Depth 25))

Get-Process xray -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $clientProc.Id } | Stop-Process -Force -ErrorAction SilentlyContinue
$clientProc = Start-Process -FilePath $xray -ArgumentList 'run','-c',"$tmp/ghost-client.json" -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2

# 3. Проверяем туннель
$ip = curl.exe -s --max-time 20 --socks5-hostname 127.0.0.1:18080 https://api.ipify.org
if ($ip) { "ТУННЕЛЬ РАБОТАЕТ, внешний IP: $ip" } else { "ТУННЕЛЬ НЕ РАБОТАЕТ"; exit 1 }

# 4. Проверяем учёт трафика в панели
Start-Sleep -Seconds 32
$bodyFile = "$tmp/ghost-login.json"
[IO.File]::WriteAllText($bodyFile, ('{"login":"' + $Email + '","password":"' + $Password + '"}'))
$login = curl.exe -s -c "$tmp/ghost-cookies.txt" -X POST "$Panel/api/auth/login" -H "Content-Type: application/json" --data-binary "@$bodyFile"
"Вход: $login"
$me = curl.exe -s -b "$tmp/ghost-cookies.txt" "$Panel/api/me"
"Кабинет: $me"
if ($clientProc) { Stop-Process -Id $clientProc.Id -Force -ErrorAction SilentlyContinue }
Pop-Location
