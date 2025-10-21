import BiMap from '../other/bimap.js';
import Boo from 'https://esm.sh/@camilaprav/boo@1.0.6';
import actions from '../other/actions.js';
import htmlsnap from 'https://esm.sh/@camilaprav/htmlsnap@0.0.14';
import morph from 'https://esm.sh/nanomorph';
import prettier from '../other/prettier.js';
import rfiles from '../repos/rfiles.js';
import { arrayify, debounce } from '../other/util.js';
import { defaultHead } from '../other/templates.js';

export default class Designer {
  state = {
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
        let frame = this.state.current;
        switch (ev.data.type) {
          case 'ready':
            if (ev.data.status !== 200) return frame.reject(ev.data.error);
            frame.ready = true;
            frame.resolve();
            await post('designer.sync');
            break;
          case 'htmlsnap': {
            this.state.current.snap = ev.data.snap;
            let doc = this.state.current.doc = new DOMParser().parseFromString(ev.data.snap, 'text/html');
            this.state.current.map = htmlsnap(doc.documentElement, { idtrack: true, map: this.state.current.map })[1];
            //await post('designer.save');
            await post('designer.sync');
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
      /*
      if (!frame.preview) {
        if (frame.html) {
          frame.html.addEventListener('mousedown', async ev => await post('designer.mousedown', ev), true);
          frame.html.addEventListener('click', ev => ev.preventDefault(), true);
          frame.html.addEventListener('dblclick', async ev => await post('designer.dblclick', ev), true);
        }
      }
      */
      if (!frame.heightHooked) { d.el(frame.el, { style: { height: () => this.state.frameHeight } }); frame.heightHooked = true }
      bus.emit('designer:frameLoaded:ready', { frame });
    },

    sync: () => this.state.current?.el?.contentWindow?.postMessage?.({
      type: 'state',
      collab: { uid: state.collab.uid, rtc: { presence: state.collab.rtc?.presence } },
      cursors: this.state.current.cursors,
    }, new URL(this.state.current.el.src).origin),

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

    reset: async () => { this.state.list = []; /*await post('designer.toggleMobileKeyboard')*/ },
  };
};
