// «Más»: acceso a cuentas, categorías, presupuestos, programados, seguridad, copias y ajustes.

import { section, list, row, tile, notice } from '../ui/components.js';
import { ago } from '../ui/format.js';
import { confirmDialog } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { lockNow, resetApp } from '../ui/session.js';
import { pwa, promptInstall, applyUpdate } from '../ui/pwa.js';
import * as router from '../ui/router.js';
import * as store from '../core/store.js';
import * as vault from '../core/vault.js';
import { AUTO_LOCK_OPTIONS } from '../core/catalog.js';
import { getAppearance, colorLabel, MODE_OPTIONS } from '../ui/theme.js';

async function deleteEverything() {
  const confirmed = await confirmDialog({
    title: '¿Borrar todos los datos?',
    text: 'Se borrará todo lo guardado en este dispositivo: cuentas, movimientos, deudas y ajustes. Sin una copia de seguridad no podrás recuperarlo. Escribe BORRAR para confirmar.',
    confirmLabel: 'Borrar todo',
    danger: true,
    requireText: 'BORRAR',
  });
  if (!confirmed) return;
  try {
    await vault.destroy();
  } catch (error) {
    console.error(error);
    toast('No se han podido borrar los datos. Inténtalo de nuevo.', { kind: 'error' });
    return;
  }
  resetApp();
  toast('Se han borrado todos los datos.');
}

export function moreView() {
  const state = store.getState();
  const go = (path) => () => router.navigate(path);
  const autoLock = AUTO_LOCK_OPTIONS.find((o) => o.seconds === state.settings.autoLockSec)?.label ?? '';
  const lastBackup = state.settings.lastBackupAt;
  const count = (n) => (n ? String(n) : null);
  const appearance = getAppearance();
  const modeLabel = MODE_OPTIONS.find((o) => o.value === appearance.mode)?.label ?? '';

  return {
    title: 'Más',
    body: [
      pwa.updateReady ? notice({
        iconName: 'refresh',
        title: 'Hay una versión nueva',
        text: 'Actualiza para tener las últimas mejoras.',
        actions: [{ label: 'Actualizar', primary: true, onClick: () => store.flush().finally(applyUpdate) }],
      }) : null,
      section({ title: 'Tus datos' }, list([
        row({ lead: tile({ icon: 'building-bank', color: 'blue' }), title: 'Cuentas', value: count(state.accounts.filter((a) => !a.archived).length), chevron: true, onClick: go('/mas/cuentas') }),
        row({ lead: tile({ icon: 'tag', color: 'orange' }), title: 'Categorías', chevron: true, onClick: go('/mas/categorias') }),
        row({ lead: tile({ icon: 'target', color: 'green' }), title: 'Presupuestos', value: count(state.budgets.length), chevron: true, onClick: go('/mas/presupuestos') }),
        row({ lead: tile({ icon: 'repeat', color: 'purple' }), title: 'Programados', subtitle: 'Alquiler, nómina, suscripciones…', value: count(state.recurring.filter((r) => r.active).length), chevron: true, onClick: go('/mas/programados') }),
      ])),
      section({ title: 'Seguridad y copias' }, list([
        row({ lead: tile({ icon: 'shield-lock', color: 'graphite' }), title: 'Seguridad', subtitle: `PIN · bloqueo ${autoLock.toLowerCase()}`, chevron: true, onClick: go('/mas/seguridad') }),
        row({ lead: tile({ icon: 'download', color: 'teal' }), title: 'Copia de seguridad', subtitle: lastBackup ? `Última: ${ago(lastBackup)}` : 'Aún no has hecho ninguna', chevron: true, onClick: go('/mas/copias') }),
        row({ lead: tile({ icon: 'lock', color: 'gray' }), title: 'Bloquear ahora', onClick: () => lockNow() }),
      ])),
      section({ title: 'App' }, list([
        row({ lead: tile({ icon: 'brush', color: 'pink' }), title: 'Apariencia', subtitle: `${modeLabel} · ${colorLabel(appearance.color)}`, chevron: true, onClick: go('/mas/apariencia') }),
        !pwa.isStandalone && pwa.canPromptInstall
          ? row({ lead: tile({ icon: 'device-mobile', color: 'indigo' }), title: 'Instalar la app', onClick: () => promptInstall() })
          : null,
        row({ lead: tile({ icon: 'info-circle', color: 'cyan' }), title: 'Acerca de y privacidad', chevron: true, onClick: go('/mas/acerca') }),
      ])),
      section({ caption: 'Borra todas las cuentas, movimientos, deudas y ajustes de este dispositivo.' },
        list([row({ title: 'Borrar todos los datos', className: 'danger', onClick: deleteEverything })], { plain: true })),
    ],
  };
}
