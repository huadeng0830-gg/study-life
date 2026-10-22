param([string]$ToolsRoot = (Join-Path $PSScriptRoot '../.tools/android'))
$ErrorActionPreference = 'Stop'
$ToolsRoot = [IO.Path]::GetFullPath($ToolsRoot)
New-Item -ItemType Directory -Path $ToolsRoot -Force | Out-Null
$jdkRoot = Join-Path $ToolsRoot 'jdk'
if (-not (Test-Path (Join-Path $jdkRoot 'bin/java.exe'))) {
  Write-Output 'Downloading verified Temurin JDK 21 archive...'
  $assets = Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows'
  $package = $assets[0].binary.package
  $archive = Join-Path $ToolsRoot 'jdk.zip'
  Invoke-WebRequest -UseBasicParsing -Uri $package.link -OutFile $archive -TimeoutSec 600
  if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $package.checksum.ToLowerInvariant()) { throw 'JDK checksum mismatch' }
  $unpack = Join-Path $ToolsRoot 'jdk-unpack'
  Expand-Archive -LiteralPath $archive -DestinationPath $unpack -Force
  $extracted = Get-ChildItem -LiteralPath $unpack -Directory | Select-Object -First 1
  Move-Item -LiteralPath $extracted.FullName -Destination $jdkRoot
}
$env:JAVA_HOME = $jdkRoot
$env:PATH = (Join-Path $jdkRoot 'bin') + ';' + $env:PATH
$sdkRoot = Join-Path $ToolsRoot 'sdk'
$manager = Join-Path $sdkRoot 'cmdline-tools/19.0/bin/sdkmanager.bat'
if (-not (Test-Path $manager)) {
  Write-Output 'Reading Android SDK repository metadata...'
  [xml]$repository = (Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/repository2-1.xml' -TimeoutSec 120).Content
  $remote = $repository.SelectNodes('//*[local-name()="remotePackage"]') | Where-Object { $_.path -eq 'cmdline-tools;19.0' } | Select-Object -First 1
  if (-not $remote) { throw 'Pinned Android command tools 19.0 not found' }
  $entry = $remote.archives.archive | Where-Object { $_.'host-os' -eq 'windows' } | Select-Object -First 1
  $archive = Join-Path $ToolsRoot 'command-tools-19.zip'
  Invoke-WebRequest -UseBasicParsing -Uri ('https://dl.google.com/android/repository/' + $entry.complete.url) -OutFile $archive -TimeoutSec 600
  $expected = [string]$entry.complete.checksum.'#text'
  if ($expected -and (Get-FileHash $archive -Algorithm SHA1).Hash.ToLowerInvariant() -ne $expected.ToLowerInvariant()) { throw 'Android tools checksum mismatch' }
  $unpack = Join-Path $ToolsRoot 'sdk-unpack-19'
  Expand-Archive -LiteralPath $archive -DestinationPath $unpack -Force
  New-Item -ItemType Directory -Path (Join-Path $sdkRoot 'cmdline-tools') -Force | Out-Null
  Move-Item -LiteralPath (Join-Path $unpack 'cmdline-tools') -Destination (Join-Path $sdkRoot 'cmdline-tools/19.0')
}
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
Write-Output 'Installing Android platform and build tools...'
& $manager "--sdk_root=$sdkRoot" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $sdkRoot 'platforms/android-36/android.jar')) -or -not (Test-Path (Join-Path $sdkRoot 'build-tools/36.0.0/apksigner.bat'))) {
  throw 'Android SDK installation incomplete; run npm run android:setup in a terminal and review the required SDK license'
}
Write-Output "Android toolchain ready at $ToolsRoot"
