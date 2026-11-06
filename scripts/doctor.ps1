<#
.SYNOPSIS
    Read-only environment report and TypeScript check for HOUSE ARREST.

.DESCRIPTION
    Answers the questions that cannot be answered from a chat transcript: which Unreal
    Engine is installed and where, whether Visual Studio carries the C++ toolset and a
    Windows SDK, which Node and Git are on PATH, whether the project is where you think
    it is, and whether the simulation still typechecks and passes its tests.

    Nothing is installed, nothing under src/, test/ or the generated Unreal project is
    written, and no network access is used. Everything it records goes into
    -Diagnostics (default C:\HouseArrest\diagnostics) under fixed file names, so two
    runs can be compared with a diff instead of a timestamp hunt.

    -Build also runs the generator's engine stages. It refuses to start while the
    Unreal editor is open, because the link step fails on locked DLLs.

.PARAMETER Project
    Project root to inspect. Default C:\ha10\house-arrest-main.

.PARAMETER Library
    Asset library folder passed to the pipeline by -Build.
    Default C:\HouseArrest\library.

.PARAMETER EngineRoot
    Force a specific engine folder instead of discovering one under Epic Games.

.PARAMETER Diagnostics
    Where the report files are written. Default C:\HouseArrest\diagnostics.

.PARAMETER Build
    Run the pipeline's engine stages as well. Editor must be closed.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\doctor.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\doctor.ps1 -Build
#>
[CmdletBinding()]
param(
    [string]$Project = "C:\ha10\house-arrest-main",
    [string]$Library = "C:\HouseArrest\library",
    [string]$EngineRoot = "",
    [string]$Diagnostics = "C:\HouseArrest\diagnostics",
    [switch]$Build
)

$ErrorActionPreference = "Continue"

$script:Lines = New-Object System.Collections.ArrayList
$script:Failures = New-Object System.Collections.ArrayList
$script:EnginePath = ""
$script:EngineVersion = ""
$script:DiagnosticsPath = ""

function Say {
    param([string]$Text = "")
    [void]$script:Lines.Add($Text)
    Write-Host $Text
}

function Ok {
    param([string]$Text)
    Say ("ok    " + $Text)
}

function Note {
    param([string]$Text)
    Say ("note  " + $Text)
}

function Fail {
    param([string]$Text)
    [void]$script:Failures.Add($Text)
    Say ("FAIL  " + $Text)
}

function Section {
    param([string]$Text)
    Say ""
    Say ("== " + $Text + " ==")
}

function Save {
    param([string]$Name, [string]$Text)
    if ($script:DiagnosticsPath -eq "") { return }
    $target = Join-Path $script:DiagnosticsPath $Name
    try {
        [System.IO.File]::WriteAllText($target, $Text, (New-Object System.Text.UTF8Encoding($false)))
        Say ("      saved " + $target)
    } catch {
        Note ("could not write " + $target + ": " + $_.Exception.Message)
    }
}

# Runs an executable and keeps its output and exit code. Missing executables are
# reported as code 127 rather than throwing, so one absent tool does not end the run.
function Invoke-Captured {
    param(
        [string]$Exe,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = ""
    )
    # A hashtable, not New-Object psobject: assigning a property that does not exist
    # yet on a bare PSObject throws, which would turn every absent tool into a crash.
    $result = @{ Output = ""; Code = 127 }
    $command = Get-Command $Exe -ErrorAction SilentlyContinue
    if ($null -eq $command) { return $result }
    Push-Location
    try {
        if ($WorkingDirectory -ne "") { Set-Location -LiteralPath $WorkingDirectory }
        $output = & $command.Source @Arguments 2>&1 | Out-String
        $result.Output = $output.Trim()
        if ($null -eq $LASTEXITCODE) { $result.Code = 0 } else { $result.Code = $LASTEXITCODE }
    } catch {
        $result.Output = $_.Exception.Message
        $result.Code = 1
    } finally {
        Pop-Location
    }
    return $result
}

# Reads Engine\Build\Build.version. Deliberately not ConvertFrom-Json: that throws on
# text a different encoding or line-ending convention produced, which is exactly how a
# perfectly good engine install ends up reported as "unknown". A regex over the text
# cannot fail that way.
function Read-EngineVersion {
    param([string]$Path)
    try {
        $text = [System.IO.File]::ReadAllText($Path)
    } catch {
        return ""
    }
    $major = [regex]::Match($text, '"MajorVersion"\s*:\s*(\d+)')
    $minor = [regex]::Match($text, '"MinorVersion"\s*:\s*(\d+)')
    $patch = [regex]::Match($text, '"PatchVersion"\s*:\s*(\d+)')
    if (-not $major.Success -or -not $minor.Success) { return "" }
    $value = $major.Groups[1].Value + "." + $minor.Groups[1].Value
    if ($patch.Success) { $value = $value + "." + $patch.Groups[1].Value }
    return $value
}

# Last few lines of captured output, so the console stays readable and the file keeps
# everything.
function Tail {
    param([string]$Text, [int]$Count = 12)
    if ($Text -eq "") { return "(no output)" }
    $lines = $Text -split "`r?`n"
    if ($lines.Count -le $Count) { return ($lines -join "`r`n") }
    return (($lines[($lines.Count - $Count)..($lines.Count - 1)]) -join "`r`n")
}

try {
    if (-not (Test-Path -LiteralPath $Diagnostics)) {
        New-Item -ItemType Directory -Path $Diagnostics -Force | Out-Null
    }
    $script:DiagnosticsPath = $Diagnostics
} catch {
    $script:DiagnosticsPath = ""
    Write-Host ("could not create " + $Diagnostics + ": " + $_.Exception.Message)
}

Say "HOUSE ARREST environment check"
Say ("project root: " + $Project)
Say ("diagnostics:  " + $Diagnostics)
Say ("powershell:   " + $PSVersionTable.PSVersion.ToString())

# ---------------------------------------------------------------- runtimes

Section "Node.js"
$node = Invoke-Captured "node" @("-v")
if ($node.Code -ne 0 -or $node.Output -eq "") {
    Fail "node is not on PATH (install Node.js 26 from nodejs.org)"
} else {
    $major = 0
    if ($node.Output -match "^v(\d+)") { $major = [int]$Matches[1] }
    if ($major -ge 22) {
        Ok ("node " + $node.Output)
    } else {
        Fail ("node " + $node.Output + " is older than the 22.6 the generator needs")
    }
    $npm = Invoke-Captured "npm.cmd" @("-v")
    if ($npm.Code -eq 0 -and $npm.Output -ne "") {
        Ok ("npm " + $npm.Output)
    } else {
        Note "npm is not on PATH; the pipeline is run through npm.cmd run run"
    }
}

Section "Git"
$git = Invoke-Captured "git" @("--version")
if ($git.Code -eq 0 -and $git.Output -ne "") {
    Ok $git.Output
    $lfs = Invoke-Captured "git" @("lfs", "version")
    if ($lfs.Code -eq 0) {
        Ok ("git lfs " + $lfs.Output)
    } else {
        Note "git lfs is not installed; not needed unless you commit binary assets to the repository"
    }
} else {
    Note "git is not installed; the pipeline does not need it, but uncommitted changes cannot be shown"
}

# ---------------------------------------------------------------- toolchain

Section "Visual Studio and Windows SDK"
$programFilesX86 = ${env:ProgramFiles(x86)}
if ([string]::IsNullOrEmpty($programFilesX86)) { $programFilesX86 = "C:\Program Files (x86)" }
$vswhere = ""
if (-not [string]::IsNullOrEmpty($programFilesX86)) {
    $vswhere = Join-Path $programFilesX86 "Microsoft Visual Studio\Installer\vswhere.exe"
}
if ($vswhere -ne "" -and (Test-Path -LiteralPath $vswhere)) {
    $vsPath = Invoke-Captured $vswhere @(
        "-latest", "-products", "*",
        "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-property", "installationPath"
    )
    if ($vsPath.Code -eq 0 -and $vsPath.Output -ne "") {
        Ok ("Visual Studio C++ toolset in " + $vsPath.Output)
        $msvc = Join-Path $vsPath.Output "VC\Tools\MSVC"
        if (Test-Path -LiteralPath $msvc) {
            $tools = Get-ChildItem -LiteralPath $msvc -Directory | Sort-Object Name
            if ($tools.Count -gt 0) { Ok ("MSVC " + $tools[$tools.Count - 1].Name) }
        }
    } else {
        Fail "Visual Studio without the C++ toolset: add the 'Game development with C++' workload in the installer"
    }
} else {
    Fail ("vswhere not found at " + $vswhere + "; install Visual Studio with the 'Game development with C++' workload")
}

$sdkRoot = "C:\Program Files (x86)\Windows Kits\10\Include"
if (Test-Path -LiteralPath $sdkRoot) {
    $sdks = Get-ChildItem -LiteralPath $sdkRoot -Directory | Sort-Object Name
    if ($sdks.Count -gt 0) {
        Ok ("Windows SDK " + $sdks[$sdks.Count - 1].Name)
    } else {
        Fail "Windows SDK 10 folder exists but holds no versions"
    }
} else {
    Fail ("Windows SDK 10 not found at " + $sdkRoot)
}

# ---------------------------------------------------------------- unreal

Section "Unreal Engine"
$engineRoots = New-Object System.Collections.ArrayList
$manifest = "C:\ProgramData\Epic\UnrealEngineLauncher\LauncherInstalled.dat"
if (Test-Path -LiteralPath $manifest) {
    try {
        $launcher = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
        foreach ($entry in $launcher.InstallationList) {
            if ($entry.AppName -like "UE_5*") { [void]$engineRoots.Add($entry.InstallLocation) }
        }
    } catch {
        Note ("could not read " + $manifest + ": " + $_.Exception.Message)
    }
} else {
    Note "Epic launcher manifest not found; falling back to a folder scan"
}
if ($EngineRoot -ne "") { [void]$engineRoots.Add($EngineRoot) }
if ($engineRoots.Count -eq 0) {
    $epicGames = "C:\Program Files\Epic Games"
    if (Test-Path -LiteralPath $epicGames) {
        foreach ($dir in (Get-ChildItem -LiteralPath $epicGames -Directory)) {
            if ($dir.Name -like "UE_5*") { [void]$engineRoots.Add($dir.FullName) }
        }
    }
}

foreach ($root in $engineRoots) {
    $editor = Join-Path $root "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
    if (-not (Test-Path -LiteralPath $editor)) {
        Note ("skipping " + $root + ": no Engine\Binaries\Win64\UnrealEditor-Cmd.exe")
        continue
    }
    $version = ""
    $versionFile = Join-Path $root "Engine\Build\Build.version"
    if (Test-Path -LiteralPath $versionFile) {
        $version = Read-EngineVersion $versionFile
        if ($version -eq "") {
            Note ("could not read a version from " + $versionFile + "; falling back to the folder name")
        }
    }
    if ($version -eq "" -and $root -match "(?i)UE_(\d+\.\d+)") {
        # Unreal installs are named by version (UE_5.8), so this still resolves.
        $version = $Matches[1]
    }
    if ($version -eq "") {
        Note ("skipping " + $root + ": no version could be determined")
        continue
    }
    Ok ("Unreal Engine " + $version + " at " + $root)
    if ($version -like "5.8*" -or $version -like "5.7*" -or $version -like "5.6*") {
        if ($script:EnginePath -eq "" -or $version -like "5.8*") {
            $script:EnginePath = $root
            $script:EngineVersion = ($version -split "\.")[0] + "." + ($version -split "\.")[1]
        }
    }
}
if ($script:EnginePath -eq "") {
    Fail "no Unreal Engine 5.6+ installation found; --engine-root cannot be resolved"
} else {
    Ok ("selected engine " + $script:EngineVersion + " for the pipeline")
}

$running = Get-Process -Name "UnrealEditor", "UnrealEditor-Cmd" -ErrorAction SilentlyContinue
if ($null -ne $running) {
    Note ("the Unreal editor is running (" + $running.Count + " process); close it before any engine stage")
}

# ---------------------------------------------------------------- project

Section "Project"
$projectProblems = 0
foreach ($required in @("package.json", "tsconfig.json", "src\tools\run.ts", "test")) {
    $path = Join-Path $Project $required
    if (Test-Path -LiteralPath $path) {
        Ok $required
    } else {
        Fail ("missing " + $required + " under " + $Project)
        $projectProblems = $projectProblems + 1
    }
}
if ($projectProblems -eq 0) {
    $sources = Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Filter *.ts -ErrorAction SilentlyContinue
    Ok ("src holds " + $sources.Count + " .ts files")
    $artifacts = Join-Path $Project "artifacts"
    if (Test-Path -LiteralPath $artifacts) {
        Ok "artifacts exists (previous offline stages ran here)"
    } else {
        Note "no artifacts folder yet; the offline stages have not been run in this copy"
    }
    $package = Get-Content -LiteralPath (Join-Path $Project "package.json") -Raw | ConvertFrom-Json
    if ($null -ne $package.engines) {
        Note ("package.json engines: " + ($package.engines | Out-String).Trim())
    }
    if ($git.Code -eq 0) {
        $status = Invoke-Captured "git" @("status", "--porcelain") $Project
        if ($status.Code -eq 0) {
            if ($status.Output -eq "") {
                Ok "git working tree is clean"
            } else {
                $changed = ($status.Output -split "`r?`n" | Where-Object { $_ -ne "" }).Count
                Note ("" + $changed + " changed path(s) in the working tree; back up before engine stages")
            }
        }
    }
}

# ---------------------------------------------------------------- checks

Section "TypeScript"
$typeReport = New-Object System.Collections.ArrayList
if ($node.Code -eq 0 -and $projectProblems -eq 0) {
    # npm 11 removed "npx --no-install", and with nothing installed locally npx fetches
    # the unrelated npm package called "tsc" instead of typechecking anything. Find a
    # compiler explicitly, and treat its absence as information rather than a failure.
    $tscExe = ""
    $tscArgs = @("--noEmit")
    $localBin = Join-Path $Project "node_modules\.bin\tsc.cmd"
    $localScript = Join-Path $Project "node_modules\typescript\bin\tsc"
    if (Test-Path -LiteralPath $localBin) {
        $tscExe = $localBin
    } elseif (Test-Path -LiteralPath $localScript) {
        $tscExe = "node"
        $tscArgs = @($localScript, "--noEmit")
    } else {
        $global = Get-Command "tsc.cmd" -ErrorAction SilentlyContinue
        if ($null -eq $global) { $global = Get-Command "tsc" -ErrorAction SilentlyContinue }
        if ($null -ne $global) { $tscExe = $global.Source }
    }

    if ($tscExe -eq "") {
        Note "TypeScript is not installed, so the typecheck was skipped"
        Note "to enable it: npm.cmd install --no-save typescript, then run this script again"
        [void]$typeReport.Add("typecheck skipped: no tsc on PATH and no local node_modules")
        [void]$typeReport.Add("")
    } else {
        $tsc = Invoke-Captured $tscExe $tscArgs $Project
        [void]$typeReport.Add("$ " + $tscExe + " " + ($tscArgs -join " "))
        [void]$typeReport.Add($tsc.Output)
        [void]$typeReport.Add("exit " + $tsc.Code)
        [void]$typeReport.Add("")
        if ($tsc.Code -eq 0) {
            Ok ("typecheck passed via " + $tscExe)
        } else {
            Fail ("typecheck exited " + $tsc.Code + " via " + $tscExe)
            Say (Tail $tsc.Output 15)
        }
    }

    $tests = Invoke-Captured "node.cmd" @("--test", "test/") $Project
    if ($tests.Code -eq 127) { $tests = Invoke-Captured "node" @("--test", "test/") $Project }
    [void]$typeReport.Add("$ node --test test/")
    [void]$typeReport.Add($tests.Output)
    [void]$typeReport.Add("exit " + $tests.Code)
    if ($tests.Code -eq 0) {
        # Unanchored on purpose: the symbol in front of the counts is read as mojibake
        # under Windows PowerShell 5.1, so anchoring on a non-word character fails.
        $passed = [regex]::Match($tests.Output, "\bpass (\d+)")
        $failed = [regex]::Match($tests.Output, "\bfail (\d+)")
        if ($passed.Success) {
            $counts = $passed.Groups[1].Value + " pass"
            if ($failed.Success) { $counts = $counts + ", " + $failed.Groups[1].Value + " fail" }
            Ok ("node --test test/ (" + $counts + ")")
        } else {
            Ok "node --test test/ exited 0"
        }
    } else {
        Fail ("node --test test/ exited " + $tests.Code)
        Say (Tail $tests.Output 20)
    }
    Save "typescript.txt" ($typeReport -join "`r`n")
} else {
    Note "tests skipped: node or the project is not in place"
}

# ---------------------------------------------------------------- build

# Set only when the pipeline runs to completion, so the last line can distinguish
# "this machine could build" from "it did build".
$script:PipelineOk = $false

Section "Pipeline"
if (-not $Build) {
    Note "-Build not given: nothing was generated, compiled or packaged"
} elseif ($script:EnginePath -eq "") {
    Fail "-Build needs Unreal Engine; none was found"
} elseif ($null -ne $running) {
    Fail "-Build refused: close the Unreal editor first (its DLLs are locked during the link)"
} elseif (-not (Test-Path -LiteralPath $Library)) {
    Fail ("-Build needs the asset library at " + $Library + " (pass -Library)")
} else {
    $pipeline = Invoke-Captured "npm.cmd" @(
        "run", "run", "--",
        "--library", $Library,
        "--engine-root", $script:EnginePath,
        "--engine", $script:EngineVersion,
        "--settings", "dev"
    ) $Project
    Save "pipeline.txt" ($pipeline.Output + "`r`nexit " + $pipeline.Code)
    if ($pipeline.Code -eq 0) {
        $script:PipelineOk = $true
        Ok "pipeline finished; full log in pipeline.txt"
        Say (Tail $pipeline.Output 12)
    } else {
        Fail ("pipeline exited " + $pipeline.Code + "; first useful lines below, full log in pipeline.txt")
        Say (Tail $pipeline.Output 25)
    }
}

# ---------------------------------------------------------------- summary

Say ""
Say "-- summary --"
if ($script:Failures.Count -eq 0) {
    if ($script:PipelineOk) {
        Say ("RESULT: pipeline completed; artifacts are in " + (Join-Path $Project "artifacts"))
    } else {
        Say "RESULT: this machine can run the offline stages"
    }
} else {
    foreach ($problem in $script:Failures) { Say ("  * " + $problem) }
    if ($Build) {
        Say ("RESULT: " + $script:Failures.Count + " problem(s) from this run; see the logs above")
    } else {
        Say ("RESULT: " + $script:Failures.Count + " problem(s) to fix before an Unreal build")
    }
}
Save "environment.txt" ($script:Lines -join "`r`n")

if ($script:Failures.Count -gt 0) { exit 1 }
exit 0
