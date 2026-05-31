import { useState, useEffect } from 'react';
import { Save, CheckCircle, Eye, EyeOff, ChevronDown, ExternalLink, Info, Cpu, Zap, RefreshCw } from 'lucide-react';
import type { AppSettings, GpuInfo } from '../electron.d';

const MARKETPLACES = [
  { value: 'www.amazon.com', label: 'Amazon.com (US)' },
  { value: 'www.amazon.co.uk', label: 'Amazon.co.uk (UK)' },
  { value: 'www.amazon.de', label: 'Amazon.de (Germany)' },
  { value: 'www.amazon.co.jp', label: 'Amazon.co.jp (Japan)' },
  { value: 'www.amazon.ca', label: 'Amazon.ca (Canada)' },
  { value: 'www.amazon.com.au', label: 'Amazon.com.au (Australia)' },
  { value: 'www.amazon.fr', label: 'Amazon.fr (France)' },
  { value: 'www.amazon.it', label: 'Amazon.it (Italy)' },
  { value: 'www.amazon.es', label: 'Amazon.es (Spain)' },
];

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-8 py-4 border-b border-white/5 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white/80">{label}</p>
        {description && <p className="text-xs text-white/30 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative rounded-full transition-all duration-200 flex-shrink-0`}
      style={{ width: 40, height: 22, background: checked ? '#06b6d4' : 'rgba(255,255,255,0.12)' }}
    >
      <span
        className="absolute top-0.5 left-0.5 rounded-full bg-white shadow transition-transform duration-200"
        style={{ width: 18, height: 18, transform: checked ? 'translateX(18px)' : 'translateX(0)' }}
      />
    </button>
  );
}

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative w-64">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white/5 border border-white/8 rounded-lg px-3 pr-9 py-2 text-sm text-white/70 placeholder-white/20 focus:outline-none focus:border-cyan-500/50 transition-all font-mono"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/50 transition-colors"
      >
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  );
}

const DEFAULT_SETTINGS: AppSettings = {
  paapiAccessKey: '',
  paapiSecretKey: '',
  paapiPartnerTag: '',
  paapiMarketplace: 'www.amazon.com',
  mediaBaseDir: '',
  autoSave: true,
  notifications: true,
  quality: '1080p',
  gpuMode: 'auto',
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [detectingGpu, setDetectingGpu] = useState(false);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.loadSettings().then((s) => {
        setSettings((prev) => ({ ...prev, ...s }));
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  const detectGpu = async () => {
    if (!window.electronAPI) return;
    setDetectingGpu(true);
    const info = await window.electronAPI.detectGpu();
    setGpuInfo(info);
    setDetectingGpu(false);
  };

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (window.electronAPI) {
      await window.electronAPI.saveSettings(settings);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-cyan-500/40 border-t-cyan-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>
          <p className="text-sm text-white/40 mt-1">Configure your workspace and API credentials.</p>
        </div>

        <div className="space-y-6">
          {/* Amazon PAAPI */}
          <section className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
              <div>
                <p className="text-xs font-semibold text-white/50 uppercase tracking-widest">
                  Amazon Product Advertising API
                </p>
                <p className="text-[10px] text-white/25 mt-0.5">
                  Used to fetch product titles, images, and videos. Falls back to scraping if unavailable.
                </p>
              </div>
              <a
                href="https://affiliate-program.amazon.com/assoc_credentials/home"
                className="flex items-center gap-1 text-[10px] text-cyan-400/60 hover:text-cyan-400 transition-colors"
                target="_blank"
                rel="noreferrer"
              >
                Get keys <ExternalLink size={9} />
              </a>
            </div>
            <div className="px-5">
              <SettingRow
                label="Access Key ID"
                description="Your AWS IAM access key for PAAPI authentication."
              >
                <SecretInput
                  value={settings.paapiAccessKey}
                  onChange={(v) => set('paapiAccessKey', v)}
                  placeholder="AKIAIOSFODNN7EXAMPLE"
                />
              </SettingRow>
              <SettingRow
                label="Secret Access Key"
                description="Your AWS IAM secret key. Never share this."
              >
                <SecretInput
                  value={settings.paapiSecretKey}
                  onChange={(v) => set('paapiSecretKey', v)}
                  placeholder="wJalrXUtnFEMI/K7MDENG..."
                />
              </SettingRow>
              <SettingRow
                label="Associate Partner Tag"
                description="Your Amazon Associates tracking ID (e.g. mysite-20)."
              >
                <input
                  type="text"
                  value={settings.paapiPartnerTag}
                  onChange={(e) => set('paapiPartnerTag', e.target.value)}
                  placeholder="mystore-20"
                  className="w-48 bg-white/5 border border-white/8 rounded-lg px-3 py-2 text-sm text-white/70 placeholder-white/20 focus:outline-none focus:border-cyan-500/50 transition-all"
                />
              </SettingRow>
              <SettingRow
                label="Marketplace"
                description="The Amazon marketplace your links belong to."
              >
                <div className="relative w-52">
                  <select
                    value={settings.paapiMarketplace}
                    onChange={(e) => set('paapiMarketplace', e.target.value)}
                    className="w-full appearance-none bg-white/5 border border-white/8 rounded-lg px-3 pr-8 py-2 text-sm text-white/70 focus:outline-none focus:border-cyan-500/40 cursor-pointer"
                  >
                    {MARKETPLACES.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                </div>
              </SettingRow>
            </div>
          </section>

          {/* Fallback notice */}
          <div className="flex gap-3 px-4 py-3 rounded-xl border border-amber-500/15 bg-amber-500/6">
            <Info size={14} className="text-amber-400/70 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-white/40 leading-relaxed">
              If PAAPI credentials are empty or the API fails, the system automatically falls back to
              browser-based scraping via Puppeteer. Scraping is slower and may be blocked by Amazon's
              bot-detection — providing PAAPI credentials is strongly recommended.
            </p>
          </div>

          {/* Output Settings */}
          <section className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/5">
              <p className="text-xs font-semibold text-white/50 uppercase tracking-widest">Output</p>
            </div>
            <div className="px-5">
              <SettingRow
                label="Media Library Directory"
                description="Where product images and videos are stored. Organized as media/product_N/images/ and videos/. Leave empty for default."
              >
                <input
                  type="text"
                  value={settings.mediaBaseDir}
                  onChange={(e) => set('mediaBaseDir', e.target.value)}
                  placeholder="Default: userData/media"
                  className="w-64 bg-white/5 border border-white/8 rounded-lg px-3 py-2 text-sm text-white/60 placeholder-white/20 focus:outline-none focus:border-cyan-500/50 transition-all font-mono text-xs"
                />
              </SettingRow>
              <SettingRow
                label="Default Quality"
                description="Output resolution for generated videos."
              >
                <div className="relative w-40">
                  <select
                    value={settings.quality}
                    onChange={(e) => set('quality', e.target.value)}
                    className="w-full appearance-none bg-white/5 border border-white/8 rounded-lg px-3 pr-8 py-2 text-sm text-white/70 focus:outline-none focus:border-cyan-500/50 transition-all cursor-pointer"
                  >
                    <option value="720p">720p HD</option>
                    <option value="1080p">1080p Full HD</option>
                    <option value="4k">4K Ultra HD</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                </div>
              </SettingRow>
              <SettingRow
                label="Auto-save Projects"
                description="Automatically save project state after each change."
              >
                <Toggle checked={settings.autoSave} onChange={(v) => set('autoSave', v)} />
              </SettingRow>
            </div>
          </section>

          {/* GPU Acceleration */}
          <section className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/5">
              <p className="text-xs font-semibold text-white/50 uppercase tracking-widest">GPU Acceleration</p>
              <p className="text-[10px] text-white/25 mt-0.5">Hardware encoding is 5–20x faster than CPU for video export.</p>
            </div>
            <div className="px-5">
              <SettingRow
                label="Encoder Mode"
                description="Auto detects the best available encoder on your system. Manual lets you force a specific GPU."
              >
                <div className="relative w-48">
                  <select
                    value={settings.gpuMode}
                    onChange={(e) => set('gpuMode', e.target.value as AppSettings['gpuMode'])}
                    className="w-full appearance-none bg-white/5 border border-white/8 rounded-lg px-3 pr-8 py-2 text-sm text-white/70 focus:outline-none focus:border-cyan-500/50 transition-all cursor-pointer"
                  >
                    <option value="auto">Auto (recommended)</option>
                    <option value="cpu">CPU only (libx264)</option>
                    <option value="nvidia">NVIDIA (NVENC)</option>
                    <option value="amd">AMD (AMF)</option>
                    <option value="intel">Intel (QSV)</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                </div>
              </SettingRow>

              {/* GPU probe */}
              <div className="py-4 border-b border-white/5 last:border-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white/80">Detect Hardware</p>
                    <p className="text-xs text-white/30 mt-0.5">
                      Probe FFmpeg to find the best encoder on this machine.
                    </p>
                  </div>
                  <button
                    onClick={detectGpu}
                    disabled={detectingGpu || !window.electronAPI}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 text-xs font-medium text-white/50 hover:text-white hover:border-cyan-500/30 hover:bg-cyan-500/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    {detectingGpu
                      ? <><RefreshCw size={11} className="animate-spin" /> Detecting…</>
                      : <><Zap size={11} /> Detect GPU</>
                    }
                  </button>
                </div>

                {gpuInfo && (
                  <div className={`mt-3 flex items-center gap-3 p-3 rounded-xl border ${
                    gpuInfo.type === 'cpu'
                      ? 'border-white/8 bg-white/3'
                      : 'border-cyan-500/20 bg-cyan-500/6'
                  }`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      gpuInfo.type === 'cpu' ? 'bg-white/8' : 'bg-cyan-500/15'
                    }`}>
                      {gpuInfo.type === 'cpu'
                        ? <Cpu size={14} className="text-white/40" />
                        : <Zap size={14} className="text-cyan-400" />
                      }
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${gpuInfo.type === 'cpu' ? 'text-white/60' : 'text-cyan-300'}`}>
                        {gpuInfo.label}
                      </p>
                      <p className="text-[10px] text-white/30 mt-0.5">
                        {gpuInfo.type === 'cpu'
                          ? 'No GPU encoder found — software encoding will be used'
                          : `Hardware encoder available — encoder: ${gpuInfo.encoder}`
                        }
                      </p>
                    </div>
                    <span className={`ml-auto text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                      gpuInfo.type === 'cpu'
                        ? 'bg-white/8 text-white/30'
                        : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                    }`}>
                      {gpuInfo.type === 'cpu' ? 'Software' : 'Hardware'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Speed comparison info */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'CPU (libx264)', speed: '1x baseline', note: 'Always available', dim: true },
              { label: 'Intel QSV / AMD AMF', speed: '5–8x faster', note: 'Integrated GPU', dim: false },
              { label: 'NVIDIA NVENC', speed: '10–20x faster', note: 'Dedicated GPU', dim: false },
            ].map((item) => (
              <div key={item.label} className={`p-3 rounded-xl border text-center ${
                item.dim ? 'border-white/5 bg-white/2' : 'border-cyan-500/12 bg-cyan-500/4'
              }`}>
                <p className={`text-xs font-semibold mb-0.5 ${item.dim ? 'text-white/35' : 'text-cyan-300/80'}`}>{item.speed}</p>
                <p className="text-[10px] text-white/50 font-medium">{item.label}</p>
                <p className="text-[9px] text-white/25 mt-0.5">{item.note}</p>
              </div>
            ))}
          </div>

          {/* App Preferences */}
          <section className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/5">
              <p className="text-xs font-semibold text-white/50 uppercase tracking-widest">App Preferences</p>
            </div>
            <div className="px-5">
              <SettingRow
                label="Desktop Notifications"
                description="Notify when product fetch or video generation completes."
              >
                <Toggle checked={settings.notifications} onChange={(v) => set('notifications', v)} />
              </SettingRow>
            </div>
          </section>

          {/* Save */}
          <button
            onClick={handleSave}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
              saved
                ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/35 hover:from-cyan-400 hover:to-blue-400'
            }`}
          >
            {saved ? <><CheckCircle size={15} /> Saved</> : <><Save size={15} /> Save Settings</>}
          </button>
        </div>
      </div>
    </div>
  );
}
