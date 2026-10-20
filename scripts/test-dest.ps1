param()
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\Game\Desktop\AI\GhostVPN'
$xray = "$root\vendor\xray\xray.exe"
$uuid = '48fd58fe-8f96-41de-8ca6-aaf99d83498a'
$pbk  = 'EHS96tL4pT0_zFltX2f7SlzWhzUDxeUgz3VrxAl1Bi4'
$sid  = 'eca865792c20c730'
$tmp  = $env:TEMP

$destinations = @(
  'www.microsoft.com:443',
  'www.apple.com:443',
  'www.cloudflare.com:443',
  'one.one.one.one:443',
  'www.bing.com:443',
  'www.lovelive-anime.jp:443',
  'www.icloud.com:443',
  'www.tesla.com:443',
  'www.yahoo.com:443',
  'www.gstatic.com:443'
)

foreach ($d in $destinations) {
  $host_ = ($d -split ':')[0]
  $serverCfg = @{
    log = @{ loglevel = 'warning'; error = "$tmp/rt-server.log" }
    inbounds = @(
      @{ tag='vless-reality'; listen='127.0.0.1'; port=18443; protocol='vless'
         settings=@{ clients=@(@{id=$uuid; email='t'; flow='xtls-rprx-vision'; level=0}); decryption='none' }
         streamSettings=@{ network='tcp'; security='reality'; realitySettings=@{ show=$false; dest=$d; xver=0; serverNames=@($host_); privateKey='EN8Xbcabshqj66JobEThBTlD48iOdNeK6pFq-pP2WWY'; shortIds=@($sid); spiderX='/' } } }
    )
    outbounds = @(@{ tag='direct'; protocol='freedom' })
  }
  $clientCfg = @{
    log = @{ loglevel='warning' }
    inbounds = @(@{ tag='socks'; listen='127.0.0.1'; port=18080; protocol='socks'; settings=@{ auth='noauth'; udp=$false } })
    outbounds = @(@{
      tag='proxy'; protocol='vless'
      settings=@{ vnext=@(@{ address='127.0.0.1'; port=18443; users=@(@{ id=$uuid; encryption='none'; flow='xtls-rprx-vision' }) }) }
      streamSettings=@{ network='tcp'; security='reality'; realitySettings=@{ fingerprint='chrome'; serverName=$host_; publicKey=$pbk; shortId=$sid; spiderX='/' } }
    })
  }
  [IO.File]::WriteAllText("$tmp/rt-server.json", ($serverCfg | ConvertTo-Json -Depth 25))
  [IO.File]::WriteAllText("$tmp/rt-client.json", ($clientCfg | ConvertTo-Json -Depth 25))

  Get-Process xray -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 700
  Start-Process -FilePath $xray -ArgumentList 'run','-c',"$tmp/rt-server.json" -WindowStyle Hidden
  Start-Sleep -Milliseconds 1200
  Start-Process -FilePath $xray -ArgumentList 'run','-c',"$tmp/rt-client.json" -WindowStyle Hidden
  Start-Sleep -Milliseconds 1200

  $ip = curl.exe -s --max-time 12 --socks5-hostname 127.0.0.1:18080 https://api.ipify.org
  if ($ip) { "OK   $d -> $ip" } else { "FAIL $d" }
}

Get-Process xray -ErrorAction SilentlyContinue | Stop-Process -Force
