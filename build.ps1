$source = $PSScriptRoot
$manifestPath = Join-Path $source "manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version
$dest = Join-Path $source "savault-chrome-extension-v$version.zip"
$temp = Join-Path $env:TEMP "savault-build"

Write-Host "`n=== savault Chrome Extension Build ===" -ForegroundColor Cyan
Write-Host "Version: $version"
Write-Host ""

# -- Pre-flight: check that api-config.js exists --
$apiConfig = Join-Path $source "lib\api-config.js"
if (-not (Test-Path $apiConfig)) {
    Write-Host "ERROR: lib/api-config.js not found." -ForegroundColor Red
    Write-Host "Copy lib/api-config.example.js to lib/api-config.js and set your Worker URL."
    exit 1
}

# -- Pre-flight: scan for leaked secrets --
$sensitivePatterns = @(
    "secret_[A-Za-z0-9]{10,}",
    "ntn_[A-Za-z0-9]{20,}",
    "sk-[A-Za-z0-9]{20,}",
    "NOTION_TOKEN\s*=\s*\S",
    "SAVAULT_API_KEY\s*=\s*[""'][^""']+[""']",
    "Bearer\s+\S"
)

$leaked = $false
$scanFiles = Get-ChildItem -Path $source -Recurse -File -Include "*.js","*.json","*.html","*.css","*.toml" |
    Where-Object { $_.FullName -notmatch '(worker[/\\]|node_modules[/\\]|\.git[/\\]|\.zip$)' }

foreach ($file in $scanFiles) {
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $content) { continue }
    foreach ($pattern in $sensitivePatterns) {
        if ($content -match $pattern) {
            Write-Host "  LEAK DETECTED in $($file.FullName): matches /$pattern/" -ForegroundColor Red
            $leaked = $true
        }
    }
}

if ($leaked) {
    Write-Host "`nBuild ABORTED - fix leaked secrets before publishing.`n" -ForegroundColor Red
    exit 1
}
Write-Host "  No secrets found in extension files." -ForegroundColor Green

# -- Create clean build directory --
Write-Host "Creating temporary build directory..."
if (Test-Path $temp) { Remove-Item -Recurse -Force $temp }
New-Item -ItemType Directory -Force -Path $temp | Out-Null

# -- Copy only the files needed for the published extension --
Write-Host "Copying extension files..."

$includeDirs = @("archive", "assets", "background", "content", "icons", "lib")
$excludeFiles = @(
    "api-config.example.js",
    "notion-credentials.example.js",
    "notion-credentials.js",
    "source.png",
    "source.svg"
)

# Copy manifest
Copy-Item $manifestPath -Destination $temp

# Copy directories
foreach ($dir in $includeDirs) {
    $srcDir = Join-Path $source $dir
    $destDir = Join-Path $temp $dir
    if (Test-Path $srcDir) {
        New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        Get-ChildItem $srcDir -File | Where-Object {
            $excludeFiles -notcontains $_.Name
        } | ForEach-Object {
            Copy-Item $_.FullName -Destination $destDir
        }
    }
}

# -- Compress --
Write-Host "Compressing to $dest..."
if (Test-Path $dest) { Remove-Item -Force $dest }
Compress-Archive -Path "$temp\*" -DestinationPath $dest

# -- Cleanup --
Write-Host "Cleaning up..."
Remove-Item -Recurse -Force $temp

# -- Summary --
$zipSize = [math]::Round((Get-Item $dest).Length / 1KB, 1)
Write-Host ""
Write-Host "Build complete! ($zipSize KB)" -ForegroundColor Green
Write-Host "Output: $dest"
Write-Host "Upload this file to the Chrome Web Store."
Write-Host ""
