import BiMap from '../other/bimap.js';
import Boo from 'https://esm.sh/@camilaprav/boo@1.0.6';
import actions from '../other/actions.js';
import htmlsnap from 'https://esm.sh/@camilaprav/htmlsnap@0.0.16';
import morphdom from 'https://esm.sh/morphdom';
import prettier from '../other/prettier.js';
import rfiles from '../repos/rfiles.js';
import { arrayify, debounce } from '../other/util.js';
import { defaultHead } from '../other/templates.js';

let TAILWIND_HUES = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'slate', 'gray', 'zinc', 'neutral', 'stone'];
let TAILWIND_SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
let TAILWIND_HUE_SET = new Set(TAILWIND_HUES);
let TAILWIND_SHADE_SET = new Set(TAILWIND_SHADES);
let TEXT_COLOR_RE = new RegExp(`^text-(${TAILWIND_HUES.join('|')})-(${TAILWIND_SHADES.join('|')})$`);
let BG_COLOR_RE = new RegExp(`^bg-(${TAILWIND_HUES.join('|')})-(${TAILWIND_SHADES.join('|')})$`);
let DEFAULT_SHADE = '500';

let parseHueArgs = (args, fallbackCur) => {
  if (!args.length) return { cur: fallbackCur, hue: null };
  if (args.length === 1) return { cur: fallbackCur, hue: args[0] };
  return { cur: args[0] ?? fallbackCur, hue: args[1] };
};

let parseShadeArgs = (args, fallbackCur) => {
  if (!args.length) return { cur: fallbackCur, shade: null };
  if (args.length === 1) return { cur: fallbackCur, shade: args[0] };
  return { cur: args[0] ?? fallbackCur, shade: args[1] };
};

export default class Designer {
  state = {
    toolbar: 'manipulation',
    list: [],

    frameVisible(path) {
      let frame = this.list.find(x => x.path === path);
      return state.files.current === path && frame.ready;
    },

    src(path) {
      let frame = this.list.find(x => x.path === path);
      let [name, uuid] = state.projects.current.split(':');
      if (frame.preview) path = path.slice('pages/'.length);
      let fullpath = `/${frame.preview ? 'preview' : 'files'}/${sessionStorage.webfoundryTabId}/${name}:${uuid}/${path}`;
      return state.settings.opt.isolate
        ? `${location.protocol}//${(name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}.${location.hostname}:8846${fullpath}?isolate`
        : fullpath;
    },

    get current() { return this.list.find(x => x.path === state.files.current) },
    get open() { return this.current?.ready },
    frameWidth: 'calc(100% - 1rem)',
    frameHeight: '100%',
    clipboards: {},

    get tagLabel() {
      let s = this.current.cursors[state.collab.uid];
      if (s?.length !== 1) return 'Tag';
      return `<${this.current.map.get(s[0]).tagName.toLowerCase()}>`;
    },

    selClass: cls => (this.state.current.cursors[state.collab.uid] || []).filter(x => {
      x = this.state.current.map.get(x);
      if (typeof cls === 'string') return x.classList.contains(cls);
      for (let y of x.classList) if (cls.test(y)) return true;
      return false;
    }).length,

    get selHue() {
      let ss = (this.current.cursors[state.collab.uid] || []).map(x => this.current.map.get(x));
      for (let s of ss) for (let cls of s.classList) { let match = cls.match(TEXT_COLOR_RE); if (match) return match[1] }
    },

    get selBgHue() {
      let ss = (this.current.cursors[state.collab.uid] || []).map(x => this.current.map.get(x));
      for (let s of ss) for (let cls of s.classList) { let match = cls.match(BG_COLOR_RE); if (match) return match[1] }
    },
  };

  actions = {
    init: async () => {
      let { bus } = state.event;
      {
        let res = await fetch('other/gfonts.json');
        let raw = await res.json();
        let idx = { 'Serif': [], 'Sans-serif': [], 'Monospace': [], 'Display': [], 'Handwriting': [] };
        let mapCat = { 'serif': 'Serif', 'sans-serif': 'Sans-serif', 'monospace': 'Monospace', 'display': 'Display', 'handwriting': 'Handwriting' };
        for (let [name, meta] of Object.entries(raw || {})) {
          let key = mapCat[(meta?.category || '').toLowerCase()] || null;
          if (key) idx[key].push(name);
        }
        this.state.gfontsreg = idx;
      }
      bus.on('projects:select:ready', async () => await post('designer.reset'));
      bus.on('files:select:ready', async ({ path }) => {
        if (!/^(components|pages)\/.*\.html$/.test(path)) return;
        await post('designer.select', path);
      });
      //bus.on('settings:projects:option:ready', async () => await post('designer.refresh'));
      bus.on('files:change', async ({ path }) => {
        if (!state.projects.current) return; // ???
        let name = state.projects.current.split(':')[0];
        if (!path.startsWith(`${name}/`)) return;
        //this.state.open && state.files.current === path.slice(`${name}/`.length) && await post('designer.repatch');
      });
      bus.on('files:rm', async ({ path }) => {
        let name = state.projects.current.split(':')[0];
        if (!path.startsWith(`${name}/`)) return;
        path = path.slice(`${name}/`.length);
        if (state.files.current === path) { await post('files.select', null); this.state.list = this.state.list.filter(x => x.path !== path); d.update() }
      });
      addEventListener('message', async ev => {
        if (location.origin !== ev.origin) {
          let url = new URL(ev.origin);
          let parts = url.hostname.split('.');
          let domain = parts.slice(1).join('.');
          let name = parts[0];
          if (domain !== location.hostname || !state.projects.current.startsWith(`${name}:`)) return; // FIXME: Also check path.
        }
        let project = state.projects.current;
        let frame = this.state.list.find(x => x.path === ev.data.path);
        switch (ev.data.type) {
          case 'ready':
            if (ev.data.status !== 200) return frame.reject(ev.data.error);
            frame.ready = true;
            frame.resolve();
            await post('designer.sync', frame);
            break;
          case 'htmlsnap': {
            this.state.current.snap = ev.data.snap;
            let doc = new DOMParser().parseFromString(ev.data.snap, 'text/html');
            if (!frame.doc) frame.doc = doc;
            else {
              morphdom(frame.doc.head, doc.head);
              morphdom(frame.doc.body.firstElementChild, doc.body.firstElementChild);
            }
            htmlsnap(frame.doc.documentElement, { idtrack: true, map: frame.map });
            state.collab.uid === 'master' && await post('designer.save', frame);
            await post('designer.sync', frame);
            state.event.bus.emit('designer:htmlsnap:ready', { project, frame });
            break;
          }
          case 'keydown': await post('designer.keydown', ev.data); break;
          case 'action': await actions[ev.data.key].handler(ev.data); break;
        }
      });
      addEventListener(state.app.mobile ? 'input' : 'keydown', async ev => await post('designer.keydown', ev), true);
    },

    select: async path => {
      if (this.state.list.find(x => x.path === path) || !path?.startsWith?.('pages/')) return;
      let { bus } = state.event;
      let project = state.projects.current;
      let p = Promise.withResolvers();
      this.state.list.push({
        path,
        get html() { return this.doc?.documentElement },
        get head() { return this.doc?.head },
        get body() { return this.doc?.body },
        get root() { return this.body?.firstElementChild },
        preview: false,
        mutobs: null,
        snap: null,
        map: new BiMap(),
        cursors: {},
        lastCursors: {},
        overlays: {},
        history: {},
        ihistory: {},
        resolve: p.resolve,
        reject: p.reject,
      });
      d.update();
      setTimeout(() => p.reject(new Error(`Frame wait timeout`)), 5000);
      await loadman.run('designer.select', async () => {
        try { await p.promise; bus.emit('designer:select:ready', { project, path }) }
        catch (err) { console.error(err); this.state.list = this.state.list.filter(x => x.path !== path); bus.emit('designer:select:error', { project, path, err }) }
      }, true);
    },

    hookFrameWidth: el => d.el(el, { style: { width: () => this.state.frameWidth } }),

    frameAttach: (path, el) => {
      let frame = this.state.list.find(x => x.path === path);
      if (!frame) throw new Error(`Designer frame not found: ${path}`);
      frame.el = el;
    },

    frameLoaded: async (path, err) => {
      let frame = this.state.list.find(x => x.path === path);
      if (!frame) throw new Error(`Designer frame not found: ${path}`);
      if (!frame.el) return; // ???
      let { bus } = state.event;
      if (err) { frame.reject(err); bus.emit('designer:frame:error', { frame, err }); return }
      if (!frame.heightHooked) { d.el(frame.el, { style: { height: () => this.state.frameHeight } }); frame.heightHooked = true }
      bus.emit('designer:frameLoaded:ready', { frame });
    },

    sync: frame => frame.el?.contentWindow?.postMessage?.({
      type: 'state',
      collab: { uid: state.collab.uid, rtc: { presence: state.collab.rtc?.presence } },
      cursors: frame.cursors,
    }, new URL(frame.el.src).origin),

    resize: ev => {
      ev.target.setPointerCapture(ev.pointerId);
      let canvas = document.querySelector('#Canvas');
      let crect = canvas.getBoundingClientRect();
      let lpadder = document.querySelector('.Designer-leftPadder');
      let move = mev => {
        let ifrect = document.querySelector('.Designer-activeFrame').getBoundingClientRect();
        let w = `${Math.max(320, (mev.clientX - (crect.left + crect.width / 2)) * 2)}px`;
        if (parseInt(w, 10) >= crect.width - 16) w = '100%';
        this.state.frameWidth = `min(100% - 1rem, ${w})`;
        d.updateSync();
        let ifs = getComputedStyle(document.querySelector('.Designer-activeFrame'));
        let ifw = Number(ifs.width.replace(/px$/, ''));
        this.state.frameHeight = ifw < 640 ? `min(100%, ${ifw * 1.666}px)` : '100%';
        d.updateSync();
        ifs = getComputedStyle(document.querySelector('.Designer-activeFrame'));
        state.event.bus.emit('designer:resize:ready', { width: ifs.width, height: ifs.height });
      };
      ev.target.addEventListener('pointermove', move);
      ev.target.addEventListener('pointerup', () => {
        ev.target.removeEventListener('pointermove', move);
        ev.target.releasePointerCapture(ev.pointerId);
      }, { once: true });
    },

    toggleMobileKeyboard: async () => {
      if (!state.app.mobile) return;
      let input = (() => {
        if (this.state.mobileKeyboardInput) return this.state.mobileKeyboardInput;
        let input = document.createElement('input');
        input.type = 'text';
        input.id = 'DesignerMobileKeyboardLock';
        input.inputMode = 'text';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocapitalize', 'off');
        Object.assign(input.style, { position: 'fixed', top: '50vh', left: 0, width: '1px', height: '1px', opacity: 0, pointerEvents: 'none', border: 0, padding: 0 });
        input.addEventListener('focus', () => input.setSelectionRange?.(input.value.length, input.value.length));
        input.addEventListener('input', () => { input.value = ''; input.setSelectionRange?.(input.value.length, input.value.length) });
        document.body.append(input);
        input.addEventListener('blur', () => { input.remove(); this.state.mobileKeyboardInput = null });
        this.state.mobileKeyboardInput = input;
        return input;
      })();
      if (this.state.current.cursors[state.collab.uid]?.length && document.activeElement !== input) {
        input.focus({ preventScroll: true });
        input.setSelectionRange?.(input.value.length, input.value.length);
      }
    },

    toolbar: async (k, params) => {
      if (/^(manipulation|tailwind)$/.test(k)) { this.state.toolbar = k; return }
      await actions[k].handler({ cur: state.collab.uid, ...params });
    },

    gfontCategory: x => { this.state.gfontCategory = x; this.state.gfonts = []; document.querySelector('#GFontFocus')?.focus?.() },

    gfontKeyUp: ev => {
      let q = ev.target.value.trim().toLowerCase();
      let list = this.state.gfontsreg[this.state.gfontCategory] || [];
      this.state.gfonts = list.filter(x => x.toLowerCase().includes(q)).map(x => ({ name: x }));
      d.update();
    },

    gfontSample: (x, fnt) => setTimeout(() => x.classList.add(`gfont-[${fnt.replaceAll(' ', '_')}]`), [...x.parentElement.children].indexOf(x) * 200),

    keydown: async ev => {
      let activeEl = document.activeElement;
      let activeTag = activeEl?.tagName || '';
      let isLockInput = activeEl?.id === 'DesignerMobileKeyboardLock';
      if (!isLockInput && /^input|textarea|button$/i.test(activeTag)) {
        if (ev.key === 'Escape' && !ev.target?.closest?.('.CodeMirror')) ev.target.blur();
        return;
      }
      let key = ev.key || ev.data;
      if (ev.altKey && ev.key !== 'Alt') key = `Alt-${key}`;
      if (ev.ctrlKey && ev.key !== 'Control') key = `Ctrl-${key}`;
      if (key === 'Control') key = 'Ctrl';
      let [k, cmd] = [...Object.entries(actions)].find(kv => arrayify(kv[1].shortcut).includes(key)) || [];
      if (!cmd || cmd?.disabled?.({ cur: state.collab.uid })?.filter?.(Boolean)?.length) return;
      ev?.preventDefault?.();
      await cmd.handler({ cur: state.collab.uid });
    },

    pushHistory: async (cur, op) => {
      let frame = this.state.current;
      frame.history[cur] ??= [];
      frame.ihistory[cur] ??= 0;
      if (frame.history[cur].length > frame.ihistory[cur]) frame.history[cur].splice(frame.ihistory[cur], frame.history[cur].length);
      await op(true);
      frame.history[cur].push(op);
      ++frame.ihistory[cur];
    },

    save: debounce(async frame => {
      let project = state.projects.current;
      let body = frame.body.cloneNode(true);
      body.querySelectorAll('.wf-cursor').forEach(x => x.remove());
      body.querySelectorAll('*').forEach(x => x.removeAttribute('data-htmlsnap'));
      body.removeAttribute('data-htmlsnap');
      body.style.display = 'none';
      let betterscroll = true;
      let html = `<!doctype html><html>${defaultHead({ title: frame.head.querySelector('title')?.textContent })}${body.outerHTML}</html>`;
      if (frame.lastSavedHtml === html) return;
      frame.lastSavedHtml = html;
      clearTimeout(frame.saveTimeout);
      frame.saveTimeout = setTimeout(() => frame.saveTimeout = null, 5000);
      await rfiles.save(project, frame.path, new Blob([html], { type: 'text/html' }));
      let phtml = (await prettier(html, { parser: 'html' })).replace(/\{\{[\s\S]*?\}\}/g, m => m .replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/\{\{\s*/g, '{{').replace(/\s*\}\}/g, '}}'));
      if (phtml === html) return state.event.bus.emit('designer:save:ready', { project, path: frame.path });
      await rfiles.save(project, frame.path, new Blob([phtml], { type: 'text/html' }));
      state.event.bus.emit('designer:save:ready', { project, path: frame.path });
    }, 200),

    reset: async () => { this.state.list = []; await post('designer.toggleMobileKeyboard') },

    refresh: async () => {
      let frame = this.state.current;
      let p = Promise.withResolvers();
      Object.assign(frame, { ready: false, resolve: p.resolve, reject: p.reject });
      d.update();
      await loadman.run('designer.refresh', async () => { frame.el.src = frame.el.src; await p.promise });
    },
  };
};
