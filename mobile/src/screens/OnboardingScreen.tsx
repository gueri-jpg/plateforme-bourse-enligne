import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Modal, FlatList, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../store/useAuth';

const C = {
  bg:     '#070b1c',
  panel:  '#111733',
  panel2: '#0e1430',
  txt:    '#e7ecff',
  muted:  '#8a93b8',
  line:   '#1f2a52',
  accent: '#60a5fa',
  up:     '#22c55e',
  gold:   '#f59e0b',
};

// ─────────────────────────────────────────────────────────────────────────────
// Liste complète des pays du monde
// ─────────────────────────────────────────────────────────────────────────────
const ALL_COUNTRIES = [
  { value: 'AF', label: 'Afghanistan' }, { value: 'ZA', label: 'Afrique du Sud' },
  { value: 'AL', label: 'Albanie' }, { value: 'DZ', label: 'Algérie' },
  { value: 'DE', label: 'Allemagne' }, { value: 'AD', label: 'Andorre' },
  { value: 'AO', label: 'Angola' }, { value: 'AG', label: 'Antigua-et-Barbuda' },
  { value: 'SA', label: 'Arabie saoudite' }, { value: 'AR', label: 'Argentine' },
  { value: 'AM', label: 'Arménie' }, { value: 'AU', label: 'Australie' },
  { value: 'AT', label: 'Autriche' }, { value: 'AZ', label: 'Azerbaïdjan' },
  { value: 'BS', label: 'Bahamas' }, { value: 'BH', label: 'Bahreïn' },
  { value: 'BD', label: 'Bangladesh' }, { value: 'BB', label: 'Barbade' },
  { value: 'BE', label: 'Belgique' }, { value: 'BZ', label: 'Belize' },
  { value: 'BJ', label: 'Bénin' }, { value: 'BT', label: 'Bhoutan' },
  { value: 'BY', label: 'Biélorussie' }, { value: 'BO', label: 'Bolivie' },
  { value: 'BA', label: 'Bosnie-Herzégovine' }, { value: 'BW', label: 'Botswana' },
  { value: 'BR', label: 'Brésil' }, { value: 'BN', label: 'Brunei' },
  { value: 'BG', label: 'Bulgarie' }, { value: 'BF', label: 'Burkina Faso' },
  { value: 'BI', label: 'Burundi' }, { value: 'CV', label: 'Cabo Verde' },
  { value: 'KH', label: 'Cambodge' }, { value: 'CM', label: 'Cameroun' },
  { value: 'CA', label: 'Canada' }, { value: 'CF', label: 'Centrafrique' },
  { value: 'CL', label: 'Chili' }, { value: 'CN', label: 'Chine' },
  { value: 'CY', label: 'Chypre' }, { value: 'CO', label: 'Colombie' },
  { value: 'KM', label: 'Comores' }, { value: 'CG', label: 'Congo' },
  { value: 'CD', label: 'Congo (RDC)' }, { value: 'KR', label: 'Corée du Sud' },
  { value: 'KP', label: 'Corée du Nord' }, { value: 'CR', label: 'Costa Rica' },
  { value: 'CI', label: 'Côte d\'Ivoire' }, { value: 'HR', label: 'Croatie' },
  { value: 'CU', label: 'Cuba' }, { value: 'DK', label: 'Danemark' },
  { value: 'DJ', label: 'Djibouti' }, { value: 'DO', label: 'Dominicaine (Rép.)' },
  { value: 'DM', label: 'Dominique' }, { value: 'EG', label: 'Égypte' },
  { value: 'AE', label: 'Émirats arabes unis' }, { value: 'EC', label: 'Équateur' },
  { value: 'ER', label: 'Érythrée' }, { value: 'ES', label: 'Espagne' },
  { value: 'EE', label: 'Estonie' }, { value: 'SZ', label: 'Eswatini' },
  { value: 'US', label: 'États-Unis' }, { value: 'ET', label: 'Éthiopie' },
  { value: 'FJ', label: 'Fidji' }, { value: 'FI', label: 'Finlande' },
  { value: 'FR', label: 'France' }, { value: 'GA', label: 'Gabon' },
  { value: 'GM', label: 'Gambie' }, { value: 'GE', label: 'Géorgie' },
  { value: 'GH', label: 'Ghana' }, { value: 'GR', label: 'Grèce' },
  { value: 'GD', label: 'Grenade' }, { value: 'GT', label: 'Guatemala' },
  { value: 'GN', label: 'Guinée' }, { value: 'GW', label: 'Guinée-Bissau' },
  { value: 'GQ', label: 'Guinée équatoriale' }, { value: 'GY', label: 'Guyana' },
  { value: 'HT', label: 'Haïti' }, { value: 'HN', label: 'Honduras' },
  { value: 'HU', label: 'Hongrie' }, { value: 'IN', label: 'Inde' },
  { value: 'ID', label: 'Indonésie' }, { value: 'IQ', label: 'Irak' },
  { value: 'IR', label: 'Iran' }, { value: 'IE', label: 'Irlande' },
  { value: 'IS', label: 'Islande' }, { value: 'IL', label: 'Israël' },
  { value: 'IT', label: 'Italie' }, { value: 'JM', label: 'Jamaïque' },
  { value: 'JP', label: 'Japon' }, { value: 'JO', label: 'Jordanie' },
  { value: 'KZ', label: 'Kazakhstan' }, { value: 'KE', label: 'Kenya' },
  { value: 'KG', label: 'Kirghizistan' }, { value: 'KI', label: 'Kiribati' },
  { value: 'KW', label: 'Koweït' }, { value: 'LA', label: 'Laos' },
  { value: 'LS', label: 'Lesotho' }, { value: 'LV', label: 'Lettonie' },
  { value: 'LB', label: 'Liban' }, { value: 'LR', label: 'Liberia' },
  { value: 'LY', label: 'Libye' }, { value: 'LI', label: 'Liechtenstein' },
  { value: 'LT', label: 'Lituanie' }, { value: 'LU', label: 'Luxembourg' },
  { value: 'MG', label: 'Madagascar' }, { value: 'MY', label: 'Malaisie' },
  { value: 'MW', label: 'Malawi' }, { value: 'MV', label: 'Maldives' },
  { value: 'ML', label: 'Mali' }, { value: 'MT', label: 'Malte' },
  { value: 'MA', label: 'Maroc' }, { value: 'MH', label: 'Marshall (Îles)' },
  { value: 'MU', label: 'Maurice' }, { value: 'MR', label: 'Mauritanie' },
  { value: 'MX', label: 'Mexique' }, { value: 'FM', label: 'Micronésie' },
  { value: 'MD', label: 'Moldavie' }, { value: 'MC', label: 'Monaco' },
  { value: 'MN', label: 'Mongolie' }, { value: 'ME', label: 'Monténégro' },
  { value: 'MZ', label: 'Mozambique' }, { value: 'MM', label: 'Myanmar' },
  { value: 'NA', label: 'Namibie' }, { value: 'NR', label: 'Nauru' },
  { value: 'NP', label: 'Népal' }, { value: 'NI', label: 'Nicaragua' },
  { value: 'NE', label: 'Niger' }, { value: 'NG', label: 'Nigeria' },
  { value: 'NO', label: 'Norvège' }, { value: 'NZ', label: 'Nouvelle-Zélande' },
  { value: 'OM', label: 'Oman' }, { value: 'UG', label: 'Ouganda' },
  { value: 'UZ', label: 'Ouzbékistan' }, { value: 'PK', label: 'Pakistan' },
  { value: 'PW', label: 'Palaos' }, { value: 'PS', label: 'Palestine' },
  { value: 'PA', label: 'Panama' }, { value: 'PG', label: 'Papouasie-Nouvelle-Guinée' },
  { value: 'PY', label: 'Paraguay' }, { value: 'NL', label: 'Pays-Bas' },
  { value: 'PE', label: 'Pérou' }, { value: 'PH', label: 'Philippines' },
  { value: 'PL', label: 'Pologne' }, { value: 'PT', label: 'Portugal' },
  { value: 'QA', label: 'Qatar' }, { value: 'RO', label: 'Roumanie' },
  { value: 'GB', label: 'Royaume-Uni' }, { value: 'RU', label: 'Russie' },
  { value: 'RW', label: 'Rwanda' }, { value: 'KN', label: 'Saint-Kitts-et-Nevis' },
  { value: 'LC', label: 'Sainte-Lucie' }, { value: 'VC', label: 'Saint-Vincent' },
  { value: 'SB', label: 'Salomon (Îles)' }, { value: 'WS', label: 'Samoa' },
  { value: 'SM', label: 'Saint-Marin' }, { value: 'ST', label: 'Sao Tomé-et-Príncipe' },
  { value: 'SN', label: 'Sénégal' }, { value: 'RS', label: 'Serbie' },
  { value: 'SC', label: 'Seychelles' }, { value: 'SL', label: 'Sierra Leone' },
  { value: 'SG', label: 'Singapour' }, { value: 'SK', label: 'Slovaquie' },
  { value: 'SI', label: 'Slovénie' }, { value: 'SO', label: 'Somalie' },
  { value: 'SD', label: 'Soudan' }, { value: 'SS', label: 'Soudan du Sud' },
  { value: 'LK', label: 'Sri Lanka' }, { value: 'SE', label: 'Suède' },
  { value: 'CH', label: 'Suisse' }, { value: 'SR', label: 'Suriname' },
  { value: 'SY', label: 'Syrie' }, { value: 'TJ', label: 'Tadjikistan' },
  { value: 'TZ', label: 'Tanzanie' }, { value: 'TD', label: 'Tchad' },
  { value: 'CZ', label: 'Tchéquie' }, { value: 'TH', label: 'Thaïlande' },
  { value: 'TL', label: 'Timor oriental' }, { value: 'TG', label: 'Togo' },
  { value: 'TO', label: 'Tonga' }, { value: 'TT', label: 'Trinité-et-Tobago' },
  { value: 'TN', label: 'Tunisie' }, { value: 'TM', label: 'Turkménistan' },
  { value: 'TR', label: 'Turquie' }, { value: 'TV', label: 'Tuvalu' },
  { value: 'UA', label: 'Ukraine' }, { value: 'UY', label: 'Uruguay' },
  { value: 'VU', label: 'Vanuatu' }, { value: 'VE', label: 'Venezuela' },
  { value: 'VN', label: 'Vietnam' }, { value: 'YE', label: 'Yémen' },
  { value: 'ZM', label: 'Zambie' }, { value: 'ZW', label: 'Zimbabwe' },
];

const TYPES_PIECE = [
  { value: 'cin',      label: 'Carte Nationale d\'Identité (CIN)' },
  { value: 'passport', label: 'Passeport' },
  { value: 'sejour',   label: 'Carte de séjour' },
];

const BANQUES = [
  { value: 'attijariwafa', label: 'Attijariwafa Bank' },
  { value: 'bmce',         label: 'Bank of Africa (BMCE)' },
  { value: 'bcp',          label: 'Banque Populaire (BCP)' },
  { value: 'cih',          label: 'CIH Bank' },
  { value: 'sgma',         label: 'Société Générale Maroc' },
  { value: 'bmci',         label: 'BMCI' },
  { value: 'cfg',          label: 'CFG Bank' },
  { value: 'other',        label: 'Autre' },
];

// Jours / Mois / Années pour le date picker
const DAYS   = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const MONTHS = [
  '01 — Janvier', '02 — Février', '03 — Mars', '04 — Avril',
  '05 — Mai',     '06 — Juin',    '07 — Juillet','08 — Août',
  '09 — Septembre','10 — Octobre','11 — Novembre','12 — Décembre',
];
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 100 }, (_, i) => String(currentYear - i));

// ─────────────────────────────────────────────────────────────────────────────
// Composant : champ + libellé
// ─────────────────────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={f.wrap}>
      <Text style={f.label}>{label}</Text>
      {children}
    </View>
  );
}
const f = StyleSheet.create({
  wrap:  { marginBottom: 16 },
  label: { fontSize: 11, color: C.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Composant : TextInput stylisé
// ─────────────────────────────────────────────────────────────────────────────
function StyledInput(props: React.ComponentProps<typeof TextInput>) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      {...props}
      placeholderTextColor="#3a4570"
      style={[inp.base, focused && inp.focused, props.style]}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}
const inp = StyleSheet.create({
  base:   { backgroundColor: C.panel2, color: C.txt, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, fontSize: 14 },
  focused:{ borderColor: C.accent },
});

// ─────────────────────────────────────────────────────────────────────────────
// Composant : Select (dropdown avec recherche)
// ─────────────────────────────────────────────────────────────────────────────
function Select({ placeholder, value, options, onSelect, searchable = false }: {
  placeholder: string; value: string;
  options: { value: string; label: string }[];
  onSelect: (v: string) => void;
  searchable?: boolean;
}) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const current = options.find(o => o.value === value)?.label;

  const filtered = searchable && search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <>
      <TouchableOpacity
        style={[inp.base, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
        onPress={() => { setSearch(''); setOpen(true); }}
        activeOpacity={0.8}
      >
        <Text style={{ color: current ? C.txt : '#3a4570', fontSize: 14 }}>{current ?? placeholder}</Text>
        <Text style={{ color: C.muted }}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={sel.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={sel.sheet}>
          <Text style={sel.title}>{placeholder}</Text>
          {searchable && (
            <TextInput
              style={sel.search}
              placeholder="Rechercher…"
              placeholderTextColor="#3a4570"
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          )}
          <FlatList
            data={filtered}
            keyExtractor={o => o.value}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[sel.option, item.value === value && sel.optionActive]}
                onPress={() => { onSelect(item.value); setOpen(false); setSearch(''); }}
              >
                <Text style={[sel.optionTxt, item.value === value && { color: C.accent, fontWeight: '600' }]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </>
  );
}
const sel = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet:       { backgroundColor: C.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '70%' },
  title:       { fontSize: 14, fontWeight: '700', color: C.txt, marginBottom: 12 },
  search:      { backgroundColor: C.panel2, color: C.txt, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, fontSize: 14, marginBottom: 10 },
  option:      { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.line, paddingHorizontal: 4 },
  optionActive:{ backgroundColor: 'rgba(96,165,250,0.08)', borderRadius: 8, paddingHorizontal: 8 },
  optionTxt:   { fontSize: 14, color: C.muted },
});

// ─────────────────────────────────────────────────────────────────────────────
// Composant : Sélecteur de date (3 colonnes Jour / Mois / Année)
// ─────────────────────────────────────────────────────────────────────────────
function WheelList({ items, selected, onSelect }: {
  items: string[]; selected: string; onSelect: (v: string) => void;
}) {
  const ITEM_H = 44;
  const ref    = useRef<FlatList>(null);

  return (
    <FlatList
      ref={ref}
      data={items}
      keyExtractor={i => i}
      style={{ height: ITEM_H * 5, flexGrow: 0 }}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      initialScrollIndex={Math.max(0, items.indexOf(selected))}
      getItemLayout={(_, index) => ({ length: ITEM_H, offset: ITEM_H * index, index })}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[wh.item, item === selected && wh.itemSelected]}
          onPress={() => onSelect(item)}
        >
          <Text style={[wh.itemTxt, item === selected && wh.itemTxtSelected]}>
            {item}
          </Text>
        </TouchableOpacity>
      )}
    />
  );
}
const wh = StyleSheet.create({
  item:           { height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  itemSelected:   { backgroundColor: 'rgba(96,165,250,0.15)' },
  itemTxt:        { fontSize: 15, color: C.muted },
  itemTxtSelected:{ color: C.accent, fontWeight: '700', fontSize: 16 },
});

function DatePickerField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [open,  setOpen]  = useState(false);
  const [day,   setDay]   = useState('01');
  const [month, setMonth] = useState('01');
  const [year,  setYear]  = useState(String(currentYear - 30));

  const confirm = () => {
    onChange(`${day}/${month.slice(0, 2)}/${year}`);
    setOpen(false);
  };

  return (
    <Field label={label}>
      <TouchableOpacity
        style={[inp.base, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
      >
        <Text style={{ color: value ? C.txt : '#3a4570', fontSize: 14 }}>
          {value || (placeholder ?? 'Sélectionner une date')}
        </Text>
        <Text style={{ fontSize: 16 }}>📅</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={sel.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={dp.sheet}>
          <Text style={dp.title}>Sélectionner une date</Text>

          <View style={dp.cols}>
            {/* Jour */}
            <View style={dp.col}>
              <Text style={dp.colLabel}>Jour</Text>
              <WheelList items={DAYS}   selected={day}   onSelect={setDay} />
            </View>
            <View style={dp.divider} />
            {/* Mois */}
            <View style={[dp.col, { flex: 2 }]}>
              <Text style={dp.colLabel}>Mois</Text>
              <WheelList items={MONTHS} selected={month} onSelect={setMonth} />
            </View>
            <View style={dp.divider} />
            {/* Année */}
            <View style={dp.col}>
              <Text style={dp.colLabel}>Année</Text>
              <WheelList items={YEARS}  selected={year}  onSelect={setYear} />
            </View>
          </View>

          <TouchableOpacity style={dp.confirmBtn} onPress={confirm}>
            <Text style={dp.confirmTxt}>Confirmer</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </Field>
  );
}
const dp = StyleSheet.create({
  sheet:      { backgroundColor: C.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  title:      { fontSize: 15, fontWeight: '700', color: C.txt, textAlign: 'center', marginBottom: 16 },
  cols:       { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  col:        { flex: 1, alignItems: 'center' },
  colLabel:   { fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  divider:    { width: 1, height: 220 + 24, backgroundColor: C.line, marginTop: 28 },
  confirmBtn: { marginTop: 20, backgroundColor: C.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmTxt: { color: '#000', fontWeight: '700', fontSize: 15 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Composant : Radio option
// ─────────────────────────────────────────────────────────────────────────────
function RadioOption({ label, desc, selected, onPress }: {
  label: string; desc: string; selected: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[ro.wrap, selected && ro.wrapActive]} onPress={onPress} activeOpacity={0.8}>
      <View style={[ro.circle, selected && ro.circleActive]}>
        {selected && <View style={ro.dot} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={ro.label}>{label}</Text>
        <Text style={ro.desc}>{desc}</Text>
      </View>
    </TouchableOpacity>
  );
}
const ro = StyleSheet.create({
  wrap:        { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 14, marginBottom: 10 },
  wrapActive:  { borderColor: C.accent, backgroundColor: 'rgba(96,165,250,0.08)' },
  circle:      { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  circleActive:{ borderColor: C.accent },
  dot:         { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent },
  label:       { fontSize: 14, fontWeight: '500', color: C.txt },
  desc:        { fontSize: 11, color: C.muted, marginTop: 2 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Composant : Séparateur de section
// ─────────────────────────────────────────────────────────────────────────────
function SectionSep({ label }: { label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: C.line }} />
      <Text style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.line }} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Composant : Stepper
// ─────────────────────────────────────────────────────────────────────────────
const STEP_LABELS = ['Identité', 'Pièce d\'identité', 'Profil investisseur', 'Compte bancaire'];

function Stepper({ current }: { current: number }) {
  return (
    <View style={st.row}>
      {STEP_LABELS.map((label, i) => {
        const n      = i + 1;
        const done   = n < current;
        const active = n === current;
        return (
          <React.Fragment key={n}>
            <View style={st.step}>
              <View style={[st.circle, active && st.circleActive, done && st.circleDone]}>
                <Text style={[st.num, active && { color: C.accent }, done && { color: C.up }]}>
                  {done ? '✓' : String(n)}
                </Text>
              </View>
              <Text style={[st.label, active && { color: C.accent }, done && { color: C.up }]} numberOfLines={1}>
                {label}
              </Text>
            </View>
            {i < STEP_LABELS.length - 1 && <View style={[st.line, done && st.lineDone]} />}
          </React.Fragment>
        );
      })}
    </View>
  );
}
const st = StyleSheet.create({
  row:        { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12 },
  step:       { alignItems: 'center', flex: 1 },
  circle:     { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: C.line, backgroundColor: C.panel2, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  circleActive:{ borderColor: C.accent, backgroundColor: 'rgba(96,165,250,0.15)' },
  circleDone: { borderColor: C.up, backgroundColor: 'rgba(34,197,94,0.15)' },
  num:        { fontSize: 12, fontWeight: '600', color: C.muted },
  label:      { fontSize: 9, color: C.muted, textAlign: 'center' },
  line:       { flex: 1, height: 2, backgroundColor: C.line, marginTop: 15 },
  lineDone:   { backgroundColor: C.up },
});

// ─────────────────────────────────────────────────────────────────────────────
// Composant : Boutons de navigation
// ─────────────────────────────────────────────────────────────────────────────
function NavRow({ onPrev, onSkip, onNext, nextLabel = 'Suivant →' }: {
  onPrev?: () => void; onSkip?: () => void;
  onNext: () => void; nextLabel?: string;
}) {
  const isFinish = nextLabel.includes('Terminer');
  return (
    <View style={nv.row}>
      {onPrev
        ? <TouchableOpacity style={nv.prev} onPress={onPrev}><Text style={nv.prevTxt}>← Retour</Text></TouchableOpacity>
        : <View />
      }
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        {onSkip && <TouchableOpacity onPress={onSkip}><Text style={nv.skip}>Passer</Text></TouchableOpacity>}
        <TouchableOpacity style={[nv.next, isFinish && nv.nextGreen]} onPress={onNext}>
          <Text style={nv.nextTxt}>{nextLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
const nv = StyleSheet.create({
  row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 28 },
  prev:     { paddingVertical: 11, paddingHorizontal: 18, borderRadius: 10, borderWidth: 1, borderColor: C.line },
  prevTxt:  { color: C.muted, fontSize: 13, fontWeight: '500' },
  next:     { paddingVertical: 11, paddingHorizontal: 22, borderRadius: 10, backgroundColor: C.accent },
  nextGreen:{ backgroundColor: C.up },
  nextTxt:  { color: '#000', fontSize: 13, fontWeight: '700' },
  skip:     { fontSize: 12, color: C.muted, textDecorationLine: 'underline' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Écran principal
// ─────────────────────────────────────────────────────────────────────────────
export function OnboardingScreen() {
  const completeOnboarding = useAuth((s) => s.completeOnboarding);
  const [step, setStep] = useState(1);

  // Étape 1
  const [dateNaissance, setDateNaissance] = useState('');
  const [nationalite,   setNationalite]   = useState('');
  const [telephone,     setTelephone]     = useState('');
  const [paysResidence, setPaysResidence] = useState('');
  const [adresse,       setAdresse]       = useState('');

  // Étape 2
  const [typePiece,      setTypePiece]      = useState('');
  const [numeroPiece,    setNumeroPiece]    = useState('');
  const [dateDelivrance, setDateDelivrance] = useState('');
  const [dateExpiration, setDateExpiration] = useState('');
  const [paysEmetteur,   setPaysEmetteur]   = useState('');

  // Étape 3
  const [experience, setExperience] = useState('');
  const [objectif,   setObjectif]   = useState('');
  const [risque,     setRisque]     = useState('');

  // Étape 4
  const [banque,    setBanque]    = useState('');
  const [titulaire, setTitulaire] = useState('');
  const [rib,       setRib]       = useState('');
  const [iban,      setIban]      = useState('');

  const goTo = (n: number) => setStep(n);

  // ── Étape finale ─────────────────────────────────────────────────────────
  if (step === 5) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <View style={s.finalWrap}>
          <Text style={s.finalIcon}>🎉</Text>
          <Text style={s.finalTitle}>Bienvenue sur BourseOnline !</Text>
          <Text style={s.finalSub}>
            Votre compte a été créé avec succès. Vous pouvez maintenant
            accéder à votre espace investisseur.
          </Text>
          <TouchableOpacity style={s.finalBtn} onPress={completeOnboarding} activeOpacity={0.85}>
            <Text style={s.finalBtnTxt}>Accéder à mon compte →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <StatusBar style="light" />

      <View style={s.header}>
        <Text style={s.headerTitle}>BourseOnline</Text>
        <Text style={s.headerSub}>Compléter mon profil</Text>
      </View>

      <Stepper current={step} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Étape 1 : Identité ── */}
          {step === 1 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Informations personnelles</Text>
              <Text style={s.cardSub}>Renseignez vos coordonnées personnelles</Text>

              <DatePickerField label="Date de naissance" value={dateNaissance} onChange={setDateNaissance} />

              <Field label="Nationalité">
                <Select placeholder="Sélectionner…" value={nationalite} options={ALL_COUNTRIES}
                  onSelect={setNationalite} searchable />
              </Field>

              <Field label="Téléphone">
                <StyledInput value={telephone} onChangeText={setTelephone}
                  placeholder="+212 6 XX XX XX XX" keyboardType="phone-pad" />
              </Field>

              <Field label="Pays de résidence">
                <Select placeholder="Sélectionner…" value={paysResidence} options={ALL_COUNTRIES}
                  onSelect={setPaysResidence} searchable />
              </Field>

              <Field label="Adresse complète">
                <StyledInput value={adresse} onChangeText={setAdresse}
                  placeholder="Numéro, rue, quartier, ville…"
                  multiline numberOfLines={3} style={{ minHeight: 80, textAlignVertical: 'top' }} />
              </Field>

              <NavRow onSkip={() => goTo(2)} onNext={() => goTo(2)} />
            </View>
          )}

          {/* ── Étape 2 : Pièce d'identité ── */}
          {step === 2 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Pièce d'identité</Text>
              <Text style={s.cardSub}>Pour la vérification KYC réglementaire</Text>

              <Field label="Type de pièce">
                <Select placeholder="Sélectionner…" value={typePiece} options={TYPES_PIECE} onSelect={setTypePiece} />
              </Field>

              <Field label="Numéro de la pièce">
                <StyledInput value={numeroPiece} onChangeText={setNumeroPiece} placeholder="Ex : AB123456" />
              </Field>

              <DatePickerField label="Date de délivrance" value={dateDelivrance} onChange={setDateDelivrance} />
              <DatePickerField label="Date d'expiration"  value={dateExpiration} onChange={setDateExpiration} />

              <Field label="Pays émetteur">
                <Select placeholder="Sélectionner…" value={paysEmetteur} options={ALL_COUNTRIES}
                  onSelect={setPaysEmetteur} searchable />
              </Field>

              <NavRow onPrev={() => goTo(1)} onSkip={() => goTo(3)} onNext={() => goTo(3)} />
            </View>
          )}

          {/* ── Étape 3 : Profil investisseur ── */}
          {step === 3 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Profil investisseur</Text>
              <Text style={s.cardSub}>Ces informations permettent d'adapter nos recommandations</Text>

              <SectionSep label="Expérience en bourse" />
              {[
                { value: 'debutant',      label: 'Débutant',      desc: 'Je découvre les marchés financiers' },
                { value: 'intermediaire', label: 'Intermédiaire', desc: "J'ai déjà investi, je connais les bases" },
                { value: 'expert',        label: 'Expert',        desc: "Je maîtrise l'analyse technique et fondamentale" },
              ].map(o => (
                <RadioOption key={o.value} label={o.label} desc={o.desc}
                  selected={experience === o.value} onPress={() => setExperience(o.value)} />
              ))}

              <SectionSep label="Objectif d'investissement" />
              {[
                { value: 'epargne',     label: 'Épargne long terme',      desc: 'Constituer un capital sur plusieurs années' },
                { value: 'revenu',      label: 'Revenus réguliers',       desc: 'Dividendes et coupons' },
                { value: 'speculation', label: 'Spéculation court terme', desc: 'Profiter des fluctuations du marché' },
              ].map(o => (
                <RadioOption key={o.value} label={o.label} desc={o.desc}
                  selected={objectif === o.value} onPress={() => setObjectif(o.value)} />
              ))}

              <SectionSep label="Tolérance au risque" />
              {[
                { value: 'faible',  label: 'Faible',  desc: 'Je préfère la sécurité à la performance' },
                { value: 'moderee', label: 'Modérée', desc: 'Un équilibre entre risque et rendement' },
                { value: 'elevee',  label: 'Élevée',  desc: 'Je vise la performance maximale' },
              ].map(o => (
                <RadioOption key={o.value} label={o.label} desc={o.desc}
                  selected={risque === o.value} onPress={() => setRisque(o.value)} />
              ))}

              <NavRow onPrev={() => goTo(2)} onSkip={() => goTo(4)} onNext={() => goTo(4)} />
            </View>
          )}

          {/* ── Étape 4 : Compte bancaire ── */}
          {step === 4 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Compte bancaire</Text>
              <Text style={s.cardSub}>Pour vos dépôts et retraits de fonds</Text>

              <Field label="Nom de la banque">
                <Select placeholder="Sélectionner…" value={banque} options={BANQUES} onSelect={setBanque} />
              </Field>

              <Field label="Titulaire du compte">
                <StyledInput value={titulaire} onChangeText={setTitulaire}
                  placeholder="Nom complet du titulaire" />
              </Field>

              <Field label="RIB (Relevé d'Identité Bancaire)">
                <StyledInput value={rib} onChangeText={setRib}
                  placeholder="001 810 0000123456789012 34"
                  keyboardType="numeric" maxLength={30} />
              </Field>

              <Field label="IBAN (optionnel)">
                <StyledInput value={iban} onChangeText={setIban}
                  placeholder="MA64 0011 1000 0012 3456 7890 1234" />
              </Field>

              <NavRow onPrev={() => goTo(3)} onSkip={() => goTo(5)} onNext={() => goTo(5)} nextLabel="Terminer ✓" />
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles globaux ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  header:      { alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.panel },
  headerTitle: { fontSize: 16, fontWeight: '700', color: C.txt },
  headerSub:   { fontSize: 11, color: C.accent, marginTop: 2 },
  card:        { backgroundColor: C.panel, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: C.line },
  cardTitle:   { fontSize: 18, fontWeight: '700', color: C.txt, marginBottom: 4 },
  cardSub:     { fontSize: 12, color: C.muted, marginBottom: 20 },
  finalWrap:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  finalIcon:   { fontSize: 64, marginBottom: 24 },
  finalTitle:  { fontSize: 24, fontWeight: '800', color: C.txt, textAlign: 'center', marginBottom: 12 },
  finalSub:    { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 40 },
  finalBtn:    { backgroundColor: C.accent, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 36 },
  finalBtnTxt: { fontSize: 16, fontWeight: '700', color: '#000' },
});
