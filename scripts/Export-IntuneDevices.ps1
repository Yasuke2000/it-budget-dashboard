#Requires -Version 7.0
<#
.SYNOPSIS
    Export Intune managed devices to CSV for the IT Finance Dashboard.

.DESCRIPTION
    Connects to Microsoft Graph API and exports all Intune managed devices,
    including device metadata, compliance state, and calculated device age.

.PARAMETER TenantId
    Azure AD tenant GUID

.PARAMETER ClientId
    App registration client ID

.PARAMETER ClientSecret
    App registration client secret (will prompt securely if not provided)

.PARAMETER OutputPath
    Path for the output CSV file (default: ./intune-devices.csv)

.EXAMPLE
    .\Export-IntuneDevices.ps1 -TenantId "your-tenant-id" -ClientId "your-client-id"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$TenantId,

    [Parameter(Mandatory=$true)]
    [string]$ClientId,

    [Parameter(Mandatory=$false)]
    [string]$ClientSecret,

    [string]$OutputPath = "./intune-devices.csv"
)

if (-not $ClientSecret) {
    $secureSecret = Read-Host "Enter Client Secret" -AsSecureString
    $ClientSecret = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
    )
}

Write-Host "Connecting to Microsoft Graph..." -ForegroundColor Cyan

$tokenUrl = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
$tokenBody = @{
    grant_type    = "client_credentials"
    client_id     = $ClientId
    client_secret = $ClientSecret
    scope         = "https://graph.microsoft.com/.default"
}

try {
    $tokenResponse = Invoke-RestMethod -Uri $tokenUrl -Method POST -Body $tokenBody -ContentType "application/x-www-form-urlencoded"
    $accessToken = $tokenResponse.access_token
    Write-Host "Authenticated." -ForegroundColor Green
}
catch {
    Write-Error "Authentication failed: $_"
    exit 1
}

$headers = @{
    Authorization = "Bearer $accessToken"
    Accept        = "application/json"
}

Write-Host "Fetching Intune devices..." -ForegroundColor Cyan

$allDevices = @()
$selectFields = @(
    "deviceName"
    "model"
    "manufacturer"
    "serialNumber"
    "osVersion"
    "operatingSystem"
    "enrolledDateTime"
    "complianceState"
    "managedDeviceOwnerType"
    "chassisType"
    "userPrincipalName"
    "userDisplayName"
) -join ","

$url = "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?`$select=$selectFields"

$hasMore = $true
while ($hasMore) {
    try {
        $response = Invoke-RestMethod -Uri $url -Headers $headers

        foreach ($dev in $response.value) {
            $enrolledDate = [DateTime]::Parse($dev.enrolledDateTime)
            $ageYears     = [math]::Round(((Get-Date) - $enrolledDate).TotalDays / 365.25, 1)

            $allDevices += [PSCustomObject]@{
                deviceName             = $dev.deviceName
                model                  = $dev.model
                manufacturer           = $dev.manufacturer
                serialNumber           = $dev.serialNumber
                osVersion              = $dev.osVersion
                operatingSystem        = $dev.operatingSystem
                enrolledDateTime       = $dev.enrolledDateTime
                complianceState        = $dev.complianceState
                managedDeviceOwnerType = $dev.managedDeviceOwnerType
                chassisType            = if ($dev.chassisType) { $dev.chassisType } else { "unknown" }
                ageYears               = $ageYears
                assignedUser           = if ($dev.userDisplayName) { $dev.userDisplayName } else { $dev.userPrincipalName }
            }
        }

        if ($response.'@odata.nextLink') {
            $url = $response.'@odata.nextLink'
        }
        else {
            $hasMore = $false
        }
    }
    catch {
        Write-Error "Error fetching devices: $_"
        exit 1
    }
}

Write-Host "Found $($allDevices.Count) devices" -ForegroundColor Green

$allDevices | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
Write-Host "Exported to $OutputPath" -ForegroundColor Green
