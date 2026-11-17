# Mimari ve kod akışı

Bu belge, projeyi ilk kez açan bir geliştiricinin her ana parçanın ne yaptığını ve neden var olduğunu anlayabilmesi için hazırlanmıştır.

## 1. Genel yapı

Proje bir pnpm workspace'tir ve dört ana katmandan oluşur:

```text
Kullanıcı arayüzü (React + Vite)
        ↓ /api/rag/*
HTTP API (Express + Zod)
        ↓
Yerel arama motoru (BM25 + TF-IDF + RRF)
        ↓
Yetkili JSONL bilgi tabanı
        ↓ isteğe bağlı
Gemini ile kaynaklara bağlı cevap üretimi
```

- `artifacts/kahve-dunyasi-rag/`: Tarayıcıda çalışan React arayüzü.
- `artifacts/api-server/`: HTTP API, bilgi getirme ve cevap üretme katmanı.
- `lib/api-spec/`: API'nin OpenAPI sözleşmesi.
- `lib/api-zod/`: İstek ve cevapların çalışma anında doğrulanması.
- `lib/api-client-react/`: OpenAPI sözleşmesinden üretilen React istemcisi.
- `lib/db/`: İsteğe bağlı konuşma kaydı için Drizzle şeması.
- `examples/knowledge-base/`: Gerçek marka verisi içermeyen sentetik JSONL örnekleri.

## 2. Kullanıcı arayüzü neden ayrı?

`artifacts/kahve-dunyasi-rag/src/App.tsx` sayfanın ana bileşenidir. Kullanıcı sorusunu toplar, API istemcisini çağırır ve cevabın yanında kullanılan kaynakları gösterir. Arayüzün API'den ayrılması şu faydaları sağlar:

- Sunucu anahtarları hiçbir zaman tarayıcı paketine girmez.
- Arama ve cevap üretme mantığı kullanıcı tarafından değiştirilemez.
- Aynı API ileride başka bir arayüz tarafından da kullanılabilir.

`src/components/ui/` altındaki dosyalar tekrar kullanılabilir görsel bileşenlerdir. `src/index.css` renk, tipografi ve yerleşimi tanımlar. `vite.config.ts`, geliştirme ve üretim paketleme ayarlarını taşır.

## 3. API nasıl başlıyor?

1. `artifacts/api-server/src/index.ts`, `PORT` değerini kontrol eder ve Express sunucusunu başlatır.
2. `src/app.ts`, güvenli HTTP günlüğünü, JSON gövde ayrıştırmayı ve `/api` yönlendirmesini kurar.
3. Çapraz alan erişimi varsayılan olarak kapalıdır. Yalnızca `CORS_ORIGIN` tanımlanırsa listedeki adreslere izin verilir.
4. `src/routes/index.ts`, sağlık ve RAG uçlarını ana yönlendiriciye bağlar.

## 4. Bilgi tabanı neden iki JSONL dosyası kullanıyor?

API şu iki yerel dosyayı okur:

```text
artifacts/api-server/data/kahve-dunyasi/clean_documents.jsonl
artifacts/api-server/data/kahve-dunyasi/clean_chunks.jsonl
```

`clean_documents.jsonl` kaynak belge düzeyindeki kayıtları tutar. Belge sayısı ve kaynak kapsamı gibi metriklerde kullanılır. `clean_chunks.jsonl` ise uzun belgeleri aranabilir küçük parçalara ayırır. Her satır bağımsız JSON olduğu için büyük dosyanın tamamını tek bir JSON dizisi olarak düzenlemek gerekmez.

Gerçek dosyalar telif, marka ve veri kaynağı koşulları nedeniyle GitHub deposunda bulunmaz. `.gitignore` bunları engeller. Şema, sentetik `examples/knowledge-base/*.example.jsonl` dosyalarında gösterilir.

## 5. Arama motoru nasıl çalışıyor?

`artifacts/api-server/src/lib/rag-engine.ts` şu işleri yapar:

1. Sunucu başlarken JSONL satırlarını UTF-8 olarak okur ve doğrulanabilir nesnelere çevirir.
2. Türkçe metni küçük harfe indirger, kelimelere ayırır ve sık kullanılan dolgu kelimelerini eler.
3. Her bilgi parçası için terim sıklıklarını ve belge sıklıklarını hesaplar.
4. Soruyu hem BM25 hem TF-IDF ile puanlar.
5. İki sıralamayı RRF (Reciprocal Rank Fusion) ile birleştirir.
6. Başlık, bölüm ve yaklaşık kelime eşleşmelerine ek ağırlık verir.
7. Aynı kaynaktaki komşu parçaları sınırlı bir metin bütçesi içinde birleştirir.
8. En ilgili ve birbirini gereksiz tekrarlamayan kaynak parçalarını döndürür.

Bu yerel arama katmanı önemlidir; bütün bilgi tabanını modele göndermek yerine yalnızca soruyla ilgili parçalar gönderilir. Böylece maliyet azalır ve ilgisiz içerikten kaynaklanan yanlış cevap riski düşer.

## 6. Soru API'de nasıl işleniyor?

`POST /api/rag/ask` akışı `src/routes/rag.ts` içindedir:

1. İstek `AskRagQuestionBody` Zod şemasıyla doğrulanır.
2. `retrieveChunks` soruyla ilgili en iyi kaynakları getirir.
3. Eşleşme yoksa sistem açıkça bilgi bulunamadığını söyler.
4. `GEMINI_API_KEY` varsa yalnızca getirilen kaynak parçaları Gemini'ye gönderilir.
5. Model cevap veremezse veya anahtar yoksa `buildExtractiveAnswer` kaynak cümlelerinden doğrudan cevap oluşturur.
6. Her kaynak `K1`, `K2` biçiminde işaretlenir ve tıklanabilir URL ile istemciye döner.
7. Cevap, üretilme yöntemiyle birlikte `llm`, `extractive` veya `no_match` olarak etiketlenir.

Bu tasarımda LLM tek hata noktası değildir. Harici servis veya kota sorunu yaşansa bile yerel, kaynak temelli mod çalışmaya devam eder.

## 7. Model çağrısındaki güvenlik tercihleri

`src/lib/rag-assistant.ts`:

- modele yalnızca getirilen kaynaklara dayanmasını söyler;
- ürün varyantlarını karıştırmama kuralı uygular;
- konuşma geçmişini son altı mesajla sınırlar;
- uzun kaynakları belirli karakter sınırında keser;
- geçici sunucu hatalarında sınırlı tekrar dener;
- API anahtarını hata günlüğünden temizler;
- sağlayıcı tarafında kalıcı kayıt istememek için `store: false` gönderir.

Bu önlemler hatayı azaltır ancak model cevaplarının doğruluğunu garanti etmez. Fiyat, içerik, alerjen veya sağlıkla ilgili bilgiler resmî kaynak ve ürün ambalajından doğrulanmalıdır.

## 8. Konuşmalar neden varsayılan olarak kaydedilmiyor?

`src/lib/rag-persistence.ts`, ancak aşağıdaki iki koşul birlikte sağlanırsa kayıt yapar:

```text
PERSIST_INTERACTIONS=true
DATABASE_URL: <geçerli bağlantı>
```

Varsayılanın kapalı olması, projeyi deneyen kişinin farkında olmadan kullanıcı sorusu toplamasını önler. Kayıt açılacaksa aydınlatma, veri minimizasyonu, erişim yetkisi, saklama süresi ve silme yöntemi ayrıca tasarlanmalıdır.

## 9. API sözleşmesi ve üretilen kod

`lib/api-spec/openapi.yaml` uçların kaynak sözleşmesidir. Orval bu sözleşmeden:

- `lib/api-client-react/src/generated/` altında istemci fonksiyonlarını;
- `lib/api-zod/src/generated/` altında doğrulama şemalarını

üretir. Üretilen dosyalar elle değiştirilmemelidir; sözleşme değiştiğinde kod üretme komutu yeniden çalıştırılmalıdır.

## 10. Ortam değişkenleri

| Değişken | Zorunlu mu? | Amaç |
|---|---:|---|
| `PORT` | Evet | API'nin dinleyeceği port |
| `GEMINI_API_KEY` | Hayır | LLM ile kaynaklara bağlı doğal cevap |
| `GEMINI_MODEL` | Hayır | Kullanılacak model; varsayılan kodda tanımlıdır |
| `DATABASE_URL` | Hayır | İsteğe bağlı konuşma veritabanı |
| `PERSIST_INTERACTIONS` | Hayır | Tam olarak `true` ise konuşma kaydını açar |
| `CORS_ORIGIN` | Hayır | Virgülle ayrılmış izinli frontend adresleri |
| `LOG_LEVEL` | Hayır | Sunucu günlük seviyesi |

Gerçek değerler `.env` dosyasına veya Replit Secrets'a yazılmalıdır. `.env.example` yalnızca boş şablondur.

## 11. Hukuki ve operasyonel sınır

Kodun MIT lisansı, üçüncü taraf veri ve marka unsurları için izin vermez. Kamuya açılan depoda gerçek tarama verileri, logolar, ürün fotoğrafları, uzun üçüncü taraf metinleri ve kullanıcı kayıtları bulunmamalıdır. Ayrıntılı kontrol listesi `DATA_NOTICE.md` içindedir.

Bu teknik önlemler hukuki uygunluk garantisi değildir. Veri toplama veya marka odaklı kamuya açık/ticari yayın öncesinde kullanım koşulları ve uygulanabilir mevzuat uzman hukukçu tarafından değerlendirilmelidir.
