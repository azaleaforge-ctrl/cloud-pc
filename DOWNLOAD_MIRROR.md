# Download mirror untuk Ruang Kerja

Rilis tetap diterbitkan di GitHub. Bila download GitHub lambat untuk sebagian ISP, workflow dapat mengunggah installer dan blockmap yang sama ke Cloudflare R2 dan mengarahkan URL installer di `latest.yml` ke mirror publik tersebut.

## Persiapan satu kali

1. Buat bucket di Cloudflare R2.
2. Aktifkan public access untuk bucket dan gunakan custom domain atau public R2 URL. Pastikan URL dapat diakses tanpa login dan mendukung file besar, HEAD/GET, serta HTTP Range requests; differential download membutuhkan Range.
3. Buat R2 API token dengan izin Object Read/Write hanya pada bucket download tersebut. Simpan Access Key ID dan Secret Access Key sebagai GitHub Actions secrets.
4. Di GitHub repository, buka **Settings → Secrets and variables → Actions → New repository secret**, lalu tambahkan:

| Secret | Isi |
| --- | --- |
| `CLOUDFLARE_R2_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_R2_BUCKET` | Nama bucket |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | R2 access key ID |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 secret access key |
| `CLOUDFLARE_R2_PUBLIC_BASE_URL` | URL publik bucket, mis. `https://downloads.example.com`, tanpa slash di akhir |

Jangan masukkan kredensial ke file kode atau workflow. Workflow membaca secrets dari GitHub Actions dan tidak mencetak nilainya di log.

## Cara kerjanya

Ketika kelima secrets terisi, workflow Release:
- mengunggah installer, blockmap, dan `latest.yml` ke prefix `vX.Y.Z/` di R2;
- mengubah `files[].url` di metadata update GitHub menjadi URL absolut mirror;
- menampilkan link mirror di catatan rilis;
- tetap melampirkan installer resmi ke GitHub Release sebagai fallback manual.

Jika secrets belum dikonfigurasi, workflow tidak gagal dan menggunakan GitHub saja. Tidak ada mirror eksternal yang aktif sampai bucket publik dan secrets benar-benar diatur.

## Verifikasi setelah release

- Buka link installer mirror pada catatan release; pastikan file diunduh dari domain mirror.
- Periksa respons HTTP bahwa ukuran file benar dan `Accept-Ranges: bytes` tersedia.
- Pastikan metadata `latest.yml` berisi URL installer mirror dan nilai `sha512`/ukuran tetap sama dengan hasil build.
- Uji updater dari aplikasi yang terpasang. Jangan mengasumsikan auto-update berhasil hanya karena upload mirror berhasil.
