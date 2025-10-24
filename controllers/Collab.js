import * as pako from 'https://esm.sh/pako';
import RealtimeCollab from '../other/RealtimeCollab.js';
import actions from '../other/actions.js';
import diff from 'https://esm.sh/fast-diff';
import morphdom from 'https://esm.sh/morphdom';
import rfiles from '../repos/rfiles.js';
import { FitAddon } from 'https://esm.sh/xterm-addon-fit';
import { Terminal } from 'https://esm.sh/xterm';

export default class Collab {
  state = {
    get uid() { return location.pathname !== '/collab.html' ? 'master' : this.rtc?.uid },
    ver: 0,
    rpcs: {},
  };

  actions = {
    init: async () => {
      let { bus } = state.event;
      if (this.state.uid === 'master') {
        bus.on('projects:select:ready', async () => await post('collab.sync'));
        bus.on('files:select:ready', async () => await post('collab.sync'));
        bus.on('files:load:ready', async () => await post('collab.sync'));
        bus.on('designer:select:ready', async () => await post('collab.sync', 'full'));
        bus.on('designer:changeSelection:ready', async () => await post('collab.sync'));
        bus.on('designer:save:ready', async () => await post('collab.sync', 'delta'));
        bus.on('designer:resize:ready', async () => await post('collab.sync'));
        bus.on('designer:togglePreview:ready', async ({ preview }) => await post('collab.sync', !preview && 'full'));
        bus.on('shell:toggle:ready', () => setTimeout(async () => await post('collab.sync'), 1000));
        bus.on('shell:select:ready', async () => await post('collab.sync'));
        bus.on('shell:message:label', async () => await post('collab.sync'));
        bus.on('shell:message:stream', async ({ session, payload }) => this.state.rtc?.send?.({ type: 'shell:stream', session, payload }));
        bus.on('shell:close:ready', async () => await post('collab.sync'));
      } else {
        let room = location.hash.slice(1);
        if (!room) { location.href = '/'; return }
        this.state.rtc = new RealtimeCollab(room);
        this.state.rtc.events.on('sync', async ev => await post('collab.apply', ev));
        this.state.rtc.events.on('rpc:response', async ev => await post('collab.rpcResponse', ev));
        this.state.rtc.events.on('presence:leave', async () => {
          await post('collab.leave');
          state.event.bus.emit('collab:presence:update', { presence: this.state.rtc.presence });
          if (!state.collab.rtc.presence.some(x => x.user === 'master')) { state.projects.current = null; state.files.list = []; this.state.sessionEnded = true }
        });
        this.state.rtc.events.on('presence:update', async () => state.event.bus.emit('collab:presence:update', { presence: this.state.rtc.presence }));
        this.state.rtc.events.on('presence:join', async () => state.event.bus.emit('collab:presence:update', { presence: this.state.rtc.presence }));
        this.state.rtc.events.on('shell:stream', async ({ session, payload }) => state.shell.list.find(x => x.session === session)?.term?.write?.(simpleunb64(payload)));
        bus.on('designer:resize:ready', async () => await post('collab.resizeSync'));
      }
    },

    setup: async () => {
      let [btn, rtc] = await showModal('Collaborate');
      if (btn !== 'ok') return await rtc.teardown();
      this.state.rtc = rtc;
      rtc.events.on('presence:join', async () => { await post('collab.sync', 'full'); state.event.bus.emit('collab:presence:update', { presence: rtc.presence }) });
      rtc.events.on('presence:leave', async () => { await post('collab.leave'); state.event.bus.emit('collab:presence:update', { presence: rtc.presence }) });
      rtc.events.on('presence:update', async () => state.event.bus.emit('collab:presence:update', { presence: rtc.presence }));
      rtc.events.on('rpc:*', async ev => await post('collab.rpcInvoke', ev));
      rtc.events.on('changeSelection', async ev => await post('designer.changeSelection', ev.peer, ev.s.map(x => state.designer.current.map.get(x))));
      rtc.events.on('resize', async ev => { state.designer.frameWidth = ev.frameWidth; state.designer.frameHeight = ev.frameHeight; d.update() });
      rtc.events.on('cmd', async ev => await actions[ev.k].handler({ cur: null, ...ev, cur: ev.peer }));
      rtc.events.on('teardown', async () => await post('collab.leave'));
      await post('collab.sync', 'full');
    },

    stop: () => {
      if (!this.state.rtc) return;
      this.state.rtc.teardown();
      this.state.rtc = null;
      state.event.bus.emit('collab:presence:update', { presence: [] });
    },

    rpc: async (proc, data = {}) => {
      let req = { type: null, rpcid: null, ...data, type: `rpc:${proc}`, rpcid: crypto.randomUUID() };
      this.state.rtc.send(req);
      let p = Promise.withResolvers();
      this.state.rpcs[req.rpcid] = { pres: p.resolve, prej: p.reject };
      return await p.promise;
    },

    rpcResponse: async ev => {
      if (ev.peer !== 'master') throw new Error(`RPC response spoof (not from master)`);
      if (!this.state.rpcs[ev.rpcid]) throw new Error(`Unknown RPCID: ${ev.rpcid}`);
      let rpc = this.state.rpcs[ev.rpcid];
      delete this.state.rpcs[ev.rpcid];
      if (ev.error) return rpc.prej(new Error(ev.error));
      rpc.pres(ev.data);
    },

    rpcInvoke: async ev => {
      try {
        let proc = ev.type.split(':')[1];
        let fn = this.rpcs[proc];
        if (!fn) throw new Error(`Unknown RPC: ${proc}`);
        this.state.rtc.send({ type: 'rpc:response', rpcid: ev.rpcid, data: await fn(ev) });
      } catch (err) {
        console.error(err);
        this.state.rtc.send({ type: 'rpc:response', rpcid: ev.rpcid, error: err.toString() });
      }
    },

    sync: async kind => {
      this.state.ver++;
      let snap = state.designer.open ? state.designer.current.snap : '';
      let delta;
      if (kind === 'delta' && this.state.lastSnap) {
        let diffs = diff(this.state.lastSnap, snap);
        delta = await gzbase64(JSON.stringify(diffs));
      }
      this.state.lastSnap = snap;
      this.state.rtc?.send?.({
        type: 'sync',
        ver: this.state.ver,
        project: state.projects.current,
        files: state.files.list,
        expandedPaths: [...state.files.expandedPaths],
        current: state.files.current,
        frameWidth: state.designer.frameWidth,
        frameHeight: state.designer.frameHeight,
        preview: state.designer.current?.preview,
        contents: kind === 'full' ? snap : undefined,
        delta,
        cursors: state.designer.current?.cursors || {},
        clipboards: state.designer.clipboards,
        shell: {
          open: state.shell.open,
          list: state.shell.list.map(x => ({
            session: x.session,
            label: x.label,
            cols: x.term.cols,
            rows: x.term.rows,
            msgbuf: kind === 'full' && x.msgbuf,
            active: state.shell.current === x.session,
          })),
        },
      });
    },

    resizeSync: async () => this.state.rtc?.send?.({ type: 'resize', frameWidth: state.designer.frameWidth, frameHeight: state.designer.frameHeight }),

    apply: async ev => {
      if (ev.ver <= this.state.ver) return;
      this.state.ver = ev.ver;
      state.projects.current = ev.project;
      state.files.list = ev.files;
      state.files.expandedPaths = new Set(ev.expandedPaths);
      if (state.files.current !== ev.current) {
        state.files.current = ev.current;
        await post('designer.select', ev.current);
      }
      state.designer.frameWidth = ev.frameWidth;
      state.designer.frameHeight = ev.frameHeight;
      if (state.designer.open && state.designer.current.preview !== ev.preview) await post('designer.togglePreview');
      let applyHtmlUpdate = async html => state.designer.current?.el?.contentWindow?.postMessage?.({ type: 'update', html }, new URL(state.designer.current.el.src).origin);
      if (ev.contents) {
        await applyHtmlUpdate(ev.contents);
        this.state.lastSnap = ev.contents;
      } else if (ev.delta) {
        let diffs = JSON.parse(await ungzbase64(ev.delta));
        let patched = applyFastDiff(this.state.lastSnap, diffs);
        await applyHtmlUpdate(patched);
        this.state.lastSnap = patched;
      }
      if (state.designer.open) {
        // FIXME
        /*
        if (JSON.stringify(ev.cursors[state.collab.uid]) !== JSON.stringify(state.designer.current.cursors[state.collab.uid]) && ev.cursors[state.collab.uid].length) {
          let first = state.designer.current.map.get(ev.cursors[state.collab.uid][0]);
          let rect = first.getBoundingClientRect();
          let visible = rect.top >= 20 && rect.bottom <= innerHeight - 20;
          !visible && first.scrollIntoView({ block: rect.height <= innerHeight ? 'center' : 'nearest', inline: rect.width <= innerWidth ? 'center' : 'nearest' });
        }
        */
        state.designer.current.cursors = ev.cursors;
        await post('designer.toggleMobileKeyboard');
      }
      state.designer.clipboards = ev.clipboards;
      if (ev.shell) {
        state.shell.open = ev.shell.open;
        while (state.shell.list.length > ev.shell.list.length) state.shell.list.pop();
        for (let [i, x] of ev.shell.list.entries()) {
          let y = state.shell.list[i];
          if (!y) state.shell.list.push(y = x);
          else { y.label = x.label; y.active = x.active }
          if (y.active) state.shell.current = y.session;
          if (y.term) continue;
          y.term = new Terminal({ cursorBlink: true, fontFamily: 'monospace', fontSize: 14, theme: { background: '#00000000', foreground: '#ffffff' } });
          y.term.resize(y.cols, y.rows);
          for (let z of y.msgbuf || []) y.term.write(simpleunb64(z));
        }
      }
      state.designer.open && await post('designer.sync', state.designer.current);
      state.event.bus.emit('collab:apply:ready');
    },

    leave: async () => {
      if (this.state.uid !== 'master' && !state.collab.rtc.presence.some(x => x.user === 'master')) state.files.current = null;
      if (!state.designer.open) return;
      for (let k of Object.keys(state.designer.current.cursors)) {
        if (this.state.uid !== k && !this.state.rtc?.presence?.find?.(x => x.user === k)) {
          let ovs = state.designer.current.overlays[k];
          for (let x of ovs) x.disable();
          delete state.designer.current.overlays[k];
          delete state.designer.current.cursors[k];
        }
      }
      this.state.uid === 'master' && await post('collab.sync');
    },
  };

  rpcs = {
    list: async ({ project }) => {
      if (state.projects.current !== project) throw new Error(`Wrong project: ${project}`);
      return await rfiles.list(project);
    },

    fetch: async ({ project, path }) => {
      if (state.projects.current !== project) throw new Error(`Wrong project: ${project}`);
      let blob = await rfiles.load(project, path);
      if (!blob) throw new Error(`Not found: ${path}`);
      return await b64(await gzblob(blob));
    },

    save: async ({ project, path, data }) => {
      if (state.projects.current !== project) throw new Error(`Wrong project: ${project}`);
      await rfiles.save(project, path, await ungzblob(await unb64(data)));
    },
  };
}

function applyFastDiff(oldText, diffs) {
  let out = '';
  for (let [op, data] of diffs) {
    if (op === 0) out += data;
    else if (op === 1) out += data;
  }
  return out;
}

async function gzbase64(str) {
  let blob = new Blob([pako.gzip(str)], { type: 'application/gzip' });
  return await b64(blob);
}

async function ungzbase64(b64str) {
  let binary = atob(b64str);
  let array = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(pako.ungzip(array));
}

async function gzblob(blob) {
  return new Blob([pako.gzip(new Uint8Array(await blob.arrayBuffer()))], { type: 'application/gzip' });
}

async function ungzblob(blob, type) {
  if (blob == null) return null;
  return new Blob([pako.ungzip(new Uint8Array(await blob.arrayBuffer()))], { type });
}

function b64(blob) {
  return new Promise((res, rej) => {
    let r = new FileReader();
    r.onloadend = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function unb64(base64, type = '') {
  if (base64 == null) return null;
  let chars = atob(base64);
  let nums = new Array(chars.length);
  for (let i = 0; i < chars.length; i++) nums[i] = chars.charCodeAt(i);
  return new Blob([new Uint8Array(nums)], { type });
}

let simpleunb64 = str => new TextDecoder().decode(Uint8Array.from(atob(str), c => c.charCodeAt(0)));
