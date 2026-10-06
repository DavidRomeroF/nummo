// Proveedor Enable Banking (documentación: enablebanking.com/docs/api/reference).
// ÚNICO módulo de la app con permiso para hacer peticiones de red (lo comprueba tools/release.py y
// la CSP solo permite conectar con api.enablebanking.com).
//
// Modo «restricted production» (gratuito): la persona registra SU propia aplicación en Enable
// Banking, vincula allí sus cuentas y pega en Nummo el identificador y la clave privada (.pem).
// Con esa clave solo se accede a las cuentas vinculadas por ella, en modo lectura (AIS).

import { signAppJwt } from './jwt.js';
import { BankError } from './provider.js';
import { isISODate } from '../dates.js';
import { MAX_CENTS } from '../money.js';

export const API_BASE = 'https://api.enablebanking.com';
/**
 * La API de Enable Banking no admite llamadas desde una web (CORS). Por eso las peticiones pueden
 * pasar por un intermediario propio en Cloudflare Workers (tools/enablebanking-proxy/), que solo
 * reenvía: la clave privada sigue en el dispositivo y firma cada petición aquí.
 * La CSP de la app solo permite conectar con *.workers.dev además de la API.
 */
export const PROXY_RE = /^https:\/\/[a-z0-9-]{1,63}\.[a-z0-9-]{1,63}\.workers\.dev$/;
export function normalizeProxyUrl(value) {
  const url = String(value ?? '').trim().replace(/\/+$/, '').toLowerCase();
  return PROXY_RE.test(url) ? url : null;
}
const TIMEOUT_MS = 25_000;
const MAX_PAGES = 30;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** «-27.07» / «1234.5» → céntimos. El signo viene aparte (credit_debit_indicator). */
export function decimalToCents(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  const m = /^(-)?(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (cents > MAX_CENTS) return null;
  return m[1] ? -cents : cents;
}

const dateOrNull = (v) => (typeof v === 'string' && isISODate(v.slice(0, 10)) ? v.slice(0, 10) : null);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

const PRODUCT_BY_TYPE = { CACC: 'current', SVGS: 'savings', CARD: 'card', TRAN: 'current', LOAN: 'other', MOMA: 'savings' };

/** Apunte de Enable Banking → apunte bruto de Nummo. */
export function mapTransaction(t) {
  if (!t || typeof t !== 'object') return null;
  const raw = decimalToCents(t.transaction_amount?.amount);
  if (raw === null || raw === 0) return null;
  const credit = t.credit_debit_indicator === 'CRDT';
  const amount = raw < 0 ? raw : credit ? raw : -raw;
  const bdate = dateOrNull(t.booking_date) ?? dateOrNull(t.value_date) ?? dateOrNull(t.transaction_date);
  if (!bdate) return null;
  const remittance = Array.isArray(t.remittance_information) ? t.remittance_information.filter((r) => typeof r === 'string').join(' ') : str(t.remittance_information);
  const party = amount < 0 ? t.creditor : t.debtor;
  const partyAccount = amount < 0 ? t.creditor_account : t.debtor_account;
  const text = remittance || str(party?.name) || str(t.bank_transaction_code?.description) || 'Movimiento';
  const bal = decimalToCents(t.balance_after_transaction?.amount);
  const ext = str(t.transaction_id, 100) || str(t.entry_reference, 100);
  return {
    ext: ext ? `eb:${ext}` : '',
    bdate,
    vdate: dateOrNull(t.transaction_date) ?? dateOrNull(t.value_date),
    amount,
    currency: str(t.transaction_amount?.currency, 3) || 'EUR',
    text,
    cp: str(party?.name, 80),
    cpIban: str(partyAccount?.iban, 40),
    status: t.status === 'PDNG' || t.status === 'PEND' ? 'pending' : 'booked',
    bal,
    mcc: /^\d{4}$/.test(str(t.merchant_category_code, 4)) ? t.merchant_category_code : '',
  };
}

const BOOKED_TYPES = ['CLBD', 'ITBD', 'XPCD', 'OPBD', 'PRCD', 'VALU'];
const AVAILABLE_TYPES = ['ITAV', 'CLAV', 'XPCD', 'OPAV', 'FWAV'];

export function mapBalances(body) {
  const list = Array.isArray(body?.balances) ? body.balances : [];
  const pick = (types) => {
    for (const type of types) {
      const found = list.find((b) => b?.balance_type === type && decimalToCents(b.balance_amount?.amount) !== null);
      if (found) return found;
    }
    return null;
  };
  const booked = pick(BOOKED_TYPES) ?? list.find((b) => decimalToCents(b?.balance_amount?.amount) !== null) ?? null;
  const available = pick(AVAILABLE_TYPES);
  return {
    booked: booked ? decimalToCents(booked.balance_amount.amount) : null,
    available: available ? decimalToCents(available.balance_amount.amount) : null,
    date: dateOrNull(booked?.reference_date) ?? dateOrNull(booked?.last_change_date_time),
  };
}

function mapAccount(a) {
  if (!a || typeof a.uid !== 'string') return null;
  return {
    externalId: a.uid.slice(0, 100),
    iban: str(a.account_id?.iban, 40),
    name: str(a.name, 60) || str(a.details, 60) || str(a.product, 60),
    currency: /^[A-Z]{3}$/.test(a.currency ?? '') ? a.currency : 'EUR',
    product: PRODUCT_BY_TYPE[a.cash_account_type] ?? 'other',
  };
}

const SESSION_STATUS = { AUTHORIZED: 'active', EXPIRED: 'expired', REVOKED: 'revoked', CLOSED: 'revoked', INVALID: 'revoked', PENDING_AUTHORIZATION: 'pending', PENDING: 'pending' };

/**
 * Crea el proveedor. privateKey: CryptoKey no extraíble (jwt.js). fetchImpl solo se cambia en tests.
 */
export function createEnableBankingProvider({ appId, privateKey, proxyUrl = null, fetchImpl = (...a) => globalThis.fetch(...a), now = () => Date.now() }) {
  if (typeof appId !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(appId)) throw new BankError('app_auth');
  const base = proxyUrl === null ? API_BASE : normalizeProxyUrl(proxyUrl);
  if (!base) throw new BankError('blocked');

  async function request(method, path, { body = null, query = null } = {}) {
    const url = new URL(path, base);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    const jwt = await signAppJwt(privateKey, appId, { now: now() });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(url.href, {
        method,
        headers: { Authorization: `Bearer ${jwt}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        mode: 'cors',
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new BankError('timeout');
      // TypeError: sin red o bloqueado por CORS (el navegador no distingue uno de otro).
      throw new BankError(navigator.onLine === false ? 'network' : 'blocked');
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new BankError('bad_response');
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      if (response.ok) throw new BankError('bad_response');
    }
    if (response.ok) return data;
    const detail = typeof data?.error === 'string' ? data.error : '';
    const retry = Number(response.headers.get('retry-after'));
    if (response.status === 429 || /RATE_LIMIT/.test(detail)) {
      throw new BankError('rate_limit', { detail, retryAfterMs: Number.isFinite(retry) && retry > 0 ? retry * 1000 : 6 * 3_600_000 });
    }
    if (/EXPIRED/.test(detail)) throw new BankError('expired', { detail });
    if (/REVOKED|CLOSED_SESSION|INVALID_SESSION/.test(detail)) throw new BankError('revoked', { detail });
    if (/TRANSACTIONS_PERIOD/.test(detail)) throw new BankError('period', { detail });
    if (response.status === 401 || response.status === 403) throw new BankError('app_auth', { detail });
    if (response.status >= 500 || /ASPSP_ERROR|ASPSP_UNAVAILABLE|TIMEOUT/.test(detail)) throw new BankError('unavailable', { detail });
    throw new BankError('invalid', { detail });
  }

  return {
    id: 'enablebanking',
    label: 'Enable Banking',

    async listBanks(country = 'ES') {
      // Sin filtros en la petición: algunos bancos no declaran el tipo de servicio y desaparecerían.
      const data = await request('GET', '/aspsps', { query: { country } });
      const list = Array.isArray(data?.aspsps) ? data.aspsps : [];
      return list
        .filter((a) => typeof a?.name === 'string')
        .filter((a) => !Array.isArray(a.psu_types) || !a.psu_types.length || a.psu_types.includes('personal'))
        .map((a) => ({
          name: a.name.slice(0, 60),
          country: str(a.country, 2) || country,
          maxConsentDays: Number.isFinite(a.maximum_consent_validity) ? Math.floor(a.maximum_consent_validity / 86_400) : 90,
          beta: a.beta === true,
        }))
        .sort((x, y) => x.name.localeCompare(y.name, 'es'));
    },

    async startAuth({ bankName, country, redirectUrl, state, validUntil }) {
      const data = await request('POST', '/auth', {
        body: {
          access: { valid_until: new Date(validUntil).toISOString() },
          aspsp: { name: bankName, country },
          state,
          redirect_url: redirectUrl,
          psu_type: 'personal',
          language: 'es',
        },
      });
      const url = typeof data?.url === 'string' ? data.url : '';
      if (!/^https:\/\//.test(url)) throw new BankError('bad_response');
      return { url };
    },

    async finishAuth(code) {
      if (typeof code !== 'string' || !code || code.length > 2000) throw new BankError('state');
      const data = await request('POST', '/sessions', { body: { code } });
      if (typeof data?.session_id !== 'string') throw new BankError('bad_response');
      const validUntil = Date.parse(data.access?.valid_until ?? '');
      return {
        sessionId: data.session_id.slice(0, 100),
        validUntil: Number.isFinite(validUntil) ? validUntil : null,
        accounts: (Array.isArray(data.accounts) ? data.accounts : []).map(mapAccount).filter(Boolean),
      };
    },

    async getSession(sessionId) {
      const data = await request('GET', `/sessions/${encodeURIComponent(sessionId)}`);
      const validUntil = Date.parse(data?.access?.valid_until ?? '');
      return {
        status: SESSION_STATUS[data?.status] ?? 'pending',
        validUntil: Number.isFinite(validUntil) ? validUntil : null,
        accountIds: Array.isArray(data?.accounts) ? data.accounts.filter((x) => typeof x === 'string') : [],
      };
    },

    async getBalances(accountId) {
      return mapBalances(await request('GET', `/accounts/${encodeURIComponent(accountId)}/balances`));
    },

    async getTransactions(accountId, { dateFrom = null, cursor = null } = {}) {
      const data = await request('GET', `/accounts/${encodeURIComponent(accountId)}/transactions`, {
        query: { date_from: dateFrom, continuation_key: cursor },
      });
      const items = (Array.isArray(data?.transactions) ? data.transactions : []).map(mapTransaction).filter(Boolean);
      const next = typeof data?.continuation_key === 'string' && data.continuation_key ? data.continuation_key : null;
      return { items, cursor: next };
    },

    async revoke(sessionId) {
      await request('DELETE', `/sessions/${encodeURIComponent(sessionId)}`);
    },

    maxPages: MAX_PAGES,
  };
}
