<#
.SYNOPSIS
Sort a download folder into the drop folder the pipeline reads.

.DESCRIPTION
Extracts every .zip into its own folder under -Destination, reports how many Unreal
content files each one contains, and deletes the folders that contain none — which is
how a DCS module, a mod archive or a stray download gets filtered out instead of
arriving at the importer as hundreds of .lua/.json/.ts files.

This downloads nothing. Fab content needs your Epic account, entitlement for the pack
and acceptance of its licence, and no script can do that on your behalf.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\fetch-art.ps1

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\fetch-art.ps1 -Source D:\downloads -Destination C:\HouseArrest\Fab
#>
[CmdletBinding()]
param(
    [string]$Source = (Join-Path $env:USERPROFILE "Downloads"),
    [string]$Destination = "C:\HouseArrest\Fab",
    # Keep folders that hold no Unreal content instead of deleting them.
    [switch]$KeepEverything
)

if (-not (Test-Path -LiteralPath $Source)) {
    throw "source folder not found: $Source"
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$contentExtensions = @("*.uasset", "*.umap", "*.fbx", "*.obj", "*.abc", "*.png", "*.tga", "*.exr", "*.wav")
$zips = @(Get-ChildItem -Path $Source -Filter *.zip -File -ErrorAction SilentlyContinue | Sort-Object Name)

if ($zips.Count -eq 0) {
    Write-Host "no .zip files in $Source"
    exit 1
}

$packs = 0
$skipped = 0

foreach ($zip in $zips) {
    $target = Join-Path $Destination $zip.BaseName

    try {
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        Expand-Archive -LiteralPath $zip.FullName -DestinationPath $target -Force -ErrorAction Stop
    }
    catch {
        Write-Host ("{0,-46} unreadable: {1}" -f $zip.Name, $_.Exception.Message)
        $skipped++
        continue
    }

    $content = @(Get-ChildItem -Path $target -Recurse -File -Include $contentExtensions -ErrorAction SilentlyContinue)

    if ($content.Count -eq 0) {
        Write-Host ("{0,-46} no Unreal content" -f $zip.Name)
        if (-not $KeepEverything) { Remove-Item -LiteralPath $target -Recurse -Force }
        $skipped++
        continue
    }

    Write-Host ("{0,-46} {1,6} content files -> {2}" -f $zip.Name, $content.Count, $target)
    $packs++
}

Write-Host ""
Write-Host ("{0} pack(s) kept, {1} zip(s) skipped." -f $packs, $skipped)

if ($packs -gt 0) {
    Write-Host ""
    Write-Host "next:"
    Write-Host ('  npm.cmd run run -- --library C:\HouseArrest\library --drop "{0}" --engine-root "C:\Program Files\Epic Games\UE_5.8" --engine 5.8 --settings dev' -f $Destination)
}
else {
    Write-Host ""
    Write-Host "Nothing in $Source holds Unreal content. Claim a pack on Fab first:"
    Write-Host "  https://www.fab.com/search?q=abandoned+basement+interior"
}
