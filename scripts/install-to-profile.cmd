@echo off
setlocal
rem Copy the plugin from the workspace into the desktop profile.
rem Plain ASCII only: cmd.exe reads .cmd in the OEM code page, so non-ASCII
rem characters here would corrupt the lines that follow them.
set "SRC=C:\Users\Administrator\.dsh\bot\workspace\plugins\dsh-bot-team-tab"
set "DST=C:\Users\Administrator\.dsh\profiles\desktop\node_modules\dsh-bot-team-tab"

if not exist "%DST%\lib" mkdir "%DST%\lib"
if not exist "%DST%\docs" mkdir "%DST%\docs"

copy /Y "%SRC%\lib\client.js" "%DST%\lib\client.js" >nul || goto :fail
copy /Y "%SRC%\lib\index.js" "%DST%\lib\index.js" >nul || goto :fail
copy /Y "%SRC%\package.json" "%DST%\package.json" >nul || goto :fail
copy /Y "%SRC%\README.md" "%DST%\README.md" >nul || goto :fail
copy /Y "%SRC%\cordis.patch.yml" "%DST%\cordis.patch.yml" >nul || goto :fail
copy /Y "%SRC%\docs\*.md" "%DST%\docs" >nul || goto :fail

echo.
echo   Copied to %DST%
echo.
findstr /C:"version" "%DST%\package.json"
echo.
echo   Expected: "version": "0.3.0" and lib\client.js about 463 lines.
echo   Then fully quit DSH (not a page reload) and start it again.
echo.
pause
exit /b 0

:fail
echo.
echo   Copy failed. Close DSH completely, then run this again.
echo.
pause
exit /b 1
