import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * A small pop-up menu under a button: items are { label, icon?, run, danger?,
 * disabled? } or null for a divider. Closes on a choice, a click elsewhere,
 * Escape, scrolling or resizing.
 */
let open = null;

export function closeMenu() {
  if (!open) return;
  open.node.remove();
  open.anchor.classList.remove('menu-open');
  window.removeEventListener('pointerdown', open.outside, true);
  window.removeEventListener('keydown', open.key, true);
  window.removeEventListener('resize', closeMenu);
  window.removeEventListener('scroll', closeMenu, true);
  open = null;
}

export function openMenu(anchor, items) {
  const again = open?.anchor === anchor;
  closeMenu();
  if (again) return; // a second click on the same button closes it
  const node = h(
    'div',
    { class: 'menu', role: 'menu' },
    items.map((item) =>
      item === null
        ? h('div', { class: 'menu-divider', role: 'separator' })
        : h(
            'button',
            {
              class: item.danger ? 'danger' : '',
              role: 'menuitem',
              disabled: item.disabled,
              onclick: (event) => {
                event.stopPropagation();
                closeMenu();
                item.run();
              },
            },
            item.icon ? icon(item.icon, 15) : h('span', { class: 'menu-spacer' }),
            item.label,
          ),
    ),
  );
  document.body.append(node);
  const box = anchor.getBoundingClientRect();
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  const left = Math.min(Math.max(box.right - width, 8), window.innerWidth - width - 8);
  const below = box.bottom + 4 + height < window.innerHeight - 8;
  node.style.left = `${left}px`;
  node.style.top = `${below ? box.bottom + 4 : Math.max(box.top - height - 4, 8)}px`;
  anchor.classList.add('menu-open');
  const outside = (event) => {
    if (!node.contains(event.target) && !anchor.contains(event.target)) closeMenu();
  };
  const key = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeMenu();
    }
  };
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('keydown', key, true);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, true);
  open = { node, anchor, outside, key };
  node.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
