import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * A small pop-up menu under a button: items are { label, icon?, run, danger?,
 * disabled?, hint? } or null for a divider. An item with `items` instead of
 * `run` opens a second menu beside it, like "Metal ›" in an add menu; a text
 * item ({ heading }) is a small title. Closes on a choice, a click elsewhere,
 * Escape, scrolling or resizing.
 */
let open = null;

export function closeMenu() {
  if (!open) return;
  open.node.remove();
  open.sub?.remove();
  open.anchor.classList.remove('menu-open');
  window.removeEventListener('pointerdown', open.outside, true);
  window.removeEventListener('keydown', open.key, true);
  window.removeEventListener('resize', closeMenu);
  window.removeEventListener('scroll', closeMenu, true);
  open = null;
}

function closeSubmenu() {
  if (!open?.sub) return;
  open.sub.remove();
  open.sub = null;
  open.subOwner?.classList.remove('open');
  open.subOwner = null;
}

function menuNode(items, { onSubmenu }) {
  return h(
    'div',
    { class: 'menu', role: 'menu' },
    items.map((item) => {
      if (item === null) return h('div', { class: 'menu-divider', role: 'separator' });
      if (item.heading) return h('div', { class: 'menu-heading' }, item.heading);
      const node = h(
        'button',
        {
          class: [item.danger ? 'danger' : '', item.items ? 'has-submenu' : ''].join(' '),
          role: 'menuitem',
          disabled: item.disabled,
          title: item.hint || null,
          'aria-haspopup': item.items ? 'menu' : null,
          onmouseenter: () => onSubmenu(item.items ? node : null, item.items),
          onclick: (event) => {
            event.stopPropagation();
            if (item.items) {
              onSubmenu(node, item.items, true);
              return;
            }
            closeMenu();
            item.run();
          },
          onkeydown: (event) => {
            if (item.items && event.key === 'ArrowRight') {
              event.preventDefault();
              onSubmenu(node, item.items, true);
            }
          },
        },
        item.icon ? icon(item.icon, 15) : item.swatch ? h('span', { class: 'menu-swatch', style: { background: item.swatch } }) : h('span', { class: 'menu-spacer' }),
        h('span', { class: 'menu-label' }, item.label),
        item.items ? icon('chevronRight', 14) : null,
      );
      return node;
    }),
  );
}

function place(node, { left, right, top, bottom }) {
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  const x = right !== undefined && right + width < window.innerWidth - 8 ? right : Math.max((left ?? right) - width, 8);
  const y = top + height < window.innerHeight - 8 ? top : Math.max((bottom ?? top) - height, 8);
  node.style.left = `${Math.min(x, window.innerWidth - width - 8)}px`;
  node.style.top = `${y}px`;
}

export function openMenu(anchor, items) {
  const again = open?.anchor === anchor;
  closeMenu();
  if (again) return; // a second click on the same button closes it

  const onSubmenu = (owner, subItems, focus = false) => {
    if (!open) return;
    if (open.subOwner === owner && owner) {
      if (focus) open.sub.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
      return;
    }
    closeSubmenu();
    if (!owner) return;
    const sub = menuNode(subItems, { onSubmenu: () => {} });
    sub.classList.add('submenu');
    sub.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        const back = open.subOwner;
        closeSubmenu();
        back?.focus({ preventScroll: true });
      }
    });
    document.body.append(sub);
    const box = owner.getBoundingClientRect();
    place(sub, { right: box.right + 2, left: box.left - 2, top: box.top - 5, bottom: box.bottom + 5 });
    owner.classList.add('open');
    open.sub = sub;
    open.subOwner = owner;
    if (focus) sub.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  };

  const node = menuNode(items, { onSubmenu });
  document.body.append(node);
  const box = anchor.getBoundingClientRect();
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  // Opens to the right of the button, like an add menu in a tree; otherwise under it.
  const left = Math.min(Math.max(box.left, 8), window.innerWidth - width - 8);
  const below = box.bottom + 4 + height < window.innerHeight - 8;
  node.style.left = `${left}px`;
  node.style.top = `${below ? box.bottom + 4 : Math.max(box.top - height - 4, 8)}px`;
  anchor.classList.add('menu-open');
  const outside = (event) => {
    const inside = node.contains(event.target) || open?.sub?.contains(event.target) || anchor.contains(event.target);
    if (!inside) closeMenu();
  };
  const key = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeMenu();
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const list = open?.sub?.contains(document.activeElement) ? open.sub : node;
      const buttons = [...list.querySelectorAll('button:not(:disabled)')];
      if (buttons.length === 0) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
      buttons[(next + buttons.length) % buttons.length].focus({ preventScroll: true });
    }
  };
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('keydown', key, true);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, true);
  open = { node, anchor, outside, key, sub: null, subOwner: null };
  node.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
