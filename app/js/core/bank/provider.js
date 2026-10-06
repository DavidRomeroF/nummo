// Interfaz común de los proveedores de Open Banking. El resto de Nummo solo conoce esta forma, así
// que añadir otro agregador (Tink, GoCardless…) o la API directa de un banco no obliga a tocar la
// sincronización, el modelo ni la interfaz.
//
// Un proveedor es un objeto con:
//   id                                   'enablebanking'
//   label                                'Enable Banking'
//   listBanks(country)                → [{ name, country, maxConsentDays, beta }]
//   startAuth({ bankName, country, redirectUrl, state, validUntil })  → { url }
//   finishAuth(code)                  → { sessionId, validUntil, accounts: [BankAccount] }
//   getSession(sessionId)             → { status: 'active'|'expired'|'revoked'|'pending', validUntil, accountIds }
//   getBalances(accountId)            → { booked, available, date }   (céntimos o null)
//   getTransactions(accountId, { dateFrom, cursor }) → { items: [RawTransaction], cursor }
//   revoke(sessionId)
//
// BankAccount: { externalId, iban, name, currency, product }
// RawTransaction: ver core/import/normalize.js.
//
// Todos los fallos se lanzan como BankError con un código estable y un mensaje en español sin datos
// de la persona (ni importes, ni IBAN, ni conceptos), apto para mostrarse y para el registro.

export const BANK_ERROR_MESSAGES = {
  network: 'No se ha podido contactar con el servicio del banco. Comprueba la conexión.',
  blocked: 'El navegador no puede llamar directamente a Enable Banking. Configura el intermediario (Cloudflare Worker) en Bancos → Aplicación de Enable Banking.',
  timeout: 'El banco ha tardado demasiado en responder. Inténtalo más tarde.',
  app_auth: 'Enable Banking no reconoce la aplicación. Revisa el identificador y la clave privada.',
  expired: 'El permiso para leer tus cuentas ha caducado. Vuelve a conectar el banco.',
  revoked: 'El permiso para leer tus cuentas se ha retirado. Vuelve a conectar el banco.',
  rate_limit: 'El banco limita las consultas (unas 4 al día). Se volverá a intentar en unas horas.',
  period: 'El banco no da movimientos de un periodo tan largo.',
  unavailable: 'El banco no está disponible ahora mismo. Se volverá a intentar más tarde.',
  invalid: 'El banco ha rechazado la petición.',
  bad_response: 'El banco ha enviado una respuesta que no se entiende.',
  state: 'La vuelta desde el banco no corresponde a ninguna conexión iniciada aquí. Vuelve a empezar.',
  denied: 'Has cancelado o rechazado el permiso en el banco.',
  no_secrets: 'Falta configurar la aplicación de Enable Banking.',
};

export class BankError extends Error {
  /** detail: código técnico corto del proveedor (p. ej. ASPSP_RATE_LIMIT_EXCEEDED), sin datos personales. */
  constructor(code, { detail = '', retryAfterMs = 0 } = {}) {
    super(BANK_ERROR_MESSAGES[code] ?? BANK_ERROR_MESSAGES.invalid);
    this.name = 'BankError';
    this.code = BANK_ERROR_MESSAGES[code] ? code : 'invalid';
    this.detail = typeof detail === 'string' ? detail.replace(/[^A-Z0-9_]/gi, '').slice(0, 40) : '';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Errores tras los que no tiene sentido reintentar sin que la persona haga algo. */
export const NEEDS_USER = new Set(['app_auth', 'expired', 'revoked', 'denied', 'state', 'no_secrets', 'blocked']);
