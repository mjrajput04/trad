@echo off
setlocal enabledelayedexpansion

echo Fetching CONIDs from IBKR Client Portal...
echo.

REM First, authenticate and save cookies
curl -k -c cookies.txt -s https://localhost:5000/v1/api/iserver/auth/status > nul

REM Define symbols
set symbols=AAPL MSFT NVDA GOOGL GOOG AMZN META TSLA NFLX AMD INTC ORCL ADBE CRM JPM V MA BAC WFC GS AXP UNH JNJ PFE ABBV LLY TMO AVGO BA CAT GE XOM CVX WMT HD PG KO PEP COST DIS VZ T CSCO NEE QCOM TXN INTU IBM BABA HON ACN

echo export const CONIDS: Record^<string, number^> = {

for %%s in (%symbols%) do (
    echo   Fetching %%s...
    curl -k -b cookies.txt -s "https://localhost:5000/v1/api/iserver/secdef/search?symbol=%%s&name=false&secType=STK" > temp_%%s.json
    
    REM Extract CONID from JSON (first result)
    for /f "tokens=2 delims=:" %%a in ('findstr /r "\"conid\":" temp_%%s.json 2^>nul ^| head -1') do (
        set conid=%%a
        set conid=!conid:"=!
        set conid=!conid:,=!
        set conid=!conid: =!
        if not "!conid!"=="" (
            echo   %%s: !conid!, // Found
        ) else (
            echo   // %%s: NOT_FOUND
        )
    )
    
    del temp_%%s.json 2>nul
    timeout /t 1 /nobreak >nul
)

echo };

REM Cleanup
del cookies.txt 2>nul

echo.
echo Done! Copy the output above to your CONIDS object.