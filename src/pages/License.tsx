import { useState } from 'react';
import { KeyRound, CheckCircle, AlertCircle, RefreshCw, Copy, Shield } from 'lucide-react';

const features = [
  'Unlimited video generation',
  'Priority rendering queue',
  'HD & 4K export quality',
  'All video styles & templates',
  'API access',
  'Premium voice overs',
];

export default function LicensePage() {
  const [licenseKey, setLicenseKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'valid' | 'invalid'>('idle');
  const activeLicense = 'VGS-PRO-2024-XXXX-XXXX-XXXX';

  const handleActivate = () => {
    if (!licenseKey.trim()) return;
    setStatus('loading');
    setTimeout(() => {
      setStatus(licenseKey.startsWith('VGS') ? 'valid' : 'invalid');
    }, 1500);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(activeLicense);
  };

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">License</h1>
          <p className="text-sm text-white/40 mt-1">Manage your VideoGen Studio license and subscription.</p>
        </div>

        <div className="space-y-5">
          {/* Current License Card */}
          <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 to-blue-500/5 p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Shield size={14} className="text-cyan-400" />
                  <p className="text-sm font-semibold text-white">Pro License</p>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                    Active
                  </span>
                </div>
                <p className="text-xs text-white/40">Expires December 31, 2026</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/30">Registered to</p>
                <p className="text-xs text-white/70 font-medium">user@example.com</p>
              </div>
            </div>

            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-black/30 border border-white/8">
              <KeyRound size={12} className="text-white/30 flex-shrink-0" />
              <code className="flex-1 text-xs text-white/50 font-mono tracking-wider">{activeLicense}</code>
              <button
                onClick={handleCopy}
                className="w-6 h-6 flex items-center justify-center rounded text-white/25 hover:text-cyan-400 transition-colors"
              >
                <Copy size={11} />
              </button>
            </div>
          </div>

          {/* Features List */}
          <div className="rounded-xl border border-white/8 bg-white/3 p-5">
            <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-4">Included with Pro</p>
            <div className="grid grid-cols-2 gap-2">
              {features.map((feature) => (
                <div key={feature} className="flex items-center gap-2.5">
                  <CheckCircle size={13} className="text-emerald-400 flex-shrink-0" />
                  <span className="text-xs text-white/60">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Activate New License */}
          <div className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/5">
              <p className="text-xs font-semibold text-white/50 uppercase tracking-widest">Activate License Key</p>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="relative flex-1">
                  <KeyRound size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
                  <input
                    type="text"
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value)}
                    placeholder="VGS-XXXX-XXXX-XXXX-XXXX"
                    className="w-full bg-white/5 border border-white/8 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white/70 placeholder-white/20 focus:outline-none focus:border-cyan-500/50 transition-all font-mono"
                  />
                </div>
                <button
                  onClick={handleActivate}
                  disabled={!licenseKey.trim() || status === 'loading'}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-white/8 border border-white/10 text-white/70 hover:text-white hover:bg-white/12 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {status === 'loading' ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : (
                    'Activate'
                  )}
                </button>
              </div>

              {status === 'valid' && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle size={13} className="text-emerald-400" />
                  <p className="text-xs text-emerald-400">License activated successfully!</p>
                </div>
              )}
              {status === 'invalid' && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertCircle size={13} className="text-red-400" />
                  <p className="text-xs text-red-400">Invalid license key. Please check and try again.</p>
                </div>
              )}
            </div>
          </div>

          {/* Usage Stats */}
          <div className="rounded-xl border border-white/8 bg-white/3 p-5">
            <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-4">Usage This Month</p>
            <div className="space-y-3">
              {[
                { label: 'Videos Generated', used: 24, total: 'Unlimited' },
                { label: 'API Calls', used: 1240, total: 10000 },
                { label: 'Storage Used', used: 4.2, total: 50, unit: 'GB' },
              ].map(({ label, used, total, unit }) => (
                <div key={label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-white/50">{label}</span>
                    <span className="text-xs text-white/30">
                      {used}{unit || ''} / {total === 'Unlimited' ? 'Unlimited' : `${total}${unit || ''}`}
                    </span>
                  </div>
                  {typeof total === 'number' && (
                    <div className="h-1 rounded-full bg-white/8 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                        style={{ width: `${Math.min((Number(used) / total) * 100, 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
