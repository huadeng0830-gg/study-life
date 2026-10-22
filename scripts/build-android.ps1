param([switch]$SkipWebBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$toolsRoot = Join-Path $projectRoot '.tools/android'
$env:JAVA_HOME = Join-Path $toolsRoot 'jdk'
$env:ANDROID_HOME = Join-Path $toolsRoot 'sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = Join-Path $toolsRoot 'gradle-cache'
$env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH
if (-not (Test-Path (Join-Path $env:ANDROID_HOME 'platforms/android-36/android.jar'))) {
  & (Join-Path $PSScriptRoot 'setup-android.ps1')
}
if (-not $SkipWebBuild) {
  & npm.cmd run build:android
  if ($LASTEXITCODE -ne 0) { throw 'Android web asset build failed' }
}
& npx.cmd cap sync android
if ($LASTEXITCODE -ne 0) { throw 'Android asset sync failed' }
$signingRoot = Join-Path $toolsRoot 'signing'
New-Item -ItemType Directory -Path $signingRoot -Force | Out-Null
$signingConfig = Join-Path $signingRoot 'signing.local.json'
if (-not (Test-Path $signingConfig)) {
  $secretBytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($secretBytes)
  $rng.Dispose()
  @{ password = [Convert]::ToBase64String($secretBytes) } | ConvertTo-Json | Set-Content -LiteralPath $signingConfig -Encoding UTF8
}
$env:STUDY_LIFE_KEYSTORE = Join-Path $signingRoot 'study-life.jks'
$env:STUDY_LIFE_KEYSTORE_PASSWORD = (Get-Content -LiteralPath $signingConfig -Raw | ConvertFrom-Json).password
if (-not (Test-Path $env:STUDY_LIFE_KEYSTORE)) {
  & keytool.exe -genkeypair -keystore $env:STUDY_LIFE_KEYSTORE -storepass:env STUDY_LIFE_KEYSTORE_PASSWORD -keypass:env STUDY_LIFE_KEYSTORE_PASSWORD -alias study-life -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Sanliangshi Android, O=Sanliangshi' -storetype PKCS12
  if ($LASTEXITCODE -ne 0) { throw 'APK signing key creation failed' }
}
try {
  Set-Location -LiteralPath (Join-Path $projectRoot 'android')
  $localGradle = Join-Path $toolsRoot 'gradle/gradle-8.14.3/bin/gradle.bat'
  if (Test-Path $localGradle) { & $localGradle --no-daemon --console plain assembleRelease }
  else { & .\gradlew.bat --no-daemon --console plain assembleRelease }
  if ($LASTEXITCODE -ne 0) { throw 'Gradle APK build failed' }
  Set-Location -LiteralPath $projectRoot
  $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
  $outputRoot = Join-Path $projectRoot 'release-android'
  New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
  $output = Join-Path $outputRoot "sanliangshi-$version.apk"
  Copy-Item -LiteralPath 'android/app/build/outputs/apk/release/app-release.apk' -Destination $output -Force
  & (Join-Path $env:ANDROID_HOME 'build-tools/36.0.0/apksigner.bat') verify --verbose $output
  if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
  $digest = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
  "$digest  $([IO.Path]::GetFileName($output))" | Set-Content -LiteralPath "$output.sha256" -Encoding ASCII
  Write-Output "Signed APK: $output"
} finally {
  $env:STUDY_LIFE_KEYSTORE_PASSWORD = $null
  Set-Location -LiteralPath $projectRoot
}
