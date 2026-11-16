@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js belum terpasang. Unduh versi LTS di https://nodejs.org lalu jalankan file ini lagi. & pause & exit /b 1)
echo Memasang dependensi, tunggu sebentar...
call npm install || (echo npm install gagal. & pause & exit /b 1)
echo.
echo Situs berjalan di http://localhost:3000  (tutup jendela ini untuk menghentikan)
start "" http://localhost:3000
call npm start
pause
