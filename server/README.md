# Hide and Seek 3D — Online Sunucu (aynı Wi-Fi)

Sunucuyu **kendi bilgisayarında** çalıştırıyorsun, arkadaşın aynı Wi-Fi'dan bağlanıyor.
Ekstra paket gerekmez, sadece Node.js.

---

## 1) Sunucuyu başlat

```bash
cd server
node index.js
```

Konsolda şunu göreceksin:

```
🎮 Hide and Seek 3D — Online Sunucu
────────────────────────────────────
Yerel:  http://localhost:8080
API:    http://localhost:8080/api/health

AYNI WI-FI ILE OYNAMAK ICIN:
-->  http://192.168.1.25:8080     (Wi-Fi)
```

**Sen:** `http://localhost:8080` aç  
**Arkadaşın:** `http://192.168.1.25:8080` aç (kendi çıkan IP'yi kullan)

> IP her açılışta konsolda yazıyor, elle aramana gerek yok.

---

## 2) Oyun içinde

1. Menüde **🌐 Online** → **Oda Oluştur**
2. Çıkan **6 haneli kodu** arkadaşına söyle (örn. `K7M2QX`)
3. Arkadaşın aynı adresi açar → **🌐 Online** → kodu girer → **Katıl**
4. Oda sahibi **▶ Maçı Başlat**'a basar
5. Roller dağıtılır: 1 ebe, geri kalanlar saklanan

---

## 3) Sorun giderme

| Sorun | Çözüm |
|---|---|
| Arkadaşın adresi açamıyor | **Windows Güvenlik Duvarı** sorduğunda "Özel ağlara izin ver" seç. Sonradan: Windows Güvenlik Duvarı → Gelişmiş → Gelen Kuralları → Yeni Kural → Bağlantı Noktası → TCP → 8080 |
| "Sunucu yok" yazıyor | Sunucu çalışıyor mu? `node index.js` konsolda açık mı? |
| IP yanlış görünüyor | Konsolda birden fazla IP varsa **Wi-Fi** yazanı kullan |
| Aynı Wi-Fi'da değilsiniz | Mobil veri kapat, aynı modem ağına bağlan |
| Farklı ağlar (biri evde biri dışarda) | Aşağıdaki ngrok bölümü |

---

## 4) Farklı ağlardan (internet üzerinden)

### ngrok (en kolay)
```bash
npm install -g ngrok
ngrok http 8080
```
Sana `https://abc123.ngrok-free.app` verir → bunu paylaş.

### Cloudflare Tunnel
```bash
cloudflared tunnel --url http://localhost:8080
```

### Port yönlendirme
Modem arayüzü → Port Yönlendirme → TCP 8080 → bilgisayarının IP'si (`192.168.x.x`)
Dış IP'ni [whatismyip.com](https://whatismyip.com) adresinden öğren.

---

## 5) Port değiştirme

```bash
PORT=3000 node index.js
```

---

## API

| Uç nokta | Görev |
|---|---|
| `GET /api/health` | Sunucu canlı mı |
| `GET /api/rooms` | Açık odalar |
| `POST /api/room/create` | Oda oluştur |
| `POST /api/room/join` | Odaya katıl |
| `POST /api/room/start` | Maçı başlat (sadece oda sahibi) |
| `POST /api/room/position` | Konum gönder |
| `GET /api/room/state` | Oda durumu (0.7 sn'de bir) |

- Maksimum 8 oyuncu / oda
- 4+ oyuncuda 2 ebe
- 1 dakika hareketsiz oyuncu atılır

---

## Sunucu olmadan

Oyun çevrimdışı da tam çalışır:
botlarla tek kişilik, veya **👥 2 Oyuncu** ile aynı klavyede iki kişi.
