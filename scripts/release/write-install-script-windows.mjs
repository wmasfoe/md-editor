import fs from "node:fs";
import path from "node:path";

function psQuote(value) {
  return `'${String(value ?? "").replace(/'/gu, "''")}'`;
}

export function generateWindowsInstallScript({
  version,
  winX64Url = "",
  winX64Sha256 = "",
  winArm64Url = "",
  winArm64Sha256 = "",
}) {
  if (!version) {
    throw new Error("Missing required parameter: version");
  }

  return `# Markdown Editor Windows Installer
$ErrorActionPreference = 'Stop'

$AppName = 'Markdown Editor'
$Version = ${psQuote(version)}

$WinX64Url = ${psQuote(winX64Url)}
$WinX64Sha256 = ${psQuote(winX64Sha256.toLowerCase())}

$WinArm64Url = ${psQuote(winArm64Url)}
$WinArm64Sha256 = ${psQuote(winArm64Sha256.toLowerCase())}

function Log-Info($msg) {
    Write-Host "md-editor install: $msg" -ForegroundColor Cyan
}

function Fail-Install($msg) {
    Write-Error "md-editor install error: $msg"
    exit 1
}

$arch = $env:PROCESSOR_ARCHITECTURE
$downloadUrl = ''
$expectedSha = ''

switch ($arch) {
    'AMD64' {
        $downloadUrl = $WinX64Url
        $expectedSha = $WinX64Sha256
    }
    'ARM64' {
        if ($WinArm64Url) {
            $downloadUrl = $WinArm64Url
            $expectedSha = $WinArm64Sha256
        } else {
            # Fallback to x64 on Windows 11 ARM via emulation if ARM64 native package is not provided
            $downloadUrl = $WinX64Url
            $expectedSha = $WinX64Sha256
        }
    }
    default {
        Fail-Install "Unsupported processor architecture: $arch"
    }
}

if (-not $downloadUrl) {
    Fail-Install "Download URL for Windows ($arch) is not configured."
}

$tempDir = [System.IO.Path]::GetTempPath()
$installerPath = Join-Path $tempDir "md-editor-setup-$Version.exe"

try {
    Log-Info "Downloading $AppName $Version for Windows ($arch)..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $downloadUrl -OutFile $installerPath -UseBasicParsing

    if ($expectedSha) {
        Log-Info "Verifying SHA256 hash..."
        $actualSha = (Get-FileHash -Path $installerPath -Algorithm SHA256).Hash.ToLower()
        if ($actualSha -ne $expectedSha) {
            Fail-Install "SHA256 hash mismatch: expected $expectedSha, got $actualSha"
        }
    }

    Log-Info "Running silent installation..."
    $process = Start-Process -FilePath $installerPath -ArgumentList "/S" -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        Fail-Install "Installer exited with code $($process.ExitCode)"
    }

    Log-Info "$AppName $Version has been successfully installed!"
}
finally {
    if (Test-Path $installerPath) {
        Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    }
}
`;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  const version = process.env.RELEASE_VERSION?.trim();
  const winX64Url =
    (process.env.WIN_X64_DOWNLOAD_URL ?? process.env.WINDOWS_DOWNLOAD_URL)?.trim() || "";
  const winX64Sha256 = (process.env.WIN_X64_SHA256 ?? process.env.WINDOWS_SHA256)?.trim() || "";
  const winArm64Url = process.env.WIN_ARM64_DOWNLOAD_URL?.trim() || "";
  const winArm64Sha256 = process.env.WIN_ARM64_SHA256?.trim() || "";
  const outputPath =
    process.env.WINDOWS_INSTALL_SCRIPT_OUTPUT_PATH?.trim() || "install-md-editor.ps1";

  if (!version) {
    throw new Error("Missing required environment variable: RELEASE_VERSION");
  }

  const script = generateWindowsInstallScript({
    version,
    winX64Url,
    winX64Sha256,
    winArm64Url,
    winArm64Sha256,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, script, { encoding: "utf8" });
  console.log(`Wrote ${outputPath}`);
}
