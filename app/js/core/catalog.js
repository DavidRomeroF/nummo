// Catálogos cerrados (listas blancas): colores, iconos, tipos de cuenta y categorías iniciales.
// Guardar claves de una lista cerrada (y no colores o SVG libres) impide inyectar CSS o marcado.

/** Claves de color; su valor visual está en css/app.css (.tone-<clave>). */
export const COLOR_KEYS = [
  'blue', 'indigo', 'purple', 'pink', 'red', 'orange', 'amber', 'green', 'teal', 'cyan', 'brown', 'gray', 'graphite',
];

/** Iconos disponibles en los selectores de cuentas y categorías (deben existir en ui/icon-data.js). */
export const PICKER_ICONS = [
  'shopping-cart', 'basket', 'tools-kitchen-2', 'coffee', 'pizza', 'beer', 'glass-full', 'cake',
  'home', 'building', 'bulb', 'droplet', 'flame', 'wifi', 'device-mobile', 'tool', 'hammer', 'plant-2',
  'bus', 'car', 'gas-station', 'parking', 'train', 'plane', 'bike', 'motorbike', 'world', 'beach',
  'device-tv', 'movie', 'music', 'device-gamepad-2', 'ticket', 'book', 'school', 'camera', 'headphones',
  'device-laptop', 'cloud', 'shopping-bag', 'shirt', 'hanger', 'diamond', 'scissors', 'brush', 'package',
  'truck', 'first-aid-kit', 'pill', 'dental', 'stethoscope', 'barbell', 'ball-football', 'swimming',
  'paw', 'baby-carriage', 'heart', 'users', 'user', 'gift', 'confetti', 'umbrella', 'shield', 'receipt',
  'file-invoice', 'building-bank', 'credit-card', 'cash', 'cash-banknote', 'wallet', 'pig-money', 'coin',
  'coins', 'chart-line', 'trending-up', 'briefcase', 'receipt-refund', 'report-money', 'currency-euro',
  'tag', 'star', 'dots',
];

export const ACCOUNT_TYPES = [
  { key: 'bank', label: 'Cuenta bancaria', icon: 'building-bank' },
  { key: 'card', label: 'Tarjeta', icon: 'credit-card' },
  { key: 'cash', label: 'Efectivo', icon: 'cash' },
  { key: 'savings', label: 'Ahorro', icon: 'pig-money' },
  { key: 'investment', label: 'Inversión', icon: 'chart-line' },
  { key: 'other', label: 'Otra', icon: 'wallet' },
];
export const ACCOUNT_TYPE_KEYS = ACCOUNT_TYPES.map((t) => t.key);
export const accountTypeInfo = (key) => ACCOUNT_TYPES.find((t) => t.key === key) ?? ACCOUNT_TYPES.at(-1);

/** Cuentas que se proponen al empezar (la persona las edita o borra). */
export const DEFAULT_ACCOUNTS = [
  { name: 'Efectivo', type: 'cash', icon: 'cash', color: 'green' },
  { name: 'Cuenta bancaria', type: 'bank', icon: 'building-bank', color: 'blue' },
];

export const DEFAULT_CATEGORIES = [
  { kind: 'expense', name: 'Supermercado', icon: 'shopping-cart', color: 'teal' },
  { kind: 'expense', name: 'Restaurantes', icon: 'tools-kitchen-2', color: 'orange' },
  { kind: 'expense', name: 'Casa', icon: 'home', color: 'blue' },
  { kind: 'expense', name: 'Facturas', icon: 'bulb', color: 'amber' },
  { kind: 'expense', name: 'Transporte', icon: 'bus', color: 'cyan' },
  { kind: 'expense', name: 'Gasolina', icon: 'gas-station', color: 'brown' },
  { kind: 'expense', name: 'Suscripciones', icon: 'device-tv', color: 'indigo' },
  { kind: 'expense', name: 'Ocio', icon: 'movie', color: 'pink' },
  { kind: 'expense', name: 'Compras', icon: 'shopping-bag', color: 'purple' },
  { kind: 'expense', name: 'Ropa', icon: 'shirt', color: 'pink' },
  { kind: 'expense', name: 'Salud', icon: 'first-aid-kit', color: 'red' },
  { kind: 'expense', name: 'Deporte', icon: 'barbell', color: 'green' },
  { kind: 'expense', name: 'Viajes', icon: 'plane', color: 'blue' },
  { kind: 'expense', name: 'Educación', icon: 'school', color: 'indigo' },
  { kind: 'expense', name: 'Mascotas', icon: 'paw', color: 'amber' },
  { kind: 'expense', name: 'Regalos', icon: 'gift', color: 'red' },
  { kind: 'expense', name: 'Otros gastos', icon: 'dots', color: 'gray' },
  { kind: 'income', name: 'Nómina', icon: 'briefcase', color: 'green' },
  { kind: 'income', name: 'Ingresos extra', icon: 'coins', color: 'teal' },
  { kind: 'income', name: 'Reembolsos', icon: 'receipt-refund', color: 'cyan' },
  { kind: 'income', name: 'Regalos recibidos', icon: 'gift', color: 'pink' },
  { kind: 'income', name: 'Intereses', icon: 'trending-up', color: 'blue' },
  { kind: 'income', name: 'Otros ingresos', icon: 'dots', color: 'gray' },
];

export const AUTO_LOCK_OPTIONS = [
  { seconds: 0, label: 'Inmediatamente' },
  { seconds: 60, label: 'Tras 1 minuto' },
  { seconds: 300, label: 'Tras 5 minutos' },
  { seconds: 900, label: 'Tras 15 minutos' },
];
export const DEFAULT_AUTO_LOCK = 60;
