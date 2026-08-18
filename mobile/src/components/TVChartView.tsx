// components/TVChartView.tsx — Graphe TradingView (CSEMA) via WebView
import React, { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Modal, StatusBar,
} from 'react-native';
import { WebView } from 'react-native-webview';

// Tickers CSEMA vérifiés sur TradingView (tradingview.com/symbols/CSEMA-XXX)
const BVC_TV: Record<string, string> = {
  // ── Banques ──────────────────────────────────────────────────────────────
  'ATTIJARIWAFA BANK':                    'ATW',
  'BANQUE CENTRALE POPULAIRE':            'BCP',
  'BANK OF AFRICA':                       'BOA',
  'BMCE BANK':                            'BOA',
  'BMCE BANK OF AFRICA':                  'BOA',
  'BMCI':                                 'BCI',
  'BANQUE MAROCAINE POUR LE COMMERCE':    'BCI',
  'CREDIT DU MAROC':                      'CDM',
  'CIH BANK':                             'CIH',
  // ── Télécoms ─────────────────────────────────────────────────────────────
  'MAROC TELECOM':                        'IAM',
  'ITISSALAT AL-MAGHRIB':                 'IAM',
  // ── Immobilier ───────────────────────────────────────────────────────────
  'DOUJA PROM ADDOHA':                    'ADH',
  'ADDOHA':                               'ADH',
  // ── Ciments / Matériaux ──────────────────────────────────────────────────
  'CIMENTS DU MAROC':                     'CMA',
  'HOLCIM MAROC':                         'LHM',
  // ── Agroalimentaire ──────────────────────────────────────────────────────
  'COSUMAR':                              'CSR',
  'CENTRALE DANONE':                      'DAN',
  // ── Assurances ───────────────────────────────────────────────────────────
  'WAFA ASSURANCE':                       'WAA',
  'ATLANTA':                              'ATL',
  'ATLANTASANAD':                         'ATL',
  // ── Mines / Énergie ──────────────────────────────────────────────────────
  'MANAGEM':                              'MNG',
  'TAQA MOROCCO':                         'TQM',
  // ── Distribution / Commerce ──────────────────────────────────────────────
  'LABEL VIE':                            'LBV',
  'AUTO HALL':                            'ATH',
  'COLORADO':                             'COL',
  // ── Services / Tech ──────────────────────────────────────────────────────
  'HPS':                                  'HPS',
  'HIGHTECH PAYMENT SYSTEMS':             'HPS',
  'COMPAGNIE DE TRANSPORTS AU MAROC':     'CTM',
  'CTM':                                  'CTM',
  'CASH PLUS':                            'CAP',
  // ── Holdings / Autres ────────────────────────────────────────────────────
  'DELTA HOLDING':                        'DHO',
  'FENIE BROSSETTE':                      'FBR',
  'TIMAR':                                'TIM',
  'ZELLIDJA':                             'ZLD',
  'NEXANS MAROC':                         'NEX',
  'SNEP':                                 'SNP',
};

function tvTicker(stockName: string, stockTicker?: string): string | null {
  const nameUp = stockName.toUpperCase().trim();
  // 1. Correspondance exacte sur le nom
  if (BVC_TV[nameUp]) return BVC_TV[nameUp];
  // 2. Correspondance partielle (le nom BVC contient une clé de la table ou vice-versa)
  for (const [key, code] of Object.entries(BVC_TV)) {
    if (nameUp.includes(key) || key.includes(nameUp)) return code;
  }
  // 3. Ticker extrait de l'URL BVC (même logique que le dashboard web)
  //    Valide si ≤ 6 chars et uniquement alphanumérique
  if (stockTicker) {
    const t = stockTicker.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (t.length >= 2 && t.length <= 6) return t;
  }
  return null;
}

function buildHtml(ticker: string, interval: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body,#tv{width:100%;height:100%;overflow:hidden;background:#1e293b}
</style>
</head>
<body>
<div id="tv"></div>
<script src="https://s3.tradingview.com/tv.js"></script>
<script>
new TradingView.widget({
  autosize:true,
  symbol:"CSEMA:${ticker}",
  interval:"${interval}",
  timezone:"Africa/Casablanca",
  theme:"dark",
  style:"1",
  locale:"fr",
  toolbar_bg:"#1e293b",
  enable_publishing:false,
  hide_side_toolbar:true,
  allow_symbol_change:false,
  save_image:false,
  container_id:"tv"
});
</script>
</body>
</html>`;
}

const INTERVALS = [
  { label: '1h', value: '60' },
  { label: '1J',  value: 'D' },
  { label: '1S',  value: 'W' },
  { label: '1M',  value: 'M' },
];

interface Props { stockName: string; stockTicker?: string }

export function TVChartView({ stockName, stockTicker }: Props) {
  const [interval,  setInterval]  = useState('D');
  const [loading,   setLoading]   = useState(true);
  const [inAppUrl,  setInAppUrl]  = useState<string | null>(null);
  const [inAppLoad, setInAppLoad] = useState(true);

  const ticker = useMemo(() => tvTicker(stockName, stockTicker), [stockName, stockTicker]);
  const html   = useMemo(
    () => (ticker ? buildHtml(ticker, interval) : null),
    [ticker, interval],
  );

  if (!ticker || !html) {
    return (
      <View style={s.noData}>
        <Text style={s.noDataTxt}>Graphe non disponible pour ce titre</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={s.tabs}>
        {INTERVALS.map(iv => (
          <TouchableOpacity
            key={iv.value}
            style={[s.tab, interval === iv.value && s.tabActive]}
            onPress={() => { setLoading(true); setInterval(iv.value); }}
          >
            <Text style={[s.tabTxt, interval === iv.value && s.tabTxtActive]}>
              {iv.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.chartBox}>
        <WebView
          key={`${ticker}-${interval}`}
          source={{ html, baseUrl: 'https://www.tradingview.com' }}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
          {...(Platform.OS === 'android' ? {
            mixedContentMode: 'always' as const,
            setSupportMultipleWindows: false,  // window.open() passe par onShouldStartLoadWithRequest
          } : {})}
          scrollEnabled={false}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          style={s.webview}
          onOpenWindow={(e) => {
            // iOS : capture window.open() depuis l'iframe TradingView
            const url = e.nativeEvent.targetUrl;
            if (url?.startsWith('http')) setInAppUrl(url);
          }}
          onShouldStartLoadWithRequest={(req) => {
            // Laisser passer le chargement initial + ressources TradingView
            if (
              req.url === 'about:blank' ||
              req.url.startsWith('blob:') ||
              req.url === 'https://www.tradingview.com'
            ) return true;
            // Tout lien externe (y compris window.open sur Android) → in-app
            if (req.url.startsWith('http')) {
              setInAppUrl(req.url);
              return false;
            }
            return true;
          }}
        />
        {loading && (
          <View style={s.loader}>
            <ActivityIndicator color="#7B1D3A" />
            <Text style={s.loaderTxt}>Chargement du graphe…</Text>
          </View>
        )}
      </View>
      {/* Navigateur in-app pour les liens TradingView */}
      <Modal visible={!!inAppUrl} animationType="slide" onRequestClose={() => setInAppUrl(null)}>
        <View style={s.browser}>
          <View style={s.browserBar}>
            <Text style={s.browserUrl} numberOfLines={1}>{inAppUrl ?? ''}</Text>
            <TouchableOpacity onPress={() => setInAppUrl(null)} style={s.browserClose}>
              <Text style={s.browserCloseTxt}>✕ Fermer</Text>
            </TouchableOpacity>
          </View>
          {inAppLoad && (
            <View style={s.browserLoader}>
              <ActivityIndicator color="#7B1D3A" />
            </View>
          )}
          {inAppUrl && (
            <WebView
              source={{ uri: inAppUrl }}
              javaScriptEnabled
              domStorageEnabled
              setSupportMultipleWindows={false}
              onLoadStart={() => setInAppLoad(true)}
              onLoadEnd={() => setInAppLoad(false)}
              style={{ flex: 1 }}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  tabs:         { flexDirection: 'row', gap: 6, marginBottom: 10 },
  tab:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f1f5f9' },
  tabActive:    { backgroundColor: '#7B1D3A', borderColor: '#7B1D3A' },
  tabTxt:       { fontSize: 12, color: '#64748b', fontWeight: '600' },
  tabTxtActive: { color: '#fff' },
  chartBox:     { height: 280, borderRadius: 12, overflow: 'hidden', backgroundColor: '#1e293b' },
  webview:      { flex: 1 },
  loader:       { ...StyleSheet.absoluteFillObject, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center', gap: 8 },
  loaderTxt:    { color: '#94a3b8', fontSize: 12 },
  noData:       { height: 60, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 12 },
  noDataTxt:    { color: '#94a3b8', fontSize: 13 },
  // ── Navigateur in-app ────────────────────────────────────────────────────
  browser:        { flex: 1, backgroundColor: '#fff' },
  browserBar:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: Platform.OS === 'ios' ? 52 : (StatusBar.currentHeight ?? 24) + 10, paddingBottom: 10, backgroundColor: '#1e293b', gap: 8 },
  browserUrl:     { flex: 1, fontSize: 12, color: '#94a3b8' },
  browserClose:   { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#7B1D3A', borderRadius: 8 },
  browserCloseTxt:{ color: '#fff', fontSize: 13, fontWeight: '600' },
  browserLoader:  { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.8)', zIndex: 10 },
});
