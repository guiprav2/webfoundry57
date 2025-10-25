import BiMap from './bimap.js';
import Boo from 'https://esm.sh/@camilaprav/boo@1.0.6';
import d from './dominant.js';
import htmlsnap from 'https://esm.sh/@camilaprav/htmlsnap@0.0.16';
import morphdom from 'https://esm.sh/morphdom';

window.state = { map: new BiMap(), cursors: {}, overlays: {} };
let wforigin = new URL(location.href).searchParams.get('isolate') != null ? `${location.protocol}//www.${location.hostname.split('.').slice(1).join('.')}` : location.origin;
let post = data => parent.postMessage({ path: null, ...data, path: location.pathname.slice(1).split('/').slice(3).join('/') }, wforigin);
addEventListener('message', async ev => {
  let { type, ...rest } = ev.data;
  if (type !== 'state' || ev.origin !== wforigin) return;
  if (state.collab?.uid && JSON.stringify(state.cursors[state.collab.uid]) !== JSON.stringify(rest.cursors[state.collab.uid])) {
    let scroll = () => {
      let first = state.map.get(rest.cursors[state.collab.uid]?.at?.(-1));
      let rect = first?.getBoundingClientRect?.();
      let visible = rect && rect.top >= 20 && rect.bottom <= innerHeight - 20;
      !visible && first?.scrollIntoView?.({ block: rect.height <= innerHeight ? 'center' : 'nearest', inline: rect.width <= innerWidth ? 'center' : 'nearest' });
    };
    state.collab.uid === 'master' ? scroll() : setTimeout(scroll, 500);
  }
  Object.assign(state, rest);
});
addEventListener('message', async ev => {
  if (ev.data.type !== 'update' || ev.origin !== wforigin) return;
  let doc = new DOMParser().parseFromString(ev.data.html, 'text/html')
  morphdom(document.head, doc.head);
  morphdom(document.body.firstElementChild, doc.body.firstElementChild);
});
addEventListener('message', async ev => {
  if (ev.data.type !== 'eval' || ev.origin !== wforigin) return;
  try {
    let AsyncFunction = (async () => {}).constructor;
    let fn = new AsyncFunction('state', 'args', ev.data.fn);
    post({ type: 'eval:res', rpcid: ev.data.rpcid, result: await fn(state, ev.data.args) });
  } catch (err) {
    console.error(err);
    post({ type: 'eval:res', rpcid: ev.data.rpcid, error: err.toString() });
  }
});
addEventListener('mousedown', async ev => {
  document.activeElement.blur();
  ev.preventDefault();
  if (!ev.shiftKey) post({ type: 'action', key: 'changeSelection', cur: state.collab.uid, s: [state.map.getKey(ev.target)] });
  else post({ type: 'action', key: 'changeSelection', cur: state.collab.uid, s: [...new Set([...state.cursors[state.collab.uid] || [], state.map.getKey(ev.target)])] });
});
addEventListener('keydown', ev => post({ type: 'keydown', key: ev.key, ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey }));
async function trackCursors() {
  requestAnimationFrame(async () => await trackCursors());
  if (!document.body) return; // document.open
  for (let [k, ids] of Object.entries(state.cursors)) {
    let ovs = (state.overlays[k] ??= []);
    while (ids.length > ovs.length) {
      let i = ovs.length;
      let p = state.collab.rtc?.presence?.find?.(x => x.user === k);
      let o = d.el('div', { class: ['wf-cursor hidden z-10 pointer-events-none', () => !p ? 'border border-blue-400' : `border border-${p.color}`] });
      ovs.push(new Boo(o, () => state.map.get(state.cursors[k][i]), { transitionClass: 'transition-all' }));
    }
    while (ovs.length > ids.length) ovs.pop().disable();
    for (let x of ovs) !x.ov.parentElement && document.body.append(x.ov);
  }
}
await trackCursors();
let snap = () => {
  let [snap, map] = htmlsnap(document.documentElement, { idtrack: true, map: state.map });
  state.map = map;
  let doc = new DOMParser().parseFromString(snap, 'text/html');
  doc.querySelectorAll('.wf-cursor').forEach(x => x.remove());
  if (doc.documentElement.outerHTML === state.snap) return;
  snap = state.snap = doc.documentElement.outerHTML;
  post({ type: 'htmlsnap', snap });
};
let mutobs = new MutationObserver(snap);
mutobs.observe(document, { attributes: true, subtree: true, childList: true, characterData: true });
snap();
post({ type: 'ready', status: 200 });
