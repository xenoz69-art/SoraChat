# SoraChat — Firebase + HTML/CSS/JavaScript

Aplikasi web chat pribadi realtime dengan tampilan bersih (light dan dark otomatis mengikuti perangkat). Frontend statis, sehingga dapat di-host di Netlify tanpa VPS.

## Fitur yang tersedia
- Registrasi dan login email/password melalui Firebase Authentication.
- Daftar pengguna dan pencarian berdasarkan nama/email.
- Chat pribadi realtime dengan Firestore.
- Status online/offline dan indikator mengetik melalui Realtime Database.
- Status pesan: Terkirim, Diterima, Dibaca.
- Kirim gambar dan file kecil inline di Firestore (maksimal 300 KB per file; gambar, teks, dan PDF).
- Layout responsif untuk Android dan desktop.
- Edit nama profil dan logout.

## 1. Buat project Firebase
1. Buka https://console.firebase.google.com/ lalu buat project.
2. Di **Project settings → General → Your apps**, tambahkan aplikasi Web (`</>`).
3. Salin konfigurasi SDK ke `firebase-config.js`. Jangan mengganti nama key.
4. **Authentication → Sign-in method**: aktifkan Email/Password.
5. **Firestore Database**: buat database, lalu buka tab Rules dan salin `firestore.rules`.
6. **Realtime Database**: buat database, salin URL-nya ke `databaseURL` di config, lalu pasang isi `database.rules.json` melalui tab Rules.
7. **Storage**: aktifkan Firebase Storage (opsional, tidak dipakai pada mode gratis) dan pasang isi `storage.rules`.
8. Di **Authentication → Settings → Authorized domains**, pastikan domain Netlify dan domain pengujian kamu ditambahkan. Domain `localhost` biasanya sudah tersedia untuk pengembangan lokal.

## 2. Konfigurasi `firebase-config.js`
Ganti placeholder dengan konfigurasi dari Firebase Web App. Contoh format:

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "nama-project.firebaseapp.com",
  databaseURL: "https://nama-project-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "nama-project",
  storageBucket: "nama-project.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

Gunakan nilai asli yang disediakan Firebase Console; jangan menebak `databaseURL` atau `storageBucket`. `apiKey` Firebase Web bukan password server, tetapi Security Rules tetap wajib. Jangan menaruh service account key di frontend.

## 3. Deploy ke Netlify
Cara paling mudah:
1. Ekstrak ZIP ini.
2. Unggah folder `sorachat-firebase` ke repositori GitHub.
3. Di Netlify pilih **Add new site → Import an existing project**, hubungkan repositori.
4. Build command kosong; Publish directory `.`.
5. Deploy site. Buka domain Netlify, lalu buat dua akun berbeda untuk mencoba chat dari dua browser/perangkat.

Alternatif drag-and-drop: buka Netlify Deploy manually dan unggah isi folder proyek setelah `firebase-config.js` diisi.

## 4. Jalankan lokal
Firebase Auth memerlukan konteks web. Jalankan static server, jangan membuka `index.html` sebagai `file://`.

Contoh Python:
```bash
python -m http.server 8080
```
Lalu buka `http://localhost:8080`. Bisa juga gunakan extension Live Server.

## Catatan penting dan batasan
- Aplikasi ini adalah starter project fungsional, bukan pengganti audit keamanan WhatsApp. Pesan **tidak** dienkripsi end-to-end; Firebase menggunakan HTTPS/TLS saat transit dan aturan akses database.
- Untuk deployment publik, tinjau Security Rules, batasi ukuran/jenis file, atur kuota/billing Firebase, dan uji aturan di Firebase Rules Playground/Emulator.
- Daftar pengguna hanya memuat profil yang terdaftar dan dapat dibaca pengguna yang login; pertimbangkan Cloud Functions/server-side user search jika aplikasi tumbuh besar.
- Status online diperbarui saat koneksi aktif. Browser mobile dapat menangguhkan tab di background, sehingga status online bukan jaminan aktivitas real-time.
- Notifikasi push, pemulihan password UI, blokir pengguna, hapus akun, grup, dan panggilan suara/video belum termasuk.
- Status delivered/read bergantung pada koneksi perangkat penerima. UI memakai batas riwayat 300 pesan per chat untuk menjaga performa.
- Mode gratis tidak menggunakan Firebase Storage (opsional, tidak dipakai pada mode gratis). Lampiran kecil disimpan inline di dokumen Firestore; ini menghabiskan kuota baca/tulis dan penyimpanan Firestore, sehingga bukan solusi untuk file besar atau volume tinggi.

## Mode gratis tanpa Firebase Storage
Karena Firebase Console pada project ini meminta upgrade Blaze untuk Storage, versi ini tidak memanggil Firebase Storage. Lampiran kecil disimpan sebagai data URL di dokumen pesan Firestore. Batas 300 KB per file mengurangi risiko melewati batas dokumen Firestore, tetapi lampiran menggunakan kuota database dan dapat membuat biaya/kuota meningkat jika trafik tinggi. Untuk penggunaan nyata, pertimbangkan mengirim tautan eksternal daripada menyimpan file besar. Setelah memperbarui rules, publish `firestore.rules` lagi.
