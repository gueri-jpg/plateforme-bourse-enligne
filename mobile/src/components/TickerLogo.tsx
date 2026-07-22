import React, { useState } from 'react';
import { View, Text, Image } from 'react-native';

const LOGO_DOMAINS: Record<string, string> = {
  AGM: 'agma.ma',           AKT: 'akdital.ma',        ARD: 'aradeicapital.com',
  ATW: 'attijariwafabank.com', BCI: 'bmci.ma',         BOA: 'bankofafrica.ma',
  CAP: 'cashplus.ma',       CFG: 'cfgbank.com',        CIH: 'cihbank.ma',
  CMT: 'managemgroup.com',  COL: 'colorado.ma',        CSR: 'cosumar.ma',
  CTM: 'ctm.ma',            DHO: 'deltaholding.ma',    EQD: 'eqdom.ma',
  FBR: 'feniebrossette.ma', GAZ: 'afriquiagaz.com',    IAM: 'iam.ma',
  IMO: 'immorente.ma',      INV: 'involys.com',        LHM: 'holcim.ma',
  MAB: 'maghrebail.ma',     MIC: 'microdata.ma',       MNG: 'managemgroup.com',
  MUT: 'mutandis.ma',       OUL: 'oulmes.ma',          PRO: 'promopharm.com',
  SID: 'sonasid.ma',        SNP: 'snep.ma',            TGC: 'tgcc.ma',
  TMA: 'totalenergies.com',
};

const COLORS = ['#7B1D3A', '#1d4ed8', '#0891b2', '#059669', '#7c3aed', '#b45309', '#be123c'];

function logoColor(ticker: string): string {
  let h = 0;
  for (const c of ticker) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
  return COLORS[h];
}

interface Props { ticker: string; size?: number; }

export function TickerLogo({ ticker, size = 24 }: Props) {
  const [failed, setFailed] = useState(false);
  const t = (ticker ?? '').toUpperCase();
  const domain = LOGO_DOMAINS[t];
  const initials = t.replace(/[^A-Z0-9]/g, '').slice(0, 2) || '?';
  const bg = logoColor(t);
  const r = Math.round(size / 2);
  const fs = Math.round(size * 0.38);

  if (!domain || failed) {
    return (
      <View style={{
        width: size, height: size, borderRadius: r,
        backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Text style={{ color: '#fff', fontSize: fs, fontWeight: '700', lineHeight: fs + 2 }}>
          {initials}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: `https://www.google.com/s2/favicons?domain=${domain}&sz=64` }}
      style={{ width: size, height: size, borderRadius: r, flexShrink: 0 }}
      onError={() => setFailed(true)}
    />
  );
}
