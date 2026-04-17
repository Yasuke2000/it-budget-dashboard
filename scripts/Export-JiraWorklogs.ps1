#Requires -Version 7.0
<#
.SYNOPSIS
    Export Jira Cloud worklogs to CSV for the IT Finance Dashboard.
.PARAMETER JiraBaseUrl
    Your Jira Cloud URL (e.g., https://yourcompany.atlassian.net)
.PARAMETER Email
    Your Jira account email
.PARAMETER ApiToken
    Jira API token (generate at id.atlassian.com/manage-profile/security/api-tokens)
.PARAMETER Projects
    Comma-separated project keys (default: ITSUP,INFRA,SEC,PROJ)
.PARAMETER OutputPath
    Output CSV path (default: ./jira-worklogs.csv)
#>
param(
    [Parameter(Mandatory=$true)][string]$JiraBaseUrl,
    [Parameter(Mandatory=$true)][string]$Email,
    [Parameter(Mandatory=$false)][string]$ApiToken,
    [string]$Projects = "ITSUP,INFRA,SEC,PROJ",
    [string]$DateFrom = (Get-Date -Month 1 -Day 1 -Format "yyyy-MM-dd"),
    [string]$OutputPath = "./jira-worklogs.csv"
)

if (-not $ApiToken) {
    $secureToken = Read-Host "Enter Jira API Token" -AsSecureString
    $ApiToken = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    )
}

$authBytes = [System.Text.Encoding]::UTF8.GetBytes("${Email}:${ApiToken}")
$authBase64 = [Convert]::ToBase64String($authBytes)
$headers = @{
    Authorization = "Basic $authBase64"
    Accept        = "application/json"
}

Write-Host "Connecting to Jira at $JiraBaseUrl..." -ForegroundColor Cyan

$allWorklogs = @()
$projectKeys = $Projects -split ","

foreach ($project in $projectKeys) {
    $project = $project.Trim()
    Write-Host "Fetching worklogs for project $project..." -ForegroundColor Cyan

    $jql = [Uri]::EscapeDataString("project = $project AND worklogDate >= `"$DateFrom`"")
    $url = "$JiraBaseUrl/rest/api/3/search?jql=$jql&fields=summary,worklog,project&maxResults=100"

    try {
        $response = Invoke-RestMethod -Uri $url -Headers $headers
        foreach ($issue in $response.issues) {
            foreach ($wl in $issue.fields.worklog.worklogs) {
                $started = ($wl.started -split "T")[0]
                if ($started -ge $DateFrom) {
                    $allWorklogs += [PSCustomObject]@{
                        issueKey       = $issue.key
                        issueSummary   = $issue.fields.summary
                        author         = if ($wl.author.displayName) { $wl.author.displayName } else { $wl.author.emailAddress }
                        timeSpentHours = [math]::Round($wl.timeSpentSeconds / 3600, 1)
                        started        = $started
                        project        = $project
                    }
                }
            }
        }
    } catch {
        Write-Warning "Failed to fetch $project : $_"
    }
}

Write-Host "Found $($allWorklogs.Count) worklog entries" -ForegroundColor Green
$allWorklogs | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
Write-Host "Exported to $OutputPath" -ForegroundColor Green
