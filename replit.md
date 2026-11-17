# Bağımsız Kaynaklı Ürün Bilgi Asistanı

Bu proje pnpm workspace kullanan bir React + Express RAG demosudur. Ayrıntılı teknik açıklama `docs/ARCHITECTURE_TR.md`, veri ve marka sınırları `DATA_NOTICE.md` içindedir.

## Replit üzerinde çalıştırma

- Run düğmesi `.replit` içindeki `Project` workflow'unu çalıştırır.
- Gerçek sırlar yalnızca Replit Secrets üzerinden tanımlanır.
- Zorunlu ortam değişkeni: `PORT`.
- İsteğe bağlı: `GEMINI_API_KEY`, `GEMINI_MODEL`, `DATABASE_URL`, `PERSIST_INTERACTIONS`, `CORS_ORIGIN`, `LOG_LEVEL`.
- Bilgi tabanı dosyaları `artifacts/api-server/data/kahve-dunyasi/` altına yerel olarak yüklenir ve Git'e gönderilmez.

## Geliştirici komutları

- `pnpm install --frozen-lockfile`: bağımlılıkları kurar.
- `pnpm run typecheck`: tüm TypeScript projelerini denetler.
- `pnpm run build`: frontend ve backend üretim paketlerini oluşturur.
- `pnpm --filter @workspace/api-spec run codegen`: OpenAPI istemcisi ve Zod şemalarını yeniden üretir.

## Güvenlik tercihleri

- Konuşma kaydı varsayılan olarak kapalıdır.
- CORS yalnızca `CORS_ORIGIN` açıkça tanımlanırsa açılır.
- Gemini isteğinde sağlayıcı tarafı kalıcı depolama `store: false` ile kapatılır.
- API anahtarları veya gerçek veri dosyaları hiçbir zaman commit edilmez.
