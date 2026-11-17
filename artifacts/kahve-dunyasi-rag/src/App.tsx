import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowUp,
  CircleHelp,
  ExternalLink,
  Link2,
  RotateCcw,
  X,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  type RagSource,
  useAskRagQuestion,
  useGetRagMeta,
  useGetRagSuggestions,
} from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

type ChatRole = 'user' | 'assistant';
type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  sources?: RagSource[];
  retrievalCount?: number;
  answerMode?: 'llm' | 'extractive' | 'no_match';
  isError?: boolean;
};

const welcomeMessage: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    "Merhaba. Kahve Dünyası'nın kamuya açık kaynaklarında yer alan bilgiler hakkında soru sorabilirsiniz.\n\nYanıt verirken kullandığım kaynakları aşağıda doğrudan bağlantılarıyla göstereceğim.",
};


const questionCategories = [
  {
    title: 'Ürünler & içerikler',
    description: 'Kahve, çikolata ve diğer ürünlerin içerik, özellik ve saklama bilgilerini sorun.',
    example: "Damla sakızlı 2'si 1 arada kahvenin içeriğinde ne var?",
    sourceLabel: 'Kahve ürünleri',
    sourceUrl: 'https://www.kahvedunyasi.com/kahve-c-40',
  },
  {
    title: 'Alerjen & besin bilgisi',
    description: 'Ürünlerdeki süt, soya, fındık gibi alerjenleri ve mevcut besin değerlerini sorgulayın.',
    example: "Damla sakızlı 2'si 1 arada hazır kahvede süt veya soya alerjeni var mı?",
    sourceLabel: 'Çikolata ürünleri',
    sourceUrl: 'https://www.kahvedunyasi.com/cikolata-c-46',
  },
  {
    title: 'Alışveriş & üyelik',
    description: 'Üyelik, sipariş ve alışveriş süreçleriyle ilgili SSS içeriklerinden yanıt alın.',
    example: 'Üye olmadan alışveriş yapabilir miyim?',
    sourceLabel: 'Sıkça sorulan sorular',
    sourceUrl: 'https://www.kahvedunyasi.com/sikca-sorulan-sorular',
  },
  {
    title: 'Blog & kahve kültürü',
    description: 'Kahve, çikolata, tarifler ve Kahve Dünyası blog içerikleri hakkında soru sorun.',
    example: 'Kahve Dünyası blogunda filtre kahve hakkında hangi bilgiler var?',
    sourceLabel: 'Blog',
    sourceUrl: 'https://www.kahvedunyasi.com/blog',
  },
  {
    title: 'Kurumsal & üretim',
    description: 'Hikâye, üretim, kariyer, atölyeler ve kurumsal çözümler gibi konuları keşfedin.',
    example: 'Kahve Dünyası üretim sürecini nasıl anlatıyor?',
    sourceLabel: 'Hikayemiz',
    sourceUrl: 'https://www.kahvedunyasi.com/hikayemiz',
  },
  {
    title: 'Sürdürülebilirlik & franchise',
    description: 'Sürdürülebilirlik raporları ve uluslararası franchise bilgileri üzerinden soru sorun.',
    example: 'Kahve Dünyası sürdürülebilirlik konusunda neler yapıyor?',
    sourceLabel: 'Franchise',
    sourceUrl: 'https://www.kahvedunyasi.com/franchise',
  },
];

const knowledgeBaseItems = [
  {
    count: '162',
    title: 'Ürün sayfası',
    description: 'Kahve, çikolata, aksesuar ve diğer ürün sayfaları.',
    links: [
      { label: 'Kahve', url: 'https://www.kahvedunyasi.com/kahve-c-40' },
      { label: 'Çikolata', url: 'https://www.kahvedunyasi.com/cikolata-c-46' },
    ],
  },
  {
    count: '30',
    title: 'Blog içeriği',
    description: 'Kahve, çikolata, tarif ve marka içerikleri.',
    links: [{ label: 'Blogu aç', url: 'https://www.kahvedunyasi.com/blog' }],
  },
  {
    count: '11',
    title: 'Kurumsal sayfa',
    description: 'Hikâye, üretim, kariyer, atölyeler ve kurumsal hediyeler.',
    links: [
      { label: 'Hikayemiz', url: 'https://www.kahvedunyasi.com/hikayemiz' },
      { label: 'Üretim', url: 'https://www.kahvedunyasi.com/uretim' },
      { label: 'Kariyer', url: 'https://www.kahvedunyasi.com/kariyer' },
      { label: 'Atölye', url: 'https://www.kahvedunyasi.com/atolye' },
      { label: 'Kurumsal hediyeler', url: 'https://www.kahvedunyasi.com/kurumsal-hediyeler' },
    ],
  },
  {
    count: '1',
    title: 'SSS sayfası',
    description: 'Üyelik, alışveriş ve sipariş süreçleri.',
    links: [{ label: 'SSS', url: 'https://www.kahvedunyasi.com/sikca-sorulan-sorular' }],
  },
  {
    count: '1',
    title: 'Franchise sayfası',
    description: 'Uluslararası franchise koşulları ve başvuru bilgileri.',
    links: [{ label: 'Franchise', url: 'https://www.kahvedunyasi.com/franchise' }],
  },
  {
    count: '3',
    title: 'Genel sayfa',
    description: 'Ana sayfa, dondurma ve sözleşmeler gibi genel içerikler.',
    links: [
      { label: 'Ana sayfa', url: 'https://www.kahvedunyasi.com/' },
      { label: 'Dondurma', url: 'https://www.kahvedunyasi.com/dondurma' },
      { label: 'Sözleşmeler', url: 'https://www.kahvedunyasi.com/sozlesmeler' },
    ],
  },
  {
    count: '4 PDF / 89 sayfa',
    title: 'PDF dokümanları',
    description: 'Sürdürülebilirlik, Rainforest belgesi ve kurumsal hediye katalogları.',
    links: [
      { label: 'Sürdürülebilirlik', url: 'https://kd-prod.sm.mncdn.com/ui-config/about-us/sustainability_tr.pdf' },
      { label: 'Rainforest', url: 'https://kd-prod.sm.mncdn.com/ui-config/about-us/rainforest_doc.pdf' },
      { label: 'Kahve kataloğu', url: 'https://kd-prod.sm.mncdn.com/ui-config/corporate-gifts/kahve.pdf' },
      { label: 'Çikolata kataloğu', url: 'https://kd-prod.sm.mncdn.com/ui-config/corporate-gifts/cikolata.pdf' },
    ],
  },
];

const architecture = [
  ['01', 'Temizlenmiş veri', 'Kaynak sayfalarındaki içerik temizlenir; başlık ve kaynak bağlantıları korunur.'],
  ['02', 'TF-IDF araması', 'Başlık ve içerikte sorudaki terimlerle örtüşen bilgi parçaları sıralanır.'],
  ['03', 'BM25 araması', 'Ürün adı, alerjen ve özel terimler kelime tabanlı aramayla bulunur.'],
  ['04', 'Sıralamaları birleştirme', 'İki arama yönteminin sonuçları RRF ile tek bir sıralamada buluşur.'],
  ['05', 'Kaynak seçimi', 'En ilgili altı bilgi parçası yanıt için bağlam olarak kullanılır.'],
  ['06', 'Kaynaklı yanıt', 'Gemini seçilen kaynaklara dayanır; erişilemezse yanıt doğrudan kaynak cümlelerinden oluşturulur.'],
];

function answerParts(text: string, sources: RagSource[] | undefined, onCitation: (index: number) => void) {
  return text.split(/(\[K\d+\])/g).map((part, index) => {
    const match = part.match(/^\[K(\d+)\]$/);
    if (!match) return <span key={`answer-part-${index}`}>{part}</span>;
    const sourceIndex = Number(match[1]) - 1;
    const hasSource = Boolean(sources?.[sourceIndex]);
    return (
      <button
        className="citation-chip"
        type="button"
        key={`citation-${index}`}
        data-testid={`button-citation-${sourceIndex + 1}`}
        aria-label={`${match[0]} kaynağına git`}
        disabled={!hasSource}
        onClick={() => onCitation(sourceIndex)}
      >
        {match[0]}
      </button>
    );
  });
}

function Metric({
  value,
  label,
  loading,
  testId,
}: {
  value: string | number;
  label: string;
  loading: boolean;
  testId: string;
}) {
  return (
    <div className="metric" data-testid={testId}>
      <strong className={loading ? 'skeleton' : undefined}>{loading ? '000' : value}</strong>
      <span>{label}</span>
    </div>
  );
}

function SourcePanel({
  sources,
  highlightedSourceIndex,
  emptyMessage,
}: {
  sources: RagSource[];
  highlightedSourceIndex: number | null;
  emptyMessage?: string;
}) {
  return (
    <div className="insight-card source-preview" data-testid="panel-sources">
      <div className="card-head-row">
        <div>
          <span className="mini-label">KAYNAKLAR</span>
          <h3>Son yanıtta kullanılan kaynaklar</h3>
        </div>
        <span className="source-count" data-testid="text-source-count">{sources.length}</span>
      </div>
      {sources.length === 0 ? (
        <div className="empty-source" data-testid="empty-sources">
          <div className="empty-icon" aria-hidden="true"><Link2 size={20} strokeWidth={1.6} /></div>
          <p>{emptyMessage ?? 'Bir soru sorun; kullanılan sayfa ve dokümanlar burada görünecek.'}</p>
        </div>
      ) : (
        <div className="source-list">
          {sources.map((source, index) => (
            <a
              className={`source-card ${highlightedSourceIndex === index ? 'highlighted' : ''}`}
              id={`source-${index + 1}`}
              data-testid={`link-source-${index + 1}`}
              data-source-index={index}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              key={`${source.id}-${index}`}
            >
              <div className="source-top">
                <span className="source-ref">K{index + 1}</span>
                <span className="source-type">WEB SAYFASI</span>
              </div>
              <strong>{source.title || 'Kahve Dünyası kaynağı'}</strong>
              <small>{source.section || 'Kahve Dünyası web kaynağı'}</small>
              {source.excerpt ? <small>{source.excerpt}</small> : null}
              <span className="source-score">Alaka puanı: {source.score.toFixed(3)}</span>
              <div className="source-link">Orijinal kaynağı aç <ExternalLink size={11} aria-hidden="true" /></div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Home() {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [history, setHistory] = useState<Array<{ role: ChatRole; content: string }>>([]);
  const [sources, setSources] = useState<RagSource[]>([]);
  const [highlightedSourceIndex, setHighlightedSourceIndex] = useState<number | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(true);
  const [llmReady, setLlmReady] = useState<boolean | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const metaQuery = useGetRagMeta();
  const suggestionsQuery = useGetRagSuggestions();
  const askQuestion = useAskRagQuestion();
  const isBusy = askQuestion.isPending;

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isBusy]);

  useEffect(() => {
    if (!isAboutOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsAboutOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isAboutOpen]);

  const focusCitation = (index: number) => {
    setHighlightedSourceIndex(index);
    document.getElementById(`source-${index + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => setHighlightedSourceIndex(null), 1200);
  };

  const submitQuestion = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isBusy) return;
    const previousHistory = history.slice(-8);
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: trimmed };
    setMessages((current) => [...current, userMessage]);
    setHistory((current) => [...current, { role: 'user', content: trimmed }]);
    setQuestion('');
    try {
      const response = await askQuestion.mutateAsync({
        data: { question: trimmed, history: previousHistory },
      });
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.answer,
        sources: response.sources,
        retrievalCount: response.retrievalCount,
        answerMode: response.answerMode,
      };
      setMessages((current) => [...current, assistantMessage]);
      setHistory((current) => [...current, { role: 'assistant', content: response.answer }]);
      setSources(response.sources);

      if (response.answerMode === 'llm') {
        setLlmReady(true);
      } else if (response.answerMode === 'extractive') {
        setLlmReady(false);
      }

      void metaQuery.refetch();
    } catch {
      void metaQuery.refetch();
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          isError: true,
          content: 'Şu anda yanıt oluşturulamıyor. Lütfen biraz sonra tekrar deneyin.',
        },
      ]);
    } finally {
      inputRef.current?.focus();
    }
  };

  const resetConversation = () => {
    setHistory([]);
    setMessages([{ ...welcomeMessage, id: `welcome-${Date.now()}` }]);
    setSources([]);
    setHighlightedSourceIndex(null);
    inputRef.current?.focus();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitQuestion(question);
  };

  const meta = metaQuery.data;

  const isLlmReady =
    llmReady !== null
      ? llmReady
      : Boolean(meta?.llmAvailable);

  const statusClass = metaQuery.isError
    ? 'error'
    : meta?.isReady
      ? isLlmReady
        ? 'online'
        : 'fallback'
      : '';

  const statusText = metaQuery.isError
    ? 'Sistem Kullanılamıyor'
    : metaQuery.isLoading
      ? 'Sistem kontrol ediliyor'
      : meta?.isReady
        ? isLlmReady
          ? 'AI Hazır'
          : 'Bilgi Tabanı Hazır'
        : 'Bilgi tabanı gerekli';

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="/" data-testid="link-home" aria-label="Bağımsız bilgi asistanı ana sayfa">
          <span className="brand-mark">BA</span>
          <span className="brand-copy">
            <strong>Bağımsız Bilgi Asistanı</strong>
            <small>Kamuya açık kaynaklarla çalışan teknik demo</small>
          </span>
        </a>
        <div className="top-actions">
          <span className={`status-pill ${statusClass}`} data-testid="status-rag">
            <span className="status-dot" aria-hidden="true" /> {statusText}
          </span>
          <button className="ghost-button" type="button" data-testid="button-about" onClick={() => setIsAboutOpen(true)}>
            <CircleHelp size={14} aria-hidden="true" /> Nasıl çalışıyor?
          </button>
        </div>
      </header>

      <main className="shell">
        <section className="hero" aria-labelledby="page-title">
          <div className="eyebrow"><span /> BAĞIMSIZ VE RESMÎ OLMAYAN TEKNİK DEMO</div>
          <h1 id="page-title">Kamuya açık ürün bilgilerini keşfedin.<br /><em>Ne sorabileceğinizi bilin, cevabın kaynağını görün.</em></h1>
          <p>Ürün içerikleri ve alerjenlerden alışveriş, blog, kurumsal içerik, sürdürülebilirlik ve franchise bilgilerine kadar; yanıtlar yalnızca taranmış Kahve Dünyası kaynaklarına dayandırılır.</p>
          <div className="metrics" aria-label="Bilgi tabanı metrikleri">
            <Metric value={meta?.chunkCount ?? 802} label="bilgi parçası" loading={metaQuery.isLoading} testId="metric-chunks" />
            <Metric value={163} label="ürün sayfası" loading={false} testId="metric-products" />
            <Metric value={30} label="blog içeriği" loading={false} testId="metric-blogs" />
            <Metric value={4} label="PDF dokümanı" loading={false} testId="metric-pdfs" />
          </div>
        </section>

        <section className="discovery-grid" aria-label="Soru kategorileri ve bilgi tabanı kapsamı">
          <div className="discovery-card">
            <div className="discovery-head">
              <div>
                <span className="mini-label">NELER SORABİLİRSİNİZ?</span>
                <h2>Sorunuzu bir kategoriden başlatın</h2>
              </div>
              <span className="discovery-note">6 kategori</span>
            </div>

            <div className="category-grid">
              {questionCategories.map((category, index) => (
                <div className="category-card" key={category.title}>
                  <div className="category-number">0{index + 1}</div>
                  <strong>{category.title}</strong>
                  <p>{category.description}</p>
                  <div className="category-actions">
                    <button
                      type="button"
                      className="category-question"
                      onClick={() => void submitQuestion(category.example)}
                      disabled={isBusy}
                    >
                      Örnek soruyu sor
                    </button>
                    <a href={category.sourceUrl} target="_blank" rel="noopener noreferrer" className="category-source-link">
                      {category.sourceLabel} <ExternalLink size={11} aria-hidden="true" />
                    </a>
                  </div>
                  <small className="category-example">“{category.example}”</small>
                </div>
              ))}
            </div>
          </div>

          <div className="discovery-card knowledge-base-card">
            <div className="discovery-head">
              <div>
                <span className="mini-label">BİLGİ TABANINDA NELER VAR?</span>
                <h2>297 temiz dokümanın kapsamı</h2>
              </div>
              <span className="discovery-note">208 web + 89 PDF sayfası</span>
            </div>

            <p className="knowledge-intro">
              “Temiz doküman” tek başına soyut kalmasın diye veri setindeki içerikleri türlerine ayırdık. Aşağıdaki bağlantılar, bilgi tabanının dayandığı resmî kaynakları doğrudan açar.
            </p>

            <div className="knowledge-grid">
              {knowledgeBaseItems.map((item) => (
                <div className="knowledge-item" key={`${item.count}-${item.title}`}>
                  <div className="knowledge-item-head">
                    <strong>{item.count}</strong>
                    <span>{item.title}</span>
                  </div>
                  <p>{item.description}</p>
                  <div className="knowledge-links">
                    {item.links.map((link) => (
                      <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">
                        {link.label} <ExternalLink size={10} aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="workspace" aria-label="Bilgi asistanı çalışma alanı">
          <div className="chat-panel">
            <div className="chat-head">
              <div>
                <span className="mini-label">YAPAY ZEKÂ ASİSTANI</span>
                <h2>Bilgi Asistanı</h2>
              </div>
              <button className="icon-button" type="button" title="Konuşmayı temizle" aria-label="Konuşmayı temizle" data-testid="button-reset" onClick={resetConversation}>
                <RotateCcw size={17} aria-hidden="true" />
              </button>
            </div>

            <div className="messages" id="messages" ref={messagesRef} aria-live="polite" data-testid="list-messages">
              {messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id} data-testid={`message-${message.role}-${message.id}`}>
                  <div className="avatar" aria-hidden="true">{message.role === 'user' ? 'S' : 'AI'}</div>
                  <div className={`bubble ${message.isError ? 'error-state' : ''}`}>
                    <div className="bubble-label">{message.role === 'user' ? 'Siz' : 'Bilgi Asistanı'}</div>
                    {message.role === 'assistant' ? (
                      message.content.split(/\n{2,}/).map((paragraph, paragraphIndex) => (
                        <p key={`${message.id}-paragraph-${paragraphIndex}`}>
                          {answerParts(paragraph, message.sources, (index) => focusCitation(index))}
                        </p>
                      ))
                    ) : <p>{message.content}</p>}
                    {message.role === 'assistant' && message.retrievalCount !== undefined ? (
                      <div className="message-meta">
                        <span>{message.retrievalCount} kaynak adayı</span>
                        <span>·</span>
                        <span>
                          {message.answerMode === 'extractive'
                            ? 'doğrudan kaynak modu'
                            : message.answerMode === 'no_match'
                              ? 'eşleşme bulunamadı'
                              : 'AI + kaynaklı yanıt'}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
              {isBusy ? (
                <article className="message assistant thinking" data-testid="status-thinking">
                  <div className="avatar" aria-hidden="true">AI</div>
                  <div className="bubble">
                    <div className="bubble-label">Kaynaklar taranıyor</div>
                    <div className="thinking-line">
                      <div className="thinking-dots" aria-hidden="true"><i /><i /><i /></div>
                      <span>Kanıtlar doğrulanıp yanıt oluşturuluyor…</span>
                    </div>
                  </div>
                </article>
              ) : null}
            </div>

            {suggestionsQuery.isLoading ? (
              <div className="suggestions" aria-label="Öneriler yükleniyor" data-testid="list-suggestions-loading">
                {[1, 2, 3].map((item) => <span className="suggestion-button skeleton" key={item}>Öneri hazırlanıyor</span>)}
              </div>
            ) : suggestionsQuery.isError ? (
              <div className="suggestion-error" data-testid="status-suggestions-error">Öneriler şu anda yüklenemedi.</div>
            ) : suggestionsQuery.data?.questions?.length ? (
              <div className="suggestions" aria-label="Örnek sorular" data-testid="list-suggestions">
                {suggestionsQuery.data.questions.map((suggestion, index) => (
                  <button className="suggestion-button" type="button" data-testid={`button-suggestion-${index}`} key={`${suggestion}-${index}`} onClick={() => void submitQuestion(suggestion)} disabled={isBusy}>
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : (
              <div className="suggestion-error" data-testid="empty-suggestions">Şu anda öneri bulunmuyor.</div>
            )}

            <form className="composer" onSubmit={handleSubmit} data-testid="form-question">
              <div className="input-wrap">
                <textarea
                  ref={inputRef}
                  rows={1}
                  maxLength={2000}
                  value={question}
                  placeholder="Kahve Dünyası hakkında bir soru sorun…"
                  aria-label="Sorunuz"
                  data-testid="input-question"
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void submitQuestion(question);
                    }
                  }}
                />
                <div className="composer-hint"><span>Enter</span> gönder · <span>Shift + Enter</span> yeni satır</div>
              </div>
              <button className="send-button" type="submit" aria-label="Gönder" data-testid="button-submit-question" disabled={isBusy || !question.trim()}>
                <ArrowUp size={20} aria-hidden="true" />
              </button>
            </form>
          </div>

          <aside className="insight-panel">
              <div className="insight-card spotlight-card">
              <span className="mini-label">SİSTEM NASIL ÇALIŞIR?</span>
              <h3>Chatbot değil,<br />doğrulanabilir bilgi katmanı.</h3>
              <p>Sistem yanıt üretmeden önce hem anlamsal hem kelime bazlı arama yapar, ilgili kaynakları birleştirir ve cevabı yalnızca bu kanıtlara dayandırır.</p>
              <div className="pipeline" aria-label="Yanıt akışı"><span>Soru</span><i /><span>Karma arama</span><i /><span>Kaynak</span><i /><span>Yanıt</span></div>
            </div>
            <SourcePanel
              sources={sources}
              highlightedSourceIndex={highlightedSourceIndex}
              emptyMessage={
                messages[messages.length - 1]?.answerMode === 'no_match'
                  ? 'Bu soru için kaynak eşleşmesi bulunamadı.'
                  : undefined
              }
            />
            <div className="trust-row" aria-label="Asistan özellikleri">
              <span><b>01</b> Kaynaklı cevap</span>
              <span><b>02</b> Halüsinasyon kontrolü</span>
              <span><b>03</b> Tıklanabilir referans</span>
            </div>
          </aside>
        </section>
      </main>

      <footer className="footer">
        <p>Bağımsız teknik prototip · Yalnızca kamuya açık Kahve Dünyası kaynakları kullanılmıştır.</p>
        <p>Resmî Kahve Dünyası uygulaması değildir.</p>
        <p>Sorular yalnızca uygulama işletmecisi açıkça etkinleştirirse veritabanında saklanır.</p>
      </footer>

      {isDisclaimerOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal disclaimer-modal" role="dialog" aria-modal="true" aria-labelledby="disclaimer-title" aria-describedby="disclaimer-description" data-testid="dialog-disclaimer">
            <span className="mini-label">BİLGİLENDİRME</span>
            <h2 id="disclaimer-title">Bağımsız Demo Uygulaması</h2>
            <p id="disclaimer-description">
              Bu uygulama, RAG teknolojisini göstermek amacıyla geliştirilmiş bağımsız ve ticari olmayan bir portföy projesidir.
              Ürün bilgileri, fiyatlar ve alerjen açıklamaları güncelliğini yitirmiş olabilir.
              Güncel ve doğrulanmış bilgiler için{' '}
              <a href="https://www.kahvedunyasi.com/" target="_blank" rel="noopener noreferrer">resmî web sitesini</a>{' '}
              ziyaret ediniz.
            </p>
            <p className="disclaimer-affiliation">Bu proje Kahve Dünyası'nın resmî uygulaması değildir; marka ile herhangi bir iş birliği veya onay ilişkisi bulunmamaktadır.</p>
            <button type="button" className="disclaimer-continue" onClick={() => setIsDisclaimerOpen(false)} data-testid="button-accept-disclaimer">
              Anladım, Devam Et
            </button>
          </section>
        </div>
      ) : null}

      {isAboutOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsAboutOpen(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title" data-testid="dialog-about">
            <button className="modal-close" type="button" aria-label="Kapat" data-testid="button-close-about" onClick={() => setIsAboutOpen(false)}>
              <X size={18} aria-hidden="true" />
            </button>
            <span className="mini-label">BİLGİ GETİRME MİMARİSİ</span>
            <h2 id="about-title">Cevap nasıl oluşturuluyor?</h2>
            <div className="architecture-grid">
              {architecture.map(([number, title, description]) => (
                <div key={number}>
                  <b>{number}</b><strong>{title}</strong><span>{description}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
