# Ruang Kerja VFIX 0.3.6

## Perbaikan input IDE ketika jendela dimaksimalkan
- Memisahkan operasi native embedding dari operasi resize; perubahan ukuran tidak lagi memasang ulang parent/style jendela IDE berulang kali.
- Saat ukuran berubah, jendela IDE hanya disesuaikan dengan area client Ruang Kerja dan digambar ulang tanpa merebut fokus keyboard.
- Saat IDE dibuka atau Ruang Kerja kembali aktif melalui Alt+Tab, aplikasi memasang ulang fokus keyboard native pada jendela IDE dengan bantuan Win32 input-thread attachment.
- Layout IDE dijadwalkan ulang setelah maximize, unmaximize, restore, dan resize agar ukuran child window mengikuti area host.

## File browser real-time
- Menambahkan watcher filesystem lokal khusus File browser, terpisah dari watcher sinkronisasi kolaborasi.
- File, folder baru, penghapusan, atomic save, serta penulisan hasil sinkronisasi memicu refresh otomatis setelah debounce singkat.
- FileTab berlangganan event perubahan file dan memindai ulang metadata aktual segera setelah ada perubahan; tidak lagi bergantung hanya pada perubahan state sinkronisasi.
- Memperbaiki konversi timestamp untuk daftar projectFiles agar epoch millisecond tidak dikalikan 1000 menjadi tanggal yang keliru.
- Watcher berhenti saat keluar dari ruangan dan aktif kembali untuk folder proyek baru.

## Catatan pengujian
- Typecheck dan build CI memvalidasi kompilasi, tetapi input terminal VS Code pada layar maximized serta perubahan mtime dari editor harus diuji langsung pada Windows.
- Native embedding tetap bergantung pada dukungan setiap IDE terhadap window parenting Windows.
